import type { Config } from "../config.ts";
import { ClaudeTriage } from "./claude.ts";
import { FakeTriage } from "./fake.ts";
import type { Triage } from "./types.ts";

export type * from "./types.ts";
export { FakeTriage } from "./fake.ts";

export function createTriage(cfg: Pick<Config, "TRIAGE_IMPL" | "ANTHROPIC_API_KEY" | "ANTHROPIC_MODEL_TRIAGE">): Triage {
  if (cfg.TRIAGE_IMPL === "claude") {
    return new ClaudeTriage({ apiKey: cfg.ANTHROPIC_API_KEY, model: cfg.ANTHROPIC_MODEL_TRIAGE });
  }
  return new FakeTriage();
}
