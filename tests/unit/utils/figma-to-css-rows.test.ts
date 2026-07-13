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

describe("buildRows — auto-layout ↔ flexbox rows", () => {
  const flexFrame = {
    id: "10:1",
    type: "FRAME",
    layoutMode: "HORIZONTAL",
    primaryAxisAlignItems: "CENTER",
    counterAxisAlignItems: "CENTER",
    itemSpacing: 12,
    absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 60 },
  };

  const byProp = (rows: any[]) => new Map(rows.map((r) => [r.property, r]));

  it("emits no layout rows unless options.layout is set", () => {
    const { rows } = buildRows(flexFrame as any, { display: "flex", "flex-direction": "row" }, undefined, {
      properties: ["gap"],
    });
    expect(rows.find((r) => r.property === "layout-mode")).toBeUndefined();
  });

  it("matches flex row implementation of HORIZONTAL auto-layout", () => {
    const { rows } = buildRows(
      flexFrame as any,
      { display: "flex", "flex-direction": "row", "justify-content": "center", "align-items": "center" },
      undefined,
      { properties: ["gap"], layout: true },
    );
    const m = byProp(rows);
    expect(m.get("layout-mode")).toMatchObject({ status: "✓" });
    expect(m.get("justify-content")).toMatchObject({ status: "✓" });
    expect(m.get("align-items")).toMatchObject({ status: "✓" });
  });

  it("flags wrong flex-direction as an error", () => {
    const { rows } = buildRows(flexFrame as any, { display: "flex", "flex-direction": "column" }, undefined, {
      properties: ["gap"],
      layout: true,
    });
    expect(byProp(rows).get("layout-mode")).toMatchObject({ status: "❌", severity: "error" });
  });

  it("flags block display for an auto-layout frame", () => {
    const { rows } = buildRows(flexFrame as any, { display: "block" }, undefined, {
      properties: ["gap"],
      layout: true,
    });
    expect(byProp(rows).get("layout-mode")).toMatchObject({ status: "❌", severity: "error" });
  });

  it("treats grid implementation as a warning, not an error", () => {
    const { rows } = buildRows(flexFrame as any, { display: "grid", gap: "12px" }, undefined, {
      properties: ["gap"],
      layout: true,
    });
    const row = byProp(rows).get("layout-mode");
    expect(row).toMatchObject({ status: "❌", severity: "warn" });
    expect(row?.note).toMatch(/grid/);
    // Alignment rows are skipped for grid.
    expect(byProp(rows).get("justify-content")).toBeUndefined();
  });

  it("skips layout rows entirely for layoutMode NONE", () => {
    const frame = { ...flexFrame, layoutMode: "NONE" };
    const { rows } = buildRows(frame as any, { display: "block" }, undefined, {
      properties: ["gap"],
      layout: true,
    });
    expect(rows.find((r) => r.property === "layout-mode")).toBeUndefined();
  });

  it("normalizes justify-content 'normal' to flex-start and start/end keywords", () => {
    const frame = { ...flexFrame, primaryAxisAlignItems: "MIN" };
    const { rows } = buildRows(frame as any, { display: "flex", "flex-direction": "row" }, undefined, {
      properties: ["gap"],
      layout: true,
    });
    expect(byProp(rows).get("justify-content")).toMatchObject({ status: "✓", figma: "flex-start" });
  });

  it("accepts CSS default stretch for Figma MIN counter-axis with a note", () => {
    const frame = { ...flexFrame, counterAxisAlignItems: "MIN" };
    const { rows } = buildRows(
      frame as any,
      { display: "flex", "flex-direction": "row", "align-items": "stretch" },
      undefined,
      { properties: ["gap"], layout: true },
    );
    const row = byProp(rows).get("align-items");
    expect(row).toMatchObject({ status: "✓" });
    expect(row?.note).toMatch(/stretch/);
  });

  it("flags missing flex-wrap when Figma wraps", () => {
    const frame = { ...flexFrame, layoutWrap: "WRAP" };
    const { rows } = buildRows(
      frame as any,
      { display: "flex", "flex-direction": "row", "flex-wrap": "nowrap" },
      undefined,
      {
        properties: ["gap"],
        layout: true,
      },
    );
    expect(byProp(rows).get("flex-wrap")).toMatchObject({ status: "❌", severity: "error" });
  });

  it("emits no flex-wrap row when both sides are nowrap", () => {
    const { rows } = buildRows(
      flexFrame as any,
      { display: "flex", "flex-direction": "row", "flex-wrap": "nowrap" },
      undefined,
      {
        properties: ["gap"],
        layout: true,
      },
    );
    expect(byProp(rows).get("flex-wrap")).toBeUndefined();
  });
});

