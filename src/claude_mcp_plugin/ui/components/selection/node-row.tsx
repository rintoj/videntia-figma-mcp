import { h } from "preact";
import { FilterMode, NodeInfo } from "./types";
import { TypeIcon } from "./icons";

interface NodeRowProps {
  node: NodeInfo;
  index: number;
  filterMode: FilterMode;
  isActive: boolean;
  isChecked: boolean;
  isHovered: boolean;
  isDuplicate: boolean;
  copiedId: string | null;
  onClick: (node: NodeInfo, index: number) => void;
  onCopyId: (e: Event, id: string) => void;
  onToggleChecked: (e: Event, id: string) => void;
  onHover: (id: string | null) => void;
}

export function NodeRow(props: NodeRowProps) {
  var node = props.node;
  var isHovered = props.isHovered;
  var isChecked = props.isChecked;
  var copiedId = props.copiedId;

  return (
    <div
      key={node.id + "-" + props.index}
      class={
        "flex items-center gap-1.5 h-[30px] pr-[4px] pl-[8px] cursor-pointer transition-colors relative rounded-sm border" +
        (props.isActive ? " border-ring" : " border-transparent") +
        (isChecked ? " bg-accent" : "")
      }
      style={props.isDuplicate ? { opacity: 0.4 } : undefined}
      onClick={function () {
        props.onClick(node, props.index);
      }}
      onMouseEnter={function () {
        props.onHover(node.id);
      }}
      onMouseLeave={function () {
        props.onHover(null);
      }}
    >
      {isChecked && <div class="absolute left-0 top-0 w-[2px] h-full bg-success rounded-l-sm" />}
      {props.filterMode === "color" && node.colorHex ? (
        <div class="shrink-0 w-[13px] h-[13px] rounded-sm border border-border" style={{ backgroundColor: node.colorHex }} />
      ) : (
        <TypeIcon type={node.type} />
      )}
      <div class="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
        {props.filterMode === "content" && node.content ? (
          <span class="text-foreground text-[11px] leading-4 font-medium whitespace-nowrap overflow-hidden text-ellipsis shrink min-w-0">
            "{node.content}"
          </span>
        ) : props.filterMode === "type" ? (
          <span class="text-foreground text-[11px] leading-4 font-medium whitespace-nowrap overflow-hidden text-ellipsis shrink min-w-0">
            {node.type}
          </span>
        ) : props.filterMode === "variable" && node.variablePath ? (
          <span class="text-foreground text-[11px] leading-4 font-medium whitespace-nowrap overflow-hidden text-ellipsis shrink min-w-0">
            {node.variablePath}
          </span>
        ) : props.filterMode === "text_styles" && node.textStyleName ? (
          <span class="text-foreground text-[11px] leading-4 font-medium whitespace-nowrap overflow-hidden text-ellipsis shrink min-w-0">
            {node.textStyleName}
          </span>
        ) : props.filterMode === "typography" && node.fontInfo ? (
          <span class="text-foreground text-[11px] leading-4 font-medium whitespace-nowrap overflow-hidden text-ellipsis shrink min-w-0">
            {node.fontInfo}
          </span>
        ) : props.filterMode === "color" && node.colorHex ? (
          <span class="text-foreground text-[11px] leading-4 font-medium whitespace-nowrap overflow-hidden text-ellipsis shrink min-w-0">
            {node.colorHex}
          </span>
        ) : (
          <span class="text-foreground text-[11px] leading-4 font-medium whitespace-nowrap overflow-hidden text-ellipsis shrink min-w-0">
            {node.name}
          </span>
        )}
        {props.filterMode === "content" ||
        props.filterMode === "type" ||
        props.filterMode === "variable" ||
        props.filterMode === "text_styles" ||
        props.filterMode === "typography" ||
        props.filterMode === "color" ? (
          <span class="text-muted-foreground text-[11px] leading-4 font-medium whitespace-nowrap overflow-hidden text-ellipsis shrink min-w-0">
            {node.name}
          </span>
        ) : null}
        <span class="text-muted-foreground text-[10px] leading-[14px] whitespace-nowrap shrink-0" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          {node.id}
        </span>
        {node.type !== "PAGE" && node.pageName ? (
          <span class="text-muted-foreground text-[11px] leading-4 font-medium whitespace-nowrap shrink-0">{node.pageName}</span>
        ) : null}
      </div>
      {isHovered || copiedId === node.id ? (
        <button
          class="flex items-center justify-center w-6 h-6 bg-transparent border-none rounded cursor-pointer shrink-0 transition-colors hover:bg-input"
          onClick={function (e: Event) {
            props.onCopyId(e, node.id);
          }}
          title="Copy node ID"
        >
          {copiedId === node.id ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ stroke: "var(--color-primary)" }} stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ stroke: "var(--color-muted-foreground)" }} stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
          )}
        </button>
      ) : null}
      <button
        class="flex items-center justify-center w-6 h-6 bg-transparent border-none cursor-pointer shrink-0 p-0"
        onClick={function (e: Event) {
          props.onToggleChecked(e, node.id);
        }}
        title={isChecked ? "Deselect" : "Select"}
      >
        {isChecked ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="1" width="14" height="14" rx="3" style={{ fill: "var(--color-success)" }} />
            <polyline points="4.5 8 7 10.5 11.5 5.5" style={{ stroke: "var(--color-primary-foreground)" }} stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="1.5" y="1.5" width="13" height="13" rx="2.5" style={{ stroke: "var(--color-border)" }} stroke-width="1" />
          </svg>
        )}
      </button>
    </div>
  );
}
