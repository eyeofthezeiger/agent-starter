import type { BusEvent, MessengerBus } from "./types.ts";

export type { BusEvent, MessengerBus } from "./types.ts";

export class NoopBus implements MessengerBus {
  readonly name = "none";
  async publish(): Promise<void> {}
}

export class LogBus implements MessengerBus {
  readonly name = "log";
  constructor(private readonly log: (msg: string) => void = console.log) {}
  async publish(event: BusEvent): Promise<void> {
    this.log(`[bus] ${event.type} ${event.subjectId ?? ""} ${JSON.stringify(event.data)}`);
  }
}

/**
 * Placeholder for your messenger MCP. Fill in `publish` with a call to your
 * MCP server's publish tool. Kept as a throw so it can't silently drop events.
 */
export class McpMessengerBus implements MessengerBus {
  readonly name = "mcp";
  async publish(_event: BusEvent): Promise<void> {
    throw new Error("McpMessengerBus is not implemented. See docs/mcp-adapter.md.");
  }
}

export function createBus(kind: "none" | "log" | "mcp"): MessengerBus {
  if (kind === "none") return new NoopBus();
  if (kind === "mcp") return new McpMessengerBus();
  return new LogBus();
}
