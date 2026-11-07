import type { Brief, QueueItem } from "@cos/shared";
import { api } from "./api.ts";
import { timeAgo } from "./format.ts";

/**
 * Side panel: the queue and the latest briefs. All message text is untrusted,
 * so it is only ever set with textContent, never innerHTML.
 */
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const statusEl = $("#status");
const errorEl = $("#error");
const listEl = $("#list");
const pauseBtn = $<HTMLButtonElement>("#pause");
let tab: "queue" | "briefs" = "queue";
let paused = false;

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function renderItem(item: QueueItem): HTMLElement {
  const card = el("article", "card");
  card.append(el("p", "text", item.text ?? "(no text stored)"));
  const meta = [item.status.replace("_", " "), item.urgency, item.confidence !== null ? `${Math.round(item.confidence * 100)}%` : null, item.source, timeAgo(item.createdAt)];
  card.append(el("p", "meta", meta.filter(Boolean).join(" · ")));
  if (item.proposedAction) card.append(el("p", "proposed", item.proposedAction.summary));
  if (item.linkBack) {
    const a = el("a", "link", "Open source") as HTMLAnchorElement;
    a.href = item.linkBack;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    card.append(a);
  }
  if (item.status === "pending_approval" || item.status === "needs_answer") {
    const row = el("div", "actions");
    const ok = el("button", "primary", "Approve");
    const no = el("button", "", "Reject");
    ok.onclick = () => decide(() => api.approve(item.id));
    no.onclick = () => decide(() => api.reject(item.id));
    row.append(ok, no);
    card.append(row);
  }
  return card;
}

function renderBrief(b: Brief): HTMLElement {
  const card = el("article", "card");
  card.append(el("h3", "", b.title), el("pre", "brief", b.body), el("p", "meta", timeAgo(b.createdAt)));
  return card;
}

async function decide(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    showError(err);
  }
  await refresh();
}

function showError(err: unknown) {
  errorEl.textContent = err instanceof Error ? err.message : String(err);
  errorEl.hidden = false;
}

async function refresh() {
  errorEl.hidden = true;
  try {
    const status = await api.status();
    paused = status.paused;
    statusEl.textContent = `${paused ? "Paused" : "Running"}${status.dryRun ? " · dry run" : ""} · triage: ${status.triage}`;
    pauseBtn.textContent = paused ? "Resume" : "Pause";
    listEl.replaceChildren();
    if (tab === "queue") {
      const { items } = await api.queue();
      listEl.append(...(items.length ? items.map(renderItem) : [el("p", "empty", "Nothing waiting on you.")]));
    } else {
      const { briefs } = await api.briefs();
      listEl.append(...(briefs.length ? briefs.map(renderBrief) : [el("p", "empty", "No briefs yet.")]));
    }
  } catch (err) {
    statusEl.textContent = "Can't reach the core on localhost.";
    showError(err);
  }
}

document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) => {
  b.onclick = () => {
    tab = b.dataset.tab as typeof tab;
    document.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("active", x === b));
    void refresh();
  };
});
pauseBtn.onclick = () => decide(() => api.setPaused(!paused));
$("#options").onclick = () => chrome.runtime.openOptionsPage();
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "queue-changed") void refresh();
});

void refresh();
setInterval(refresh, 15_000);
