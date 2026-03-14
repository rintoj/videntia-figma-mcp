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
    <div class="flex items-center gap-3 py-[3px]">
      <div class="flex flex-col gap-1 flex-1">
        <span class="text-[13px] font-medium text-foreground">{label}</span>
        {description ? <span class="text-[11px] text-muted-foreground">{description}</span> : null}
      </div>
      <label class="relative inline-block w-[44px] h-[26px] cursor-pointer shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={function (e) { onChange((e.target as HTMLInputElement).checked) }}
          class="opacity-0 w-0 h-0 absolute"
        />
        <span class="absolute inset-0 rounded-[13px] transition-colors" style={{ backgroundColor: checked ? activeColor : 'var(--color-secondary)' }}>
          <span class="absolute h-5 w-5 left-[3px] bottom-[3px] bg-primary-foreground rounded-[10px] transition-transform" style={{ transform: checked ? 'translateX(18px)' : 'translateX(0)' }} />
        </span>
      </label>
    </div>
  )
}
