---
name: morning-digest
version: 0.1.0
owner: your-name
status: draft
tier: draft
trigger: "Daily at MORNING_DIGEST_AT in the owner's time zone"
inputs: [queue]
---

## Steps
1. Read the active queue and yesterday's FYIs.
2. Group: needs you today, FYI, can wait.
3. One line per item: what it is, a link back, and a one-line reason for its group.

## Output
A brief stored in `briefs` and sent to the owner's Slack DM through the outbox.
The v1 digest is built with plain code in `packages/core/src/digest.ts`; this skill describes the target.

## Failure modes
- An item that is both urgent and low confidence goes under "needs you today" with the question.

## Never
- Reply, mark read, file or move anything.
