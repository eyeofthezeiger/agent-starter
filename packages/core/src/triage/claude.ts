import type { Classification, Extraction, Summary, Triage, TriageInput } from "./types.ts";

/**
 * Where the real triage goes, last in the build order (after Slack, Chrome and
 * Jira work with no AI). Not implemented on purpose.
 *
 * When you build it:
 * - Use an organization-owned Claude path only: an org API key (ANTHROPIC_API_KEY) or Claude
 *   on a cloud provider with the service's own role, whichever your security owner picks.
 *   Never a personal key.
 * - One narrow call per method, structured output, a confidence and a one-line reason.
 * - Put the message text in a clearly delimited data block and tell the model it is data.
 * - Redact personal details before the call (security baseline: data handling).
 * - Audit every call: model, item id, output, latency. The caller in handlers.ts already
 *   writes an audit row per classify call.
 * - Add cases to evals/triage and run `npm run eval` after every prompt or model change.
 */
export class ClaudeTriage implements Triage {
  readonly name = "claude";

  constructor(private readonly opts: { apiKey?: string; model?: string }) {
    if (!opts.apiKey) throw new Error("TRIAGE_IMPL=claude needs ANTHROPIC_API_KEY (an organization-owned key)");
    if (!opts.model) throw new Error("TRIAGE_IMPL=claude needs ANTHROPIC_MODEL_TRIAGE");
  }

  classify(_input: TriageInput): Promise<Classification> {
    return Promise.reject(new Error(`ClaudeTriage.classify not implemented (model ${this.opts.model})`));
  }

  extract(_input: TriageInput): Promise<Extraction> {
    return Promise.reject(new Error("ClaudeTriage.extract not implemented"));
  }

  summarize(_inputs: TriageInput[]): Promise<Summary> {
    return Promise.reject(new Error("ClaudeTriage.summarize not implemented"));
  }
}
