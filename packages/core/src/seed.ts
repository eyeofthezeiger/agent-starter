import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, migrate } from "./db.ts";
import { replaceMembers } from "./gate.ts";
import { intake } from "./inbox.ts";
import { loadEvalSet } from "./evalset.ts";
import { loadAgentConfig } from "@cos/shared/agent-config";

/**
 * Loads synthetic data: gate members, the 20 eval requests as inbox items,
 * and a sample meeting brief. Safe to run twice: items are stored once by id.
 * The running core triages the new items within a few seconds.
 */
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const owner = loadAgentConfig().owner.slackUserId;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const seed = JSON.parse(await readFile(path.join(root, "seed/seed.json"), "utf8")) as {
  gateMembers: string[];
  briefs: { kind: string; title: string; body: string }[];
};

const db = createPool(url);
await migrate(db);
await replaceMembers(db, seed.gateMembers);

let created = 0;
for (const c of await loadEvalSet()) {
  const res = await intake(db, owner, {
    source: "seed",
    nativeId: c.id,
    author: c.author,
    text: c.text,
    addressed: true,
    linkBack: `https://example.com/synthetic/${c.id}`,
  });
  if (!res.duplicate) created++;
}

for (const b of seed.briefs) {
  await db.query(
    `INSERT INTO briefs (kind, title, body) SELECT $1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM briefs WHERE title = $2)`,
    [b.kind, b.title, b.body],
  );
}

console.log(`seeded: ${seed.gateMembers.length} gate members, ${created} new inbox items, ${seed.briefs.length} brief(s)`);
await db.end();
