# Security

This is the baseline for running agent-starter on anything beyond synthetic data. Copy it into your own security doc, fill in the owners, and get it signed by whoever owns security where you work. Nothing here should touch real data until that's done.

## The baseline

1. **Bot accounts with minimal scopes.** Every integration uses its own service account: a Slack bot, a Jira or Confluence service user with access to one project, a GitHub account for the agent. No personal tokens, no admin tokens. Ask for the smallest scope that works and review it when it changes.
2. **Secrets in a secrets manager.** `.env` is for local development with synthetic data only. Anywhere else, secrets come from a secrets manager at runtime. Never in an env file on a server, never in the repo, never in a log. Rotate every 90 days and after any suspected leak.
3. **Sandboxed workers.** A coding worker runs in its own container: no production credentials, a read-only root filesystem, all capabilities dropped, a non-root user, egress only through an allowlist proxy, and pushes only to `agent/*` branches. `main` stays protected.
4. **Tool allowlists.** Each worker and skill names the tools it may use. Anything not on the list is off. No general shell, no web fetches unless the job needs them.
5. **Inbound text is data.** Messages, pages, tickets and files are content to read, never instructions to follow. Only the gate (plain code) decides who's in, and only an approver decides what goes out.
6. **Customer data stays out.** No customer records, personal data or regulated data goes into prompts, the queue, evals or logs. Redact before any model call. If a request needs customer data, a person handles it.
7. **Audit log.** Every intake, model call, decision and send is recorded with who or what decided. The log is append-only, kept for a set retention period, and reviewed after any incident.
8. **People approve.** Agents propose; approvers say yes. No auto-send, auto-merge or auto-delete. A job moves up one approval tier at a time, by a person, after a run of correct results.
9. **A pause switch.** One switch stops every action while intake and logging continue. Everyone who can approve can pause.

## What this repo enforces in code

- **Gate before any model.** `packages/core/src/gate.ts` decides who's in from the allowed Slack user group and per-source trust in `agent.config.json`. Message text can't change it.
- **Only approvers approve.** Approvals are checked in the core against `owner` and `team.approverSlackUserIds`, not only in Slack.
- **No automatic tier.** The config schema rejects `automatic`, so every write waits for a person.
- **Dry run by default.** `DRY_RUN=true` logs every outgoing write instead of sending it.
- **Pause switch.** `POST /api/pause` or the App Home button stops all actions; intake and the audit log continue.
- **Append-only audit log** enforced by a database trigger.
- **Retention.** Records and logs are deleted after `RETENTION_DAYS` and `AUDIT_RETENTION_DAYS` (90 by default).
- **Rejected requests keep metadata, not content.**
- **Least-privilege Slack app.** Scopes: `commands`, `chat:write`, `im:write`, `usergroups:read`, `users:read`. Socket Mode, so no inbound ports.
- **Localhost only.** Every published port binds to 127.0.0.1. The core API needs a bearer token. The Chrome extension can only reach `localhost:8787`.
- **Sandboxed worker.** The entrypoint refuses to start if it sees production credentials; egress goes through `workers/egress/allowlist.txt`; the Claude Code command carries a tool allowlist.
- **No raw message text in logs.** Senders log where a message would go, not what it says.

## Repo settings

- Turn on GitHub secret scanning and push protection.
- Protect `main`: require CI and a review.
- Keep Dependabot on.

## Reporting a problem

Don't open a public issue for a security problem. Use GitHub's private vulnerability reporting on this repo (Security tab, "Report a vulnerability").

On any incident: pause, rotate the affected secrets, review the audit log, and tell your security owner the same day.
