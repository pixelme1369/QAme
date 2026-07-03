import { describe, expect, it } from "vitest";
import { parseRecordingPath } from "./recording-path.js";

describe("parseRecordingPath", () => {
  it("parses the standard recording path", () => {
    const parsed = parseRecordingPath("acme-123/2026-07-03/20260703-142530_15551234567-all.mp3");
    expect(parsed).not.toBeNull();
    expect(parsed!.accountExternalId).toBe("acme-123");
    expect(parsed!.phoneNumber).toBe("15551234567");
    expect(parsed!.recordedAt.toISOString()).toBe("2026-07-03T14:25:30.000Z");
  });

  it("handles phone numbers with symbols", () => {
    const parsed = parseRecordingPath("a/2026-01-01/20260101-000000_+1 (555) 123-4567-all.mp3");
    expect(parsed?.phoneNumber).toBe("+1 (555) 123-4567");
  });

  it("ignores non-mixdown and unrelated objects", () => {
    expect(parseRecordingPath("acme/2026-07-03/20260703-142530_555-agent.mp3")).toBeNull();
    expect(parseRecordingPath("acme/2026-07-03/notes.txt")).toBeNull();
    expect(parseRecordingPath("random.mp3")).toBeNull();
  });

  it("rejects malformed timestamps", () => {
    expect(parseRecordingPath("a/2026-07-03/2026073-1425_555-all.mp3")).toBeNull();
  });
});
