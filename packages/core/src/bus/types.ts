/**
 * The messenger bus: how this system tells your other apps that something
 * happened. Postgres stays the source of truth. The bus only gets copies, sent
 * through the outbox, so a bus outage never loses or blocks anything.
 *
 * Implement `MessengerBus` against your messenger MCP server. See
 * docs/mcp-adapter.md. The shape below is deliberately small so it does not
 * assume anything about the MCP server's own tool names or schema.
 */
export interface BusEvent {
  /** Dotted event name, e.g. "item.created", "item.approved", "brief.created". */
  type: string;
  /** Stable id for this event, so the receiver can dedupe. */
  id: string;
  at: string;
  subjectId?: string;
  /** Small, non-sensitive summary. Never raw message text. */
  data: Record<string, unknown>;
}

export interface MessengerBus {
  readonly name: string;
  publish(event: BusEvent): Promise<void>;
  /** Optional: receive events from other apps. Inbound events go through the gate like any source. */
  subscribe?(topic: string, handler: (event: BusEvent) => Promise<void>): Promise<() => Promise<void>>;
  close?(): Promise<void>;
}
