import "../backend/src/config/env.js";
import { prisma } from "../backend/src/db/index.js";
import { elastic } from "../backend/src/services/elastic.js";
async function main(){let cursor:string|undefined;let count=0;while(true){const emails=await prisma.email.findMany({take:500, ...(cursor?{skip:1,cursor:{id:cursor}}:{}),orderBy:{id:"asc"},include:{batch:true}});if(!emails.length)break;await elastic.bulk({operations:emails.flatMap(email=>[{index:{_index:"emails",_id:email.id}},{recipient:email.recipient,subject:email.subject,body:email.body,status:email.status,senderId:email.senderId,batchId:email.batchId,userId:email.batch.userId,scheduledAt:email.scheduledAt,sentAt:email.sentAt}])});count+=emails.length;cursor=emails[emails.length-1]!.id}console.log(`Reindexed ${count} email records`)}
main().finally(async()=>{await prisma.$disconnect();await elastic.close()});
