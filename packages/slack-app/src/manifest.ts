import type { AgentConfig } from "@cos/shared/agent-config";

/**
 * Builds the Slack app manifest from manifest.json (the template) and
 * agent.config.json, so the command name, app name and copy match your setup.
 * Scopes and settings always come from the template.
 */
export interface SlackManifest {
  display_information: { name: string; description: string; background_color?: string };
  features: {
    bot_user: { display_name: string; always_online: boolean };
    slash_commands: { command: string; description: string; usage_hint?: string; should_escape?: boolean }[];
    shortcuts: { name: string; type: string; callback_id: string; description: string }[];
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export function buildManifest(template: SlackManifest, cfg: AgentConfig): SlackManifest {
  const m = structuredClone(template);
  delete m._comment; // ours, not Slack's: Slack rejects unknown keys
  const who = cfg.owner.name;
  m.display_information.name = cfg.slack.appName;
  m.features.bot_user.display_name = cfg.slack.botDisplayName;
  const [cmd] = m.features.slash_commands;
  if (!cmd) throw new Error("manifest.json template has no slash command");
  m.features.slash_commands = [{ ...cmd, command: cfg.slack.command, description: `Send ${who} a request. It lands in a reviewed queue.` }];
  m.features.shortcuts = m.features.shortcuts.map((s) =>
    s.callback_id === "send_to_queue" ? { ...s, description: `Send this message to ${who}'s request queue` } : s,
  );
  return m;
}
