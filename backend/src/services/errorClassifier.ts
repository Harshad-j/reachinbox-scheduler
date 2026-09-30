export type DeliveryError = { transient: boolean; message: string };
export function classifyDeliveryError(error: unknown): DeliveryError {
  const candidate = typeof error === "object" && error !== null ? error as { code?: string; responseCode?: number; message?: string } : {};
  const code = candidate.code ?? ""; const responseCode = candidate.responseCode ?? 0;
  const permanent = responseCode >= 500 || ["EENVELOPE", "EMESSAGE", "EINVALIDRECIPIENT"].includes(code);
  return { transient: !permanent, message: candidate.message ?? String(error) };
}
