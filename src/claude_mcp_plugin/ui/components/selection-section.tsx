import { h } from 'preact'
import { useState, useEffect, useRef } from 'preact/hooks'

export function SelectionSection() {
  var [nodeIds, setNodeIds] = useState('')
  var [navIndex, setNavIndex] = useState(-1)
  var [tracking, setTracking] = useState(true)
  var trackingRef = useRef(true)
  var inputRef = useRef<HTMLInputElement>(null)

  function setTrackingValue(val: boolean) {
    trackingRef.current = val
    setTracking(val)
  }

  useEffect(function () {
    function handleMessage(event: MessageEvent) {
      var msg = event.data && event.data.pluginMessage
      if (!msg) return
      if (msg.type === 'selection-changed' && trackingRef.current) {
        var ids = Array.isArray(msg.nodeIds) ? msg.nodeIds.join(',') : ''
        setNodeIds(ids)
        setNavIndex(-1)
      }
    }
    window.addEventListener('message', handleMessage)
    parent.postMessage({ pluginMessage: { type: 'get-selection' } }, '*')
    return function () { window.removeEventListener('message', handleMessage) }
  }, [])

  function getIds(): string[] {
    var val = inputRef.current ? (inputRef.current as any).value : nodeIds
    return val.split(',').map(function (s: string) { return s.trim() }).filter(function (s: string) { return s.length > 0 })
  }

  function handleCopyIds() {
    var ids = getIds()
    if (ids.length === 0) return
    try {
      var textarea = document.createElement('textarea')
      textarea.value = ids.join(',')
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    } catch (err) {
      console.error('Copy failed:', err)
    }
  }

  function focusNode(id: string) {
    parent.postMessage({ pluginMessage: { type: 'focus-nodes', nodeIds: [id] } }, '*')
  }

  function handlePrev() {
    var ids = getIds()
    if (ids.length === 0) return
    setTrackingValue(false)
    var prev = navIndex <= 0 ? ids.length - 1 : navIndex - 1
    setNavIndex(prev)
    focusNode(ids[prev])
  }

  function handleNext() {
    var ids = getIds()
    if (ids.length === 0) return
    setTrackingValue(false)
    var next = navIndex < 0 ? 0 : (navIndex + 1) % ids.length
    setNavIndex(next)
    focusNode(ids[next])
  }

  function handleManualEdit(e: Event) {
    setTrackingValue(false)
    setNodeIds((e.target as HTMLTextAreaElement).value)
  }

  return (
    <div class="selection-section">
      <div class="selection-row">
        <div class="selection-row-left">
          <button
            class={'sync-btn' + (tracking ? ' sync-btn-on' : '')}
            title={tracking ? 'Tracking on — click to freeze' : 'Tracking off — click to resume'}
            onClick={function () { setTrackingValue(!trackingRef.current) }}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M11 6.5a4.5 4.5 0 0 1-7.5 3.35" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
              <path d="M2 6.5a4.5 4.5 0 0 1 7.5-3.35" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
              <path d="M9.5 2.5l.5 1.2-1.2.3" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M3.5 10.5l-.5-1.2 1.2-.3" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>Sync</span>
          </button>
        </div>
        <div class="nav-buttons">
          <button class="btn-sm" onClick={handlePrev}>← Prev</button>
          <button class="btn-sm" onClick={handleNext}>Next →</button>
        </div>
      </div>
      <div class="selection-input-row">
        <div class="selection-input-wrap">
          <textarea
            ref={inputRef as any}
            class="selection-input"
            value={nodeIds}
            placeholder="Select nodes in Figma..."
            onInput={handleManualEdit}
          />
          <button class="selection-copy-btn" onClick={handleCopyIds}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4db04f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            <span>Copy</span>
          </button>
        </div>
      </div>
    </div>
  )
}
