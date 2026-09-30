import { prisma } from "../db/index.js";
import { redis } from "../redis/index.js";
import { logger } from "../logger/index.js";
import { decryptSecret } from "./crypto.js";

export type SlackRateNotice = { senderId: string; senderEmail: string; hourlyLimit: number; windowStartMs: number; delayedCount: number };
export type SlackNoticeResult = "sent" | "already_notified" | "not_connected" | "failed";

export async function notifyRateLimit(notice: SlackRateNotice): Promise<SlackNoticeResult> {
  try {
    const sender = await prisma.sender.findUnique({ where: { id: notice.senderId }, select: { userId: true } });
    if (!sender?.userId) return "not_connected";
    const connection = await prisma.slackConnection.findUnique({ where: { userId: sender.userId } });
    if (!connection) return "not_connected";
    const hour = new Date(notice.windowStartMs).toISOString().slice(0, 13);
    const key = `slack:notified:${notice.senderId}:${hour}`;
    if (await redis.set(key, "1", "EX", 3600, "NX") !== "OK") return "already_notified";
    const response = await fetch(decryptSecret(connection.encryptedCredential), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `Hourly limit reached for ${notice.senderEmail}: ${notice.hourlyLimit}/hour. ${notice.delayedCount} emails delayed to ${new Date(notice.windowStartMs).toISOString()}.` }),
    });
    if (!response.ok) {
      logger.warn({ status: response.status, senderId: notice.senderId }, "Slack rate-limit notification failed");
      return "failed";
    }
    return "sent";
  } catch (error) {
    logger.warn({ error, senderId: notice.senderId }, "Slack rate-limit notification failed");
    return "failed";
  }
}
