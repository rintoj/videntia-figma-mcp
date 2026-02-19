import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../utils/websocket.js";
import { coerceArray } from "../utils/coerce-array.js";
import {
  calculateColorScale,
  calculateCompositeColor,
  calculateContrastRatio,
  convertColorFormat,
  getWCAGCompliance,
  getContrastRecommendation,
  rgbaToHex,
  SCALE_MIX_PERCENTAGES,
  RGBAColor
} from "../utils/color-calculations.js";
import {
  getStandardSchema,
  getAllStandardVariableNames,
  getVariableCategory,
  isStandardVariable,
  DEFAULT_DARK_THEME,
  DEFAULT_CHART_COLORS,
  getScaleVariableNames,
  getStandardVariableOrder
} from "../utils/theme-schema.js";
import {
  getSpacingPreset,
  getTypographyPreset,
  getRadiusPreset,
  FONT_WEIGHTS,
  LINE_HEIGHTS,
  generateSemanticSpacing,
  generateSemanticTypography
} from "../utils/token-presets.js";
import { formatColorValue, formatVariableValue } from "../utils/format-helpers.js";

// Zod schemas for color validation
const RGBAColorSchema = z.object({
  r: z.number().min(0).max(1).describe("Red component (0-1)"),
  g: z.number().min(0).max(1).describe("Green component (0-1)"),
  b: z.number().min(0).max(1).describe("Blue component (0-1)"),
  a: z.number().min(0).max(1).optional().describe("Alpha component (0-1, default: 1.0)")
});

/**
 * Register variable management tools to the MCP server
 * Implements 24 new tools for theme variable management
 */
