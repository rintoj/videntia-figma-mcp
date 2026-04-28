import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDocumentTools } from "../../src/videntia_figma_mcp/tools/document-tools";
import type { LintFrameResult } from "../../src/videntia_figma_mcp/types/index";

jest.mock("../../src/videntia_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
  joinChannel: jest.fn(),
  getOpenChannels: jest.fn().mockResolvedValue([]),
}));

describe("lint_frame tool", () => {
  let server: McpServer;
  let mockSendCommand: jest.Mock;
  let toolHandlers: Map<string, Function>;
  let toolSchemas: Map<string, z.ZodObject<any>>;

  beforeEach(() => {
    server = new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });

    mockSendCommand = require("../../src/videntia_figma_mcp/utils/websocket").sendCommandToFigma;
    mockSendCommand.mockClear();

    toolHandlers = new Map();
    toolSchemas = new Map();

    const originalTool = server.tool.bind(server);
    jest.spyOn(server, "tool").mockImplementation((...args: any[]) => {
      if (args.length === 4) {
        const [name, description, schema, handler] = args;
        toolHandlers.set(name, handler);
        toolSchemas.set(name, z.object(schema));
      }
      return (originalTool as any)(...args);
    });

    registerDocumentTools(server);
  });

  async function callTool(toolName: string, args: any) {
    const schema = toolSchemas.get(toolName);
    const handler = toolHandlers.get(toolName);
    if (!schema || !handler) {
      throw new Error(`Tool ${toolName} not found`);
    }
    const validatedArgs = schema.parse(args);
    return await handler(validatedArgs, { meta: {} });
  }

  function makeResult(overrides?: Partial<LintFrameResult>): LintFrameResult {
    return {
      nodeId: "1:100",
      nodeName: "Test Frame",
      nodeType: "FRAME",
      totalNodes: 25,
      categories: {
        rootFrame: { total: 1, bound: 1, unbound: 0, compliance: 100 },
        typography: { total: 3, bound: 3, unbound: 0, compliance: 100 },
        spacing: { total: 5, bound: 4, unbound: 1, compliance: 80 },
        borderRadius: { total: 2, bound: 2, unbound: 0, compliance: 100 },
        iconColors: { total: 1, bound: 1, unbound: 0, compliance: 100 },
        strokesBorders: { total: 0, bound: 0, unbound: 0, compliance: 100 },
        backgroundFills: { total: 4, bound: 3, unbound: 1, compliance: 75 },
        effectStyles: { total: 1, bound: 1, unbound: 0, compliance: 100 },
        overflow: { total: 10, bound: 10, unbound: 0, compliance: 100 },
        screenNaming: { total: 0, bound: 0, unbound: 0, compliance: 100 },
      },
      violations: [],
      summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, compliance: 94 },
      ...overrides,
    };
  }

  it("is registered as a tool", () => {
    expect(toolHandlers.has("lint_frame")).toBe(true);
  });

  it("sends lint_frame command with nodeId and 60s timeout", async () => {
    mockSendCommand.mockResolvedValue(makeResult());

    await callTool("lint_frame", { node_id: "1:100" });

    expect(mockSendCommand).toHaveBeenCalledWith("lint_frame", { nodeId: "1:100", fix: false, checks: undefined }, 60000);
  });

  it("passes checks parameter through to plugin", async () => {
    mockSendCommand.mockResolvedValue(makeResult());

    const checks = { colors: true, spacing: false, autoLayout: false };
    await callTool("lint_frame", { node_id: "1:100", checks });

    expect(mockSendCommand).toHaveBeenCalledWith("lint_frame", { nodeId: "1:100", fix: false, checks }, 60000);
  });

  it("formats compliance table with all categories", async () => {
    mockSendCommand.mockResolvedValue(makeResult());

    const response = await callTool("lint_frame", { node_id: "1:100" });
    const text = response.content[0].text;

    expect(text).toContain("# Compliance Audit: Test Frame");
    expect(text).toContain("## Compliance by Category");
    expect(text).toContain("| Typography |");
    expect(text).toContain("| Background Fills |");
    expect(text).toContain("| Icon Colors |");
    expect(text).toContain("| Strokes/Borders |");
    expect(text).toContain("| Spacing |");
    expect(text).toContain("| Border Radius |");
    expect(text).toContain("| Effect Styles |");
    expect(text).toContain("| Screen Naming |");
  });

  it("shows PASS/WARN/FAIL status based on compliance percentage", async () => {
    mockSendCommand.mockResolvedValue(makeResult());

    const response = await callTool("lint_frame", { node_id: "1:100" });
    const text = response.content[0].text;

    // Typography at 100% → PASS
    expect(text).toContain("| Typography | 3 | 3 | 0 | PASS 100% |");
    // Spacing at 80% → WARN
    expect(text).toContain("| Spacing | 5 | 4 | 1 | WARN 80% |");
    // Background Fills at 75% → FAIL
    expect(text).toContain("| Background Fills | 4 | 3 | 1 | FAIL 75% |");
  });

  it("shows summary with overall compliance", async () => {
    mockSendCommand.mockResolvedValue(makeResult());

    const response = await callTool("lint_frame", { node_id: "1:100" });
    const text = response.content[0].text;

    expect(text).toContain("## Summary");
    expect(text).toContain("**Overall Compliance: 94%**");
  });

  it("shows 'No violations found' when there are none", async () => {
    mockSendCommand.mockResolvedValue(makeResult({ violations: [], summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, compliance: 100 } }));

    const response = await callTool("lint_frame", { node_id: "1:100" });
    const text = response.content[0].text;

    expect(text).toContain("No violations found.");
    expect(text).toContain("**Verdict: PASS**");
  });

  it("groups violations by severity", async () => {
    const result = makeResult({
      violations: [
        { nodeId: "1:200", nodeName: "Button", nodeType: "FRAME", depth: 1, severity: "CRITICAL", category: "effectStyles", property: "effectStyleId", message: "Raw DROP_SHADOW effect" },
        { nodeId: "1:201", nodeName: "Label", nodeType: "TEXT", depth: 2, severity: "HIGH", category: "typography", property: "textStyleId", message: "Text node without textStyleId" },
        { nodeId: "1:202", nodeName: "Card", nodeType: "FRAME", depth: 1, severity: "MEDIUM", category: "spacing", property: "itemSpacing", message: "Item spacing using raw number (12)" },
        { nodeId: "1:203", nodeName: "Heading", nodeType: "TEXT", depth: 2, severity: "LOW", category: "typography", property: "textStyleId", message: "Text style override present" },
      ],
      summary: { total: 4, critical: 1, high: 1, medium: 1, low: 1, compliance: 60 },
    });
    mockSendCommand.mockResolvedValue(result);

    const response = await callTool("lint_frame", { node_id: "1:100" });
    const text = response.content[0].text;

    expect(text).toContain("## Violations");
    expect(text).toContain("### CRITICAL (1)");
    expect(text).toContain("### HIGH (1)");
    expect(text).toContain("### MEDIUM (1)");
    expect(text).toContain("### LOW (1)");
    expect(text).toContain("Raw DROP_SHADOW effect");
    expect(text).toContain("Text node without textStyleId");
  });

  it("shows FAIL verdict when critical violations exist", async () => {
    const result = makeResult({
      violations: [
        { nodeId: "1:200", nodeName: "Text", nodeType: "TEXT", depth: 1, severity: "CRITICAL", category: "typography", property: "fontVariables", message: "Font variable bound directly" },
      ],
      summary: { total: 1, critical: 1, high: 0, medium: 0, low: 0, compliance: 90 },
    });
    mockSendCommand.mockResolvedValue(result);

    const response = await callTool("lint_frame", { node_id: "1:100" });
    const text = response.content[0].text;

    expect(text).toContain("**Verdict: FAIL** — Critical violations must be resolved.");
  });

  it("shows WARN verdict when compliance >= 80% with no critical violations", async () => {
    const result = makeResult({
      violations: [
        { nodeId: "1:200", nodeName: "Rect", nodeType: "RECTANGLE", depth: 1, severity: "MEDIUM", category: "borderRadius", property: "cornerRadius", message: "Border radius using raw number" },
      ],
      summary: { total: 1, critical: 0, high: 0, medium: 1, low: 0, compliance: 85 },
    });
    mockSendCommand.mockResolvedValue(result);

    const response = await callTool("lint_frame", { node_id: "1:100" });
    const text = response.content[0].text;

    expect(text).toContain("**Verdict: WARN** — Minor issues to address.");
  });

  it("shows FAIL verdict when compliance < 80%", async () => {
    const result = makeResult({
      violations: [
        { nodeId: "1:200", nodeName: "Box", nodeType: "FRAME", depth: 1, severity: "HIGH", category: "backgroundFills", property: "fills[0]", message: "Color using raw hex" },
        { nodeId: "1:201", nodeName: "Box2", nodeType: "FRAME", depth: 1, severity: "HIGH", category: "backgroundFills", property: "fills[0]", message: "Color using raw hex" },
      ],
      summary: { total: 2, critical: 0, high: 2, medium: 0, low: 0, compliance: 50 },
    });
    mockSendCommand.mockResolvedValue(result);

    const response = await callTool("lint_frame", { node_id: "1:100" });
    const text = response.content[0].text;

    expect(text).toContain("**Verdict: FAIL** — Significant compliance gaps.");
  });

  it("shows violation counts in summary", async () => {
    const result = makeResult({
      violations: [
        { nodeId: "1:200", nodeName: "A", nodeType: "TEXT", depth: 1, severity: "CRITICAL", category: "effectStyles", property: "effectStyleId", message: "msg" },
        { nodeId: "1:201", nodeName: "B", nodeType: "TEXT", depth: 1, severity: "HIGH", category: "typography", property: "textStyleId", message: "msg" },
        { nodeId: "1:202", nodeName: "C", nodeType: "FRAME", depth: 1, severity: "HIGH", category: "backgroundFills", property: "fills[0]", message: "msg" },
      ],
      summary: { total: 3, critical: 1, high: 2, medium: 0, low: 0, compliance: 70 },
    });
    mockSendCommand.mockResolvedValue(result);

    const response = await callTool("lint_frame", { node_id: "1:100" });
    const text = response.content[0].text;

    expect(text).toContain("Pending violations: 3");
    expect(text).toContain("- CRITICAL: 1");
    expect(text).toContain("- HIGH: 2");
    // MEDIUM and LOW are 0, should not appear
    expect(text).not.toContain("- MEDIUM:");
    expect(text).not.toContain("- LOW:");
  });

  it("includes node metadata in header", async () => {
    mockSendCommand.mockResolvedValue(makeResult({ totalNodes: 42 }));

    const response = await callTool("lint_frame", { node_id: "1:100" });
    const text = response.content[0].text;

    expect(text).toContain("**Node:** 1:100 (FRAME)");
    expect(text).toContain("**Nodes scanned:** 42");
  });

  it("escapes pipe characters in node names", async () => {
    const result = makeResult({
      violations: [
        { nodeId: "1:200", nodeName: "Left|Right", nodeType: "FRAME", depth: 1, severity: "HIGH", category: "backgroundFills", property: "fills[0]", message: "Raw hex" },
      ],
      summary: { total: 1, critical: 0, high: 1, medium: 0, low: 0, compliance: 80 },
    });
    mockSendCommand.mockResolvedValue(result);

    const response = await callTool("lint_frame", { node_id: "1:100" });
    const text = response.content[0].text;

    expect(text).toContain("Left\\|Right");
  });

  it("handles errors gracefully", async () => {
    mockSendCommand.mockRejectedValue(new Error("Node not found: 999:999"));

    const response = await callTool("lint_frame", { node_id: "999:999" });
    const text = response.content[0].text;

    expect(text).toContain('Error running lint_frame on node "999:999"');
    expect(text).toContain("Node not found: 999:999");
  });

  it("validates node_id is required", async () => {
    await expect(callTool("lint_frame", {})).rejects.toThrow();
  });

  it("shows Overflow category in compliance table", async () => {
    mockSendCommand.mockResolvedValue(makeResult());

    const response = await callTool("lint_frame", { node_id: "1:100" });
    const text = response.content[0].text;

    expect(text).toContain("| Overflow |");
  });

  it("reports CRITICAL violation for horizontal overflow", async () => {
    const result = makeResult({
      violations: [
        {
          nodeId: "1:200",
          nodeName: "Content Section",
          nodeType: "FRAME",
          depth: 2,
          severity: "CRITICAL",
          category: "overflow",
          property: "absoluteBoundingBox",
          message: "Horizontal overflow: child extends 24px beyond parent right edge",
          details: { axis: "horizontal", overflowAmount: 24, childRight: 399, parentRight: 375 },
        },
      ],
      summary: { total: 1, critical: 1, high: 0, medium: 0, low: 0, compliance: 80 },
    });
    mockSendCommand.mockResolvedValue(result);

    const response = await callTool("lint_frame", { node_id: "1:100" });
    const text = response.content[0].text;

    expect(text).toContain("Horizontal overflow: child extends 24px beyond parent right edge");
    expect(text).toContain("### CRITICAL (1)");
  });

  it("reports CRITICAL violation for vertical overflow on FIXED-height parent", async () => {
    const result = makeResult({
      violations: [
        {
          nodeId: "1:201",
          nodeName: "Footer",
          nodeType: "FRAME",
          depth: 3,
          severity: "CRITICAL",
          category: "overflow",
          property: "absoluteBoundingBox",
          message: "Vertical overflow: child extends 16px beyond parent bottom edge",
          details: { axis: "vertical", overflowAmount: 16, childBottom: 828, parentBottom: 812 },
        },
      ],
      summary: { total: 1, critical: 1, high: 0, medium: 0, low: 0, compliance: 80 },
    });
    mockSendCommand.mockResolvedValue(result);

    const response = await callTool("lint_frame", { node_id: "1:100" });
    const text = response.content[0].text;

    expect(text).toContain("Vertical overflow: child extends 16px beyond parent bottom edge");
    expect(text).toContain("### CRITICAL (1)");
  });

  it("passes overflow: false check toggle through to plugin", async () => {
    mockSendCommand.mockResolvedValue(makeResult());

    const checks = { overflow: false };
    await callTool("lint_frame", { node_id: "1:100", checks });

    expect(mockSendCommand).toHaveBeenCalledWith("lint_frame", { nodeId: "1:100", fix: false, checks }, 60000);
  });

  it("shows PASS for Overflow when no overflow violations", async () => {
    mockSendCommand.mockResolvedValue(makeResult());

    const response = await callTool("lint_frame", { node_id: "1:100" });
    const text = response.content[0].text;

    expect(text).toContain("| Overflow | 10 | 10 | 0 | PASS 100% |");
  });

  it("flags absolute-positioned children inside auto-layout frames as LOW violation", async () => {
    const result = makeResult({
      violations: [
        {
          nodeId: "1:200",
          nodeName: "Card",
          nodeType: "FRAME",
          depth: 1,
          severity: "LOW",
          category: "autoLayout",
          property: "layoutPositioning",
          message: "Auto-layout frame has 2 absolute-positioned children — verify intentional",
        },
      ],
      summary: { total: 1, critical: 0, high: 0, medium: 0, low: 1, compliance: 95 },
    });
    mockSendCommand.mockResolvedValue(result);

    const response = await callTool("lint_frame", { node_id: "1:100" });
    const text = response.content[0].text;

    expect(text).toContain("Auto-layout frame has 2 absolute-positioned children");
    expect(text).toContain("### LOW (1)");
  });

  it("reports screen naming violation for non-conforming screen frame", async () => {
    const result = makeResult({
      categories: {
        ...makeResult().categories,
        screenNaming: { total: 1, bound: 0, unbound: 1, compliance: 0 },
      },
      violations: [
        {
          nodeId: "1:200",
          nodeName: "Screen/login",
          nodeType: "FRAME",
          depth: 3,
          severity: "HIGH",
          category: "screenNaming",
          property: "name",
          message: 'Screen name "Screen/login" does not follow convention — expected: Screen/{Feature}@{Breakpoint}/{View}[/{State}]',
        },
      ],
      summary: { total: 1, critical: 0, high: 1, medium: 0, low: 0, compliance: 90 },
    });
    mockSendCommand.mockResolvedValue(result);

    const response = await callTool("lint_frame", { node_id: "1:100" });
    const text = response.content[0].text;

    expect(text).toContain("| Screen Naming | 1 | 0 | 1 | FAIL 0% |");
    expect(text).toContain("does not follow convention");
  });

  it("passes screenNaming check toggle through to plugin", async () => {
    mockSendCommand.mockResolvedValue(makeResult());

    const checks = { screenNaming: false };
    await callTool("lint_frame", { node_id: "1:100", checks });

    expect(mockSendCommand).toHaveBeenCalledWith("lint_frame", { nodeId: "1:100", fix: false, checks }, 60000);
  });

  it("skips severity sections with zero violations", async () => {
    const result = makeResult({
      violations: [
        { nodeId: "1:200", nodeName: "X", nodeType: "FRAME", depth: 1, severity: "MEDIUM", category: "spacing", property: "itemSpacing", message: "raw" },
      ],
      summary: { total: 1, critical: 0, high: 0, medium: 1, low: 0, compliance: 90 },
    });
    mockSendCommand.mockResolvedValue(result);

    const response = await callTool("lint_frame", { node_id: "1:100" });
    const text = response.content[0].text;

    expect(text).toContain("### MEDIUM (1)");
    expect(text).not.toContain("### CRITICAL");
    expect(text).not.toContain("### HIGH");
    expect(text).not.toContain("### LOW");
  });
});
