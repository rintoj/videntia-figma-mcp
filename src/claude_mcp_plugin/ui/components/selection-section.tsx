import { h } from 'preact'
import { useState, useEffect, useRef } from 'preact/hooks'

interface NodeInfo {
  id: string
  name: string
  type: string
  pageName: string
}

function getIconColor(type: string): string {
  switch (type) {
    case 'COMPONENT': return '#0fa958'
    case 'COMPONENT_SET': return '#9ca3af'
    case 'INSTANCE': return '#9ca3af'
    default: return '#9ca3af'
  }
}

function TypeIcon(props: { type: string }) {
  var color = getIconColor(props.type)
  var s = 1.083 // stroke base for 13px viewBox
  switch (props.type) {
    case 'PAGE':
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <path d="M2.7 1.1h5.2l2.6 2.6v7.6a1.1 1.1 0 01-1.1 1.1H3.8a1.1 1.1 0 01-1.1-1.1V2.2a1.1 1.1 0 011.1-1.1z"/>
          <polyline points="7.9 1.1 7.9 3.7 10.5 3.7"/>
        </svg>
      )
    case 'FRAME':
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <line x1="2.2" y1="4.9" x2="10.8" y2="4.9"/>
          <line x1="2.2" y1="8.1" x2="10.8" y2="8.1"/>
          <line x1="4.9" y1="2.2" x2="4.9" y2="10.8"/>
          <line x1="8.1" y1="2.2" x2="8.1" y2="10.8"/>
        </svg>
      )
    case 'SECTION':
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <rect x="1.6" y="1.6" width="9.75" height="9.75" rx="1.1"/>
          <line x1="1.6" y1="5.4" x2="11.35" y2="5.4"/>
        </svg>
      )
    case 'GROUP':
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <rect x="1.6" y="1.6" width="9.75" height="9.75" rx="1.1" stroke-dasharray="2 1.5"/>
        </svg>
      )
    case 'TEXT':
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <polyline points="2.2 2.2 2.2 3.8 10.8 3.8 10.8 2.2"/>
          <line x1="6.5" y1="3.8" x2="6.5" y2="10.8"/>
          <line x1="4.9" y1="10.8" x2="8.1" y2="10.8"/>
        </svg>
      )
    case 'RECTANGLE':
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <rect x="1.6" y="1.6" width="9.75" height="9.75" rx="1.1"/>
        </svg>
      )
    case 'ELLIPSE':
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <circle cx="6.5" cy="6.5" r="5.4"/>
        </svg>
      )
    case 'LINE':
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <line x1="2.7" y1="6.5" x2="10.3" y2="6.5"/>
        </svg>
      )
    case 'VECTOR':
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <circle cx="6.5" cy="2.7" r="1.6"/>
          <path d="M6.5 4.3L2.2 10.8h8.6z"/>
          <circle cx="10.3" cy="6.5" r="1.1"/>
        </svg>
      )
    case 'COMPONENT':
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <path d="M3.25 1.1L5.4 3.25 3.25 5.4 1.1 3.25z"/>
          <path d="M9.75 1.1L11.9 3.25 9.75 5.4 7.6 3.25z"/>
          <path d="M3.25 7.6L5.4 9.75 3.25 11.9 1.1 9.75z"/>
          <path d="M9.75 7.6L11.9 9.75 9.75 11.9 7.6 9.75z"/>
        </svg>
      )
    case 'COMPONENT_SET':
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <path d="M3.25 1.1L5.4 3.25 3.25 5.4 1.1 3.25z"/>
          <path d="M9.75 1.1L11.9 3.25 9.75 5.4 7.6 3.25z"/>
          <path d="M3.25 7.6L5.4 9.75 3.25 11.9 1.1 9.75z"/>
          <path d="M9.75 7.6L11.9 9.75 9.75 11.9 7.6 9.75z"/>
        </svg>
      )
    case 'INSTANCE':
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <path d="M6.5 1.1L11.9 6.5 6.5 11.9 1.1 6.5z"/>
        </svg>
      )
    case 'POLYGON':
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <path d="M6.5 1.6L11.4 10.8H1.6z"/>
        </svg>
      )
    case 'STAR':
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <path d="M6.5 1.1l1.7 3.4 3.7.5-2.7 2.6.6 3.7-3.3-1.7-3.3 1.7.6-3.7L1.1 5l3.7-.5z"/>
        </svg>
      )
    case 'BOOLEAN_OPERATION':
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <path d="M4.3 2.7c0 1.5.6 2.7 2.2 3.8"/>
          <path d="M8.7 2.7c0 1.5-.6 2.7-2.2 3.8"/>
          <path d="M6.5 6.5v4.3"/>
          <circle cx="6.5" cy="11.4" r="1.4"/>
        </svg>
      )
    case 'SLICE':
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <circle cx="4.3" cy="4.3" r="1.6"/>
          <circle cx="4.3" cy="9.75" r="1.6"/>
          <line x1="5.7" y1="3.5" x2="11.4" y2="1.1"/>
          <line x1="5.7" y1="10.5" x2="11.4" y2="8.1"/>
        </svg>
      )
    case 'IMAGE':
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <rect x="1.6" y="1.6" width="9.75" height="9.75" rx="1.1"/>
          <circle cx="4.6" cy="4.6" r="1.1"/>
          <polyline points="11.35 8.1 8.7 5.4 1.6 11.35"/>
        </svg>
      )
    default:
      return (
        <svg class="shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <rect x="1.6" y="1.6" width="9.75" height="9.75" rx="1.1"/>
        </svg>
      )
  }
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

