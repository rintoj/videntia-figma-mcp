import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerVariableTools } from "../../src/hgraph_figma_mcp/tools/variable-tools";

jest.mock("../../src/hgraph_figma_mcp/utils/websocket", () => ({
  sendCommandToFigma: jest.fn(),
}));

describe("variable tools integration", () => {
  let server: McpServer;
  let mockSendCommand: jest.Mock;
  let toolHandlers: Map<string, Function>;
  let toolSchemas: Map<string, z.ZodObject<any>>;

  beforeEach(() => {
    server = new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });

    mockSendCommand = require("../../src/hgraph_figma_mcp/utils/websocket").sendCommandToFigma;
    mockSendCommand.mockClear();

    toolHandlers = new Map();
    toolSchemas = new Map();

    const originalTool = server.tool.bind(server);
    jest.spyOn(server, "tool").mockImplementation((...args: any[]) => {
      if (args.length === 4) {
        const [name, description, schema, handler] = args;
        toolHandlers.set(name, handler);
        toolSchemas.set(name, z.object(schema));
      } else if (args.length === 3) {
        const [name, description, handler] = args;
        toolHandlers.set(name, handler);
        toolSchemas.set(name, z.object({}));
      }
      return (originalTool as any)(...args);
    });

    registerVariableTools(server);
  });

  async function callTool(toolName: string, args: any = {}) {
    const schema = toolSchemas.get(toolName);
    const handler = toolHandlers.get(toolName);
    if (!schema || !handler) {
      throw new Error(`Tool ${toolName} not found`);
    }
    const validatedArgs = Object.keys(args).length > 0 ? schema.parse(args) : {};
    return await handler(validatedArgs, { meta: {} });
  }

  // ====================
  // COLLECTION MANAGEMENT TOOLS
  // ====================

  describe("get_variable_collections", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        collections: [
          { id: "col-1", name: "Theme", modes: ["dark", "light"], variableCount: 102, defaultMode: "dark" },
        ],
      });
    });

    it("successfully gets all variable collections", async () => {
      const response = await callTool("get_variable_collections");

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("get_variable_collections");
      expect(response.content[0].text).toContain("Theme");
      expect(response.content[0].text).toContain("102");
    });
  });

  describe("create_variable_collection", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        collectionId: "col-123",
        name: "Theme",
        defaultMode: "dark",
        success: true,
      });
    });

    it("successfully creates a variable collection", async () => {
      const response = await callTool("create_variable_collection", {
        name: "Theme",
      });

      expect(mockSendCommand).toHaveBeenCalledTimes(1);
      expect(mockSendCommand).toHaveBeenCalledWith("create_variable_collection", {
        name: "Theme",
        defaultMode: "dark",
      });
      expect(response.content[0].text).toContain("Theme");
      expect(response.content[0].text).toContain("Created collection");
    });

    it("accepts custom default mode", async () => {
      await callTool("create_variable_collection", {
        name: "Theme",
        default_mode: "light",
      });

      expect(mockSendCommand).toHaveBeenCalledWith("create_variable_collection", {
        name: "Theme",
        defaultMode: "light",
      });
    });
  });

  describe("get_collection_info", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        id: "col-123",
        name: "Theme",
        modes: ["dark", "light"],
        defaultMode: "dark",
        variableCount: 102,
        variablesByCategory: { base: 32, scales: 70, chart: 0 },
      });
    });

    it("successfully gets collection info", async () => {
      const response = await callTool("get_collection_info", {
        id: "col-123",
      });

      expect(mockSendCommand).toHaveBeenCalledWith("get_collection_info", {
        collectionId: "col-123",
      });
      expect(response.content[0].text).toContain("Theme");
      expect(response.content[0].text).toContain("102");
    });
  });

  // ====================
  // VARIABLE CRUD TOOLS
  // ====================

  describe("create_variable", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        variableId: "var-123",
        name: "primary",
        success: true,
      });
    });

    it("successfully creates a variable", async () => {
      const response = await callTool("create_variable", {
        collection_id: "col-123",
        name: "primary",
        type: "COLOR",
        value: { r: 0.5, g: 0.5, b: 0.5 },
      });

      expect(mockSendCommand).toHaveBeenCalledWith("create_variable", {
        collectionId: "col-123",
        name: "primary",
        type: "COLOR",
        value: { r: 0.5, g: 0.5, b: 0.5 },
        mode: undefined,
      });
    });
  });

  describe("create_variables_batch", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        created: 2,
        failed: 0,
        variableIds: ["var-1", "var-2"],
        errors: [],
      });
    });

    it("successfully creates multiple variables", async () => {
      const response = await callTool("create_variables_batch", {
        collection_id: "col-123",
        variables: [
          { name: "primary", type: "COLOR", value: { r: 0.5, g: 0.5, b: 0.5 } },
          { name: "secondary", type: "COLOR", value: { r: 0.2, g: 0.2, b: 0.2 } },
        ],
      });

      expect(mockSendCommand).toHaveBeenCalledWith("create_variables_batch", {
        collectionId: "col-123",
        variables: expect.any(Array),
        mode: undefined,
      });
      expect(response.content[0].text).toContain("Created 2 variable(s)");
    });
  });

  // ====================
  // COLOR CALCULATION TOOLS
  // ====================

  describe("calculate_color_scale", () => {
    it("calculates color scale correctly", async () => {
      const response = await callTool("calculate_color_scale", {
        base: { r: 0.639, g: 0.902, b: 0.208 },
        background: { r: 0.059, g: 0.063, b: 0.067 },
      });

      expect(mockSendCommand).not.toHaveBeenCalled(); // This is a local calculation
      expect(response.content[0].text).toContain("Color Scale");
      expect(response.content[0].text).toContain("50");
      expect(response.content[0].text).toContain("900");
    });
  });

  describe("calculate_composite_color", () => {
    it("calculates composite color correctly", async () => {
      const response = await callTool("calculate_composite_color", {
        base: { r: 0.639, g: 0.902, b: 0.208 },
        background: { r: 0.059, g: 0.063, b: 0.067 },
        mix_percentage: 0.5,
      });

      expect(response.content[0].text).toContain("Composite Color");
      expect(response.content[0].text).toContain("Hex");
    });
  });

  describe("convert_color_format", () => {
    it("converts normalized to hex", async () => {
      const response = await callTool("convert_color_format", {
        color: { r: 0.639, g: 0.902, b: 0.208 },
        from_format: "normalized",
        to_format: "hex",
      });

      expect(response.content[0].text).toContain("#");
    });
  });

  describe("calculate_contrast_ratio", () => {
    it("calculates WCAG contrast ratio", async () => {
      const response = await callTool("calculate_contrast_ratio", {
        foreground: { r: 1.0, g: 1.0, b: 1.0 },
        background: { r: 0.0, g: 0.0, b: 0.0 },
      });

      expect(response.content[0].text).toContain("Contrast Ratio");
      expect(response.content[0].text).toContain("WCAG");
      expect(response.content[0].text).toContain("Recommendation");
    });
  });

  // ====================
  // SCHEMA VALIDATION TOOLS
  // ====================

  describe("audit_collection", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        status: "Incomplete",
        totalVariables: 78,
        expectedVariables: 102,
        compliancePercentage: 76.5,
        missing: { count: 24, variables: ["info", "link"] },
        nonStandard: { count: 0, variables: [] },
        existing: { count: 78, variables: [] },
      });
    });

    it("successfully audits a collection", async () => {
      const response = await callTool("audit_collection", {
        collection_id: "col-123",
      });

      expect(mockSendCommand).toHaveBeenCalledWith("audit_collection", {
        collectionId: "col-123",
        includeChartColors: false,
        customSchema: undefined,
      });
      expect(response.content[0].text).toContain("Audit Result");
      expect(response.content[0].text).toContain("compliant");
    });
  });

  describe("get_schema_definition", () => {
    it("returns standard schema", async () => {
      const response = await callTool("get_schema_definition");

      expect(response.content[0].text).toContain("version");
      expect(response.content[0].text).toContain("totalVariables");
      expect(response.content[0].text).toContain("categories");
    });

    it("returns flat format when requested", async () => {
      const response = await callTool("get_schema_definition", {
        format: "flat",
      });

      expect(response.content[0].text).toContain("variables");
    });
  });

  // ====================
  // TEMPLATE & PRESET TOOLS
  // ====================

  describe("apply_default_theme", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        created: 102,
        updated: 0,
        skipped: 0,
        success: true,
        message: "Applied default dark theme with 102 variables",
      });
    });

    it("successfully applies default theme", async () => {
      const response = await callTool("apply_default_theme", {
        collection_id: "col-123",
      });

      expect(mockSendCommand).toHaveBeenCalledWith("apply_default_theme", {
        collectionId: "col-123",
        overwriteExisting: false,
        includeChartColors: false,
      });
      expect(response.content[0].text).toContain("Applied default theme");
    });
  });

  describe("create_color_scale_set", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        created: 12,
        variables: {
          base: "primary",
          foreground: "primary-foreground",
          scale: ["primary-50", "primary-100"],
        },
        success: true,
      });
    });

    it("successfully creates a color scale set", async () => {
      const response = await callTool("create_color_scale_set", {
        collection_id: "col-123",
        color_name: "primary",
        base: { r: 0.639, g: 0.902, b: 0.208 },
        foreground: { r: 0.09, g: 0.102, b: 0.067 },
        background: { r: 0.059, g: 0.063, b: 0.067 },
      });

      expect(mockSendCommand).toHaveBeenCalled();
      expect(response.content[0].text).toContain("Created color scale");
    });
  });

  // ====================
  // BULK OPERATIONS TOOLS
  // ====================

  describe("fix_collection_to_standard", () => {
    beforeEach(() => {
      mockSendCommand.mockResolvedValue({
        analysis: { missingBefore: 24, nonStandardBefore: 0, totalBefore: 78 },
        actions: { variablesAdded: 24, variablesRenamed: 0, variablesRemoved: 0, variablesPreserved: 0 },
        result: { totalVariables: 102, compliance: "100%", status: "Complete" },
        success: true,
      });
    });

    it("successfully fixes collection to standard", async () => {
      const response = await callTool("fix_collection_to_standard", {
        collection_id: "col-123",
      });

      expect(mockSendCommand).toHaveBeenCalledWith("fix_collection_to_standard", {
        collectionId: "col-123",
        preserveCustom: false,
        addChartColors: false,
        useDefaultValues: true,
        dryRun: false,
      });
      expect(response.content[0].text).toContain("Fixed collection to standard");
    });

    it("supports dry run mode", async () => {
      await callTool("fix_collection_to_standard", {
        collection_id: "col-123",
        dry_run: true,
      });

      expect(mockSendCommand).toHaveBeenCalledWith(
        "fix_collection_to_standard",
        expect.objectContaining({
          dryRun: true,
        }),
      );
    });
  });

  // ====================
  // ERROR HANDLING
  // ====================

  describe("error handling", () => {
    it("handles errors gracefully", async () => {
      mockSendCommand.mockRejectedValue(new Error("Collection not found"));

      const response = await callTool("get_collection_info", {
        id: "invalid-id",
      });

      expect(response.content[0].text).toContain("Error");
      expect(response.content[0].text).toContain("Collection not found");
    });
  });
});
