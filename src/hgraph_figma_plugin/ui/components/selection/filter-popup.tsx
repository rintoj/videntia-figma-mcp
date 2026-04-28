import { h } from "preact";
import { FilterMode, FILTER_OPTIONS } from "./types";
import { FilterIcon } from "./icons";

interface FilterPopupProps {
  filterMode: FilterMode;
  onSelect: (mode: FilterMode) => void;
}

export function FilterPopup(props: FilterPopupProps) {
  return (
    <div
      class="absolute left-0 top-full mt-1 flex flex-col py-1 bg-popover border border-border rounded-md z-50"
      style={{ boxShadow: "0px 4px 12px 0px rgba(0,0,0,0.4)", minWidth: "140px" }}
    >
      <div class="flex items-center px-2.5 py-1.5">
        <span class="text-muted-foreground text-[11px] leading-4 font-medium uppercase">Filter by</span>
      </div>
      {FILTER_OPTIONS.map(function (opt) {
        var isActive = props.filterMode === opt.value;
        return (
          <button
            key={opt.value}
            class={
              "flex items-center gap-2 px-2.5 py-1.5 bg-transparent border-none cursor-pointer text-left w-full transition-colors hover:bg-accent" +
              (isActive ? " bg-accent" : "")
            }
            onClick={function () {
              props.onSelect(opt.value);
            }}
          >
            <FilterIcon icon={opt.icon} color={isActive ? "#0fa958" : "var(--color-muted-foreground)"} />
            <span class="text-[11px] leading-4 font-medium text-foreground">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
