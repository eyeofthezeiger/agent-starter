import { describe, expect, it } from "vitest";
import { ACTION_APPROVE, ACTION_REJECT, escapeMrkdwn, homeView, itemBlocks } from "../src/blocks.ts";
import type { QueueItem } from "../src/types.ts";

const item: QueueItem = {
  id: "slack_command:abc",
  source: "slack_command",
  author: "U1",
  text: "Fix <script> & ship",
  linkBack: null,
  status: "pending_approval",
  gateDecision: "admit",
  category: "work_task",
  urgency: "today",
  confidence: 0.85,
  reason: "ask",
  proposedAction: { kind: "jira.create_issue", summary: "Create Jira ticket: Fix it", tier: "send_with_approval" },
  createdAt: "2026-11-07T00:00:00Z",
};

describe("Block Kit builders", () => {
  it("escapes user text", () => {
    expect(escapeMrkdwn("a <b> & c")).toBe("a &lt;b&gt; &amp; c");
  });

  it("adds approve and reject buttons carrying the item id", () => {
    const actions = itemBlocks(item).find((b) => b.type === "actions") as { elements: { action_id: string; value: string }[] };
    expect(actions.elements.map((e) => e.action_id)).toEqual([ACTION_APPROVE, ACTION_REJECT]);
    expect(actions.elements.every((e) => e.value === item.id)).toBe(true);
  });

  it("shows no buttons once decided", () => {
    expect(itemBlocks({ ...item, status: "approved" }).some((b) => b.type === "actions")).toBe(false);
  });

  it("keeps the App Home under Slack's 100-block limit", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ ...item, id: `x:${i}` }));
    expect(homeView(many, [], false).blocks.length).toBeLessThanOrEqual(100);
    expect(JSON.stringify(homeView([], [], true))).toContain("Paused");
  });
});
