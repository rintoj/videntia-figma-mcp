import { h } from 'preact'
import { useState } from 'preact/hooks'
import { CheckCircleIcon, XCircleIcon, SpinnerIcon, ChevronRightIcon, ChevronDownIcon, CopyIcon, FocusIcon } from './icons'
import { ActionEntry } from '../types'

interface ActionItemProps {
  action: ActionEntry
}

function formatTime(ts: number): string {
  var d = new Date(ts)
  var h = d.getHours()
  var m = d.getMinutes()
  var s = d.getSeconds()
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.substring(0, max) + '...'
}

function copyToClipboard(text: string) {
  try {
    var textarea = document.createElement('textarea')
    textarea.value = text
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
  } catch (err) {
    console.error('Copy failed:', err)
  }
}

export function ActionItem({ action }: ActionItemProps) {
  var [expanded, setExpanded] = useState(false)
  var [hovered, setHovered] = useState(false)

  function getStatusIcon() {
    if (action.status === 'success') return <CheckCircleIcon color="var(--color-success)" />
    if (action.status === 'error') return <XCircleIcon color="var(--color-destructive)" />
    return <SpinnerIcon color="var(--color-success)" />
  }

  function handleFocus(e: Event) {
    e.stopPropagation()
    if (action.nodeIds && action.nodeIds.length > 0) {
      parent.postMessage({ pluginMessage: { type: 'focus-nodes', nodeIds: action.nodeIds } }, '*')
    }
  }

  function handleCopyData(e: Event) {
    e.stopPropagation()
    var data = {
      command: action.command,
      input: action.params,
      output: action.error ? { error: action.error } : action.result,
    }
    copyToClipboard(JSON.stringify(data, null, 2))
  }

  function handleCopyIds(e: Event) {
    e.stopPropagation()
    if (action.nodeIds && action.nodeIds.length > 0) {
      copyToClipboard(JSON.stringify(action.nodeIds))
    }
  }

  var inputStr = action.params ? truncate(JSON.stringify(action.params), 200) : 'none'
  var outputStr = action.error
    ? truncate(action.error, 200)
    : (action.result ? truncate(JSON.stringify(action.result), 200) : 'none')

  var hasNodeIds = action.nodeIds && action.nodeIds.length > 0

  return (
    <div
      class={'rounded-sm relative' + (expanded ? ' bg-card' : '')}
      onMouseEnter={function () { setHovered(true) }}
      onMouseLeave={function () { setHovered(false) }}
    >
      <div class="flex items-center gap-1.5 cursor-pointer rounded-sm py-[7px] pl-2 pr-0.5 transition-colors hover:bg-accent" onClick={function () { setExpanded(!expanded) }}>
        <div class="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
          <span class="flex items-center shrink-0">
            {getStatusIcon()}
          </span>
          <span class="text-foreground text-xs leading-4 font-medium whitespace-nowrap overflow-hidden text-ellipsis">{action.command}</span>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          {hovered && !expanded && (
            <span class="cursor-pointer flex items-center hover:opacity-80" onClick={handleCopyData}>
              <CopyIcon color="var(--color-muted-foreground)" />
            </span>
          )}
          <span class="text-muted-foreground font-mono text-[10px] leading-[14px] whitespace-nowrap">{formatTime(action.timestamp)}</span>
          {expanded
            ? <ChevronDownIcon color="var(--color-muted-foreground)" size={14} />
            : <ChevronRightIcon color="var(--color-muted-foreground)" size={14} />
          }
        </div>
      </div>
      {expanded && (
        <div class="flex flex-col gap-1.5 pb-[7px] pl-2 pr-0.5">
          <div class="flex flex-row justify-end items-center gap-2.5 mt-1">
            {hasNodeIds && (
              <button class="flex items-center gap-1 py-[3px] px-[7px] bg-accent border border-transparent rounded-md text-muted-foreground text-[11px] leading-4 font-medium cursor-pointer transition-colors hover:bg-border hover:text-foreground" onClick={handleFocus}>
                <FocusIcon color="var(--color-muted-foreground)" />
                <span>Focus</span>
              </button>
            )}
            {hasNodeIds && (
              <button class="flex items-center gap-1 py-[3px] px-[7px] bg-secondary border border-transparent rounded-md text-muted-foreground text-[11px] leading-4 font-medium cursor-pointer transition-colors hover:bg-border hover:text-foreground" onClick={handleCopyIds}>
                <CopyIcon color="var(--color-muted-foreground)" />
                <span>Copy Ids</span>
              </button>
            )}
            <button class="flex items-center gap-1 py-[3px] px-[7px] bg-secondary border border-transparent rounded-md text-muted-foreground text-[11px] leading-4 font-medium cursor-pointer transition-colors hover:bg-border hover:text-foreground" onClick={handleCopyData}>
              <CopyIcon color="var(--color-muted-foreground)" />
              <span>Copy Data</span>
            </button>
          </div>
          <div class="bg-popover rounded-md py-2 px-2.5 relative overflow-hidden detail-block-accent flex flex-col gap-1">
            <span class="text-muted-foreground text-[11px] leading-4 font-medium uppercase tracking-[1.5px] block">INPUT</span>
            <pre class="text-muted-foreground font-mono text-[10px] leading-[14px] m-0 whitespace-pre-wrap break-all max-h-[120px] overflow-y-auto">{inputStr}</pre>
          </div>
          <div class={'bg-popover rounded-md py-2 px-2.5 relative overflow-hidden detail-block-accent flex flex-col gap-1' + (action.status === 'success' ? ' detail-block-success' : '') + (action.status === 'error' ? ' detail-block-error' : '')}>
            <span class="text-muted-foreground text-[11px] leading-4 font-medium uppercase tracking-[1.5px] block">OUTPUT</span>
            <pre class={'font-mono text-[10px] leading-[14px] m-0 whitespace-pre-wrap break-all max-h-[120px] overflow-y-auto' + (action.status === 'success' ? ' text-success' : '') + (action.status === 'error' ? ' text-destructive' : ' text-muted-foreground')}>{outputStr}</pre>
          </div>
        </div>
      )}
    </div>
  )
}
