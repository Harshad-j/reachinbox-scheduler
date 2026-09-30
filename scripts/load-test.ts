import "../backend/src/config/env.js";
import { randomUUID } from "node:crypto";
import { prisma } from "../backend/src/db/index.js";
import { redis } from "../backend/src/redis/index.js";
import { emailQueue } from "../backend/src/queue/emailQueue.js";
import { relayOutbox } from "../backend/src/queue/outboxRelay.js";
import { reserveRateSlot } from "../backend/src/queue/rateLimiter.js";
import { notifyRateLimit } from "../backend/src/services/slackNotifier.js";
import { elastic } from "../backend/src/services/elastic.js";
import { env } from "../backend/src/config/env.js";

const count = Number(process.argv[2] ?? 1000);
const quota = Number(process.argv[3] ?? 200);
const notifySlack = process.argv.includes("--notify-slack");
if (!Number.isSafeInteger(count) || count < 1 || count > 10_000) throw new Error("count must be between 1 and 10000");
if (!Number.isSafeInteger(quota) || quota < 1) throw new Error("quota must be a positive integer");

const runId = randomUUID();
const rateSenderId = `load-${runId}`;
const startTime = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
let userId: string | undefined;
let createdTestUser = false;
let testSenderId: string | undefined;
let batchId: string | undefined;
let emailIds: string[] = [];
let outboxIds: string[] = [];

try {
  const activeSender = await prisma.sender.findFirst({ where: { isActive: true } });
  if (!activeSender) throw new Error("Configure at least one active sender before running the load test");
  const slackConnection = notifySlack ? await prisma.slackConnection.findFirst({ select: { userId: true } }) : null;
  if (notifySlack && !slackConnection) throw new Error("--notify-slack requires a user with an active Slack connection");
  if (slackConnection) userId = slackConnection.userId;
  else {
    const testUser = await prisma.user.create({ data: { googleId: `load-test-${runId}`, email: `load-test-${runId}@example.test`, name: "ReachInbox Load Test" } });
    userId = testUser.id;
    createdTestUser = true;
  }

  const testSender = await prisma.sender.create({ data: {
    userId,
    email: `load-test-${runId}@example.test`,
    smtpHost: activeSender.smtpHost,
    smtpPort: activeSender.smtpPort,
    smtpUser: activeSender.smtpUser,
    smtpPass: activeSender.smtpPass,
    isActive: true,
  } });
  testSenderId = testSender.id;

  const batch = await prisma.batch.create({ data: {
    userId,
    subject: `ReachInbox load test ${runId}`,
    body: "Scheduled load test. These delayed jobs are removed by the script before they can be delivered.",
    startTime,
    delayBetweenMs: 0,
    hourlyLimit: quota,
    totalCount: count,
    idempotencyKey: `load-test-${runId}`,
  } });
  batchId = batch.id;
  await prisma.email.createMany({ data: Array.from({ length: count }, (_, index) => ({
    batchId: batch.id,
    senderId: testSender.id,
    recipient: `load-${runId}-${index}@example.test`,
    subject: batch.subject,
    body: batch.body,
    scheduledAt: new Date(startTime.getTime() + index * env.MIN_DELAY_BETWEEN_SENDS_MS),
  })) });
  const emails = await prisma.email.findMany({ where: { batchId: batch.id }, select: { id: true } });
  emailIds = emails.map(email => email.id);
  const outboxRows = await prisma.outbox.createManyAndReturn({ data: emails.flatMap(email => [
    { type: "ENQUEUE_EMAIL" as const, payload: { emailId: email.id } },
    { type: "INDEX_EMAIL" as const, payload: { emailId: email.id } },
  ]), select: { id: true } });
  outboxIds = outboxRows.map(row => row.id);

  let pending = await prisma.outbox.count({ where: { status: "pending", type: "ENQUEUE_EMAIL" } });
  let relayPasses = 0;
  while (pending > 0 && relayPasses < Math.ceil(count / 100) + 10) {
    await relayOutbox();
    relayPasses += 1;
    pending = await prisma.outbox.count({ where: { status: "pending", type: "ENQUEUE_EMAIL" } });
  }
  if (pending > 0) throw new Error(`Outbox relay left ${pending} enqueue rows pending after ${relayPasses} passes`);

  const queueStates = await Promise.all(emailIds.map(async id => {
    const job = await emailQueue.getJob(id);
    return job ? job.getState() : null;
  }));
  const missingJobs = emailIds.filter((_, index) => !queueStates[index] || queueStates[index] === "failed" || queueStates[index] === "completed");
  if (missingJobs.length) throw new Error(`Only ${count - missingJobs.length}/${count} email jobs were present in BullMQ`);

  const now = Date.now();
  const decisions = await Promise.all(Array.from({ length: count }, () => reserveRateSlot(rateSenderId, quota, now, 0)));
  const windows = new Map<number, number>();
  for (const decision of decisions) windows.set(decision.windowOffset, (windows.get(decision.windowOffset) ?? 0) + 1);
  const ordered = [...windows.entries()].sort((a, b) => a[0] - b[0]);
  if (ordered.reduce((sum, [, value]) => sum + value, 0) !== count || ordered.some(([, value]) => value > quota) || ordered.some(([offset], index) => offset !== index)) {
    throw new Error("Hourly rate windows were not filled in order without exceeding the quota");
  }

  let slackResult = "not requested";
  if (notifySlack) {
    const firstOverflow = decisions.find(decision => decision.windowOffset > 0);
    if (!firstOverflow || !testSenderId) throw new Error("The test quota did not produce an overflow event for Slack");
    const notice = { senderId: testSenderId, senderEmail: `load-test-${runId}@example.test`, hourlyLimit: quota, windowStartMs: firstOverflow.windowStartMs, delayedCount: firstOverflow.delayedCount };
    const first = await notifyRateLimit(notice);
    const duplicate = await notifyRateLimit(notice);
    if (first !== "sent" || duplicate !== "already_notified") throw new Error(`Slack debounce check failed (first=${first}, second=${duplicate})`);
    slackResult = "one live message sent; duplicate suppressed";
  }

  console.table(ordered.map(([offset, reserved]) => ({ window: offset, starts: new Date(decisions.find(item => item.windowOffset === offset)!.windowStartMs).toISOString(), reserved, limit: quota })));
  console.table([{ emailsPersisted: emailIds.length, uniqueQueueJobs: emailIds.length, outboxRelayPasses: relayPasses, scheduledFor: startTime.toISOString(), slack: slackResult }]);
  console.log(`PASS: ${count} real email rows and outbox enqueue/index records reached BullMQ; ${count} atomic reservations filled ${windows.size} ordered UTC windows. The delayed test jobs are cleaned up before their future send time.`);
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
  if (batchId) await elastic.deleteByQuery({ index: "emails", query: { term: { batchId } } }).catch(() => undefined);
  if (testSenderId) await prisma.sender.deleteMany({ where: { id: testSenderId } });
  if (createdTestUser && userId) await prisma.user.deleteMany({ where: { id: userId } });
  if (notifySlack && testSenderId) {
    const noticeKeys = await redis.keys(`slack:notified:${testSenderId}:*`);
    if (noticeKeys.length) await redis.del(...noticeKeys);
  }
  const keys = await redis.keys(`rl:{${rateSenderId}}:*`);
  if (keys.length) await redis.del(...keys);
  await Promise.all([emailQueue.close(), prisma.$disconnect(), redis.quit(), elastic.close()]);
}
