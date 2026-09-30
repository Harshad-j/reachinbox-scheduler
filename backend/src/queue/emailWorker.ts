import { Worker, DelayedError } from "bullmq";
import nodemailer from "nodemailer";
import { prisma } from "../db/index.js";
import { redis } from "../redis/index.js";
import { env } from "../config/env.js";
import { logger } from "../logger/index.js";
import { reserveRateSlot } from "./rateLimiter.js";
import { classifyDeliveryError } from "../services/errorClassifier.js";
import { decryptSecret } from "../services/crypto.js";
import { isAmbiguousSmtpFailure } from "../services/deliveryRecovery.js";
import { notifyRateLimit } from "../services/slackNotifier.js";

const richTags = new Set(["p", "div", "br", "strong", "b", "em", "i", "u", "s", "ul", "ol", "li", "blockquote", "a"]);
function escapeHtml(value: string): string { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
function safeEmailHtml(value: string): string {
  const hasMarkup = /<\/?(?:p|div|br|strong|b|em|i|u|s|ul|ol|li|blockquote|a)\b/i.test(value);
  const source = hasMarkup ? value : `<p>${escapeHtml(value).replace(/\r?\n/g, "<br>")}</p>`;
  return source.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "").replace(/<\/?([a-z][a-z0-9]*)\b([^>]*)>/gi, (tag, name, attrs: string) => {
    const lower = String(name).toLowerCase();
    if (!richTags.has(lower)) return "";
    if (tag.startsWith("</")) return lower === "br" ? "" : `</${lower}>`;
    if (lower === "br") return "<br>";
    if (lower === "a") {
      const href = attrs.match(/href\s*=\s*(["'])(.*?)\1/i)?.[2] ?? "";
      return /^(https?:\/\/|mailto:)/i.test(href) ? `<a href="${escapeHtml(href)}" rel="noopener noreferrer">` : "";
    }
    const alignment = lower === "p" || lower === "div" ? attrs.match(/text-align\s*:\s*(left|center|right|justify)/i)?.[1] : undefined;
    return `<${lower}${alignment ? ` style="text-align: ${alignment.toLowerCase()}"` : ""}>`;
  });
}
function richTextAsPlain(value: string): string {
  return value.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<\/(?:p|div|li|blockquote)>/gi, "\n").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}
async function defer(job:{moveToDelayed:(timestamp:number,token?:string)=>Promise<void>;token?:string},emailId:string,timestamp:number){  await prisma.$transaction([prisma.email.update({where:{id:emailId},data:{status:"scheduled",scheduledAt:new Date(timestamp),smtpStartedAt:null}}),prisma.outbox.create({data:{type:"INDEX_EMAIL",payload:{emailId}}})]);
  await job.moveToDelayed(timestamp,job.token); throw new DelayedError();
}
export const emailWorker=new Worker("emails",async job=>{
  const id=String((job.data as {emailId:string}).emailId);
  const email=await prisma.email.findUnique({where:{id},include:{batch:true,sender:true}}); if(!email)return;
  if(email.batch.status!=="active" || email.status!=="scheduled")return;
  const claim=await prisma.$transaction(async tx=>{const changed=await tx.email.updateMany({where:{id,status:"scheduled"},data:{status:"sending"}});if(changed.count)await tx.outbox.create({data:{type:"INDEX_EMAIL",payload:{emailId:id}}});return changed}); if(!claim.count)return;
  try {
  const now=Date.now(); const cap=email.batch.hourlyLimit??env.MAX_EMAILS_PER_HOUR_PER_SENDER;
  if(email.sender.circuitOpenUntil && email.sender.circuitOpenUntil>new Date()){
    const healthy=await prisma.sender.findFirst({where:{isActive:true,OR:[{userId:email.batch.userId},{userId:null}],AND:[{OR:[{circuitOpenUntil:null},{circuitOpenUntil:{lte:new Date()}}]}],id:{not:email.senderId}}});
    if(healthy)await prisma.email.update({where:{id},data:{senderId:healthy.id}});
    await defer(job,id,healthy?Date.now()+env.MIN_DELAY_BETWEEN_SENDS_MS:email.sender.circuitOpenUntil.getTime());
  }
  const gateKey=`send-gap:${email.senderId}`;const gate=await redis.set(gateKey,"1","PX",env.MIN_DELAY_BETWEEN_SENDS_MS,"NX");
  if(gate!=="OK"){const ttl=await redis.pttl(gateKey);await defer(job,email.id,Date.now()+Math.max(1,ttl));return}
  const rate=await reserveRateSlot(email.senderId,cap,now);
  if(rate.windowOffset>0){await redis.incr("rate-limit:hits");await notifyRateLimit({senderId:email.senderId,senderEmail:email.sender.email,hourlyLimit:Math.min(cap,env.MAX_EMAILS_PER_HOUR_GLOBAL??Number.MAX_SAFE_INTEGER),windowStartMs:rate.windowStartMs,delayedCount:rate.delayedCount});await defer(job,email.id,rate.windowStartMs+Math.max(0,rate.position-1)*env.MIN_DELAY_BETWEEN_SENDS_MS);return}
  const transport=nodemailer.createTransport({host:email.sender.smtpHost,port:email.sender.smtpPort,secure:email.sender.smtpPort===465,auth:{user:email.sender.smtpUser,pass:decryptSecret(email.sender.smtpPass)}});
  let smtpAccepted=false;
  try{
    await prisma.email.update({where:{id},data:{attempts:{increment:1},smtpStartedAt:new Date()}});
    const result=await transport.sendMail({from:email.sender.email,to:email.recipient,subject:email.subject,html:safeEmailHtml(email.body),text:richTextAsPlain(email.body),messageId:`<${email.id}@reachinbox.local>`});
    smtpAccepted=true;
    const testUrl=nodemailer.getTestMessageUrl(result); const previewUrl=typeof testUrl === "string" ? testUrl : null;
    await prisma.$transaction([prisma.email.update({where:{id},data:{status:"sent",sentAt:new Date(),messageId:typeof result.messageId === "string" ? result.messageId : null,previewUrl,lastError:null}}),prisma.sender.update({where:{id:email.senderId},data:{consecutiveFailures:0}}),prisma.outbox.create({data:{type:"INDEX_EMAIL",payload:{emailId:id}}})]);
    const remaining=await prisma.email.count({where:{batchId:email.batchId,status:{in:["scheduled","sending"]}}});if(remaining===0)await prisma.batch.update({where:{id:email.batchId},data:{status:"completed"}});
  }catch(error){
    const errorMessage=error instanceof Error?error.message:String(error);
    if(smtpAccepted){
      const persisted=await prisma.email.findUnique({where:{id},select:{status:true}});
      if(persisted?.status==="sent"){
        logger.warn({emailId:id,errorMessage},"Email was sent; a later batch bookkeeping update failed");
        return;
      }
      await prisma.$transaction([prisma.email.update({where:{id},data:{status:"delivery_unknown",lastError:"SMTP accepted the message, but the delivery record could not be confirmed: "+errorMessage}}),prisma.outbox.create({data:{type:"INDEX_EMAIL",payload:{emailId:id}}})]);
      logger.error({emailId:id},"SMTP accepted an email but database finalization failed; automatic resend suppressed");
      return;
    }
    const classified=classifyDeliveryError(error); const failures=await prisma.sender.update({where:{id:email.senderId},data:{consecutiveFailures:{increment:1}}});
    if(failures.consecutiveFailures>=env.MAX_CONSECUTIVE_FAILURES)await prisma.sender.update({where:{id:email.senderId},data:{circuitOpenUntil:new Date(Date.now()+env.CIRCUIT_OPEN_DURATION_MS)}});
    const permanent=!classified.transient||email.attempts+1>=env.MAX_ATTEMPTS;
    const ambiguous=classified.transient&&isAmbiguousSmtpFailure(error);
    const status:"delivery_unknown"|"failed"|"scheduled"=ambiguous?"delivery_unknown":permanent?"failed":"scheduled";
    const update={status,lastError:ambiguous?"SMTP delivery outcome is unknown; automatic resend suppressed to avoid a duplicate. Provider error: "+classified.message:classified.message,...(status==="scheduled"?{smtpStartedAt:null}:{})};
    await prisma.$transaction([prisma.email.update({where:{id},data:update}),prisma.outbox.create({data:{type:"INDEX_EMAIL",payload:{emailId:id}}})]);
    if(status==="scheduled")throw error;
  }finally{transport.close()}
  } catch(error) {
    if(error instanceof DelayedError) throw error;
    const current=await prisma.email.findUnique({where:{id},select:{status:true,smtpStartedAt:true}});
    if(current?.status==="sending") {
      const terminal=job.attemptsMade+1>=env.MAX_ATTEMPTS;
      const message=error instanceof Error?error.message:String(error);
      const status:"delivery_unknown"|"failed"|"scheduled"=current.smtpStartedAt?"delivery_unknown":terminal?"failed":"scheduled";
      const lastError=current.smtpStartedAt?"SMTP attempt was interrupted; automatic resend suppressed to avoid a duplicate. "+message:message;
      await prisma.$transaction([prisma.email.update({where:{id},data:{status,lastError,...(status==="scheduled"?{smtpStartedAt:null}:{})}}),prisma.outbox.create({data:{type:"INDEX_EMAIL",payload:{emailId:id}}})]);
      if(status!=="scheduled") return;
    }
    throw error;
  }
},{connection:redis,concurrency:env.WORKER_CONCURRENCY,limiter:{max:1,duration:env.MIN_DELAY_BETWEEN_SENDS_MS}});
emailWorker.on("failed",(job,error)=>logger.error({jobId:job?.id,errorMessage:error.message,errorCode:"code" in error?String(error.code):undefined,attemptsMade:job?.attemptsMade},"Email job failed"));
