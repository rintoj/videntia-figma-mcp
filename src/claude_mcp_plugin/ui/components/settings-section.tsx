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
      <Toggle label="Read Only" checked={readOnly} onChange={onReadOnlyChange} activeColor="#c53030" />
      <Toggle label="Auto Focus" checked={autoFocus} onChange={onAutoFocusChange} activeColor="#18a0fb" />
    </div>
  )
}
