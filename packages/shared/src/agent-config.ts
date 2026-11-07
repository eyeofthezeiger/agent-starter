import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ApprovalTier, Source, Trust } from "./types.ts";

/**
 * agent.config.json: who this agent works for and what it may do.
 * Not secret, so it is committed. Secrets stay in the environment (.env
 * locally, a secrets manager anywhere else).
 *
 * Node-only (reads the file system). Import it as "@cos/shared/agent-config",
 * never from the browser extension.
 */

const slackUserId = z.string().regex(/^[UW][A-Z0-9]+$/, "must be a Slack member ID like U012ABCDEF");
const trust = z.enum(["explicit", "inferred", "ignore"]);
/** "automatic" is reserved. This starter never acts without a person's approval. */
const tier = z.enum(["read", "draft", "send_with_approval"]);

export const SOURCES = ["slack_command", "slack_shortcut", "slack_mention", "slack_dm", "slack_ambient", "chrome", "notes", "seed"] as const satisfies readonly Source[];

const DEFAULT_TRUST: Record<Source, Trust> = {
  slack_command: "explicit",
  slack_shortcut: "explicit",
  slack_mention: "explicit",
  slack_dm: "explicit",
  slack_ambient: "inferred",
  chrome: "explicit",
  notes: "ignore",
  seed: "explicit",
};

const DEFAULT_TIERS = {
  ask_owner: "read",
  "context.store": "draft",
  "jira.create_issue": "send_with_approval",
  morning_digest: "draft",
} as const satisfies Record<string, ApprovalTier>;

export const agentConfigSchema = z.object({
  owner: z.object({
    /** Shown in Slack copy, e.g. "Only Sam (or a named approver) can do that." */
    name: z.string().min(1),
    slackUserId,
    /** Your per-person context file, relative to the repo root. Git-ignored. */
    contextFile: z.string().default("context/me.md"),
  }),
  team: z
    .object({
      name: z.string().default(""),
      /** Extra people who may approve, pause and resume. The owner always can. */
      approverSlackUserIds: z.array(slackUserId).default([]),
      /** Slack user group whose members may send requests. Empty = owner only. */
      allowedUsergroupId: z.string().default(""),
    })
    .prefault({}),
  slack: z
    .object({
      appName: z.string().min(1).default("Chief of Staff"),
      botDisplayName: z
        .string()
        .regex(/^[a-z0-9][a-z0-9._-]{0,79}$/, "lowercase letters, digits, dots, dashes and underscores")
        .default("chief-of-staff"),
      /** The slash command people use to send requests. */
      command: z
        .string()
        .regex(/^\/[a-z0-9][a-z0-9_-]{0,31}$/, 'must look like "/ask": a slash, then lowercase letters, digits, dashes or underscores')
        .default("/ask"),
    })
    .prefault({}),
  /** Trust per source. explicit = admitted when addressed; inferred = observe only; ignore = drop. */
  sources: z
    .partialRecord(z.enum(SOURCES), trust)
    .prefault({})
    .transform((given) => ({ ...DEFAULT_TRUST, ...given }) as Record<Source, Trust>),
  approvalTiers: z
    .object({
      /** Correct runs in a row before a person may promote a job one tier. */
      promoteAfterCorrectRuns: z.number().int().positive().default(5),
      jobs: z
        .record(z.string(), tier)
        .prefault({})
        .transform((given) => ({ ...DEFAULT_TIERS, ...given }) as Record<string, ApprovalTier>),
    })
    .prefault({}),
  /** Skill packs to load from skills/packs/<name>. "core" is always on. */
  skillPacks: z.array(z.string().regex(/^[a-z0-9-]+$/)).default([]),
});

export type AgentConfig = z.output<typeof agentConfigSchema>;

export function parseAgentConfig(input: unknown): AgentConfig {
  const parsed = agentConfigSchema.safeParse(input);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(`Invalid agent.config.json:\n${msg}`);
  }
  return parsed.data;
}

/** Walk up from `from` to the folder that holds agent.config.json. */
export function findRepoRoot(from: string = process.cwd()): string {
  let dir = path.resolve(from);
  for (;;) {
    if (existsSync(path.join(dir, "agent.config.json"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) throw new Error(`agent.config.json not found above ${from}.`);
    dir = up;
  }
}

/**
 * Load and validate the config. AGENT_CONFIG overrides the path.
 * Also checks that every listed skill pack exists, so a typo fails at startup.
 */
export function loadAgentConfig(file: string | undefined = process.env.AGENT_CONFIG): AgentConfig & { rootDir: string } {
  const configPath = file ? path.resolve(file) : path.join(findRepoRoot(), "agent.config.json");
  const cfg = parseAgentConfig(JSON.parse(readFileSync(configPath, "utf8")));
  const rootDir = path.dirname(configPath);
  const missing = cfg.skillPacks.filter((p) => !existsSync(path.join(rootDir, "skills", "packs", p)));
  if (missing.length) throw new Error(`Invalid agent.config.json:\n  skillPacks: no folder skills/packs/${missing.join(", skills/packs/")}`);
  return { ...cfg, rootDir };
}

/** Everyone who may approve, pause and resume. */
export function approversOf(cfg: AgentConfig): Set<string> {
  return new Set([cfg.owner.slackUserId, ...cfg.team.approverSlackUserIds]);
}

/** Tier for a proposed action or job. Unknown jobs start at draft. */
export function tierFor(cfg: AgentConfig, job: string): ApprovalTier {
  return cfg.approvalTiers.jobs[job] ?? "draft";
}
