import { z } from "zod";
import { RGBAColor } from "./color-calculations.js";
import { toRgba } from "./color-input.js";

/**
 * Shared variable value schemas and type-driven value normalization, used by the
 * variable tools and by the command-param normalizer that batch_actions relies on.
 */

// Zod schemas for color validation
const coerceColorChannel = z.preprocess(
  (v) => (typeof v === "boolean" || v === null ? undefined : v),
  // Range is 0–255: a channel > 1 is read as 0–255 by toRgba, <= 1 as 0–1.
  z.coerce.number().min(0).max(255),
);

export const RGBAColorSchema = z.object({
  r: coerceColorChannel.describe("Red component (0-1)"),
  g: coerceColorChannel.describe("Green component (0-1)"),
  b: coerceColorChannel.describe("Blue component (0-1)"),
  a: coerceColorChannel.optional().describe("Alpha component (0-1, default: 1.0)"),
});

// MotionEasing — value shape for EASING-typed variables. `type` is a discriminant;
// CUSTOM_CUBIC_BEZIER/CUSTOM_SPRING additionally require their matching sub-field.
const MotionEasingTypeSchema = z.enum([
  "EASE_IN",
  "EASE_OUT",
  "EASE_IN_AND_OUT",
  "LINEAR",
  "EASE_IN_BACK",
  "EASE_OUT_BACK",
  "EASE_IN_AND_OUT_BACK",
  "CUSTOM_CUBIC_BEZIER",
  "GENTLE",
  "QUICK",
  "BOUNCY",
  "SLOW",
  "CUSTOM_SPRING",
  "HOLD",
]);

const EasingFunctionBezierSchema = z.object({
  x1: z.coerce.number(),
  y1: z.coerce.number(),
  x2: z.coerce.number(),
  y2: z.coerce.number(),
});

const EasingFunctionSpringSchema = z.object({
  bounce: z.coerce.number().min(0).max(1).describe("Normalized bounce, 0-1"),
});

export const MotionEasingSchema = z.object({
  type: MotionEasingTypeSchema,
  easingFunctionCubicBezier: EasingFunctionBezierSchema.optional().describe(
    "Required when type is CUSTOM_CUBIC_BEZIER",
  ),
  easingFunctionSpring: EasingFunctionSpringSchema.optional().describe("Required when type is CUSTOM_SPRING"),
});

export type MotionEasingValue = z.infer<typeof MotionEasingSchema>;

export const VariableTypeSchema = z.enum(["COLOR", "FLOAT", "STRING", "BOOLEAN", "EASING", "TIMING"]);
export const VariableInputValueSchema = z.union([
  RGBAColorSchema,
  MotionEasingSchema,
  z.array(z.coerce.number()).min(3).max(4),
  z.string(),
  z.number(),
  z.boolean(),
]);

export function normalizeVariableValueByType(
  type: z.infer<typeof VariableTypeSchema>,
  value: unknown,
): RGBAColor | MotionEasingValue | number | string | boolean {
  if (type === "COLOR") {
    // Accepts hex, {r,g,b,a} in 0-1 or 0-255, and [r,g,b(,a)] arrays.
    return toRgba(value);
  }

  if (type === "FLOAT") {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    throw new Error(`Invalid FLOAT value: ${String(value)}`);
  }

  if (type === "TIMING") {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    throw new Error(`Invalid TIMING value: ${String(value)}. Expected a number of seconds.`);
  }

  if (type === "EASING") {
    const parsed = MotionEasingSchema.safeParse(value);
    if (!parsed.success) {
      throw new Error(
        `Invalid EASING value: ${JSON.stringify(value)}. Expected a MotionEasing object, e.g. {type: "EASE_IN_AND_OUT"}, {type: "CUSTOM_CUBIC_BEZIER", easingFunctionCubicBezier: {x1,y1,x2,y2}}, or {type: "CUSTOM_SPRING", easingFunctionSpring: {bounce: 0-1}}.`,
      );
    }
    if (parsed.data.type === "CUSTOM_CUBIC_BEZIER" && !parsed.data.easingFunctionCubicBezier) {
      throw new Error('EASING type "CUSTOM_CUBIC_BEZIER" requires easingFunctionCubicBezier: {x1,y1,x2,y2}');
    }
    if (parsed.data.type === "CUSTOM_SPRING" && !parsed.data.easingFunctionSpring) {
      throw new Error('EASING type "CUSTOM_SPRING" requires easingFunctionSpring: {bounce: 0-1}');
    }
    return parsed.data;
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
