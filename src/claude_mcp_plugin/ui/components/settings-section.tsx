import { h } from 'preact'
import { useState } from 'preact/hooks'
import { Toggle } from './toggle'
import { SERVER_OPTIONS } from '../constants'

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

  var selectedOption = SERVER_OPTIONS.find(function (o) { return o.host === serverUrl }) || SERVER_OPTIONS[0]

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

  function handleHostChange(host: string) {
    var option = SERVER_OPTIONS.find(function (o) { return o.host === host }) || SERVER_OPTIONS[0]
    onServerUrlChange(option.host)
    onServerSecureChange(option.defaultSecure)
  }

  return (
    <div class="flex flex-col gap-3 p-3 bg-card flex-1">
      <span class="text-muted-foreground text-[11px] font-semibold leading-4 uppercase tracking-wide">Connection</span>
      <div class="flex flex-col gap-1 py-1">
        <div class="flex flex-col gap-1">
          <span class="text-foreground text-sm font-medium leading-5">Server</span>
          <span class="text-muted-foreground text-xs font-medium leading-4">WebSocket server URL and port</span>
        </div>
        <div class="flex border border-border rounded-md overflow-hidden hover:border-input focus-within:border-ring">
          <span class={'flex items-center px-2 text-xs font-mono font-semibold border-r border-border whitespace-nowrap select-none ' + (serverSecure ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
            {serverSecure ? 'wss' : 'ws'}://
          </span>
          <select
            value={selectedOption.host}
            onChange={function (e) { handleHostChange((e.target as HTMLSelectElement).value) }}
            class="py-1.5 px-1.5 text-sm bg-transparent text-foreground outline-none flex-1 min-w-0 cursor-pointer appearance-none"
          >
            {SERVER_OPTIONS.map(function (o) {
              return <option key={o.host} value={o.host}>{o.label}</option>
            })}
          </select>
          {selectedOption.showPort && (
            <span class="flex items-center text-border text-sm select-none">|</span>
          )}
          {selectedOption.showPort && (
            <input
              type="number"
              value={editPort}
              placeholder={String(port)}
              min={1024}
              max={65535}
              onInput={function (e) { setEditPort((e.target as HTMLInputElement).value) }}
              onBlur={handlePortBlur}
              onKeyDown={handlePortKeyDown}
              class="py-1.5 px-1 text-sm bg-transparent text-foreground outline-none w-[56px] text-center"
            />
          )}
        </div>
      </div>
      <div class="h-px bg-border" />
      <span class="text-muted-foreground text-[11px] font-semibold leading-4 uppercase tracking-wide">Preferences</span>
      <Toggle label="Read Only" description="Prevent changes — view only mode" checked={readOnly} onChange={onReadOnlyChange} activeColor="var(--color-success)" />
      <Toggle label="Auto Focus" description="Follow along as Claude edits" checked={autoFocus} onChange={onAutoFocusChange} activeColor="var(--color-success)" />
    </div>
  )
}
