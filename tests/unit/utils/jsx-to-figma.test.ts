import { parseJsx } from "../../../src/videntia_figma_mcp/utils/jsx-to-figma";
import { convertToJsx } from "../../../src/videntia_figma_mcp/utils/figma-to-jsx";
import type { FigmaNodeData } from "../../../src/videntia_figma_mcp/types/index";

function makeNode(overrides: Partial<FigmaNodeData> = {}): FigmaNodeData {
  return {
    id: "1:1",
    name: "TestNode",
    type: "FRAME",
    visible: true,
    ...overrides,
  };
}

describe("parseJsx", () => {
  // --- Basic ---

  it("should return empty array for empty string", () => {
    expect(parseJsx("")).toEqual([]);
  });

  it("should return empty array for whitespace-only string", () => {
    expect(parseJsx("   \n  ")).toEqual([]);
  });

  it("should parse a single self-closing div", () => {
    const nodes = parseJsx('<div id="1:1" name="TestNode" />');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].id).toBe("1:1");
    expect(nodes[0].name).toBe("TestNode");
    expect(nodes[0].type).toBe("FRAME");
  });

  it("should parse a text node", () => {
    const nodes = parseJsx('<span id="1:1" name="Label">\n  Hello World\n</span>');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe("TEXT");
    expect(nodes[0].characters).toBe("Hello World");
  });

  it("should parse an svg node", () => {
    const nodes = parseJsx('<svg id="1:1" name="Icon" width="24" height="24" />');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe("SVG");
    expect(nodes[0].width).toBe(24);
    expect(nodes[0].height).toBe(24);
    expect(nodes[0].svgString).toContain("<svg");
  });

  it("should decode HTML entities in text", () => {
    const nodes = parseJsx('<span id="1:1" name="T">\n  A &lt; B &amp; C &gt; D\n</span>');
    expect(nodes[0].characters).toBe("A < B & C > D");
  });

  it("should decode HTML entities in names", () => {
    const nodes = parseJsx('<div id="1:1" name="Button &quot;Primary&quot;" />');
    expect(nodes[0].name).toBe('Button "Primary"');
  });

  // --- Layout ---

  it("should parse horizontal auto-layout", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="flex flex-row" />');
    expect(nodes[0].layoutMode).toBe("HORIZONTAL");
  });

  it("should parse vertical auto-layout", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="flex flex-col" />');
    expect(nodes[0].layoutMode).toBe("VERTICAL");
  });

  it("should parse justify-center", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="flex flex-row justify-center" />');
    expect(nodes[0].primaryAxisAlignItems).toBe("CENTER");
  });

  it("should parse justify-end", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="flex flex-row justify-end" />');
    expect(nodes[0].primaryAxisAlignItems).toBe("MAX");
  });

  it("should parse justify-between", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="flex flex-row justify-between" />');
    expect(nodes[0].primaryAxisAlignItems).toBe("SPACE_BETWEEN");
  });

  it("should parse items-center", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="flex flex-row items-center" />');
    expect(nodes[0].counterAxisAlignItems).toBe("CENTER");
  });

  it("should parse items-end", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="flex flex-col items-end" />');
    expect(nodes[0].counterAxisAlignItems).toBe("MAX");
  });

  it("should parse items-baseline", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="flex flex-row items-baseline" />');
    expect(nodes[0].counterAxisAlignItems).toBe("BASELINE");
  });

  it("should parse flex-wrap", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="flex flex-row flex-wrap" />');
    expect(nodes[0].layoutWrap).toBe("WRAP");
  });

  it("should parse overflow-hidden", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="overflow-hidden" />');
    expect(nodes[0].clipsContent).toBe(true);
  });

  it("should parse absolute positioning", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="absolute left-[10px] top-[20px]" />');
    expect(nodes[0].layoutPositioning).toBe("ABSOLUTE");
    expect(nodes[0].x).toBe(10);
    expect(nodes[0].y).toBe(20);
  });

  // --- Gap ---

  it("should parse gap with arbitrary value", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="flex flex-row gap-[16px]" />');
    expect(nodes[0].itemSpacing).toBe(16);
  });

  it("should parse gap with variable binding", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="flex flex-row gap-spacing-4" />');
    expect(nodes[0].bindings?.itemSpacing).toBe("spacing/4");
  });

  it("should parse gap-y with arbitrary value", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="flex flex-row flex-wrap gap-[8px] gap-y-[12px]" />');
    expect(nodes[0].itemSpacing).toBe(8);
    expect(nodes[0].counterAxisSpacing).toBe(12);
  });

  it("should parse gap-x with arbitrary value", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="flex flex-col flex-wrap gap-[8px] gap-x-[16px]" />');
    expect(nodes[0].counterAxisSpacing).toBe(16);
  });

  it("should parse gap-y with variable binding", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="flex flex-row flex-wrap gap-[8px] gap-y-spacing-3" />');
    expect(nodes[0].bindings?.counterAxisSpacing).toBe("spacing/3");
  });

  // --- Sizing ---

  it("should parse fixed width", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="w-[320px]" />');
    expect(nodes[0].width).toBe(320);
    expect(nodes[0].layoutSizingHorizontal).toBe("FIXED");
  });

  it("should parse fixed height", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="h-[200px]" />');
    expect(nodes[0].height).toBe(200);
    expect(nodes[0].layoutSizingVertical).toBe("FIXED");
  });

  it("should parse flex-1 as horizontal FILL", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="flex-1" />');
    expect(nodes[0].layoutSizingHorizontal).toBe("FILL");
  });

  it("should parse flex-1 h-full as both horizontal and vertical FILL", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="flex-1 h-full" />');
    expect(nodes[0].layoutSizingHorizontal).toBe("FILL");
    expect(nodes[0].layoutSizingVertical).toBe("FILL");
  });

  // --- Padding ---

  it("should parse uniform padding", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="p-[16px]" />');
    expect(nodes[0].paddingTop).toBe(16);
    expect(nodes[0].paddingRight).toBe(16);
    expect(nodes[0].paddingBottom).toBe(16);
    expect(nodes[0].paddingLeft).toBe(16);
  });

  it("should parse symmetric padding (px/py)", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="px-[16px] py-[8px]" />');
    expect(nodes[0].paddingTop).toBe(8);
    expect(nodes[0].paddingRight).toBe(16);
    expect(nodes[0].paddingBottom).toBe(8);
    expect(nodes[0].paddingLeft).toBe(16);
  });

  it("should parse individual padding", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="pt-[4px] pr-[8px] pb-[12px] pl-[16px]" />');
    expect(nodes[0].paddingTop).toBe(4);
    expect(nodes[0].paddingRight).toBe(8);
    expect(nodes[0].paddingBottom).toBe(12);
    expect(nodes[0].paddingLeft).toBe(16);
  });

  it("should parse padding with variable binding (uniform)", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="p-spacing-4" />');
    expect(nodes[0].bindings?.paddingTop).toBe("spacing/4");
    expect(nodes[0].bindings?.paddingRight).toBe("spacing/4");
    expect(nodes[0].bindings?.paddingBottom).toBe("spacing/4");
    expect(nodes[0].bindings?.paddingLeft).toBe("spacing/4");
  });

  it("should parse px variable binding on both sides", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="px-spacing-4" />');
    expect(nodes[0].bindings?.paddingLeft).toBe("spacing/4");
    expect(nodes[0].bindings?.paddingRight).toBe("spacing/4");
  });

  it("should parse py variable binding on both sides", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="py-spacing-4" />');
    expect(nodes[0].bindings?.paddingTop).toBe("spacing/4");
    expect(nodes[0].bindings?.paddingBottom).toBe("spacing/4");
  });

  it("should parse individual padding with variable bindings", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="pt-spacing-1 pr-spacing-2 pb-spacing-3 pl-spacing-4" />');
    expect(nodes[0].bindings?.paddingTop).toBe("spacing/1");
    expect(nodes[0].bindings?.paddingRight).toBe("spacing/2");
    expect(nodes[0].bindings?.paddingBottom).toBe("spacing/3");
    expect(nodes[0].bindings?.paddingLeft).toBe("spacing/4");
  });

  // --- Colors ---

  it("should parse bg hex color", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="bg-[#ff0000]" />');
    expect(nodes[0].fills).toEqual([{ type: "SOLID", color: "#ff0000" }]);
  });

  it("should parse bg hex color with opacity", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="bg-[#000000]/50" />');
    expect(nodes[0].fills).toEqual([{ type: "SOLID", color: "#000000", opacity: 0.5 }]);
  });

  it("should parse bg variable binding", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="bg-primary" />');
    expect(nodes[0].fills).toEqual([{ type: "SOLID", color: "#000000" }]);
    expect(nodes[0].bindings?.["fills/0"]).toBe("primary");
  });

  it("should parse text hex color on TEXT node", () => {
    const nodes = parseJsx('<span id="1:1" name="T" className="text-[#333333] text-[14px]">\n  Hello\n</span>');
    expect(nodes[0].fills).toEqual([{ type: "SOLID", color: "#333333" }]);
  });

  it("should parse text color with opacity on TEXT node", () => {
    const nodes = parseJsx('<span id="1:1" name="T" className="text-[#000000]/30 text-[14px]">\n  T\n</span>');
    expect(nodes[0].fills).toEqual([{ type: "SOLID", color: "#000000", opacity: 0.3 }]);
  });

  it("should parse text variable binding on TEXT node", () => {
    const nodes = parseJsx('<span id="1:1" name="T" className="text-card-foreground text-[14px]">\n  T\n</span>');
    expect(nodes[0].bindings?.["fills/0"]).toBe("card/foreground");
  });

  it("should parse bg-cover bg-center as image fill", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="bg-cover bg-center" />');
    expect(nodes[0].fills).toEqual([{ type: "IMAGE", isImage: true }]);
  });

  it("should parse bg variable with deep path", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="bg-colors-brand-primary" />');
    expect(nodes[0].bindings?.["fills/0"]).toBe("colors/brand/primary");
  });

  // --- Strokes ---

  it("should parse stroke weight and color", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="border-[2px] border-[#cccccc]" />');
    expect(nodes[0].strokeWeight).toBe(2);
    expect(nodes[0].strokes).toEqual([{ type: "SOLID", color: "#cccccc" }]);
  });

  it("should parse stroke with variable binding", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="border-[1px] border-border" />');
    expect(nodes[0].strokeWeight).toBe(1);
    expect(nodes[0].bindings?.["strokes/0"]).toBe("border");
  });

  // --- Typography ---

  it("should parse font size", () => {
    const nodes = parseJsx('<span id="1:1" name="T" className="text-[18px]">\n  T\n</span>');
    expect(nodes[0].fontSize).toBe(18);
  });

  it("should parse font weight classes", () => {
    const weights: Array<[string, number]> = [
      ["font-thin", 100],
      ["font-extralight", 200],
      ["font-light", 300],
      ["font-medium", 500],
      ["font-semibold", 600],
      ["font-bold", 700],
      ["font-extrabold", 800],
      ["font-black", 900],
    ];

    for (const [cls, expected] of weights) {
      const nodes = parseJsx(`<span id="1:1" name="T" className="text-[14px] ${cls}">\n  T\n</span>`);
      expect(nodes[0].fontWeight).toBe(expected);
    }
  });

  it("should parse custom font weight", () => {
    const nodes = parseJsx('<span id="1:1" name="T" className="text-[14px] font-[450]">\n  T\n</span>');
    expect(nodes[0].fontWeight).toBe(450);
  });

  it("should parse line height in pixels", () => {
    const nodes = parseJsx('<span id="1:1" name="T" className="text-[14px] leading-[24px]">\n  T\n</span>');
    expect(nodes[0].lineHeight).toBe(24);
  });

  it("should parse line height in percent", () => {
    const nodes = parseJsx('<span id="1:1" name="T" className="text-[14px] leading-[150%]">\n  T\n</span>');
    expect(nodes[0].lineHeight).toBe(150);
    expect(nodes[0].lineHeightUnit).toBe("percent");
  });

  it("should parse letter spacing in pixels", () => {
    const nodes = parseJsx('<span id="1:1" name="T" className="text-[14px] tracking-[0.5px]">\n  T\n</span>');
    expect(nodes[0].letterSpacing).toBe(0.5);
  });

  it("should parse letter spacing in em (percent)", () => {
    const nodes = parseJsx('<span id="1:1" name="T" className="text-[14px] tracking-[0.05em]">\n  T\n</span>');
    expect(nodes[0].letterSpacing).toBe(5);
    expect(nodes[0].letterSpacingUnit).toBe("percent");
  });

  it("should parse custom font family", () => {
    const nodes = parseJsx(`<span id="1:1" name="T" className="text-[14px] font-['Roboto_Mono']">\n  T\n</span>`);
    expect(nodes[0].fontFamily).toBe("Roboto Mono");
  });

  it("should parse text-center", () => {
    const nodes = parseJsx('<span id="1:1" name="T" className="text-center">\n  T\n</span>');
    expect(nodes[0].textAlignHorizontal).toBe("CENTER");
  });

  it("should parse text-right", () => {
    const nodes = parseJsx('<span id="1:1" name="T" className="text-right">\n  T\n</span>');
    expect(nodes[0].textAlignHorizontal).toBe("RIGHT");
  });

  it("should parse text-justify", () => {
    const nodes = parseJsx('<span id="1:1" name="T" className="text-justify">\n  T\n</span>');
    expect(nodes[0].textAlignHorizontal).toBe("JUSTIFIED");
  });

  it("should parse uppercase", () => {
    const nodes = parseJsx('<span id="1:1" name="T" className="uppercase">\n  T\n</span>');
    expect(nodes[0].textCase).toBe("UPPER");
  });

  it("should parse lowercase", () => {
    const nodes = parseJsx('<span id="1:1" name="T" className="lowercase">\n  T\n</span>');
    expect(nodes[0].textCase).toBe("LOWER");
  });

  it("should parse capitalize", () => {
    const nodes = parseJsx('<span id="1:1" name="T" className="capitalize">\n  T\n</span>');
    expect(nodes[0].textCase).toBe("TITLE");
  });

  it("should parse underline", () => {
    const nodes = parseJsx('<span id="1:1" name="T" className="underline">\n  T\n</span>');
    expect(nodes[0].textDecoration).toBe("UNDERLINE");
  });

  it("should parse line-through", () => {
    const nodes = parseJsx('<span id="1:1" name="T" className="line-through">\n  T\n</span>');
    expect(nodes[0].textDecoration).toBe("STRIKETHROUGH");
  });

  // --- Text styles ---

  it("should parse text style name when no individual typography", () => {
    const nodes = parseJsx('<span id="1:1" name="T" className="text-body-md">\n  Hello\n</span>');
    expect(nodes[0].textStyleName).toBe("body/md");
    expect(nodes[0].fontSize).toBeUndefined();
  });

  it("should parse text- as fill binding when individual typography is present", () => {
    const nodes = parseJsx(
      '<span id="1:1" name="T" className="text-card-foreground text-[18px] font-semibold leading-[24px]">\n  Hello\n</span>',
    );
    expect(nodes[0].textStyleName).toBeUndefined();
    expect(nodes[0].bindings?.["fills/0"]).toBe("card/foreground");
    expect(nodes[0].fontSize).toBe(18);
  });

  // --- Corners ---

  it("should parse uniform corner radius", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="rounded-[12px]" />');
    expect(nodes[0].cornerRadius).toBe(12);
  });

  it("should parse corner radius with variable", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="rounded-radius-md" />');
    expect(nodes[0].bindings?.cornerRadius).toBe("radius/md");
  });

  it("should parse corner radius variable starting with t or b", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="rounded-token-md" />');
    expect(nodes[0].bindings?.cornerRadius).toBe("token/md");
    const nodes2 = parseJsx('<div id="1:1" name="T" className="rounded-base" />');
    expect(nodes2[0].bindings?.cornerRadius).toBe("base");
  });

  it("should parse individual corner radii", () => {
    const nodes = parseJsx(
      '<div id="1:1" name="T" className="rounded-tl-[4px] rounded-tr-[8px] rounded-br-[12px] rounded-bl-[16px]" />',
    );
    expect(nodes[0].topLeftRadius).toBe(4);
    expect(nodes[0].topRightRadius).toBe(8);
    expect(nodes[0].bottomRightRadius).toBe(12);
    expect(nodes[0].bottomLeftRadius).toBe(16);
  });

  // --- Effects ---

  it("should parse blur", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="blur-[10px]" />');
    expect(nodes[0].effects).toEqual([{ type: "LAYER_BLUR", radius: 10 }]);
  });

  it("should parse backdrop-blur", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="backdrop-blur-[20px]" />');
    expect(nodes[0].effects).toEqual([{ type: "BACKGROUND_BLUR", radius: 20 }]);
  });

  it("should parse opacity", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="opacity-[0.5]" />');
    expect(nodes[0].opacity).toBe(0.5);
  });

  // --- Style attribute: boxShadow ---

  it("should parse drop shadow from style", () => {
    const jsx = '<div id="1:1" name="T" style={{ boxShadow: "0px 4px 8px 0px rgba(0,0,0,0.25)" }} />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].effects).toEqual([
      { type: "DROP_SHADOW", offset: { x: 0, y: 4 }, radius: 8, spread: 0, color: "rgba(0,0,0,0.25)" },
    ]);
  });

  it("should parse inner shadow (inset) from style", () => {
    const jsx = '<div id="1:1" name="T" style={{ boxShadow: "inset 0px 2px 4px 0px rgba(0,0,0,1)" }} />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].effects).toEqual([
      { type: "INNER_SHADOW", offset: { x: 0, y: 2 }, radius: 4, spread: 0, color: "rgba(0,0,0,1)" },
    ]);
  });

  it("should parse multiple shadows", () => {
    const jsx =
      '<div id="1:1" name="T" style={{ boxShadow: "0px 2px 4px 0px rgba(0,0,0,0.1), 0px 8px 16px 0px rgba(0,0,0,0.2)" }} />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].effects).toHaveLength(2);
    expect(nodes[0].effects![0].type).toBe("DROP_SHADOW");
    expect(nodes[0].effects![1].type).toBe("DROP_SHADOW");
  });

  // --- Style attribute: gradient ---

  it("should parse linear-gradient from style", () => {
    const jsx = '<div id="1:1" name="T" style={{ background: "linear-gradient(#ff0000 0%, #0000ff 100%)" }} />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].fills).toEqual([
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
    ]);
  });

  it("should parse gradient with rgba colors", () => {
    const jsx =
      '<div id="1:1" name="T" style={{ background: "linear-gradient(rgba(255,0,0,0.5) 0%, rgba(0,0,255,1) 100%)" }} />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].fills![0].gradient?.stops).toHaveLength(2);
    expect(nodes[0].fills![0].gradient?.stops[0].color).toBe("rgba(255,0,0,0.5)");
    expect(nodes[0].fills![0].gradient?.stops[0].position).toBe(0);
    expect(nodes[0].fills![0].gradient?.stops[1].color).toBe("rgba(0,0,255,1)");
    expect(nodes[0].fills![0].gradient?.stops[1].position).toBe(1);
  });

  it("should parse radial-gradient from style", () => {
    const jsx = '<div id="1:1" name="T" style={{ background: "radial-gradient(#ff0000 0%, #0000ff 100%)" }} />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].fills![0].gradient?.type).toBe("GRADIENT_RADIAL");
  });

  // --- Style attribute: rotation ---

  it("should parse rotation from style", () => {
    const jsx = '<div id="1:1" name="T" style={{ transform: "rotate(45deg)" }} />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].rotation).toBe(45);
  });

  // --- Style attribute: backgroundImage ---

  it("should parse backgroundImage from style", () => {
    const jsx =
      '<div id="1:1" name="T" className="bg-cover bg-center" style={{ backgroundImage: "url(img-ref-123)" }} />';
    const nodes = parseJsx(jsx);
    const imageFill = nodes[0].fills?.find((f) => f.isImage);
    expect(imageFill).toBeDefined();
    expect(imageFill!.imageRef).toBe("img-ref-123");
  });

  // --- Nested children ---

  it("should parse nested children", () => {
    const jsx = `<div id="1:1" name="Parent" className="flex flex-col">
  <span id="1:2" name="Child" className="text-[14px]">
    Hello
  </span>
</div>`;
    const nodes = parseJsx(jsx);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].children).toHaveLength(1);
    expect(nodes[0].children![0].type).toBe("TEXT");
    expect(nodes[0].children![0].characters).toBe("Hello");
  });

  it("should parse deeply nested children", () => {
    const jsx = `<div id="1:1" name="Root" className="flex flex-col">
  <div id="1:2" name="Middle" className="flex flex-row">
    <span id="1:3" name="Leaf" className="text-[14px]">
      Deep
    </span>
  </div>
</div>`;
    const nodes = parseJsx(jsx);
    expect(nodes[0].children![0].children![0].characters).toBe("Deep");
  });

  // --- Multiple root nodes ---

  it("should parse multiple root nodes", () => {
    const jsx = '<div id="1:1" name="First" />\n<div id="1:2" name="Second" />';
    const nodes = parseJsx(jsx);
    expect(nodes).toHaveLength(2);
    expect(nodes[0].name).toBe("First");
    expect(nodes[1].name).toBe("Second");
  });

  // --- Round-trip tests ---

  it("should round-trip a simple frame", () => {
    const original = makeNode({
      layoutMode: "VERTICAL",
      layoutSizingHorizontal: "FIXED",
      width: 320,
    });
    const jsx = convertToJsx([original]);
    const parsed = parseJsx(jsx);
    expect(parsed[0].layoutMode).toBe("VERTICAL");
    expect(parsed[0].layoutSizingHorizontal).toBe("FIXED");
    expect(parsed[0].width).toBe(320);
  });

  it("should round-trip padding", () => {
    const original = makeNode({
      paddingTop: 16,
      paddingRight: 16,
      paddingBottom: 16,
      paddingLeft: 16,
    });
    const jsx = convertToJsx([original]);
    const parsed = parseJsx(jsx);
    expect(parsed[0].paddingTop).toBe(16);
    expect(parsed[0].paddingRight).toBe(16);
    expect(parsed[0].paddingBottom).toBe(16);
    expect(parsed[0].paddingLeft).toBe(16);
  });

  it("should round-trip a text node with font properties", () => {
    const original = makeNode({
      type: "TEXT",
      characters: "Hello World",
      fontSize: 18,
      fontWeight: 600,
      lineHeight: 24,
      letterSpacing: 0.5,
    });
    const jsx = convertToJsx([original]);
    const parsed = parseJsx(jsx);
    expect(parsed[0].characters).toBe("Hello World");
    expect(parsed[0].fontSize).toBe(18);
    expect(parsed[0].fontWeight).toBe(600);
    expect(parsed[0].lineHeight).toBe(24);
    expect(parsed[0].letterSpacing).toBe(0.5);
  });

  it("should round-trip a card-like structure", () => {
    const card = makeNode({
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
      ],
    });

    const jsx = convertToJsx([card]);
    const parsed = parseJsx(jsx);

    // Card properties
    expect(parsed[0].layoutMode).toBe("VERTICAL");
    expect(parsed[0].layoutSizingHorizontal).toBe("FIXED");
    expect(parsed[0].width).toBe(320);
    expect(parsed[0].paddingTop).toBe(16);
    expect(parsed[0].itemSpacing).toBe(16);
    expect(parsed[0].cornerRadius).toBe(12);
    expect(parsed[0].bindings?.["fills/0"]).toBe("card");

    // Shadow
    expect(parsed[0].effects).toBeDefined();
    const shadow = parsed[0].effects!.find((e) => e.type === "DROP_SHADOW");
    expect(shadow).toBeDefined();

    // Title child
    expect(parsed[0].children).toHaveLength(1);
    const title = parsed[0].children![0];
    expect(title.type).toBe("TEXT");
    expect(title.characters).toBe("Welcome Back");
    expect(title.fontSize).toBe(18);
    expect(title.fontWeight).toBe(600);
    expect(title.bindings?.["fills/0"]).toBe("card/foreground");
  });

  it("should round-trip text style name", () => {
    const original = makeNode({
      type: "TEXT",
      characters: "Hello",
      textStyleName: "body/md",
      fontSize: 14,
      fontWeight: 400,
    });
    const jsx = convertToJsx([original]);
    const parsed = parseJsx(jsx);
    expect(parsed[0].textStyleName).toBe("body/md");
  });

  it("should round-trip effect style name", () => {
    const original = makeNode({
      effectStyleName: "shadow/subtle",
      effects: [
        { type: "DROP_SHADOW", offset: { x: 0, y: 1 }, radius: 2, spread: 0, color: "#000000" },
      ],
    });
    const jsx = convertToJsx([original]);
    expect(jsx).toContain("shadow-shadow-subtle");
    const parsed = parseJsx(jsx);
    expect(parsed[0].effectStyleName).toBe("shadow/subtle");
  });

  it("should round-trip corner radius with variable", () => {
    const original = makeNode({
      cornerRadius: 8,
      bindings: { cornerRadius: "radius/md" },
    });
    const jsx = convertToJsx([original]);
    const parsed = parseJsx(jsx);
    expect(parsed[0].bindings?.cornerRadius).toBe("radius/md");
  });

  it("should round-trip rotation", () => {
    const original = makeNode({ rotation: 45 });
    const jsx = convertToJsx([original]);
    const parsed = parseJsx(jsx);
    expect(parsed[0].rotation).toBe(45);
  });

  it("should round-trip gradient fills", () => {
    const original = makeNode({
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
    });
    const jsx = convertToJsx([original]);
    const parsed = parseJsx(jsx);
    expect(parsed[0].fills![0].gradient?.type).toBe("GRADIENT_LINEAR");
    expect(parsed[0].fills![0].gradient?.stops).toHaveLength(2);
  });

  it("should round-trip blur effects", () => {
    const original = makeNode({
      effects: [{ type: "LAYER_BLUR", radius: 10 }],
    });
    const jsx = convertToJsx([original]);
    const parsed = parseJsx(jsx);
    expect(parsed[0].effects).toEqual([{ type: "LAYER_BLUR", radius: 10 }]);
  });

  it("should round-trip image fill with backgroundImage", () => {
    const original = makeNode({
      fills: [{ type: "IMAGE", isImage: true, imageRef: "img-ref-123" }],
    });
    const jsx = convertToJsx([original]);
    const parsed = parseJsx(jsx);
    const imageFill = parsed[0].fills?.find((f) => f.isImage);
    expect(imageFill).toBeDefined();
    expect(imageFill!.imageRef).toBe("img-ref-123");
  });

  it("should round-trip single fill (last fill wins when multiple bg classes present)", () => {
    // jsx_to_figma uses replace-not-accumulate: each bg-* class replaces the previous fill.
    // When convertToJsx serialises a multi-fill node, parseJsx only keeps the last one.
    const original = makeNode({
      fills: [
        { type: "SOLID", color: "#ffffff" },
        { type: "SOLID", color: "#FF0000", opacity: 0.5 },
      ],
    });
    const jsx = convertToJsx([original]);
    const parsed = parseJsx(jsx);
    expect(parsed[0].fills).toHaveLength(1);
    expect(parsed[0].fills![0].color).toBe("#FF0000");
    expect(parsed[0].fills![0].opacity).toBe(0.5);
  });

  it("should round-trip multiple strokes via duplicate classes", () => {
    const original = makeNode({
      strokes: [
        { type: "SOLID", color: "#000000" },
        { type: "SOLID", color: "#00FF00" },
      ],
      strokeWeight: 1,
    });
    const jsx = convertToJsx([original]);
    const parsed = parseJsx(jsx);
    expect(parsed[0].strokes).toHaveLength(2);
    expect(parsed[0].strokes![0].color).toBe("#000000");
    expect(parsed[0].strokes![1].color).toBe("#00FF00");
  });
});

