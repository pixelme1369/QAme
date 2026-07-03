import { describe, expect, it } from "vitest";
import { attributeSpeakers } from "./speaker-attribution.js";

describe("attributeSpeakers", () => {
  it("identifies the agent by script phrases", () => {
    const result = attributeSpeakers([
      { speaker: "A", start: 0, end: 1000, text: "Hello?", confidence: 0.9 },
      {
        speaker: "B",
        start: 1000,
        end: 6000,
        text: "Hi, my name is Jordan calling from Acme Energy on a recorded line.",
        confidence: 0.9,
      },
      { speaker: "A", start: 6000, end: 8000, text: "Not interested, stop calling.", confidence: 0.9 },
    ]);
    expect(result.agentLabel).toBe("B");
    expect(result.roleFor("B")).toBe("agent");
    expect(result.roleFor("A")).toBe("customer");
  });

  it("falls back to talk share when phrases are absent", () => {
    const result = attributeSpeakers([
      { speaker: "A", start: 0, end: 1000, text: "Yes.", confidence: null },
      {
        speaker: "B",
        start: 1000,
        end: 9000,
        text: "So what we do is review the plan you have today and see whether the promotion fits your usage over the last twelve months.",
        confidence: null,
      },
    ]);
    expect(result.agentLabel).toBe("B");
  });

  it("treats a single-speaker recording as agent-only", () => {
    const result = attributeSpeakers([
      { speaker: "A", start: 0, end: 5000, text: "Hi, this message is for Sam...", confidence: null },
    ]);
    expect(result.agentLabel).toBe("A");
    expect(result.roleFor("A")).toBe("agent");
  });

  it("handles empty utterance lists", () => {
    const result = attributeSpeakers([]);
    expect(result.agentLabel).toBeNull();
    expect(result.roleFor("A")).toBe("unknown");
  });
});
