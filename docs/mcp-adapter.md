# Messenger bus adapter

The bus is optional. It lets your other apps hear about what this system does, for example through an MCP server you already run, a queue or a webhook. Postgres stays the source of truth.

## How it fits

- Every state change writes a `bus.publish` row to the outbox, in the same transaction as the change.
- The outbox dispatcher calls `MessengerBus.publish(event)`. If the bus is down, the row retries with backoff. Nothing is lost and nothing blocks.
- With `DRY_RUN=true` the dispatcher only logs bus events.

## The interface

`packages/core/src/bus/types.ts`:

- `publish(event: BusEvent): Promise<void>` is required.
- `subscribe(topic, handler)` is optional. Inbound events are a source like any other: send them through `POST /api/intake` so the gate checks them. Never let a bus message grant permissions.
- `close()` is optional.

`BusEvent` carries `type`, a stable `id` for dedupe, `at`, `subjectId` and a small `data` object. It never carries raw message text.

## To wire it up

1. Implement `McpMessengerBus.publish` in `packages/core/src/bus/index.ts` against your MCP server's own publish tool (or replace it with a webhook or queue client). This repo does not guess its tool names or schema.
2. Set `MESSENGER_BUS=mcp` and `DRY_RUN=false`.
3. Throw on failure. The outbox handles retries; swallowing errors would drop events.

Events published today: `item.created`, `item.approved`. Add more by enqueueing a `bus.publish` outbox row next to the change.
