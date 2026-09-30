const ambiguousNetworkCodes = new Set(["ETIMEDOUT", "ECONNECTION", "ESOCKET", "ECONNRESET", "EPIPE"]);

export function isAmbiguousSmtpFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; responseCode?: unknown };
  return !candidate.responseCode && typeof candidate.code === "string" && ambiguousNetworkCodes.has(candidate.code);
}

export function interruptedSendStatus(smtpStartedAt: Date | null): "scheduled" | "delivery_unknown" {
  return smtpStartedAt ? "delivery_unknown" : "scheduled";
}
