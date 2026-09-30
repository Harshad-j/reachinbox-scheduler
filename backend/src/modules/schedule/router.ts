import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/index.js";
import { selectSender } from "../../services/senderSelector.js";

const bodySchema = z.object({ subject:z.string().min(1).max(998), body:z.string().min(1), recipients:z.array(z.string().email()).min(1).max(10000), startTime:z.string().datetime(), delayBetweenMs:z.number().int().min(0), hourlyLimit:z.number().int().positive().optional() });
export const scheduleRouter = Router();
scheduleRouter.post("/", async (req,res,next) => {
  try {
    const parsed=bodySchema.safeParse(req.body); if(!parsed.success){res.status(400).json({error:{code:"VALIDATION_ERROR",message:parsed.error.message}});return}
    const userId=(req.user as {id?:string}|undefined)?.id; if(!userId){res.status(401).json({error:{code:"UNAUTHENTICATED",message:"Login required"}});return}
    const key=req.header("Idempotency-Key")?.slice(0,255)??null;
    if(key){const existing=await prisma.batch.findFirst({where:{userId,idempotencyKey:key}});if(existing){res.status(200).json({batchId:existing.id,totalCount:existing.totalCount,idempotentReplay:true});return}}
    const now=new Date();
    const senders=await prisma.sender.findMany({where:{isActive:true,AND:[{OR:[{userId},{userId:null}]},{OR:[{circuitOpenUntil:null},{circuitOpenUntil:{lte:now}}]}]}});
    if(!senders.length){res.status(503).json({error:{code:"NO_HEALTHY_SENDERS",message:"No healthy SMTP sender is available. Add a sender in Compose, or wait for an open sender circuit to recover."}});return}
    const input={...parsed.data,recipients:[...new Set(parsed.data.recipients.map(recipient=>recipient.toLowerCase()))]}; const start=new Date(input.startTime);
    const batch=await prisma.$transaction(async tx=>{
      const created=await tx.batch.create({data:{userId,subject:input.subject,body:input.body,startTime:start,delayBetweenMs:input.delayBetweenMs,hourlyLimit:input.hourlyLimit,totalCount:input.recipients.length,idempotencyKey:key}});
      const emailRows=input.recipients.map((recipient,index)=>{const sender=selectSender(senders,now,index);return {batchId:created.id,senderId:sender.id,recipient,subject:input.subject,body:input.body,scheduledAt:new Date(start.getTime()+index*input.delayBetweenMs)}});
      await tx.email.createMany({data:emailRows,skipDuplicates:true});
      const emails=await tx.email.findMany({where:{batchId:created.id},select:{id:true}});
      await tx.outbox.createMany({data:emails.flatMap(email=>[{type:"ENQUEUE_EMAIL" as const,payload:{emailId:email.id}},{type:"INDEX_EMAIL" as const,payload:{emailId:email.id}}])});
      return created;
    });
    res.status(201).json({batchId:batch.id,totalCount:batch.totalCount,idempotentReplay:false});
  } catch(error){
    const key=req.header("Idempotency-Key")?.slice(0,255)??null;const userId=(req.user as {id?:string}|undefined)?.id;
    if(key&&userId&&typeof error==="object"&&error!==null&&"code" in error&&(error as {code?:string}).code==="P2002"){const existing=await prisma.batch.findFirst({where:{userId,idempotencyKey:key}});if(existing){res.status(200).json({batchId:existing.id,totalCount:existing.totalCount,idempotentReplay:true});return}}
    next(error)
  }
});
