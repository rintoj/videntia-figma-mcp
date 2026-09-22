import {
  formatCompact,
  formatSummary,
  hasMotion,
  reactionCount,
} from "../../../src/videntia_figma_mcp/utils/compact-node";

/**
 * Interactions and motion used to be invisible to every read: get_node_info
 * and get_content_tree never mentioned them, so an agent had to already
 * suspect a node was interactive to go looking. These flags close that gap.
 */
describe("reactionCount", () => {
  it("counts a full reactions array", () => {
    expect(reactionCount({ reactions: [{}, {}] })).toBe(2);
  });

  it("falls back to the serializer's _reactionCount", () => {
    expect(reactionCount({ _reactionCount: 3 })).toBe(3);
  });

  it("is zero for a node with no reactions", () => {
    expect(reactionCount({})).toBe(0);
    expect(reactionCount({ reactions: [] })).toBe(0);
  });
});

describe("hasMotion", () => {
  it("detects the serializer flag", () => {
    expect(hasMotion({ _hasMotion: true })).toBe(true);
  });

  it("detects applied animation styles", () => {
    expect(hasMotion({ animationStyles: [{ id: "as-1" }] })).toBe(true);
  });

  it("detects manual keyframe tracks", () => {
    expect(hasMotion({ manualKeyframeTracks: { OPACITY: { keyframes: [] } } })).toBe(true);
  });

  it("is false for a plain node", () => {
    expect(hasMotion({})).toBe(false);
    expect(hasMotion({ animationStyles: [], manualKeyframeTracks: {} })).toBe(false);
  });
});

describe("compact rendering", () => {
  const node = {
    id: "1:2",
    name: "CTA",
    type: "INSTANCE",
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    _reactionCount: 2,
    _hasMotion: true,
  };

  it("surfaces both flags on the compact line", () => {
    const line = formatCompact([node]);
    expect(line).toContain("reactions=2");
    expect(line).toContain("motion=yes");
  });

  it("surfaces both flags on the summary line", () => {
    const line = formatSummary([node]);
    expect(line).toContain("reactions=2");
    expect(line).toContain("motion=yes");
  });

  it("stays silent for a node with neither", () => {
    const line = formatCompact([{ id: "1:3", name: "Box", type: "FRAME", x: 0, y: 0, width: 10, height: 10 }]);
    expect(line).not.toContain("reactions=");
    expect(line).not.toContain("motion=");
  });
});
