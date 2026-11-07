---
name: meeting-brief
version: 0.1.0
owner: your-name
status: draft
tier: draft
trigger: "30 minutes before a meeting on the owner's calendar"
inputs: [event, attendees, recent_threads, open_tickets, agenda_doc]
---

## Steps
1. Skip solo blocks, declined events and anything marked private.
2. List attendees and the owner's recent Slack threads, Jira tickets and docs with each.
3. List open loops: what the owner owes them and what they owe the owner.
4. Summarize the agenda doc if one exists. Say "no agenda" if not.
5. Name the prep still to do.

## Output
A brief in the owner's Slack DM. Not built yet: needs the calendar source (Phase 2).

## Never
- Accept, decline, move or create events.
- Infer the org chart from messages. Use the context file.
