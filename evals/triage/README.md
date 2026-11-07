# Triage eval set

`synthetic.jsonl` holds 20 made-up requests with the expected category and urgency. No real people, messages or customers.

- Run it: `npm run eval` (uses `TRIAGE_IMPL`, default `fake`).
- It prints category and urgency accuracy and every miss.
- Run it after every prompt, model or skill change. A drop is a regression.
- Add real, reviewed examples only after the security baseline is signed and you've chosen a redacted set.

The fake keyword triage is the baseline the real triage has to beat. It is not expected to score 100%.
