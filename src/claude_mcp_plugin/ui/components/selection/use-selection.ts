import { useState, useEffect, useRef } from "preact/hooks";
import { FilterMode, NodeInfo } from "./types";

var MAX_HISTORY = 500;

export function useSelection() {
  var [nodes, setNodes] = useState<NodeInfo[]>([]);
  var [searchQuery, setSearchQuery] = useState("");
  var [searchResults, setSearchResults] = useState<NodeInfo[] | null>(null);
  var [navIndex, setNavIndex] = useState(-1);
  var [copiedId, setCopiedId] = useState<string | null>(null);
  var [hoveredId, setHoveredId] = useState<string | null>(null);
  var [checkedIds, setCheckedIds] = useState<Record<string, boolean>>({});
  var [barVisible, setBarVisible] = useState(false);
  var [hasMore, setHasMore] = useState(false);
  var [isLoadingMore, setIsLoadingMore] = useState(false);
  var [filterMode, setFilterMode] = useState<FilterMode>("selection");
  var [showFilterPopup, setShowFilterPopup] = useState(false);
  var [selectedNodeNames, setSelectedNodeNames] = useState<string[]>([]);
  var [searchFocused, setSearchFocused] = useState(false);
  var searchTimerRef = useRef<any>(null);
  var nodesRef = useRef<NodeInfo[]>([]);
  var historyLoadedRef = useRef(false);
  var suppressRef = useRef(false);
  var filterRef = useRef<HTMLDivElement>(null);
  var skipRefreshRef = useRef(false);

  useEffect(function () {
    function handleMessage(event: MessageEvent) {
      var msg = event.data && event.data.pluginMessage;
      if (!msg) return;
      if (msg.type === "selection-changed") {
        var incoming = Array.isArray(msg.nodes) ? (msg.nodes as NodeInfo[]) : [];
        var names: string[] = [];
        for (var ni = 0; ni < incoming.length; ni++) {
          names.push(incoming[ni].name);
        }
        setSelectedNodeNames(names);

        if (suppressRef.current) {
          suppressRef.current = false;
          skipRefreshRef.current = true;
          return;
        }
        var current = nodesRef.current;
        var newList = current.slice();
        for (var i = incoming.length - 1; i >= 0; i--) {
          var item = incoming[i];
          if (newList.length > 0 && newList[0].id === item.id) continue;
          newList.unshift(item);
        }
        if (newList.length > MAX_HISTORY) newList = newList.slice(0, MAX_HISTORY);
        nodesRef.current = newList;
        setNodes(newList);
        parent.postMessage({ pluginMessage: { type: "save-selection-history", nodes: newList } }, "*");
        setNavIndex(-1);
        var autoChecked: Record<string, boolean> = {};
        for (var j = 0; j < incoming.length; j++) {
          autoChecked[incoming[j].id] = true;
        }
        setCheckedIds(autoChecked);
        setBarVisible(true);
      }
      if (msg.type === "search-results") {
        var incoming = Array.isArray(msg.nodes) ? msg.nodes : [];
        if (typeof msg.offset === "number" && msg.offset > 0) {
          // Append to existing results, but only if offset matches current length (guards against race conditions)
          setSearchResults(function (prev) {
            var current = prev || [];
            if (current.length !== msg.offset) return current;
            return current.concat(incoming);
          });
        } else {
          setSearchResults(incoming);
        }
        setHasMore(!!msg.hasMore);
        setIsLoadingMore(false);
      }
      if (msg.type === "selection-history-loaded" && !historyLoadedRef.current) {
        historyLoadedRef.current = true;
        var loaded = Array.isArray(msg.nodes) ? (msg.nodes as NodeInfo[]).slice(0, MAX_HISTORY) : [];
        nodesRef.current = loaded;
        setNodes(loaded);
      }
    }
    window.addEventListener("message", handleMessage);
    parent.postMessage({ pluginMessage: { type: "load-selection-history" } }, "*");
    parent.postMessage({ pluginMessage: { type: "get-selection" } }, "*");
    return function () {
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  function getPlaceholder(): string {
    var firstName = selectedNodeNames.length > 0 ? selectedNodeNames[0] : "";
    var hasSel = selectedNodeNames.length > 0;
    switch (filterMode) {
      case "selection":
        return "Search history...";
      case "name_or_id":
        return hasSel ? 'Search in "' + firstName + '" by name or id...' : "Search all by name or id...";
      case "content":
        return hasSel ? 'Search in "' + firstName + '" by text content...' : "Search all by text content...";
      case "type":
        return hasSel ? 'Search in "' + firstName + '" by type...' : "Search all by type...";
      case "variable":
        return hasSel ? 'Search in "' + firstName + '" by variable...' : "Search all by variable...";
      case "text_styles":
        return hasSel ? 'Search in "' + firstName + '" by text style...' : "Search all by text style...";
      case "typography":
        return hasSel ? 'Search in "' + firstName + '" by typography...' : "Search all by typography...";
      case "color":
        return hasSel ? 'Search in "' + firstName + '" by color...' : "Search all by color...";
      default:
        return "Search...";
    }
  }

  function getDisplayNodes(): NodeInfo[] {
    if (filterMode === "selection") {
      if (searchQuery.trim().length === 0) return nodes;
      var q = searchQuery.toLowerCase();
      var chars = q.split("").map(function (c) {
        return c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      });
      var pat = new RegExp(chars.join(".*"), "i");
      return nodes.filter(function (n) {
        return pat.test(n.name) || n.id.indexOf(q) === 0 || pat.test(n.type);
      });
    }
    if (searchResults !== null) return searchResults;
    return [];
  }

  // Re-trigger search when Figma selection changes in non-selection filter modes
  useEffect(
    function () {
      if (skipRefreshRef.current) {
        skipRefreshRef.current = false;
        return;
      }
      if (filterMode === "selection") return;
      triggerSearch(searchQuery, filterMode);
    },
    [selectedNodeNames],
  );

  // Close filter popup on click outside
  useEffect(function () {
    function handleClickOutside(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setShowFilterPopup(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return function () {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  function triggerSearch(query: string, filter: FilterMode, offset?: number, all?: boolean) {
    if (filter === "selection") {
      setSearchResults(null);
      setHasMore(false);
      return;
    }
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }
    var trimmed = query.trim();
    if (trimmed.length === 0 && selectedNodeNames.length === 0) {
      setSearchResults(null);
      setHasMore(false);
      return;
    }
    var q = trimmed.length > 0 ? trimmed : "*";
    var off = offset || 0;
    searchTimerRef.current = setTimeout(function () {
      parent.postMessage({ pluginMessage: { type: "search-nodes-ui", query: q, filter: filter, offset: off, limit: all ? 999999 : undefined } }, "*");
    }, 300);
  }

  function loadMore() {
    if (isLoadingMore) return;
    setIsLoadingMore(true);
    var currentCount = searchResults ? searchResults.length : 0;
    triggerSearch(searchQuery, filterMode, currentCount);
  }

  function loadAll() {
    if (isLoadingMore) return;
    setIsLoadingMore(true);
    var currentCount = searchResults ? searchResults.length : 0;
    triggerSearch(searchQuery, filterMode, currentCount, true);
  }

  function handleSearchInput(e: Event) {
    var val = (e.target as HTMLInputElement).value;
    setSearchQuery(val);
    setCheckedIds({});
    triggerSearch(val, filterMode);
  }

  function handleFilterSelect(mode: FilterMode) {
    setFilterMode(mode);
    setShowFilterPopup(false);
    setCheckedIds({});
    if (mode === "selection") {
      setSearchResults(null);
    } else {
      triggerSearch(searchQuery, mode);
    }
  }

  function focusNode(id: string) {
    parent.postMessage({ pluginMessage: { type: "focus-nodes", nodeIds: [id] } }, "*");
  }

  function handleRowClick(node: NodeInfo, index: number) {
    setNavIndex(index);
    suppressRef.current = true;
    focusNode(node.id);
  }

  function handleCopyId(e: Event, id: string) {
    e.stopPropagation();
    var textarea = document.createElement("textarea");
    textarea.value = id;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
    setCopiedId(id);
    setTimeout(function () {
      setCopiedId(null);
    }, 1500);
  }

  function toggleChecked(e: Event, id: string) {
    e.stopPropagation();
    var next = Object.assign({}, checkedIds);
    if (next[id]) {
      delete next[id];
    } else {
      next[id] = true;
      setBarVisible(true);
    }
    setCheckedIds(next);
  }

  function clearChecked() {
    setCheckedIds({});
    setBarVisible(false);
  }

  function clearHistory() {
    setCheckedIds({});
    setNodes([]);
    nodesRef.current = [];
    parent.postMessage({ pluginMessage: { type: "clear-selection-history" } }, "*");
  }

  function toggleSelectAll() {
    var list = getDisplayNodes();
    var count = Object.keys(checkedIds).length;
    var allSelected = count > 0 && count >= list.length;
    if (allSelected) {
      clearChecked();
    } else {
      var all: Record<string, boolean> = {};
      for (var i = 0; i < list.length; i++) {
        all[list[i].id] = true;
      }
      setCheckedIds(all);
      setBarVisible(true);
    }
  }

  function selectCheckedInFigma() {
    var ids = Object.keys(checkedIds);
    if (ids.length > 0) {
      parent.postMessage({ pluginMessage: { type: "execute-command", command: "set_selections", params: { nodeIds: ids } } }, "*");
    }
  }

  function copyCheckedIds() {
    var ids = Object.keys(checkedIds);
    if (ids.length > 0) {
      var textarea = document.createElement("textarea");
      textarea.value = JSON.stringify(ids);
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
  }

  function handlePrev() {
    var list = getDisplayNodes();
    if (list.length === 0) return;
    var prev = navIndex <= 0 ? list.length - 1 : navIndex - 1;
    setNavIndex(prev);
    suppressRef.current = true;
    focusNode(list[prev].id);
  }

  function handleNext() {
    var list = getDisplayNodes();
    if (list.length === 0) return;
    var next = navIndex < 0 ? 0 : (navIndex + 1) % list.length;
    setNavIndex(next);
    suppressRef.current = true;
    focusNode(list[next].id);
  }

  return {
    nodes,
    searchQuery,
    navIndex,
    copiedId,
    hoveredId,
    checkedIds,
    filterMode,
    showFilterPopup,
    selectedNodeNames,
    searchFocused,
    filterRef,
    displayNodes: getDisplayNodes(),
    checkedCount: Object.keys(checkedIds).length,
    barVisible,
    placeholder: getPlaceholder(),
    setShowFilterPopup,
    setHoveredId,
    setSearchFocused,
    handleSearchInput,
    handleFilterSelect,
    handleRowClick,
    handleCopyId,
    toggleChecked,
    clearChecked,
    clearHistory,
    toggleSelectAll,
    copyCheckedIds,
    selectCheckedInFigma,
    handlePrev,
    handleNext,
    hasMore,
    isLoadingMore,
    loadMore,
    loadAll,
  };
}
