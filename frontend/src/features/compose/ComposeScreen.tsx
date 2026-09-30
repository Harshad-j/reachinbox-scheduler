import { useEffect, useRef } from "react";
import type { ChangeEvent, FormEvent, KeyboardEvent, MouseEvent } from "react";


type Props = {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onReset: () => void;
  isSubmitting: boolean;
  isSendersLoading: boolean;
  senderCount: number;
  previewOnly: boolean;
  availableSenderCount: number;
  isCreatingSender: boolean;
  onProvisionSender: () => void;
  recipients: string[];
  recipientInput: string;
  onRecipientInputChange: (value: string) => void;
  onAddRecipientText: (value: string) => void;
  onRemoveRecipient: (recipient: string) => void;
  onUpload: (file: File) => void;
  parseMessage: string;
  subject: string;
  onSubjectChange: (value: string) => void;
  startTime: string;
  onStartTimeChange: (value: string) => void;
  delay: string;
  onDelayChange: (value: string) => void;
  hourlyLimit: string;
  onHourlyLimitChange: (value: string) => void;
  body: string;
  onBodyChange: (value: string) => void;
};

export function ComposeScreen(props: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== props.body) editorRef.current.innerHTML = props.body;
  }, [props.body]);

  const runFormat = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    props.onBodyChange(editorRef.current?.innerHTML ?? "");
  };
  const preserveSelection = (event: MouseEvent<HTMLButtonElement>) => event.preventDefault();
  const toolbarButton = (label: string, command: string, icon: string) => <button type="button" className="format-button" aria-label={label} title={label} onMouseDown={preserveSelection} onClick={() => runFormat(command)}>{icon}</button>;
  const addLink = () => {
    const href = window.prompt("Enter a web address or email link");
    if (href && /^(https?:\/\/|mailto:)/i.test(href)) runFormat("createLink", href);
  };
  const handleRecipientKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (["Enter", ",", ";"].includes(event.key)) {
      event.preventDefault();
      props.onAddRecipientText(props.recipientInput);
    }
  };
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) props.onUpload(file);
    event.target.value = "";
  };

  return <div className="compose-screen"><form className="compose-window" onSubmit={props.onSubmit}>
    <div className="compose-top"><button type="button" className="back" onClick={props.onReset}>← <span>Compose New Email</span></button><div className="toolbar-spacer"/><span className="compose-draft-label">NEW MESSAGE</span><button type="button" className="close-compose" aria-label="Close composer" onClick={props.onReset}>×</button></div>
    <div className="compose-form">
      <div className="compose-heading"><p className="eyebrow">WRITE SOMETHING GOOD</p><h1>Compose new email</h1><p>One thoughtful message at a time.</p></div>
      {props.isSendersLoading ? <div className="sender-note">Checking your available senders…</div> : !props.senderCount ? <div className="sender-setup"><div><b>No sender is set up yet</b><p>Set up the SMTP sender from your environment, or create an Ethereal test sender. Ethereal messages are captured for preview and will not arrive in real inboxes.</p></div><button type="button" className="secondary-button" disabled={props.isCreatingSender} onClick={props.onProvisionSender}>{props.isCreatingSender ? "Setting up…" : "Set up sender"}</button></div> : !props.availableSenderCount ? <div className="sender-setup sender-warning"><div><b>Sender temporarily paused</b><p>All your configured senders are in their circuit recovery window. Try again after the displayed recovery time, or add another test sender.</p></div><button type="button" className="secondary-button" disabled={props.isCreatingSender} onClick={props.onProvisionSender}>{props.isCreatingSender ? "Setting up…" : "Add sender"}</button></div> : <div className="sender-note"><span className="status-dot"/> {props.senderCount} active sender{props.senderCount === 1 ? "" : "s"} · selected automatically in rotation<span className="sender-test-label">{props.previewOnly ? "ETHEREAL TEST DELIVERY — preview only" : "SMTP sender configured"}</span><button type="button" className="add-sender-button" disabled={props.isCreatingSender} onClick={props.onProvisionSender}>{props.isCreatingSender ? "Adding…" : "Add sender"}</button></div>}
      <section className="compose-address-fields" aria-label="Email recipients and subject">
        <div className="compose-recipient-row">
          <label htmlFor="recipient-addresses">To</label>
          <div className="recipient-field">
            {props.recipients.map(email => <span className="recipient-chip" key={email}>{email}<button type="button" aria-label={`Remove ${email}`} onClick={() => props.onRemoveRecipient(email)}>×</button></span>)}
            <input id="recipient-addresses" aria-label="Recipient email addresses" value={props.recipientInput} onChange={event => props.onRecipientInputChange(event.target.value)} onKeyDown={handleRecipientKeyDown} onBlur={() => { if (props.recipientInput.trim()) props.onAddRecipientText(props.recipientInput); }} placeholder={props.recipients.length ? "Add another recipient…" : "name@example.com · press Enter to add"}/>
            <label className="upload-link">↑ Upload List<input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={handleFileChange}/></label>
          </div>
        </div>
        <div className="compose-subject-row">
          <label htmlFor="compose-subject">Subject</label>
          <input id="compose-subject" value={props.subject} onChange={event => props.onSubjectChange(event.target.value)} placeholder="Give your email a subject" required maxLength={998}/>
        </div>
      </section>
      {props.parseMessage && <p className="file-warning" role="status">{props.parseMessage}</p>}{props.recipients.length > 0 && <p className="recipient-summary">{props.recipients.length} unique recipient{props.recipients.length === 1 ? "" : "s"} ready to receive this email</p>}
      <div className="schedule-panel"><div className="schedule-panel-heading"><span className="schedule-clock">◷</span><div><b>Send later</b><small>Choose when your emails should go out.</small></div></div><div className="schedule-options"><label>Start date &amp; time<input type="datetime-local" value={props.startTime} onChange={event => props.onStartTimeChange(event.target.value)} required/></label><label>Delay between emails <span className="input-with-unit"><input type="number" min="0" step="1" value={props.delay} onChange={event => props.onDelayChange(event.target.value)}/><small>seconds</small></span></label><label>Hourly limit <span className="input-with-unit"><input type="number" min="1" step="1" value={props.hourlyLimit} onChange={event => props.onHourlyLimitChange(event.target.value)}/><small>optional</small></span></label></div></div>
      <label className="body-label" htmlFor="message-body">Message</label>
      <div className="editor"><div className="editor-tools" role="toolbar" aria-label="Message formatting">
        {toolbarButton("Undo", "undo", "↶")}{toolbarButton("Redo", "redo", "↷")}<span className="format-divider"/>
        {toolbarButton("Bold", "bold", "B")}{toolbarButton("Italic", "italic", "I")}{toolbarButton("Underline", "underline", "U")}{toolbarButton("Strikethrough", "strikeThrough", "S")}<span className="format-divider"/>
        {toolbarButton("Bulleted list", "insertUnorderedList", "• List")}{toolbarButton("Numbered list", "insertOrderedList", "1. List")}<span className="format-divider"/>
        {toolbarButton("Align left", "justifyLeft", "☰")}{toolbarButton("Align center", "justifyCenter", "≡")}{toolbarButton("Align right", "justifyRight", "☷")}<button type="button" className="format-button" aria-label="Insert link" title="Insert link" onMouseDown={preserveSelection} onClick={addLink}>↗</button>
        <span className="toolbar-spacer"/><span>{props.body.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").length} characters</span>
      </div><div id="message-body" ref={editorRef} className="editor-content" contentEditable role="textbox" aria-label="Email body" aria-multiline="true" data-placeholder="Hi there,&#10;&#10;Write your message…" onInput={() => props.onBodyChange(editorRef.current?.innerHTML ?? "")} onPaste={event => { event.preventDefault(); document.execCommand("insertText", false, event.clipboardData.getData("text/plain")); }}/></div>
      <div className="compose-footer"><span><span className="secure-icon">✓</span> Your message is saved securely</span><div><button type="button" className="secondary-button" onClick={props.onReset}>Cancel</button><button className="primary-button" type="submit" disabled={props.isSubmitting || !props.availableSenderCount}>{props.isSubmitting ? <><span className="button-spinner"/> Scheduling…</> : <>Send Later <span>→</span></>}</button></div></div>
    </div>
  </form></div>;
}
