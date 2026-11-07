import type { IntakeRequest } from "@cos/shared";

/** Pure helpers, unit tested without Chrome. */

export interface ClickInfo {
  pageUrl?: string;
  linkUrl?: string;
  selectionText?: string;
  pageTitle?: string;
}

/** FNV-1a, enough to make a stable id for "this text on this page". */
export function stableId(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Only http(s) pages go to the queue. Strips the fragment, which can carry tokens. */
export function cleanUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
    u.hash = "";
    return u.toString();
  } catch {
    return undefined;
  }
}

export function intakeFromClick(info: ClickInfo): IntakeRequest | null {
  const link = cleanUrl(info.linkUrl) ?? cleanUrl(info.pageUrl);
  const selection = info.selectionText?.trim();
  const text = selection || (info.linkUrl ? `Link: ${info.linkUrl}` : info.pageTitle?.trim() || link);
  if (!text) return null;
  return {
    source: "chrome",
    nativeId: stableId(`${link ?? ""}\n${text}`),
    author: "owner", // the core attributes Chrome requests to the token holder
    text: text.slice(0, 40_000),
    linkBack: link,
    addressed: true,
  };
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}
