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
    <div class="settings-card">
      <Toggle label="Read Only" description="Block all edits — Claude can only read your file" checked={readOnly} onChange={onReadOnlyChange} activeColor="#4caf50" />
      <Toggle label="Auto Focus" description="Jump to each node as Claude works on it" checked={autoFocus} onChange={onAutoFocusChange} activeColor="#4caf50" />
    </div>
  )
}
