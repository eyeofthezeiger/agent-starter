import type { GateDecision, Lane, Source, Trust } from "@cos/shared";
import type { Queryable } from "./db.ts";
import { SOURCES } from "@cos/shared/agent-config";

/**
 * The gate is plain code and runs before any model. It decides who gets in.
 * Nothing in a message's text can change its answer.
 */
export interface GateInput {
  source: Source;
  author: string;
  addressed: boolean;
  lane: Lane;
}

export interface GatePolicy {
  owner: string;
  /** Members of the allowed Slack user group. */
  members: ReadonlySet<string>;
  trust: ReadonlyMap<string, Trust>;
}

export interface GateResult {
  decision: GateDecision;
  reason: string;
}

export function decide(input: GateInput, policy: GatePolicy): GateResult {
  if (input.lane !== "work") {
    return { decision: "reject", reason: "personal lane never enters the work core" };
  }
  const trust = policy.trust.get(input.source);
  if (!trust) return { decision: "reject", reason: `unknown source ${input.source}` };
  if (trust === "ignore") return { decision: "reject", reason: `source ${input.source} is set to ignore` };

  const allowed = input.author === policy.owner || policy.members.has(input.author);
  if (!allowed) return { decision: "reject", reason: "author is not in the allowed user group" };

  if (trust === "inferred") return { decision: "observe", reason: `source ${input.source} is observe-only` };
  if (!input.addressed) return { decision: "observe", reason: "not addressed to the agent" };
  return { decision: "admit", reason: "allowed author, explicit source, addressed" };
}

export async function loadPolicy(db: Queryable, owner: string): Promise<GatePolicy> {
  const [members, trust] = await Promise.all([
    db.query<{ slack_user_id: string }>("SELECT slack_user_id FROM gate_members"),
    db.query<{ source: string; trust: Trust }>("SELECT source, trust FROM source_trust"),
  ]);
  return {
    owner,
    members: new Set(members.rows.map((r) => r.slack_user_id)),
    trust: new Map(trust.rows.map((r) => [r.source, r.trust])),
  };
}

/** Make the source_trust table match agent.config.json (sources). Runs at startup. */
export async function syncSourceTrust(db: Queryable, trust: Record<Source, Trust>): Promise<void> {
  const rows = SOURCES.map((s) => [s, trust[s]] as const);
  await db.query(
    `INSERT INTO source_trust (source, trust)
     SELECT * FROM unnest($1::text[], $2::text[])
     ON CONFLICT (source) DO UPDATE SET trust = EXCLUDED.trust`,
    [rows.map((r) => r[0]), rows.map((r) => r[1])],
  );
}

/** Replace the member list with the current user group membership. */
export async function replaceMembers(db: Queryable, members: string[]): Promise<number> {
  const unique = [...new Set(members.filter((m) => /^[UW][A-Z0-9]+$/.test(m)))];
  await db.query("DELETE FROM gate_members WHERE NOT (slack_user_id = ANY($1::text[]))", [unique]);
  if (unique.length) {
    await db.query(
      `INSERT INTO gate_members (slack_user_id) SELECT unnest($1::text[])
       ON CONFLICT (slack_user_id) DO UPDATE SET synced_at = now()`,
      [unique],
    );
  }
  return unique.length;
}
