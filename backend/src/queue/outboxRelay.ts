import { Worker, type JobsOptions } from "bullmq";
import { prisma } from "../db/index.js";
import { redis } from "../redis/index.js";
import { emailQueue, maintenanceQueue } from "./emailQueue.js";
import { logger } from "../logger/index.js";
import { indexEmail } from "../services/elastic.js";
import { env } from "../config/env.js";

type RelayPayload = { emailId?: string };
export async function relayOutbox(): Promise<void> {
  const rows = await prisma.$transaction(async tx => tx.$queryRaw<Array<{id:string;type:string;payload:RelayPayload}>>`
    SELECT id, type, payload FROM "Outbox" WHERE status = 'pending' ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 500`);
  for (let offset = 0; offset < rows.length; offset += 500) {
    const chunk = rows.slice(offset, offset + 500);
    const ids = chunk.map(row => row.id);
    const enqueue = chunk.filter(row => row.type === "ENQUEUE_EMAIL");
    const emails = enqueue.length ? await prisma.email.findMany({ where: { id: { in: enqueue.map(row => row.payload.emailId ?? "") } } }) : [];
    const emailById = new Map(emails.map(email => [email.id, email]));
    const bulk: Array<{ name:string; data:{emailId:string}; opts:JobsOptions }> = [];
    for (const row of enqueue) {
      const email = emailById.get(row.payload.emailId ?? ""); if (!email) continue;
      bulk.push({ name:"send-email", data:{emailId:email.id}, opts:{jobId:email.id, delay:Math.max(0,email.scheduledAt.getTime()-Date.now()), attempts:env.MAX_ATTEMPTS, backoff:{type:"exponential",delay:env.MIN_DELAY_BETWEEN_SENDS_MS}, removeOnComplete:false} });
    }
    if (bulk.length) await emailQueue.addBulk(bulk);
    const completed:string[]=[];
    for(const row of chunk){if(row.type==="INDEX_EMAIL"){try{if(row.payload.emailId)await indexEmail(row.payload.emailId);completed.push(row.id)}catch(error){await prisma.outbox.update({where:{id:row.id},data:{attempts:{increment:1}}});logger.warn({outboxId:row.id,error},"Elasticsearch indexing deferred")}}else completed.push(row.id)}
    if(completed.length)await prisma.outbox.updateMany({ where:{id:{in:completed}}, data:{status:"done",processedAt:new Date()} });
  }
}
export async function startOutboxRelay(): Promise<Worker> {
  const worker = new Worker("maintenance", async job => { if (job.name === "relay-outbox") await relayOutbox(); }, { connection:redis });
  await worker.waitUntilReady();
  await maintenanceQueue.upsertJobScheduler("outbox-relay", { every: env.OUTBOX_RELAY_INTERVAL_MS }, { name:"relay-outbox", data:{}, opts:{ removeOnComplete:true } });
  worker.on("failed", error => logger.error({error},"Outbox relay failed"));
  return worker;
}
