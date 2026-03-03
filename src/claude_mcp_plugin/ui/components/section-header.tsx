import { h } from 'preact'
import { ChevronRightIcon } from './icons'

interface SectionHeaderProps {
  label: string
  expanded: boolean
  onToggle: () => void
}

export function SectionHeader({ label, expanded, onToggle }: SectionHeaderProps) {
  return (
    <div class="section-header" onClick={onToggle}>
      <span class={'section-header-chevron' + (expanded ? ' expanded' : '')}>
        <ChevronRightIcon color="#808080" />
      </span>
      <span>{label}</span>
    </div>
  )
}
