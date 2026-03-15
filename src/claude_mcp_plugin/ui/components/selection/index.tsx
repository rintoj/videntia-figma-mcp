import { h } from "preact";
import { FILTER_OPTIONS } from "./types";
import { FilterIcon } from "./icons";
import { FilterPopup } from "./filter-popup";
import { NodeRow } from "./node-row";
import { SelectionBottomBar } from "./selection-bottom-bar";
import { useSelection } from "./use-selection";

export function SelectionSection() {
  var sel = useSelection();

  var currentFilterIcon = FILTER_OPTIONS.filter(function (o) {
    return o.value === sel.filterMode;
  })[0].icon;

  return (
    <div class="flex flex-col bg-card flex-1 min-h-0">
      <div class="flex items-center gap-2 px-3 pt-3 pb-2 shrink-0 bg-muted border-b border-border">
        <div
          class={
            "flex items-center flex-1 min-w-0 h-[30px] bg-muted border rounded-md gap-2" +
            (sel.searchFocused ? "  border-ring" : " border-border")
          }
        >
          <div
            ref={sel.filterRef}
            class={
              "relative shrink-0 h-full border-0 border-r border-solid" +
              (sel.searchFocused ? " border-r-ring" : " border-r-border")
            }
          >
            <button
              class="flex items-center justify-center py-0.5 pl-2 pr-1 cursor-pointer h-full bg-transparent border-none"
              onClick={function () {
                sel.setShowFilterPopup(!sel.showFilterPopup);
              }}
              title="Filter by"
            >
              <FilterIcon
                icon={currentFilterIcon}
                color={sel.filterMode !== "selection" ? "#0fa958" : "var(--color-primary)"}
              />
              <svg class="shrink-0" width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M3.5 5.25L7 8.75L10.5 5.25"
                  stroke="var(--color-muted-foreground)"
                  stroke-width="1.167"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
            {sel.showFilterPopup && (
              <FilterPopup filterMode={sel.filterMode} onSelect={sel.handleFilterSelect} />
            )}
          </div>
          <input
            type="text"
            class="flex-1 min-w-0 bg-transparent border-none text-foreground text-[11px] outline-none h-full"
            placeholder={sel.placeholder}
            value={sel.searchQuery}
            onInput={sel.handleSearchInput}
            onFocus={function () {
              sel.setSearchFocused(true);
            }}
            onBlur={function () {
              sel.setSearchFocused(false);
            }}
          />
        </div>
        <div class="flex items-center shrink-0 h-[30px] border border-border rounded-md overflow-hidden">
          <button
            class="flex items-center justify-center h-[30px] px-1 py-2 bg-transparent border-none cursor-pointer transition-colors hover:bg-input"
            onClick={sel.handlePrev}
            title="Previous"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ stroke: "var(--color-muted-foreground)" }} stroke-width="1.083" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="8.1 2.2 4.9 6.5 8.1 10.8" />
            </svg>
          </button>
          <button
            class="flex items-center justify-center h-[30px] px-1 py-2 bg-transparent border-none cursor-pointer transition-colors hover:bg-input"
            onClick={sel.handleNext}
            title="Next"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ stroke: "var(--color-muted-foreground)" }} stroke-width="1.083" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="4.9 2.2 8.1 6.5 4.9 10.8" />
            </svg>
          </button>
        </div>
      </div>
      <div class={"flex-1 overflow-y-auto min-h-0 px-2 scrollbar-thin" + (sel.displayNodes.length === 0 ? " flex flex-col" : "")}>
        {sel.displayNodes.length === 0 && (
          <div class="flex flex-col items-center justify-center flex-1 gap-3 px-4">
            <div class="flex items-center justify-center w-[36px] h-[36px] rounded-lg bg-[var(--color-muted)] border border-[var(--color-border)]">
              <FilterIcon
                icon={sel.searchQuery.length > 0 ? "cursor" : sel.filterMode === "selection" ? "cursor" : sel.filterMode === "name_or_id" ? "hash" : sel.filterMode === "content" ? "type" : sel.filterMode === "type" ? "layers" : sel.filterMode === "variable" ? "variable" : "palette"}
                color="var(--color-muted-foreground)"
              />
            </div>
            <span class="text-muted-foreground text-[13px] font-medium">
              {sel.searchQuery.length > 0
                ? "No matches found"
                : sel.filterMode === "selection"
                  ? "Nothing selected yet"
                  : "No frame selected"}
            </span>
            <span class="text-muted-foreground text-[11px] text-center" style={{ marginTop: "-4px" }}>
              {sel.searchQuery.length > 0
                ? "No layers matched your search. Try a different term."
                : sel.filterMode === "selection"
                  ? "Click on any layer in Figma to get started"
                  : sel.filterMode === "name_or_id"
                    ? "Select a frame to search its layers by name or ID"
                    : sel.filterMode === "content"
                      ? "Select a frame to find layers by text content"
                      : sel.filterMode === "type"
                        ? "Select a frame to filter layers by type"
                        : sel.filterMode === "variable"
                          ? "Select a frame to find layers with variable bindings"
                          : "Select a frame to find layers by fill or stroke color"}
            </span>
          </div>
        )}
        {(function () {
          var seenIds: Record<string, boolean> = {};
          return sel.displayNodes.map(function (node, i) {
            var isDuplicate = !!seenIds[node.id];
            seenIds[node.id] = true;
            return (
              <NodeRow
                key={node.id + "-" + i}
                node={node}
                index={i}
                filterMode={sel.filterMode}
                isActive={sel.navIndex === i}
                isChecked={!!sel.checkedIds[node.id]}
                isHovered={sel.hoveredId === node.id}
                isDuplicate={isDuplicate}
                copiedId={sel.copiedId}
                onClick={sel.handleRowClick}
                onCopyId={sel.handleCopyId}
                onToggleChecked={sel.toggleChecked}
                onHover={sel.setHoveredId}
              />
            );
          });
        })()}
      </div>
      <SelectionBottomBar
        checkedCount={sel.checkedCount}
        totalCount={sel.displayNodes.length}
        onCopyIds={sel.copyCheckedIds}
        onClear={sel.clearChecked}
        onToggleSelectAll={sel.toggleSelectAll}
      />
    </div>
  );
}
