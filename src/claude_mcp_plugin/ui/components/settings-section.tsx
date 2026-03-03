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
    <div style={{
      display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px',
      padding: '6px 8px', backgroundColor: '#2d2d2d', borderRadius: '4px',
    }}>
      <Toggle label="Read Only" checked={readOnly} onChange={onReadOnlyChange} activeColor="#c53030" />
      <Toggle label="Auto Focus" checked={autoFocus} onChange={onAutoFocusChange} activeColor="#18a0fb" />
    </div>
  )
}
