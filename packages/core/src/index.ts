import { existsSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.ts";
import { createPool, migrate } from "./db.ts";
import { createBus } from "./bus/index.ts";
import { createTriage } from "./triage/index.ts";
import { createJobHandlers, createOnSent } from "./handlers.ts";
import { createSenders } from "./senders.ts";
import { createServices } from "./services.ts";
import { buildServer } from "./server.ts";
import { runDueJobs } from "./jobs.ts";
import { dispatchOutbox } from "./outbox.ts";
import { setPaused } from "./pause.ts";
import { syncSourceTrust } from "./gate.ts";
import { tickScheduler, type ScheduleSpec } from "./scheduler.ts";

const cfg = loadConfig();
if (!existsSync(path.join(cfg.agent.rootDir ?? process.cwd(), cfg.agent.owner.contextFile))) {
  console.warn(`No context file at ${cfg.agent.owner.contextFile}. Copy context/person.template.md there (make setup does it).`);
}
if (cfg.owner === "U00000000") console.warn("owner.slackUserId in agent.config.json is still the example value.");
if (cfg.CORE_API_TOKEN === "change-me") console.warn("CORE_API_TOKEN is still the example value. Generate one: openssl rand -hex 32");

const db = createPool(cfg.DATABASE_URL);
const applied = await migrate(db);
if (applied.length) console.log(`migrations applied: ${applied.join(", ")}`);
if (cfg.START_PAUSED) await setPaused(db, true, "system:start_paused");
await syncSourceTrust(db, cfg.agent.sources);

const triage = createTriage(cfg);
const bus = createBus(cfg.MESSENGER_BUS);
const handlers = createJobHandlers(db, cfg, triage);
const senders = createSenders(cfg, bus);
const onSent = createOnSent();

const schedules: ScheduleSpec[] = [
  { name: "sweep", jobType: "sweep", everyMinutes: cfg.SWEEP_INTERVAL_MINUTES },
  { name: "morning_digest", jobType: "morning_digest", dailyAt: cfg.MORNING_DIGEST_AT },
  { name: "retention", jobType: "retention", dailyAt: "03:00" },
];

// Background loops. Each one catches its own errors so one bad tick never kills the process.
const loops: NodeJS.Timeout[] = [];
const every = (ms: number, name: string, fn: () => Promise<unknown>) => {
  let running = false;
  loops.push(
    setInterval(async () => {
      if (running) return;
      running = true;
      try {
        await fn();
      } catch (err) {
        console.error(`[${name}]`, err);
      } finally {
        running = false;
      }
    }, ms),
  );
};
every(1_000, "jobs", () => runDueJobs(db, handlers));
every(1_000, "outbox", () => dispatchOutbox(db, senders, onSent));
every(30_000, "scheduler", () => tickScheduler(db, schedules, new Date(), cfg.TZ));

const app = buildServer({ apiToken: cfg.CORE_API_TOKEN, owner: cfg.owner, services: createServices(db, cfg, triage.name), logger: true });
await app.listen({ host: cfg.CORE_HOST, port: cfg.CORE_PORT });
console.log(`core up for ${cfg.agent.owner.name}: triage=${triage.name} dryRun=${cfg.DRY_RUN} bus=${bus.name} packs=${["core", ...cfg.agent.skillPacks].join(",")}`);

const shutdown = async () => {
  loops.forEach(clearInterval);
  await app.close();
  await bus.close?.();
  await db.end();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