// --- Tailwind gradient classes ---

describe("parseJsx - Tailwind gradients", () => {
  it("should parse bg-gradient-to-r with from/to hex colors", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="bg-gradient-to-r from-[#FF0000] to-[#0000FF]" />');
    expect(nodes[0].fills).toHaveLength(1);
    const fill = nodes[0].fills![0];
    expect(fill.type).toBe("GRADIENT_LINEAR");
    expect(fill.gradient?.type).toBe("GRADIENT_LINEAR");
    expect(fill.gradient?.direction).toBe("r");
    expect(fill.gradient?.stops).toHaveLength(2);
    expect(fill.gradient?.stops[0]).toEqual({ color: "#FF0000", position: 0 });
    expect(fill.gradient?.stops[1]).toEqual({ color: "#0000FF", position: 1 });
  });

  it("should parse gradient with via (3 stops)", () => {
    const nodes = parseJsx(
      '<div id="1:1" name="T" className="bg-gradient-to-b from-[#FF0000] via-[#00FF00] to-[#0000FF]" />',
    );
    const fill = nodes[0].fills![0];
    expect(fill.gradient?.stops).toHaveLength(3);
    expect(fill.gradient?.stops[0]).toEqual({ color: "#FF0000", position: 0 });
    expect(fill.gradient?.stops[1]).toEqual({ color: "#00FF00", position: 0.5 });
    expect(fill.gradient?.stops[2]).toEqual({ color: "#0000FF", position: 1 });
    expect(fill.gradient?.direction).toBe("b");
  });

  it("should parse gradient with opacity on from/to", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="bg-gradient-to-r from-[#FF0000]/50 to-[#0000FF]/80" />');
    const fill = nodes[0].fills![0];
    expect(fill.gradient?.stops).toHaveLength(2);
    // Colors are stored as-is (hex without opacity in gradient stops)
    expect(fill.gradient?.stops[0].color).toBe("#FF0000");
    expect(fill.gradient?.stops[1].color).toBe("#0000FF");
  });

  it("should parse gradient with various directions", () => {
    const directions = ["r", "l", "t", "b", "tr", "tl", "br", "bl"];
    for (const dir of directions) {
      const nodes = parseJsx(`<div id="1:1" name="T" className="bg-gradient-to-${dir} from-[#000] to-[#fff]" />`);
      expect(nodes[0].fills![0].gradient?.direction).toBe(dir);
    }
  });

  it("should parse gradient without direction (from/to only)", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="from-[#FF0000] to-[#0000FF]" />');
    expect(nodes[0].fills).toHaveLength(1);
    expect(nodes[0].fills![0].gradient?.stops).toHaveLength(2);
  });

  it("should not confuse gradient classes with bg-* variable", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="bg-gradient-to-r from-[#FF0000] to-[#0000FF]" />');
    // Should NOT create a variable binding for bg-gradient-to-r
    expect(nodes[0].bindings?.["fills/0"]).toBeUndefined();
  });

  it("should not produce a gradient fill with only from (no to)", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="bg-gradient-to-r from-[#FF0000]" />');
    // Single stop is invalid; should produce no gradient fill
    expect(nodes[0].fills?.some((f) => f.gradient)).toBeFalsy();
  });

  it("should not produce a gradient fill with only to (no from)", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="to-[#0000FF]" />');
    expect(nodes[0].fills?.some((f) => f.gradient)).toBeFalsy();
  });

  it("should not store opacity in gradient stops from /N suffix", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="bg-gradient-to-r from-[#FF0000]/50 to-[#0000FF]/80" />');
    const fill = nodes[0].fills![0];
    // Per-stop opacity from Tailwind /N is not supported; stops have no opacity field
    expect((fill.gradient?.stops[0] as any).opacity).toBeUndefined();
    expect((fill.gradient?.stops[1] as any).opacity).toBeUndefined();
  });
});

