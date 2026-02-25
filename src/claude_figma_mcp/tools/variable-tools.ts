import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendCommandToFigma } from "../utils/websocket.js";
import { coerceArray } from "../utils/coerce-array.js";
import { mcpBooleanSchema } from "../utils/mcp-boolean.js";
import {
  calculateColorScale,
  calculateCompositeColor,
  calculateContrastRatio,
  convertColorFormat,
  getWCAGCompliance,
  getContrastRecommendation,
  rgbaToHex,
  SCALE_MIX_PERCENTAGES,
  RGBAColor,
} from "../utils/color-calculations.js";
import {
  getStandardSchema,
  getAllStandardVariableNames,
  getVariableCategory,
  isStandardVariable,
  DEFAULT_DARK_THEME,
  DEFAULT_CHART_COLORS,
  getScaleVariableNames,
  getStandardVariableOrder,
} from "../utils/theme-schema.js";
import {
  getSpacingPreset,
  getTypographyPreset,
  getRadiusPreset,
  FONT_WEIGHTS,
  LINE_HEIGHTS,
  generateSemanticSpacing,
  generateSemanticTypography,
} from "../utils/token-presets.js";
import { formatColorValue, formatVariableValue } from "../utils/format-helpers.js";
import type {
  VariablesResponse,
  CreateVariableCollectionResult,
  GetCollectionInfoResult,
  RenameVariableCollectionResult,
  DeleteVariableCollectionResult,
  CreateVariableResult,
  CreateVariablesBatchResult,
  UpdateVariableValueResult,
  RenameVariableResult,
  DeleteVariableResult,
  DeleteVariablesBatchResult,
  AuditCollectionResult,
  ValidateColorContrastResult,
  SuggestMissingVariablesResult,
  ApplyDefaultThemeResult,
  CreateColorScaleSetResult,
  ReorderVariablesResult,
  GenerateAuditReportResult,
  ExportCollectionSchemaResult,
  ImportCollectionSchemaResult,
  CreateAllScalesResult,
  FixCollectionToStandardResult,
  AddChartColorsResult,
  AddModeResult,
  RenameModeResult,
  DeleteModeResult,
  DuplicateModeValuesResult,
  DesignSystemSubResult,
  DesignSystemCollectionResult,
} from "../types/index.js";

// Zod schemas for color validation
const coerceColorChannel = z.preprocess(
  (v) => (typeof v === "boolean" || v === null ? undefined : v),
  z.coerce.number().min(0).max(1),
);

const RGBAColorSchema = z.object({
  r: coerceColorChannel.describe("Red component (0-1)"),
  g: coerceColorChannel.describe("Green component (0-1)"),
  b: coerceColorChannel.describe("Blue component (0-1)"),
  a: coerceColorChannel.optional().describe("Alpha component (0-1, default: 1.0)"),
});

const VariableTypeSchema = z.enum(["COLOR", "FLOAT", "STRING", "BOOLEAN"]);
const VariableInputValueSchema = z.union([RGBAColorSchema, z.string(), z.number(), z.boolean()]);

