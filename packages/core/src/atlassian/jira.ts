import { textToAdf } from "./adf.ts";
import { atlassianRequest, type AtlassianAuth } from "./http.ts";

/**
 * Jira Cloud REST v3 client for the service user. Scope it to one project.
 * Agents that need richer Jira access use the Atlassian MCP instead; the core
 * only needs these calls.
 */
export interface CreateIssueInput {
  summary: string;
  description: string;
  linkBack?: string;
  labels?: string[];
  /** Sent as a label so a retried create can be found instead of duplicated. */
  idempotencyLabel?: string;
}

export interface JiraIssueRef {
  id: string;
  key: string;
  self: string;
}

export class JiraClient {
  constructor(
    private readonly auth: AtlassianAuth,
    private readonly projectKey: string,
    private readonly issueType = "Task",
  ) {}

  async createIssue(input: CreateIssueInput): Promise<JiraIssueRef> {
    if (input.idempotencyLabel) {
      const existing = await this.findByLabel(input.idempotencyLabel);
      if (existing) return existing;
    }
    const labels = [...(input.labels ?? []), ...(input.idempotencyLabel ? [input.idempotencyLabel] : [])];
    return atlassianRequest<JiraIssueRef>(this.auth, "POST", "/rest/api/3/issue", {
      fields: {
        project: { key: this.projectKey },
        issuetype: { name: this.issueType },
        summary: input.summary.slice(0, 250),
        description: textToAdf(input.description, input.linkBack ? { href: input.linkBack, label: "Source" } : undefined),
        labels,
      },
    });
  }

  getIssue(key: string): Promise<{ key: string; fields: Record<string, unknown> }> {
    return atlassianRequest(this.auth, "GET", `/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,status,labels`);
  }

  async transition(key: string, transitionName: string): Promise<void> {
    const { transitions } = await atlassianRequest<{ transitions: { id: string; name: string }[] }>(
      this.auth,
      "GET",
      `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`,
    );
    const match = transitions.find((t) => t.name.toLowerCase() === transitionName.toLowerCase());
    if (!match) throw new Error(`No transition "${transitionName}" on ${key}. Available: ${transitions.map((t) => t.name).join(", ")}`);
    await atlassianRequest(this.auth, "POST", `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, { transition: { id: match.id } });
  }

  addComment(key: string, text: string): Promise<{ id: string }> {
    return atlassianRequest(this.auth, "POST", `/rest/api/3/issue/${encodeURIComponent(key)}/comment`, { body: textToAdf(text) });
  }

  /** Enhanced JQL search endpoint. */
  async search(jql: string, maxResults = 20): Promise<{ issues: { id: string; key: string; fields: Record<string, unknown> }[] }> {
    return atlassianRequest(this.auth, "POST", "/rest/api/3/search/jql", { jql, maxResults, fields: ["summary", "status", "labels"] });
  }

  private async findByLabel(label: string): Promise<JiraIssueRef | null> {
    const safe = label.replace(/[^A-Za-z0-9_-]/g, "");
    const res = await this.search(`project = "${this.projectKey}" AND labels = "${safe}"`, 1);
    const hit = res.issues[0];
    return hit ? { id: hit.id, key: hit.key, self: "" } : null;
  }
}
