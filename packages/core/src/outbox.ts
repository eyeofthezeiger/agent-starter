import type { Db, Queryable } from "./db.ts";
import { backoffMs } from "./backoff.ts";
import { audit } from "./audit.ts";
import { isPaused } from "./pause.ts";

/**
 * Every outgoing write (Slack post, Jira issue, bus event) is stored here first,
 * in the same transaction as the decision that caused it, then sent by the
 * dispatcher with retry and backoff. The idempotency key stops double sends.
 */
export type OutboxChannel = "slack" | "jira" | "bus";

export interface OutboxRow {
  id: string;
  channel: OutboxChannel;
  action: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

export type Sender = (payload: Record<string, unknown>) => Promise<Record<string, unknown> | void>;
export type SenderRegistry = Record<string, Sender>;
export type OnSent = (row: OutboxRow, result: Record<string, unknown> | void, db: Queryable) => Promise<void>;

export async function enqueueOutbox(
  db: Queryable,
  msg: { channel: OutboxChannel; action: string; payload: Record<string, unknown>; idempotencyKey: string },
): Promise<boolean> {
  const res = await db.query(
    `INSERT INTO outbox (channel, action, payload, idempotency_key) VALUES ($1, $2, $3, $4)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [msg.channel, msg.action, JSON.stringify(msg.payload), msg.idempotencyKey],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function dispatchOutbox(db: Db, senders: SenderRegistry, onSent?: OnSent, limit = 10): Promise<number> {
  if (await isPaused(db)) return 0;
  const { rows } = await db.query<OutboxRow>(
    `UPDATE outbox SET status = 'sending', attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM outbox WHERE status = 'pending' AND next_attempt_at <= now()
       ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT $1)
     RETURNING id, channel, action, payload, attempts, max_attempts`,
    [limit],
  );
  for (const row of rows) {
    try {
      const sender = senders[row.action];
      if (!sender) throw new Error(`no sender for ${row.action}`);
      const result = await sender(row.payload);
      await db.query(`UPDATE outbox SET status = 'sent', sent_at = now(), result = $2, last_error = NULL WHERE id = $1`, [
        row.id,
        JSON.stringify(result ?? {}),
      ]);
      await audit(db, { actor: "system", action: `outbox.sent`, subjectType: "outbox", subjectId: String(row.id), details: { action: row.action, result: result ?? {} } });
      if (onSent) await onSent(row, result, db);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const dead = row.attempts >= row.max_attempts;
      await db.query(
        `UPDATE outbox SET status = $2, last_error = $3,
           next_attempt_at = now() + ($4 || ' milliseconds')::interval
         WHERE id = $1`,
        [row.id, dead ? "dead" : "pending", message, String(backoffMs(row.attempts))],
      );
      if (dead) {
        await audit(db, { actor: "system", action: "outbox.dead", subjectType: "outbox", subjectId: String(row.id), details: { action: row.action, error: message } });
      }
    }
  }
  return rows.length;
}

/** Rows stuck in "sending" after a crash go back to pending. The idempotency key and the sender's own keys guard re-sends. */
export async function recoverStuckOutbox(db: Queryable, olderThanMinutes = 10): Promise<number> {
  const res = await db.query(
    `UPDATE outbox SET status = 'pending'
     WHERE status = 'sending' AND next_attempt_at < now() - ($1 || ' minutes')::interval`,
    [String(olderThanMinutes)],
  );
  return res.rowCount ?? 0;
}
