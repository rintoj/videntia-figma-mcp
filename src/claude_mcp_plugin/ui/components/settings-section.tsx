import { h } from 'preact'
import { useState } from 'preact/hooks'
import { Toggle } from './toggle'

interface SettingsSectionProps {
  port: number
  readOnly: boolean
  autoFocus: boolean
  onPortChange: (port: number) => void
  onReadOnlyChange: (value: boolean) => void
  onAutoFocusChange: (value: boolean) => void
}

export function SettingsSection({ port, readOnly, autoFocus, onPortChange, onReadOnlyChange, onAutoFocusChange }: SettingsSectionProps) {
  var [editPort, setEditPort] = useState(String(port))

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

  return (
    <div class="flex flex-col gap-3 p-3 bg-card flex-1">
      <span class="text-muted-foreground text-[11px] font-semibold leading-4 uppercase tracking-wide">Connection</span>
      <div class="flex items-start gap-3 py-1">
        <div class="flex flex-col gap-1 flex-1 min-w-0">
          <span class="text-foreground text-sm font-medium leading-5">Server Port</span>
          <span class="text-muted-foreground text-xs font-medium leading-4">WebSocket port for MCP connection</span>
        </div>
        <input
          type="number"
          value={editPort}
          min={1024}
          max={65535}
          onInput={function (e) { setEditPort((e.target as HTMLInputElement).value) }}
          onBlur={handlePortBlur}
          onKeyDown={handlePortKeyDown}
          class="border border-border rounded-md py-1.5 px-2.5 text-sm bg-transparent text-foreground outline-none w-[72px] text-center"
        />
      </div>
      <div class="h-px bg-border" />
      <span class="text-muted-foreground text-[11px] font-semibold leading-4 uppercase tracking-wide">Preferences</span>
      <Toggle label="Read Only" description="Prevent changes — view only mode" checked={readOnly} onChange={onReadOnlyChange} activeColor="var(--color-success)" />
      <Toggle label="Auto Focus" description="Follow along as Claude edits" checked={autoFocus} onChange={onAutoFocusChange} activeColor="var(--color-success)" />
    </div>
  )
}
