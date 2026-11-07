import { createHash } from "node:crypto";
import type { ApprovalTier, IntakeRequest, IntakeResponse, ItemStatus, ProposedAction, QueueItem } from "@cos/shared";
import { withTx, type Db, type Queryable } from "./db.ts";
import { audit } from "./audit.ts";
import { decide, loadPolicy } from "./gate.ts";
import { enqueueJob } from "./jobs.ts";
import { enqueueOutbox } from "./outbox.ts";
import type { Classification } from "./triage/types.ts";

export const ACTIVE_STATUSES: ItemStatus[] = ["new", "pending_approval", "needs_answer"];

export function itemId(source: string, nativeId: string): string {
  return `${source}:${nativeId}`;
}

export function shortHash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 12);
}

interface ItemRow {
  id: string;
  source: QueueItem["source"];
  author: string;
  raw_text: string | null;
  link_back: string | null;
  status: ItemStatus;
  gate_decision: QueueItem["gateDecision"];
  category: QueueItem["category"];
  urgency: QueueItem["urgency"];
  confidence: number | null;
  reason: string | null;
  proposed_action: ProposedAction | null;
  thread_key: string | null;
  jira_key: string | null;
  created_at: Date;
}

const COLUMNS = `id, source, author, raw_text, link_back, status, gate_decision, category, urgency,
  confidence, reason, proposed_action, thread_key, jira_key, created_at`;

