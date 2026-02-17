import { parseJsx } from "../../../src/claude_figma_mcp/utils/jsx-to-figma";
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
    expect(nodes[0].type).toBe("VECTOR");
    expect(nodes[0].width).toBe(24);
    expect(nodes[0].height).toBe(24);
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
    const nodes = parseJsx('<span id="1:1" name="T" className="text-card-foreground text-[18px] font-semibold leading-[24px]">\n  Hello\n</span>');
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
    const nodes = parseJsx('<div id="1:1" name="T" className="rounded-tl-[4px] rounded-tr-[8px] rounded-br-[12px] rounded-bl-[16px]" />');
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
    const jsx = '<div id="1:1" name="T" style={{ boxShadow: "0px 2px 4px 0px rgba(0,0,0,0.1), 0px 8px 16px 0px rgba(0,0,0,0.2)" }} />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].effects).toHaveLength(2);
    expect(nodes[0].effects![0].type).toBe("DROP_SHADOW");
    expect(nodes[0].effects![1].type).toBe("DROP_SHADOW");
  });

  // --- Style attribute: gradient ---

  it("should parse linear-gradient from style", () => {
    const jsx = '<div id="1:1" name="T" style={{ background: "linear-gradient(#ff0000 0%, #0000ff 100%)" }} />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].fills).toEqual([{
      type: "GRADIENT_LINEAR",
      gradient: {
        type: "GRADIENT_LINEAR",
        stops: [
          { color: "#ff0000", position: 0 },
          { color: "#0000ff", position: 1 },
        ],
      },
    }]);
  });

  it("should parse gradient with rgba colors", () => {
    const jsx = '<div id="1:1" name="T" style={{ background: "linear-gradient(rgba(255,0,0,0.5) 0%, rgba(0,0,255,1) 100%)" }} />';
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
    const jsx = '<div id="1:1" name="T" className="bg-cover bg-center" style={{ backgroundImage: "url(img-ref-123)" }} />';
    const nodes = parseJsx(jsx);
    const imageFill = nodes[0].fills?.find(f => f.isImage);
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
    const shadow = parsed[0].effects!.find(e => e.type === "DROP_SHADOW");
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
      fills: [{
        type: "GRADIENT_LINEAR",
        gradient: {
          type: "GRADIENT_LINEAR",
          stops: [
            { color: "#ff0000", position: 0 },
            { color: "#0000ff", position: 1 },
          ],
        },
      }],
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
    const imageFill = parsed[0].fills?.find(f => f.isImage);
    expect(imageFill).toBeDefined();
    expect(imageFill!.imageRef).toBe("img-ref-123");
  });

  it("should round-trip multiple fills via duplicate classes", () => {
    const original = makeNode({
      fills: [
        { type: "SOLID", color: "#ffffff" },
        { type: "SOLID", color: "#FF0000", opacity: 0.5 },
      ],
    });
    const jsx = convertToJsx([original]);
    const parsed = parseJsx(jsx);
    expect(parsed[0].fills).toHaveLength(2);
    expect(parsed[0].fills![0].color).toBe("#ffffff");
    expect(parsed[0].fills![1].color).toBe("#FF0000");
    expect(parsed[0].fills![1].opacity).toBe(0.5);
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
    const nodes = parseJsx('<div id="1:1" name="T" className="bg-gradient-to-b from-[#FF0000] via-[#00FF00] to-[#0000FF]" />');
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
    expect(nodes[0].fills?.some(f => f.gradient)).toBeFalsy();
  });

  it("should not produce a gradient fill with only to (no from)", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="to-[#0000FF]" />');
    expect(nodes[0].fills?.some(f => f.gradient)).toBeFalsy();
  });

  it("should not store opacity in gradient stops from /N suffix", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="bg-gradient-to-r from-[#FF0000]/50 to-[#0000FF]/80" />');
    const fill = nodes[0].fills![0];
    // Per-stop opacity from Tailwind /N is not supported; stops have no opacity field
    expect((fill.gradient?.stops[0] as any).opacity).toBeUndefined();
    expect((fill.gradient?.stops[1] as any).opacity).toBeUndefined();
  });
});

// --- Multiple fills/strokes accumulation ---

describe("parseJsx - multiple fills/strokes accumulation", () => {
  it("should accumulate multiple bg-[#hex] into fills array", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="bg-[#ffffff] bg-[#FF0000]/50" />');
    expect(nodes[0].fills).toHaveLength(2);
    expect(nodes[0].fills![0].color).toBe("#ffffff");
    expect(nodes[0].fills![1].color).toBe("#FF0000");
    expect(nodes[0].fills![1].opacity).toBe(0.5);
  });

  it("should accumulate multiple border-[#hex] into strokes array", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="border-[1px] border-[#000000] border-[#00FF00]" />');
    expect(nodes[0].strokes).toHaveLength(2);
    expect(nodes[0].strokes![0].color).toBe("#000000");
    expect(nodes[0].strokes![1].color).toBe("#00FF00");
  });

  it("should use correct binding indices for multiple bg variables", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="bg-primary bg-secondary" />');
    expect(nodes[0].fills).toHaveLength(2);
    expect(nodes[0].bindings?.["fills/0"]).toBe("primary");
    expect(nodes[0].bindings?.["fills/1"]).toBe("secondary");
  });

  it("should use correct binding indices for multiple border variables", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="border-[1px] border-primary border-secondary" />');
    expect(nodes[0].strokes).toHaveLength(2);
    expect(nodes[0].bindings?.["strokes/0"]).toBe("primary");
    expect(nodes[0].bindings?.["strokes/1"]).toBe("secondary");
  });

  it("should accumulate solid fill + gradient fill from style", () => {
    const jsx = '<div id="1:1" name="T" className="bg-[#ffffff]" style={{ background: "linear-gradient(#ff0000 0%, #0000ff 100%)" }} />';
    const nodes = parseJsx(jsx);
    expect(nodes[0].fills).toHaveLength(2);
    expect(nodes[0].fills![0].color).toBe("#ffffff");
    expect(nodes[0].fills![1].gradient?.type).toBe("GRADIENT_LINEAR");
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

  it("should accumulate 3 solid fills from duplicate classes", () => {
    const nodes = parseJsx('<div id="1:1" name="T" className="bg-[#111111] bg-[#222222] bg-[#333333]" />');
    expect(nodes[0].fills).toHaveLength(3);
    expect(nodes[0].fills![0].color).toBe("#111111");
    expect(nodes[0].fills![1].color).toBe("#222222");
    expect(nodes[0].fills![2].color).toBe("#333333");
  });
});
