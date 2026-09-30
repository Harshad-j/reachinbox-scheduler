import { Client } from "@elastic/elasticsearch";
import { env } from "../config/env.js";
export const elastic=new Client({node:env.ELASTICSEARCH_URL});
export async function indexEmail(id:string):Promise<void>{const email=await (await import("../db/index.js")).prisma.email.findUnique({where:{id},include:{batch:true}});if(!email)return;await elastic.index({index:"emails",id,document:{recipient:email.recipient,subject:email.subject,body:email.body,status:email.status,senderId:email.senderId,batchId:email.batchId,batchStatus:email.batch.status,userId:email.batch.userId,scheduledAt:email.scheduledAt,sentAt:email.sentAt}})}