describe("buildRows — semantic equivalences (real HomeVault failure modes)", () => {
  // FM2: Tailwind `inset-ring-1 inset-ring-neutral-300` renders the border as an
  // inset box-shadow — border-width computes 0 despite a visible 1px ring.
  const pill = {
    id: "3082:47273",
    type: "INSTANCE",
    strokeWeight: 1,
    strokes: [{ type: "SOLID", color: { r: 0.8157, g: 0.8, b: 0.7686 } }], // #d0ccc4 gold-200
    cornerRadius: 999,
    layoutSizingHorizontal: "HUG",
    absoluteBoundingBox: { x: 283, y: 20, width: 234, height: 32 },
  };

  it("FM2: matches a stroke implemented as an inset box-shadow ring", () => {
    const { rows } = buildRows(
      pill as any,
      {
        "border-width": "0px",
        "box-shadow": "rgb(208, 204, 196) 0px 0px 0px 1px inset",
      },
      undefined,
      { properties: ["border-width", "border-color"] },
    );
    const byProp = new Map(rows.map((r) => [r.property, r]));
    expect(byProp.get("border-width")).toMatchObject({ status: "✓" });
    expect(byProp.get("border-width")?.note).toMatch(/ring/);
    expect(byProp.get("border-color")).toMatchObject({ status: "✓", figma: "#d0ccc4" });
  });

  it("FM2 variant: ring with the WRONG color still flags border-color", () => {
    const { rows } = buildRows(
      pill as any,
      {
        "border-width": "0px",
        // neutral-300 #e2e1df instead of gold-200 — the real HomeVault bug.
        "box-shadow": "rgb(226, 225, 223) 0px 0px 0px 1px inset",
      },
      undefined,
      { properties: ["border-width", "border-color"] },
    );
    const byProp = new Map(rows.map((r) => [r.property, r]));
    expect(byProp.get("border-width")).toMatchObject({ status: "✓" });
    expect(byProp.get("border-color")).toMatchObject({ status: "❌", figma: "#d0ccc4", browser: "#e2e1df" });
  });

  it("FM2 negative: no ring present keeps the plain border mismatch", () => {
    const { rows } = buildRows(pill as any, { "border-width": "0px", "box-shadow": "none" }, undefined, {
      properties: ["border-width"],
    });
    expect(rows[0]).toMatchObject({ status: "❌", figma: "1px", browser: "0px" });
  });

  it("FM2 negative: an outset shadow is not treated as a ring", () => {
    const { rows } = buildRows(
      pill as any,
      { "border-width": "0px", "box-shadow": "rgb(208, 204, 196) 0px 4px 8px 0px" },
      undefined,
      { properties: ["border-width"] },
    );
    expect(rows[0]).toMatchObject({ status: "❌" });
  });

  // FM3: Figma TEXT CENTER vs CSS text-align:left on a flex-centered element.
  const centeredText = {
    id: "t1",
    type: "TEXT",
    fontSize: 12,
    textAlignHorizontal: "CENTER",
    absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 24 },
  };

  it("FM3: accepts text-align left when the element itself flex-centers", () => {
    const { rows } = buildRows(
      centeredText as any,
      { "text-align": "left", display: "inline-flex", "justify-content": "center" },
      undefined,
      { properties: ["text-align"] },
    );
    expect(rows[0]).toMatchObject({ status: "✓" });
    expect(rows[0].note).toMatch(/flex/);
  });

  it("FM3: accepts text-align left when the PARENT flex-centers (column axis)", () => {
    const { rows } = buildRows(centeredText as any, { "text-align": "left", display: "block" }, undefined, {
      properties: ["text-align"],
      parentStyles: { display: "flex", "flex-direction": "column", "align-items": "center" },
    });
    expect(rows[0]).toMatchObject({ status: "✓" });
  });

  it("FM3 negative: text-align left with no flex centering stays a mismatch", () => {
    const { rows } = buildRows(centeredText as any, { "text-align": "left", display: "block" }, undefined, {
      properties: ["text-align"],
      parentStyles: { display: "block" },
    });
    expect(rows[0]).toMatchObject({ status: "❌" });
  });

  // FM6: hug-content width drift is a warning, not an error.
  it("FM6: softens width mismatch to warn for HUG-sized nodes", () => {
    const { rows } = buildRows(
      pill as any,
      { width: "228.40625px" },
      { width: 228.40625, height: 32 },
      {
        properties: ["width"],
      },
    );
    expect(rows[0]).toMatchObject({ status: "❌", severity: "warn" });
    expect(rows[0].note).toMatch(/hug/);
  });

  it("FM6 negative: fixed-width nodes keep width mismatches as errors", () => {
    const fixed = { ...pill, layoutSizingHorizontal: "FIXED" };
    const { rows } = buildRows(
      fixed as any,
      { width: "228px" },
      { width: 228, height: 32 },
      {
        properties: ["width"],
      },
    );
    expect(rows[0]).toMatchObject({ status: "❌" });
    expect(rows[0].severity).toBeUndefined();
  });
});

