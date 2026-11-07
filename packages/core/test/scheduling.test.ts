import { describe, expect, it } from "vitest";
import { backoffMs } from "../src/backoff.ts";
import { dueSlots, localParts } from "../src/scheduler.ts";

describe("backoff", () => {
  it("doubles per attempt and caps at max", () => {
    const fixed = { jitter: 0, baseMs: 1000, maxMs: 10_000 };
    expect([1, 2, 3, 4, 5, 6].map((a) => backoffMs(a, fixed))).toEqual([1000, 2000, 4000, 8000, 10_000, 10_000]);
  });

  it("stays inside the jitter band", () => {
    for (let i = 0; i < 50; i++) {
      const v = backoffMs(3, { baseMs: 1000, jitter: 0.2 });
      expect(v).toBeGreaterThanOrEqual(3200);
      expect(v).toBeLessThanOrEqual(4800);
    }
  });
});

describe("scheduler", () => {
  const tz = "America/New_York";
  const specs = [
    { name: "sweep", jobType: "sweep", everyMinutes: 60 },
    { name: "digest", jobType: "morning_digest", dailyAt: "08:00" },
  ];

  it("reads local time in the configured zone", () => {
    // 12:30 UTC on Nov 9 2026 is 07:30 in New York (EST, UTC-5).
    expect(localParts(new Date("2026-11-09T12:30:00Z"), tz)).toEqual({ date: "2026-11-09", hhmm: "07:30" });
  });

  it("does not fire the daily job before its time", () => {
    const slots = dueSlots(specs, new Date("2026-11-09T12:30:00Z"), tz);
    expect(slots.map((s) => s.name)).toEqual(["sweep"]);
  });

  it("fires the daily job once per local day after its time", () => {
    const a = dueSlots(specs, new Date("2026-11-09T13:05:00Z"), tz).find((s) => s.name === "digest");
    const b = dueSlots(specs, new Date("2026-11-09T20:00:00Z"), tz).find((s) => s.name === "digest");
    expect(a?.slotKey).toBe("digest:2026-11-09");
    expect(b?.slotKey).toBe(a?.slotKey);
  });

  it("gives interval jobs a new slot each interval", () => {
    const a = dueSlots(specs, new Date("2026-11-09T13:05:00Z"), tz)[0]!.slotKey;
    const b = dueSlots(specs, new Date("2026-11-09T13:55:00Z"), tz)[0]!.slotKey;
    const c = dueSlots(specs, new Date("2026-11-09T14:05:00Z"), tz)[0]!.slotKey;
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });
});
