import type { Config } from "./config.ts";
import { withTx, type Db, type Queryable } from "./db.ts";
import { audit } from "./audit.ts";
import { buildMorningDigest } from "./digest.ts";
import { enqueueJob, recoverStuckJobs, type JobHandler } from "./jobs.ts";
import { enqueueOutbox, recoverStuckOutbox, type OnSent } from "./outbox.ts";
import { itemBlocks } from "@cos/shared";
import { tierFor } from "@cos/shared/agent-config";
import { getItemRow, listQueue, planFromClassification, replyTarget, toQueueItem } from "./inbox.ts";
import type { Triage } from "./triage/types.ts";

export function createJobHandlers(db: Db, cfg: Config, triage: Triage): Record<string, JobHandler> {
  return {
    /** Classify one item and propose an action. Runs on arrival. */
    triage: async (job) => {
      const id = String(job.payload.itemId);
      const item = await getItemRow(db, id);
      if (!item || item.status !== "new" || !item.raw_text) return;
      const input = { id, source: item.source, author: item.author, text: item.raw_text, linkBack: item.link_back };
      const started = Date.now();
      const c = await triage.classify(input);
      const x = c.category === "work_task" ? await triage.extract(input) : null;
      const plan = planFromClassification(c, cfg.TRIAGE_CONFIDENCE_THRESHOLD, x?.title ?? item.raw_text.slice(0, 90), (job) => tierFor(cfg.agent, job));
      await withTx(db, async (tx) => {
        await tx.query(
          `UPDATE inbox_items SET status = $2, category = $3, urgency = $4, confidence = $5, reason = $6,
             proposed_action = $7, updated_at = now() WHERE id = $1 AND status = 'new'`,
          [id, plan.status, c.category, c.urgency, c.confidence, c.reason, plan.action ? JSON.stringify(plan.action) : null],
        );
        // The audit row records what the model read (the item id) and what it produced.
        await audit(tx, {
          actor: `triage:${triage.name}`,
          action: "triage.classify",
          subjectType: "item",
          subjectId: id,
          details: { classification: c, extraction: x, plan, ms: Date.now() - started },
        });
        if (plan.status === "pending_approval" || plan.status === "needs_answer") {
          const updated = await getItemRow(tx, id);
          await enqueueOutbox(tx, {
            channel: "slack",
            action: "slack.post_message",
            payload: {
              channel: cfg.owner,
              text: `${plan.status === "needs_answer" ? "Needs your answer" : "Needs approval"}: ${plan.action?.summary ?? id}`,
              blocks: updated ? itemBlocks(toQueueItem(updated)) : undefined,
            },
            idempotencyKey: `slack:approval-request:${id}`,
          });
        }
      });
    },

    /** Hourly backstop: re-run anything that missed triage and recover stuck rows. */
    sweep: async () => {
      const recoveredJobs = await recoverStuckJobs(db);
      const recoveredOutbox = await recoverStuckOutbox(db);
      const { rows } = await db.query<{ id: string }>(
        `SELECT id FROM inbox_items WHERE status = 'new' AND raw_text IS NOT NULL AND created_at < now() - interval '5 minutes'`,
      );
      for (const r of rows) await enqueueJob(db, { type: "triage", payload: { itemId: r.id }, dedupeKey: `triage-retry:${r.id}:${Date.now()}` });
      await audit(db, { actor: "system", action: "sweep", details: { recoveredJobs, recoveredOutbox, retriaged: rows.length } });
    },

    morning_digest: async () => {
      const items = await listQueue(db, ["pending_approval", "needs_answer", "fyi"], 50);
      const digest = buildMorningDigest(items, new Date(), cfg.TZ);
      await withTx(db, async (tx) => {
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO briefs (kind, title, body) VALUES ('morning_digest', $1, $2) RETURNING id`,
          [digest.title, digest.body],
        );
        await enqueueOutbox(tx, {
          channel: "slack",
          action: "slack.post_message",
          payload: { channel: cfg.owner, text: `${digest.title}\n${digest.body}` },
          idempotencyKey: `slack:digest:${rows[0]!.id}`,
        });
        await audit(tx, { actor: "system", action: "brief.create", subjectType: "brief", subjectId: rows[0]!.id, details: { kind: "morning_digest", items: items.length } });
      });
    },

    /** Security baseline: inbox records and logs are kept RETENTION_DAYS, then deleted. */
    retention: async () => {
      const days = String(cfg.RETENTION_DAYS);
      const auditDays = String(cfg.AUDIT_RETENTION_DAYS);
      const counts = await withTx(db, async (tx) => {
        await tx.query("SET LOCAL cos.retention = 'on'");
        const del = async (sql: string, n = days) => (await tx.query(sql, [n])).rowCount ?? 0;
        return {
          items: await del(`DELETE FROM inbox_items WHERE created_at < now() - ($1 || ' days')::interval`),
          jobs: await del(`DELETE FROM jobs WHERE status IN ('done','dead') AND created_at < now() - ($1 || ' days')::interval`),
          outbox: await del(`DELETE FROM outbox WHERE status IN ('sent','dead') AND created_at < now() - ($1 || ' days')::interval`),
          briefs: await del(`DELETE FROM briefs WHERE created_at < now() - ($1 || ' days')::interval`),
          audit: await del(`DELETE FROM audit_log WHERE at < now() - ($1 || ' days')::interval`, auditDays),
        };
      });
      await audit(db, { actor: "system", action: "retention", details: { days: cfg.RETENTION_DAYS, auditDays: cfg.AUDIT_RETENTION_DAYS, deleted: counts } });
    },
  };
}

/** After Jira creates the issue, store the key and tell the requester. */
export function createOnSent(): OnSent {
  return async (row, result, db: Queryable) => {
    if (row.action !== "jira.create_issue" || !result || typeof result.key !== "string") return;
    const itemId = String(row.payload.itemId);
    await db.query(`UPDATE inbox_items SET jira_key = $2, updated_at = now() WHERE id = $1`, [itemId, result.key]);
    const item = await getItemRow(db, itemId);
    const target = item ? replyTarget(item) : null;
    if (target) {
      await enqueueOutbox(db, {
        channel: "slack",
        action: "slack.post_message",
        payload: { ...target, text: `Filed as ${result.key}.` },
        idempotencyKey: `slack:filed:${itemId}`,
      });
    }
  };
}
