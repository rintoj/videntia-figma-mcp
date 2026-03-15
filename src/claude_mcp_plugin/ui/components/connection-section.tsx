import { h } from 'preact'
import { useState, useRef, useEffect } from 'preact/hooks'
import { SignalIcon, LockIcon, UnplugIcon, PlugZapIcon } from './icons'

interface ConnectionSectionProps {
  port: number
  connected: boolean
  channelName: string
  buttonDisabled: boolean
  readOnly: boolean
  onConnect: (port: number) => void
  onDisconnect: () => void
  onPortChange: (port: number) => void
}

export function ConnectionSection({ port, connected, channelName, buttonDisabled, readOnly, onConnect, onDisconnect, onPortChange }: ConnectionSectionProps) {
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
      <div class="flex flex-col gap-2 p-3 bg-muted border border-border rounded-[10px]">
        <span class="text-muted-foreground text-[11px] font-medium leading-4 uppercase tracking-wide">PORT</span>
        <input
          ref={inputRef}
          type="number"
          value={editPort}
          min={1024}
          max={65535}
          onInput={function (e) { setEditPort((e.target as HTMLInputElement).value) }}
          onKeyDown={handleKeyDown}
          class="border-2 border-border rounded-md py-2 px-2.5 text-sm bg-secondary text-foreground outline-none w-full focus:border-primary"
        />
        <button class="w-full py-2 text-xs leading-4 bg-primary border border-solid border-primary text-primary-foreground rounded-md cursor-pointer font-medium transition-colors hover:brightness-110" onClick={handleEditorConnect}>Connect</button>
      </div>
    )
  }

  if (connected) {
    return (
      <div class={'flex items-center justify-between px-3 py-1.5 gap-2.5' + (readOnly ? ' border-b border-warning' : '')}>
        <div class="flex items-center gap-1.5 min-w-0 flex-1">
          {readOnly
            ? <LockIcon color="var(--color-warning)" size={18} />
            : <SignalIcon color="var(--color-success)" size={18} />
          }
          <span class={'text-xs leading-4 whitespace-nowrap overflow-hidden text-ellipsis' + (readOnly ? ' text-warning' : ' text-primary')}>{channelName || 'Connected'}</span>
          <span class="text-muted-foreground text-xs leading-4 whitespace-nowrap">:{port}</span>
        </div>
        <button class="flex items-center gap-1 border border-solid border-border text-primary py-1 px-2 rounded-md cursor-pointer text-xs leading-4 font-medium whitespace-nowrap transition-colors hover:bg-accent" disabled={buttonDisabled} onClick={onDisconnect}><PlugZapIcon color="var(--color-primary)" size={14} /> Disconnect</button>
      </div>
    )
  }

  return (
    <div class="flex items-center justify-between px-3 py-1.5 gap-2.5">
      <div class="flex items-center gap-1.5 min-w-0 flex-1">
        <SignalIcon color="var(--color-warning)" size={18} />
        <span class="text-warning text-xs leading-4">Disconnected</span>
        <span class="text-muted-foreground text-xs leading-4 cursor-pointer whitespace-nowrap hover:text-foreground" onClick={handlePortClick}>:{port}</span>
      </div>
      <button class="flex items-center gap-1 bg-primary border border-solid border-primary text-primary-foreground py-1 px-2 rounded-md cursor-pointer text-xs leading-4 font-medium whitespace-nowrap transition-colors hover:brightness-110" disabled={buttonDisabled} onClick={function () { onConnect(port) }}><UnplugIcon color="var(--color-primary-foreground)" size={14} /> Connect</button>
    </div>
  )
}
