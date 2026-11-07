import { describe, expect, it, vi } from "vitest";
import { CoreApiError, CoreClient } from "../src/client.ts";

describe("CoreClient", () => {
  it("sends the bearer token and JSON body", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "x", decision: "admit", duplicate: false, ack: "ok" })));
    const client = new CoreClient({ baseUrl: "http://localhost:8787/", token: "t0k", fetchImpl });

    const res = await client.intake({ source: "chrome", nativeId: "n1", author: "U1", text: "hi" });

    expect(res.id).toBe("x");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:8787/api/intake");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer t0k");
    expect(JSON.parse(init.body as string)).toMatchObject({ nativeId: "n1" });
  });

  it("throws CoreApiError on a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 401 }));
    const client = new CoreClient({ baseUrl: "http://x", token: "bad", fetchImpl });
    await expect(client.status()).rejects.toBeInstanceOf(CoreApiError);
  });
});
