import type { Folder, User } from "../types/mail";
type Props = { user: User; folder: Folder; scheduledCount: number; sentCount: number; slackConnected: boolean; slackTeamName?: string; onFolderChange: (folder: Folder) => void; onCompose: () => void; onSlackToggle: () => void; onLogout: () => void };
function initials(name: string): string { return name.trim().slice(0, 1).toUpperCase(); }
export function MailboxSidebar({ user, folder, scheduledCount, sentCount, slackConnected, slackTeamName, onFolderChange, onCompose, onSlackToggle, onLogout }: Props) {
  return <aside className="sidebar">
    <div className="brand-mark" aria-label="Outbox">ONB</div>
    <div className="profile" aria-label={`${user.name}, ${user.email}`}><span className="avatar">{user.avatarUrl ? <img src={user.avatarUrl} alt=""/> : initials(user.name)}</span><span className="profile-copy"><b>{user.name}</b><small>{user.email}</small></span></div>
    <button className="compose-side" onClick={onCompose}><span>＋</span> Compose</button>
    <div className="section-label">MAILBOX</div>
    <button className={`nav-item ${folder === "scheduled" ? "active" : ""}`} aria-current={folder === "scheduled" ? "page" : undefined} onClick={() => onFolderChange("scheduled")}><span className="nav-icon" aria-hidden="true">◷</span> Scheduled <small>{scheduledCount}</small></button>
    <button className={`nav-item ${folder === "sent" ? "active" : ""}`} aria-current={folder === "sent" ? "page" : undefined} onClick={() => onFolderChange("sent")}><span className="nav-icon" aria-hidden="true">↗</span> Sent <small>{sentCount}</small></button>
    <div className="sidebar-bottom"><div className="slack-card"><div><span className={`slack-dot ${slackConnected ? "connected" : ""}`}/><span>{slackConnected ? `Slack · ${slackTeamName ?? "Connected"}` : "Slack alerts"}</span></div><button onClick={onSlackToggle}>{slackConnected ? "Disconnect" : "Connect"}</button></div><button className="logout" onClick={onLogout}>↪ <span>Log out</span></button></div>
  </aside>;
}
