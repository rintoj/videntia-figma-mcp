import { h } from "preact";

interface SelectionBottomBarProps {
  checkedCount: number;
  totalCount: number;
  onCopyIds: () => void;
  onClear: () => void;
  onToggleSelectAll: () => void;
}

export function SelectionBottomBar(props: SelectionBottomBarProps) {
  if (props.checkedCount === 0) return null;

  var isPartial = props.checkedCount > 0 && props.checkedCount < props.totalCount;

  return (
    <div>
      <div class="h-px bg-muted shrink-0" />
      <div class="flex items-center justify-between py-2 pl-3 pr-[16px] bg-muted shrink-0">
        <div class="flex items-center gap-2">
          <button
            class="bg-primary border border-solid border-primary text-primary-foreground rounded-md py-1 px-2 text-[11px] leading-4 font-medium cursor-pointer transition-colors hover:opacity-90"
            onClick={props.onCopyIds}
          >
            Copy IDs
          </button>
          <button
            class="bg-muted border border-border rounded-md text-muted-foreground text-[11px] leading-4 font-medium cursor-pointer py-1 px-2 hover:bg-input"
            onClick={props.onClear}
          >
            Clear
          </button>
        </div>
        <button
          class="flex items-center gap-1.5 bg-transparent border-none cursor-pointer p-0"
          onClick={props.onToggleSelectAll}
          title={isPartial ? "Select all" : "Deselect all"}
        >
          <span class="text-success text-[11px] leading-4 font-medium">{props.checkedCount + " selected"}</span>
          {isPartial ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="0" y="0" width="14" height="14" rx="3" style={{ fill: "var(--color-success)" }} />
              <line x1="3.5" y1="7" x2="10.5" y2="7" style={{ stroke: "var(--color-primary-foreground)" }} stroke-width="1.5" stroke-linecap="round" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="0" y="0" width="14" height="14" rx="3" style={{ fill: "var(--color-success)" }} />
              <polyline points="3.5 7 6 9.5 10.5 4.5" style={{ stroke: "var(--color-primary-foreground)" }} stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