function normalizeVariableValueByType(type: z.infer<typeof VariableTypeSchema>, value: unknown): RGBAColor | number | string | boolean {
  if (type === "COLOR") {
    return RGBAColorSchema.parse(value);
  }

  if (type === "FLOAT") {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    throw new Error(`Invalid FLOAT value: ${String(value)}`);
  }

  if (type === "BOOLEAN") {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (value === 1) return true;
      if (value === 0) return false;
      throw new Error(`Invalid BOOLEAN number value: ${String(value)}`);
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") return true;
      if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") return false;
    }
    throw new Error(`Invalid BOOLEAN value: ${String(value)}`);
  }

  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  throw new Error(`Invalid STRING value: ${String(value)}`);
}

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
        const result = await sendCommandToFigma<VariablesResponse>("get_variable_collections");
        const collections = Array.isArray(result) ? result : (result?.collections ?? [result]);
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
              text: lines.join("\n"),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting variable collections: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  /**
   * create_variable_collection - Create a new variable collection
   */
  server.tool(
    "create_variable_collection",
    "Create a new variable collection",
    {
      name: z.string().describe("Collection name (e.g., 'Theme')"),
      default_mode: z.string().optional().describe("Default mode name (default: 'dark')"),
    },
    async ({ name, default_mode }) => {
      try {
        const result = await sendCommandToFigma<CreateVariableCollectionResult>("create_variable_collection", {
          name,
          defaultMode: default_mode || "dark",
        });
        return {
          content: [
            {
              type: "text",
              text: `Created collection "${result.name || name}" (ID: ${result.collectionId || result.id || "-"})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating variable collection "${name}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  /**
   * get_collection_info - Get detailed metadata about a collection
   */
  server.tool(
    "get_collection_info",
    "Get detailed metadata about a variable collection",
    {
      id: z.string().describe("Collection ID (e.g. 'VariableCollectionId:1:2') or collection name (e.g. 'Theme') — use get_variable_collections to list available IDs"),
    },
    async ({ id: collection_id }) => {
      try {
        const result = await sendCommandToFigma<GetCollectionInfoResult>("get_collection_info", {
          collectionId: collection_id,
        });
        const modes = (result.modes || []).map((m: any) => `${m.name} (${m.modeId})`).join(", ");
        const varCount = result.variableCount ?? result.variableIds?.length ?? "-";
        const lines = [`## Collection: ${result.name} (id: ${result.id})`, `Modes: ${modes}`, `Variables: ${varCount}`];
        if (result.description) lines.push(`Description: ${result.description}`);
        return {
          content: [
            {
              type: "text",
              text: lines.join("\n"),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting collection info for "${collection_id}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  /**
   * rename_variable_collection - Rename a variable collection
   */
  server.tool(
    "rename_variable_collection",
    "Rename a variable collection",
    {
      id: z.string().describe("Collection ID or name"),
      name: z.string().describe("New name for the collection"),
    },
    async ({ id: collection_id, name: new_name }) => {
      try {
        const result = await sendCommandToFigma<RenameVariableCollectionResult>("rename_variable_collection", {
          collectionId: collection_id,
          newName: new_name,
        });
        return {
          content: [
            {
              type: "text",
              text: `Renamed collection to "${result.newName || new_name}" (ID: ${result.collectionId || collection_id})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error renaming variable collection "${collection_id}" to "${new_name}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  /**
   * delete_variable_collection - Delete a variable collection and all its variables
   */
  server.tool(
    "delete_variable_collection",
    "Delete a variable collection and all its variables (cannot be undone)",
    {
      id: z.string().describe("Collection ID or name"),
    },
    async ({ id: collection_id }) => {
      try {
        const result = await sendCommandToFigma<DeleteVariableCollectionResult>("delete_variable_collection", {
          collectionId: collection_id,
        });
        return {
          content: [
            {
              type: "text",
              text: `Deleted collection (ID: ${result.collectionId || collection_id})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error deleting variable collection "${collection_id}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
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
      type: VariableTypeSchema.describe("Variable type: COLOR = RGBA color object {r,g,b,a} with normalized 0–1 values, FLOAT = numeric value (spacing, sizing, etc.), STRING = text value, BOOLEAN = true/false"),
      value: VariableInputValueSchema.describe("Variable value matching the type: COLOR → {r:0–1, g:0–1, b:0–1, a:0–1}, FLOAT → number, STRING → string, BOOLEAN → true/false"),
      mode: z.string().optional().describe("Mode name to set the value for (e.g. 'dark', 'light'); omit to set for the collection's default mode"),
    },
    async ({ collection_id, name, type, value, mode }) => {
      try {
        const normalizedValue = normalizeVariableValueByType(type, value);
        const result = await sendCommandToFigma<CreateVariableResult>("create_variable", {
          collectionId: collection_id,
          name,
          type,
          value: normalizedValue,
          mode,
        });
        return {
          content: [
            {
              type: "text",
              text: `Created ${type} variable "${result.name || name}" (ID: ${result.variableId || result.id || "-"})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating variable "${name}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  /**
   * create_variables_batch - Create multiple variables at once
   */
  server.tool(
    "create_variables_batch",
    "Create multiple variables at once (more efficient than individual calls, supports all types)",
    {
      collection_id: z.string().describe("Collection ID or name"),
      variables: coerceArray(
        z.array(
          z.object({
            name: z.string().describe("Variable name"),
            type: VariableTypeSchema.describe("Variable type — value must match this type"),
            value: VariableInputValueSchema.describe("Value matching the type: COLOR → {r,g,b,a} normalized, FLOAT → number, STRING → string, BOOLEAN → true/false"),
          }),
        ),
      ).describe("Array of variable definitions to create in one batch"),
      mode: z.string().optional().describe("Mode name to set values for (e.g. 'dark'); omit to use collection's default mode"),
    },
    async ({ collection_id, variables, mode }) => {
      try {
        const normalizedVariables = variables.map((variable) => ({
          ...variable,
          value: normalizeVariableValueByType(variable.type, variable.value),
        }));
        const result = await sendCommandToFigma<CreateVariablesBatchResult>("create_variables_batch", {
          collectionId: collection_id,
          variables: normalizedVariables,
          mode,
        });
        const created = result.created ?? result.variables?.length ?? variables.length;
        const failed = result.errors?.length ?? 0;
        return {
          content: [
            {
              type: "text",
              text: `Created ${created} variable(s)${failed > 0 ? `, ${failed} failed` : ""}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating variables batch in collection "${collection_id}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  /**
   * update_variable_value - Update a variable's value (supports all types)
   */
  server.tool(
    "update_variable_value",
    "Update a variable's value (supports COLOR, FLOAT, STRING, BOOLEAN types)",
    {
      id: z.string().describe("Variable ID or name"),
      collection_id: z.string().optional().describe("Collection ID (required if using variable name)"),
      value: VariableInputValueSchema.describe("New value (type must match variable type)"),
      mode: z.string().optional().describe("Mode to update (default: first mode)"),
    },
    async ({ id: variable_id, collection_id, value, mode }) => {
      try {
        const result = await sendCommandToFigma<UpdateVariableValueResult>("update_variable_value", {
          variableId: variable_id,
          collectionId: collection_id,
          value,
          mode,
        });
        return {
          content: [
            {
              type: "text",
              text: `Updated variable "${result.variableId || variable_id}" value${mode ? ` (mode: ${mode})` : ""}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error updating variable value for "${variable_id}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  /**
   * rename_variable - Rename a variable
   */
  server.tool(
    "rename_variable",
    "Rename a variable",
    {
      id: z.string().describe("Variable ID or current name"),
      collection_id: z.string().optional().describe("Collection ID (required if using variable name)"),
      name: z.string().describe("New variable name"),
    },
    async ({ id: variable_id, collection_id, name: new_name }) => {
      try {
        const result = await sendCommandToFigma<RenameVariableResult>("rename_variable", {
          variableId: variable_id,
          collectionId: collection_id,
          newName: new_name,
        });
        return {
          content: [
            {
              type: "text",
              text: `Renamed variable to "${result.newName || new_name}" (ID: ${result.variableId || variable_id})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error renaming variable "${variable_id}" to "${new_name}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  /**
   * delete_variable - Delete a single variable
   */
  server.tool(
    "delete_variable",
    "Delete a single variable",
    {
      id: z.string().describe("Variable ID or name"),
      collection_id: z.string().optional().describe("Collection ID (required if using variable name)"),
    },
    async ({ id: variable_id, collection_id }) => {
      try {
        const result = await sendCommandToFigma<DeleteVariableResult>("delete_variable", {
          variableId: variable_id,
          collectionId: collection_id,
        });
        return {
          content: [
            {
              type: "text",
              text: `Deleted variable (ID: ${result.variableId || variable_id})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error deleting variable "${variable_id}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  /**
   * delete_variables_batch - Delete multiple variables at once
   */
  server.tool(
    "delete_variables_batch",
    "Delete multiple variables at once",
    {
      ids: coerceArray(z.array(z.string())).describe("Array of variable IDs or names"),
      collection_id: z.string().optional().describe("Collection ID (required if using names)"),
    },
    async ({ ids: variable_ids, collection_id }) => {
      try {
        const result = await sendCommandToFigma<DeleteVariablesBatchResult>("delete_variables_batch", {
          variableIds: variable_ids,
          collectionId: collection_id,
        });
        const deleted = result.deleted ?? variable_ids.length;
        return {
          content: [
            {
              type: "text",
              text: `Deleted ${deleted} variable(s)`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error deleting variables batch (${variable_ids.length} variables): ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
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
      base: RGBAColorSchema.describe("The primary/brand color to build a scale from — provided as normalized RGB {r,g,b} where each channel is 0–1"),
      background: RGBAColorSchema.describe("The dark background color to blend against (e.g. page background) — provided as normalized RGB {r,g,b} 0–1. Scale level 900 is closest to this base color, level 50 is closest to background."),
      input_format: z.enum(["normalized", "rgb255"]).optional().describe("Color input format: 'normalized' = channels 0–1 (default), 'rgb255' = channels 0–255"),
    },
    async ({ base, background, input_format }) => {
      try {
        const scale = calculateColorScale(base, background);

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
          lines.push(
            `| ${level} | ${color ? formatColorValue(color) : "-"} | ${mix != null ? `${Math.round(mix * 100)}%` : "-"} |`,
          );
        }
        return {
          content: [
            {
              type: "text",
              text: lines.join("\n"),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error calculating color scale: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  /**
   * calculate_composite_color - Calculate a single composited color
   */
  server.tool(
    "calculate_composite_color",
    "Calculate a single composited color at a specific mix percentage",
    {
      base: RGBAColorSchema.describe("Primary color as normalized RGB {r,g,b} 0–1 — at mix_percentage=1.0, result equals this color"),
      background: RGBAColorSchema.describe("Background color as normalized RGB {r,g,b} 0–1 — at mix_percentage=0.0, result equals this color"),
      mix_percentage: z.coerce.number().min(0).max(1).describe("Blend ratio 0.0–1.0: 0.0 = pure background, 1.0 = pure base, 0.5 = 50/50 blend"),
      input_format: z.enum(["normalized", "rgb255"]).optional().describe("Color input format: 'normalized' = 0–1 (default), 'rgb255' = 0–255"),
    },
    async ({ base, background, mix_percentage, input_format }) => {
      try {
        const result = calculateCompositeColor(base, background, mix_percentage);
        const hex = rgbaToHex(result);

        return {
          content: [
            {
              type: "text",
              text: `## Composite Color\n- **Formula**: (base × ${mix_percentage}) + (background × ${1 - mix_percentage})\n- **Result**: ${formatColorValue(result)}\n- **Hex**: ${hex}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error calculating composite color: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  /**
   * convert_color_format - Convert color between different formats
   */
  server.tool(
    "convert_color_format",
    "Convert color between different formats",
    {
      color: z.union([RGBAColorSchema, z.string()]).describe("Color value to convert — object {r,g,b,a} for normalized/rgb255 formats, or string '#RRGGBB' / '#RRGGBBAA' for hex format"),
      from_format: z.enum(["normalized", "rgb255", "hex"]).describe("Source format: 'normalized' = {r,g,b,a} channels 0–1, 'rgb255' = {r,g,b,a} channels 0–255, 'hex' = '#RRGGBB' or '#RRGGBBAA' string"),
      to_format: z.enum(["normalized", "rgb255", "hex"]).describe("Target format: 'normalized' = {r,g,b,a} 0–1, 'rgb255' = {r,g,b,a} 0–255, 'hex' = '#RRGGBB' string"),
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
              text: `## Color Conversion (${from_format} → ${to_format})\n- **Input**: ${inputStr}\n- **Output**: ${outputStr}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error converting color format: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
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
      input_format: z.enum(["normalized", "rgb255"]).optional().describe("Input format (default: normalized)"),
    },
    async ({ foreground, background, input_format }) => {
      try {
        const ratio = calculateContrastRatio(foreground, background);
        const wcag = getWCAGCompliance(ratio);
        const recommendation = getContrastRecommendation(ratio);

        const wcagLines = Object.entries(wcag)
          .map(([level, passes]) => `${level}: ${passes ? "Pass" : "Fail"}`)
          .join(", ");
        return {
          content: [
            {
              type: "text",
              text: `## Contrast Ratio: ${ratio.toFixed(2)}:1\n- **WCAG**: ${wcagLines}\n- **Recommendation**: ${recommendation}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error calculating contrast ratio: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
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
      collection_id: z.string().describe("Collection ID or name to audit against the standard schema"),
      chartColors: mcpBooleanSchema.optional().describe("true = expect the 8 optional chart color variables in addition to the 102 base variables (default: false)"),
      custom_schema: z.any().optional().describe("Custom schema object to validate against instead of the built-in standard — must match the schema format returned by get_schema_definition; omit to use the built-in standard schema"),
    },
    async ({ collection_id, chartColors, custom_schema }) => {
      try {
        const result = await sendCommandToFigma<AuditCollectionResult>("audit_collection", {
          collectionId: collection_id,
          includeChartColors: chartColors || false,
          customSchema: custom_schema,
        });
        const lines: string[] = [];
        const compliance = (result as any).compliancePercentage ?? result.compliancePercent ?? result.compliance ?? "-";
        lines.push(`## Audit Result — ${compliance}% compliant`);
        const total = (result as any).expectedVariables ?? result.totalExpected ?? result.total ?? "-";
        const found = (result as any).totalVariables ?? result.found ?? result.matching ?? "-";
        lines.push(`Expected: ${total} | Found: ${found}`);
        lines.push("");
        const missingRaw = result.missing as any;
        const missing: string[] = Array.isArray(missingRaw)
          ? missingRaw
          : (missingRaw && Array.isArray(missingRaw.variables) ? missingRaw.variables : []);
        if (missing.length > 0) {
          lines.push(`### Missing (${missing.length})`);
          lines.push("| Name |");
          lines.push("|------|");
          for (const m of missing) lines.push(`| ${typeof m === "string" ? m : (m as any).name} |`);
          lines.push("");
        }
        const extraRaw = (result as any).nonStandard || result.extra;
        const extra: string[] = Array.isArray(extraRaw)
          ? extraRaw
          : (extraRaw && Array.isArray(extraRaw.variables) ? extraRaw.variables.map((v: any) => typeof v === "string" ? v : v.name) : []);
        if (extra.length > 0) {
          lines.push(`### Extra (${extra.length})`);
          lines.push("| Name |");
          lines.push("|------|");
          for (const e of extra) lines.push(`| ${typeof e === "string" ? e : (e as any).name} |`);
          lines.push("");
        }
        const mismatched: Array<Record<string, any>> =
          (result as any).typeMismatches || (result as any).mismatched || (result as any).typeErrors || [];
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
              text: lines.join("\n"),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error auditing collection "${collection_id}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  /**
   * validate_color_contrast - Validate all foreground/background pairs
   */
  server.tool(
    "validate_color_contrast",
    "Validate all foreground/background pairs meet WCAG AA standards",
    {
      collection_id: z.string().describe("Collection ID or name containing the color variables to validate"),
      mode: z.string().optional().describe("Mode name to validate (e.g. 'dark', 'light'); omit to use the collection's default mode"),
      standard: z.enum(["AA", "AAA"]).optional().describe("WCAG contrast standard: AA = minimum (4.5:1 normal text, 3:1 large text), AAA = enhanced (7:1 normal text, 4.5:1 large text; default: AA)"),
    },
    async ({ collection_id, mode, standard }) => {
      try {
        const result = await sendCommandToFigma<ValidateColorContrastResult>("validate_color_contrast", {
          collectionId: collection_id,
          mode,
          standard: standard || "AA",
        });
        const pairs: Array<Record<string, any>> =
          result.pairs || (result as any).results || (Array.isArray(result) ? result : []);
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
          const ratio = typeof p.ratio === "number" ? p.ratio.toFixed(2) : (p.ratio ?? "-");
          const pass = p.passes || p.pass ? "Yes" : "No";
          lines.push(`| ${fg} | ${bg} | ${ratio}:1 | ${pass} |`);
        }
        return {
          content: [
            {
              type: "text",
              text: lines.join("\n"),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error validating color contrast for collection "${collection_id}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  /**
   * get_schema_definition - Return the complete standard schema
   */
  server.tool(
    "get_schema_definition",
    "Return the complete standard schema definition",
    {
      chartColors: mcpBooleanSchema.optional().describe("true = include the 8 optional chart color variable definitions in the schema output (default: false)"),
      format: z.enum(["structured", "flat"]).optional().describe("Output format: 'structured' = full schema with categories and metadata (default), 'flat' = simple list of variable names only"),
    },
    async ({ chartColors, format }) => {
      try {
        const schema = getStandardSchema(chartColors || false);

        if (format === "flat") {
          const flatSchema = {
            version: schema.version,
            totalVariables: schema.totalVariables,
            variables: getAllStandardVariableNames(chartColors || false),
          };
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(flatSchema, null, 2),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(schema, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting schema definition: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  /**
   * suggest_missing_variables - Get list of missing variables with suggested values
   */
  server.tool(
    "suggest_missing_variables",
    "Get list of missing variables with suggested default values",
    {
      collection_id: z.string().describe("Collection ID or name to check for missing variables"),
      defaults: mcpBooleanSchema.optional().describe("true = include suggested default values from the reference dark theme alongside each missing variable name (default: true)"),
    },
    async ({ collection_id, defaults }) => {
      try {
        const result = await sendCommandToFigma<SuggestMissingVariablesResult>("suggest_missing_variables", {
          collectionId: collection_id,
          useDefaults: defaults !== false,
        });
        const suggestions: Array<Record<string, any>> =
          result.suggestions || (result as any).missing || (Array.isArray(result) ? result : []);
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
              text: lines.join("\n"),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error suggesting missing variables for collection "${collection_id}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
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
      collection_id: z.string().describe("Collection ID or name to apply the default dark theme values to"),
      overwrite: mcpBooleanSchema.optional().describe("true = update variables that already exist with default values; false = skip existing variables and only create missing ones (default: false)"),
      chartColors: mcpBooleanSchema.optional().describe("true = also apply the 8 optional chart color variables in addition to the 102 base variables (default: false)"),
    },
    async ({ collection_id, overwrite, chartColors }) => {
      try {
        const result = await sendCommandToFigma<ApplyDefaultThemeResult>("apply_default_theme", {
          collectionId: collection_id,
          overwriteExisting: overwrite || false,
          includeChartColors: chartColors || false,
        });
        const created = result.created ?? "-";
        const skipped = result.skipped ?? 0;
        const updated = result.updated ?? 0;
        return {
          content: [
            {
              type: "text",
              text: `Applied default theme — ${created} created, ${updated} updated, ${skipped} skipped`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error applying default theme to collection "${collection_id}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  /**
   * create_color_scale_set - Create complete scale for one color
   */
  server.tool(
    "create_color_scale_set",
    "Create complete scale for one color (base + foreground + 10 scale variants)",
    {
      collection_id: z.string().describe("Collection ID or name"),
      color_name: z.string().describe("Semantic color name used as a prefix for all generated variables (e.g. 'primary' → creates 'primary', 'primary-foreground', 'primary-50', 'primary-100', ..., 'primary-900')"),
      base: RGBAColorSchema.describe("The main brand/accent color as normalized RGB {r,g,b} 0–1 — used as the '500' level of the scale and the base variable"),
      foreground: RGBAColorSchema.describe("Text/icon color that sits on top of this color as normalized RGB {r,g,b} 0–1 — stored as the '<name>-foreground' variable"),
      background: RGBAColorSchema.describe("Page/canvas background color as normalized RGB {r,g,b} 0–1 — used as the blend target for generating scale levels 50–900"),
      mode: z.string().optional().describe("Mode name to create variables in (e.g. 'dark'); omit to use the collection's default mode"),
    },
    async ({ collection_id, color_name, base, foreground, background, mode }) => {
      try {
        const result = await sendCommandToFigma<CreateColorScaleSetResult>("create_color_scale_set", {
          collectionId: collection_id,
          colorName: color_name,
          baseColor: base,
          foregroundColor: foreground,
          backgroundColor: background,
          mode,
        });
        const created = result.created ?? result.variables?.length ?? "-";
        return {
          content: [
            {
              type: "text",
              text: `Created color scale "${color_name}" — ${created} variables (base + foreground + 10 scale levels)`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating color scale set "${color_name}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  /**
   * apply_custom_palette - Apply custom color values and regenerate scales
   */
  server.tool(
    "apply_custom_palette",
    "Apply custom color values to base colors and regenerate scales",
    {
      collection_id: z.string().describe("Collection ID or name"),
      palette: z
        .record(
          z.object({
            base: RGBAColorSchema.describe("Main color as normalized RGB {r,g,b} 0–1"),
            foreground: RGBAColorSchema.describe("On-color text/icon color as normalized RGB {r,g,b} 0–1"),
          }),
        )
        .describe("Map of color names to base+foreground pairs — keys should be semantic names matching existing variable prefixes in the collection (e.g. {'primary': {base:{r,g,b}, foreground:{r,g,b}}, 'success': {...}})"),
      background: RGBAColorSchema.describe("Page background color as normalized RGB {r,g,b} 0–1 — used as the blend target for regenerating scale levels 50–900"),
      regenerate_scales: mcpBooleanSchema.optional().describe("true = automatically recalculate and update all scale variables (50–900) using the new base colors and background; false = only update the base and foreground variables (default: true)"),
    },
    async ({ collection_id, palette, background, regenerate_scales }) => {
      try {
        await sendCommandToFigma("apply_custom_palette", {
          collectionId: collection_id,
          palette,
          backgroundColor: background,
          regenerateScales: regenerate_scales !== false,
        });
        const colorCount = Object.keys(palette).length;
        return {
          content: [
            {
              type: "text",
              text: `Applied custom palette — ${colorCount} color(s) updated${regenerate_scales !== false ? ", scales regenerated" : ""}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error applying custom palette to collection "${collection_id}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
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
      order: z
        .union([z.literal("standard"), coerceArray(z.array(z.string()))])
        .optional()
        .describe("'standard' or custom order array"),
    },
    async ({ collection_id, order }) => {
      try {
        const result = await sendCommandToFigma<ReorderVariablesResult>("reorder_variables", {
          collectionId: collection_id,
          order: order || "standard",
        });
        const reordered = result.reordered ?? "-";
        return {
          content: [
            {
              type: "text",
              text: `Reordered ${reordered} variable(s) to ${order === "standard" || !order ? "standard" : "custom"} order`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error reordering variables in collection "${collection_id}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  /**
   * generate_audit_report - Generate formatted audit report
   */
  server.tool(
    "generate_audit_report",
    "Generate formatted audit report (markdown or JSON)",
    {
      collection_id: z.string().describe("Collection ID or name"),
      chartColors: mcpBooleanSchema.optional().describe("Expect chart colors"),
      format: z.enum(["markdown", "json"]).optional().describe("Output format (default: markdown)"),
    },
    async ({ collection_id, chartColors, format }) => {
      try {
        const result = await sendCommandToFigma<GenerateAuditReportResult>("generate_audit_report", {
          collectionId: collection_id,
          includeChartColors: chartColors || false,
          format: format || "markdown",
        });
        return {
          content: [
            {
              type: "text",
              text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error generating audit report for collection "${collection_id}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
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
      include_metadata: mcpBooleanSchema.optional().describe("Include metadata (default: true)"),
    },
    async ({ collection_id, mode, include_metadata }) => {
      try {
        const result = await sendCommandToFigma<ExportCollectionSchemaResult>("export_collection_schema", {
          collectionId: collection_id,
          mode,
          includeMetadata: include_metadata !== false,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error exporting collection schema for "${collection_id}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
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
      overwrite_existing: mcpBooleanSchema.optional().describe("Overwrite existing (default: false)"),
    },
    async ({ collection_id, schema, mode, overwrite_existing }) => {
      try {
        const result = await sendCommandToFigma<ImportCollectionSchemaResult>("import_collection_schema", {
          collectionId: collection_id,
          schema,
          mode,
          overwriteExisting: overwrite_existing || false,
        });
        const imported = result.imported ?? result.created ?? "-";
        const skipped = result.skipped ?? 0;
        return {
          content: [
            {
              type: "text",
              text: `Imported schema — ${imported} variable(s) created${skipped > 0 ? `, ${skipped} skipped` : ""}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error importing collection schema into "${collection_id}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
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
      colors: z.record(RGBAColorSchema).describe("Base colors for each scale"),
      background: RGBAColorSchema.describe("Background color for calculations"),
    },
    async ({ collection_id, colors, background }) => {
      try {
        const result = await sendCommandToFigma<CreateAllScalesResult>("create_all_scales", {
          collectionId: collection_id,
          baseColors: colors,
          backgroundColor: background,
        });
        const colorNames = Object.keys(colors);
        const totalVars = result.totalVariables ?? result.created ?? colorNames.length * 10;
        return {
          content: [
            {
              type: "text",
              text: `Created all scales — ${colorNames.length} color(s) (${colorNames.join(", ")}), ${totalVars} variables total`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating all scales for collection "${collection_id}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  /**
   * fix_collection_to_standard - One-click fix to bring collection to standard
   */
  server.tool(
    "fix_collection_to_standard",
    "One-click fix to bring collection to 102-variable standard",
    {
      collection_id: z.string().describe("Collection ID or name to bring into compliance with the 102-variable standard"),
      preserve_custom: mcpBooleanSchema.optional().describe("true = keep non-standard variables that don't appear in the schema (they stay alongside standard ones); false = remove non-standard variables (default: false)"),
      add_chart_colors: mcpBooleanSchema.optional().describe("true = also add the 8 optional chart color variables to reach 110 total (default: false)"),
      defaults: mcpBooleanSchema.optional().describe("true = populate newly created variables with default dark-theme values; false = create variables without values (default: true)"),
      dry_run: mcpBooleanSchema.optional().describe("true = analyze and report what would change without modifying anything — use this to preview the impact before committing (default: false)"),
    },
    async ({ collection_id, preserve_custom, add_chart_colors, defaults, dry_run }) => {
      try {
        const result = await sendCommandToFigma<FixCollectionToStandardResult>("fix_collection_to_standard", {
          collectionId: collection_id,
          preserveCustom: preserve_custom || false,
          addChartColors: add_chart_colors || false,
          useDefaultValues: defaults !== false,
          dryRun: dry_run || false,
        });
        const added = result.added ?? result.fixed ?? "-";
        const removed = result.removed ?? 0;
        const status = result.status ?? "-";
        const prefix = dry_run ? "[DRY RUN] " : "";
        return {
          content: [
            {
              type: "text",
              text: `${prefix}Fixed collection to standard — ${added} added, ${removed} removed, status: ${status}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error fixing collection "${collection_id}" to standard: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  /**
   * add_chart_colors - Add 8 chart colors to collection
   */
  server.tool(
    "add_chart_colors",
    "Add 8 chart colors to collection",
    {
      id: z.string().describe("Collection ID or name to add chart colors to"),
      chart_colors: coerceArray(z.array(RGBAColorSchema))
        .optional()
        .describe("Array of exactly 8 custom chart colors as normalized RGB objects {r,g,b,a} 0–1 — omit to use the built-in standard chart color palette"),
    },
    async ({ id: collection_id, chart_colors }) => {
      try {
        const result = await sendCommandToFigma<AddChartColorsResult>("add_chart_colors", {
          collectionId: collection_id,
          chartColors: chart_colors,
        });
        const count = result.created ?? result.colors?.length ?? 8;
        return {
          content: [
            {
              type: "text",
              text: `Added ${count} chart color(s) to collection`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error adding chart colors to collection "${collection_id}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
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
      id: z.string().describe("Collection ID or name — use get_variable_collections to list available IDs"),
      name: z.string().describe("Name for the new mode (e.g. 'Light', 'Dark', 'High Contrast') — must be unique within the collection; free-plan Figma accounts are limited to 1 mode per collection"),
    },
    async ({ id: collection_id, name: mode_name }) => {
      try {
        const result = await sendCommandToFigma<AddModeResult>("add_mode_to_collection", {
          collectionId: collection_id,
          modeName: mode_name,
        });
        return {
          content: [
            {
              type: "text",
              text: `Added mode "${result.modeName || mode_name}" to collection (ID: ${result.modeId || "-"})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error adding mode "${mode_name}" to collection "${collection_id}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  /**
   * rename_mode - Rename an existing mode
   */
  server.tool(
    "rename_mode",
    "Rename an existing mode in a collection",
    {
      id: z.string().describe("Collection ID or name containing the mode to rename"),
      old_name: z.string().describe("Current name of the mode to rename (must match exactly, case-sensitive)"),
      new_name: z.string().describe("New name for the mode — must be unique within the collection"),
    },
    async ({ id: collection_id, old_name: from, new_name: to }) => {
      try {
        const result = await sendCommandToFigma<RenameModeResult>("rename_mode", {
          collectionId: collection_id,
          oldModeName: from,
          newModeName: to,
        });
        return {
          content: [
            {
              type: "text",
              text: `Renamed mode from "${from}" to "${result.newName || to}"`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error renaming mode "${from}" to "${to}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  /**
   * delete_mode - Delete a mode from collection
   */
  server.tool(
    "delete_mode",
    "Delete a mode from a collection (cannot delete last mode)",
    {
      id: z.string().describe("Collection ID or name containing the mode to delete"),
      name: z.string().describe("Exact name of the mode to delete (case-sensitive) — cannot delete the last remaining mode in a collection"),
    },
    async ({ id: collection_id, name: mode_name }) => {
      try {
        await sendCommandToFigma<DeleteModeResult>("delete_mode", {
          collectionId: collection_id,
          modeName: mode_name,
        });
        return {
          content: [
            {
              type: "text",
              text: `Deleted mode "${mode_name}" from collection`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error deleting mode "${mode_name}" from collection "${collection_id}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  /**
   * duplicate_mode_values - Copy all variable values from one mode to another
   */
  server.tool(
    "duplicate_mode_values",
    "Copy all variable values from one mode to another (useful for creating light mode from dark mode)",
    {
      id: z.string().describe("Collection ID or name containing both modes"),
      from: z.string().describe("Name of the source mode to copy values from (must already exist)"),
      to: z.string().describe("Name of the target mode to copy values into (must already exist — create it first with add_mode_to_collection if needed)"),
      transform_colors: z
        .object({
          brightness_adjustment: z
            .number()
            .optional()
            .describe("Brightness adjustment for colors (-1 to 1, e.g., 0.2 for lighter)"),
        })
        .optional()
        .describe("Optional color transformations"),
    },
    async ({ id: collection_id, from, to, transform_colors }) => {
      try {
        const result = await sendCommandToFigma<DuplicateModeValuesResult>("duplicate_mode_values", {
          collectionId: collection_id,
          sourceMode: from,
          targetMode: to,
          transformColors: transform_colors,
        });
        const count = result.copied ?? result.variablesCopied ?? "-";
        return {
          content: [
            {
              type: "text",
              text: `Copied ${count} variable values from "${from}" to "${to}"`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error duplicating mode values from "${from}" to "${to}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
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
      include_semantic: z
        .boolean()
        .optional()
        .default(true)
        .describe("Include semantic tokens (component.gap, layout.margin, etc.)"),
    },
    async ({ collection_id, preset, include_semantic }) => {
      try {
        const spacingPreset = getSpacingPreset(preset);

        // Create primitive spacing variables
        const primitiveVars = Object.entries(spacingPreset).map(([key, value]) => ({
          name: `spacing/${key}`,
          type: "FLOAT" as const,
          value,
        }));

        // Create batch
        await sendCommandToFigma<DesignSystemSubResult>("create_variables_batch", {
          collectionId: collection_id,
          variables: primitiveVars,
        });

        let semanticCount = 0;
        // Note: Semantic tokens would require variable aliasing support
        // For now, we document which semantic tokens should be created
        const semanticTokens = include_semantic ? generateSemanticSpacing() : {};
        semanticCount = Object.keys(semanticTokens).length;

        const varNames = primitiveVars.map((v) => v.name);
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
              text: lines.join("\n"),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating spacing system "${preset}" for collection "${collection_id}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
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
      base_size: z.coerce.number().optional().default(16).describe("Base font size in pixels"),
      include_weights: mcpBooleanSchema.optional().default(true).describe("Include font weight tokens"),
      include_line_heights: mcpBooleanSchema.optional().default(true).describe("Include line height tokens"),
      include_semantic: mcpBooleanSchema.optional().default(true).describe("Include semantic typography tokens"),
    },
    async ({ collection_id, scale_preset, base_size, include_weights, include_line_heights, include_semantic }) => {
      try {
        const typeScale = getTypographyPreset(scale_preset);

        const variables: Array<{ name: string; type: "FLOAT"; value: number }> = [];

        // Create font size variables
        Object.entries(typeScale).forEach(([key, value]) => {
          variables.push({
            name: `font.size.${key}`,
            type: "FLOAT" as const,
            value,
          });
        });

        // Create font weight variables
        if (include_weights) {
          Object.entries(FONT_WEIGHTS).forEach(([key, value]) => {
            variables.push({
              name: `font.weight.${key}`,
              type: "FLOAT" as const,
              value,
            });
          });
        }

        // Create line height variables
        if (include_line_heights) {
          Object.entries(LINE_HEIGHTS).forEach(([key, value]) => {
            variables.push({
              name: `font.lineHeight.${key}`,
              type: "FLOAT" as const,
              value,
            });
          });
        }

        await sendCommandToFigma<DesignSystemSubResult>("create_variables_batch", {
          collectionId: collection_id,
          variables,
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
              text: lines.join("\n"),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating typography system "${scale_preset}" for collection "${collection_id}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );

  /**
   * create_radius_system - Create border radius token system
   */
  server.tool(
    "create_radius_system",
    "Create border radius token system",
    {
      collection_id: z.string().describe("Collection ID or name"),
      preset: z.enum(["standard", "subtle", "bold"]).describe("Border radius preset to use"),
    },
    async ({ collection_id, preset }) => {
      try {
        const radiusPreset = getRadiusPreset(preset);

        const variables = Object.entries(radiusPreset).map(([key, value]) => ({
          name: `radius/${key === "DEFAULT" ? "md" : key}`,
          type: "FLOAT" as const,
          value,
        }));

        await sendCommandToFigma<DesignSystemSubResult>("create_variables_batch", {
          collectionId: collection_id,
          variables,
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
              text: lines.join("\n"),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating radius system "${preset}" for collection "${collection_id}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
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
      modes: coerceArray(z.array(z.string()))
        .optional()
        .default(["Light", "Dark"])
        .describe("Modes to create (e.g., ['Light', 'Dark'])"),
      color_preset: z.enum(["default", "custom"]).optional().default("default").describe("Color preset to use"),
      custom_colors: z.any().optional().describe("Custom color values (if color_preset is 'custom')"),
      spacing_preset: z
        .enum(["8pt", "4pt", "tailwind", "material"])
        .optional()
        .default("8pt")
        .describe("Spacing system preset"),
      typography_preset: z
        .enum(["major-third", "minor-third", "perfect-fourth"])
        .optional()
        .default("major-third")
        .describe("Typography scale preset"),
      radius_preset: z
        .enum(["standard", "subtle", "bold"])
        .optional()
        .default("standard")
        .describe("Border radius preset"),
      include_semantic_tokens: mcpBooleanSchema.optional().default(true).describe("Include semantic token suggestions"),
    },
    async (params) => {
      try {
        const startTime = Date.now();
        const modes = params.modes || ["Light", "Dark"];
        const breakdown = {
          colors: 0,
          spacing: 0,
          typography: 0,
          radius: 0,
        };

        // 1. Create collection with first mode
        const collection = await sendCommandToFigma<DesignSystemCollectionResult>("create_variable_collection", {
          name: params.collection_name,
          defaultMode: modes[0],
        });
        const collectionId = collection.collectionId ?? "";

        // 2. Add additional modes
        for (let i = 1; i < modes.length; i++) {
          await sendCommandToFigma<AddModeResult>("add_mode_to_collection", {
            collectionId,
            modeName: modes[i],
          });
        }

        // 3. Create color system (use existing tools)
        if (params.color_preset === "default") {
          const colorResult = await sendCommandToFigma<ApplyDefaultThemeResult>("apply_default_theme", {
            collectionId,
            overwriteExisting: false,
            includeChartColors: false,
          });
          breakdown.colors = colorResult.created || 0;
        }

        // 4. Create spacing system
        const spacingResult = await sendCommandToFigma<DesignSystemSubResult>("create_spacing_system", {
          collection_id: collectionId,
          preset: params.spacing_preset,
          include_semantic: params.include_semantic_tokens,
        });
        breakdown.spacing = spacingResult.primitiveCount || 0;

        // 5. Create typography system
        const typoResult = await sendCommandToFigma<DesignSystemSubResult>("create_typography_system", {
          collection_id: collectionId,
          scale_preset: params.typography_preset,
          include_weights: true,
          include_line_heights: true,
          include_semantic: params.include_semantic_tokens,
        });
        breakdown.typography = typoResult.totalVariables || 0;

        // 6. Create radius system
        const radiusResult = await sendCommandToFigma<DesignSystemSubResult>("create_radius_system", {
          collection_id: collectionId,
          preset: params.radius_preset,
        });
        breakdown.radius = radiusResult.totalVariables || 0;

        // 7. If dark mode was created, duplicate values with adjustments
        if (modes.length > 1 && modes.includes("Dark")) {
          await sendCommandToFigma<DuplicateModeValuesResult>("duplicate_mode_values", {
            collectionId,
            sourceMode: modes[0],
            targetMode: "Dark",
            transformColors: {
              brightness_adjustment: -0.3,
            },
          });
        }

        // 8. Calculate totals
        const totalVariables = Object.values(breakdown).reduce((a: number, b: number) => a + b, 0);

        const duration = Date.now() - startTime;

        return {
          content: [
            {
              type: "text",
              text: `Complete Design System Created!

Collection: "${params.collection_name}" (ID: ${collectionId})

Summary:
- Total Variables: ${totalVariables}
- Colors: ${breakdown.colors}
- Spacing: ${breakdown.spacing}
- Typography: ${breakdown.typography}
- Border Radius: ${breakdown.radius}

Modes: ${modes.join(", ")}

Configuration:
- Spacing: ${params.spacing_preset}
- Typography: ${params.typography_preset}
- Border Radius: ${params.radius_preset}
- Semantic Tokens: ${params.include_semantic_tokens ? "Enabled" : "Disabled"}

Created in ${duration}ms`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error creating complete design system "${params.collection_name}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    },
  );
}
