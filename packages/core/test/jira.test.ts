import { describe, expect, it, vi } from "vitest";
import { JiraClient } from "../src/atlassian/jira.ts";
import { AtlassianError } from "../src/atlassian/http.ts";

const auth = (fetchImpl: typeof fetch) => ({ baseUrl: "https://acme.atlassian.net/", email: "bot@acme.test", apiToken: "tok", fetchImpl });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("JiraClient", () => {
  it("creates an issue with basic auth, ADF description and the idempotency label", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ issues: [] })) // search by label: none yet
      .mockResolvedValueOnce(json({ id: "10001", key: "COS-1", self: "x" }));
    const jira = new JiraClient(auth(fetchImpl), "COS");

    const issue = await jira.createIssue({ summary: "Fix export", description: "line one\nline two", linkBack: "https://example.com/x", idempotencyLabel: "cos-abc" });

    expect(issue.key).toBe("COS-1");
    const [url, init] = fetchImpl.mock.calls[1]!;
    expect(url).toBe("https://acme.atlassian.net/rest/api/3/issue");
    expect((init!.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from("bot@acme.test:tok").toString("base64")}`);
    const body = JSON.parse(init!.body as string);
    expect(body.fields.project.key).toBe("COS");
    expect(body.fields.labels).toContain("cos-abc");
    expect(body.fields.description.type).toBe("doc");
    expect(body.fields.description.content).toHaveLength(3);
  });

  it("returns the existing issue instead of creating a duplicate on retry", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ issues: [{ id: "10001", key: "COS-1", fields: {} }] }));
    const jira = new JiraClient(auth(fetchImpl), "COS");
    const issue = await jira.createIssue({ summary: "s", description: "d", idempotencyLabel: "cos-abc" });
    expect(issue.key).toBe("COS-1");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("marks 429 and 5xx as retryable, 4xx as not", async () => {
    const jira429 = new JiraClient(auth(vi.fn<typeof fetch>().mockResolvedValue(new Response("slow down", { status: 429 }))), "COS");
    await expect(jira429.getIssue("COS-1")).rejects.toMatchObject({ retryable: true });
    const jira400 = new JiraClient(auth(vi.fn<typeof fetch>().mockResolvedValue(new Response("bad", { status: 400 }))), "COS");
    await expect(jira400.getIssue("COS-1")).rejects.toBeInstanceOf(AtlassianError);
    await expect(jira400.getIssue("COS-1")).rejects.toMatchObject({ retryable: false });
  });
});
