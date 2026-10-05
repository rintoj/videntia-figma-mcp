/**
 * The one description of what x/y mean on create_* / move_node. Figma stores x/y
 * relative to the node's parent, and these tools write them that way.
 */
export function parentRelativePositionDescription(axis: "X" | "Y", defaultNote?: string): string {
  return (
    `${axis} px, relative to the parent${defaultNote ? ` (${defaultNote})` : ""}: the page (canvas coords) ` +
    "without parentId, else offset from the FRAME/COMPONENT/SECTION parent's top-left (a GROUP uses its nearest frame/page). " +
    "Canvas coords: move_node_absolute. Ignored in auto-layout unless layoutPositioning is ABSOLUTE."
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
