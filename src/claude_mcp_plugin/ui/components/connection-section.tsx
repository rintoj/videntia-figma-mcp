import { h } from 'preact'
import { useState, useRef, useEffect } from 'preact/hooks'
import { SignalIcon } from './icons'

interface ConnectionSectionProps {
  port: number
  connected: boolean
  channelName: string
  buttonDisabled: boolean
  onConnect: (port: number) => void
  onDisconnect: () => void
  onPortChange: (port: number) => void
}

export function ConnectionSection({ port, connected, channelName, buttonDisabled, onConnect, onDisconnect, onPortChange }: ConnectionSectionProps) {
  var [editing, setEditing] = useState(false)
  var [editPort, setEditPort] = useState(String(port))
  var inputRef = useRef<HTMLInputElement>(null)

  useEffect(function () {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  function handlePortClick() {
    if (!connected) {
      setEditPort(String(port))
      setEditing(true)
    }
  }

  function handleEditorConnect() {
    var parsed = parseInt(editPort, 10)
    var valid = (parsed >= 1024 && parsed <= 65535) ? parsed : 3055
    onPortChange(valid)
    setEditing(false)
    onConnect(valid)
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      handleEditorConnect()
    } else if (e.key === 'Escape') {
      setEditing(false)
    }
  }

  if (editing) {
    return (
      <div class="connection-editor">
        <span class="connection-editor-label">PORT</span>
        <input
          ref={inputRef}
          type="number"
          value={editPort}
          min={1024}
          max={65535}
          onInput={function (e) { setEditPort((e.target as HTMLInputElement).value) }}
          onKeyDown={handleKeyDown}
        />
        <button class="btn-connect" onClick={handleEditorConnect}>Connect</button>
      </div>
    )
  }

  if (connected) {
    return (
      <div class="connection-bar">
        <div class="connection-bar-left">
          <SignalIcon color="#4caf50" size={16} />
          <span class="connection-bar-channel">{channelName || 'Connected'}</span>
          <span class="connection-bar-port-static">:{port}</span>
        </div>
        <button class="btn-disconnect" disabled={buttonDisabled} onClick={onDisconnect}>Disconnect</button>
      </div>
    )
  }

  return (
    <div class="connection-bar">
      <div class="connection-bar-left">
        <SignalIcon color="#808080" size={16} />
        <span class="connection-bar-disconnected">Disconnected</span>
        <span class="connection-bar-port" onClick={handlePortClick}>:{port}</span>
      </div>
      <button class="btn-connect" disabled={buttonDisabled} onClick={function () { onConnect(port) }}>Connect</button>
    </div>
  )
}
