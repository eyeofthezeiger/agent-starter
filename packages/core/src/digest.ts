import type { QueueItem } from "@cos/shared";

/**
 * Morning digest, built from the queue with plain code (no model). Three
 * groups: needs you today, FYI, can wait. Each line has a link and a one-line reason.
 */
export function buildMorningDigest(items: QueueItem[], now: Date, timeZone: string): { title: string; body: string } {
  const day = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "short", day: "numeric" }).format(now);
  const waiting = items.filter((i) => i.status === "pending_approval" || i.status === "needs_answer");
  const today = waiting.filter((i) => i.urgency === "today");
  const later = waiting.filter((i) => i.urgency !== "today");
  const fyi = items.filter((i) => i.status === "fyi");

  const line = (i: QueueItem) => {
    const text = (i.text ?? "").replace(/\s+/g, " ").slice(0, 100);
    const link = i.linkBack ? ` <${i.linkBack}|open>` : "";
    return `• ${text}${link} — ${i.reason ?? i.status}`;
  };
  const section = (name: string, list: QueueItem[]) => (list.length ? [`*${name}* (${list.length})`, ...list.map(line)] : []);

  const parts = [...section("Needs you today", today), ...section("FYI", fyi), ...section("Can wait", later)];
  return {
    title: `Morning digest, ${day}`,
    body: parts.length ? parts.join("\n") : "Nothing waiting on you.",
  };
}
