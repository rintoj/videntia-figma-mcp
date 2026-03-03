import { h } from 'preact'

interface ToggleProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  activeColor: string
}

export function Toggle({ label, checked, onChange, activeColor }: ToggleProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ fontSize: '11px', color: '#999' }}>{label}</span>
      <label style={{ position: 'relative', display: 'inline-block', width: '32px', height: '18px', margin: 0 }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
          style={{ opacity: 0, width: 0, height: 0 }}
        />
        <span style={{
          position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: checked ? activeColor : '#444',
          borderRadius: '18px', transition: 'background-color 0.2s',
        }}>
          <span style={{
            position: 'absolute', height: '14px', width: '14px', left: '2px', bottom: '2px',
            backgroundColor: '#ccc', borderRadius: '50%', transition: 'transform 0.2s',
            transform: checked ? 'translateX(14px)' : 'translateX(0)',
          }} />
        </span>
      </label>
    </div>
  )
}
