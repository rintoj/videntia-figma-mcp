import { h } from 'preact'
import { Toggle } from './toggle'

interface SettingsSectionProps {
  readOnly: boolean
  autoFocus: boolean
  onReadOnlyChange: (value: boolean) => void
  onAutoFocusChange: (value: boolean) => void
}

export function SettingsSection({ readOnly, autoFocus, onReadOnlyChange, onAutoFocusChange }: SettingsSectionProps) {
  return (
    <div class="flex flex-col gap-3 p-3 bg-card flex-1">
      <Toggle label="Read Only" description="Prevent changes — view only mode" checked={readOnly} onChange={onReadOnlyChange} activeColor="var(--color-success)" />
      <Toggle label="Auto Focus" description="Follow along as Claude edits" checked={autoFocus} onChange={onAutoFocusChange} activeColor="var(--color-success)" />
    </div>
  )
}
