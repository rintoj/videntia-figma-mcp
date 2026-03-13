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
    if (action.status === 'success') return <CheckCircleIcon color="#4caf50" />
    if (action.status === 'error') return <XCircleIcon color="#ef4444" />
    return <SpinnerIcon color="#66b3ff" />
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
      class={'action-item' + (hovered ? ' hovered' : '')}
      onMouseEnter={function () { setHovered(true) }}
      onMouseLeave={function () { setHovered(false) }}
      onClick={function () { setExpanded(!expanded) }}
    >
      <div class="action-item-row">
        <div class="action-item-left">
          <span class="action-status-icon">
            {getStatusIcon()}
          </span>
          <span class="action-item-name">{action.command}</span>
        </div>
        <div class="action-item-right">
          {hovered && !expanded && (
            <span class="action-copy-btn" onClick={handleCopyData}>
              <CopyIcon color="#808080" />
            </span>
          )}
          <span class="action-item-time">{formatTime(action.timestamp)}</span>
          {expanded
            ? <ChevronDownIcon color="#808080" size={10} />
            : <ChevronRightIcon color="#808080" size={10} />
          }
        </div>
      </div>
      {expanded && (
        <div class="action-detail">
          <div class="action-detail-buttons">
            {hasNodeIds && (
              <button class="action-detail-btn" onClick={handleFocus}>
                <FocusIcon color="#808080" />
                <span>Focus</span>
              </button>
            )}
            {hasNodeIds && (
              <button class="action-detail-btn" onClick={handleCopyIds}>
                <CopyIcon color="#808080" />
                <span>Copy Ids</span>
              </button>
            )}
            <button class="action-detail-btn" onClick={handleCopyData}>
              <CopyIcon color="#808080" />
              <span>Copy Data</span>
            </button>
          </div>
          <div class="action-detail-block">
            <span class="action-detail-label">INPUT</span>
            <pre class="action-detail-content">{inputStr}</pre>
          </div>
          <div class="action-detail-block">
            <span class="action-detail-label">OUTPUT</span>
            <pre class={'action-detail-content' + (action.status === 'success' ? ' success' : '') + (action.status === 'error' ? ' error' : '')}>{outputStr}</pre>
          </div>
        </div>
      )}
    </div>
  )
}
