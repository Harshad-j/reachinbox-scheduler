import { FormEvent, useMemo, useState } from "react";
import Papa from "papaparse";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "../lib/api";
import { parseRecipientCells } from "../lib/recipients";
import { EmailList } from "../components/EmailList";
import { InboxToolbar } from "../components/InboxToolbar";
import { MailboxSidebar } from "../components/MailboxSidebar";
import { ComposeScreen } from "../features/compose/ComposeScreen";
import type { EmailPage, EmailRow, Folder, SenderList, SlackStatus, ToastState, User } from "../types/mail";

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map(part => part[0] ?? "").join("").toUpperCase();
}

function displayTime(row: EmailRow, folder: Folder): string {
  const date = folder === "sent" && row.sentAt ? row.sentAt : row.scheduledAt;
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(date));
}

function plainText(value: string): string { return new DOMParser().parseFromString(value, "text/html").body.textContent ?? ""; }
function sanitizeEmailHtml(value: string): string {
  const allowed = new Set(["P", "DIV", "BR", "STRONG", "B", "EM", "I", "U", "S", "UL", "OL", "LI", "BLOCKQUOTE", "A"]);
  const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const clean = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return escape(node.textContent ?? "");
    if (!(node instanceof Element)) return "";
    const tag = node.tagName; const children = Array.from(node.childNodes).map(clean).join("");
    if (!allowed.has(tag)) return children;
    if (tag === "BR") return "<br>";
    if (tag === "A") { const href = node.getAttribute("href") ?? ""; return /^(https?:\/\/|mailto:)/i.test(href) ? `<a href="${escape(href)}" rel="noopener noreferrer">${children}</a>` : children; }
    const alignment = tag === "P" || tag === "DIV" ? node.getAttribute("style")?.match(/text-align\s*:\s*(left|center|right|justify)/i)?.[1] : undefined;
    const safeStyle = alignment ? ` style="text-align: ${alignment.toLowerCase()}"` : "";
    return `<${tag.toLowerCase()}${safeStyle}>${children}</${tag.toLowerCase()}>`;
  };
  const parsed = new DOMParser().parseFromString(value, "text/html");
  return Array.from(parsed.body.childNodes).map(clean).join("");
}
export default function App() {
  const client = useQueryClient();
  const [folder, setFolder] = useState<Folder>("scheduled");
  const [page, setPage] = useState(1);
  const [compose, setCompose] = useState(false);
  const [selected, setSelected] = useState<EmailRow | null>(null);
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState<ToastState>(null);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [recipientInput, setRecipientInput] = useState("");
  const [parseMessage, setParseMessage] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [delay, setDelay] = useState("2");
  const [hourlyLimit, setHourlyLimit] = useState("");
  const [startTime, setStartTime] = useState(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  const [submitting, setSubmitting] = useState(false);
  const [creatingSender, setCreatingSender] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [loginNotice, setLoginNotice] = useState("");

  const me = useQuery({ queryKey: ["me"], queryFn: () => request<{ user: User | null }>("/api/auth/me"), retry: false });
  const user = me.data?.user ?? null;
  const scheduledTotal = useQuery({ queryKey: ["email-count", "scheduled"], enabled: !!user, queryFn: () => request<EmailPage>("/api/emails/scheduled?status=all&page=1&pageSize=1"), refetchInterval: 10_000 });
  const sentTotal = useQuery({ queryKey: ["email-count", "sent"], enabled: !!user, queryFn: () => request<EmailPage>("/api/emails/sent?status=all&page=1&pageSize=1"), refetchInterval: 10_000 });
  const emails = useQuery({
    queryKey: ["emails", folder, query, page], enabled: !!user,
    queryFn: () => request<EmailPage>(query.trim()
      ? `/api/emails/search?q=${encodeURIComponent(query.trim())}&status=${folder}&page=${page}&pageSize=50`
      : `/api/emails/${folder}?status=all&page=${page}&pageSize=50`),
    refetchInterval: 10_000,
  });
  const slack = useQuery({ queryKey: ["slack"], enabled: !!user, queryFn: () => request<SlackStatus>("/api/slack/status") });
  const senders = useQuery({ queryKey: ["senders"], enabled: !!user, queryFn: () => request<SenderList>("/api/senders") });
  const rows = useMemo(() => emails.data?.items ?? [], [emails.data]);
  const availableSenderCount = senders.data?.items.filter(sender => !sender.circuitOpenUntil || new Date(sender.circuitOpenUntil).getTime() <= Date.now()).length ?? 0;
  const count = emails.data?.total ?? rows.length;
  const pageCount = Math.max(1, Math.ceil(count / 50));

  function notify(message: string, kind: "success" | "error" = "success"): void {
    setToast({ message, kind });
    window.setTimeout(() => setToast(null), 4000);
  }

  function openCompose(): void { setCompose(true); setSelected(null); }
  function resetComposer(): void {
    setCompose(false); setRecipients([]); setRecipientInput(""); setParseMessage(""); setSubject(""); setBody(""); setDelay("2"); setHourlyLimit("");
    setIdempotencyKey(crypto.randomUUID());
  }

  function addRecipientText(value: string): void {
    const parsed = parseRecipientCells([value]);
    setRecipients(current => [...new Set([...current, ...parsed.recipients])]);
    setRecipientInput("");
    setParseMessage(parsed.invalidCount ? `${parsed.invalidCount} invalid or repeated address${parsed.invalidCount === 1 ? "" : "es"} skipped.` : "");
  }

  function upload(file: File): void {
    Papa.parse<string[]>(file, { skipEmptyLines: true, complete: result => {
      const parsed = parseRecipientCells(result.data.flat());
      setRecipients(current => [...new Set([...current, ...parsed.recipients])]);
      setParseMessage(`${parsed.recipients.length} valid addresses added${parsed.invalidCount ? ` · ${parsed.invalidCount} invalid or repeated entries skipped` : ""}.`);
    }, error: () => setParseMessage("We couldn’t read that file. Try a CSV or text file.") });
  }

  async function schedule(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const parsed = parseRecipientCells([recipientInput]);
    const list = [...new Set([...recipients, ...parsed.recipients])];
    if (!list.length || parsed.invalidCount || !subject.trim() || !plainText(body).trim()) {
      setParseMessage(!subject.trim() ? "Add a subject before scheduling." : !plainText(body).trim() ? "Add a message before scheduling." : "Check the recipient addresses and try again.");
      return;
    }
    if (!Number.isFinite(Number(delay)) || Number(delay) < 0 || !startTime) { setParseMessage("Check the start time and delay values."); return; }
    setSubmitting(true);
    try {
      const result = await request<{ totalCount: number }>("/api/schedule", { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify({ recipients: list, subject: subject.trim(), body, startTime: new Date(startTime).toISOString(), delayBetweenMs: Math.round(Number(delay) * 1000), ...(hourlyLimit ? { hourlyLimit: Number(hourlyLimit) } : {}) }) });
      resetComposer(); setFolder("scheduled"); setPage(1); setSelected(null); await client.invalidateQueries({ queryKey: ["emails"] }); await client.invalidateQueries({ queryKey: ["email-count"] }); notify(`${result.totalCount} email${result.totalCount === 1 ? "" : "s"} scheduled successfully.`);
    } catch (error) { notify(error instanceof Error ? error.message : "Could not schedule emails.", "error"); }
    finally { setSubmitting(false); }
  }

  async function updateBatch(action: "pause" | "resume" | "cancel"): Promise<void> {
    if (!selected) return;
    try {
      await request(`/api/batches/${encodeURIComponent(selected.batchId)}/${action}`, { method: "POST" });
      await client.invalidateQueries({ queryKey: ["emails"] });
      setSelected(current => current ? { ...current, batch: { status: action === "pause" ? "paused" : action === "cancel" ? "cancelled" : "active" } } : current);
      notify(action === "cancel" ? "The scheduled batch was cancelled." : `The batch was ${action}d.`);
    } catch (error) { notify(error instanceof Error ? error.message : `Could not ${action} this batch.`, "error"); }
  }

  async function provisionSender(): Promise<void> {
    setCreatingSender(true);
    try {
      const result = await request<{ sender: { email: string }; deliveryMode: "preview" | "smtp" }>("/api/senders/setup", { method: "POST" });
      await client.invalidateQueries({ queryKey: ["senders"] });
      notify(result.deliveryMode === "preview" ? `Ethereal test sender ${result.sender.email} is ready. Messages open in preview only.` : `SMTP sender ${result.sender.email} verified and ready for delivery.`);
    } catch (error) { notify(error instanceof Error ? error.message : "Could not create a test sender.", "error"); }
    finally { setCreatingSender(false); }
  }

  async function toggleSlack(): Promise<void> {
    try {
      if (slack.data?.connected) { await request<void>("/api/slack/disconnect", { method: "DELETE" }); await slack.refetch(); notify("Slack disconnected."); }
      else window.location.href = "/api/slack/connect";
    } catch (error) { notify(error instanceof Error ? error.message : "Slack update failed.", "error"); }
  }

  async function logout(): Promise<void> {
    await request<void>("/api/auth/logout", { method: "POST" });
    await client.clear(); await me.refetch();
  }

  if (me.isLoading) return <main className="auth-state"><div className="loader"/><span>Loading your workspace…</span></main>;
  if (!user) return <main className="login-page"><section className="login-card"><h1>Login</h1><a className="google" href="/api/auth/google"><span className="google-g" aria-hidden="true">G</span><span>Login with Google</span></a><div className="login-divider"><span>or sign up through email</span></div><form className="email-login" onSubmit={event => { event.preventDefault(); setLoginNotice("Email and password sign-in is not configured. Please continue with Google."); }}><input type="email" aria-label="Email ID" placeholder="Email ID" autoComplete="email" required/><input type="password" aria-label="Password" placeholder="Password" autoComplete="current-password" required/><button className="login-submit" type="submit">Login</button>{loginNotice && <p className="login-notice" role="status">{loginNotice}</p>}</form></section></main>;

  return <main className="app-shell">
    <MailboxSidebar user={user} folder={folder} scheduledCount={scheduledTotal.data?.total ?? 0} sentCount={sentTotal.data?.total ?? 0} slackConnected={slack.data?.connected ?? false} slackTeamName={slack.data?.connection?.teamName} onFolderChange={value => { setFolder(value); setPage(1); setSelected(null); }} onCompose={openCompose} onSlackToggle={() => void toggleSlack()} onLogout={() => void logout()}/>
    <section className="main-panel">
      <InboxToolbar query={query} onQueryChange={value => { setQuery(value); setPage(1); }} onRefresh={() => void emails.refetch()}/>
      {selected ? <article className="email-detail">
        <div className="detail-heading"><button className="back-icon" onClick={() => setSelected(null)} aria-label="Back to inbox">←</button><div className="detail-title"><h1>{selected.subject}</h1><span className={`status-badge ${selected.status}`}>{selected.status}</span></div><div className="toolbar-spacer"/><span className="detail-date">{displayTime(selected, folder)}</span>{folder === "scheduled" && selected.batchId && (selected.batch?.status ?? selected.batchStatus) !== "cancelled" && (selected.batch?.status ?? selected.batchStatus) !== "completed" && <div className="batch-actions">{(selected.batch?.status ?? selected.batchStatus) === "paused" ? <button onClick={() => void updateBatch("resume")}>Resume batch</button> : <button onClick={() => void updateBatch("pause")}>Pause batch</button>}<button className="cancel-batch" onClick={() => void updateBatch("cancel")}>Cancel batch</button></div>}</div>
        <div className="message-head"><span className="avatar avatar-sender">{initials(user.name)}</span><div><b>{user.name}</b><small>{user.email}</small><p>to <strong>{selected.recipient}</strong></p></div><span className="message-recipient">{selected.recipient}</span></div>
        <div className="message-body"><div dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(selected.body) }}/>{selected.lastError && <div className="error-detail"><b>Delivery needs review</b><span>{selected.lastError}</span></div>}{selected.previewUrl && <a className="preview-link" href={selected.previewUrl} target="_blank" rel="noreferrer">Open email preview <span>↗</span></a>}</div>
      </article> : <>
        <div className="inbox-heading"><div><p className="eyebrow">YOUR MAILBOX</p><h1>{folder === "scheduled" ? "Scheduled" : "Sent"}<span className="heading-count">{count}</span></h1><p className="heading-description">{folder === "scheduled" ? "A clear view of the next queued emails." : "A record of your sent messages."}</p></div></div>
        <div className="list-toolbar"><div className="list-title"><span className="list-title-icon">{folder === "scheduled" ? "◷" : "↗"}</span><span>{folder === "scheduled" ? "Scheduled emails" : "Sent emails"}</span></div><span className="list-subtitle">{emails.isFetching ? "Updating…" : `${count} ${count === 1 ? "message" : "messages"}`}</span><button className="subtle-button" onClick={() => void emails.refetch()}>↻ <span>Refresh</span></button></div>
        <EmailList rows={rows} folder={folder} query={query} isLoading={emails.isLoading} isError={emails.isError} errorMessage={emails.error?.message} onSelect={setSelected} onRetry={() => void emails.refetch()}/>
        {pageCount > 1 && <div className="pagination"><span>Showing {(page - 1) * 50 + 1}–{Math.min(page * 50, count)} of {count}</span><div><button disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>← Previous</button><span>Page {page} of {pageCount}</span><button disabled={page >= pageCount} onClick={() => setPage(value => Math.min(pageCount, value + 1))}>Next →</button></div></div>}
      </>}
    </section>
    {compose && <ComposeScreen onSubmit={event => void schedule(event)} onReset={resetComposer} isSubmitting={submitting} isSendersLoading={senders.isLoading} senderCount={senders.data?.total ?? 0} previewOnly={senders.data?.items.every(sender => sender.deliveryMode === "preview") ?? false} availableSenderCount={availableSenderCount} isCreatingSender={creatingSender} onProvisionSender={() => void provisionSender()} recipients={recipients} recipientInput={recipientInput} onRecipientInputChange={setRecipientInput} onAddRecipientText={addRecipientText} onRemoveRecipient={recipient => setRecipients(current => current.filter(value => value !== recipient))} onUpload={upload} parseMessage={parseMessage} subject={subject} onSubjectChange={setSubject} startTime={startTime} onStartTimeChange={setStartTime} delay={delay} onDelayChange={setDelay} hourlyLimit={hourlyLimit} onHourlyLimitChange={setHourlyLimit} body={body} onBodyChange={setBody}/>}
    {toast && <div className={`toast ${toast.kind}`} role="status"><span>{toast.kind === "success" ? "✓" : "!"}</span>{toast.message}<button onClick={() => setToast(null)} aria-label="Dismiss notification">×</button></div>}
  </main>;
}
