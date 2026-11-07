import { describe, expect, it } from "vitest";
import { FakeTriage, createTriage } from "../src/triage/index.ts";
import { loadEvalSet, runTriageEval } from "../src/evalset.ts";
import { planFromClassification } from "../src/inbox.ts";

const t = new FakeTriage();
const input = (text: string) => ({ id: "x", source: "seed", author: "U1", text });

describe("fake triage", () => {
  it("classifies a direct ask as a work task with urgency", async () => {
    const c = await t.classify(input("Can you fix the login bug today?"));
    expect(c.category).toBe("work_task");
    expect(c.urgency).toBe("today");
    expect(c.confidence).toBeGreaterThan(0.7);
  });

  it("drops short pleasantries", async () => {
    expect((await t.classify(input("thanks!"))).category).toBe("ignore");
  });

  it("returns low confidence when nothing matches", async () => {
    expect((await t.classify(input("Saw the numbers."))).confidence).toBeLessThan(0.7);
  });

  it("extracts a title and a cited action item", async () => {
    const text = "Could you update the README by Friday? It is out of date.";
    const x = await t.extract(input(text));
    expect(x.title).toBe("Could you update the README by Friday?");
    const item = x.actionItems[0]!;
    expect(text.slice(item.citation.start, item.citation.end)).toBe(item.text);
  });

  it("runs the synthetic eval set end to end", async () => {
    const cases = await loadEvalSet();
    expect(cases).toHaveLength(20);
    const report = await runTriageEval(t, cases);
    expect(report.total).toBe(20);
    // Baseline only. The real triage must beat it.
    expect(report.categoryAccuracy).toBeGreaterThanOrEqual(0.5);
  });

  it("refuses to build the Claude triage without a key", () => {
    expect(() => createTriage({ TRIAGE_IMPL: "claude", ANTHROPIC_API_KEY: "", ANTHROPIC_MODEL_TRIAGE: "m" })).toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe("planFromClassification", () => {
  it("asks the owner below the threshold instead of guessing", () => {
    const p = planFromClassification({ category: "work_task", urgency: "today", confidence: 0.5, reason: "r" }, 0.7, "t");
    expect(p.status).toBe("needs_answer");
    expect(p.action?.kind).toBe("ask_owner");
  });

  it("proposes a Jira ticket that waits for approval", () => {
    const p = planFromClassification({ category: "work_task", urgency: "later", confidence: 0.9, reason: "r" }, 0.7, "Fix it");
    expect(p).toEqual({ status: "pending_approval", action: { kind: "jira.create_issue", summary: "Create Jira ticket: Fix it", tier: "send_with_approval" } });
  });

  it("records the tier set in agent.config.json", () => {
    const p = planFromClassification({ category: "context", urgency: "later", confidence: 0.9, reason: "r" }, 0.7, "t", () => "read");
    expect(p.action).toMatchObject({ kind: "context.store", tier: "read" });
  });
});
