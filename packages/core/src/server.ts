import { timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import type { ItemStatus } from "@cos/shared";
import { SOURCES } from "@cos/shared/agent-config";
import { DecisionError, type CoreServices } from "./services.ts";

const STATUSES = ["new", "pending_approval", "needs_answer", "approved", "rejected", "context", "fyi", "dropped"] as const;

const intakeSchema = z.object({
  source: z.enum(SOURCES),
  nativeId: z.string().min(1).max(500),
  author: z.string().min(1).max(100),
  text: z.string().min(1).max(40_000),
  linkBack: z.string().url().max(2000).optional(),
  lane: z.enum(["work", "personal"]).optional(),
  addressed: z.boolean().optional(),
  threadKey: z.string().max(200).optional(),
  refs: z.array(z.string().max(500)).max(50).optional(),
  sourceTs: z.string().datetime().optional(),
});

const actorSchema = z.object({ actor: z.string().min(1), note: z.string().max(1000).optional() });
const pauseSchema = z.object({ paused: z.boolean(), actor: z.string().min(1) });
const membersSchema = z.object({ members: z.array(z.string().max(30)).max(5000) });

export interface ServerOptions {
  apiToken: string;
  /** The owner's Slack id. Chrome requests come from the token holder, so they are attributed to the owner. */
  owner: string;
  services: CoreServices;
  logger?: boolean;
}

function tokenMatches(header: string | undefined, expected: string): boolean {
  const given = Buffer.from((header ?? "").replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
}

export function buildServer(opts: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 256 * 1024 });
  const s = opts.services;

  app.get("/health", async () => ({ ok: true }));

  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;
    if (!tokenMatches(req.headers.authorization, opts.apiToken)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof DecisionError) return reply.code(err.code).send({ error: err.message });
    if (err instanceof z.ZodError) return reply.code(400).send({ error: "invalid request", issues: err.issues });
    app.log.error(err);
    return reply.code(500).send({ error: "internal error" });
  });

  app.get("/api/status", () => s.status());

  app.post("/api/intake", async (req) => {
    const body = intakeSchema.parse(req.body);
    if (body.source === "chrome") body.author = opts.owner;
    return s.intake(body);
  });

  app.get("/api/queue", async (req) => {
    const raw = (req.query as { status?: string }).status;
    const statuses = raw ? z.array(z.enum(STATUSES)).parse(raw.split(",")) : undefined;
    return { items: await s.queue(statuses as ItemStatus[] | undefined) };
  });

  app.post("/api/items/:id/approve", async (req) => {
    const { actor } = actorSchema.parse(req.body);
    return { item: await s.approve((req.params as { id: string }).id, resolveActor(actor, opts.owner)) };
  });

  app.post("/api/items/:id/reject", async (req) => {
    const { actor, note } = actorSchema.parse(req.body);
    return { item: await s.reject((req.params as { id: string }).id, resolveActor(actor, opts.owner), note) };
  });

  app.get("/api/briefs", async (req) => {
    const limit = Number((req.query as { limit?: string }).limit ?? 10) || 10;
    return { briefs: await s.briefs(limit) };
  });

  app.post("/api/pause", async (req) => {
    const { paused, actor } = pauseSchema.parse(req.body);
    return s.setPaused(paused, resolveActor(actor, opts.owner));
  });

  app.put("/api/gate/members", async (req) => {
    const { members } = membersSchema.parse(req.body);
    return { count: await s.syncMembers(members) };
  });

  app.get("/api/audit", async (req) => {
    const limit = Number((req.query as { limit?: string }).limit ?? 50) || 50;
    return { entries: await s.audit(limit) };
  });

  return app;
}

/** The extension acts as the token holder ("owner"). Slack passes the real user id. */
function resolveActor(actor: string, owner: string): string {
  return actor === "owner" ? owner : actor;
}
