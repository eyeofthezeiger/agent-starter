import { describe, expect, it } from "vitest";
import type { Trust } from "@cos/shared";
import { decide, type GatePolicy } from "../src/gate.ts";

const policy: GatePolicy = {
  owner: "UOWNER",
  members: new Set(["UMEMBER"]),
  trust: new Map<string, Trust>([
    ["slack_command", "explicit"],
    ["slack_ambient", "inferred"],
    ["slack_dm", "ignore"],
  ]),
};

describe("gate", () => {
  it("admits an allowed member on an explicit, addressed source", () => {
    expect(decide({ source: "slack_command", author: "UMEMBER", addressed: true, lane: "work" }, policy).decision).toBe("admit");
  });

  it("always allows the owner", () => {
    expect(decide({ source: "slack_command", author: "UOWNER", addressed: true, lane: "work" }, policy).decision).toBe("admit");
  });

  it("rejects anyone outside the user group, whatever the text says", () => {
    const r = decide({ source: "slack_command", author: "USTRANGER", addressed: true, lane: "work" }, policy);
    expect(r.decision).toBe("reject");
  });

  it("observes inferred sources and unaddressed messages", () => {
    expect(decide({ source: "slack_ambient", author: "UMEMBER", addressed: true, lane: "work" }, policy).decision).toBe("observe");
    expect(decide({ source: "slack_command", author: "UMEMBER", addressed: false, lane: "work" }, policy).decision).toBe("observe");
  });

  it("rejects ignored and unknown sources", () => {
    expect(decide({ source: "slack_dm", author: "UOWNER", addressed: true, lane: "work" }, policy).decision).toBe("reject");
    expect(decide({ source: "notes", author: "UOWNER", addressed: true, lane: "work" }, policy).decision).toBe("reject");
  });

  it("never lets the personal lane into the work core", () => {
    expect(decide({ source: "slack_command", author: "UOWNER", addressed: true, lane: "personal" }, policy).decision).toBe("reject");
  });
});
