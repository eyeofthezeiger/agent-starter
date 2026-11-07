import type { Db, Queryable } from "./db.ts";
import { backoffMs } from "./backoff.ts";
import { audit } from "./audit.ts";
import { isPaused } from "./pause.ts";

/** The retry queue for internal work. Postgres row locks make it safe to run more than one worker. */
export interface Job {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

export type JobHandler = (job: Job) => Promise<void>;

export async function enqueueJob(
  db: Queryable,
  job: { type: string; payload?: Record<string, unknown>; dedupeKey?: string; runAt?: Date; maxAttempts?: number },
): Promise<boolean> {
  const res = await db.query(
    `INSERT INTO jobs (type, payload, dedupe_key, run_at, max_attempts)
     VALUES ($1, $2, $3, COALESCE($4, now()), COALESCE($5, 5))
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [job.type, JSON.stringify(job.payload ?? {}), job.dedupeKey ?? null, job.runAt ?? null, job.maxAttempts ?? null],
  );
  return (res.rowCount ?? 0) > 0;
}

/** Claim and run up to `limit` due jobs. Returns how many ran. Does nothing while paused. */
export async function runDueJobs(db: Db, handlers: Record<string, JobHandler>, limit = 5): Promise<number> {
  if (await isPaused(db)) return 0;
  const { rows } = await db.query<Job>(
    `UPDATE jobs SET status = 'running', locked_at = now(), attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM jobs WHERE status = 'queued' AND run_at <= now()
       ORDER BY run_at FOR UPDATE SKIP LOCKED LIMIT $1)
     RETURNING id, type, payload, attempts, max_attempts`,
    [limit],
  );
  for (const job of rows) {
    const handler = handlers[job.type];
    try {
      if (!handler) throw new Error(`no handler for job type ${job.type}`);
      await handler(job);
      await db.query(`UPDATE jobs SET status = 'done', finished_at = now(), last_error = NULL WHERE id = $1`, [job.id]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const dead = job.attempts >= job.max_attempts;
      await db.query(
        `UPDATE jobs SET status = $2, last_error = $3, locked_at = NULL,
           run_at = now() + ($4 || ' milliseconds')::interval,
           finished_at = CASE WHEN $2 = 'dead' THEN now() ELSE NULL END
         WHERE id = $1`,
        [job.id, dead ? "dead" : "queued", message, String(backoffMs(job.attempts))],
      );
      if (dead) {
        await audit(db, { actor: "system", action: "job.dead", subjectType: "job", subjectId: String(job.id), details: { type: job.type, error: message } });
      }
    }
  }
  return rows.length;
}

/** Jobs stuck in "running" (a crash mid-run) go back to the queue. */
export async function recoverStuckJobs(db: Queryable, olderThanMinutes = 10): Promise<number> {
  const res = await db.query(
    `UPDATE jobs SET status = 'queued', locked_at = NULL
     WHERE status = 'running' AND locked_at < now() - ($1 || ' minutes')::interval`,
    [String(olderThanMinutes)],
  );
  return res.rowCount ?? 0;
}
