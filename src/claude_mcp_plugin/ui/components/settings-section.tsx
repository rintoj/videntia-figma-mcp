import { h } from 'preact'
import { useState } from 'preact/hooks'
import { Toggle } from './toggle'

interface SettingsSectionProps {
  port: number
  serverUrl: string
  serverSecure: boolean
  readOnly: boolean
  autoFocus: boolean
  onPortChange: (port: number) => void
  onServerUrlChange: (url: string) => void
  onServerSecureChange: (secure: boolean) => void
  onReadOnlyChange: (value: boolean) => void
  onAutoFocusChange: (value: boolean) => void
}

export function SettingsSection({ port, serverUrl, serverSecure, readOnly, autoFocus, onPortChange, onServerUrlChange, onServerSecureChange, onReadOnlyChange, onAutoFocusChange }: SettingsSectionProps) {
  var [editPort, setEditPort] = useState(String(port))
  var [editUrl, setEditUrl] = useState(serverUrl)

  function handlePortBlur() {
    var parsed = parseInt(editPort, 10)
    var valid = (parsed >= 1024 && parsed <= 65535) ? parsed : port
    setEditPort(String(valid))
    if (valid !== port) {
      onPortChange(valid)
    }
  }

  function handlePortKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur()
    }
  }

  function handleUrlBlur() {
    var trimmed = editUrl.trim()
    if (trimmed !== serverUrl) {
      onServerUrlChange(trimmed)
    }
  }

  function handleUrlKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur()
    }
  }

  return (
    <div class="flex flex-col gap-3 p-3 bg-card flex-1">
      <span class="text-muted-foreground text-[11px] font-semibold leading-4 uppercase tracking-wide">Connection</span>
      <div class="flex flex-col gap-1 py-1">
        <div class="flex flex-col gap-1">
          <span class="text-foreground text-sm font-medium leading-5">Server</span>
          <span class="text-muted-foreground text-xs font-medium leading-4">WebSocket server URL and port</span>
        </div>
        <div class="flex gap-2">
          <div class="flex flex-1 min-w-0 border border-border rounded-md overflow-hidden hover:border-input focus-within:border-ring">
            <button
              class={'flex items-center px-2 text-xs font-mono font-semibold border-r border-border transition-colors whitespace-nowrap ' + (serverSecure ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground')}
              onClick={function () { onServerSecureChange(!serverSecure) }}
              title={'Switch to ' + (serverSecure ? 'ws://' : 'wss://')}
            >{serverSecure ? 'wss' : 'ws'}://</button>
            <input
              type="text"
              value={editUrl}
              placeholder="figma-mcp.videntia.dev"
              onInput={function (e) { setEditUrl((e.target as HTMLInputElement).value) }}
              onBlur={handleUrlBlur}
              onKeyDown={handleUrlKeyDown}
              class="py-1.5 px-2.5 text-sm bg-transparent text-foreground outline-none flex-1 min-w-0"
            />
          </div>
          <input
            type="number"
            value={editPort}
            min={1024}
            max={65535}
            onInput={function (e) { setEditPort((e.target as HTMLInputElement).value) }}
            onBlur={handlePortBlur}
            onKeyDown={handlePortKeyDown}
            class="border border-border rounded-md py-1.5 px-2.5 text-sm bg-transparent text-foreground outline-none w-[72px] text-center hover:border-input focus:border-ring"
          />
        </div>
      </div>
      <div class="h-px bg-border" />
      <span class="text-muted-foreground text-[11px] font-semibold leading-4 uppercase tracking-wide">Preferences</span>
      <Toggle label="Read Only" description="Prevent changes — view only mode" checked={readOnly} onChange={onReadOnlyChange} activeColor="var(--color-success)" />
      <Toggle label="Auto Focus" description="Follow along as Claude edits" checked={autoFocus} onChange={onAutoFocusChange} activeColor="var(--color-success)" />
    </div>
  )
}
