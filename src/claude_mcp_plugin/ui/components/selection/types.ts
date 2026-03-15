export interface NodeInfo {
  id: string;
  name: string;
  type: string;
  pageName: string;
  content?: string;
  variablePath?: string;
  colorHex?: string;
  textStyleName?: string;
  fontInfo?: string;
}

export type FilterMode = "selection" | "name_or_id" | "content" | "type" | "variable" | "text_styles" | "typography" | "color";

export var FILTER_OPTIONS: Array<{ value: FilterMode; label: string; icon: string }> = [
  { value: "selection", label: "Selection", icon: "cursor" },
  { value: "name_or_id", label: "Name or ID", icon: "hash" },
  { value: "content", label: "Content", icon: "type" },
  { value: "type", label: "Type", icon: "layers" },
  { value: "variable", label: "Variable", icon: "variable" },
  { value: "text_styles", label: "Text Styles", icon: "paintbrush" },
  { value: "typography", label: "Typography", icon: "a-large-small" },
  { value: "color", label: "Color", icon: "palette" },
];

export function copyToClipboard(text: string) {
  try {
    var textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  } catch (err) {
    console.error("Copy failed:", err);
  }
}
