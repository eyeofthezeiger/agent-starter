import { createTriage } from "./triage/index.ts";
import { loadEvalSet, runTriageEval } from "./evalset.ts";

const triage = createTriage({
  TRIAGE_IMPL: process.env.TRIAGE_IMPL === "claude" ? "claude" : "fake",
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  ANTHROPIC_MODEL_TRIAGE: process.env.ANTHROPIC_MODEL_TRIAGE,
});

const report = await runTriageEval(triage, await loadEvalSet());
const pct = (n: number) => `${Math.round(n * 100)}%`;
console.log(`triage=${triage.name} cases=${report.total} category=${pct(report.categoryAccuracy)} urgency=${pct(report.urgencyAccuracy)}`);
for (const m of report.misses) console.log(`  miss ${m.id} ${m.field}: expected ${m.expected}, got ${m.got}`);
