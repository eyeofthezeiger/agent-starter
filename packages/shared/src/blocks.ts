import type { Brief, QueueItem } from "./types.ts";

/**
 * Slack Block Kit builders. Pure functions so they can be unit tested and
 * shared by the core (approval DMs) and the Slack app (App Home).
 */
export const ACTION_APPROVE = "cos_approve";
export const ACTION_REJECT = "cos_reject";
export const ACTION_PAUSE_TOGGLE = "cos_pause_toggle";

type Block = Record<string, unknown>;

const STATUS_LABEL: Record<string, string> = {
  pending_approval: "Needs approval",
  needs_answer: "Needs your answer",
  new: "Waiting for triage",
};

/** Slack mrkdwn needs &, < and > escaped in user text. */
export function escapeMrkdwn(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function itemBlocks(item: QueueItem): Block[] {
  const text = escapeMrkdwn(truncate((item.text ?? "(no text stored)").replace(/\s+/g, " "), 280));
  const link = item.linkBack ? ` <${item.linkBack}|source>` : "";
  const meta = [
    STATUS_LABEL[item.status] ?? item.status,
    item.urgency ? `urgency: ${item.urgency}` : null,
    item.confidence !== null ? `confidence: ${Math.round(item.confidence * 100)}%` : null,
    `from <@${item.author}> via ${item.source}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const blocks: Block[] = [
    { type: "section", text: { type: "mrkdwn", text: `${text}${link}` } },
    { type: "context", elements: [{ type: "mrkdwn", text: meta }] },
  ];
  if (item.proposedAction) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Proposed:* ${escapeMrkdwn(item.proposedAction.summary)}` } });
  }
  if (item.status === "pending_approval" || item.status === "needs_answer") {
    blocks.push({
      type: "actions",
      block_id: `item:${truncate(item.id, 200)}`,
      elements: [
        { type: "button", style: "primary", text: { type: "plain_text", text: "Approve" }, action_id: ACTION_APPROVE, value: item.id },
        { type: "button", style: "danger", text: { type: "plain_text", text: "Reject" }, action_id: ACTION_REJECT, value: item.id },
      ],
    });
  }
  return blocks;
}

export function homeView(items: QueueItem[], briefs: Brief[], paused: boolean): { type: "home"; blocks: Block[] } {
  const blocks: Block[] = [
    { type: "header", text: { type: "plain_text", text: "Chief of staff queue" } },
    {
      type: "section",
      text: { type: "mrkdwn", text: paused ? ":double_vertical_bar: *Paused.* Intake and logging continue; no actions run." : "Running." },
      accessory: {
        type: "button",
        action_id: ACTION_PAUSE_TOGGLE,
        text: { type: "plain_text", text: paused ? "Resume" : "Pause" },
        value: paused ? "resume" : "pause",
        ...(paused ? {} : { style: "danger" }),
      },
    },
    { type: "divider" },
  ];
  if (!items.length) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "Nothing waiting on you." } });
  }
  // Slack caps a view at 100 blocks; keep room for briefs.
  for (const item of items.slice(0, 15)) {
    blocks.push(...itemBlocks(item), { type: "divider" });
  }
  if (briefs.length) {
    blocks.push({ type: "header", text: { type: "plain_text", text: "Latest briefs" } });
    for (const b of briefs.slice(0, 3)) {
      blocks.push({ type: "section", text: { type: "mrkdwn", text: `*${escapeMrkdwn(b.title)}*\n${truncate(b.body, 2500)}` } });
    }
  }
  return { type: "home", blocks };
}
