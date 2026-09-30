import { Router } from "express";
import nodemailer from "nodemailer";
import { prisma } from "../../db/index.js";
import { encryptSecret } from "../../services/crypto.js";
import { env } from "../../config/env.js";
import { logger } from "../../logger/index.js";

export const sendersRouter = Router();

function smtpFailure(error: unknown): { code: string; message: string; diagnostic: { code?: string; command?: string; responseCode?: number } } {
  const detail = typeof error === "object" && error !== null ? error as { code?: unknown; command?: unknown; responseCode?: unknown } : {};
  const code = typeof detail.code === "string" ? detail.code : "UNKNOWN";
  const responseCode = typeof detail.responseCode === "number" ? detail.responseCode : undefined;
  const diagnostic = { code, ...(typeof detail.command === "string" ? { command: detail.command } : {}), ...(responseCode ? { responseCode } : {}) };
  if (code === "EAUTH" || responseCode === 534 || responseCode === 535) return { code: "SMTP_AUTH_FAILED", message: "The SMTP server rejected the login. Use the full mailbox address and an app-specific password or provider SMTP token, not your normal account password.", diagnostic };
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return { code: "SMTP_HOST_NOT_FOUND", message: "The SMTP host could not be resolved. Check SMTP_HOST and the API container’s DNS or internet access.", diagnostic };
  if (["ETIMEDOUT", "ECONNECTION", "ESOCKET", "ECONNREFUSED", "ECONNRESET"].includes(code)) return { code: "SMTP_CONNECTION_FAILED", message: "The API could not connect to the SMTP server. Check SMTP_HOST and SMTP_PORT and allow outbound SMTP traffic from Docker.", diagnostic };
  if (responseCode && responseCode >= 500) return { code: "SMTP_PROVIDER_REJECTED", message: "The SMTP provider rejected the sender configuration. Check that SMTP_FROM is verified and permitted for this account.", diagnostic };
  return { code: "SMTP_VERIFICATION_FAILED", message: "SMTP verification failed. Check your provider’s host, port, TLS mode, authentication method, and sender policy.", diagnostic };
}

sendersRouter.get("/", async (req, res, next) => {
  try {
    const userId = (req.user as { id: string }).id;
    const items = await prisma.sender.findMany({
      where: { isActive: true, OR: [{ userId }, { userId: null }] },
      select: { id: true, email: true, smtpHost: true, circuitOpenUntil: true, consecutiveFailures: true },
      orderBy: { createdAt: "asc" },
    });
    res.json({ items: items.map(({ smtpHost, ...sender }) => ({ ...sender, deliveryMode: smtpHost.toLowerCase().includes("ethereal.email") ? "preview" : "smtp" })), total: items.length });
  } catch (error) { next(error); }
});

sendersRouter.post("/setup", async (req, res) => {
  try {
    if (env.ENCRYPTION_KEY.length !== 64 || !/^[a-f\d]{64}$/i.test(env.ENCRYPTION_KEY)) {
      res.status(503).json({ error: { code: "SENDER_ENCRYPTION_NOT_CONFIGURED", message: "Set a valid 64-character hexadecimal ENCRYPTION_KEY, then restart the API." } });
      return;
    }
    const userId = (req.user as { id: string }).id;
    const hasConfiguredSmtp = Boolean(env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASSWORD && env.SMTP_FROM);
    const account = hasConfiguredSmtp ? null : await nodemailer.createTestAccount();
    const smtpHost = env.SMTP_HOST || account!.smtp.host;
    const smtpPort = env.SMTP_PORT || account!.smtp.port;
    const smtpUser = env.SMTP_USER || account!.user;
    const smtpPass = env.SMTP_PASSWORD || account!.pass;
    const fromEmail = env.SMTP_FROM || account!.user;
    if (hasConfiguredSmtp) {
      const existing = await prisma.sender.findFirst({ where: { email: fromEmail, OR: [{ userId }, { userId: null }] }, select: { id: true, email: true, isActive: true } });
      if (existing?.isActive) { res.status(200).json({ sender: existing, deliveryMode: "smtp", alreadyConfigured: true }); return; }
      const transport = nodemailer.createTransport({ host: smtpHost, port: smtpPort, secure: smtpPort === 465, auth: { user: smtpUser, pass: smtpPass } });
      try { await transport.verify(); } finally { transport.close(); }
    }
    const sender = await prisma.sender.upsert({ where: { email: fromEmail }, update: {
      smtpHost, smtpPort, smtpUser, smtpPass: encryptSecret(smtpPass), isActive: true, consecutiveFailures: 0, circuitOpenUntil: null,
    }, create: {
      userId: env.SMTP_HOST ? null : userId,
      email: fromEmail,
      smtpHost,
      smtpPort,
      smtpUser,
      smtpPass: encryptSecret(smtpPass),
      isActive: true,
    }, select: { id: true, email: true, isActive: true } });
    res.status(201).json({ sender, deliveryMode: hasConfiguredSmtp ? "smtp" : "preview" });
  } catch (error) {
    if (env.SMTP_HOST) {
      const failure = smtpFailure(error);
      logger.warn({ ...failure.diagnostic }, "Unable to verify configured SMTP sender");
      // SMTP verification failures are otherwise opaque from the browser. Return
      // only the non-secret transport diagnostic so the user can distinguish
      // authentication, DNS, and connection failures without exposing config.
      res.status(503).json({ error: { code: failure.code, message: failure.message, diagnostic: failure.diagnostic } });
    } else {
      logger.warn({ errorCode: typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "UNKNOWN" }, "Unable to provision Ethereal test sender");
      res.status(503).json({ error: { code: "ETHEREAL_UNAVAILABLE", message: "Could not create an Ethereal test sender. Check that the API container can reach Ethereal over the internet, then try again." } });
    }
  }
});
