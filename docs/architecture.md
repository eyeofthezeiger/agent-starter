# Architecture

```
Slack (/ask, Send to queue,            Chrome extension
 buttons, App Home) -- Socket Mode     (side panel, right-click)
            |                                  |
            v                                  v
        slack-app  ------- HTTP + token ----> core (localhost:8787)
                                               |
                         gate (plain code: user group + source trust from agent.config.json)
                                               |
                         inbox_items (stored once by id) -- audit_log
                                               |
                         jobs (retry queue) -> triage (fake now, Claude later)
                                               |
                         pending_approval  --> owner approves in Slack or Chrome
                                               |
                         outbox (retry + backoff) -> Slack, Jira, messenger bus
                                               |
                         scheduler: hourly sweep, morning digest, retention

worker (profile "worker"): Claude Code headless, no prod creds,
egress only via the allowlist proxy, pushes only agent/* branches
```

## Rules the code enforces

- **The gate runs before any model.** Who asked, from where, and whether they're allowed is decided in `packages/core/src/gate.ts`. Message text can't change it.
- **Rejected requests keep metadata, not content.** `raw_text` is NULL for rejected records.
- **Agents propose, people approve.** Triage only proposes. Only approvers (`owner.slackUserId` and `team.approverSlackUserIds` in `agent.config.json`) can approve, checked in the core, not only in Slack.
- **Below the confidence threshold, ask.** Low-confidence items become `needs_answer`.
- **Every outgoing write goes through the outbox** with an idempotency key. Jira creates also carry a label, so a retry finds the existing issue.
- **The pause switch stops actions, not logging.** Jobs and the outbox stop; intake and the audit log keep going.
- **The audit log is append-only.** A trigger blocks updates and deletes, except the retention job's own transaction.
- **Retention:** inbox records, briefs, finished jobs, sent outbox rows and audit rows older than `RETENTION_DAYS` (90) are deleted daily.
- **Dry run by default.** `DRY_RUN=true` makes every sender log instead of send.

## Config

- `agent.config.json` (committed): owner, approvers, the Slack command, source trust, approval tiers, skill packs. Validated at startup by `packages/shared/src/agent-config.ts`; a bad value stops the process with the field that's wrong.
- `.env` (git-ignored) or a secrets manager: tokens, database URL, `DRY_RUN`, schedule and retention.
- `context/<name>.md` (git-ignored): what a person wrote about their role, people and priorities.

At startup the core copies `sources` into the `source_trust` table, so the gate always matches the config.

## Item states

`new` -> `pending_approval` | `needs_answer` | `context` | `fyi` | `dropped` -> `approved` | `rejected`

Jira tickets then follow your Jira workflow (Ready, In progress, Needs answer, Blocked/Failed, Needs approval, Done).

## Build order

1. Slack intake, gate, queue, approvals (no AI). Done here.
2. Chrome side panel and Send to queue. Done here.
3. Jira filing through the outbox. Done here (dry run until you set `DRY_RUN=false`).
4. Triage with Claude: implement `ClaudeTriage`, then run `npm run eval`. Last on purpose.
5. Calendar briefs, more sources, retrieval, the coding worker: later phases.