describe("buildRows — variable token names", () => {
  it("renders the bound variable name next to the hex on stroke rows", () => {
    const pill = {
      id: "3082:47273",
      type: "INSTANCE",
      strokeWeight: 1,
      strokes: [{ type: "SOLID", color: { r: 0.8157, g: 0.8, b: 0.7686 } }],
      bindings: { "strokes/0": { id: "VariableID:1", name: "gold-200" } },
      absoluteBoundingBox: { x: 0, y: 0, width: 234, height: 32 },
    };
    const { rows } = buildRows(
      pill as any,
      { "border-color": "rgb(226, 225, 223)", "border-width": "1px" },
      undefined,
      {
        properties: ["border-color"],
      },
    );
    expect(rows[0]).toMatchObject({ status: "❌", figma: "gold-200 (#d0ccc4)", browser: "#e2e1df" });
  });

  it("renders text fill token names from the TEXT node's own bindings", () => {
    const text = {
      id: "t1",
      type: "TEXT",
      fontSize: 14,
      fills: [{ type: "SOLID", color: { r: 0.031, g: 0.231, b: 0.22 } }],
      bindings: { "fills/0": { id: "VariableID:2", name: "brand-900" } },
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 20 },
    };
    const { rows } = buildRows(text as any, { color: "rgb(0, 0, 0)" }, undefined, { properties: ["color"] });
    expect(rows[0].figma).toBe("brand-900 (#083b38)");
    expect(rows[0].status).toBe("❌");
  });

  it("perceptually-identical colors pass without token noise", () => {
    const text = {
      id: "t2",
      type: "TEXT",
      fontSize: 14,
      fills: [{ type: "SOLID", color: { r: 0.031, g: 0.231, b: 0.22 } }],
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 20 },
    };
    const { rows } = buildRows(text as any, { color: "rgb(8, 59, 55)" }, undefined, { properties: ["color"] });
    expect(rows[0].status).toBe("✓");
  });
});

describe("buildRows — layout rows skipped without computed display", () => {
  it("emits no layout rows when the caller's property set excludes display", () => {
    const flexFrame = {
      id: "10:9",
      type: "FRAME",
      layoutMode: "HORIZONTAL",
      primaryAxisAlignItems: "CENTER",
      absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 40 },
    };
    const { rows } = buildRows(flexFrame as any, { "border-width": "1px" }, undefined, {
      properties: ["border-width"],
      layout: true,
    });
    expect(rows.find((r) => r.property === "layout-mode")).toBeUndefined();
    expect(rows.find((r) => r.property === "justify-content")).toBeUndefined();
  });
});
