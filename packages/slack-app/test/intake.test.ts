import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fromMessageShortcut, fromSlashCommand } from "../src/intake.ts";
import { buildManifest } from "../src/manifest.ts";
import { parseAgentConfig } from "@cos/shared/agent-config";

describe("slash command mapping", () => {
  it("maps the slash command to an addressed request keyed by trigger id", () => {
    expect(fromSlashCommand({ user_id: "U1", channel_id: "C1", text: "  review the pricing copy  ", trigger_id: "123.456" })).toEqual({
      source: "slack_command",
      nativeId: "123.456",
      author: "U1",
      text: "review the pricing copy",
      addressed: true,
      threadKey: undefined,
    });
  });

  it("ignores an empty command", () => {
    expect(fromSlashCommand({ user_id: "U1", channel_id: "C1", text: "   ", trigger_id: "t" })).toBeNull();
  });
});

describe("message shortcut mapping", () => {
  it("keys by channel and ts, keeps the thread and credits the original author", () => {
    const req = fromMessageShortcut(
      { user: { id: "U1" }, channel: { id: "C9" }, message: { ts: "1700000000.000200", thread_ts: "1700000000.000100", text: "the deploy is failing", user: "U2" } },
      "https://example.slack.com/archives/C9/p1700000000000200",
    );
    expect(req).toMatchObject({
      source: "slack_shortcut",
      nativeId: "C9:1700000000.000200",
      author: "U1",
      threadKey: "C9:1700000000.000100",
      linkBack: "https://example.slack.com/archives/C9/p1700000000000200",
    });
    expect(req!.text).toContain("forwarded from <@U2>");
  });
});

describe("manifest.json", () => {
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));

  it("uses Socket Mode and declares the command, shortcut and App Home", () => {
    expect(manifest.settings.socket_mode_enabled).toBe(true);
    expect(manifest.features.slash_commands[0].command).toBe("/ask");
    expect(manifest.features.shortcuts[0].callback_id).toBe("send_to_queue");
    expect(manifest.features.app_home.home_tab_enabled).toBe(true);
  });

  it("asks only for the scopes in the security baseline", () => {
    expect(manifest.oauth_config.scopes.bot.sort()).toEqual(["chat:write", "commands", "im:write", "usergroups:read", "users:read"]);
  });
});

describe("buildManifest", () => {
  const template = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));

  it("takes the command and names from agent.config.json and keeps the scopes", () => {
    const cfg = parseAgentConfig({ owner: { name: "Sam", slackUserId: "U0OWNER1" }, slack: { command: "/ask-sam", appName: "Sam's Desk" } });
    const m = buildManifest(template, cfg);
    expect(m.features.slash_commands[0]).toMatchObject({ command: "/ask-sam", description: "Send Sam a request. It lands in a reviewed queue." });
    expect(m.display_information.name).toBe("Sam's Desk");
    expect(m.features.shortcuts[0]!.description).toContain("Sam's request queue");
    expect(m.oauth_config).toEqual(template.oauth_config);
    expect(m).not.toHaveProperty("_comment");
    expect(template.features.slash_commands[0].command).toBe("/ask");
  });
});
