import { h } from 'preact'
import { useState, useEffect, useRef } from 'preact/hooks'

export function SelectionSection() {
  var [nodeIds, setNodeIds] = useState('')
  var [navIndex, setNavIndex] = useState(0)
  var inputRef = useRef<HTMLInputElement>(null)

  useEffect(function () {
    function handleMessage(event: MessageEvent) {
      var msg = event.data && event.data.pluginMessage
      if (!msg) return
      if (msg.type === 'selection-changed') {
        var ids = Array.isArray(msg.nodeIds) ? msg.nodeIds.join(',') : ''
        setNodeIds(ids)
        setNavIndex(0)
      }
    }
    window.addEventListener('message', handleMessage)
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

  return (
    <div class="selection-section">
      <div class="selection-row">
        <span class="selection-label">Copy Selected IDs</span>
        <button class="btn-sm" onClick={handleCopyIds}>Copy IDs</button>
      </div>
      <div class="selection-row">
        <span class="selection-label">Focus Navigator</span>
        <div class="nav-buttons">
          <button class="btn-sm" onClick={handlePrev}>← Prev</button>
          <button class="btn-sm" onClick={handleNext}>Next →</button>
        </div>
      </div>
      <div class="selection-input-row">
        <input
          ref={inputRef}
          class="selection-input"
          type="text"
          value={nodeIds}
          placeholder="Select nodes in Figma..."
          onInput={function (e) { setNodeIds((e.target as HTMLInputElement).value) }}
        />
      </div>
    </div>
  )
}