export function SelectionSection() {
  var [nodes, setNodes] = useState<NodeInfo[]>([])
  var [searchQuery, setSearchQuery] = useState('')
  var [searchResults, setSearchResults] = useState<NodeInfo[] | null>(null)
  var [navIndex, setNavIndex] = useState(-1)
  var [copiedId, setCopiedId] = useState<string | null>(null)
  var [hoveredId, setHoveredId] = useState<string | null>(null)
  var [checkedIds, setCheckedIds] = useState<Record<string, boolean>>({})
  var searchTimerRef = useRef<any>(null)
  var nodesRef = useRef<NodeInfo[]>([])
  var suppressRef = useRef(false)

  useEffect(function () {
    function handleMessage(event: MessageEvent) {
      var msg = event.data && event.data.pluginMessage
      if (!msg) return
      if (msg.type === 'selection-changed') {
        if (suppressRef.current) {
          suppressRef.current = false
          return
        }
        var incoming = Array.isArray(msg.nodes) ? msg.nodes as NodeInfo[] : []
        var current = nodesRef.current
        var newList = current.slice()
        for (var i = incoming.length - 1; i >= 0; i--) {
          var item = incoming[i]
          if (newList.length > 0 && newList[0].id === item.id) continue
          newList.unshift(item)
        }
        nodesRef.current = newList
        setNodes(newList)
        setNavIndex(-1)
        var autoChecked: Record<string, boolean> = {}
        for (var j = 0; j < incoming.length; j++) {
          autoChecked[incoming[j].id] = true
        }
        setCheckedIds(autoChecked)
      }
      if (msg.type === 'search-results') {
        setSearchResults(Array.isArray(msg.nodes) ? msg.nodes : [])
      }
    }
    window.addEventListener('message', handleMessage)
    parent.postMessage({ pluginMessage: { type: 'get-selection' } }, '*')
    return function () { window.removeEventListener('message', handleMessage) }
  }, [])

  function getDisplayNodes(): NodeInfo[] {
    if (searchQuery.length > 0 && searchResults !== null) {
      return searchResults
    }
    return nodes
  }

  function handleSearchInput(e: Event) {
    var val = (e.target as HTMLInputElement).value
    setSearchQuery(val)
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current)
    }
    if (val.trim().length === 0) {
      setSearchResults(null)
      return
    }
    searchTimerRef.current = setTimeout(function () {
      parent.postMessage({ pluginMessage: { type: 'search-nodes-ui', query: val.trim() } }, '*')
    }, 300)
  }

  function addToHistory(node: NodeInfo) {
    var current = nodesRef.current
    if (current.length > 0 && current[0].id === node.id) return
    var newList = [node].concat(current)
    nodesRef.current = newList
    setNodes(newList)
  }

  function focusNode(id: string) {
    parent.postMessage({ pluginMessage: { type: 'focus-nodes', nodeIds: [id] } }, '*')
  }

  function focusAndTrack(node: NodeInfo) {
    suppressRef.current = true
    focusNode(node.id)
    addToHistory(node)
  }

  function handleRowClick(node: NodeInfo, index: number) {
    setNavIndex(index)
    suppressRef.current = true
    focusNode(node.id)
  }

  function handleCopyId(e: Event, id: string) {
    e.stopPropagation()
    copyToClipboard(id)
    setCopiedId(id)
    setTimeout(function () { setCopiedId(null) }, 1500)
  }

  function toggleChecked(e: Event, id: string) {
    e.stopPropagation()
    var next = Object.assign({}, checkedIds)
    if (next[id]) {
      delete next[id]
      var filtered = nodesRef.current.filter(function (n) { return n.id !== id })
      nodesRef.current = filtered
      setNodes(filtered)
    } else {
      next[id] = true
    }
    setCheckedIds(next)
  }

  function clearChecked() {
    var ids = checkedIds
    var filtered = nodesRef.current.filter(function (n) { return !ids[n.id] })
    nodesRef.current = filtered
    setNodes(filtered)
    setCheckedIds({})
  }

  function copyCheckedIds() {
    var ids = Object.keys(checkedIds)
    if (ids.length > 0) {
      copyToClipboard(JSON.stringify(ids))
    }
  }

  var checkedCount = Object.keys(checkedIds).length

  function handlePrev() {
    var list = getDisplayNodes()
    if (list.length === 0) return
    var prev = navIndex <= 0 ? list.length - 1 : navIndex - 1
    setNavIndex(prev)
    suppressRef.current = true
    focusNode(list[prev].id)
  }

  function handleNext() {
    var list = getDisplayNodes()
    if (list.length === 0) return
    var next = navIndex < 0 ? 0 : (navIndex + 1) % list.length
    setNavIndex(next)
    suppressRef.current = true
    focusNode(list[next].id)
  }

  var displayNodes = getDisplayNodes()

  return (
    <div class="flex flex-col bg-card flex-1 min-h-0">
      <div class="flex items-center gap-2 px-3 pt-3 pb-2 shrink-0 bg-muted">
        <div class="relative flex-1 min-w-0">
          <svg class="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--color-muted-foreground)' }} stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <path d="M21 21l-4.35-4.35"/>
          </svg>
          <input
            type="text"
            class="w-full bg-muted border border-border focus:border-ring rounded-md pl-8 pr-3 py-2.5 text-foreground text-[11px] outline-none h-[30px]"
            placeholder="Search by name or type..."
            value={searchQuery}
            onInput={handleSearchInput}
          />
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button class="flex items-center justify-center h-[30px] px-3 py-2.5 bg-muted border border-border rounded-md text-muted-foreground text-xs font-medium cursor-pointer transition-colors hover:bg-input" onClick={handlePrev} title="Previous">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--color-muted-foreground)' }} stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
          </button>
          <button class="flex items-center justify-center h-[30px] px-3 py-2.5 bg-muted border border-border rounded-md text-muted-foreground text-xs font-medium cursor-pointer transition-colors hover:bg-input" onClick={handleNext} title="Next">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--color-muted-foreground)' }} stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
          </button>
        </div>
      </div>
      <div class="flex-1 overflow-y-auto min-h-0 px-2 scrollbar-thin">
        {displayNodes.length === 0 && (
          <div class="flex items-center justify-center py-8 px-4 flex-1">
            <span class="text-muted-foreground text-[13px] font-medium">
              {searchQuery.length > 0 ? 'No results found' : 'Select nodes in Figma'}
            </span>
          </div>
        )}
        {displayNodes.map(function (node, i) {
          var isHovered = hoveredId === node.id
          var isActive = navIndex === i
          var isChecked = !!checkedIds[node.id]
          return (
            <div
              key={node.id + '-' + i}
              class={'flex items-center gap-1.5 h-[30px] px-1.5 pl-2.5 cursor-pointer transition-colors border-l-2 border-transparent relative' + (isChecked && isActive ? ' border-l-success bg-card rounded-sm' : isChecked ? ' border-l-success bg-accent rounded-sm' : isActive ? ' bg-card rounded-sm' : '')}
              onClick={function () { handleRowClick(node, i) }}
              onMouseEnter={function () { setHoveredId(node.id) }}
              onMouseLeave={function () { setHoveredId(null) }}
            >
              <TypeIcon type={node.type} />
              <div class="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
                <span class="text-foreground text-[11px] whitespace-nowrap overflow-hidden text-ellipsis shrink min-w-0">{node.name}</span>
                <span class="text-muted-foreground text-[10px] whitespace-nowrap shrink-0" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{node.id}</span>
                {node.type !== 'PAGE' && node.pageName ? (
                  <span class="text-muted-foreground text-[11px] whitespace-nowrap shrink-0">{node.pageName}</span>
                ) : null}
              </div>
              {(isHovered || copiedId === node.id) ? (
                <button
                  class="flex items-center justify-center w-6 h-6 bg-transparent border-none rounded cursor-pointer shrink-0 transition-colors hover:bg-input"
                  onClick={function (e: Event) { handleCopyId(e, node.id) }}
                  title="Copy node ID"
                >
                  {copiedId === node.id ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--color-primary)' }} stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ stroke: 'var(--color-muted-foreground)' }} stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                      <rect x="9" y="9" width="11" height="11" rx="2"/>
                      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                    </svg>
                  )}
                </button>
              ) : null}
              <button
                class="flex items-center justify-center w-6 h-6 bg-transparent border-none cursor-pointer shrink-0 p-0"
                onClick={function (e: Event) { toggleChecked(e, node.id) }}
                title={isChecked ? 'Deselect' : 'Select'}
              >
                {isChecked ? (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <rect x="1" y="1" width="14" height="14" rx="3" style={{ fill: 'var(--color-success)' }}/>
                    <polyline points="4.5 8 7 10.5 11.5 5.5" style={{ stroke: 'var(--color-primary-foreground)' }} stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <rect x="1.5" y="1.5" width="13" height="13" rx="2.5" style={{ stroke: 'var(--color-border)' }} stroke-width="1"/>
                  </svg>
                )}
              </button>
            </div>
          )
        })}
      </div>
      {checkedCount > 0 && <div class="h-px bg-muted shrink-0" />}
      {checkedCount > 0 && (
        <div class="flex items-center justify-between py-2 px-3 bg-muted shrink-0">
          <div class="flex items-center gap-1.5">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="1" width="14" height="14" rx="3" style={{ fill: 'var(--color-success)' }}/>
              <polyline points="4.5 8 7 10.5 11.5 5.5" style={{ stroke: 'var(--color-primary-foreground)' }} stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
            </svg>
            <span class="text-success text-[11px] font-medium">{checkedCount + ' selected'}</span>
          </div>
          <div class="flex items-center gap-2">
            <button class="bg-primary border border-solid border-primary text-primary-foreground rounded-md py-1 px-2 text-[11px] font-medium cursor-pointer transition-colors hover:opacity-90" onClick={copyCheckedIds}>Copy IDs</button>
            <button class="bg-muted border border-border rounded-md text-muted-foreground text-[11px] font-medium cursor-pointer py-1 px-2 hover:bg-input" onClick={clearChecked}>Clear</button>
          </div>
        </div>
      )}
    </div>
  )
}
