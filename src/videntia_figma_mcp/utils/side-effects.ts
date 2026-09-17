import { z } from "zod";
import { mcpBooleanSchema } from "./mcp-boolean.js";

/**
 * Shared side-effect acknowledgement plumbing.
 *
 * The write-verify guards (`videntia_figma_plugin/utils/write-verify.ts`) detect
 * knock-on changes a write caused — today: an auto-layout parent that resized
 * because a child's sizing changed. In strict mode that throws, which is right
 * when the change was unintended and wrong when shrinking the parent WAS the
 * edit. These params let the caller say "yes, I want that": the side effect is
 * then kept, reported as a warning plus `acknowledgedSideEffects`, and never
 * throws. Silent-no-op detection is untouched — no need to disable strict mode.
 */

/** Side-effect kinds the guards can raise, for the `expect_side_effects` enum. */
export const SIDE_EFFECT_KINDS = ["parentResize"] as const;

export const allowSideEffectsParam = mcpBooleanSchema
  .optional()
  .describe(
    "Acknowledge EVERY knock-on change this write causes (e.g. an auto-layout parent resizing because a child switched to FILL). Acknowledged side effects are kept and reported as warnings instead of throwing in strict mode. Use `expect_side_effects` to acknowledge only specific kinds.",
  ) as z.ZodType<boolean | undefined>;

export const expectSideEffectsParam = z
  .array(z.enum(SIDE_EFFECT_KINDS))
  .optional()
  .describe(
    "Acknowledge only these side-effect kinds — `parentResize` = this node's auto-layout parent is expected to resize. Any other detected side effect still throws in strict mode.",
  );
