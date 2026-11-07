import type { Brief, CoreStatus, IntakeRequest, IntakeResponse, ItemStatus, QueueItem } from "@cos/shared";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { audit, recentAudit } from "./audit.ts";
import { replaceMembers } from "./gate.ts";
import { approveItem, DecisionError, intake, listQueue, rejectItem } from "./inbox.ts";
import { isPaused, setPaused } from "./pause.ts";

/** What the HTTP layer needs. An interface so the server can be tested without Postgres. */
export interface CoreServices {
  status(): Promise<CoreStatus>;
  intake(req: IntakeRequest): Promise<IntakeResponse>;
  queue(statuses?: ItemStatus[]): Promise<QueueItem[]>;
  approve(id: string, actor: string): Promise<QueueItem>;
  reject(id: string, actor: string, note?: string): Promise<QueueItem>;
  briefs(limit: number): Promise<Brief[]>;
  setPaused(paused: boolean, actor: string): Promise<CoreStatus>;
  syncMembers(members: string[]): Promise<number>;
  audit(limit: number): Promise<unknown[]>;
}

export { DecisionError };

export function createServices(db: Db, cfg: Config, triageName: string): CoreServices {
  const status = async (): Promise<CoreStatus> => ({ ok: true, paused: await isPaused(db), dryRun: cfg.DRY_RUN, triage: triageName });
  return {
    status,
    intake: (req) => intake(db, cfg.owner, req),
    queue: (statuses) => listQueue(db, statuses),
    approve: (id, actor) => approveItem(db, cfg.approvers, id, actor),
    reject: (id, actor, note) => rejectItem(db, cfg.approvers, id, actor, note),
    briefs: async (limit) => {
      const { rows } = await db.query<{ id: string; kind: Brief["kind"]; title: string; body: string; created_at: Date }>(
        `SELECT id, kind, title, body, created_at FROM briefs ORDER BY created_at DESC LIMIT $1`,
        [Math.min(Math.max(limit, 1), 50)],
      );
      return rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, createdAt: new Date(r.created_at).toISOString() }));
    },
    setPaused: async (paused, actor) => {
      if (!cfg.approvers.has(actor)) throw new DecisionError(403, "only approvers can pause or resume");
      await setPaused(db, paused, actor);
      return status();
    },
    syncMembers: async (members) => {
      const count = await replaceMembers(db, members);
      await audit(db, { actor: "slack-app", action: "gate.sync", details: { count } });
      return count;
    },
    audit: (limit) => recentAudit(db, limit),
  };
}
