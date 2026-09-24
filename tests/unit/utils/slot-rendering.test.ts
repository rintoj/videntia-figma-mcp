import { formatCompact } from "../../../src/videntia_figma_mcp/utils/compact-node";
import { convertToJsx } from "../../../src/videntia_figma_mcp/utils/figma-to-jsx";
import { parseJsx } from "../../../src/videntia_figma_mcp/utils/jsx-to-figma";

const slot = {
  id: "3:4",
  name: "Content",
  type: "SLOT",
  x: 0,
  y: 0,
  width: 100,
  height: 40,
  slotProperty: "Content#3:5",
  limitViolations: ["BELOW_MIN"],
};

describe("SLOT node rendering", () => {
  it("compact line names the slot property and its violations", () => {
    const line = formatCompact([slot]);
    expect(line).toContain("[SLOT]");
    expect(line).toContain("slot=Content");
    expect(line).toContain("violations=BELOW_MIN");
  });

  it("omits violations when the slot is within limits", () => {
    expect(formatCompact([{ ...slot, limitViolations: [] }])).not.toContain("violations=");
  });

  it("renders a SLOT as <Slot> and parses it back to SLOT", () => {
    const jsx = convertToJsx([slot as any]);
    expect(jsx).toContain("<Slot");
    const [node] = parseJsx(jsx);
    expect(node.type).toBe("SLOT");
  });
});