// --- Fill replace-not-accumulate semantics ---

describe("parseJsx - multiple fills/strokes accumulation", () => {
  it("should keep only the last bg-[#hex] when multiple are provided (replace-not-accumulate)", () => {
    // Each bg-* class replaces the previous fill — last one wins.
    const nodes = parseJsx('<div id="1:1" name="T" className="bg-[#ffffff] bg-[#FF0000]/50" />');
    expect(nodes[0].fills).toHaveLength(1);
    expect(nodes[0].fills![0].color).toBe("#FF0000");
    expect(nodes[0].fills![0].opacity).toBe(0.5);
  });

  it("should accumulate multiple border-[#hex] into strokes array", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="border-[1px] border-[#000000] border-[#00FF00]" />');
    expect(nodes[0].strokes).toHaveLength(2);
    expect(nodes[0].strokes![0].color).toBe("#000000");
    expect(nodes[0].strokes![1].color).toBe("#00FF00");
  });

  it("should keep only the last bg variable binding (replace-not-accumulate)", () => {
    // Last bg-* class wins; the binding is always at fills/0.
    const nodes = parseJsx('<div id="1:1" name="T" className="bg-primary bg-secondary" />');
    expect(nodes[0].fills).toHaveLength(1);
    expect(nodes[0].bindings?.["fills/0"]).toBe("secondary");
    expect(nodes[0].bindings?.["fills/1"]).toBeUndefined();
  });

  it("should use correct binding indices for multiple border variables", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="border-[1px] border-primary border-secondary" />');
    expect(nodes[0].strokes).toHaveLength(2);
    expect(nodes[0].bindings?.["strokes/0"]).toBe("primary");
    expect(nodes[0].bindings?.["strokes/1"]).toBe("secondary");
  });

  it("should use style gradient fill when both className bg and style background are present (style wins)", () => {
    // applyStyleAttribute runs after applyClassName, so the gradient replaces the solid fill.
    const jsx =
      '<div id="1:1" name="T" className="bg-[#ffffff]" style={{ background: "linear-gradient(#ff0000 0%, #0000ff 100%)" }} />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].fills).toHaveLength(1);
    expect(nodes[0].fills![0].gradient?.type).toBe("GRADIENT_LINEAR");
  });

  it("should skip JSX comments gracefully without interpreting them", () => {
    const jsx = `{/* Some random comment */}
<div id="1:1" name="T" className="bg-[#ffffff]" />`;
    const nodes = parseJsx(jsx);
    expect(nodes[0].fills).toHaveLength(1);
    expect(nodes[0].fills![0].color).toBe("#ffffff");
  });

  it("should skip JSX comments inside container children", () => {
    const jsx = `<div id="1:1" name="Parent" className="flex flex-col">
  {/* A child comment */}
  <div id="1:2" name="Child" className="bg-[#ffffff]" />
</div>`;
    const nodes = parseJsx(jsx);
    expect(nodes[0].children).toHaveLength(1);
    expect(nodes[0].children![0].fills).toHaveLength(1);
  });

  it("should keep only the last fill when 3 bg classes are present (replace-not-accumulate)", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="bg-[#111111] bg-[#222222] bg-[#333333]" />');
    expect(nodes[0].fills).toHaveLength(1);
    expect(nodes[0].fills![0].color).toBe("#333333");
  });
});

