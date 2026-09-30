import { Worker } from "bullmq";
import { env } from "../config/env.js";
import { prisma } from "../db/index.js";
import { redis } from "../redis/index.js";
import { emailQueue, maintenanceQueue } from "./emailQueue.js";
import { interruptedSendStatus } from "../services/deliveryRecovery.js";

export async function sweepStuckEmails():Promise<number>{
  const cutoff=new Date(Date.now()-env.STUCK_TIMEOUT_MS);
  const stuck=await prisma.email.findMany({where:{status:"sending",updatedAt:{lt:cutoff}},select:{id:true,scheduledAt:true,smtpStartedAt:true}});
  for(const email of stuck){
    const outcomeUnknown=interruptedSendStatus(email.smtpStartedAt)==="delivery_unknown";
    const changed=await prisma.email.updateMany({where:{id:email.id,status:"sending",updatedAt:{lt:cutoff}},data:{status:interruptedSendStatus(email.smtpStartedAt),...(outcomeUnknown?{lastError:"Worker stopped during SMTP delivery. Provider acceptance could not be confirmed, so automatic retry was suppressed to avoid a duplicate.",smtpStartedAt:email.smtpStartedAt}:{smtpStartedAt:null})}});
    if(!changed.count)continue;
    await prisma.outbox.create({data:{type:"INDEX_EMAIL",payload:{emailId:email.id}}});
    if(outcomeUnknown)continue;
    const existing=await emailQueue.getJob(email.id);
    if(existing){const state=await existing.getState();if(state==="completed"||state==="failed")await existing.remove()}
    await emailQueue.add("send-email",{emailId:email.id},{jobId:email.id,delay:Math.max(0,email.scheduledAt.getTime()-Date.now())});
  }
  return stuck.length;
}
export async function startMaintenanceSchedulers():Promise<Worker>{
  const worker=new Worker("maintenance",async job=>{if(job.name==="sweep-stuck")return sweepStuckEmails()},{connection:redis});
  await maintenanceQueue.upsertJobScheduler("stuck-email-sweeper",{every:env.STUCK_SWEEP_INTERVAL_MS},{name:"sweep-stuck",data:{}});
  return worker;
}
