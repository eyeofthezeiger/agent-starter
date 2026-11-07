---
name: campaign-brief
version: 0.1.0
owner: marketing-lead
status: draft
tier: draft
trigger: "Someone asks for a campaign brief"
inputs: [goal, audience, channels, deadline, budget_range]
---

## Steps
1. If goal, audience or deadline is missing, ask one question for the missing piece. Don't guess.
2. Write the brief: goal, audience, key message, channels, timeline, success metric, open questions.
3. Pull product facts only from the linked ticket or doc. Cite each one.
4. Keep it to one page.

## Output
A draft doc in the team's Confluence space, linked in the requester's Slack thread.

## Failure modes
- Invented claims about the product. Every claim needs a citation or goes under open questions.

## Never
- Publish, schedule posts, email customers or spend budget.
- Use customer data or names.
