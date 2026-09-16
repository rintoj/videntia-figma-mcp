import { h } from "preact";
import { useRef, useEffect, useState } from "preact/hooks";
import { TerminalIcon, ChevronDownIcon } from "./icons";
import { ActionItem } from "./action-item";
import { ActionEntry } from "../types";
import { SCROLL_THRESHOLD, isAtBottom, shouldStickToBottom } from "../scroll-utils";

interface ActionsListProps {
  actions: ActionEntry[];
}

export function ActionsList({ actions }: ActionsListProps) {
  var scrollRef = useRef<HTMLDivElement>(null);
  var wasAtBottomRef = useRef(true);
  var [showJump, setShowJump] = useState(false);
  var [unread, setUnread] = useState(0);

  // Before render: check if scrolled to bottom
  useEffect(function () {
    var el = scrollRef.current;
    if (!el) return;
    wasAtBottomRef.current = isAtBottom(el.scrollTop, el.scrollHeight, el.clientHeight, SCROLL_THRESHOLD);
  });

  // After actions change: auto-scroll if was at bottom, else count as unread
  useEffect(
    function () {
      var el = scrollRef.current;
      if (!el) return;
      if (wasAtBottomRef.current) {
        el.scrollTop = el.scrollHeight;
        setShowJump(false);
        setUnread(0);
      } else {
        setShowJump(true);
        setUnread(function (n) {
          return n + 1;
        });
      }
    },
    [actions],
  );

  function handleScroll() {
    var el = scrollRef.current;
    if (!el) return;
    var atBottom = isAtBottom(el.scrollTop, el.scrollHeight, el.clientHeight, SCROLL_THRESHOLD);
    setShowJump(!atBottom);
    if (atBottom) setUnread(0);
  }

  function scrollToBottom() {
    var el = scrollRef.current;
    if (!el) return;
    var reduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      el.scrollTop = el.scrollHeight;
    } else {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
    setShowJump(false);
    setUnread(0);
  }

  if (actions.length === 0) {
    return (
      <div class="flex flex-col items-center justify-center gap-2 py-8 px-4 flex-1 bg-card">
        <TerminalIcon color="var(--color-muted-foreground)" size={24} />
        <span class="text-muted-foreground text-sm leading-5">No actions yet</span>
        <span class="text-muted-foreground text-[11px] leading-4 font-medium">Connect to start receiving actions</span>
      </div>
    );
  }

  return (
    <div class="relative flex-1 min-h-0 flex flex-col">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        class="flex-1 overflow-y-auto flex flex-col gap-px min-h-0 py-1 px-2 bg-card scrollbar-thin"
      >
        {actions.map(function (action) {
          return <ActionItem key={action.id} action={action} />;
        })}
      </div>
      <button
        type="button"
        aria-label={unread > 0 ? "Scroll to latest, " + unread + " new" : "Scroll to latest"}
        aria-hidden={showJump ? undefined : "true"}
        tabIndex={showJump ? 0 : -1}
        onClick={scrollToBottom}
        class="absolute right-3 bottom-3 w-9 h-9 rounded-full flex items-center justify-center border border-border bg-popover text-foreground bg-primary-muted-hover cursor-pointer"
        style={{
          opacity: showJump ? 1 : 0,
          transform: showJump ? "translateY(0)" : "translateY(6px)",
          pointerEvents: showJump ? "auto" : "none",
          transition: "opacity 0.15s ease, transform 0.15s ease, background-color 0.15s ease",
          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.35)",
        }}
      >
        <ChevronDownIcon color="var(--color-foreground)" size={14} />
        {unread > 0 && (
          <span
            class="absolute -top-0.5 -right-0.5 min-w-3.5 h-3.5 px-1 rounded-full bg-success text-success-foreground text-[9px] leading-none font-semibold flex items-center justify-center"
            aria-hidden="true"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
    </div>
  );
}
