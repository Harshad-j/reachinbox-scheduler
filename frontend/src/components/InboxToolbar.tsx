type Props = { query: string; onQueryChange: (value: string) => void; onRefresh: () => void };
export function InboxToolbar({ query, onQueryChange, onRefresh }: Props) {
  return <header className="toolbar">
    <label className="search"><span aria-hidden="true">⌕</span><input value={query} onChange={event => onQueryChange(event.target.value)} placeholder="Search emails, people, or subjects" aria-label="Search emails"/><kbd aria-hidden="true">⌘ K</kbd></label>
    <button className="icon-button" type="button" aria-label="Refresh inbox" title="Refresh" onClick={onRefresh}>↻</button>
    <span className="toolbar-divider" aria-hidden="true"/><span className="workspace-label"><i className="workspace-ready-dot"/>Workspace ready</span>
  </header>;
}
