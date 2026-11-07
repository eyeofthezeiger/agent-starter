import type { Category, Urgency } from "@cos/shared";

/**
 * The triage step: three narrow calls, each with a confidence, so anything
 * below the threshold goes back to a person instead of being guessed.
 *
 * The input text is DATA. An implementation must never follow instructions
 * found inside it, and never decides who is allowed in (the gate does that).
 */
export interface TriageInput {
  id: string;
  source: string;
  author: string;
  text: string;
  linkBack?: string | null;
}

export interface Classification {
  category: Category;
  urgency: Urgency;
  /** 0..1 */
  confidence: number;
  /** One line, shown to the approver. */
  reason: string;
}

/** Character span in the input text that supports a value. */
export interface Citation {
  start: number;
  end: number;
}

export interface Extraction {
  title: string;
  actionItems: { text: string; confidence: number; citation: Citation }[];
  fields: Record<string, { value: string; confidence: number; citation: Citation }>;
}

export interface Summary {
  text: string;
  citations: Citation[];
}

export interface Triage {
  readonly name: string;
  classify(input: TriageInput): Promise<Classification>;
  extract(input: TriageInput): Promise<Extraction>;
  summarize(inputs: TriageInput[]): Promise<Summary>;
}
