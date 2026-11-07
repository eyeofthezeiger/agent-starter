import { readFileSync, writeFileSync } from "node:fs";
import { loadAgentConfig } from "@cos/shared/agent-config";
import { buildManifest, type SlackManifest } from "./manifest.ts";

// npm run slack:manifest -> packages/slack-app/manifest.generated.json, ready to paste into Slack.
const template = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")) as SlackManifest;
const out = new URL("../manifest.generated.json", import.meta.url);
writeFileSync(out, `${JSON.stringify(buildManifest(template, loadAgentConfig()), null, 2)}\n`);
console.log(`Wrote ${out.pathname}. Paste it into api.slack.com/apps > Create New App > From a manifest.`);
