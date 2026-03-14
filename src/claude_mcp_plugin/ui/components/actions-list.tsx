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
      <div class="actions-empty">
        <TerminalIcon color="#555555" size={24} />
        <span class="actions-empty-text">No actions yet</span>
        <span class="actions-empty-hint">Connect to start receiving actions</span>
      </div>
    )
  }

  return (
    <div ref={scrollRef} class="actions-scroll">
      {actions.map(function (action) {
        return <ActionItem key={action.id} action={action} />
      })}
    </div>
  )
}
