import { createPool, migrate } from "./db.ts";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const db = createPool(url);
const ran = await migrate(db);
console.log(ran.length ? `Applied: ${ran.join(", ")}` : "Nothing to apply.");
await db.end();
