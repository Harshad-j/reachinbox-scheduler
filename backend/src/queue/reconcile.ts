import { prisma } from "../db/index.js";
import { emailQueue } from "./emailQueue.js";
export async function reconcileScheduled():Promise<void>{
  const emails=await prisma.email.findMany({where:{status:"scheduled",batch:{status:"active"}},select:{id:true,scheduledAt:true},orderBy:{scheduledAt:"asc"}});
  const jobs=await emailQueue.getJobs(["waiting","delayed","active","paused","prioritized"]);
  const present=new Set(jobs.map(job=>String(job.id)));
  for(const email of emails){if(!present.has(email.id)){const completed=await emailQueue.getJob(email.id);if(completed){const state=await completed.getState();if(state==="completed"||state==="failed")await completed.remove()}}}
  for(let offset=0;offset<emails.length;offset+=500){const missing=emails.slice(offset,offset+500).filter(email=>!present.has(email.id));if(missing.length)await emailQueue.addBulk(missing.map(email=>({name:"send-email",data:{emailId:email.id},opts:{jobId:email.id,delay:Math.max(0,email.scheduledAt.getTime()-Date.now()),removeOnComplete:false}})))}
}
