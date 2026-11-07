import type { Brief, CoreStatus, IntakeRequest, IntakeResponse, ItemStatus, QueueItem } from "./types.ts";

export interface CoreClientOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}

export class CoreApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CoreApiError";
  }
}

/** Small typed client for the core HTTP API. Used by the Slack app and the extension. */
export class CoreClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: CoreClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
  }

  status(): Promise<CoreStatus> {
    return this.request("GET", "/api/status");
  }

  intake(req: IntakeRequest): Promise<IntakeResponse> {
    return this.request("POST", "/api/intake", req);
  }

  queue(statuses?: ItemStatus[]): Promise<{ items: QueueItem[] }> {
    const q = statuses?.length ? `?status=${statuses.join(",")}` : "";
    return this.request("GET", `/api/queue${q}`);
  }

  approve(id: string, actor: string): Promise<{ item: QueueItem }> {
    return this.request("POST", `/api/items/${encodeURIComponent(id)}/approve`, { actor });
  }

  reject(id: string, actor: string, note?: string): Promise<{ item: QueueItem }> {
    return this.request("POST", `/api/items/${encodeURIComponent(id)}/reject`, { actor, note });
  }

  briefs(limit = 10): Promise<{ briefs: Brief[] }> {
    return this.request("GET", `/api/briefs?limit=${limit}`);
  }

  setPaused(paused: boolean, actor: string): Promise<CoreStatus> {
    return this.request("POST", "/api/pause", { paused, actor });
  }

  syncGateMembers(members: string[]): Promise<{ count: number }> {
    return this.request("PUT", "/api/gate/members", { members });
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new CoreApiError(res.status, `${method} ${path} failed: ${res.status} ${text}`.trim());
    }
    return (await res.json()) as T;
  }
}
