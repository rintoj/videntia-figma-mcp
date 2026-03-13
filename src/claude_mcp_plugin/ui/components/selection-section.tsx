import { h } from 'preact'
import { useState, useEffect, useRef } from 'preact/hooks'

export function SelectionSection() {
  var [nodeIds, setNodeIds] = useState('')
  var [navIndex, setNavIndex] = useState(0)
  var [tracking, setTracking] = useState(true)
  var inputRef = useRef<HTMLInputElement>(null)

  useEffect(function () {
    function handleMessage(event: MessageEvent) {
      var msg = event.data && event.data.pluginMessage
      if (!msg) return
      if (msg.type === 'selection-changed') {
        setTracking(function (isTracking) {
          if (isTracking) {
            var ids = Array.isArray(msg.nodeIds) ? msg.nodeIds.join(',') : ''
            setNodeIds(ids)
            setNavIndex(0)
          }
          return isTracking
        })
      }
    }
    window.addEventListener('message', handleMessage)
    parent.postMessage({ pluginMessage: { type: 'get-selection' } }, '*')
    return function () { window.removeEventListener('message', handleMessage) }
  }, [])

  function getIds(): string[] {
    return nodeIds.split(',').map(function (s) { return s.trim() }).filter(function (s) { return s.length > 0 })
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
    var next = (navIndex - 1 + ids.length) % ids.length
    setNavIndex(next)
    focusNode(ids[next])
  }

  function handleNext() {
    var ids = getIds()
    if (ids.length === 0) return
    var next = (navIndex + 1) % ids.length
    setNavIndex(next)
    focusNode(ids[next])
  }

  function handleManualEdit(e: Event) {
    setTracking(false)
    setNodeIds((e.target as HTMLTextAreaElement).value)
  }

  return (
    <div class="selection-section">
      <div class="selection-row">
        <div class="selection-row-left">
          <button
            class={'track-btn' + (tracking ? ' track-btn-on' : '')}
            title={tracking ? 'Tracking on — click to freeze' : 'Tracking off — click to resume'}
            onClick={function () { setTracking(function (v) { return !v }) }}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <circle cx="6.5" cy="6.5" r="2" stroke="currentColor" stroke-width="1.1"/>
              <path d="M6.5 1v1.2M6.5 10.8V12M1 6.5h1.2M10.8 6.5H12M2.7 2.7l.85.85M9.45 9.45l.85.85M2.7 10.3l.85-.85M9.45 3.55l.85-.85" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
            </svg>
            <span>Track</span>
          </button>
          <span class="selection-label">Focus</span>
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
