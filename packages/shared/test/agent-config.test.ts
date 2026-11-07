import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { approversOf, loadAgentConfig, parseAgentConfig, tierFor } from "../src/agent-config.ts";

const minimal = { owner: { name: "Sam", slackUserId: "U0OWNER1" } };

describe("agent.config.json", () => {
  it("fills safe defaults from just an owner", () => {
    const cfg = parseAgentConfig(minimal);
    expect(cfg.slack.command).toBe("/ask");
    expect(cfg.sources.slack_command).toBe("explicit");
    expect(cfg.sources.slack_ambient).toBe("inferred");
    expect(cfg.sources.notes).toBe("ignore");
    expect(tierFor(cfg, "jira.create_issue")).toBe("send_with_approval");
    expect(tierFor(cfg, "something_new")).toBe("draft");
    expect(cfg.approvalTiers.promoteAfterCorrectRuns).toBe(5);
  });

  it("lets you rename the command and override one source", () => {
    const cfg = parseAgentConfig({ ...minimal, slack: { command: "/ask-sam" }, sources: { notes: "explicit" } });
    expect(cfg.slack.command).toBe("/ask-sam");
    expect(cfg.slack.appName).toBe("Chief of Staff");
    expect(cfg.sources.notes).toBe("explicit");
    expect(cfg.sources.chrome).toBe("explicit");
  });

  it("includes the owner and named approvers", () => {
    const cfg = parseAgentConfig({ ...minimal, team: { approverSlackUserIds: ["U0APPR01"] } });
    expect([...approversOf(cfg)].sort()).toEqual(["U0APPR01", "U0OWNER1"]);
  });

  it("rejects the reserved automatic tier, bad commands and bad ids", () => {
    expect(() => parseAgentConfig({ ...minimal, approvalTiers: { jobs: { "jira.create_issue": "automatic" } } })).toThrow(/approvalTiers/);
    expect(() => parseAgentConfig({ ...minimal, slack: { command: "ask" } })).toThrow(/slack.command/);
    expect(() => parseAgentConfig({ owner: { name: "Sam", slackUserId: "sam" } })).toThrow(/owner.slackUserId/);
  });

  it("fails at load time when a skill pack folder is missing", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "agent-config-"));
    mkdirSync(path.join(dir, "skills", "packs", "marketing"), { recursive: true });
    const file = path.join(dir, "agent.config.json");
    writeFileSync(file, JSON.stringify({ ...minimal, skillPacks: ["marketing"] }));
    expect(loadAgentConfig(file).skillPacks).toEqual(["marketing"]);
    writeFileSync(file, JSON.stringify({ ...minimal, skillPacks: ["sales"] }));
    expect(() => loadAgentConfig(file)).toThrow(/skills\/packs\/sales/);
  });

  it("the committed agent.config.json is valid", () => {
    const root = path.resolve(import.meta.dirname, "../../..");
    const cfg = loadAgentConfig(path.join(root, "agent.config.json"));
    expect(cfg.slack.command).toBe("/ask");
    expect(cfg.skillPacks).toEqual(["marketing"]);
  });
});
