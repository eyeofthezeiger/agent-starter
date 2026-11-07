import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/server.ts";
import { DecisionError, type CoreServices } from "../src/services.ts";
import { buildMorningDigest } from "../src/digest.ts";
import { replyTarget } from "../src/inbox.ts";

function fakeServices(overrides: Partial<CoreServices> = {}): CoreServices {
  return {
    status: async () => ({ ok: true, paused: false, dryRun: true, triage: "fake" }),
    intake: vi.fn(async (req) => ({ id: `${req.source}:${req.nativeId}`, decision: "admit" as const, duplicate: false, ack: "ok" })),
    queue: async () => [],
    approve: async () => {
      throw new DecisionError(403, "only approvers can approve");
    },
    reject: async () => {
      throw new DecisionError(404, "no such item");
    },
    briefs: async () => [],
    setPaused: async (paused) => ({ ok: true, paused, dryRun: true, triage: "fake" }),
    syncMembers: async (m) => m.length,
    audit: async () => [],
    ...overrides,
  };
}

const TOKEN = "test-token-123";
const auth = { authorization: `Bearer ${TOKEN}` };

describe("core HTTP API", () => {
  it("serves /health without a token and rejects /api without one", async () => {
    const app = buildServer({ apiToken: TOKEN, owner: "UOWNER", services: fakeServices() });
    expect((await app.inject({ url: "/health" })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/status" })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/status", headers: { authorization: "Bearer wrong" } })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/status", headers: auth })).json()).toMatchObject({ ok: true });
  });

  it("validates intake bodies", async () => {
    const app = buildServer({ apiToken: TOKEN, owner: "UOWNER", services: fakeServices() });
    const res = await app.inject({ method: "POST", url: "/api/intake", headers: auth, payload: { source: "fax", nativeId: "1", author: "U", text: "x" } });
    expect(res.statusCode).toBe(400);
  });

  it("attributes Chrome requests to the owner, whatever author was sent", async () => {
    const services = fakeServices();
    const app = buildServer({ apiToken: TOKEN, owner: "UOWNER", services });
    const res = await app.inject({
      method: "POST",
      url: "/api/intake",
      headers: auth,
      payload: { source: "chrome", nativeId: "abc", author: "USOMEONE", text: "look at this", addressed: true },
    });
    expect(res.statusCode).toBe(200);
    expect(services.intake).toHaveBeenCalledWith(expect.objectContaining({ author: "UOWNER" }));
  });

  it("maps decision errors to HTTP codes", async () => {
    const app = buildServer({ apiToken: TOKEN, owner: "UOWNER", services: fakeServices() });
    expect((await app.inject({ method: "POST", url: "/api/items/x/approve", headers: auth, payload: { actor: "U1" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/items/x/reject", headers: auth, payload: { actor: "U1" } })).statusCode).toBe(404);
  });
});

describe("helpers", () => {
  it("replies in the original Slack thread when it is known, else DMs the requester", () => {
    expect(replyTarget({ source: "slack_shortcut", author: "U1", thread_key: "C123:1700000000.000100" })).toEqual({ channel: "C123", threadTs: "1700000000.000100" });
    expect(replyTarget({ source: "slack_command", author: "U1", thread_key: null })).toEqual({ channel: "U1" });
    expect(replyTarget({ source: "chrome", author: "U1", thread_key: null })).toBeNull();
  });

  it("builds a morning digest grouped by urgency", () => {
    const base = { source: "seed" as const, author: "U1", linkBack: null, gateDecision: "admit" as const, category: null, confidence: 0.9, proposedAction: null, createdAt: "" };
    const d = buildMorningDigest(
      [
        { ...base, id: "a", text: "Fix the export", status: "pending_approval", urgency: "today", reason: "ask" },
        { ...base, id: "b", text: "Release shipped", status: "fyi", urgency: "later", reason: "fyi" },
        { ...base, id: "c", text: "Add empty state", status: "pending_approval", urgency: "this_week", reason: "ask" },
      ],
      new Date("2026-11-09T13:00:00Z"),
      "America/New_York",
    );
    expect(d.title).toBe("Morning digest, Monday, Nov 9");
    expect(d.body.indexOf("Needs you today")).toBeLessThan(d.body.indexOf("FYI"));
    expect(d.body.indexOf("FYI")).toBeLessThan(d.body.indexOf("Can wait"));
    expect(buildMorningDigest([], new Date(), "UTC").body).toBe("Nothing waiting on you.");
  });
});
