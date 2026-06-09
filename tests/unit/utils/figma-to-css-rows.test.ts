import { buildRows } from "../../../src/videntia_figma_mcp/utils/figma-to-css-rows";

describe("buildRows — text-align normalization", () => {
  it("treats Figma 'LEFT' as equivalent to browser 'start'", () => {
    const figma = {
      id: "1",
      type: "TEXT",
      fontSize: 14,
      textAlignHorizontal: "LEFT",
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 24 },
    };
    const { rows } = buildRows(figma as any, { "text-align": "start" }, undefined, {
      properties: ["text-align"],
    });
    expect(rows[0]).toMatchObject({ property: "text-align", status: "✓" });
  });

  it("treats Figma 'RIGHT' as equivalent to browser 'end'", () => {
    const figma = {
      id: "1",
      type: "TEXT",
      fontSize: 14,
      textAlignHorizontal: "RIGHT",
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 24 },
    };
    const { rows } = buildRows(figma as any, { "text-align": "end" }, undefined, {
      properties: ["text-align"],
    });
    expect(rows[0]).toMatchObject({ status: "✓" });
  });

  it("still flags an actual mismatch", () => {
    const figma = {
      id: "1",
      type: "TEXT",
      fontSize: 14,
      textAlignHorizontal: "LEFT",
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 24 },
    };
    const { rows } = buildRows(figma as any, { "text-align": "center" }, undefined, {
      properties: ["text-align"],
    });
    expect(rows[0]).toMatchObject({ status: "❌" });
  });
});

describe("buildRows — width/height skipped for TEXT nodes by default", () => {
  const figma = {
    id: "1",
    type: "TEXT",
    fontSize: 14,
    absoluteBoundingBox: { x: 0, y: 0, width: 350, height: 24 },
  };

  it("emits '—' for width on TEXT when properties not specified", () => {
    const { rows } = buildRows(figma as any, { width: "337px" }, { width: 337, height: 24 });
    const widthRow = rows.find((r) => r.property === "width");
    expect(widthRow?.status).toBe("—");
    expect(widthRow?.note).toMatch(/TEXT/);
  });

  it("emits '—' for height on TEXT when properties not specified", () => {
    const { rows } = buildRows(figma as any, { height: "24px" }, { width: 337, height: 24 });
    const heightRow = rows.find((r) => r.property === "height");
    expect(heightRow?.status).toBe("—");
  });

  it("compares width on TEXT when caller explicitly listed it", () => {
    const { rows } = buildRows(
      figma as any,
      { width: "350px" },
      { width: 350, height: 24 },
      {
        properties: ["width"],
      },
    );
    expect(rows[0]).toMatchObject({ property: "width", status: "✓" });
  });

  it("still compares width on non-TEXT nodes", () => {
    const frame = {
      id: "1",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 320, height: 180 },
    };
    const { rows } = buildRows(
      frame as any,
      { width: "320px" },
      { width: 320, height: 180 },
      {
        properties: ["width"],
      },
    );
    expect(rows[0]).toMatchObject({ status: "✓" });
  });
});
