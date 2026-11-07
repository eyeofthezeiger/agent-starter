---
name: weekly-metrics-summary
version: 0.1.0
owner: marketing-lead
status: draft
tier: draft
trigger: "Every Monday, or when someone shares the week's export"
inputs: [metrics_export]
---

## Steps
1. Read only the export the person provided. No other data sources.
2. Compare each metric to last week: up, down or flat, with the numbers.
3. Name the two biggest moves and one question worth asking about them.
4. Five bullets at most.

## Output
A draft summary in the requester's Slack DM for them to edit and share.

## Failure modes
- Explaining a change without evidence. Say "cause unknown" instead.

## Never
- Post to a channel, or include customer-level or personal data.
