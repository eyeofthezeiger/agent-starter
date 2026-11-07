export interface AtlassianAuth {
  baseUrl: string;
  email: string;
  apiToken: string;
  fetchImpl?: typeof fetch;
}

export class AtlassianError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "AtlassianError";
  }
}

/** Basic-auth JSON request against Atlassian Cloud REST. 429 and 5xx are marked retryable for the outbox. */
export async function atlassianRequest<T>(auth: AtlassianAuth, method: string, path: string, body?: unknown): Promise<T> {
  const doFetch = auth.fetchImpl ?? fetch;
  const url = `${auth.baseUrl.replace(/\/+$/, "")}${path}`;
  const res = await doFetch(url, {
    method,
    headers: {
      authorization: `Basic ${Buffer.from(`${auth.email}:${auth.apiToken}`).toString("base64")}`,
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new AtlassianError(res.status, `${method} ${path} -> ${res.status} ${text.slice(0, 300)}`, res.status === 429 || res.status >= 500);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