// --- Component tags ---

describe("parseJsx - component tags", () => {
  it("should detect COMPONENT_SET from tag with Set suffix", () => {
    const nodes = parseJsx('<ButtonSet id="1:1" />');
    expect(nodes[0].type).toBe("COMPONENT_SET");
    expect(nodes[0].name).toBe("Button");
  });

  it("should detect COMPONENT_SET from propertyDefinitions attr", () => {
    const jsx = '<MyComponent id="1:1" propertyDefinitions={{ size: "sm | md | lg" }} />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].type).toBe("COMPONENT_SET");
    expect(nodes[0].name).toBe("MyComponent");
  });

  it("should parse propertyDefinitions into componentPropertyDefinitions", () => {
    const jsx = '<ButtonSet id="1:1" propertyDefinitions={{ size: "sm | md | lg", disabled: false }} />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].componentPropertyDefinitions).toBeDefined();
    const defs = nodes[0].componentPropertyDefinitions!;
    expect(defs["size"]).toEqual({ type: "VARIANT", options: ["sm", "md", "lg"], default: "sm" });
    expect(defs["disabled"]).toEqual({ type: "BOOLEAN", default: false });
  });

  it("should restore original names from propertyNameMap in COMPONENT_SET", () => {
    const jsx =
      '<ButtonSet id="1:1" propertyDefinitions={{ showIcon: true }} propertyNameMap={{ showIcon: "Show Icon" }} />';
    const nodes = parseJsx(jsx);
    const defs = nodes[0].componentPropertyDefinitions!;
    expect(defs["Show Icon"]).toBeDefined();
    expect(defs["Show Icon"].type).toBe("BOOLEAN");
    expect(defs["showIcon"]).toBeUndefined();
  });

  it("should parse InstanceSwap property definition", () => {
    const jsx = '<ButtonSet id="1:1" propertyDefinitions={{ icon: "InstanceSwap" }} />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].componentPropertyDefinitions!["icon"]).toEqual({ type: "INSTANCE_SWAP" });
  });

  it("should parse TEXT property definition", () => {
    const jsx = '<ButtonSet id="1:1" propertyDefinitions={{ label: "Click me" }} />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].componentPropertyDefinitions!["label"]).toEqual({ type: "TEXT", default: "Click me" });
  });

  it("should detect COMPONENT as child of COMPONENT_SET", () => {
    const jsx = `<ButtonSet id="1:1">
  <Button id="1:2" size="md" state="default" />
</ButtonSet>`;
    const nodes = parseJsx(jsx);
    expect(nodes[0].type).toBe("COMPONENT_SET");
    expect(nodes[0].children).toHaveLength(1);
    expect(nodes[0].children![0].type).toBe("COMPONENT");
  });

  it("should populate variantProperties on COMPONENT children", () => {
    const jsx = `<ButtonSet id="1:1">
  <Button id="1:2" size="md" state="default" />
</ButtonSet>`;
    const nodes = parseJsx(jsx);
    const child = nodes[0].children![0];
    expect(child.variantProperties).toEqual({ size: "md", state: "default" });
  });

  it("should derive COMPONENT name from variant props", () => {
    const jsx = `<ButtonSet id="1:1">
  <Button id="1:2" size="md" state="default" />
</ButtonSet>`;
    const nodes = parseJsx(jsx);
    const child = nodes[0].children![0];
    expect(child.name).toBe("size=md, state=default");
  });

  it("should restore original variant property names from propertyNameMap", () => {
    const jsx = `<ButtonSet id="1:1">
  <Button id="1:2" showIcon="true" propertyNameMap={{ showIcon: "Show Icon" }} />
</ButtonSet>`;
    const nodes = parseJsx(jsx);
    const child = nodes[0].children![0];
    expect(child.variantProperties!["Show Icon"]).toBe("true");
    expect(child.variantProperties!["showIcon"]).toBeUndefined();
  });

  it("should set componentSetName on COMPONENT children", () => {
    const jsx = `<ButtonSet id="1:1">
  <Button id="1:2" size="md" />
</ButtonSet>`;
    const nodes = parseJsx(jsx);
    expect(nodes[0].children![0].componentSetName).toBe("Button");
  });

  it("should detect standalone COMPONENT from bare PascalCase tag", () => {
    const nodes = parseJsx('<IconClose id="1:1" />');
    expect(nodes[0].type).toBe("COMPONENT");
    expect(nodes[0].name).toBe("IconClose");
  });

  it("should detect INSTANCE from PascalCase tag with non-standard attrs", () => {
    const jsx = '<Button id="1:1" size="md" disabled={false} />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].type).toBe("INSTANCE");
  });

  it("should parse INSTANCE componentProperties with type inference", () => {
    const jsx = '<Button id="1:1" size="lg" disabled={true} />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].componentProperties).toBeDefined();
    const props = nodes[0].componentProperties!;
    expect(props["size"]).toEqual({ type: "VARIANT", value: "lg" });
    expect(props["disabled"]).toEqual({ type: "BOOLEAN", value: true });
  });

  it("should set mainComponentName on INSTANCE from tag", () => {
    const jsx = '<Button id="1:1" size="md" />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].mainComponentName).toBe("Button");
  });

  it("should set mainComponentName on INSTANCE from componentName attr", () => {
    const jsx = '<ProfileAvatar id="1:1" componentName="Profile Avatar" size="lg" />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].mainComponentName).toBe("Profile Avatar");
    expect(nodes[0].name).toBe("Profile Avatar");
  });

  it("should preserve componentName on COMPONENT_SET", () => {
    const jsx = '<ProfileAvatarSet id="1:1" componentName="Profile Avatar" />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].type).toBe("COMPONENT_SET");
    expect(nodes[0].name).toBe("Profile Avatar");
  });

  it("should round-trip COMPONENT_SET with variants", () => {
    const original: FigmaNodeData = {
      id: "1:1",
      name: "Button",
      type: "COMPONENT_SET",
      visible: true,
      componentPropertyDefinitions: {
        Size: { type: "VARIANT", options: ["sm", "md", "lg"] },
        Disabled: { type: "BOOLEAN", default: false },
      },
      children: [
        {
          id: "1:2",
          name: "Size=md, Disabled=false",
          type: "COMPONENT",
          visible: true,
          componentSetName: "Button",
          variantProperties: { Size: "md", Disabled: "false" },
        },
      ],
    };
    const jsx = convertToJsx([original]);
    const parsed = parseJsx(jsx);

    expect(parsed[0].type).toBe("COMPONENT_SET");
    expect(parsed[0].name).toBe("Button");
    expect(parsed[0].componentPropertyDefinitions).toBeDefined();
    expect(parsed[0].componentPropertyDefinitions!["Size"]).toEqual({
      type: "VARIANT",
      options: ["sm", "md", "lg"],
      default: "sm",
    });
    expect(parsed[0].componentPropertyDefinitions!["Disabled"]).toEqual({
      type: "BOOLEAN",
      default: false,
    });

    expect(parsed[0].children).toHaveLength(1);
    const child = parsed[0].children![0];
    expect(child.type).toBe("COMPONENT");
    expect(child.variantProperties).toBeDefined();
  });

  it("should round-trip standalone COMPONENT", () => {
    const original: FigmaNodeData = {
      id: "1:1",
      name: "CloseIcon",
      type: "COMPONENT",
      visible: true,
      layoutMode: "HORIZONTAL",
    };
    const jsx = convertToJsx([original]);
    const parsed = parseJsx(jsx);
    expect(parsed[0].type).toBe("COMPONENT");
    expect(parsed[0].name).toBe("CloseIcon");
  });

  it("should round-trip INSTANCE with properties", () => {
    const original: FigmaNodeData = {
      id: "1:1",
      name: "Button",
      type: "INSTANCE",
      visible: true,
      mainComponentName: "Button",
      componentProperties: {
        Size: { type: "VARIANT", value: "lg" },
        Disabled: { type: "BOOLEAN", value: true },
      },
    };
    const jsx = convertToJsx([original]);
    const parsed = parseJsx(jsx);
    expect(parsed[0].type).toBe("INSTANCE");
    expect(parsed[0].mainComponentName).toBe("Button");
    expect(parsed[0].componentProperties).toBeDefined();
    expect(parsed[0].componentProperties!["Size"]).toEqual({ type: "VARIANT", value: "lg" });
    expect(parsed[0].componentProperties!["Disabled"]).toEqual({ type: "BOOLEAN", value: true });
  });

  it("should NOT set componentSetName on standalone COMPONENT", () => {
    const nodes = parseJsx('<IconClose id="1:1" />');
    expect(nodes[0].type).toBe("COMPONENT");
    expect(nodes[0].componentSetName).toBeUndefined();
  });

  // --- Edge-case / disambiguation tests ---

  it("should treat lowercase tag with name attr as FRAME even with propertyDefinitions", () => {
    // lowercase tags are always FRAME regardless of attrs
    const nodes = parseJsx('<mywidget id="1:1" name="Widget" propertyDefinitions={{ size: "sm | lg" }} />');
    expect(nodes[0].type).toBe("FRAME");
  });

  it("should treat PascalCase tag with name attr as FRAME (not component)", () => {
    // A PascalCase tag WITH a name= attr is likely a regular frame from non-component context
    const nodes = parseJsx('<DataSet id="1:1" name="Data Set" />');
    expect(nodes[0].type).toBe("FRAME");
  });

  it("should treat PascalCase tag WITHOUT name attr as COMPONENT_SET when ending in Set", () => {
    // A PascalCase tag ending in "Set" without name= is a component set
    const nodes = parseJsx('<ButtonSet id="1:1" />');
    expect(nodes[0].type).toBe("COMPONENT_SET");
  });
});

