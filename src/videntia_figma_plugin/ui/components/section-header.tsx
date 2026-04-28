import { h } from 'preact'
import { ChevronRightIcon } from './icons'

interface SectionHeaderProps {
  label: string
  expanded: boolean
  onToggle: () => void
}

export function SectionHeader({ label, expanded, onToggle }: SectionHeaderProps) {
  return (
    <div class="flex items-center gap-1.5 cursor-pointer select-none py-0.5" onClick={onToggle}>
      <span class={'flex items-center transition-transform duration-200' + (expanded ? ' rotate-90' : '')}>
        <ChevronRightIcon color="var(--color-muted-foreground)" />
      </span>
      <span class="text-muted-foreground text-[11px] leading-4 font-medium uppercase tracking-wide">{label}</span>
    </div>
  )
}
