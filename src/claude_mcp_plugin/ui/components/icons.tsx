import { h } from 'preact'

interface IconProps {
  color?: string
  size?: number
}

export function SignalIcon({ color, size }: IconProps) {
  var c = color || 'var(--muted-foreground)'
  var s = size || 18
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" style={{ stroke: c }} stroke-width="1.556" stroke-linecap="round">
      <path d="M4.9 19.1a10 10 0 0 1 0-14.2" />
      <path d="M7.8 16.2a6 6 0 0 1 0-8.4" />
      <path d="M16.2 7.8a6 6 0 0 1 0 8.4" />
      <path d="M19.1 4.9a10 10 0 0 1 0 14.2" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  )
}

export function CheckCircleIcon({ color, size }: IconProps) {
  var c = color || 'var(--primary)'
  var s = size || 14
  return (
    <svg width={s} height={s} viewBox="0 0 14 14" fill="none" style={{ stroke: c }}>
      <circle cx="7" cy="7" r="6" stroke-width="1.5" />
      <path d="M4.5 7l1.8 1.8L9.5 5.5" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  )
}

export function XCircleIcon({ color, size }: IconProps) {
  var c = color || 'var(--destructive)'
  var s = size || 14
  return (
    <svg width={s} height={s} viewBox="0 0 14 14" fill="none" style={{ stroke: c }}>
      <circle cx="7" cy="7" r="6" stroke-width="1.5" />
      <path d="M5 5l4 4M9 5l-4 4" stroke-width="1.5" stroke-linecap="round" />
    </svg>
  )
}

export function ChevronRightIcon({ color, size }: IconProps) {
  var c = color || 'var(--muted-foreground)'
  var s = size || 12
  return (
    <svg width={s} height={s} viewBox="0 0 12 12" fill="none" style={{ stroke: c }}>
      <path d="M4.5 2.5l3.5 3.5-3.5 3.5" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  )
}

export function ChevronDownIcon({ color, size }: IconProps) {
  var c = color || 'var(--muted-foreground)'
  var s = size || 12
  return (
    <svg width={s} height={s} viewBox="0 0 12 12" fill="none" style={{ stroke: c }}>
      <path d="M2.5 4.5l3.5 3.5 3.5-3.5" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  )
}

export function TerminalIcon({ color, size }: IconProps) {
  var c = color || 'var(--border)'
  var s = size || 24
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" style={{ stroke: c }}>
      <path d="M4 17h8" stroke-width="2" stroke-linecap="round" />
      <path d="M4 7l6 5-6 5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  )
}

export function CopyIcon({ color, size }: IconProps) {
  var c = color || 'var(--muted-foreground)'
  var s = size || 14
  return (
    <svg width={s} height={s} viewBox="0 0 14 14" fill="none" style={{ stroke: c }}>
      <rect x="4.5" y="4.5" width="7" height="7" rx="1.5" stroke-width="1.2" />
      <path d="M9.5 4.5V3a1.5 1.5 0 00-1.5-1.5H3A1.5 1.5 0 001.5 3v5A1.5 1.5 0 003 9.5h1.5" stroke-width="1.2" />
    </svg>
  )
}

export function FocusIcon({ color, size }: IconProps) {
  var c = color || 'var(--primary)'
  var s = size || 14
  return (
    <svg width={s} height={s} viewBox="0 0 14 14" fill="none" style={{ stroke: c }}>
      <path d="M1.5 4.5V2.5a1 1 0 011-1h2" stroke-width="1.2" stroke-linecap="round" />
      <path d="M9 1.5h2a1 1 0 011 1v2" stroke-width="1.2" stroke-linecap="round" />
      <path d="M12.5 9.5v2a1 1 0 01-1 1h-2" stroke-width="1.2" stroke-linecap="round" />
      <path d="M5 12.5H3a1 1 0 01-1-1v-2" stroke-width="1.2" stroke-linecap="round" />
      <circle cx="7" cy="7" r="2" stroke-width="1.2" />
    </svg>
  )
}

export function LockIcon({ color, size }: IconProps) {
  var c = color || 'var(--warning)'
  var s = size || 14
  return (
    <svg width={s} height={s} viewBox="0 0 14 14" fill="none" style={{ stroke: c }}>
      <rect x="2" y="6.5" width="10" height="6" rx="1.5" stroke-width="1.2" />
      <path d="M4.5 6.5V4.5a2.5 2.5 0 015 0v2" stroke-width="1.2" stroke-linecap="round" />
    </svg>
  )
}

export function ListIcon({ color, size }: IconProps) {
  var c = color || 'var(--muted-foreground)'
  var s = size || 13
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" style={{ stroke: c }} stroke-width="2" stroke-linecap="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  )
}

export function MousePointerIcon({ color, size }: IconProps) {
  var c = color || 'var(--muted-foreground)'
  var s = size || 13
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" style={{ stroke: c }} stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
      <path d="M13 13l6 6" />
    </svg>
  )
}

export function GearIcon({ color, size }: IconProps) {
  var c = color || 'var(--muted-foreground)'
  var s = size || 13
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" style={{ stroke: c }} stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

export function CodeXmlIcon({ color, size }: IconProps) {
  var c = color || 'var(--primary-foreground)'
  var s = size || 20
  return (
    <svg width={s} height={s} viewBox="0 0 20 20" fill="none" style={{ stroke: c }}>
      <path d="M5 7l-3 3 3 3M15 7l3 3-3 3M11 4l-2 12" stroke-width="1.667" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  )
}

export function XIcon({ color, size }: IconProps) {
  var c = color || 'var(--muted-foreground)'
  var s = size || 18
  return (
    <svg width={s} height={s} viewBox="0 0 18 18" fill="none" style={{ stroke: c }}>
      <path d="M5 5l8 8M13 5l-8 8" stroke-width="1.5" stroke-linecap="round" />
    </svg>
  )
}

export function UnplugIcon({ color, size }: IconProps) {
  var c = color || 'var(--primary-foreground)'
  var s = size || 14
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" style={{ stroke: c }} stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="m19 5 3-3" />
      <path d="m2 22 3-3" />
      <path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z" />
      <path d="M7.5 13.5 10 11" />
      <path d="M10.5 16.5 13 14" />
      <path d="m12 6 6 6 2.3-2.3a2.4 2.4 0 0 0 0-3.4l-2.6-2.6a2.4 2.4 0 0 0-3.4 0Z" />
    </svg>
  )
}

export function PlugZapIcon({ color, size }: IconProps) {
  var c = color || 'var(--foreground)'
  var s = size || 14
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" style={{ stroke: c }} stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z" />
      <path d="m2 22 3-3" />
      <path d="M7.5 13.5 10 11" />
      <path d="M10.5 16.5 13 14" />
      <path d="m18 3-4 4h6l-4 4" />
    </svg>
  )
}

export function SpinnerIcon({ color, size }: IconProps) {
  var c = color || 'var(--primary)'
  var s = size || 14
  return (
    <svg width={s} height={s} viewBox="0 0 14 14" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
      <circle cx="7" cy="7" r="5.5" style={{ stroke: 'var(--border)' }} stroke-width="1.5" />
      <path d="M7 1.5a5.5 5.5 0 014.9 3" style={{ stroke: c }} stroke-width="1.5" stroke-linecap="round" />
    </svg>
  )
}