// --- Standard Tailwind spacing ---

describe("parseJsx - standard Tailwind spacing", () => {
  it("should resolve px-6 to paddingLeft/Right: 24 + binding", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="px-6" />');
    expect(nodes[0].paddingLeft).toBe(24);
    expect(nodes[0].paddingRight).toBe(24);
    expect(nodes[0].bindings?.paddingLeft).toBe("6");
    expect(nodes[0].bindings?.paddingRight).toBe("6");
  });

  it("should resolve py-3 to paddingTop/Bottom: 12 + binding", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="py-3" />');
    expect(nodes[0].paddingTop).toBe(12);
    expect(nodes[0].paddingBottom).toBe(12);
    expect(nodes[0].bindings?.paddingTop).toBe("3");
    expect(nodes[0].bindings?.paddingBottom).toBe("3");
  });

  it("should resolve p-4 to all padding: 16 + binding", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="p-4" />');
    expect(nodes[0].paddingTop).toBe(16);
    expect(nodes[0].paddingRight).toBe(16);
    expect(nodes[0].paddingBottom).toBe(16);
    expect(nodes[0].paddingLeft).toBe(16);
    expect(nodes[0].bindings?.paddingTop).toBe("4");
  });

  it("should resolve gap-4 to itemSpacing: 16 + binding", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="flex flex-row gap-4" />');
    expect(nodes[0].itemSpacing).toBe(16);
    expect(nodes[0].bindings?.itemSpacing).toBe("4");
  });

  it("should resolve w-12 to width: 48, FIXED", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="w-12" />');
    expect(nodes[0].width).toBe(48);
    expect(nodes[0].layoutSizingHorizontal).toBe("FIXED");
  });

  it("should resolve h-8 to height: 32, FIXED", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="h-8" />');
    expect(nodes[0].height).toBe(32);
    expect(nodes[0].layoutSizingVertical).toBe("FIXED");
  });

  it("should resolve w-full to FILL", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="w-full" />');
    expect(nodes[0].layoutSizingHorizontal).toBe("FILL");
  });

  it("should resolve w-auto to HUG", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="w-auto" />');
    expect(nodes[0].layoutSizingHorizontal).toBe("HUG");
  });

  it("should resolve h-auto to HUG", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="h-auto" />');
    expect(nodes[0].layoutSizingVertical).toBe("HUG");
  });

  it("should resolve w-screen to 1440", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="w-screen" />');
    expect(nodes[0].width).toBe(1440);
    expect(nodes[0].layoutSizingHorizontal).toBe("FIXED");
  });

  it("should still handle variable-only padding bindings", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="p-spacing-4" />');
    expect(nodes[0].bindings?.paddingTop).toBe("spacing/4");
    expect(nodes[0].paddingTop).toBe(0);
  });
});

// --- Absolute positioning & inset ---
describe("parseJsx - absolute positioning", () => {
  it("should parse inset-0 as FILL on both axes with x=0, y=0", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="absolute inset-0" />');
    expect(nodes[0].layoutPositioning).toBe("ABSOLUTE");
    expect(nodes[0].layoutSizingHorizontal).toBe("FILL");
    expect(nodes[0].layoutSizingVertical).toBe("FILL");
    expect(nodes[0].x).toBe(0);
    expect(nodes[0].y).toBe(0);
  });

  it("should parse inset-x-0 as horizontal FILL", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="absolute inset-x-0" />');
    expect(nodes[0].layoutSizingHorizontal).toBe("FILL");
    expect(nodes[0].x).toBe(0);
  });

  it("should parse inset-y-0 as vertical FILL", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="absolute inset-y-0" />');
    expect(nodes[0].layoutSizingVertical).toBe("FILL");
    expect(nodes[0].y).toBe(0);
  });

  it("should parse left-0 and top-0 classes", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="absolute left-0 top-0" />');
    expect(nodes[0].x).toBe(0);
    expect(nodes[0].y).toBe(0);
  });

  it("should parse right-0 and bottom-0 classes", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="absolute right-0 bottom-0" />');
    expect(nodes[0].x).toBe(0);
    expect(nodes[0].y).toBe(0);
  });

  it("should parse right-[Npx] and bottom-[Npx] classes", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="absolute right-[10px] bottom-[20px]" />');
    expect(nodes[0].x).toBe(10);
    expect(nodes[0].y).toBe(20);
  });

  it("should parse left/top from style attribute", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="absolute" style="left: 24px; top: 350px;" />');
    expect(nodes[0].layoutPositioning).toBe("ABSOLUTE");
    expect(nodes[0].x).toBe(24);
    expect(nodes[0].y).toBe(350);
  });

  it("should parse position: absolute from style attribute", () => {
    const nodes = parseJsx('<div id="1:1" name="T" style="position: absolute; left: 10px; top: 20px;" />');
    expect(nodes[0].layoutPositioning).toBe("ABSOLUTE");
    expect(nodes[0].x).toBe(10);
    expect(nodes[0].y).toBe(20);
  });

  it("should parse inset: 0 from style attribute", () => {
    const nodes = parseJsx('<div id="1:1" name="T" style="position: absolute; inset: 0;" />');
    expect(nodes[0].layoutPositioning).toBe("ABSOLUTE");
    expect(nodes[0].layoutSizingHorizontal).toBe("FILL");
    expect(nodes[0].layoutSizingVertical).toBe("FILL");
    expect(nodes[0].x).toBe(0);
    expect(nodes[0].y).toBe(0);
  });

  it("should handle overlay scrim pattern", () => {
    const nodes = parseJsx('<div name="Scrim" className="absolute inset-0 bg-background-primary opacity-[0.6]" />');
    expect(nodes[0].layoutPositioning).toBe("ABSOLUTE");
    expect(nodes[0].layoutSizingHorizontal).toBe("FILL");
    expect(nodes[0].layoutSizingVertical).toBe("FILL");
    expect(nodes[0].opacity).toBe(0.6);
  });
});

// --- Standard Tailwind colors ---

describe("parseJsx - standard Tailwind colors", () => {
  it("should resolve bg-blue-600 to fill #2563EB + binding", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="bg-blue-600" />');
    expect(nodes[0].fills).toEqual([{ type: "SOLID", color: "#2563EB" }]);
    expect(nodes[0].bindings?.["fills/0"]).toBe("blue/600");
  });

  it("should resolve bg-white to fill #FFFFFF + binding", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="bg-white" />');
    expect(nodes[0].fills).toEqual([{ type: "SOLID", color: "#FFFFFF" }]);
    expect(nodes[0].bindings?.["fills/0"]).toBe("white");
  });

  it("should resolve bg-black to fill #000000 + binding", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="bg-black" />');
    expect(nodes[0].fills).toEqual([{ type: "SOLID", color: "#000000" }]);
    expect(nodes[0].bindings?.["fills/0"]).toBe("black");
  });

  it("should resolve text-white on TEXT to fill #FFFFFF + binding", () => {
    const nodes = parseJsx('<span id="1:1" name="T" className="text-sm text-white">\n  Hello\n</span>');
    const whiteFill = nodes[0].fills?.find((f) => f.color === "#FFFFFF");
    expect(whiteFill).toBeDefined();
  });

  it("should resolve text-red-500 on TEXT to fill #EF4444 + binding", () => {
    const nodes = parseJsx('<span id="1:1" name="T" className="text-sm text-red-500">\n  Hello\n</span>');
    const redFill = nodes[0].fills?.find((f) => f.color === "#EF4444");
    expect(redFill).toBeDefined();
  });

  it("should resolve border-gray-300 to stroke color #D1D5DB + binding", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="border border-gray-300" />');
    expect(nodes[0].strokeWeight).toBe(1);
    expect(nodes[0].strokes?.[0].color).toBe("#D1D5DB");
    expect(nodes[0].bindings?.["strokes/0"]).toBe("gray/300");
  });

  it("should still handle non-standard color names as variable bindings", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="bg-primary" />');
    expect(nodes[0].fills).toEqual([{ type: "SOLID", color: "#000000" }]);
    expect(nodes[0].bindings?.["fills/0"]).toBe("primary");
  });
});

