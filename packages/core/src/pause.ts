import type { Queryable } from "./db.ts";
import { audit } from "./audit.ts";

/**
 * The pause switch. When on, the job runner and the outbox dispatcher stop
 * acting. Intake, storage and the audit log keep working.
 */
export async function isPaused(db: Queryable): Promise<boolean> {
  const { rows } = await db.query<{ value: boolean }>(`SELECT value FROM settings WHERE key = 'paused'`);
  return rows[0]?.value === true;
}

export async function setPaused(db: Queryable, paused: boolean, actor: string): Promise<void> {
  await db.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('paused', $1::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(paused)],
  );
  await audit(db, { actor, action: paused ? "pause.on" : "pause.off", subjectType: "settings", subjectId: "paused" });
}
