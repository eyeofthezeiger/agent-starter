import type { Brief, CoreStatus, IntakeRequest, IntakeResponse, QueueItem } from "@cos/shared";

/** Talks to the core on localhost. Settings live in chrome.storage.local, set on the options page. */
export interface Settings {
  coreUrl: string;
  token: string;
}

export const DEFAULT_CORE_URL = "http://localhost:8787";

export async function getSettings(): Promise<Settings> {
  const s = await chrome.storage.local.get(["coreUrl", "token"]);
  return { coreUrl: (s.coreUrl as string) || DEFAULT_CORE_URL, token: (s.token as string) || "" };
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { coreUrl, token } = await getSettings();
  if (!token) throw new Error("Set the core API token in the extension options.");
  const res = await fetch(`${coreUrl.replace(/\/+$/, "")}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => "")}`.trim());
  return (await res.json()) as T;
}

export const api = {
  status: () => call<CoreStatus>("GET", "/api/status"),
  queue: () => call<{ items: QueueItem[] }>("GET", "/api/queue"),
  briefs: () => call<{ briefs: Brief[] }>("GET", "/api/briefs?limit=10"),
  intake: (req: IntakeRequest) => call<IntakeResponse>("POST", "/api/intake", req),
  approve: (id: string) => call<{ item: QueueItem }>("POST", `/api/items/${encodeURIComponent(id)}/approve`, { actor: "owner" }),
  reject: (id: string) => call<{ item: QueueItem }>("POST", `/api/items/${encodeURIComponent(id)}/reject`, { actor: "owner" }),
  setPaused: (paused: boolean) => call<CoreStatus>("POST", "/api/pause", { paused, actor: "owner" }),
};