// --- Standard Tailwind font sizes ---

describe("parseJsx - standard Tailwind font sizes", () => {
  it("should resolve text-sm on TEXT to fontSize: 14, lineHeight: 20", () => {
    const nodes = parseJsx('<span id="1:1" name="T" className="text-sm">\n  Hello\n</span>');
    expect(nodes[0].fontSize).toBe(14);
    expect(nodes[0].lineHeight).toBe(20);
  });

  it("should resolve text-xl on TEXT to fontSize: 20, lineHeight: 28", () => {
    const nodes = parseJsx('<span id="1:1" name="T" className="text-xl">\n  Hello\n</span>');
    expect(nodes[0].fontSize).toBe(20);
    expect(nodes[0].lineHeight).toBe(28);
  });

  it("should resolve text-base on TEXT to fontSize: 16, lineHeight: 24", () => {
    const nodes = parseJsx('<span id="1:1" name="T" className="text-base">\n  Hello\n</span>');
    expect(nodes[0].fontSize).toBe(16);
    expect(nodes[0].lineHeight).toBe(24);
  });

  it("should resolve text-2xl on TEXT to fontSize: 24, lineHeight: 32", () => {
    const nodes = parseJsx('<span id="1:1" name="T" className="text-2xl">\n  Hello\n</span>');
    expect(nodes[0].fontSize).toBe(24);
    expect(nodes[0].lineHeight).toBe(32);
  });

  it("should treat text-{color} as fill when text-sm is also present", () => {
    const nodes = parseJsx('<span id="1:1" name="T" className="text-sm text-gray-700">\n  Hello\n</span>');
    expect(nodes[0].fontSize).toBe(14);
    const grayFill = nodes[0].fills?.find((f) => f.color === "#374151");
    expect(grayFill).toBeDefined();
  });
});

// --- Standard Tailwind border radius ---

describe("parseJsx - standard Tailwind border radius", () => {
  it("should resolve rounded-lg to cornerRadius: 8 + binding", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="rounded-lg" />');
    expect(nodes[0].cornerRadius).toBe(8);
    expect(nodes[0].bindings?.cornerRadius).toBe("lg");
  });

  it("should resolve bare rounded to cornerRadius: 4 + binding DEFAULT", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="rounded" />');
    expect(nodes[0].cornerRadius).toBe(4);
    expect(nodes[0].bindings?.cornerRadius).toBe("DEFAULT");
  });

  it("should resolve rounded-full to cornerRadius: 9999 + binding", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="rounded-full" />');
    expect(nodes[0].cornerRadius).toBe(9999);
    expect(nodes[0].bindings?.cornerRadius).toBe("full");
  });

  it("should resolve rounded-md to cornerRadius: 6 + binding", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="rounded-md" />');
    expect(nodes[0].cornerRadius).toBe(6);
    expect(nodes[0].bindings?.cornerRadius).toBe("md");
  });

  it("should resolve rounded-none to cornerRadius: 0", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="rounded-none" />');
    expect(nodes[0].cornerRadius).toBe(0);
  });
});

// --- Standard Tailwind shadows ---

describe("parseJsx - standard Tailwind shadows", () => {
  it("should resolve shadow-md to effects with DROP_SHADOW", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="shadow-md" />');
    expect(nodes[0].effects).toBeDefined();
    expect(nodes[0].effects!.length).toBeGreaterThan(0);
    expect(nodes[0].effects![0].type).toBe("DROP_SHADOW");
  });

  it("should resolve shadow-lg to effects with DROP_SHADOW", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="shadow-lg" />');
    expect(nodes[0].effects).toBeDefined();
    expect(nodes[0].effects!.length).toBeGreaterThan(0);
    expect(nodes[0].effects![0].type).toBe("DROP_SHADOW");
  });

  it("should resolve bare shadow to default shadow effects", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="shadow" />');
    expect(nodes[0].effects).toBeDefined();
    expect(nodes[0].effects!.length).toBeGreaterThan(0);
  });

  it("should resolve shadow-inner to INNER_SHADOW effect", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="shadow-inner" />');
    expect(nodes[0].effects).toBeDefined();
    expect(nodes[0].effects![0].type).toBe("INNER_SHADOW");
  });

  it("should resolve shadow-none to empty effects", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="shadow-none" />');
    expect(nodes[0].effects).toEqual([]);
  });
});

// --- Effect style name via shadow class ---

describe("parseJsx - effect style name", () => {
  it("should parse unresolved shadow class as effectStyleName", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="shadow-shadow-subtle" />');
    expect(nodes[0].effectStyleName).toBe("shadow/subtle");
    expect(nodes[0].effects).toBeUndefined();
  });

  it("should still resolve standard shadow-md as effects", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="shadow-md" />');
    expect(nodes[0].effectStyleName).toBeUndefined();
    expect(nodes[0].effects).toBeDefined();
    expect(nodes[0].effects![0].type).toBe("DROP_SHADOW");
  });
});

// --- Standard Tailwind opacity ---

describe("parseJsx - standard Tailwind opacity", () => {
  it("should resolve opacity-50 to opacity: 0.5", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="opacity-50" />');
    expect(nodes[0].opacity).toBe(0.5);
  });

  it("should resolve opacity-0 to opacity: 0", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="opacity-0" />');
    expect(nodes[0].opacity).toBe(0);
  });

  it("should resolve opacity-100 to opacity: 1", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="opacity-100" />');
    expect(nodes[0].opacity).toBe(1);
  });
});

// --- Standard Tailwind blur ---

describe("parseJsx - standard Tailwind blur", () => {
  it("should resolve blur-sm to LAYER_BLUR with radius 4", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="blur-sm" />');
    expect(nodes[0].effects).toEqual([{ type: "LAYER_BLUR", radius: 4 }]);
  });

  it("should resolve bare blur to LAYER_BLUR with radius 8", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="blur" />');
    expect(nodes[0].effects).toEqual([{ type: "LAYER_BLUR", radius: 8 }]);
  });

  it("should resolve backdrop-blur-lg to BACKGROUND_BLUR with radius 16", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="backdrop-blur-lg" />');
    expect(nodes[0].effects).toEqual([{ type: "BACKGROUND_BLUR", radius: 16 }]);
  });
});

// --- Standard Tailwind border widths ---

describe("parseJsx - standard Tailwind border widths", () => {
  it("should resolve bare border to strokeWeight: 1", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="border" />');
    expect(nodes[0].strokeWeight).toBe(1);
  });

  it("should resolve border-2 to strokeWeight: 2", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="border-2" />');
    expect(nodes[0].strokeWeight).toBe(2);
  });

  it("should resolve border-0 to strokeWeight: 0", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="border-0" />');
    expect(nodes[0].strokeWeight).toBe(0);
  });
});

// --- Standard Tailwind line heights ---

describe("parseJsx - standard Tailwind line heights", () => {
  it("should resolve leading-tight to lineHeight: 125%", () => {
    const nodes = parseJsx('<span id="1:1" name="T" className="text-[14px] leading-tight">\n  T\n</span>');
    expect(nodes[0].lineHeight).toBe(125);
    expect(nodes[0].lineHeightUnit).toBe("percent");
  });

  it("should resolve leading-6 to lineHeight: 24px", () => {
    const nodes = parseJsx('<span id="1:1" name="T" className="text-[14px] leading-6">\n  T\n</span>');
    expect(nodes[0].lineHeight).toBe(24);
  });

  it("should resolve leading-normal to lineHeight: 150%", () => {
    const nodes = parseJsx('<span id="1:1" name="T" className="text-[14px] leading-normal">\n  T\n</span>');
    expect(nodes[0].lineHeight).toBe(150);
    expect(nodes[0].lineHeightUnit).toBe("percent");
  });
});

// --- Standard Tailwind letter spacings ---

describe("parseJsx - standard Tailwind letter spacings", () => {
  it("should resolve tracking-tight to -2.5% letter spacing", () => {
    const nodes = parseJsx('<span id="1:1" name="T" className="text-[14px] tracking-tight">\n  T\n</span>');
    expect(nodes[0].letterSpacing).toBe(-2.5);
    expect(nodes[0].letterSpacingUnit).toBe("percent");
  });

  it("should resolve tracking-wide to 2.5% letter spacing", () => {
    const nodes = parseJsx('<span id="1:1" name="T" className="text-[14px] tracking-wide">\n  T\n</span>');
    expect(nodes[0].letterSpacing).toBe(2.5);
    expect(nodes[0].letterSpacingUnit).toBe("percent");
  });
});

// --- HTML tag support ---