export function registerVariableTools(server: McpServer): void {

  // ========================================
  // 1. COLLECTION MANAGEMENT TOOLS (3 tools)
  // ========================================

  /**
   * get_variable_collections - List all variable collections
   */
  server.tool(
    "get_variable_collections",
    "List all variable collections in the current Figma document",
    {},
    async () => {
      try {
        const result = await sendCommandToFigma("get_variable_collections");
        const collections = Array.isArray(result) ? result : (result as any)?.collections ?? [result];
        const lines: string[] = [`Found ${collections.length} variable collection(s)`, ""];
        lines.push("| Name | Modes | Variables | ID |");
        lines.push("|------|-------|-----------|-----|");
        for (const col of collections) {
          const modes = (col.modes || []).map((m: any) => m.name || m).join(", ");
          const varCount = col.variableCount ?? col.variableIds?.length ?? "-";
          lines.push(`| ${col.name} | ${modes} | ${varCount} | ${col.id} |`);
        }
        return {
          content: [
            {
              type: "text",
              text: lines.join("\n")
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting variable collections: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  /**
   * create_variable_collection - Create a new variable collection
   */
  server.tool(
    "create_variable_collection",
    "Create a new variable collection",
    {
      name: z.string().describe("Collection name (e.g., 'Theme')"),
      default_mode: z.string().optional().describe("Default mode name (default: 'dark')")
    },
    async ({ name, default_mode }) => {
      try {
        const result = await sendCommandToFigma("create_variable_collection", {
          name,
          defaultMode: default_mode || "dark"
        }) as any;
        return {
          content: [
            {
              type: "text",
              text: `Created collection "${result.name || name}" (ID: ${result.collectionId || result.id || "-"})`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating variable collection: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  /**
   * get_collection_info - Get detailed metadata about a collection
   */
  server.tool(
    "get_collection_info",
    "Get detailed metadata about a variable collection",
    {
      collection_id: z.string().describe("Collection ID or name")
    },
    async ({ collection_id }) => {
      try {
        const result = await sendCommandToFigma("get_collection_info", { collectionId: collection_id }) as any;
        const modes = (result.modes || []).map((m: any) => `${m.name} (${m.modeId})`).join(", ");
        const varCount = result.variableCount ?? result.variableIds?.length ?? "-";
        const lines = [
          `## Collection: ${result.name} (id: ${result.id})`,
          `Modes: ${modes}`,
          `Variables: ${varCount}`,
        ];
        if (result.description) lines.push(`Description: ${result.description}`);
        return {
          content: [
            {
              type: "text",
              text: lines.join("\n")
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting collection info: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  /**
   * rename_variable_collection - Rename a variable collection
   */
  server.tool(
    "rename_variable_collection",
    "Rename a variable collection",
    {
      collection_id: z.string().describe("Collection ID or name"),
      new_name: z.string().describe("New name for the collection")
    },
    async ({ collection_id, new_name }) => {
      try {
        const result = await sendCommandToFigma("rename_variable_collection", {
          collectionId: collection_id,
          newName: new_name
        }) as any;
        return {
          content: [
            {
              type: "text",
              text: `Renamed collection to "${result.newName || new_name}" (ID: ${result.collectionId || collection_id})`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error renaming variable collection: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  /**
   * delete_variable_collection - Delete a variable collection and all its variables
   */
  server.tool(
    "delete_variable_collection",
    "Delete a variable collection and all its variables (cannot be undone)",
    {
      collection_id: z.string().describe("Collection ID or name")
    },
    async ({ collection_id }) => {
      try {
        const result = await sendCommandToFigma("delete_variable_collection", {
          collectionId: collection_id
        }) as any;
        return {
          content: [
            {
              type: "text",
              text: `Deleted collection (ID: ${result.collectionId || collection_id})`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error deleting variable collection: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  // ========================================
  // 2. VARIABLE CRUD TOOLS (6 tools)
  // ========================================

  /**
   * create_variable - Create a single variable (supports COLOR, FLOAT, STRING, BOOLEAN)
   */
  server.tool(
    "create_variable",
    "Create a single variable in a collection (supports COLOR, FLOAT, STRING, BOOLEAN types)",
    {
      collection_id: z.string().describe("Collection ID or name"),
      name: z.string().describe("Variable name (e.g., 'primary', 'spacing.4', 'font.family')"),
      type: z.enum(["COLOR", "FLOAT", "STRING", "BOOLEAN"]).describe("Variable type"),
      value: z.union([
        RGBAColorSchema,
        z.number(),
        z.string(),
        z.boolean()
      ]).describe("Variable value (type depends on variable type)"),
      mode: z.string().optional().describe("Mode to set value for (default: all modes)")
    },
    async ({ collection_id, name, type, value, mode }) => {
      try {
        const result = await sendCommandToFigma("create_variable", {
          collectionId: collection_id,
          name,
          type,
          value,
          mode
        }) as any;
        return {
          content: [
            {
              type: "text",
              text: `Created ${type} variable "${result.name || name}" (ID: ${result.variableId || result.id || "-"})`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating variable: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  /**
   * create_variables_batch - Create multiple variables at once
   */
  server.tool(
    "create_variables_batch",
    "Create multiple variables at once (more efficient than individual calls, supports all types)",
    {
      collection_id: z.string().describe("Collection ID or name"),
      variables: coerceArray(z.array(z.object({
        name: z.string(),
        type: z.enum(["COLOR", "FLOAT", "STRING", "BOOLEAN"]),
        value: z.union([RGBAColorSchema, z.number(), z.string(), z.boolean()])
      }))).describe("Array of variable definitions"),
      mode: z.string().optional().describe("Mode to set values for")
    },
    async ({ collection_id, variables, mode }) => {
      try {
        const result = await sendCommandToFigma("create_variables_batch", {
          collectionId: collection_id,
          variables,
          mode
        }) as any;
        const created = result.created ?? result.variableIds?.length ?? variables.length;
        const failed = result.failed ?? 0;
        return {
          content: [
            {
              type: "text",
              text: `Created ${created} variable(s)${failed > 0 ? `, ${failed} failed` : ""}`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating variables batch: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  /**
   * update_variable_value - Update a variable's value (supports all types)
   */
  server.tool(
    "update_variable_value",
    "Update a variable's value (supports COLOR, FLOAT, STRING, BOOLEAN types)",
    {
      variable_id: z.string().describe("Variable ID or name"),
      collection_id: z.string().optional().describe("Collection ID (required if using variable name)"),
      value: z.union([
        RGBAColorSchema,
        z.number(),
        z.string(),
        z.boolean()
      ]).describe("New value (type must match variable type)"),
      mode: z.string().optional().describe("Mode to update (default: first mode)")
    },
    async ({ variable_id, collection_id, value, mode }) => {
      try {
        const result = await sendCommandToFigma("update_variable_value", {
          variableId: variable_id,
          collectionId: collection_id,
          value,
          mode
        }) as any;
        return {
          content: [
            {
              type: "text",
              text: `Updated variable "${result.name || variable_id}" value${mode ? ` (mode: ${mode})` : ""}`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error updating variable value: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  /**
   * rename_variable - Rename a variable
   */
  server.tool(
    "rename_variable",
    "Rename a variable",
    {
      variable_id: z.string().describe("Variable ID or current name"),
      collection_id: z.string().optional().describe("Collection ID (required if using variable name)"),
      new_name: z.string().describe("New variable name")
    },
    async ({ variable_id, collection_id, new_name }) => {
      try {
        const result = await sendCommandToFigma("rename_variable", {
          variableId: variable_id,
          collectionId: collection_id,
          newName: new_name
        }) as any;
        return {
          content: [
            {
              type: "text",
              text: `Renamed variable to "${result.newName || new_name}" (ID: ${result.variableId || variable_id})`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error renaming variable: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  /**
   * delete_variable - Delete a single variable
   */
  server.tool(
    "delete_variable",
    "Delete a single variable",
    {
      variable_id: z.string().describe("Variable ID or name"),
      collection_id: z.string().optional().describe("Collection ID (required if using variable name)")
    },
    async ({ variable_id, collection_id }) => {
      try {
        const result = await sendCommandToFigma("delete_variable", {
          variableId: variable_id,
          collectionId: collection_id
        }) as any;
        return {
          content: [
            {
              type: "text",
              text: `Deleted variable (ID: ${result.variableId || variable_id})`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error deleting variable: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  /**
   * delete_variables_batch - Delete multiple variables at once
   */
  server.tool(
    "delete_variables_batch",
    "Delete multiple variables at once",
    {
      variable_ids: coerceArray(z.array(z.string())).describe("Array of variable IDs or names"),
      collection_id: z.string().optional().describe("Collection ID (required if using names)")
    },
    async ({ variable_ids, collection_id }) => {
      try {
        const result = await sendCommandToFigma("delete_variables_batch", {
          variableIds: variable_ids,
          collectionId: collection_id
        }) as any;
        const deleted = result.deleted ?? result.deletedCount ?? variable_ids.length;
        return {
          content: [
            {
              type: "text",
              text: `Deleted ${deleted} variable(s)`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error deleting variables batch: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  // ========================================
  // 3. COLOR CALCULATION TOOLS (4 tools)
  // ========================================

  /**
   * calculate_color_scale - Calculate all 10 scale variants for a base color
   */
  server.tool(
    "calculate_color_scale",
    "Calculate all 10 scale variants (-50 to -900) for a base color",
    {
      base_color: RGBAColorSchema.describe("Base color RGB"),
      background_color: RGBAColorSchema.describe("Background color RGB"),
      input_format: z.enum(["normalized", "rgb255"]).optional().describe("Input format (default: normalized)")
    },
    async ({ base_color, background_color, input_format }) => {
      try {
        const scale = calculateColorScale(base_color, background_color);

        const lines: string[] = [
          "## Color Scale",
          "Formula: resultant RGB = (base x mix%) + (background x (1 - mix%))",
          "",
          "| Level | Color | Mix% |",
          "|-------|-------|------|",
        ];
        const levels = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900"];
        for (const level of levels) {
          const color = (scale as any)[level];
          const mix = (SCALE_MIX_PERCENTAGES as any)[level];
          lines.push(`| ${level} | ${color ? formatColorValue(color) : "-"} | ${mix != null ? `${Math.round(mix * 100)}%` : "-"} |`);
        }
        return {
          content: [
            {
              type: "text",
              text: lines.join("\n")
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error calculating color scale: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  /**
   * calculate_composite_color - Calculate a single composited color
   */
  server.tool(
    "calculate_composite_color",
    "Calculate a single composited color at a specific mix percentage",
    {
      base_color: RGBAColorSchema.describe("Base color RGB"),
      background_color: RGBAColorSchema.describe("Background color RGB"),
      mix_percentage: z.number().min(0).max(1).describe("Mix percentage (0.0 to 1.0)"),
      input_format: z.enum(["normalized", "rgb255"]).optional().describe("Input format (default: normalized)")
    },
    async ({ base_color, background_color, mix_percentage, input_format }) => {
      try {
        const result = calculateCompositeColor(base_color, background_color, mix_percentage);
        const hex = rgbaToHex(result);

        return {
          content: [
            {
              type: "text",
              text: `## Composite Color\n- **Formula**: (base x ${mix_percentage}) + (background x ${1 - mix_percentage})\n- **Result**: ${formatColorValue(result)}\n- **Hex**: ${hex}`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error calculating composite color: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  /**
   * convert_color_format - Convert color between different formats
   */
  server.tool(
    "convert_color_format",
    "Convert color between different formats",
    {
      color: z.union([RGBAColorSchema, z.string()]).describe("Color value to convert"),
      from_format: z.enum(["normalized", "rgb255", "hex"]).describe("Source format"),
      to_format: z.enum(["normalized", "rgb255", "hex"]).describe("Target format")
    },
    async ({ color, from_format, to_format }) => {
      try {
        const output = convertColorFormat(color as any, from_format, to_format);
        const outputStr = typeof output === "object" ? formatColorValue(output) : String(output);
        const inputStr = typeof color === "object" ? formatColorValue(color) : String(color);

        return {
          content: [
            {
              type: "text",
              text: `## Color Conversion (${from_format} → ${to_format})\n- **Input**: ${inputStr}\n- **Output**: ${outputStr}`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error converting color format: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  /**
   * calculate_contrast_ratio - Calculate WCAG contrast ratio
   */
  server.tool(
    "calculate_contrast_ratio",
    "Calculate WCAG contrast ratio between two colors",
    {
      foreground: RGBAColorSchema.describe("Foreground color RGB"),
      background: RGBAColorSchema.describe("Background color RGB"),
      input_format: z.enum(["normalized", "rgb255"]).optional().describe("Input format (default: normalized)")
    },
    async ({ foreground, background, input_format }) => {
      try {
        const ratio = calculateContrastRatio(foreground, background);
        const wcag = getWCAGCompliance(ratio);
        const recommendation = getContrastRecommendation(ratio);

        const wcagLines = Object.entries(wcag).map(([level, passes]) => `${level}: ${passes ? "Pass" : "Fail"}`).join(", ");
        return {
          content: [
            {
              type: "text",
              text: `## Contrast Ratio: ${ratio.toFixed(2)}:1\n- **WCAG**: ${wcagLines}\n- **Recommendation**: ${recommendation}`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error calculating contrast ratio: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  // ========================================
  // 4. SCHEMA VALIDATION & AUDIT TOOLS (4 tools)
  // ========================================

  /**
   * audit_collection - Compare collection against standard schema
   */
  server.tool(
    "audit_collection",
    "Compare collection against the 102-variable standard schema",
    {
      collection_id: z.string().describe("Collection ID or name"),
      include_chart_colors: z.boolean().optional().describe("Expect chart colors (default: false)"),
      custom_schema: z.any().optional().describe("Custom schema definition to validate against")
    },
    async ({ collection_id, include_chart_colors, custom_schema }) => {
      try {
        const result = await sendCommandToFigma("audit_collection", {
          collectionId: collection_id,
          includeChartColors: include_chart_colors || false,
          customSchema: custom_schema
        }) as any;
        const lines: string[] = [];
        const compliance = result.compliancePercent ?? result.compliance ?? "-";
        lines.push(`## Audit Result — ${compliance}% compliant`);
        const total = result.totalExpected ?? result.total ?? "-";
        const found = result.found ?? result.matching ?? "-";
        lines.push(`Expected: ${total} | Found: ${found}`);
        lines.push("");
        const missing = result.missing || [];
        if (missing.length > 0) {
          lines.push(`### Missing (${missing.length})`);
          lines.push("| Name |");
          lines.push("|------|");
          for (const m of missing) lines.push(`| ${typeof m === "string" ? m : m.name} |`);
          lines.push("");
        }
        const extra = result.extra || [];
        if (extra.length > 0) {
          lines.push(`### Extra (${extra.length})`);
          lines.push("| Name |");
          lines.push("|------|");
          for (const e of extra) lines.push(`| ${typeof e === "string" ? e : e.name} |`);
          lines.push("");
        }
        const mismatched = result.mismatched || result.typeErrors || [];
        if (mismatched.length > 0) {
          lines.push(`### Mismatched (${mismatched.length})`);
          lines.push("| Name | Expected | Actual |");
          lines.push("|------|----------|--------|");
          for (const m of mismatched) lines.push(`| ${m.name} | ${m.expected || "-"} | ${m.actual || "-"} |`);
          lines.push("");
        }
        return {
          content: [
            {
              type: "text",
              text: lines.join("\n")
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error auditing collection: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  /**
   * validate_color_contrast - Validate all foreground/background pairs
   */
  server.tool(
    "validate_color_contrast",
    "Validate all foreground/background pairs meet WCAG AA standards",
    {
      collection_id: z.string().describe("Collection ID or name"),
      mode: z.string().optional().describe("Mode to validate"),
      standard: z.enum(["AA", "AAA"]).optional().describe("WCAG standard (default: AA)")
    },
    async ({ collection_id, mode, standard }) => {
      try {
        const result = await sendCommandToFigma("validate_color_contrast", {
          collectionId: collection_id,
          mode,
          standard: standard || "AA"
        }) as any;
        const pairs = result.pairs || result.results || (Array.isArray(result) ? result : []);
        const passCount = pairs.filter((p: any) => p.passes || p.pass).length;
        const lines: string[] = [
          `## Color Contrast Validation (${standard || "AA"})`,
          `${passCount}/${pairs.length} pairs pass`,
          "",
          "| Foreground | Background | Ratio | Pass |",
          "|------------|------------|-------|------|",
        ];
        for (const p of pairs) {
          const fg = p.foregroundName || formatColorValue(p.foreground);
          const bg = p.backgroundName || formatColorValue(p.background);
          const ratio = typeof p.ratio === "number" ? p.ratio.toFixed(2) : p.ratio ?? "-";
          const pass = (p.passes || p.pass) ? "Yes" : "No";
          lines.push(`| ${fg} | ${bg} | ${ratio}:1 | ${pass} |`);
        }
        return {
          content: [
            {
              type: "text",
              text: lines.join("\n")
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error validating color contrast: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  /**
   * get_schema_definition - Return the complete standard schema
   */
  server.tool(
    "get_schema_definition",
    "Return the complete standard schema definition",
    {
      include_chart_colors: z.boolean().optional().describe("Include chart colors (default: false)"),
      format: z.enum(["structured", "flat"]).optional().describe("Output format (default: structured)")
    },
    async ({ include_chart_colors, format }) => {
      try {
        const schema = getStandardSchema(include_chart_colors || false);

        if (format === "flat") {
          const flatSchema = {
            version: schema.version,
            totalVariables: schema.totalVariables,
            variables: getAllStandardVariableNames(include_chart_colors || false)
          };
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(flatSchema, null, 2)
              }
            ]
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(schema, null, 2)
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting schema definition: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  /**
   * suggest_missing_variables - Get list of missing variables with suggested values
   */
  server.tool(
    "suggest_missing_variables",
    "Get list of missing variables with suggested default values",
    {
      collection_id: z.string().describe("Collection ID or name"),
      use_defaults: z.boolean().optional().describe("Include default values from reference theme (default: true)")
    },
    async ({ collection_id, use_defaults }) => {
      try {
        const result = await sendCommandToFigma("suggest_missing_variables", {
          collectionId: collection_id,
          useDefaults: use_defaults !== false
        }) as any;
        const suggestions = result.suggestions || result.missing || (Array.isArray(result) ? result : []);
        if (suggestions.length === 0) {
          return { content: [{ type: "text", text: "No missing variables found — collection is complete." }] };
        }
        const lines: string[] = [
          `## Missing Variables (${suggestions.length})`,
          "",
          "| Name | Category | Suggested Value |",
          "|------|----------|-----------------|",
        ];
        for (const s of suggestions) {
          const name = s.name || s.variableName || "-";
          const cat = s.category || s.group || "-";
          const val = s.suggestedValue != null ? formatVariableValue(s.type || "COLOR", s.suggestedValue) : "-";
          lines.push(`| ${name} | ${cat} | ${val} |`);
        }
        return {
          content: [
            {
              type: "text",
              text: lines.join("\n")
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error suggesting missing variables: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  // ========================================
  // 5. TEMPLATE & PRESET TOOLS (3 tools)
  // ========================================

  /**
   * apply_default_theme - Apply default dark theme values
   */
  server.tool(
    "apply_default_theme",
    "Apply the default dark theme values from documentation",
    {
      collection_id: z.string().describe("Collection ID or name"),
      overwrite_existing: z.boolean().optional().describe("Overwrite existing variables (default: false)"),
      include_chart_colors: z.boolean().optional().describe("Include chart colors (default: false)")
    },
    async ({ collection_id, overwrite_existing, include_chart_colors }) => {
      try {
        const result = await sendCommandToFigma("apply_default_theme", {
          collectionId: collection_id,
          overwriteExisting: overwrite_existing || false,
          includeChartColors: include_chart_colors || false
        }) as any;
        const created = result.created ?? "-";
        const skipped = result.skipped ?? 0;
        const updated = result.updated ?? 0;
        return {
          content: [
            {
              type: "text",
              text: `Applied default theme — ${created} created, ${updated} updated, ${skipped} skipped`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error applying default theme: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  /**
   * create_color_scale_set - Create complete scale for one color
   */
  server.tool(
    "create_color_scale_set",
    "Create complete scale for one color (base + foreground + 10 scale variants)",
    {
      collection_id: z.string().describe("Collection ID or name"),
      color_name: z.string().describe("Color name (e.g., 'primary', 'success')"),
      base_color: RGBAColorSchema.describe("Base color RGB"),
      foreground_color: RGBAColorSchema.describe("Foreground color RGB"),
      background_color: RGBAColorSchema.describe("Background color for scale calculation"),
      mode: z.string().optional().describe("Mode to create variables in")
    },
    async ({ collection_id, color_name, base_color, foreground_color, background_color, mode }) => {
      try {
        const result = await sendCommandToFigma("create_color_scale_set", {
          collectionId: collection_id,
          colorName: color_name,
          baseColor: base_color,
          foregroundColor: foreground_color,
          backgroundColor: background_color,
          mode
        }) as any;
        const created = result.created ?? result.variableCount ?? "-";
        return {
          content: [
            {
              type: "text",
              text: `Created color scale "${color_name}" — ${created} variables (base + foreground + 10 scale levels)`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating color scale set: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  /**
   * apply_custom_palette - Apply custom color values and regenerate scales
   */
  server.tool(
    "apply_custom_palette",
    "Apply custom color values to base colors and regenerate scales",
    {
      collection_id: z.string().describe("Collection ID or name"),
      palette: z.record(z.object({
        base: RGBAColorSchema,
        foreground: RGBAColorSchema
      })).describe("Custom color values for each base color"),
      background_color: RGBAColorSchema.describe("Background color for scale calculations"),
      regenerate_scales: z.boolean().optional().describe("Auto-regenerate all scales (default: true)")
    },
    async ({ collection_id, palette, background_color, regenerate_scales }) => {
      try {
        const result = await sendCommandToFigma("apply_custom_palette", {
          collectionId: collection_id,
          palette,
          backgroundColor: background_color,
          regenerateScales: regenerate_scales !== false
        }) as any;
        const colorCount = Object.keys(palette).length;
        return {
          content: [
            {
              type: "text",
              text: `Applied custom palette — ${colorCount} color(s) updated${regenerate_scales !== false ? ", scales regenerated" : ""}`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error applying custom palette: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  // ========================================
  // 6. ORGANIZATION & MAINTENANCE TOOLS (4 tools)
  // ========================================

  /**
   * reorder_variables - Reorder variables to match standard organization
   */
  server.tool(
    "reorder_variables",
    "Reorder variables to match standard organization",
    {
      collection_id: z.string().describe("Collection ID or name"),
      order: z.union([z.literal("standard"), coerceArray(z.array(z.string()))]).optional().describe("'standard' or custom order array")
    },
    async ({ collection_id, order }) => {
      try {
        const result = await sendCommandToFigma("reorder_variables", {
          collectionId: collection_id,
          order: order || "standard"
        }) as any;
        const reordered = result.reordered ?? result.count ?? "-";
        return {
          content: [
            {
              type: "text",
              text: `Reordered ${reordered} variable(s) to ${order === "standard" || !order ? "standard" : "custom"} order`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error reordering variables: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  /**
   * generate_audit_report - Generate formatted audit report
   */
  server.tool(
    "generate_audit_report",
    "Generate formatted audit report (markdown or JSON)",
    {
      collection_id: z.string().describe("Collection ID or name"),
      include_chart_colors: z.boolean().optional().describe("Expect chart colors"),
      format: z.enum(["markdown", "json"]).optional().describe("Output format (default: markdown)")
    },
    async ({ collection_id, include_chart_colors, format }) => {
      try {
        const result = await sendCommandToFigma("generate_audit_report", {
          collectionId: collection_id,
          includeChartColors: include_chart_colors || false,
          format: format || "markdown"
        });
        return {
          content: [
            {
              type: "text",
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error generating audit report: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  /**
   * export_collection_schema - Export collection as JSON schema
   */
  server.tool(
    "export_collection_schema",
    "Export collection as JSON schema",
    {
      collection_id: z.string().describe("Collection ID or name"),
      mode: z.string().optional().describe("Mode to export"),
      include_metadata: z.boolean().optional().describe("Include metadata (default: true)")
    },
    async ({ collection_id, mode, include_metadata }) => {
      try {
        const result = await sendCommandToFigma("export_collection_schema", {
          collectionId: collection_id,
          mode,
          includeMetadata: include_metadata !== false
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error exporting collection schema: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  /**
   * import_collection_schema - Import variables from JSON schema
   */
  server.tool(
    "import_collection_schema",
    "Import variables from JSON schema",
    {
      collection_id: z.string().describe("Collection ID or name"),
      schema: z.any().describe("JSON schema from export"),
      mode: z.string().optional().describe("Mode to import into"),
      overwrite_existing: z.boolean().optional().describe("Overwrite existing (default: false)")
    },
    async ({ collection_id, schema, mode, overwrite_existing }) => {
      try {
        const result = await sendCommandToFigma("import_collection_schema", {
          collectionId: collection_id,
          schema,
          mode,
          overwriteExisting: overwrite_existing || false
        }) as any;
        const imported = result.imported ?? result.created ?? "-";
        const skipped = result.skipped ?? 0;
        return {
          content: [
            {
              type: "text",
              text: `Imported schema — ${imported} variable(s) created${skipped > 0 ? `, ${skipped} skipped` : ""}`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error importing collection schema: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  // ========================================
  // 7. BULK OPERATIONS TOOLS (3 tools)
  // ========================================

  /**
   * create_all_scales - Create all 7 color scales at once
   */
  server.tool(
    "create_all_scales",
    "Create all 7 color scales at once (70 variants total)",
    {
      collection_id: z.string().describe("Collection ID or name"),
      base_colors: z.record(RGBAColorSchema).describe("Base colors for each scale"),
      background_color: RGBAColorSchema.describe("Background color for calculations")
    },
    async ({ collection_id, base_colors, background_color }) => {
      try {
        const result = await sendCommandToFigma("create_all_scales", {
          collectionId: collection_id,
          baseColors: base_colors,
          backgroundColor: background_color
        }) as any;
        const colorNames = Object.keys(base_colors);
        const totalVars = result.totalCreated ?? colorNames.length * 10;
        return {
          content: [
            {
              type: "text",
              text: `Created all scales — ${colorNames.length} color(s) (${colorNames.join(", ")}), ${totalVars} variables total`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating all scales: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  /**
   * fix_collection_to_standard - One-click fix to bring collection to standard
   */
  server.tool(
    "fix_collection_to_standard",
    "One-click fix to bring collection to 102-variable standard",
    {
      collection_id: z.string().describe("Collection ID or name"),
      preserve_custom: z.boolean().optional().describe("Keep non-standard variables (default: false)"),
      add_chart_colors: z.boolean().optional().describe("Add chart colors (default: false)"),
      use_default_values: z.boolean().optional().describe("Use default theme values (default: true)"),
      dry_run: z.boolean().optional().describe("Preview changes without applying (default: false)")
    },
    async ({ collection_id, preserve_custom, add_chart_colors, use_default_values, dry_run }) => {
      try {
        const result = await sendCommandToFigma("fix_collection_to_standard", {
          collectionId: collection_id,
          preserveCustom: preserve_custom || false,
          addChartColors: add_chart_colors || false,
          useDefaultValues: use_default_values !== false,
          dryRun: dry_run || false
        }) as any;
        const actions = result.actions || {};
        const added = actions.variablesAdded ?? result.added ?? "-";
        const removed = actions.variablesRemoved ?? result.removed ?? 0;
        const status = result.result?.status ?? result.status ?? "-";
        const prefix = dry_run ? "[DRY RUN] " : "";
        return {
          content: [
            {
              type: "text",
              text: `${prefix}Fixed collection to standard — ${added} added, ${removed} removed, status: ${status}`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error fixing collection to standard: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  /**
   * add_chart_colors - Add 8 chart colors to collection
   */
  server.tool(
    "add_chart_colors",
    "Add 8 chart colors to collection",
    {
      collection_id: z.string().describe("Collection ID or name"),
      chart_colors: coerceArray(z.array(RGBAColorSchema)).optional().describe("Custom chart colors (default: use standard palette)")
    },
    async ({ collection_id, chart_colors }) => {
      try {
        const result = await sendCommandToFigma("add_chart_colors", {
          collectionId: collection_id,
          chartColors: chart_colors
        }) as any;
        const count = result.created ?? result.count ?? 8;
        return {
          content: [
            {
              type: "text",
              text: `Added ${count} chart color(s) to collection`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error adding chart colors: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  // ========================================
  // 8. MODE MANAGEMENT TOOLS (4 tools)
  // ========================================

  /**
   * add_mode_to_collection - Add a new mode (e.g., Light, Dark, High Contrast)
   */
  server.tool(
    "add_mode_to_collection",
    "Add a new mode to a variable collection (e.g., Light mode, Dark mode, High Contrast)",
    {
      collection_id: z.string().describe("Collection ID or name"),
      mode_name: z.string().describe("Mode name (e.g., 'Light', 'Dark', 'High Contrast')")
    },
    async ({ collection_id, mode_name }) => {
      try {
        const result = await sendCommandToFigma("add_mode_to_collection", {
          collectionId: collection_id,
          modeName: mode_name
        }) as any;
        return {
          content: [
            {
              type: "text",
              text: `Added mode "${result.modeName || mode_name}" to collection (ID: ${result.modeId || "-"})`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error adding mode: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  /**
   * rename_mode - Rename an existing mode
   */
  server.tool(
    "rename_mode",
    "Rename an existing mode in a collection",
    {
      collection_id: z.string().describe("Collection ID or name"),
      old_mode_name: z.string().describe("Current mode name"),
      new_mode_name: z.string().describe("New mode name")
    },
    async ({ collection_id, old_mode_name, new_mode_name }) => {
      try {
        const result = await sendCommandToFigma("rename_mode", {
          collectionId: collection_id,
          oldModeName: old_mode_name,
          newModeName: new_mode_name
        }) as any;
        return {
          content: [
            {
              type: "text",
              text: `Renamed mode from "${old_mode_name}" to "${result.newModeName || new_mode_name}"`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error renaming mode: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  /**
   * delete_mode - Delete a mode from collection
   */
  server.tool(
    "delete_mode",
    "Delete a mode from a collection (cannot delete last mode)",
    {
      collection_id: z.string().describe("Collection ID or name"),
      mode_name: z.string().describe("Mode name to delete")
    },
    async ({ collection_id, mode_name }) => {
      try {
        const result = await sendCommandToFigma("delete_mode", {
          collectionId: collection_id,
          modeName: mode_name
        }) as any;
        return {
          content: [
            {
              type: "text",
              text: `Deleted mode "${mode_name}" from collection`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error deleting mode: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  /**
   * duplicate_mode_values - Copy all variable values from one mode to another
   */
  server.tool(
    "duplicate_mode_values",
    "Copy all variable values from one mode to another (useful for creating light mode from dark mode)",
    {
      collection_id: z.string().describe("Collection ID or name"),
      source_mode: z.string().describe("Source mode name to copy from"),
      target_mode: z.string().describe("Target mode name to copy to"),
      transform_colors: z.object({
        brightness_adjustment: z.number().optional().describe("Brightness adjustment for colors (-1 to 1, e.g., 0.2 for lighter)")
      }).optional().describe("Optional color transformations")
    },
    async ({ collection_id, source_mode, target_mode, transform_colors }) => {
      try {
        const result = await sendCommandToFigma("duplicate_mode_values", {
          collectionId: collection_id,
          sourceMode: source_mode,
          targetMode: target_mode,
          transformColors: transform_colors
        }) as any;
        const count = result.variablesCopied ?? result.count ?? "-";
        return {
          content: [
            {
              type: "text",
              text: `Copied ${count} variable values from "${source_mode}" to "${target_mode}"`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error duplicating mode values: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  // ========================================
  // 9. TOKEN SYSTEM TOOLS (3 tools)
  // ========================================

  /**
   * create_spacing_system - Create complete spacing token system
   */
  server.tool(
    "create_spacing_system",
    "Create complete spacing token system with 8pt or 4pt grid",
    {
      collection_id: z.string().describe("Collection ID or name"),
      preset: z.enum(["8pt", "4pt", "tailwind", "material"]).describe("Spacing preset to use"),
      include_semantic: z.boolean().optional().default(true).describe("Include semantic tokens (component.gap, layout.margin, etc.)")
    },
    async ({ collection_id, preset, include_semantic }) => {
      try {
        const spacingPreset = getSpacingPreset(preset);

        // Create primitive spacing variables
        const primitiveVars = Object.entries(spacingPreset).map(([key, value]) => ({
          name: `spacing/${key}`,
          type: "FLOAT" as const,
          value
        }));

        // Create batch
        const result = await sendCommandToFigma("create_variables_batch", {
          collectionId: collection_id,
          variables: primitiveVars
        });

        let semanticCount = 0;
        // Note: Semantic tokens would require variable aliasing support
        // For now, we document which semantic tokens should be created
        const semanticTokens = include_semantic ? generateSemanticSpacing() : {};
        semanticCount = Object.keys(semanticTokens).length;

        const varNames = primitiveVars.map(v => v.name);
        const lines: string[] = [
          `## Spacing System (${preset})`,
          `Created ${primitiveVars.length} primitive variable(s)`,
          "",
          "| Variable | Value |",
          "|----------|-------|",
        ];
        for (const v of primitiveVars) lines.push(`| ${v.name} | ${v.value} |`);
        if (semanticCount > 0) {
          lines.push("");
          lines.push(`${semanticCount} semantic token(s) available for manual aliasing`);
        }
        return {
          content: [
            {
              type: "text",
              text: lines.join("\n")
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating spacing system: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  /**
   * create_typography_system - Create complete typography token system
   */
  server.tool(
    "create_typography_system",
    "Create complete typography token system with font sizes, weights, and line heights",
    {
      collection_id: z.string().describe("Collection ID or name"),
      scale_preset: z.enum(["major-third", "minor-third", "perfect-fourth"]).describe("Typography scale to use"),
      base_size: z.number().optional().default(16).describe("Base font size in pixels"),
      include_weights: z.boolean().optional().default(true).describe("Include font weight tokens"),
      include_line_heights: z.boolean().optional().default(true).describe("Include line height tokens"),
      include_semantic: z.boolean().optional().default(true).describe("Include semantic typography tokens")
    },
    async ({ collection_id, scale_preset, base_size, include_weights, include_line_heights, include_semantic }) => {
      try {
        const typeScale = getTypographyPreset(scale_preset);

        const variables = [];

        // Create font size variables
        Object.entries(typeScale).forEach(([key, value]) => {
          variables.push({
            name: `font.size.${key}`,
            type: "FLOAT" as const,
            value
          });
        });

        // Create font weight variables
        if (include_weights) {
          Object.entries(FONT_WEIGHTS).forEach(([key, value]) => {
            variables.push({
              name: `font.weight.${key}`,
              type: "FLOAT" as const,
              value
            });
          });
        }

        // Create line height variables
        if (include_line_heights) {
          Object.entries(LINE_HEIGHTS).forEach(([key, value]) => {
            variables.push({
              name: `font.lineHeight.${key}`,
              type: "FLOAT" as const,
              value
            });
          });
        }

        const result = await sendCommandToFigma("create_variables_batch", {
          collectionId: collection_id,
          variables
        });

        const semanticTokens = include_semantic ? generateSemanticTypography() : {};

        const semanticCount = Object.keys(semanticTokens).length;
        const lines: string[] = [
          `## Typography System (${scale_preset})`,
          `Created ${variables.length} variable(s) — ${Object.keys(typeScale).length} sizes, ${include_weights ? Object.keys(FONT_WEIGHTS).length : 0} weights, ${include_line_heights ? Object.keys(LINE_HEIGHTS).length : 0} line heights`,
          "",
          "| Variable | Value |",
          "|----------|-------|",
        ];
        for (const v of variables) lines.push(`| ${v.name} | ${v.value} |`);
        if (semanticCount > 0) {
          lines.push("");
          lines.push(`${semanticCount} semantic token(s) available for manual aliasing`);
        }
        return {
          content: [
            {
              type: "text",
              text: lines.join("\n")
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating typography system: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  /**
   * create_radius_system - Create border radius token system
   */
  server.tool(
    "create_radius_system",
    "Create border radius token system",
    {
      collection_id: z.string().describe("Collection ID or name"),
      preset: z.enum(["standard", "subtle", "bold"]).describe("Border radius preset to use")
    },
    async ({ collection_id, preset }) => {
      try {
        const radiusPreset = getRadiusPreset(preset);

        const variables = Object.entries(radiusPreset).map(([key, value]) => ({
          name: `radius/${key === "DEFAULT" ? "md" : key}`,
          type: "FLOAT" as const,
          value
        }));

        const result = await sendCommandToFigma("create_variables_batch", {
          collectionId: collection_id,
          variables
        });

        const lines: string[] = [
          `## Radius System (${preset})`,
          `Created ${variables.length} variable(s)`,
          "",
          "| Variable | Value |",
          "|----------|-------|",
        ];
        for (const v of variables) lines.push(`| ${v.name} | ${v.value} |`);
        return {
          content: [
            {
              type: "text",
              text: lines.join("\n")
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating radius system: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );

  // ========================================
  // 10. UNIFIED DESIGN SYSTEM INITIALIZER (1 tool)
  // ========================================

  /**
   * create_complete_design_system - Initialize complete design system in one command
   */
  server.tool(
    "create_complete_design_system",
    "Initialize a complete design system with colors, spacing, typography, and radius in one command",
    {
      collection_name: z.string().optional().default("Design Tokens").describe("Name for the collection"),
      modes: coerceArray(z.array(z.string())).optional().default(["Light", "Dark"]).describe("Modes to create (e.g., ['Light', 'Dark'])"),
      color_preset: z.enum(["default", "custom"]).optional().default("default").describe("Color preset to use"),
      custom_colors: z.any().optional().describe("Custom color values (if color_preset is 'custom')"),
      spacing_preset: z.enum(["8pt", "4pt", "tailwind", "material"]).optional().default("8pt").describe("Spacing system preset"),
      typography_preset: z.enum(["major-third", "minor-third", "perfect-fourth"]).optional().default("major-third").describe("Typography scale preset"),
      radius_preset: z.enum(["standard", "subtle", "bold"]).optional().default("standard").describe("Border radius preset"),
      include_semantic_tokens: z.boolean().optional().default(true).describe("Include semantic token suggestions")
    },
    async (params) => {
      try {
        const startTime = Date.now();
        const results: any = {
          collectionId: "",
          totalVariables: 0,
          breakdown: {
            colors: 0,
            spacing: 0,
            typography: 0,
            radius: 0
          },
          modes: params.modes || ["Light", "Dark"]
        };

        // 1. Create collection with first mode
        const collection = await sendCommandToFigma("create_variable_collection", {
          name: params.collection_name,
          defaultMode: results.modes[0]
        });
        results.collectionId = collection.collectionId;

        // 2. Add additional modes
        for (let i = 1; i < results.modes.length; i++) {
          await sendCommandToFigma("add_mode_to_collection", {
            collectionId: collection.collectionId,
            modeName: results.modes[i]
          });
        }

        // 3. Create color system (use existing tools)
        if (params.color_preset === "default") {
          const colorResult = await sendCommandToFigma("apply_default_theme", {
            collectionId: collection.collectionId,
            overwriteExisting: false,
            includeChartColors: false
          });
          results.breakdown.colors = colorResult.created || 0;
        }

        // 4. Create spacing system
        const spacingResult = await sendCommandToFigma("create_spacing_system", {
          collection_id: collection.collectionId,
          preset: params.spacing_preset,
          include_semantic: params.include_semantic_tokens
        });
        results.breakdown.spacing = spacingResult.primitiveCount || 0;

        // 5. Create typography system
        const typoResult = await sendCommandToFigma("create_typography_system", {
          collection_id: collection.collectionId,
          scale_preset: params.typography_preset,
          include_weights: true,
          include_line_heights: true,
          include_semantic: params.include_semantic_tokens
        });
        results.breakdown.typography = typoResult.totalVariables || 0;

        // 6. Create radius system
        const radiusResult = await sendCommandToFigma("create_radius_system", {
          collection_id: collection.collectionId,
          preset: params.radius_preset
        });
        results.breakdown.radius = radiusResult.totalVariables || 0;

        // 7. If dark mode was created, duplicate values with adjustments
        if (results.modes.length > 1 && results.modes.includes("Dark")) {
          await sendCommandToFigma("duplicate_mode_values", {
            collectionId: collection.collectionId,
            sourceMode: results.modes[0],
            targetMode: "Dark",
            transformColors: {
              brightness_adjustment: -0.3
            }
          });
        }

        // 8. Calculate totals
        results.totalVariables = Object.values(results.breakdown).reduce((a: number, b: number) => a + b, 0);

        const duration = Date.now() - startTime;

        return {
          content: [
            {
              type: "text",
              text: `✅ Complete Design System Created!

Collection: "${params.collection_name}" (ID: ${results.collectionId})

📊 Summary:
- Total Variables: ${results.totalVariables}
- Colors: ${results.breakdown.colors}
- Spacing: ${results.breakdown.spacing}
- Typography: ${results.breakdown.typography}
- Border Radius: ${results.breakdown.radius}

🎨 Modes: ${results.modes.join(", ")}

⚙️ Configuration:
- Spacing: ${params.spacing_preset}
- Typography: ${params.typography_preset}
- Border Radius: ${params.radius_preset}
- Semantic Tokens: ${params.include_semantic_tokens ? "Enabled" : "Disabled"}

⏱️ Created in ${duration}ms

🎉 Your design system is ready to use!`
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating complete design system: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        };
      }
    }
  );
}
