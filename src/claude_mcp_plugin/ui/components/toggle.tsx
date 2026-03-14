import { h } from 'preact'

interface ToggleProps {
  label: string
  description?: string
  checked: boolean
  onChange: (checked: boolean) => void
  activeColor: string
}

export function Toggle({ label, description, checked, onChange, activeColor }: ToggleProps) {
  return (
    <div class="settings-row">
      <div class="settings-label-group">
        <span class="settings-label">{label}</span>
        {description ? <span class="settings-description">{description}</span> : null}
      </div>
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
