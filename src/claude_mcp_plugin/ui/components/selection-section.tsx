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
    case 'COMPONENT_SET': return '#9747ff'
    case 'INSTANCE': return '#9747ff'
    default: return '#9ca3af'
  }
}

function TypeIcon(props: { type: string }) {
  var color = getIconColor(props.type)
  var s = 1.083 // stroke base for 13px viewBox
  switch (props.type) {
    case 'PAGE':
      return (
        <svg class="selection-node-type-icon" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <path d="M2.7 1.1h5.2l2.6 2.6v7.6a1.1 1.1 0 01-1.1 1.1H3.8a1.1 1.1 0 01-1.1-1.1V2.2a1.1 1.1 0 011.1-1.1z"/>
          <polyline points="7.9 1.1 7.9 3.7 10.5 3.7"/>
        </svg>
      )
    case 'FRAME':
      return (
        <svg class="selection-node-type-icon" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <line x1="2.2" y1="4.9" x2="10.8" y2="4.9"/>
          <line x1="2.2" y1="8.1" x2="10.8" y2="8.1"/>
          <line x1="4.9" y1="2.2" x2="4.9" y2="10.8"/>
          <line x1="8.1" y1="2.2" x2="8.1" y2="10.8"/>
        </svg>
      )
    case 'SECTION':
      return (
        <svg class="selection-node-type-icon" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <rect x="1.6" y="1.6" width="9.75" height="9.75" rx="1.1"/>
          <line x1="1.6" y1="5.4" x2="11.35" y2="5.4"/>
        </svg>
      )
    case 'GROUP':
      return (
        <svg class="selection-node-type-icon" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <rect x="1.6" y="1.6" width="9.75" height="9.75" rx="1.1" stroke-dasharray="2 1.5"/>
        </svg>
      )
    case 'TEXT':
      return (
        <svg class="selection-node-type-icon" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <polyline points="2.2 2.2 2.2 3.8 10.8 3.8 10.8 2.2"/>
          <line x1="6.5" y1="3.8" x2="6.5" y2="10.8"/>
          <line x1="4.9" y1="10.8" x2="8.1" y2="10.8"/>
        </svg>
      )
    case 'RECTANGLE':
      return (
        <svg class="selection-node-type-icon" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <rect x="1.6" y="1.6" width="9.75" height="9.75" rx="1.1"/>
        </svg>
      )
    case 'ELLIPSE':
      return (
        <svg class="selection-node-type-icon" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <circle cx="6.5" cy="6.5" r="5.4"/>
        </svg>
      )
    case 'LINE':
      return (
        <svg class="selection-node-type-icon" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <line x1="2.7" y1="6.5" x2="10.3" y2="6.5"/>
        </svg>
      )
    case 'VECTOR':
      return (
        <svg class="selection-node-type-icon" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <circle cx="6.5" cy="2.7" r="1.6"/>
          <path d="M6.5 4.3L2.2 10.8h8.6z"/>
          <circle cx="10.3" cy="6.5" r="1.1"/>
        </svg>
      )
    case 'COMPONENT':
      return (
        <svg class="selection-node-type-icon" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <path d="M3.25 1.1L5.4 3.25 3.25 5.4 1.1 3.25z"/>
          <path d="M9.75 1.1L11.9 3.25 9.75 5.4 7.6 3.25z"/>
          <path d="M3.25 7.6L5.4 9.75 3.25 11.9 1.1 9.75z"/>
          <path d="M9.75 7.6L11.9 9.75 9.75 11.9 7.6 9.75z"/>
        </svg>
      )
    case 'COMPONENT_SET':
      return (
        <svg class="selection-node-type-icon" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <path d="M3.25 1.1L5.4 3.25 3.25 5.4 1.1 3.25z"/>
          <path d="M9.75 1.1L11.9 3.25 9.75 5.4 7.6 3.25z"/>
          <path d="M3.25 7.6L5.4 9.75 3.25 11.9 1.1 9.75z"/>
          <path d="M9.75 7.6L11.9 9.75 9.75 11.9 7.6 9.75z"/>
        </svg>
      )
    case 'INSTANCE':
      return (
        <svg class="selection-node-type-icon" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <path d="M6.5 1.1L11.9 6.5 6.5 11.9 1.1 6.5z"/>
        </svg>
      )
    case 'POLYGON':
      return (
        <svg class="selection-node-type-icon" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <path d="M6.5 1.6L11.4 10.8H1.6z"/>
        </svg>
      )
    case 'STAR':
      return (
        <svg class="selection-node-type-icon" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <path d="M6.5 1.1l1.7 3.4 3.7.5-2.7 2.6.6 3.7-3.3-1.7-3.3 1.7.6-3.7L1.1 5l3.7-.5z"/>
        </svg>
      )
    case 'BOOLEAN_OPERATION':
      return (
        <svg class="selection-node-type-icon" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <path d="M4.3 2.7c0 1.5.6 2.7 2.2 3.8"/>
          <path d="M8.7 2.7c0 1.5-.6 2.7-2.2 3.8"/>
          <path d="M6.5 6.5v4.3"/>
          <circle cx="6.5" cy="11.4" r="1.4"/>
        </svg>
      )
    case 'SLICE':
      return (
        <svg class="selection-node-type-icon" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <circle cx="4.3" cy="4.3" r="1.6"/>
          <circle cx="4.3" cy="9.75" r="1.6"/>
          <line x1="5.7" y1="3.5" x2="11.4" y2="1.1"/>
          <line x1="5.7" y1="10.5" x2="11.4" y2="8.1"/>
        </svg>
      )
    case 'IMAGE':
      return (
        <svg class="selection-node-type-icon" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
          <rect x="1.6" y="1.6" width="9.75" height="9.75" rx="1.1"/>
          <circle cx="4.6" cy="4.6" r="1.1"/>
          <polyline points="11.35 8.1 8.7 5.4 1.6 11.35"/>
        </svg>
      )
    default:
      return (
        <svg class="selection-node-type-icon" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={color} stroke-width={s} stroke-linecap="round" stroke-linejoin="round">
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
          // Only skip if already at the top
          if (newList.length > 0 && newList[0].id === item.id) continue
          newList.unshift(item)
        }
        nodesRef.current = newList
        setNodes(newList)
        setNavIndex(-1)
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
    <div class="selection-section">
      <div class="selection-search-row">
        <div class="selection-search-wrap">
          <svg class="selection-search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#737373" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <path d="M21 21l-4.35-4.35"/>
          </svg>
          <input
            type="text"
            class="selection-search-input"
            placeholder="Search by name or type..."
            value={searchQuery}
            onInput={handleSearchInput}
          />
        </div>
        <div class="selection-nav-buttons">
          <button class="selection-nav-btn" onClick={handlePrev} title="Previous">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 12H5"/>
              <path d="M12 19l-7-7 7-7"/>
            </svg>
          </button>
          <button class="selection-nav-btn" onClick={handleNext} title="Next">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 12h14"/>
              <path d="M12 5l7 7-7 7"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="selection-node-list">
        {displayNodes.length === 0 && (
          <div class="selection-empty">
            <span class="selection-empty-text">
              {searchQuery.length > 0 ? 'No results found' : 'Select nodes in Figma'}
            </span>
          </div>
        )}
        {displayNodes.map(function (node, i) {
          var isHovered = hoveredId === node.id
          var isActive = navIndex === i
          return (
            <div
              key={node.id + '-' + i}
              class={'selection-node-row' + (isActive ? ' selection-node-active' : '')}
              onClick={function () { handleRowClick(node, i) }}
              onMouseEnter={function () { setHoveredId(node.id) }}
              onMouseLeave={function () { setHoveredId(null) }}
            >
              <TypeIcon type={node.type} />
              <div class="selection-node-info">
                <span class="selection-node-name">{node.name}</span>
                <span class="selection-node-id">{node.id}</span>
                {node.type !== 'PAGE' && node.pageName ? (
                  <span class="selection-node-page">{node.pageName}</span>
                ) : null}
              </div>
              {(isHovered || isActive || copiedId === node.id) ? (
                <button
                  class="selection-copy-btn"
                  onClick={function (e: Event) { handleCopyId(e, node.id) }}
                  title="Copy node ID"
                >
                  {copiedId === node.id ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4db04f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#808080" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                      <rect x="9" y="9" width="11" height="11" rx="2"/>
                      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                    </svg>
                  )}
                </button>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
