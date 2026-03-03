import { h } from 'preact'
import { ChevronRightIcon, ChevronDownIcon } from './icons'

interface SectionHeaderProps {
  label: string
  expanded: boolean
  onToggle: () => void
}

export function SectionHeader({ label, expanded, onToggle }: SectionHeaderProps) {
  return (
    <div class="section-header" onClick={onToggle}>
      {expanded ? <ChevronDownIcon color="#808080" /> : <ChevronRightIcon color="#808080" />}
      <span>{label}</span>
    </div>
  )
}
