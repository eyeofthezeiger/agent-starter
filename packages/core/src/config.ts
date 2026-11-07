import { z } from "zod";
import { approversOf, loadAgentConfig, type AgentConfig } from "@cos/shared/agent-config";

const bool = z
  .string()
  .optional()
  .transform((v) => (v ?? "").trim().toLowerCase() === "true");

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  CORE_HOST: z.string().default("127.0.0.1"),
  CORE_PORT: z.coerce.number().int().positive().default(8787),
  CORE_API_TOKEN: z.string().min(8, "CORE_API_TOKEN must be at least 8 characters"),
  DRY_RUN: z
    .string()
    .optional()
    .transform((v) => (v ?? "true").trim().toLowerCase() !== "false"), // default ON
  START_PAUSED: bool,
  TZ: z.string().default("America/New_York"),
  MORNING_DIGEST_AT: z.string().regex(/^\d{2}:\d{2}$/).default("08:00"),
  SWEEP_INTERVAL_MINUTES: z.coerce.number().int().positive().default(60),
  RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  AUDIT_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  TRIAGE_IMPL: z.enum(["fake", "claude"]).default("fake"),
  TRIAGE_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.7),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL_TRIAGE: z.string().optional(),
  SLACK_BOT_TOKEN: z.string().optional(),
  JIRA_BASE_URL: z.string().optional(),
  JIRA_EMAIL: z.string().optional(),
  JIRA_API_TOKEN: z.string().optional(),
  JIRA_PROJECT_KEY: z.string().default("COS"),
  JIRA_ISSUE_TYPE: z.string().default("Task"),
  MESSENGER_BUS: z.enum(["none", "log", "mcp"]).default("log"),
});

export type RawConfig = z.infer<typeof schema>;

/**
 * Runtime config: secrets and knobs from the environment, plus who the agent
 * works for and what it may do from agent.config.json.
 */
export interface Config extends RawConfig {
  /** rootDir is the folder that holds agent.config.json (absent when built in a test). */
  agent: AgentConfig & { rootDir?: string };
  /** The owner's Slack member ID. */
  owner: string;
  approvers: Set<string>;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, agent: AgentConfig & { rootDir?: string } = loadAgentConfig(env.AGENT_CONFIG)): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${msg}`);
  }
  const cfg = parsed.data;
  return { ...cfg, agent, owner: agent.owner.slackUserId, approvers: approversOf(agent) };
}

export function jiraConfigured(cfg: RawConfig): boolean {
  return Boolean(cfg.JIRA_BASE_URL && cfg.JIRA_EMAIL && cfg.JIRA_API_TOKEN && !cfg.JIRA_BASE_URL.includes("your-company"));
}
