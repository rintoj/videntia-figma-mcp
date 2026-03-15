import { h } from 'preact'
import { useState, useRef, useEffect } from 'preact/hooks'
import { SignalIcon, LockIcon } from './icons'

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
          class="border-2 border-primary rounded-md py-2 px-2.5 text-sm bg-secondary text-foreground outline-none w-full"
        />
        <button class="w-full py-2 text-xs leading-4 bg-primary border border-solid border-primary text-primary-foreground rounded-md cursor-pointer font-medium transition-colors hover:opacity-90" onClick={handleEditorConnect}>Connect</button>
      </div>
    )
  }

  if (connected) {
    return (
      <div class={'flex items-center justify-between py-2.5 px-2 pl-3 bg-muted border rounded-[10px] h-[47px]' + (readOnly ? ' border-warning' : ' border-border')}>
        <div class="flex items-center gap-2 min-w-0 flex-1">
          {readOnly
            ? <LockIcon color="var(--color-warning)" size={18} />
            : <SignalIcon color="var(--color-success)" size={18} />
          }
          <span class={'text-sm leading-5 font-medium whitespace-nowrap overflow-hidden text-ellipsis' + (readOnly ? ' text-warning' : ' text-success')}>{channelName || 'Connected'}</span>
          <span class="text-muted-foreground text-xs leading-4 whitespace-nowrap">:{port}</span>
        </div>
        <button class="bg-destructive border border-solid border-destructive text-destructive-foreground py-1.5 px-2.5 rounded-md cursor-pointer text-xs leading-4 font-medium whitespace-nowrap transition-colors hover:opacity-90" disabled={buttonDisabled} onClick={onDisconnect}>Disconnect</button>
      </div>
    )
  }

  return (
    <div class="flex items-center justify-between py-2.5 px-2 pl-3 bg-muted border border-border rounded-[10px] h-[47px]">
      <div class="flex items-center gap-2 min-w-0 flex-1">
        <SignalIcon color="var(--color-destructive)" size={18} />
        <span class="text-destructive text-sm leading-5 font-medium">Disconnected</span>
        <span class="text-muted-foreground text-xs leading-4 cursor-pointer whitespace-nowrap hover:text-foreground" onClick={handlePortClick}>:{port}</span>
      </div>
      <button class="bg-primary border border-solid border-primary text-primary-foreground py-1.5 px-2.5 rounded-md cursor-pointer text-xs leading-4 font-medium whitespace-nowrap transition-colors hover:opacity-90" disabled={buttonDisabled} onClick={function () { onConnect(port) }}>Connect</button>
    </div>
  )
}
