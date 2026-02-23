import { convertToJsx } from "../../../src/claude_figma_mcp/utils/figma-to-jsx";
import type { FigmaNodeData } from "../../../src/claude_figma_mcp/types/index";

function makeNode(overrides: Partial<FigmaNodeData> = {}): FigmaNodeData {
  return {
    id: "1:1",
    name: "TestNode",
    type: "FRAME",
    visible: true,
    ...overrides,
  };
}

describe("convertToJsx", () => {
  // --- Basic ---

  it("should return empty string for empty array", () => {
    expect(convertToJsx([])).toBe("");
  });

  it("should render a single empty frame as self-closing div", () => {
    const jsx = convertToJsx([makeNode()]);
    expect(jsx).toContain('<div id="1:1" name="TestNode" />');
  });

  it("should skip invisible nodes", () => {
    const jsx = convertToJsx([makeNode({ visible: false })]);
    expect(jsx).toBe("");
  });

  it("should skip invisible children", () => {
    const jsx = convertToJsx([
      makeNode({
        children: [
          makeNode({ id: "1:2", name: "Visible", visible: true }),
          makeNode({ id: "1:3", name: "Hidden", visible: false }),
        ],
      }),
    ]);
    expect(jsx).toContain("Visible");
    expect(jsx).not.toContain("Hidden");
  });

  // --- Layout ---

  it("should render horizontal auto-layout", () => {
    const jsx = convertToJsx([makeNode({ layoutMode: "HORIZONTAL" })]);
    expect(jsx).toContain("flex flex-row");
  });

  it("should render vertical auto-layout", () => {
    const jsx = convertToJsx([makeNode({ layoutMode: "VERTICAL" })]);
    expect(jsx).toContain("flex flex-col");
  });

  it("should render relative for non-layout container with children", () => {
    const jsx = convertToJsx([
      makeNode({
        children: [makeNode({ id: "1:2", name: "Child" })],
      }),
    ]);
    expect(jsx).toContain("relative");
  });

  it("should render justify-center for CENTER primary alignment", () => {
    const jsx = convertToJsx([makeNode({ layoutMode: "HORIZONTAL", primaryAxisAlignItems: "CENTER" })]);
    expect(jsx).toContain("justify-center");
  });

  it("should render justify-end for MAX primary alignment", () => {
    const jsx = convertToJsx([makeNode({ layoutMode: "HORIZONTAL", primaryAxisAlignItems: "MAX" })]);
    expect(jsx).toContain("justify-end");
  });

  it("should render justify-between for SPACE_BETWEEN", () => {
    const jsx = convertToJsx([makeNode({ layoutMode: "HORIZONTAL", primaryAxisAlignItems: "SPACE_BETWEEN" })]);
    expect(jsx).toContain("justify-between");
  });

  it("should omit justify-start for MIN primary alignment", () => {
    const jsx = convertToJsx([makeNode({ layoutMode: "HORIZONTAL", primaryAxisAlignItems: "MIN" })]);
    expect(jsx).not.toContain("justify-");
  });

  it("should render items-center for CENTER counter alignment", () => {
    const jsx = convertToJsx([makeNode({ layoutMode: "HORIZONTAL", counterAxisAlignItems: "CENTER" })]);
    expect(jsx).toContain("items-center");
  });

  it("should render items-end for MAX counter alignment", () => {
    const jsx = convertToJsx([makeNode({ layoutMode: "VERTICAL", counterAxisAlignItems: "MAX" })]);
    expect(jsx).toContain("items-end");
  });

  it("should render items-baseline for BASELINE counter alignment", () => {
    const jsx = convertToJsx([makeNode({ layoutMode: "HORIZONTAL", counterAxisAlignItems: "BASELINE" })]);
    expect(jsx).toContain("items-baseline");
  });

  it("should render flex-wrap for WRAP", () => {
    const jsx = convertToJsx([makeNode({ layoutMode: "HORIZONTAL", layoutWrap: "WRAP" })]);
    expect(jsx).toContain("flex-wrap");
  });

  it("should render gap for item spacing", () => {
    const jsx = convertToJsx([makeNode({ layoutMode: "HORIZONTAL", itemSpacing: 16 })]);
    expect(jsx).toContain("gap-[16px]");
  });

  it("should render gap with variable binding", () => {
    const jsx = convertToJsx([
      makeNode({
        layoutMode: "HORIZONTAL",
        itemSpacing: 16,
        bindings: { itemSpacing: "spacing/4" },
      }),
    ]);
    expect(jsx).toContain("gap-spacing-4");
  });

  it("should render counter axis spacing as gap-y for horizontal wrap", () => {
    const jsx = convertToJsx([
      makeNode({
        layoutMode: "HORIZONTAL",
        layoutWrap: "WRAP",
        itemSpacing: 8,
        counterAxisSpacing: 12,
      }),
    ]);
    expect(jsx).toContain("gap-y-[12px]");
  });

  it("should render counter axis spacing as gap-x for vertical wrap", () => {
    const jsx = convertToJsx([
      makeNode({
        layoutMode: "VERTICAL",
        layoutWrap: "WRAP",
        itemSpacing: 8,
        counterAxisSpacing: 16,
      }),
    ]);
    expect(jsx).toContain("gap-x-[16px]");
  });

  it("should render counter axis spacing with variable binding", () => {
    const jsx = convertToJsx([
      makeNode({
        layoutMode: "HORIZONTAL",
        layoutWrap: "WRAP",
        itemSpacing: 8,
        counterAxisSpacing: 12,
        bindings: { counterAxisSpacing: "spacing/3" },
      }),
    ]);
    expect(jsx).toContain("gap-y-spacing-3");
  });

  it("should render overflow-hidden for clipsContent", () => {
    const jsx = convertToJsx([makeNode({ clipsContent: true })]);
    expect(jsx).toContain("overflow-hidden");
  });

  it("should render absolute positioning", () => {
    const jsx = convertToJsx([makeNode({ layoutPositioning: "ABSOLUTE", x: 10, y: 20 })]);
    expect(jsx).toContain("absolute");
    expect(jsx).toContain("left-[10px]");
    expect(jsx).toContain("top-[20px]");
  });

  // --- Sizing ---

  it("should render fixed width", () => {
    const jsx = convertToJsx([makeNode({ layoutSizingHorizontal: "FIXED", width: 320 })]);
    expect(jsx).toContain("w-[320px]");
  });

  it("should render fixed height", () => {
    const jsx = convertToJsx([makeNode({ layoutSizingVertical: "FIXED", height: 200 })]);
    expect(jsx).toContain("h-[200px]");
  });

  it("should render flex-1 for FILL horizontal", () => {
    const jsx = convertToJsx([makeNode({ layoutSizingHorizontal: "FILL" })]);
    expect(jsx).toContain("flex-1");
  });

  it("should render flex-1 for FILL vertical (no horizontal fill)", () => {
    const jsx = convertToJsx([makeNode({ layoutSizingVertical: "FILL" })]);
    expect(jsx).toContain("flex-1");
  });

  it("should render h-full when both horizontal and vertical are FILL", () => {
    const jsx = convertToJsx([makeNode({ layoutSizingHorizontal: "FILL", layoutSizingVertical: "FILL" })]);
    expect(jsx).toContain("flex-1");
    expect(jsx).toContain("h-full");
  });

  it("should omit sizing for HUG", () => {
    const jsx = convertToJsx([makeNode({ layoutSizingHorizontal: "HUG", layoutSizingVertical: "HUG" })]);
    expect(jsx).not.toContain("w-");
    expect(jsx).not.toContain("h-");
    expect(jsx).not.toContain("flex-1");
  });

  // --- Padding ---

  it("should render uniform padding", () => {
    const jsx = convertToJsx([makeNode({ paddingTop: 16, paddingRight: 16, paddingBottom: 16, paddingLeft: 16 })]);
    expect(jsx).toContain("p-[16px]");
    expect(jsx).not.toContain("px-");
    expect(jsx).not.toContain("py-");
  });

  it("should render symmetric padding (px/py)", () => {
    const jsx = convertToJsx([makeNode({ paddingTop: 8, paddingRight: 16, paddingBottom: 8, paddingLeft: 16 })]);
    expect(jsx).toContain("px-[16px]");
    expect(jsx).toContain("py-[8px]");
  });

  it("should render individual padding", () => {
    const jsx = convertToJsx([makeNode({ paddingTop: 4, paddingRight: 8, paddingBottom: 12, paddingLeft: 16 })]);
    expect(jsx).toContain("pt-[4px]");
    expect(jsx).toContain("pr-[8px]");
    expect(jsx).toContain("pb-[12px]");
    expect(jsx).toContain("pl-[16px]");
  });

  it("should skip padding when all zero", () => {
    const jsx = convertToJsx([makeNode({ paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0 })]);
    expect(jsx).not.toContain("p-");
  });

  it("should render individual padding with variable bindings", () => {
    const jsx = convertToJsx([
      makeNode({
        paddingTop: 4,
        paddingRight: 8,
        paddingBottom: 12,
        paddingLeft: 16,
        bindings: {
          paddingTop: "spacing/1",
          paddingRight: "spacing/2",
          paddingBottom: "spacing/3",
          paddingLeft: "spacing/4",
        },
      }),
    ]);
    expect(jsx).toContain("pt-spacing-1");
    expect(jsx).toContain("pr-spacing-2");
    expect(jsx).toContain("pb-spacing-3");
    expect(jsx).toContain("pl-spacing-4");
  });

  it("should render padding with variable binding", () => {
    const jsx = convertToJsx([
      makeNode({
        paddingTop: 16,
        paddingRight: 16,
        paddingBottom: 16,
        paddingLeft: 16,
        bindings: { paddingTop: "spacing/4" },
      }),
    ]);
    expect(jsx).toContain("p-spacing-4");
  });

  // --- Colors ---

  it("should render bg color with variable binding", () => {
    const jsx = convertToJsx([
      makeNode({
        fills: [{ type: "SOLID", color: "#ff0000" }],
        bindings: { "fills/0": "primary" },
      }),
    ]);
    expect(jsx).toContain("bg-primary");
  });

  it("should render bg color without binding", () => {
    const jsx = convertToJsx([makeNode({ fills: [{ type: "SOLID", color: "#ff0000" }] })]);
    expect(jsx).toContain("bg-[#ff0000]");
  });

  it("should render text color with binding on TEXT node", () => {
    const jsx = convertToJsx([
      makeNode({
        type: "TEXT",
        characters: "Hello",
        fills: [{ type: "SOLID", color: "#000000" }],
        bindings: { "fills/0": "card-foreground" },
      }),
    ]);
    expect(jsx).toContain("text-card-foreground");
  });

  it("should render text color without binding on TEXT node", () => {
    const jsx = convertToJsx([
      makeNode({
        type: "TEXT",
        characters: "Hello",
        fills: [{ type: "SOLID", color: "#333333" }],
      }),
    ]);
    expect(jsx).toContain("text-[#333333]");
  });

  it("should render stroke color with binding", () => {
    const jsx = convertToJsx([
      makeNode({
        strokes: [{ type: "SOLID", color: "#cccccc" }],
        strokeWeight: 1,
        bindings: { "strokes/0": "border" },
      }),
    ]);
    expect(jsx).toContain("border-[1px]");
    expect(jsx).toContain("border-border");
  });

  it("should render stroke color without binding", () => {
    const jsx = convertToJsx([
      makeNode({
        strokes: [{ type: "SOLID", color: "#cccccc" }],
        strokeWeight: 2,
      }),
    ]);
    expect(jsx).toContain("border-[2px]");
    expect(jsx).toContain("border-[#cccccc]");
  });

  it("should render bg color with opacity modifier", () => {
    const jsx = convertToJsx([
      makeNode({
        fills: [{ type: "SOLID", color: "#000000", opacity: 0.5 }],
      }),
    ]);
    expect(jsx).toContain("bg-[#000000]/50");
  });

  it("should render text color with opacity modifier", () => {
    const jsx = convertToJsx([
      makeNode({
        type: "TEXT",
        characters: "T",
        fills: [{ type: "SOLID", color: "#000000", opacity: 0.3 }],
      }),
    ]);
    expect(jsx).toContain("text-[#000000]/30");
  });

  it("should not apply opacity modifier when fill has binding", () => {
    const jsx = convertToJsx([
      makeNode({
        fills: [{ type: "SOLID", color: "#000000", opacity: 0.5 }],
        bindings: { "fills/0": "muted" },
      }),
    ]);
    expect(jsx).toContain("bg-muted");
    expect(jsx).not.toContain("/50");
  });

  it("should not apply opacity modifier when opacity is 1", () => {
    const jsx = convertToJsx([
      makeNode({
        fills: [{ type: "SOLID", color: "#ff0000", opacity: 1 }],
      }),
    ]);
    expect(jsx).toContain("bg-[#ff0000]");
    expect(jsx).not.toContain("bg-[#ff0000]/");
  });

  it("should render bg-cover bg-center for image fills", () => {
    const jsx = convertToJsx([makeNode({ fills: [{ type: "IMAGE", isImage: true, imageRef: "img123" }] })]);
    expect(jsx).toContain("bg-cover");
    expect(jsx).toContain("bg-center");
  });

  // --- Typography ---

  it("should use text style name when available", () => {
    const jsx = convertToJsx([
      makeNode({
        type: "TEXT",
        characters: "Hello",
        textStyleName: "body/md",
        fontSize: 14,
        fontWeight: 400,
      }),
    ]);
    expect(jsx).toContain("text-body-md");
    // Should NOT include individual font properties covered by the style
    expect(jsx).not.toContain("text-[14px]");
  });

  it("should use individual typography when no text style", () => {
    const jsx = convertToJsx([
      makeNode({
        type: "TEXT",
        characters: "Hello",
        fontSize: 18,
        fontWeight: 600,
        lineHeight: 24,
        letterSpacing: 0.5,
      }),
    ]);
    expect(jsx).toContain("text-[18px]");
    expect(jsx).toContain("font-semibold");
    expect(jsx).toContain("leading-[24px]");
    expect(jsx).toContain("tracking-[0.5px]");
  });

  it("should render percentage lineHeight as percent", () => {
    const jsx = convertToJsx([
      makeNode({
        type: "TEXT",
        characters: "T",
        lineHeight: 150,
        lineHeightUnit: "percent",
      }),
    ]);
    expect(jsx).toContain("leading-[150%]");
    expect(jsx).not.toContain("leading-[150px]");
  });

  it("should render percentage letterSpacing as em", () => {
    const jsx = convertToJsx([
      makeNode({
        type: "TEXT",
        characters: "T",
        letterSpacing: 5,
        letterSpacingUnit: "percent",
      }),
    ]);
    expect(jsx).toContain("tracking-[0.05em]");
    expect(jsx).not.toContain("tracking-[5px]");
  });

  it("should render font weight classes correctly", () => {
    const weights: Array<[number, string]> = [
      [100, "font-thin"],
      [200, "font-extralight"],
      [300, "font-light"],
      [500, "font-medium"],
      [600, "font-semibold"],
      [700, "font-bold"],
      [800, "font-extrabold"],
      [900, "font-black"],
    ];

    for (const [weight, expected] of weights) {
      const jsx = convertToJsx([makeNode({ type: "TEXT", characters: "T", fontWeight: weight })]);
      expect(jsx).toContain(expected);
    }
  });

  it("should omit font-normal for weight 400", () => {
    const jsx = convertToJsx([makeNode({ type: "TEXT", characters: "T", fontWeight: 400 })]);
    expect(jsx).not.toContain("font-normal");
    expect(jsx).not.toContain("font-[400]");
  });

  it("should render custom font family", () => {
    const jsx = convertToJsx([
      makeNode({
        type: "TEXT",
        characters: "T",
        fontFamily: "Roboto Mono",
        fontSize: 14,
      }),
    ]);
    expect(jsx).toContain("font-['Roboto_Mono']");
  });

  it("should omit font family for Inter", () => {
    const jsx = convertToJsx([
      makeNode({
        type: "TEXT",
        characters: "T",
        fontFamily: "Inter",
        fontSize: 14,
      }),
    ]);
    expect(jsx).not.toContain("font-[");
  });

  it("should render text-center", () => {
    const jsx = convertToJsx([
      makeNode({
        type: "TEXT",
        characters: "T",
        textAlignHorizontal: "CENTER",
      }),
    ]);
    expect(jsx).toContain("text-center");
  });

  it("should render text-right", () => {
    const jsx = convertToJsx([
      makeNode({
        type: "TEXT",
        characters: "T",
        textAlignHorizontal: "RIGHT",
      }),
    ]);
    expect(jsx).toContain("text-right");
  });

  it("should render text-justify", () => {
    const jsx = convertToJsx([
      makeNode({
        type: "TEXT",
        characters: "T",
        textAlignHorizontal: "JUSTIFIED",
      }),
    ]);
    expect(jsx).toContain("text-justify");
  });

  it("should render uppercase", () => {
    const jsx = convertToJsx([makeNode({ type: "TEXT", characters: "T", textCase: "UPPER" })]);
    expect(jsx).toContain("uppercase");
  });

  it("should render lowercase", () => {
    const jsx = convertToJsx([makeNode({ type: "TEXT", characters: "T", textCase: "LOWER" })]);
    expect(jsx).toContain("lowercase");
  });

  it("should render capitalize", () => {
    const jsx = convertToJsx([makeNode({ type: "TEXT", characters: "T", textCase: "TITLE" })]);
    expect(jsx).toContain("capitalize");
  });

  it("should render underline", () => {
    const jsx = convertToJsx([makeNode({ type: "TEXT", characters: "T", textDecoration: "UNDERLINE" })]);
    expect(jsx).toContain("underline");
  });

  it("should render line-through", () => {
    const jsx = convertToJsx([makeNode({ type: "TEXT", characters: "T", textDecoration: "STRIKETHROUGH" })]);
    expect(jsx).toContain("line-through");
  });

  // --- Corners ---

  it("should render uniform corner radius as named Tailwind class", () => {
    const jsx = convertToJsx([makeNode({ cornerRadius: 12 })]);
    expect(jsx).toContain("rounded-xl");
  });

  it("should render rounded-full for cornerRadius 9999 (pill/circle)", () => {
    const jsx = convertToJsx([makeNode({ cornerRadius: 9999 })]);
    expect(jsx).toContain("rounded-full");
    expect(jsx).not.toContain("rounded-[9999px]");
  });

  it("should use arbitrary syntax for non-standard radius values", () => {
    const jsx = convertToJsx([makeNode({ cornerRadius: 7 })]);
    expect(jsx).toContain("rounded-[7px]");
  });

  it("should render corner radius with variable", () => {
    const jsx = convertToJsx([
      makeNode({
        cornerRadius: 8,
        bindings: { cornerRadius: "radius/md" },
      }),
    ]);
    expect(jsx).toContain("rounded-radius-md");
  });

  it("should skip corner radius 0", () => {
    const jsx = convertToJsx([makeNode({ cornerRadius: 0 })]);
    expect(jsx).not.toContain("rounded");
  });

  it("should render individual corner radii", () => {
    const jsx = convertToJsx([
      makeNode({
        topLeftRadius: 4,
        topRightRadius: 8,
        bottomRightRadius: 12,
        bottomLeftRadius: 16,
      }),
    ]);
    expect(jsx).toContain("rounded-tl-[4px]");
    expect(jsx).toContain("rounded-tr-[8px]");
    expect(jsx).toContain("rounded-br-[12px]");
    expect(jsx).toContain("rounded-bl-[16px]");
  });

  // --- Effects ---

  it("should render drop shadow in style attribute", () => {
    const jsx = convertToJsx([
      makeNode({
        effects: [
          {
            type: "DROP_SHADOW",
            color: "#000000",
            offset: { x: 0, y: 4 },
            radius: 8,
            spread: 0,
          },
        ],
      }),
    ]);
    expect(jsx).toContain("boxShadow:");
    expect(jsx).toContain("0px 4px 8px 0px rgba(0,0,0,1)");
  });

  it("should pass through rgba shadow colors", () => {
    const jsx = convertToJsx([
      makeNode({
        effects: [
          {
            type: "DROP_SHADOW",
            color: "rgba(0,0,0,0.25)",
            offset: { x: 0, y: 4 },
            radius: 8,
            spread: 0,
          },
        ],
      }),
    ]);
    expect(jsx).toContain("0px 4px 8px 0px rgba(0,0,0,0.25)");
  });

  it("should render inner shadow with inset", () => {
    const jsx = convertToJsx([
      makeNode({
        effects: [
          {
            type: "INNER_SHADOW",
            color: "#000000",
            offset: { x: 0, y: 2 },
            radius: 4,
            spread: 0,
          },
        ],
      }),
    ]);
    expect(jsx).toContain("inset 0px 2px 4px 0px");
  });

  it("should render multiple shadows comma-separated", () => {
    const jsx = convertToJsx([
      makeNode({
        effects: [
          {
            type: "DROP_SHADOW",
            color: "#000000",
            offset: { x: 0, y: 2 },
            radius: 4,
            spread: 0,
          },
          {
            type: "DROP_SHADOW",
            color: "#000000",
            offset: { x: 0, y: 8 },
            radius: 16,
            spread: 0,
          },
        ],
      }),
    ]);
    const match = jsx.match(/boxShadow: "([^"]+)"/);
    expect(match).toBeTruthy();
    expect(match![1]).toContain(", ");
  });

  it("should emit effect style name as shadow class", () => {
    const jsx = convertToJsx([
      makeNode({
        effectStyleName: "shadow/subtle",
        effects: [
          { type: "DROP_SHADOW", offset: { x: 0, y: 1 }, radius: 2, spread: 0, color: "#000000" },
        ],
      }),
    ]);
    expect(jsx).toContain("shadow-shadow-subtle");
    expect(jsx).not.toContain("boxShadow");
  });

  it("should not emit blur classes when effectStyleName is present", () => {
    const jsx = convertToJsx([
      makeNode({
        effectStyleName: "shadow/subtle",
        effects: [{ type: "LAYER_BLUR", radius: 10 }],
      }),
    ]);
    expect(jsx).toContain("shadow-shadow-subtle");
    expect(jsx).not.toContain("blur-[10px]");
  });

  it("should render layer blur as class", () => {
    const jsx = convertToJsx([makeNode({ effects: [{ type: "LAYER_BLUR", radius: 10 }] })]);
    expect(jsx).toContain("blur-[10px]");
  });

  it("should render background blur as class", () => {
    const jsx = convertToJsx([makeNode({ effects: [{ type: "BACKGROUND_BLUR", radius: 20 }] })]);
    expect(jsx).toContain("backdrop-blur-[20px]");
  });

  // --- Style fallbacks ---

  it("should render gradient as style.background", () => {
    const jsx = convertToJsx([
      makeNode({
        fills: [
          {
            type: "GRADIENT_LINEAR",
            gradient: {
              type: "GRADIENT_LINEAR",
              stops: [
                { color: "#ff0000", position: 0 },
                { color: "#0000ff", position: 1 },
              ],
            },
          },
        ],
      }),
    ]);
    expect(jsx).toContain("background:");
    expect(jsx).toContain("linear-gradient(#ff0000 0%, #0000ff 100%)");
  });

  it("should render rotation as style.transform", () => {
    const jsx = convertToJsx([makeNode({ rotation: 45 })]);
    expect(jsx).toContain('transform: "rotate(45deg)"');
  });

  it("should render opacity as class", () => {
    const jsx = convertToJsx([makeNode({ opacity: 0.5 })]);
    expect(jsx).toContain("opacity-[0.5]");
  });

  it("should omit opacity when 1", () => {
    const jsx = convertToJsx([makeNode({ opacity: 1 })]);
    expect(jsx).not.toContain("opacity");
  });

  // --- Element types ---

  it("should render TEXT nodes as <span>", () => {
    const jsx = convertToJsx([makeNode({ type: "TEXT", characters: "Hello World" })]);
    expect(jsx).toContain("<span");
    expect(jsx).toContain("Hello World");
    expect(jsx).toContain("</span>");
  });

  it("should render VECTOR nodes as self-closing <svg>", () => {
    const jsx = convertToJsx([makeNode({ type: "VECTOR", width: 24, height: 24 })]);
    expect(jsx).toContain("<svg");
    expect(jsx).toContain('width="24"');
    expect(jsx).toContain('height="24"');
    expect(jsx).toContain("/>");
  });

  it("should render LINE nodes as self-closing <svg>", () => {
    const jsx = convertToJsx([makeNode({ type: "LINE", width: 100, height: 1 })]);
    expect(jsx).toContain("<svg");
    expect(jsx).toContain("/>");
  });

  it("should render FRAME, GROUP, RECTANGLE, ELLIPSE as <div>", () => {
    const types = ["FRAME", "GROUP", "SECTION", "RECTANGLE", "ELLIPSE", "POLYGON", "STAR"];
    for (const type of types) {
      const jsx = convertToJsx([makeNode({ type })]);
      expect(jsx).toContain("<div");
    }
  });

  it("should render COMPONENT as PascalCase tag", () => {
    const jsx = convertToJsx([makeNode({ type: "COMPONENT", name: "Button" })]);
    expect(jsx).toContain("<Button");
  });

  it("should render COMPONENT_SET as PascalCase+Set tag", () => {
    const jsx = convertToJsx([makeNode({ type: "COMPONENT_SET", name: "Button" })]);
    expect(jsx).toContain("<ButtonSet");
  });

  it("should render INSTANCE with mainComponentName as PascalCase tag", () => {
    const jsx = convertToJsx([makeNode({ type: "INSTANCE", name: "Button", mainComponentName: "Button" })]);
    expect(jsx).toContain("<Button");
  });

  it("should render INSTANCE without mainComponentName using node name", () => {
    const jsx = convertToJsx([makeNode({ type: "INSTANCE", name: "MyButton" })]);
    expect(jsx).toContain("<MyButton");
  });

  // --- Nested children ---

  it("should render nested children with proper indentation", () => {
    const jsx = convertToJsx([
      makeNode({
        id: "1:1",
        name: "Parent",
        layoutMode: "VERTICAL",
        children: [
          makeNode({
            id: "1:2",
            name: "Child",
            type: "TEXT",
            characters: "Hello",
          }),
        ],
      }),
    ]);
    expect(jsx).toContain('<div id="1:1"');
    expect(jsx).toContain('<span id="1:2"');
    expect(jsx).toContain("Hello");
    expect(jsx).toContain("</div>");
  });

  // --- Full tree ---

  it("should render a card-like structure", () => {
    const jsx = convertToJsx([
      makeNode({
        id: "1:23",
        name: "Card",
        layoutMode: "VERTICAL",
        layoutSizingHorizontal: "FIXED",
        width: 320,
        paddingTop: 16,
        paddingRight: 16,
        paddingBottom: 16,
        paddingLeft: 16,
        itemSpacing: 16,
        cornerRadius: 12,
        fills: [{ type: "SOLID", color: "#ffffff" }],
        bindings: { "fills/0": "card" },
        effects: [
          {
            type: "DROP_SHADOW",
            color: "#000000",
            offset: { x: 0, y: 4 },
            radius: 8,
            spread: 0,
          },
        ],
        children: [
          makeNode({
            id: "1:24",
            name: "Title",
            type: "TEXT",
            characters: "Welcome Back",
            fontSize: 18,
            fontWeight: 600,
            lineHeight: 24,
            fills: [{ type: "SOLID", color: "#000000" }],
            bindings: { "fills/0": "card-foreground" },
          }),
          makeNode({
            id: "1:25",
            name: "Actions",
            layoutMode: "HORIZONTAL",
            itemSpacing: 8,
            counterAxisAlignItems: "CENTER",
            primaryAxisAlignItems: "MAX",
            children: [
              makeNode({
                id: "1:26",
                name: "Button",
                layoutMode: "HORIZONTAL",
                paddingTop: 8,
                paddingRight: 16,
                paddingBottom: 8,
                paddingLeft: 16,
                counterAxisAlignItems: "CENTER",
                primaryAxisAlignItems: "CENTER",
                cornerRadius: 8,
                fills: [{ type: "SOLID", color: "#0066ff" }],
                bindings: { "fills/0": "primary" },
                children: [
                  makeNode({
                    id: "1:27",
                    name: "Label",
                    type: "TEXT",
                    characters: "Get Started",
                    fontSize: 14,
                    fontWeight: 500,
                    fills: [{ type: "SOLID", color: "#ffffff" }],
                    bindings: { "fills/0": "primary-foreground" },
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ]);

    // Top-level card
    expect(jsx).toContain("flex flex-col");
    expect(jsx).toContain("gap-[16px]");
    expect(jsx).toContain("p-[16px]");
    expect(jsx).toContain("bg-card");
    expect(jsx).toContain("rounded-xl");
    expect(jsx).toContain("w-[320px]");
    expect(jsx).toContain("boxShadow:");

    // Title
    expect(jsx).toContain("text-card-foreground");
    expect(jsx).toContain("text-[18px]");
    expect(jsx).toContain("font-semibold");
    expect(jsx).toContain("leading-[24px]");
    expect(jsx).toContain("Welcome Back");

    // Button
    expect(jsx).toContain("bg-primary");
    expect(jsx).toContain("rounded-lg");

    // Button label
    expect(jsx).toContain("text-primary-foreground");
    expect(jsx).toContain("font-medium");
    expect(jsx).toContain("Get Started");
  });

  // --- JSX escaping ---

  it("should escape special characters in text content", () => {
    const jsx = convertToJsx([makeNode({ type: "TEXT", characters: "A < B & C > D" })]);
    expect(jsx).toContain("A &lt; B &amp; C &gt; D");
  });

  // --- Name escaping ---

  it("should escape quotes in node names", () => {
    const jsx = convertToJsx([makeNode({ name: 'Button "Primary"' })]);
    expect(jsx).toContain('name="Button &quot;Primary&quot;"');
  });

  // --- Variable name normalization ---

  it("should normalize variable names with slashes to dashes", () => {
    const jsx = convertToJsx([
      makeNode({
        fills: [{ type: "SOLID", color: "#ff0000" }],
        bindings: { "fills/0": "colors/brand/primary" },
      }),
    ]);
    expect(jsx).toContain("bg-colors-brand-primary");
  });

  // --- Image fill with style ---

  it("should render image fill with backgroundImage style", () => {
    const jsx = convertToJsx([makeNode({ fills: [{ type: "IMAGE", isImage: true, imageRef: "img-ref-123" }] })]);
    expect(jsx).toContain("bg-cover");
    expect(jsx).toContain("bg-center");
    expect(jsx).toContain("backgroundImage:");
  });

  // --- Text node rendering ---

  it("should render text content inside span", () => {
    const jsx = convertToJsx([makeNode({ type: "TEXT", characters: "Some text" })]);
    expect(jsx).toMatch(/<span[^>]*>\n\s+Some text\n\s*<\/span>/);
  });

  it("should render empty text node", () => {
    const jsx = convertToJsx([makeNode({ type: "TEXT", characters: "" })]);
    expect(jsx).toContain("<span");
    expect(jsx).toContain("</span>");
  });

  // --- Multiple root nodes ---

  it("should render multiple root nodes", () => {
    const jsx = convertToJsx([makeNode({ id: "1:1", name: "First" }), makeNode({ id: "1:2", name: "Second" })]);
    expect(jsx).toContain('name="First"');
    expect(jsx).toContain('name="Second"');
  });

  // --- Indent parameter ---

  it("should respect initial indent level", () => {
    const jsx = convertToJsx([makeNode()], 2);
    expect(jsx.startsWith("    ")).toBe(true); // 2 levels = 4 spaces
  });

  // --- Multiple fills ---

  it("should emit duplicate bg classes for multiple solid fills", () => {
    const jsx = convertToJsx([
      makeNode({
        fills: [
          { type: "SOLID", color: "#ffffff" },
          { type: "SOLID", color: "#FF0000", opacity: 0.5 },
        ],
      }),
    ]);
    expect(jsx).toContain("bg-[#ffffff]");
    expect(jsx).toContain("bg-[#FF0000]/50");
    expect(jsx).not.toContain("Figma fills");
  });

  it("should emit single bg class for single fill", () => {
    const jsx = convertToJsx([makeNode({ fills: [{ type: "SOLID", color: "#ffffff" }] })]);
    expect(jsx).toContain("bg-[#ffffff]");
    expect(jsx).not.toContain("Figma fills");
  });

  it("should emit solid bg class and gradient style for solid + gradient without direction", () => {
    const jsx = convertToJsx([
      makeNode({
        fills: [
          { type: "SOLID", color: "#ffffff" },
          {
            type: "GRADIENT_LINEAR",
            gradient: {
              type: "GRADIENT_LINEAR",
              stops: [
                { color: "#ff0000", position: 0 },
                { color: "#0000ff", position: 1 },
              ],
            },
          },
        ],
      }),
    ]);
    expect(jsx).toContain("bg-[#ffffff]");
    expect(jsx).toContain("background:");
    expect(jsx).toContain("linear-gradient");
  });

  it("should emit duplicate bg classes for 3+ solid fills", () => {
    const jsx = convertToJsx([
      makeNode({
        fills: [
          { type: "SOLID", color: "#111111" },
          { type: "SOLID", color: "#222222" },
          { type: "SOLID", color: "#333333" },
        ],
      }),
    ]);
    expect(jsx).toContain("bg-[#111111]");
    expect(jsx).toContain("bg-[#222222]");
    expect(jsx).toContain("bg-[#333333]");
  });

  it("should emit Tailwind gradient classes for linear gradient with direction", () => {
    const jsx = convertToJsx([
      makeNode({
        fills: [
          {
            type: "GRADIENT_LINEAR",
            gradient: {
              type: "GRADIENT_LINEAR",
              direction: "r",
              stops: [
                { color: "#ff0000", position: 0 },
                { color: "#0000ff", position: 1 },
              ],
            },
          },
        ],
      }),
    ]);
    expect(jsx).toContain("bg-gradient-to-r");
    expect(jsx).toContain("from-[#ff0000]");
    expect(jsx).toContain("to-[#0000ff]");
    expect(jsx).not.toContain("background:");
  });

  it("should emit via class for 3-stop gradient with direction", () => {
    const jsx = convertToJsx([
      makeNode({
        fills: [
          {
            type: "GRADIENT_LINEAR",
            gradient: {
              type: "GRADIENT_LINEAR",
              direction: "b",
              stops: [
                { color: "#ff0000", position: 0 },
                { color: "#00ff00", position: 0.5 },
                { color: "#0000ff", position: 1 },
              ],
            },
          },
        ],
      }),
    ]);
    expect(jsx).toContain("bg-gradient-to-b");
    expect(jsx).toContain("from-[#ff0000]");
    expect(jsx).toContain("via-[#00ff00]");
    expect(jsx).toContain("to-[#0000ff]");
  });

  it("should emit mixed solid + gradient with direction as duplicate classes", () => {
    const jsx = convertToJsx([
      makeNode({
        fills: [
          { type: "SOLID", color: "#ffffff" },
          {
            type: "GRADIENT_LINEAR",
            gradient: {
              type: "GRADIENT_LINEAR",
              direction: "r",
              stops: [
                { color: "#ff0000", position: 0 },
                { color: "#0000ff", position: 1 },
              ],
            },
          },
        ],
      }),
    ]);
    expect(jsx).toContain("bg-[#ffffff]");
    expect(jsx).toContain("bg-gradient-to-r");
    expect(jsx).toContain("from-[#ff0000]");
    expect(jsx).toContain("to-[#0000ff]");
  });

  // --- Multiple strokes ---

  it("should emit duplicate border classes for multiple strokes", () => {
    const jsx = convertToJsx([
      makeNode({
        strokes: [
          { type: "SOLID", color: "#000000" },
          { type: "SOLID", color: "#00FF00" },
        ],
        strokeWeight: 1,
      }),
    ]);
    expect(jsx).toContain("border-[#000000]");
    expect(jsx).toContain("border-[#00FF00]");
    expect(jsx).not.toContain("Figma strokes");
  });

  it("should emit single border class for single stroke", () => {
    const jsx = convertToJsx([
      makeNode({
        strokes: [{ type: "SOLID", color: "#000000" }],
        strokeWeight: 1,
      }),
    ]);
    expect(jsx).toContain("border-[#000000]");
    expect(jsx).not.toContain("Figma strokes");
  });

  it("should emit duplicate classes for both multiple fills and strokes", () => {
    const jsx = convertToJsx([
      makeNode({
        fills: [
          { type: "SOLID", color: "#ffffff" },
          { type: "SOLID", color: "#FF0000" },
        ],
        strokes: [
          { type: "SOLID", color: "#000000" },
          { type: "SOLID", color: "#00FF00" },
        ],
        strokeWeight: 1,
      }),
    ]);
    expect(jsx).toContain("bg-[#ffffff]");
    expect(jsx).toContain("bg-[#FF0000]");
    expect(jsx).toContain("border-[#000000]");
    expect(jsx).toContain("border-[#00FF00]");
  });

  // --- Component tags ---

  describe("component tags", () => {
    it("should render COMPONENT_SET with Set suffix", () => {
      const jsx = convertToJsx([makeNode({ type: "COMPONENT_SET", name: "Button" })]);
      expect(jsx).toContain("<ButtonSet");
      expect(jsx).not.toContain("name=");
    });

    it("should render COMPONENT_SET with propertyDefinitions", () => {
      const jsx = convertToJsx([
        makeNode({
          type: "COMPONENT_SET",
          name: "Button",
          componentPropertyDefinitions: {
            Size: { type: "VARIANT", options: ["sm", "md", "lg"] },
            "Show Icon": { type: "BOOLEAN", default: true },
          },
        }),
      ]);
      expect(jsx).toContain("<ButtonSet");
      expect(jsx).toContain("propertyDefinitions=");
      expect(jsx).toContain('size: "sm | md | lg"');
      expect(jsx).toContain("showIcon: true");
      expect(jsx).toContain("propertyNameMap=");
      expect(jsx).toContain('showIcon: "Show Icon"');
    });

    it("should not emit propertyNameMap when no names were changed", () => {
      const jsx = convertToJsx([
        makeNode({
          type: "COMPONENT_SET",
          name: "Button",
          componentPropertyDefinitions: {
            size: { type: "VARIANT", options: ["sm", "md"] },
          },
        }),
      ]);
      expect(jsx).toContain("propertyDefinitions=");
      expect(jsx).not.toContain("propertyNameMap=");
    });

    it("should render COMPONENT in a set with variant properties", () => {
      const jsx = convertToJsx([
        makeNode({
          type: "COMPONENT",
          name: "Size=md, State=default",
          componentSetName: "Button",
          variantProperties: { Size: "md", State: "default" },
        }),
      ]);
      expect(jsx).toContain("<Button");
      expect(jsx).toContain('size="md"');
      expect(jsx).toContain('state="default"');
      expect(jsx).not.toContain("name=");
    });

    it("should render standalone COMPONENT with PascalCase tag", () => {
      const jsx = convertToJsx([makeNode({ type: "COMPONENT", name: "Avatar" })]);
      expect(jsx).toContain("<Avatar");
      expect(jsx).not.toContain("componentName=");
    });

    it("should emit componentName when name was sanitized", () => {
      const jsx = convertToJsx([makeNode({ type: "COMPONENT", name: "Profile Avatar" })]);
      expect(jsx).toContain("<ProfileAvatar");
      expect(jsx).toContain('componentName="Profile Avatar"');
    });

    it("should not emit componentName when name is already valid PascalCase", () => {
      const jsx = convertToJsx([makeNode({ type: "COMPONENT", name: "Button" })]);
      expect(jsx).toContain("<Button");
      expect(jsx).not.toContain("componentName=");
    });

    it("should render INSTANCE with mainComponentName as tag", () => {
      const jsx = convertToJsx([
        makeNode({
          type: "INSTANCE",
          name: "Button",
          mainComponentName: "Button",
          componentProperties: {
            size: { type: "VARIANT", value: "md" },
            "Show Icon": { type: "BOOLEAN", value: true },
            label: { type: "TEXT", value: "Click me" },
          },
        }),
      ]);
      expect(jsx).toContain("<Button");
      expect(jsx).toContain('size="md"');
      expect(jsx).toContain("showIcon={true}");
      expect(jsx).toContain('label="Click me"');
      expect(jsx).toContain("propertyNameMap=");
      expect(jsx).toContain('showIcon: "Show Icon"');
    });

    it("should render INSTANCE with boolean false", () => {
      const jsx = convertToJsx([
        makeNode({
          type: "INSTANCE",
          name: "Icon",
          mainComponentName: "Icon",
          componentProperties: {
            visible: { type: "BOOLEAN", value: false },
          },
        }),
      ]);
      expect(jsx).toContain("visible={false}");
    });

    it("should handle PascalCase conversion for special chars", () => {
      const jsx = convertToJsx([makeNode({ type: "COMPONENT", name: "icon/close" })]);
      expect(jsx).toContain("<IconClose");
      expect(jsx).toContain('componentName="icon/close"');
    });

    it("should skip name attribute for component types", () => {
      for (const type of ["COMPONENT", "COMPONENT_SET", "INSTANCE"]) {
        const jsx = convertToJsx([makeNode({ type, name: "Button" })]);
        expect(jsx).not.toContain('name="Button"');
      }
    });

    it("should still emit name for regular frames", () => {
      const jsx = convertToJsx([makeNode({ type: "FRAME", name: "Container" })]);
      expect(jsx).toContain('name="Container"');
    });

    it("should render component with children", () => {
      const jsx = convertToJsx([
        makeNode({
          type: "COMPONENT_SET",
          name: "Button",
          children: [
            makeNode({
              id: "1:2",
              type: "COMPONENT",
              name: "Size=sm",
              componentSetName: "Button",
              variantProperties: { Size: "sm" },
            }),
          ],
        }),
      ]);
      expect(jsx).toContain("<ButtonSet");
      expect(jsx).toContain("<Button");
      expect(jsx).toContain('size="sm"');
      expect(jsx).toContain("</ButtonSet>");
    });

    it("should render variant props with propertyNameMap for multi-word keys", () => {
      const jsx = convertToJsx([
        makeNode({
          type: "COMPONENT",
          name: "Has Icon=true",
          componentSetName: "Button",
          variantProperties: { "Has Icon": "true" },
        }),
      ]);
      expect(jsx).toContain('hasIcon="true"');
      expect(jsx).toContain("propertyNameMap=");
      expect(jsx).toContain('hasIcon: "Has Icon"');
    });
  });
});
