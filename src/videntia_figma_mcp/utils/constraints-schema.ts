import { z } from "zod";

export const constraintTypeSchema = z.enum(["MIN", "CENTER", "MAX", "STRETCH", "SCALE"]);

const CONSTRAINTS_OBJECT_DESCRIPTION =
  "Constraints for the imported vector layers when their container resizes: { horizontal?, vertical? }, each MIN | CENTER | MAX | STRETCH | SCALE; an omitted axis keeps Figma's import default (SCALE). " +
  "Applied to every vector layer inside the SVG wrapper frame (relative to that frame), or to the node itself when flattened. Figma's default SCALE stretches glyphs with the frame — " +
  'pass { horizontal: "CENTER", vertical: "CENTER" } to keep an icon at its drawn size when the frame or component resizes; keep SCALE for illustrations that should grow.';

export const svgConstraintsSchema = z
  .object({
    horizontal: constraintTypeSchema.optional(),
    vertical: constraintTypeSchema.optional(),
  })
  .refine((c) => c.horizontal !== undefined || c.vertical !== undefined, {
    message: "constraints needs horizontal and/or vertical",
  })
  .describe(CONSTRAINTS_OBJECT_DESCRIPTION);
