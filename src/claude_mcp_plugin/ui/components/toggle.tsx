import { h } from 'preact'

interface ToggleProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  activeColor: string
}

export function Toggle({ label, checked, onChange, activeColor }: ToggleProps) {
  return (
    <div class="settings-row">
      <span class="settings-label">{label}</span>
      <label class="toggle-track">
        <input
          type="checkbox"
          checked={checked}
          onChange={function (e) { onChange((e.target as HTMLInputElement).checked) }}
        />
        <span class="toggle-slider" style={{ backgroundColor: checked ? activeColor : '#545454' }}>
          <span class="toggle-knob" style={{ transform: checked ? 'translateX(18px)' : 'translateX(0)' }} />
        </span>
      </label>
    </div>
  )
}
