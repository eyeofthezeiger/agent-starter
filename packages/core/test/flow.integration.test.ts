import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { randomBytes } from "node:crypto";
import { migrate, type Db } from "../src/db.ts";
import { loadConfig, type Config } from "../src/config.ts";
import { parseAgentConfig } from "@cos/shared/agent-config";
import { intake, approveItem, getItemRow } from "../src/inbox.ts";
import { replaceMembers, syncSourceTrust } from "../src/gate.ts";
import { runDueJobs } from "../src/jobs.ts";
import { dispatchOutbox } from "../src/outbox.ts";
import { createJobHandlers, createOnSent } from "../src/handlers.ts";
import { createSenders } from "../src/senders.ts";
import { FakeTriage } from "../src/triage/index.ts";
import { NoopBus } from "../src/bus/index.ts";
import { setPaused } from "../src/pause.ts";

/**
 * Runs only when TEST_DATABASE_URL is set (CI sets it with a Postgres service).
 * Each run uses its own throwaway schema and drops it at the end.
 */
const url = process.env.TEST_DATABASE_URL;
const schema = `test_${randomBytes(4).toString("hex")}`;

describe.skipIf(!url)("intake -> triage -> approval -> outbox (Postgres)", () => {
  let db: Db;
  let cfg: Config;

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    db = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` });
    await migrate(db);
    cfg = loadConfig({ DATABASE_URL: url, CORE_API_TOKEN: "test-token-123", DRY_RUN: "true" }, parseAgentConfig({ owner: { name: "Test Owner", slackUserId: "UOWNER" } }));
    await replaceMembers(db, ["UMEMBER"]);
  });

  afterAll(async () => {
    await db?.end();
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  it("stores a request once and acks instantly", async () => {
    const req = { source: "slack_shortcut" as const, nativeId: "C1:1700000000.000100", author: "UMEMBER", text: "Can you fix the export bug today?", addressed: true, threadKey: "C1:1700000000.000100" };
    const first = await intake(db, "UOWNER", req);
    const again = await intake(db, "UOWNER", req);
    expect(first).toMatchObject({ decision: "admit", duplicate: false });
    expect(again.duplicate).toBe(true);
  });

  it("takes source trust from agent.config.json", async () => {
    const before = await intake(db, "UOWNER", { source: "notes", nativeId: "n-1", author: "UOWNER", text: "from my notebook", addressed: true });
    expect(before.decision).toBe("reject");
    await syncSourceTrust(db, { ...cfg.agent.sources, notes: "explicit" });
    const after = await intake(db, "UOWNER", { source: "notes", nativeId: "n-2", author: "UOWNER", text: "from my notebook", addressed: true });
    expect(after.decision).toBe("admit");
    await syncSourceTrust(db, cfg.agent.sources);
  });

  it("does not store the text of rejected requests", async () => {
    const res = await intake(db, "UOWNER", { source: "slack_command", nativeId: "t-1", author: "USTRANGER", text: "secret plans", addressed: true });
    expect(res.decision).toBe("reject");
    expect((await getItemRow(db, res.id))?.raw_text).toBeNull();
  });

  it("triages, waits for approval, then sends through the outbox", async () => {
    const id = "slack_shortcut:C1:1700000000.000100";
    await runDueJobs(db, createJobHandlers(db, cfg, new FakeTriage()));
    expect((await getItemRow(db, id))?.status).toBe("pending_approval");

    await expect(approveItem(db, cfg.approvers, id, "UMEMBER")).rejects.toThrow(/only approvers/);
    await approveItem(db, cfg.approvers, id, "UOWNER");

    // Paused: nothing leaves.
    await setPaused(db, true, "UOWNER");
    expect(await dispatchOutbox(db, createSenders(cfg, new NoopBus(), () => {}), createOnSent())).toBe(0);
    await setPaused(db, false, "UOWNER");

    const senders = createSenders(cfg, new NoopBus(), () => {});
    while ((await dispatchOutbox(db, senders, createOnSent())) > 0) {
      /* drain, including the follow-up "Filed as" message */
    }
    const { rows } = await db.query(`SELECT action, status FROM outbox ORDER BY id`);
    expect(rows.every((r) => r.status === "sent")).toBe(true);
    expect(rows.map((r) => r.action)).toContain("jira.create_issue");
    expect((await getItemRow(db, id))?.jira_key).toMatch(/^COS-DRY/);
  });

  it("keeps the audit log append-only", async () => {
    await expect(db.query(`UPDATE audit_log SET actor = 'x'`)).rejects.toThrow(/append-only/);
    await expect(db.query(`DELETE FROM audit_log`)).rejects.toThrow(/append-only/);
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM audit_log`);
    expect(rows[0].n).toBeGreaterThan(3);
  });
});
