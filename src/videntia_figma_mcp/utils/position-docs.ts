/**
 * The one description of what x/y mean on create_* / move_node. Figma stores x/y
 * relative to the node's parent, and these tools write them that way.
 */
export function parentRelativePositionDescription(axis: "X" | "Y", defaultNote?: string): string {
  return (
    `${axis} position in pixels, RELATIVE TO THE PARENT${defaultNote ? ` (${defaultNote})` : ""}. ` +
    "With no parentId the parent is the current page, whose coordinates are canvas coordinates; inside a FRAME, " +
    "COMPONENT or SECTION it is the offset from that parent's top-left, not a canvas coordinate (inside a GROUP, " +
    "from the group's nearest frame/page ancestor). " +
    "Use move_node_absolute to place a node at canvas coordinates. Ignored inside an auto-layout parent unless " +
    "layoutPositioning is ABSOLUTE."
  );
}

export const CREATE_POSITION_NOTE =
  "x/y are relative to the parent (the page when parentId is omitted, i.e. canvas coordinates); the result also " +
  "reports absoluteX/absoluteY (canvas coordinates) so you can verify placement without a second read.";

/** " at (x, y) in parent <id>, absolute (ax, ay)" — whatever part of that the result carries. */
export function formatPlacement(result: unknown): string {
  if (result === null || typeof result !== "object") return "";
  const r = result as { x?: unknown; y?: unknown; absoluteX?: unknown; absoluteY?: unknown; parentId?: unknown };
  const num = (v: unknown): v is number => typeof v === "number" && isFinite(v);
  const round = (v: number): number => Math.round(v * 100) / 100;
  let out = "";
  if (num(r.x) && num(r.y)) {
    out += ` at (${round(r.x)}, ${round(r.y)})`;
    out += typeof r.parentId === "string" ? ` in parent ${r.parentId}` : "";
  }
  if (num(r.absoluteX) && num(r.absoluteY)) out += `, absolute (${round(r.absoluteX)}, ${round(r.absoluteY)})`;
  return out;
}
