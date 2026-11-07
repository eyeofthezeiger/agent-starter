---
name: launch-checklist
version: 0.1.0
owner: marketing-lead
status: draft
tier: draft
trigger: "A feature ticket moves to Ready for launch, or someone asks for a launch checklist"
inputs: [jira_key, launch_date]
---

## Steps
1. Read the ticket and its linked docs.
2. Draft the checklist: release notes, docs update, in-app copy, social post, sales enablement note, support FAQ.
3. Give each item an owner placeholder and a due date counted back from the launch date.
4. Flag anything the ticket doesn't answer (pricing, availability, screenshots).

## Output
A draft checklist as a Jira comment on the ticket, or a Confluence page if the requester asks.

## Never
- Assign real people or change ticket status.
- Announce the launch anywhere.
