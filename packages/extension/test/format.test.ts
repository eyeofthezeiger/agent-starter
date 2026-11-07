import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { cleanUrl, intakeFromClick, stableId, timeAgo } from "../src/format.ts";

describe("extension helpers", () => {
  it("makes the same id for the same text on the same page", () => {
    expect(stableId("a")).toBe(stableId("a"));
    expect(stableId("a")).not.toBe(stableId("b"));
  });

  it("drops fragments and non-http pages", () => {
    expect(cleanUrl("https://x.test/p?q=1#access_token=abc")).toBe("https://x.test/p?q=1");
    expect(cleanUrl("chrome://settings")).toBeUndefined();
    expect(cleanUrl("not a url")).toBeUndefined();
  });

  it("queues a selection with a link back to the page", () => {
    const req = intakeFromClick({ pageUrl: "https://docs.test/spec#s2", selectionText: "  Need a decision on SSO  " });
    expect(req).toMatchObject({ source: "chrome", text: "Need a decision on SSO", linkBack: "https://docs.test/spec", addressed: true });
  });

  it("falls back to the page title, and refuses an empty click", () => {
    expect(intakeFromClick({ pageUrl: "https://a.test", pageTitle: "Roadmap" })?.text).toBe("Roadmap");
    expect(intakeFromClick({})).toBeNull();
  });

  it("formats relative times", () => {
    const now = Date.parse("2026-11-07T12:00:00Z");
    expect(timeAgo("2026-11-07T11:59:30Z", now)).toBe("just now");
    expect(timeAgo("2026-11-07T11:00:00Z", now)).toBe("1h ago");
  });
});

describe("extension manifest", () => {
  const m = JSON.parse(readFileSync(new URL("../static/manifest.json", import.meta.url), "utf8"));
  it("is MV3 with a side panel and only localhost host access", () => {
    expect(m.manifest_version).toBe(3);
    expect(m.side_panel.default_path).toBe("sidepanel.html");
    expect(m.host_permissions.every((h: string) => /^http:\/\/(localhost|127\.0\.0\.1):8787\//.test(h))).toBe(true);
  });
});
