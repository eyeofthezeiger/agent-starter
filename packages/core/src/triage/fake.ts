import type { Category, Urgency } from "@cos/shared";
import type { Citation, Classification, Extraction, Summary, Triage, TriageInput } from "./types.ts";

/**
 * Deterministic keyword rules. No model, no network. It exists so the whole
 * pipeline (gate -> inbox -> triage -> approval -> outbox) runs end to end
 * before any AI is added, and so the eval harness has a baseline to beat.
 */
const RULES: { category: Category; patterns: RegExp[] }[] = [
  { category: "ignore", patterns: [/\b(lol|haha|thanks!?|thank you|ty|congrats|🎉)\b/i, /^\s*(ok|okay|👍|nice)\s*[.!]*\s*$/i] },
  { category: "work_task", patterns: [/\b(can you|could you|please|need you to|would you)\b/i, /\b(fix|build|update|review|add|create|ship|draft|investigate|look into)\b/i, /\bbug\b/i] },
  { category: "context", patterns: [/\b(we decided|decision|fyi for later|context|background|for reference|note that|heads up that we)\b/i] },
  { category: "fyi", patterns: [/\b(fyi|heads up|just so you know|announcement|reminder|shipped|released|out of office|ooo)\b/i] },
];

const URGENT = /\b(asap|urgent|today|eod|end of day|blocking|blocker|outage|down|p0|sev ?1|right now)\b/i;
const THIS_WEEK = /\b(this week|by (mon|tues|wednes|thurs|fri)day|tomorrow|before the demo|sprint)\b/i;

function matchCount(text: string, patterns: RegExp[]): number {
  return patterns.reduce((n, p) => n + (p.test(text) ? 1 : 0), 0);
}

function span(text: string, re: RegExp): Citation {
  const m = re.exec(text);
  return m ? { start: m.index, end: m.index + m[0].length } : { start: 0, end: Math.min(text.length, 80) };
}

export class FakeTriage implements Triage {
  readonly name = "fake";

  async classify(input: TriageInput): Promise<Classification> {
    const text = input.text ?? "";
    const scored = RULES.map((r) => ({ category: r.category, hits: matchCount(text, r.patterns), total: r.patterns.length }));
    const ignore = scored.find((s) => s.category === "ignore");
    // Short pleasantries win outright.
    const best = ignore && ignore.hits > 0 && text.length < 40 ? ignore : [...scored].sort((a, b) => b.hits - a.hits)[0];

    const urgency: Urgency = URGENT.test(text) ? "today" : THIS_WEEK.test(text) ? "this_week" : "later";

    if (!best || best.hits === 0) {
      return { category: "fyi", urgency, confidence: 0.4, reason: "no rule matched; asking instead of guessing" };
    }
    const confidence = Math.min(0.95, 0.55 + 0.2 * best.hits);
    return { category: best.category, urgency, confidence, reason: `fake rules: ${best.hits} ${best.category} signal(s)` };
  }

  async extract(input: TriageInput): Promise<Extraction> {
    const text = input.text ?? "";
    const firstSentence = text.split(/(?<=[.!?])\s+|\n/)[0]?.trim() ?? text;
    const title = firstSentence.length > 90 ? `${firstSentence.slice(0, 87)}...` : firstSentence;
    const ask = /\b(can you|could you|please|need you to|would you)\b[^.!?\n]*/i;
    const due = /\b(today|tomorrow|eod|this week|by \w+day)\b/i;
    const actionItems = ask.test(text) ? [{ text: ask.exec(text)![0].trim(), confidence: 0.6, citation: span(text, ask) }] : [];
    const fields: Extraction["fields"] = {};
    if (due.test(text)) fields.due = { value: due.exec(text)![0], confidence: 0.6, citation: span(text, due) };
    return { title: title || "(untitled request)", actionItems, fields };
  }

  async summarize(inputs: TriageInput[]): Promise<Summary> {
    const lines = inputs.map((i) => `- ${(i.text ?? "").split("\n")[0]!.slice(0, 120)}`);
    return { text: lines.join("\n"), citations: [] };
  }
}
