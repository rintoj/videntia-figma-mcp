// Figma MCP plugin — OpenType feature reads.
//
// PLATFORM LIMIT: TextNode.openTypeFeatures is READONLY in the Plugin API and there is
// no setRangeOpenTypeFeatures — features (ligatures, tabular figures, …) can only be
// read here, never written.

type FeatureMap = Record<string, boolean>;

export interface OpenTypeFeatureRange {
  start: number;
  end: number;
  characters: string;
  features: FeatureMap;
}

export interface GetTextOpenTypeFeaturesResult {
  id: string;
  name: string;
  /** Node-wide map, or "mixed" when ranges differ. Only non-default features are listed. */
  features: FeatureMap | "mixed";
  ranges: OpenTypeFeatureRange[];
  note: string;
}

export const OPENTYPE_READONLY_NOTE =
  "Figma's Plugin API exposes OpenType features read-only (TextNode.openTypeFeatures); they cannot be set from a plugin. Only features that differ from the font's defaults are listed (e.g. LIGA/CLIG default on, TNUM default off).";

function plainFeatures(value: unknown): FeatureMap {
  const out: FeatureMap = {};
  if (value && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      out[key] = Boolean((value as Record<string, unknown>)[key]);
    }
  }
  return out;
}

export async function getTextOpenTypeFeatures(params: Record<string, unknown>): Promise<GetTextOpenTypeFeaturesResult> {
  const nodeId = params && (params["nodeId"] as string | undefined);
  if (!nodeId) throw new Error("Missing nodeId parameter");
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) throw new Error(`Node not found with ID: ${nodeId}`);
  if (node.type !== "TEXT") throw new Error(`Node ${nodeId} is a ${node.type}, not a TEXT node`);
  const text = node as TextNode;

  const ranges: OpenTypeFeatureRange[] = [];
  const segments = text.getStyledTextSegments(["openTypeFeatures"]);
  for (const seg of segments) {
    ranges.push({
      start: seg.start,
      end: seg.end,
      characters: seg.characters,
      features: plainFeatures(seg.openTypeFeatures),
    });
  }

  const whole = text.openTypeFeatures;
  const features: FeatureMap | "mixed" =
    whole === figma.mixed ? "mixed" : plainFeatures(whole as unknown as Record<string, boolean>);

  return { id: text.id, name: text.name, features, ranges, note: OPENTYPE_READONLY_NOTE };
}
