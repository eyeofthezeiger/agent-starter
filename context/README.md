# Per-person context

Each person who uses the system keeps one context file, written by them, not inferred by the agent.

1. Copy `person.template.md` to `context/me.md` (`make setup` does it), or to another name and set `owner.contextFile` in `agent.config.json`.
2. Fill it in. Keep it short.
3. It is git-ignored (only the template and this README are committed), because it holds real work context.

The chief of staff reads it for "what does urgent mean to this person" and "who matters". It never infers an org chart from messages.
