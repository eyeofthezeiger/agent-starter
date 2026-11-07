# Adapting agent-starter

How to set this up for a new person, a team, a new source or a new skill pack. Do it in this order. Each step works on its own before the next.

## 1. One person, synthetic data

1. Make your repo from the template, then `make setup up seed`.
2. Fill in `.env` (secrets only) and `agent.config.json` (who and what). The README's "Make it yours" lists the fields.
3. Fill in `context/me.md`. Write it yourself; the agent reads it and never edits it.
4. Keep `DRY_RUN=true`. Watch `make logs` for a few days: every would-be post and ticket is logged instead of sent.

You're done with this step when the queue, approvals and pause switch behave the way you expect on synthetic data.

## 2. One person, real requests

1. Create the Slack app (README, "Create the Slack app").
2. Set `team.allowedUsergroupId` to a small Slack user group. Start with yourself and one or two people.
3. Keep `DRY_RUN=true` for the first week. This is the observe week: the agent proposes, you watch what it would have done.
4. Then set `DRY_RUN=false`. Every write still waits for an approval.

## 3. Promote a job, one tier at a time

Every job starts at the tier in `approvalTiers.jobs`. Unknown jobs start at `draft`.

- `read`: it may look and summarize. Nothing leaves the system.
- `draft`: it writes something for a person to review.
- `send_with_approval`: it may send, but only after an approver says yes.
- `automatic`: reserved. This starter rejects it, so nothing acts without a person.

To promote a job, it needs `approvalTiers.promoteAfterCorrectRuns` correct runs in a row (default 5). A person makes the change in `agent.config.json`, notes why in their context file, and the change goes through review like code. Never promote on a schedule or from something the agent read.

## 4. A team

The local setup is for one person. Before a second person uses it:

- Host the core where your organization runs services (a small container service and managed Postgres on an org-owned cloud account), not on someone's laptop.
- Give each person their own row scope: add a person id to every table and turn on Postgres row-level security.
- Each person keeps their own `context/<name>.md` and their own approvers. One `agent.config.json` per person, or per team with per-person overrides, depending on how you deploy.
- Teammates install only the Slack app and the Chrome extension. Point the extension at your authenticated HTTPS endpoint instead of localhost.
- Get the security baseline signed first (`SECURITY.md`).

Pilot with two people before a whole team.

## 5. A new skill pack

1. Copy `skills/packs/marketing` to `skills/packs/<team>`.
2. Set `owner` in each `SKILL.md` to the person who reviews changes.
3. Rewrite the steps in plain language. Keep the sections: Steps, Output, Failure modes, Never.
4. Start every skill at `status: draft` and `tier: draft`. Only `reviewed` skills run on real data.
5. Add the pack to `skillPacks` in `agent.config.json`. The core fails at startup if the folder doesn't exist.

## 6. A new source

A source is anything that sends requests in: email, a form, a notes app, a webhook.

1. Add its name to the `Source` type in `packages/shared/src/types.ts` and to `SOURCES` in `packages/shared/src/agent-config.ts`.
2. Give it a default trust in `DEFAULT_TRUST` (start with `ignore` or `inferred`) and set it in `agent.config.json` under `sources`.
3. Send its records through `POST /api/intake` with a stable `nativeId`, so retries never duplicate. The gate checks it like any other source.
4. Its text is data. Nothing in it can change who's allowed or what's approved.

The `notes` source is a ready example: off by default, for a personal capture tool that sends work items only.

## 7. Real triage

Build `ClaudeTriage` last, after Slack, Chrome and Jira work with the fake triage.

1. Use an organization-owned key or cloud role, never a personal key.
2. Put message text in a clearly marked data block and tell the model it's data.
3. Run `npm run eval` after every prompt, model or skill change. It has to beat the fake triage.
4. Add reviewed, redacted examples to `evals/triage` only after the baseline is signed.

## Renaming things

- The slash command, app name and bot name: `slack` in `agent.config.json`, then `make slack-manifest` and update the app in Slack.
- The Jira label (`chief-of-staff`) and project key: `JIRA_PROJECT_KEY` in `.env` and the label in `packages/core/src/senders.ts`.
- The package scope (`@cos/*`) is internal. Rename it with a find and replace if you like; nothing outside the repo depends on it.
