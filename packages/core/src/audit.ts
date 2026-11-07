import type { Queryable } from "./db.ts";

export interface AuditEntry {
  actor: string;
  action: string;
  subjectType?: string;
  subjectId?: string;
  details?: Record<string, unknown>;
}

/** Append one row to the audit log. Call it inside the same transaction as the change it records. */
export async function audit(db: Queryable, entry: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (actor, action, subject_type, subject_id, details) VALUES ($1, $2, $3, $4, $5)`,
    [entry.actor, entry.action, entry.subjectType ?? null, entry.subjectId ?? null, JSON.stringify(entry.details ?? {})],
  );
}

export async function recentAudit(db: Queryable, limit = 50) {
  const { rows } = await db.query(
    `SELECT id, at, actor, action, subject_type, subject_id, details FROM audit_log ORDER BY id DESC LIMIT $1`,
    [Math.min(Math.max(limit, 1), 500)],
  );
  return rows;
}
