# Decisions

- Use npm workspaces for a single repository with independently runnable frontend and backend packages.
- Redis persistence uses AOF with a named Docker volume.
- The UI follows the supplied ReachInbox reference: the login card is centered on white; the home view uses a compact sidebar and low-density mail rows; reading and composition use separate full-width views.
- Rate quotas are UTC calendar-hour windows and jobs reserve an ordered position in the next window with capacity.
- Slack uses OAuth `incoming-webhook` so the workspace user chooses the channel during consent; the webhook URL is AES-256-GCM encrypted.
- SMTP passwords are also stored AES-256-GCM encrypted; `ENCRYPTION_KEY` is a 32-byte hexadecimal key.
- SMTP and Postgres do not share a transaction, so exact-once mailbox delivery cannot be guaranteed. To avoid automatic duplicate retries after the SMTP boundary, the worker persists `smtpStartedAt`; ambiguous transport failures and stale in-flight SMTP attempts transition to `delivery_unknown` instead of being resent. This favors at-most-once automatic handling and can require operator review when provider acceptance is uncertain.
- Frontend screens use feature-level components for the mailbox sidebar, toolbar, email list, and composer. The desktop styling follows the reference's compact white inbox and green selection accents while keeping Google OAuth as the only supported sign-in method.
- The load harness schedules test rows seven days ahead, relays the actual outbox to BullMQ, exercises Redis Lua limits, and removes test data before the delayed jobs can run. The optional `--notify-slack` flag performs one live Slack notification and verifies the debounce key suppresses a second notification.
