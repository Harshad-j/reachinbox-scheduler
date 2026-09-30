import type { EmailRow, Folder } from "../types/mail";


type Props = { rows: EmailRow[]; folder: Folder; query: string; isLoading: boolean; isError: boolean; errorMessage?: string; onSelect: (row: EmailRow) => void; onRetry: () => void };
function displayTime(row: EmailRow, folder: Folder): string { const date = folder === "sent" && row.sentAt ? row.sentAt : row.scheduledAt; return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(date)); }
export function EmailList({ rows, folder, query, isLoading, isError, errorMessage, onSelect, onRetry }: Props) {
  if (isLoading) return <div className="email-list" aria-label="Loading emails">{Array.from({ length: 5 }, (_, index) => <div className="skeleton-row" key={index}><i/><i/><i/></div>)}</div>;
  if (isError) return <div className="state-card"><span className="state-icon">!</span><h2>We couldn’t load your emails</h2><p>{errorMessage}</p><button className="secondary-button" onClick={onRetry}>Try again</button></div>;
  if (!rows.length) return <div className="state-card empty-state"><span className="empty-illustration">{folder === "scheduled" ? "◷" : "↗"}</span><h2>{query ? "No matching emails" : `Your ${folder} inbox is clear`}</h2><p>{query ? "Try another name, email address, or subject." : folder === "scheduled" ? "When you schedule an email, it will show up here." : "Sent and delivered emails will appear here."}</p></div>;
  return <div className="email-list">{rows.map(row => {
    const excerpt = row.body.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    return <button className={`email-row ${folder}-row`} key={row.id} onClick={() => onSelect(row)}>
      <span className="email-person"><strong>To: {row.recipient}</strong></span>
      <span className="email-content">{folder === "scheduled" ? <span className="email-time">◷ {displayTime(row, folder)}</span> : <span className={`status-badge ${row.status}`}>{row.status === "sent" ? "Sent" : row.status === "delivery_unknown" ? "Needs review" : "Failed"}</span>}<span className="email-subject"><b>{row.subject}</b>{folder === "scheduled" && <span className="scheduled-word"> - {row.status === "sending" ? "Sending" : "Scheduled"}</span>}<span className="email-excerpt">{excerpt ? ` - ${excerpt}` : ""}</span></span></span>
      <span className="email-star" aria-hidden="true">☆</span>
    </button>;
  })}</div>;
}
