ALTER TYPE "EmailStatus" ADD VALUE IF NOT EXISTS 'delivery_unknown';
ALTER TABLE "Email" ADD COLUMN "smtpStartedAt" TIMESTAMP(3);
