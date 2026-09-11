import { isSameFile } from "../../../src/socket-channel-identity";

describe("isSameFile", () => {
  it("matches when both sides share the same fileKey", () => {
    expect(isSameFile({ fileKey: "abc123", fileName: "A" }, { fileKey: "abc123", fileName: "B" })).toBe(true);
  });

  it("does not match when fileKeys differ", () => {
    expect(isSameFile({ fileKey: "abc123", fileName: "Same" }, { fileKey: "xyz789", fileName: "Same" })).toBe(false);
  });

  it("falls back to fileName when neither side has a fileKey", () => {
    expect(isSameFile({ fileName: "Untitled" }, { fileName: "Untitled" })).toBe(true);
    expect(isSameFile({ fileName: "Untitled" }, { fileName: "Other" })).toBe(false);
  });

  it("does not match on fileName alone when one side has a fileKey and the other doesn't", () => {
    // Known limitation: during a mixed-version rollout window, an old plugin build
    // that never sends fileKey won't be recognized as the same file as a new build
    // that does — even when fileName matches. This favors never conflating two
    // genuinely different files (the original collision bug) over deduping this
    // transient, self-resolving case.
    expect(isSameFile({ fileName: "Same" }, { fileKey: "abc123", fileName: "Same" })).toBe(false);
    expect(isSameFile({ fileKey: "abc123", fileName: "Same" }, { fileName: "Same" })).toBe(false);
  });

  it("treats empty fileName as never matching", () => {
    expect(isSameFile({}, {})).toBe(false);
    expect(isSameFile({ fileName: "" }, { fileName: "" })).toBe(false);
  });
});
