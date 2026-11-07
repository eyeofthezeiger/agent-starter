import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Category, Urgency } from "@cos/shared";
import type { Triage } from "./triage/types.ts";

export interface EvalCase {
  id: string;
  author: string;
  text: string;
  expected: { category: Category; urgency: Urgency };
  note?: string;
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const TRIAGE_EVAL_PATH = path.join(REPO_ROOT, "evals/triage/synthetic.jsonl");

export async function loadEvalSet(file = TRIAGE_EVAL_PATH): Promise<EvalCase[]> {
  const raw = await readFile(file, "utf8");
  return raw
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as EvalCase);
}

export interface EvalReport {
  total: number;
  categoryAccuracy: number;
  urgencyAccuracy: number;
  misses: { id: string; field: "category" | "urgency"; expected: string; got: string }[];
}

export async function runTriageEval(triage: Triage, cases: EvalCase[]): Promise<EvalReport> {
  const misses: EvalReport["misses"] = [];
  let cat = 0;
  let urg = 0;
  for (const c of cases) {
    const out = await triage.classify({ id: c.id, source: "seed", author: c.author, text: c.text });
    if (out.category === c.expected.category) cat++;
    else misses.push({ id: c.id, field: "category", expected: c.expected.category, got: out.category });
    if (out.urgency === c.expected.urgency) urg++;
    else misses.push({ id: c.id, field: "urgency", expected: c.expected.urgency, got: out.urgency });
  }
  return { total: cases.length, categoryAccuracy: cat / cases.length, urgencyAccuracy: urg / cases.length, misses };
}
