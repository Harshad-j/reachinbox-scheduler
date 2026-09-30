type Sender = { id: string; isActive: boolean; circuitOpenUntil: Date | null };
export function selectSender<T extends Sender>(senders: T[], now = new Date(), cursor = 0): T {
  const healthy = senders.filter(sender => sender.isActive && (!sender.circuitOpenUntil || sender.circuitOpenUntil <= now));
  if (!healthy.length) throw new Error("No healthy senders available");
  return healthy[((cursor % healthy.length) + healthy.length) % healthy.length]!;
}