describe("parseJsx - HTML tags", () => {
  it("should parse <button> with text children as FRAME + child TEXT", () => {
    const nodes = parseJsx('<button id="1:1">Get Started</button>');
    expect(nodes[0].type).toBe("FRAME");
    expect(nodes[0].name).toBe("Button");
    expect(nodes[0].children).toHaveLength(1);
    expect(nodes[0].children![0].type).toBe("TEXT");
    expect(nodes[0].children![0].characters).toBe("Get Started");
    // Default layout
    expect(nodes[0].layoutMode).toBe("HORIZONTAL");
    expect(nodes[0].primaryAxisAlignItems).toBe("CENTER");
    expect(nodes[0].counterAxisAlignItems).toBe("CENTER");
  });

  it("should parse fully styled <button> with standard Tailwind", () => {
    const nodes = parseJsx(
      '<button id="1:1" className="px-6 py-3 bg-blue-600 text-white rounded-lg text-sm font-semibold">Get Started</button>',
    );
    expect(nodes[0].type).toBe("FRAME");
    expect(nodes[0].paddingLeft).toBe(24);
    expect(nodes[0].paddingRight).toBe(24);
    expect(nodes[0].paddingTop).toBe(12);
    expect(nodes[0].paddingBottom).toBe(12);
    expect(nodes[0].fills?.[0].color).toBe("#2563EB");
    expect(nodes[0].cornerRadius).toBe(8);
    // Child text node
    expect(nodes[0].children).toHaveLength(1);
    const textNode = nodes[0].children![0];
    expect(textNode.type).toBe("TEXT");
    expect(textNode.characters).toBe("Get Started");
    expect(textNode.fontSize).toBe(14);
    expect(textNode.fontWeight).toBe(600);
  });

  it("should parse <input /> with default sizing and border", () => {
    const nodes = parseJsx('<input id="1:1" />');
    expect(nodes[0].type).toBe("FRAME");
    expect(nodes[0].name).toBe("Input");
    expect(nodes[0].width).toBe(240);
    expect(nodes[0].height).toBe(40);
    expect(nodes[0].cornerRadius).toBe(6);
    expect(nodes[0].strokeWeight).toBe(1);
    expect(nodes[0].strokes?.[0].color).toBe("#D1D5DB");
  });

  it("should parse <h1> as TEXT node with default fontSize 36", () => {
    const nodes = parseJsx('<h1 id="1:1">Title</h1>');
    expect(nodes[0].type).toBe("TEXT");
    expect(nodes[0].name).toBe("H1");
    expect(nodes[0].characters).toBe("Title");
    expect(nodes[0].fontSize).toBe(36);
    expect(nodes[0].fontWeight).toBe(800);
  });

  it("should parse <h2> as TEXT node with default fontSize 30", () => {
    const nodes = parseJsx('<h2 id="1:1">Subtitle</h2>');
    expect(nodes[0].type).toBe("TEXT");
    expect(nodes[0].fontSize).toBe(30);
    expect(nodes[0].fontWeight).toBe(700);
  });

  it("should parse <p> as TEXT node", () => {
    const nodes = parseJsx('<p id="1:1">Content paragraph</p>');
    expect(nodes[0].type).toBe("TEXT");
    expect(nodes[0].name).toBe("Text");
    expect(nodes[0].characters).toBe("Content paragraph");
  });

  it("should parse <img /> with default sizing and image fill", () => {
    const nodes = parseJsx('<img id="1:1" />');
    expect(nodes[0].type).toBe("FRAME");
    expect(nodes[0].name).toBe("Image");
    expect(nodes[0].width).toBe(100);
    expect(nodes[0].height).toBe(100);
    expect(nodes[0].fills?.some((f) => f.isImage)).toBe(true);
  });

  it("should parse <a> as TEXT node", () => {
    const nodes = parseJsx('<a id="1:1">Click here</a>');
    expect(nodes[0].type).toBe("TEXT");
    expect(nodes[0].name).toBe("Link");
    expect(nodes[0].characters).toBe("Click here");
  });

  it("should parse <li> with text children", () => {
    const nodes = parseJsx('<li id="1:1">List item</li>');
    expect(nodes[0].type).toBe("FRAME");
    expect(nodes[0].name).toBe("ListItem");
    expect(nodes[0].children).toHaveLength(1);
    expect(nodes[0].children![0].characters).toBe("List item");
  });

  it("should parse <select> with defaults", () => {
    const nodes = parseJsx('<select id="1:1" />');
    expect(nodes[0].name).toBe("Select");
    expect(nodes[0].width).toBe(240);
    expect(nodes[0].height).toBe(40);
    expect(nodes[0].cornerRadius).toBe(6);
  });

  it("should parse <textarea> with defaults", () => {
    const nodes = parseJsx('<textarea id="1:1" />');
    expect(nodes[0].name).toBe("Textarea");
    expect(nodes[0].width).toBe(240);
    expect(nodes[0].height).toBe(120);
  });

  it("should not override explicit classes with HTML tag defaults", () => {
    const nodes = parseJsx('<input id="1:1" className="w-[300px] h-[50px] rounded-[10px]" />');
    expect(nodes[0].width).toBe(300);
    expect(nodes[0].height).toBe(50);
    expect(nodes[0].cornerRadius).toBe(10);
  });

  it("should split text/frame classes when button has text children", () => {
    const nodes = parseJsx('<button id="1:1" className="px-4 py-2 text-sm font-bold">Click</button>');
    // Frame gets padding
    expect(nodes[0].paddingLeft).toBe(16);
    expect(nodes[0].paddingTop).toBe(8);
    // Text child gets typography
    expect(nodes[0].children![0].fontSize).toBe(14);
    expect(nodes[0].children![0].fontWeight).toBe(700);
  });

  it("should handle <section> tag as FRAME", () => {
    const nodes = parseJsx('<section id="1:1" className="flex flex-col" />');
    expect(nodes[0].type).toBe("FRAME");
    expect(nodes[0].name).toBe("Section");
    expect(nodes[0].layoutMode).toBe("VERTICAL");
  });

  it("should handle <strong> as TEXT node", () => {
    const nodes = parseJsx('<strong id="1:1">Bold text</strong>');
    expect(nodes[0].type).toBe("TEXT");
    expect(nodes[0].characters).toBe("Bold text");
  });
});

// --- Style attribute: additional CSS properties ---

describe("parseJsx - style attribute CSS properties", () => {
  it("should parse backgroundColor from style on FRAME", () => {
    const jsx = '<div id="1:1" name="T" style={{ backgroundColor: "#ff0000" }} />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].fills).toEqual([{ type: "SOLID", color: "#ff0000" }]);
  });

  it("should parse color from style on TEXT node", () => {
    const jsx = '<span id="1:1" name="T" style={{ color: "#fafafa" }}>\n  Hello\n</span>';
    const nodes = parseJsx(jsx);
    expect(nodes[0].fills).toEqual([{ type: "SOLID", color: "#fafafa" }]);
  });

  it("should parse fontFamily from style on TEXT node", () => {
    const jsx = '<span id="1:1" name="T" style={{ fontFamily: "Manrope" }}>\n  Hello\n</span>';
    const nodes = parseJsx(jsx);
    expect(nodes[0].fontFamily).toBe("Manrope");
  });

  it("should parse borderColor from style", () => {
    const jsx = '<div id="1:1" name="T" style={{ borderColor: "#2a2a2a" }} />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].strokes).toEqual([{ type: "SOLID", color: "#2a2a2a" }]);
  });

  it("should parse borderRadius from style", () => {
    const jsx = '<div id="1:1" name="T" style={{ borderRadius: "8px" }} />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].cornerRadius).toBe(8);
  });

  it("should propagate color from style to child TEXT nodes on FRAME", () => {
    const jsx = '<button id="1:1" style={{ color: "#0a0a0a" }}>Click</button>';
    const nodes = parseJsx(jsx);
    expect(nodes[0].type).toBe("FRAME");
    expect(nodes[0].children![0].type).toBe("TEXT");
    expect(nodes[0].children![0].fills).toEqual([{ type: "SOLID", color: "#0a0a0a" }]);
  });

  it("should propagate fontFamily from style to child TEXT nodes on FRAME", () => {
    const jsx = '<button id="1:1" style={{ fontFamily: "Manrope" }}>Click</button>';
    const nodes = parseJsx(jsx);
    expect(nodes[0].children![0].fontFamily).toBe("Manrope");
  });

  it("should not override child TEXT fills if already set", () => {
    const jsx = '<button id="1:1" className="text-white" style={{ color: "#0a0a0a" }}>Click</button>';
    const nodes = parseJsx(jsx);
    // text-white should be applied to child TEXT, and style color should NOT override it
    expect(nodes[0].children![0].fills![0].color).toBe("#FFFFFF");
  });

  it("should ignore transparent backgroundColor", () => {
    const jsx = '<div id="1:1" name="T" style={{ backgroundColor: "transparent" }} />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].fills).toBeUndefined();
  });
});

// --- Bare flex as HORIZONTAL ---

describe("parseJsx - bare flex defaults to HORIZONTAL", () => {
  it("should set layoutMode HORIZONTAL for bare flex", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="flex items-center gap-4" />');
    expect(nodes[0].layoutMode).toBe("HORIZONTAL");
    expect(nodes[0].counterAxisAlignItems).toBe("CENTER");
    expect(nodes[0].itemSpacing).toBe(16);
  });

  it("should not override flex-col with flex default", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="flex flex-col" />');
    expect(nodes[0].layoutMode).toBe("VERTICAL");
  });

  it("should not override flex-row with flex default", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="flex flex-row" />');
    expect(nodes[0].layoutMode).toBe("HORIZONTAL");
  });

  // --- SVG support ---

  it("should parse <svg> as SVG type with svgString", () => {
    const svg = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M12 2L2 22h20L12 2z" /></svg>';
    const nodes = parseJsx(svg);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe("SVG");
    expect(nodes[0].svgString).toContain("<svg");
    expect(nodes[0].svgString).toContain("</svg>");
    expect(nodes[0].svgString).toContain('<path d="M12 2L2 22h20L12 2z"');
  });

  it("should not recursively parse SVG children as FigmaNodeData", () => {
    const svg =
      '<svg width="16" height="16"><circle cx="8" cy="8" r="8" /><rect x="0" y="0" width="16" height="16" /></svg>';
    const nodes = parseJsx(svg);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].children).toBeUndefined();
  });

  it("should preserve SVG attributes in svgString", () => {
    const svg =
      '<svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M0 0" /></svg>';
    const nodes = parseJsx(svg);
    expect(nodes[0].svgString).toContain('viewBox="0 0 48 48"');
    expect(nodes[0].svgString).toContain('fill="none"');
    expect(nodes[0].svgString).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(nodes[0].width).toBe(48);
    expect(nodes[0].height).toBe(48);
  });

  it("should handle SVG inside a div (mixed content)", () => {
    const jsx = '<div id="1:1" name="Container"><svg width="24" height="24"><path d="M0 0" /></svg></div>';
    const nodes = parseJsx(jsx);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe("FRAME");
    expect(nodes[0].children).toHaveLength(1);
    expect(nodes[0].children![0].type).toBe("SVG");
    expect(nodes[0].children![0].svgString).toContain("<svg");
  });

  it("should strip non-SVG attributes (name, id, className) from svgString", () => {
    const svg =
      '<svg name="Icon" id="1:1" className="icon-class" width="24" height="24" viewBox="0 0 24 24"><path d="M0 0" /></svg>';
    const nodes = parseJsx(svg);
    expect(nodes[0].svgString).not.toContain("name=");
    expect(nodes[0].svgString).not.toContain("id=");
    expect(nodes[0].svgString).not.toContain("className=");
    expect(nodes[0].svgString).toContain('width="24"');
    expect(nodes[0].svgString).toContain('viewBox="0 0 24 24"');
    // The name should still be set on the node data
    expect(nodes[0].name).toBe("Icon");
  });

  it("should preserve root stroke attribute in svgString", () => {
    const svg =
      '<svg width="24" height="24" viewBox="0 0 24 24" stroke="#ff0000"><path d="M0 0" /></svg>';
    const nodes = parseJsx(svg);
    expect(nodes[0].type).toBe("SVG");
    expect(nodes[0].svgString).toContain('stroke="#ff0000"');
  });

  it("should preserve root stroke-width attribute in svgString", () => {
    const svg =
      '<svg width="24" height="24" viewBox="0 0 24 24" stroke="#000000" stroke-width="2"><path d="M0 0" /></svg>';
    const nodes = parseJsx(svg);
    expect(nodes[0].svgString).toContain('stroke="#000000"');
    expect(nodes[0].svgString).toContain('stroke-width="2"');
  });

  it("should preserve root stroke-opacity attribute in svgString", () => {
    const svg =
      '<svg width="24" height="24" stroke="#333333" stroke-width="1.5" stroke-opacity="0.5"><path d="M0 0" /></svg>';
    const nodes = parseJsx(svg);
    expect(nodes[0].svgString).toContain('stroke="#333333"');
    expect(nodes[0].svgString).toContain('stroke-opacity="0.5"');
  });

  it("should preserve stroke=\"none\" in svgString (no-stroke marker is passed through)", () => {
    const svg = '<svg width="24" height="24" stroke="none"><path d="M0 0" /></svg>';
    const nodes = parseJsx(svg);
    expect(nodes[0].svgString).toContain('stroke="none"');
  });
});