export function toQueueItem(r: ItemRow): QueueItem {
  return {
    id: r.id,
    source: r.source,
    author: r.author,
    text: r.raw_text,
    linkBack: r.link_back,
    status: r.status,
    gateDecision: r.gate_decision,
    category: r.category,
    urgency: r.urgency,
    confidence: r.confidence,
    reason: r.reason,
    proposedAction: r.proposed_action,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export async function getItemRow(db: Queryable, id: string): Promise<ItemRow | null> {
  const { rows } = await db.query<ItemRow>(`SELECT ${COLUMNS} FROM inbox_items WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

/**
 * Store one inbound record (once, by id), run the gate, and queue triage.
 * Returns fast so the source can show an instant ack.
 */
export async function intake(db: Db, owner: string, req: IntakeRequest): Promise<IntakeResponse> {
  const id = itemId(req.source, req.nativeId);
  const lane = req.lane ?? "work";
  const policy = await loadPolicy(db, owner);
  const gate = decide({ source: req.source, author: req.author, addressed: req.addressed ?? false, lane }, policy);

  return withTx(db, async (tx) => {
    const res = await tx.query(
      `INSERT INTO inbox_items
         (id, source, lane, author, addressed, link_back, raw_text, refs, source_ts, thread_key, gate_decision, gate_reason, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO NOTHING`,
      [
        id,
        req.source,
        lane,
        req.author,
        req.addressed ?? false,
        req.linkBack ?? null,
        gate.decision === "reject" ? null : req.text, // keep metadata, not content, for rejected records
        req.refs ?? [],
        req.sourceTs ?? null,
        req.threadKey ?? null,
        gate.decision,
        gate.reason,
        gate.decision === "reject" ? "dropped" : "new",
      ],
    );
    const duplicate = (res.rowCount ?? 0) === 0;
    if (duplicate) {
      const existing = await getItemRow(tx, id);
      return { id, decision: existing?.gate_decision ?? gate.decision, duplicate: true, ack: "Already in the queue." };
    }

    await audit(tx, { actor: req.author, action: "intake", subjectType: "item", subjectId: id, details: { source: req.source, gate } });
    if (gate.decision !== "reject") {
      await enqueueJob(tx, { type: "triage", payload: { itemId: id }, dedupeKey: `triage:${id}` });
      await enqueueOutbox(tx, {
        channel: "bus",
        action: "bus.publish",
        payload: { type: "item.created", id: `item.created:${id}`, subjectId: id, data: { source: req.source, decision: gate.decision } },
        idempotencyKey: `bus:item.created:${id}`,
      });
    }

    const ack =
      gate.decision === "admit"
        ? `Got it. Queued for triage (${shortHash(id)}).`
        : gate.decision === "observe"
          ? "Noted. It will show in the inferred digest."
          : "Not accepted. Requests need to come from the requests user group.";
    return { id, decision: gate.decision, duplicate: false, ack };
  });
}

export async function listQueue(db: Queryable, statuses: ItemStatus[] = ACTIVE_STATUSES, limit = 100): Promise<QueueItem[]> {
  const { rows } = await db.query<ItemRow>(
    `SELECT ${COLUMNS} FROM inbox_items WHERE status = ANY($1::text[]) ORDER BY created_at DESC LIMIT $2`,
    [statuses, limit],
  );
  return rows.map(toQueueItem);
}

/** Turn a classification into a status and a proposed action. Below the threshold: ask, never guess. */
const DEFAULT_TIER: Record<ProposedAction["kind"], ApprovalTier> = { ask_owner: "read", "jira.create_issue": "send_with_approval", "context.store": "draft" };

/**
 * Turn a classification into a status and a proposed action. Below the threshold: ask, never guess.
 * `tierOf` comes from agent.config.json (approvalTiers.jobs). The tier is recorded on the action;
 * every write still waits for a person's approval in this starter.
 */
export function planFromClassification(
  c: Classification,
  threshold: number,
  title: string,
  tierOf: (job: ProposedAction["kind"]) => ApprovalTier = (job) => DEFAULT_TIER[job],
): { status: ItemStatus; action: ProposedAction | null } {
  if (c.confidence < threshold) {
    return { status: "needs_answer", action: { kind: "ask_owner", summary: `Not sure how to handle this (${c.reason})`, tier: tierOf("ask_owner") } };
  }
  switch (c.category) {
    case "work_task":
      return { status: "pending_approval", action: { kind: "jira.create_issue", summary: `Create Jira ticket: ${title}`, tier: tierOf("jira.create_issue") } };
    case "context":
      return { status: "context", action: { kind: "context.store", summary: "Save to the work context store", tier: tierOf("context.store") } };
    case "fyi":
      return { status: "fyi", action: null };
    case "ignore":
      return { status: "dropped", action: null };
  }
}

export class DecisionError extends Error {
  constructor(
    public readonly code: 403 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

/** Where to tell the requester what happened. Slack sources only. */
export function replyTarget(item: Pick<ItemRow, "source" | "author" | "thread_key">): { channel: string; threadTs?: string } | null {
  if (!item.source.startsWith("slack_")) return null;
  const m = /^([CDG][A-Z0-9]+):(\d+\.\d+)$/.exec(item.thread_key ?? "");
  if (m) return { channel: m[1]!, threadTs: m[2]! };
  return { channel: item.author }; // DM the requester
}

export async function approveItem(db: Db, approvers: ReadonlySet<string>, id: string, actor: string): Promise<QueueItem> {
  if (!approvers.has(actor)) throw new DecisionError(403, "only approvers can approve");
  return withTx(db, async (tx) => {
    const { rows } = await tx.query<ItemRow>(`SELECT ${COLUMNS} FROM inbox_items WHERE id = $1 FOR UPDATE`, [id]);
    const item = rows[0];
    if (!item) throw new DecisionError(404, "no such item");
    if (item.status !== "pending_approval" && item.status !== "needs_answer") {
      throw new DecisionError(409, `item is ${item.status}, not waiting for approval`);
    }
    const { rows: updated } = await tx.query<ItemRow>(
      `UPDATE inbox_items SET status = 'approved', decided_by = $2, decided_at = now(), updated_at = now()
       WHERE id = $1 RETURNING ${COLUMNS}`,
      [id, actor],
    );
    const text = item.raw_text ?? "";
    const title = item.proposed_action?.summary.replace(/^Create Jira ticket: /, "") || text.slice(0, 90);
    await enqueueOutbox(tx, {
      channel: "jira",
      action: "jira.create_issue",
      payload: {
        itemId: id,
        summary: title,
        // Copy only the request and a link back, never surrounding thread content.
        description: `${text}\n\nRequested by ${item.author} via ${item.source}. Approved by ${actor}.`,
        linkBack: item.link_back,
        idempotencyLabel: `cos-${shortHash(id)}`,
      },
      idempotencyKey: `jira:create:${id}`,
    });
    const target = replyTarget(item);
    if (target) {
      await enqueueOutbox(tx, {
        channel: "slack",
        action: "slack.post_message",
        payload: { ...target, text: "Approved. Filing a Jira ticket now." },
        idempotencyKey: `slack:approved:${id}`,
      });
    }
    await enqueueOutbox(tx, {
      channel: "bus",
      action: "bus.publish",
      payload: { type: "item.approved", id: `item.approved:${id}`, subjectId: id, data: { by: actor } },
      idempotencyKey: `bus:item.approved:${id}`,
    });
    await audit(tx, { actor, action: "item.approve", subjectType: "item", subjectId: id, details: { proposed: item.proposed_action } });
    return toQueueItem(updated[0]!);
  });
}

export async function rejectItem(db: Db, approvers: ReadonlySet<string>, id: string, actor: string, note?: string): Promise<QueueItem> {
  if (!approvers.has(actor)) throw new DecisionError(403, "only approvers can reject");
  return withTx(db, async (tx) => {
    const { rows } = await tx.query<ItemRow>(
      `UPDATE inbox_items SET status = 'rejected', decided_by = $2, decided_at = now(), updated_at = now()
       WHERE id = $1 AND status = ANY($3::text[]) RETURNING ${COLUMNS}`,
      [id, actor, ACTIVE_STATUSES],
    );
    const item = rows[0];
    if (!item) {
      const exists = await getItemRow(tx, id);
      throw new DecisionError(exists ? 409 : 404, exists ? `item is ${exists.status}` : "no such item");
    }
    await audit(tx, { actor, action: "item.reject", subjectType: "item", subjectId: id, details: { note: note ?? null } });
    return toQueueItem(item);
  });
}
