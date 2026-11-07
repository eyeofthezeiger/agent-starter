import { atlassianRequest, type AtlassianAuth } from "./http.ts";

/**
 * Read-mostly Confluence Cloud client. Per the security baseline the service
 * user reads named spaces and writes to one space; the space allowlist is
 * enforced here too, not only by Confluence permissions.
 */
export class ConfluenceClient {
  constructor(
    private readonly auth: AtlassianAuth,
    private readonly readableSpaces: string[],
  ) {}

  getPage(pageId: string): Promise<{ id: string; title: string; spaceId: string; body?: { storage?: { value: string } } }> {
    return atlassianRequest(this.auth, "GET", `/api/v2/pages/${encodeURIComponent(pageId)}?body-format=storage`);
  }

  /** CQL search limited to the allowed spaces. */
  search(text: string, limit = 10): Promise<{ results: { content?: { id: string; title: string }; url?: string }[] }> {
    if (!this.readableSpaces.length) throw new Error("No readable Confluence spaces configured");
    const spaces = this.readableSpaces.map((s) => `"${s.replace(/"/g, "")}"`).join(",");
    const cql = `space in (${spaces}) AND text ~ "${text.replace(/["\\]/g, " ")}"`;
    return atlassianRequest(this.auth, "GET", `/rest/api/search?cql=${encodeURIComponent(cql)}&limit=${limit}`);
  }
}
