import "../backend/src/config/env.js";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { prisma } from "../backend/src/db/index.js";
import { emailQueue } from "../backend/src/queue/emailQueue.js";
import { relayOutbox } from "../backend/src/queue/outboxRelay.js";
import { env } from "../backend/src/config/env.js";

const count = Number(process.argv[2] ?? 10);
if (!Number.isSafeInteger(count) || count < 2 || count > 100) throw new Error("count must be between 2 and 100");
const runId = randomUUID();
const startTime = new Date(Date.now() + 15_000);
const delayBetweenMs = Math.max(env.MIN_DELAY_BETWEEN_SENDS_MS, 5_000);
const toleranceMs = Math.max(60_000, delayBetweenMs * 3);
let userId: string | undefined;
let batchId: string | undefined;
let emailIds: string[] = [];
let outboxIds: string[] = [];
let restarted = false;

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

try {
  const sender = await prisma.sender.findFirst({ where: { isActive: true, smtpHost: { contains: "ethereal.email", mode: "insensitive" } } });
  if (!sender) throw new Error("Configure or seed an active Ethereal sender before restart testing; this script refuses to send its test messages to real inboxes");
  const user = await prisma.user.create({ data: { googleId: `restart-test-${runId}`, email: `restart-test-${runId}@example.test`, name: "ReachInbox Restart Test" } });
  userId = user.id;
  const batch = await prisma.batch.create({ data: {
    userId: user.id,
    subject: `ReachInbox restart test ${runId}`,
    body: "This is an Ethereal-only restart recovery test.",
    startTime,
    delayBetweenMs,
    totalCount: count,
    idempotencyKey: `restart-test-${runId}`,
  } });
  batchId = batch.id;
  await prisma.email.createMany({ data: Array.from({ length: count }, (_, index) => ({
    batchId: batch.id,
    senderId: sender.id,
    recipient: `restart-${runId}-${index}@example.test`,
    subject: batch.subject,
    body: batch.body,
    scheduledAt: new Date(startTime.getTime() + index * delayBetweenMs),
  })) });
  const emails = await prisma.email.findMany({ where: { batchId: batch.id }, select: { id: true, scheduledAt: true } });
  emailIds = emails.map(email => email.id);
  const outboxRows = await prisma.outbox.createManyAndReturn({ data: emails.map(email => ({ type: "ENQUEUE_EMAIL" as const, payload: { emailId: email.id } })), select: { id: true } });
  outboxIds = outboxRows.map(row => row.id);
  for (let pass = 0; pass < 10; pass += 1) {
    const pending = await prisma.outbox.count({ where: { status: "pending", type: "ENQUEUE_EMAIL" } });
    if (!pending) break;
    await relayOutbox();
  }

  const firstSendDeadline = startTime.getTime() + toleranceMs;
  while (Date.now() < firstSendDeadline) {
    const sent = await prisma.email.count({ where: { batchId: batch.id, status: "sent" } });
    if (sent > 0 && sent < count) break;
    if (sent === count) throw new Error("The batch completed before the restart could be performed; use a larger count or slower delay");
    await wait(250);
  }
  if (Date.now() >= firstSendDeadline) throw new Error("No message reached sent before the restart window; inspect the worker logs");

  const restart = spawnSync("docker", ["compose", "restart", "api", "worker"], { stdio: "inherit", timeout: 120_000 });
  if (restart.error) throw restart.error;
  if (restart.status !== 0) throw new Error(`docker compose restart exited with status ${restart.status}`);
  restarted = true;

  const deadline = Date.now() + Math.max(300_000, count * delayBetweenMs * 4);
  while (Date.now() < deadline) {
    const remaining = await prisma.email.count({ where: { batchId: batch.id, status: { in: ["scheduled", "sending"] } } });
    if (!remaining) break;
    await wait(1000);
  }
  const results = await prisma.email.findMany({ where: { batchId: batch.id }, select: { recipient: true, status: true, scheduledAt: true, sentAt: true, messageId: true, lastError: true } });
  const sent = results.filter(row => row.status === "sent");
  const nonSent = results.filter(row => row.status !== "sent");
  const duplicateRows = results.length - new Set(results.map(row => row.recipient)).size;
  const duplicateMessageIds = sent.length - new Set(sent.map(row => row.messageId).filter((id): id is string => id !== null)).size;
  const timingFailures = sent.filter(row => !row.sentAt || row.sentAt.getTime() < row.scheduledAt.getTime() - 1000 || row.sentAt.getTime() > row.scheduledAt.getTime() + toleranceMs);
  console.table([
    { metric: "Persisted email rows", count: results.length },
    { metric: "Sent rows", count: sent.length },
    { metric: "Non-sent rows", count: nonSent.length },
    { metric: "Duplicate recipients in DB", count: duplicateRows },
    { metric: "Duplicate persisted Message-IDs", count: duplicateMessageIds },
    { metric: `Outside ${toleranceMs}ms schedule tolerance`, count: timingFailures.length },
    { metric: "API and worker restarted", count: restarted ? "yes" : "no" },
  ]);
  if (nonSent.length) console.table(nonSent.map(row => ({ recipient: row.recipient, status: row.status, error: row.lastError })));
  if (results.length !== count || sent.length !== count || duplicateRows || duplicateMessageIds || timingFailures.length) {
    throw new Error("Restart recovery assertions failed. See the summary above.");
  }
  console.log("PASS: the Ethereal test batch survived an API/worker restart; DB rows, unique recipients, deterministic Message-IDs, and send-time tolerance passed.");
  console.log("LIMIT: this proves persisted application state, not exactly-once remote SMTP delivery. A crash after provider acceptance remains externally unverifiable; the worker now marks that case delivery_unknown and suppresses automatic resend.");
} finally {
  if (emailIds.length) {
    const jobs = await Promise.all(emailIds.map(id => emailQueue.getJob(id)));
    await Promise.all(jobs.filter((job): job is NonNullable<typeof job> => job !== undefined).map(async job => {
      const state = await job.getState();
      if (state !== "active") await job.remove();
    }));
    if (outboxIds.length) await prisma.outbox.deleteMany({ where: { id: { in: outboxIds } } });
  }
  if (batchId) await prisma.batch.deleteMany({ where: { id: batchId } });
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  await Promise.all([emailQueue.close(), prisma.$disconnect()]);
}