// --- CSS string format in style attribute ---

describe("parseJsx - CSS string format in style attribute", () => {
  it("should parse a full CSS string style with layout properties", () => {
    const jsx =
      '<div id="1:1" name="T" style="width: 1440px; height: 900px; display: flex; flex-direction: column; justify-content: center; align-items: center; background-color: #0a0a0a;" />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].width).toBe(1440);
    expect(nodes[0].height).toBe(900);
    expect(nodes[0].layoutMode).toBe("VERTICAL");
    expect(nodes[0].primaryAxisAlignItems).toBe("CENTER");
    expect(nodes[0].counterAxisAlignItems).toBe("CENTER");
    expect(nodes[0].fills).toEqual([{ type: "SOLID", color: "#0a0a0a" }]);
  });

  it("should convert kebab-case CSS properties to camelCase", () => {
    const jsx = '<div id="1:1" name="T" style="background-color: #ff0000; border-radius: 12px;" />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].fills).toEqual([{ type: "SOLID", color: "#ff0000" }]);
    expect(nodes[0].cornerRadius).toBe(12);
  });

  it("should handle display: flex defaulting to HORIZONTAL", () => {
    const jsx = '<div id="1:1" name="T" style="display: flex;" />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].layoutMode).toBe("HORIZONTAL");
  });

  it("should handle flex-direction: row", () => {
    const jsx = '<div id="1:1" name="T" style="display: flex; flex-direction: row;" />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].layoutMode).toBe("HORIZONTAL");
  });

  it("should handle flex-direction: column", () => {
    const jsx = '<div id="1:1" name="T" style="display: flex; flex-direction: column;" />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].layoutMode).toBe("VERTICAL");
  });

  it("should handle justify-content values", () => {
    const cases: Array<[string, string]> = [
      ["flex-start", "MIN"],
      ["start", "MIN"],
      ["center", "CENTER"],
      ["flex-end", "MAX"],
      ["end", "MAX"],
      ["space-between", "SPACE_BETWEEN"],
    ];
    for (const [cssVal, figmaVal] of cases) {
      const jsx = `<div id="1:1" name="T" style="display: flex; justify-content: ${cssVal};" />`;
      const nodes = parseJsx(jsx);
      expect(nodes[0].primaryAxisAlignItems).toBe(figmaVal);
    }
  });

  it("should handle align-items values", () => {
    const cases: Array<[string, string]> = [
      ["flex-start", "MIN"],
      ["start", "MIN"],
      ["center", "CENTER"],
      ["flex-end", "MAX"],
      ["end", "MAX"],
      ["baseline", "BASELINE"],
    ];
    for (const [cssVal, figmaVal] of cases) {
      const jsx = `<div id="1:1" name="T" style="display: flex; align-items: ${cssVal};" />`;
      const nodes = parseJsx(jsx);
      expect(nodes[0].counterAxisAlignItems).toBe(figmaVal);
    }
  });

  it("should handle gap property", () => {
    const jsx = '<div id="1:1" name="T" style="display: flex; gap: 16px;" />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].itemSpacing).toBe(16);
  });

  it("should handle padding shorthand (1 value)", () => {
    const jsx = '<div id="1:1" name="T" style="padding: 20px;" />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].paddingTop).toBe(20);
    expect(nodes[0].paddingRight).toBe(20);
    expect(nodes[0].paddingBottom).toBe(20);
    expect(nodes[0].paddingLeft).toBe(20);
  });

  it("should handle padding shorthand (2 values)", () => {
    const jsx = '<div id="1:1" name="T" style="padding: 10px 20px;" />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].paddingTop).toBe(10);
    expect(nodes[0].paddingBottom).toBe(10);
    expect(nodes[0].paddingRight).toBe(20);
    expect(nodes[0].paddingLeft).toBe(20);
  });

  it("should handle padding shorthand (3 values)", () => {
    const jsx = '<div id="1:1" name="T" style="padding: 10px 20px 30px;" />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].paddingTop).toBe(10);
    expect(nodes[0].paddingRight).toBe(20);
    expect(nodes[0].paddingLeft).toBe(20);
    expect(nodes[0].paddingBottom).toBe(30);
  });

  it("should handle padding shorthand (4 values)", () => {
    const jsx = '<div id="1:1" name="T" style="padding: 10px 20px 30px 40px;" />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].paddingTop).toBe(10);
    expect(nodes[0].paddingRight).toBe(20);
    expect(nodes[0].paddingBottom).toBe(30);
    expect(nodes[0].paddingLeft).toBe(40);
  });

  it("should handle padding with unitless 0", () => {
    const jsx = '<div id="1:1" name="T" style="padding: 0 16px;" />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].paddingTop).toBe(0);
    expect(nodes[0].paddingBottom).toBe(0);
    expect(nodes[0].paddingRight).toBe(16);
    expect(nodes[0].paddingLeft).toBe(16);
  });

  it("should handle individual padding properties", () => {
    const jsx = '<div id="1:1" name="T" style="padding-top: 5px; padding-right: 10px; padding-bottom: 15px; padding-left: 20px;" />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].paddingTop).toBe(5);
    expect(nodes[0].paddingRight).toBe(10);
    expect(nodes[0].paddingBottom).toBe(15);
    expect(nodes[0].paddingLeft).toBe(20);
  });

  it("should handle opacity", () => {
    const jsx = '<div id="1:1" name="T" style="opacity: 0.5;" />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].opacity).toBe(0.5);
  });

  it("should handle overflow: hidden", () => {
    const jsx = '<div id="1:1" name="T" style="overflow: hidden;" />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].clipsContent).toBe(true);
  });

  it("should handle flex-wrap: wrap", () => {
    const jsx = '<div id="1:1" name="T" style="display: flex; flex-wrap: wrap;" />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].layoutWrap).toBe("WRAP");
  });

  it("should handle text properties on TEXT nodes", () => {
    const jsx = '<span id="1:1" name="T" style="font-size: 18px; font-weight: 600; line-height: 24px; letter-spacing: 1px; text-align: center; text-transform: uppercase;">Hello</span>';
    const nodes = parseJsx(jsx);
    expect(nodes[0].fontSize).toBe(18);
    expect(nodes[0].fontWeight).toBe(600);
    expect(nodes[0].lineHeight).toBe(24);
    expect(nodes[0].letterSpacing).toBe(1);
    expect(nodes[0].textAlignHorizontal).toBe("CENTER");
    expect(nodes[0].textCase).toBe("UPPER");
  });

  it("should ignore border-style (no-op)", () => {
    const jsx = '<div id="1:1" name="T" style="border-style: solid; border-width: 2px;" />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].strokeWeight).toBe(2);
  });

  it("should handle min/max width/height", () => {
    const jsx = '<div id="1:1" name="T" style="max-width: 800px; min-height: 100px;" />';
    const nodes = parseJsx(jsx);
    expect((nodes[0] as any).maxWidth).toBe(800);
    expect((nodes[0] as any).minHeight).toBe(100);
  });

  it("should still parse JSX object format style (regression)", () => {
    const jsx = '<div id="1:1" name="T" style={{ backgroundColor: "#ff0000", borderRadius: "8px" }} />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].fills).toEqual([{ type: "SOLID", color: "#ff0000" }]);
    expect(nodes[0].cornerRadius).toBe(8);
  });

  it("should handle CSS string without trailing semicolon", () => {
    const jsx = '<div id="1:1" name="T" style="width: 100px; height: 50px" />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].width).toBe(100);
    expect(nodes[0].height).toBe(50);
  });

  // --- Icon/* placeholder frame fixes ---

  describe("Icon/* placeholder frames", () => {
    it("should use data-name attribute for node naming", () => {
      const nodes = parseJsx('<div data-name="Icon/save" className="w-[24px] h-[24px] shrink-0" />');
      expect(nodes[0].name).toBe("Icon/save");
    });

    it("data-name should take priority over name attribute", () => {
      const nodes = parseJsx('<div data-name="Icon/bell" name="Fallback" className="w-[24px] h-[24px]" />');
      expect(nodes[0].name).toBe("Icon/bell");
    });

    it("should strip strokes from Icon/* frames when border class is present", () => {
      const nodes = parseJsx(
        '<div data-name="Icon/arrow-left" className="w-[24px] h-[24px] border border-border-default shrink-0" />',
      );
      expect(nodes[0].name).toBe("Icon/arrow-left");
      expect(nodes[0].strokes).toBeUndefined();
      expect(nodes[0].strokeWeight).toBeUndefined();
    });

    it("should strip stroke bindings from Icon/* frames", () => {
      const nodes = parseJsx(
        '<div data-name="Icon/undo-2" className="w-[24px] h-[24px] border border-primary-500 shrink-0" />',
      );
      expect(nodes[0].strokes).toBeUndefined();
      const bindings = nodes[0].bindings ?? {};
      const hasStrokeBinding = Object.keys(bindings).some((k) => k.startsWith("strokes/"));
      expect(hasStrokeBinding).toBe(false);
    });

    it("should NOT strip strokes from non-Icon frames with borders", () => {
      const nodes = parseJsx('<div id="1:1" name="Card" className="border border-border-default" />');
      expect(nodes[0].strokeWeight).toBeDefined();
    });

    it("should still apply size classes on Icon/* frames", () => {
      const nodes = parseJsx(
        '<div data-name="Icon/save" className="w-[24px] h-[24px] border border-border-default shrink-0" />',
      );
      expect(nodes[0].width).toBe(24);
      expect(nodes[0].height).toBe(24);
    });
  });
});
