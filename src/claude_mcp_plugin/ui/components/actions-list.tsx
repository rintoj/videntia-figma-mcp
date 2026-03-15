import { h } from 'preact'
import { useRef, useEffect } from 'preact/hooks'
import { TerminalIcon } from './icons'
import { ActionItem } from './action-item'
import { ActionEntry } from '../types'

interface ActionsListProps {
  actions: ActionEntry[]
}

var SCROLL_THRESHOLD = 40

export function ActionsList({ actions }: ActionsListProps) {
  var scrollRef = useRef<HTMLDivElement>(null)
  var wasAtBottomRef = useRef(true)

  // Before render: check if scrolled to bottom
  useEffect(function () {
    var el = scrollRef.current
    if (!el) return
    var atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_THRESHOLD
    wasAtBottomRef.current = atBottom
  })

  // After actions change: auto-scroll if was at bottom
  useEffect(
    function () {
      var el = scrollRef.current
      if (!el) return
      if (wasAtBottomRef.current) {
        el.scrollTop = el.scrollHeight
      }
    },
    [actions],
  )

  if (actions.length === 0) {
    return (
      <div class="flex flex-col items-center justify-center gap-2 py-8 px-4 flex-1 bg-card">
        <TerminalIcon color="var(--color-muted-foreground)" size={24} />
        <span class="text-muted-foreground text-sm leading-5">No actions yet</span>
        <span class="text-muted-foreground text-[11px] leading-4 font-medium">Connect to start receiving actions</span>
      </div>
    )
  }

  return (
    <div ref={scrollRef} class="flex-1 overflow-y-auto flex flex-col gap-px min-h-0 py-1 px-2 bg-card scrollbar-thin">
      {actions.map(function (action) {
        return <ActionItem key={action.id} action={action} />
      })}
    </div>
  )
}
