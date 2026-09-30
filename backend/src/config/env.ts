import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_ORIGIN: z.string().url().default("http://localhost:5173"),
  DATABASE_URL: z.string().url(), REDIS_URL: z.string().url(), ELASTICSEARCH_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32), GOOGLE_CLIENT_ID: z.string().default(""), GOOGLE_CLIENT_SECRET: z.string().default(""),
  GOOGLE_CALLBACK_URL: z.string().url(), ENCRYPTION_KEY: z.string().default(""),
  SLACK_CLIENT_ID:z.string().default(""), SLACK_CLIENT_SECRET:z.string().default(""), SLACK_CALLBACK_URL:z.string().url().optional(), API_PUBLIC_URL:z.string().url().default("http://localhost:4000"),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(10),
  MIN_DELAY_BETWEEN_SENDS_MS: z.coerce.number().int().nonnegative().default(2000),
  MAX_EMAILS_PER_HOUR_PER_SENDER: z.coerce.number().int().positive().default(200),
  MAX_EMAILS_PER_HOUR_GLOBAL: z.preprocess(value=>value===""?undefined:value,z.coerce.number().int().positive().optional()), MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  STUCK_TIMEOUT_MS: z.coerce.number().int().positive().default(300000), MAX_CONSECUTIVE_FAILURES: z.coerce.number().int().positive().default(5),
  CIRCUIT_OPEN_DURATION_MS:z.coerce.number().int().positive().default(900000), OUTBOX_RELAY_INTERVAL_MS:z.coerce.number().int().positive().default(1000), STUCK_SWEEP_INTERVAL_MS:z.coerce.number().int().positive().default(60000), RATE_LIMIT_TTL_MS:z.coerce.number().int().positive().default(7200000), MAX_RATE_WINDOW_PROBES:z.coerce.number().int().positive().max(168).default(48),
  API_RATE_LIMIT_PER_MINUTE:z.coerce.number().int().positive().default(120),
  SMTP_HOST:z.string().default(""), SMTP_PORT:z.preprocess(value=>value===""?undefined:value,z.coerce.number().int().min(1).max(65535).optional()), SMTP_USER:z.string().default(""), SMTP_PASSWORD:z.string().default(""), SMTP_FROM:z.string().email().or(z.literal("")).default(""),
}).superRefine((value,context)=>{
  const smtpFields=[value.SMTP_HOST, value.SMTP_PORT, value.SMTP_USER, value.SMTP_PASSWORD, value.SMTP_FROM];
  if(smtpFields.some(Boolean)&&!smtpFields.every(Boolean))context.addIssue({code:z.ZodIssueCode.custom,path:["SMTP_HOST"],message:"Configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM together."});
});
const parsed = schema.safeParse(process.env);
if (!parsed.success) { console.error("Invalid environment configuration", parsed.error.flatten().fieldErrors); process.exit(1); }
export const env = parsed.data;
