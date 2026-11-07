import type { IntakeRequest } from "@cos/shared";

/**
 * Pure mappers from Slack payloads to core intake requests. Kept separate from
 * Bolt so they can be tested without a Slack connection.
 */
export interface SlashCommandLike {
  user_id: string;
  channel_id: string;
  text: string;
  trigger_id: string;
}

export function fromSlashCommand(cmd: SlashCommandLike): IntakeRequest | null {
  const text = cmd.text.trim();
  if (!text) return null;
  return {
    source: "slack_command",
    // trigger_id is unique per invocation, so a double submit is stored once.
    nativeId: cmd.trigger_id,
    author: cmd.user_id,
    text,
    addressed: true,
    // No message ts for a slash command: replies go to the requester's DM.
    threadKey: undefined,
  };
}

export interface MessageShortcutLike {
  user: { id: string };
  channel: { id: string };
  message: { ts: string; thread_ts?: string; text?: string; user?: string };
}

export function fromMessageShortcut(sc: MessageShortcutLike, permalink?: string): IntakeRequest | null {
  const text = (sc.message.text ?? "").trim();
  if (!text) return null;
  const ts = sc.message.ts;
  return {
    source: "slack_shortcut",
    nativeId: `${sc.channel.id}:${ts}`,
    // The person who pressed the shortcut is the requester; the gate checks them.
    author: sc.user.id,
    text: sc.message.user && sc.message.user !== sc.user.id ? `${text}\n\n(forwarded from <@${sc.message.user}>)` : text,
    addressed: true,
    linkBack: permalink,
    threadKey: `${sc.channel.id}:${sc.message.thread_ts ?? ts}`,
    sourceTs: new Date(Number(ts.split(".")[0]) * 1000).toISOString(),
  };
}
