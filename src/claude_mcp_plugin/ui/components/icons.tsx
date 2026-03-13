import { h } from 'preact'

interface IconProps {
  color?: string
  size?: number
}

export function SignalIcon({ color, size }: IconProps) {
  var c = color || '#808080'
  var s = size || 16
  return (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="12" r="2" fill={c} />
      <path d="M4.5 9.5C5.5 8.2 6.7 7.5 8 7.5s2.5.7 3.5 2" stroke={c} stroke-width="1.5" stroke-linecap="round" fill="none" />
      <path d="M2 7c1.8-2.3 3.7-3.5 6-3.5s4.2 1.2 6 3.5" stroke={c} stroke-width="1.5" stroke-linecap="round" fill="none" />
    </svg>
  )
}

export function CheckCircleIcon({ color, size }: IconProps) {
  var c = color || '#4caf50'
  var s = size || 14
  return (
    <svg width={s} height={s} viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="6" stroke={c} stroke-width="1.5" />
      <path d="M4.5 7l1.8 1.8L9.5 5.5" stroke={c} stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  )
}

export function XCircleIcon({ color, size }: IconProps) {
  var c = color || '#ef4444'
  var s = size || 14
  return (
    <svg width={s} height={s} viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="6" stroke={c} stroke-width="1.5" />
      <path d="M5 5l4 4M9 5l-4 4" stroke={c} stroke-width="1.5" stroke-linecap="round" />
    </svg>
  )
}

export function ChevronRightIcon({ color, size }: IconProps) {
  var c = color || '#808080'
  var s = size || 12
  return (
    <svg width={s} height={s} viewBox="0 0 12 12" fill="none">
      <path d="M4.5 2.5l3.5 3.5-3.5 3.5" stroke={c} stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  )
}

export function ChevronDownIcon({ color, size }: IconProps) {
  var c = color || '#808080'
  var s = size || 12
  return (
    <svg width={s} height={s} viewBox="0 0 12 12" fill="none">
      <path d="M2.5 4.5l3.5 3.5 3.5-3.5" stroke={c} stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  )
}

export function TerminalIcon({ color, size }: IconProps) {
  var c = color || '#555555'
  var s = size || 32
  return (
    <svg width={s} height={s} viewBox="0 0 32 32" fill="none">
      <rect x="3" y="6" width="26" height="20" rx="3" stroke={c} stroke-width="2" />
      <path d="M9 14l3 3-3 3" stroke={c} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M16 20h6" stroke={c} stroke-width="2" stroke-linecap="round" />
    </svg>
  )
}

export function CopyIcon({ color, size }: IconProps) {
  var c = color || '#808080'
  var s = size || 14
  return (
    <svg width={s} height={s} viewBox="0 0 14 14" fill="none">
      <rect x="4.5" y="4.5" width="7" height="7" rx="1.5" stroke={c} stroke-width="1.2" />
      <path d="M9.5 4.5V3a1.5 1.5 0 00-1.5-1.5H3A1.5 1.5 0 001.5 3v5A1.5 1.5 0 003 9.5h1.5" stroke={c} stroke-width="1.2" />
    </svg>
  )
}

export function FocusIcon({ color, size }: IconProps) {
  var c = color || '#4db04f'
  var s = size || 14
  return (
    <svg width={s} height={s} viewBox="0 0 14 14" fill="none">
      <path d="M1.5 4.5V2.5a1 1 0 011-1h2" stroke={c} stroke-width="1.2" stroke-linecap="round" />
      <path d="M9 1.5h2a1 1 0 011 1v2" stroke={c} stroke-width="1.2" stroke-linecap="round" />
      <path d="M12.5 9.5v2a1 1 0 01-1 1h-2" stroke={c} stroke-width="1.2" stroke-linecap="round" />
      <path d="M5 12.5H3a1 1 0 01-1-1v-2" stroke={c} stroke-width="1.2" stroke-linecap="round" />
      <circle cx="7" cy="7" r="2" stroke={c} stroke-width="1.2" />
    </svg>
  )
}

export function LockIcon({ color, size }: IconProps) {
  var c = color || '#febc2f'
  var s = size || 14
  return (
    <svg width={s} height={s} viewBox="0 0 14 14" fill="none">
      <rect x="2" y="6.5" width="10" height="6" rx="1.5" stroke={c} stroke-width="1.2" />
      <path d="M4.5 6.5V4.5a2.5 2.5 0 015 0v2" stroke={c} stroke-width="1.2" stroke-linecap="round" />
    </svg>
  )
}

export function ListIcon({ color, size }: IconProps) {
  var c = color || '#808080'
  var s = size || 13
  return (
    <svg width={s} height={s} viewBox="0 0 13 13" fill="none">
      <path d="M2 3.5h9M2 6.5h9M2 9.5h9" stroke={c} stroke-width="1.2" stroke-linecap="round" />
    </svg>
  )
}

export function MousePointerIcon({ color, size }: IconProps) {
  var c = color || '#808080'
  var s = size || 13
  return (
    <svg width={s} height={s} viewBox="0 0 13 13" fill="none">
      <path d="M2 2l3.5 9 2-4 4-2L2 2z" stroke={c} stroke-width="1.1" stroke-linejoin="round" />
    </svg>
  )
}

export function GearIcon({ color, size }: IconProps) {
  var c = color || '#808080'
  var s = size || 13
  return (
    <svg width={s} height={s} viewBox="0 0 13 13" fill="none">
      <circle cx="6.5" cy="6.5" r="2" stroke={c} stroke-width="1.1" />
      <path d="M6.5 1v1.2M6.5 10.8V12M1 6.5h1.2M10.8 6.5H12M2.7 2.7l.85.85M9.45 9.45l.85.85M2.7 10.3l.85-.85M9.45 3.55l.85-.85" stroke={c} stroke-width="1.1" stroke-linecap="round" />
    </svg>
  )
}

export function CodeXmlIcon({ color, size }: IconProps) {
  var c = color || '#ffffff'
  var s = size || 20
  return (
    <svg width={s} height={s} viewBox="0 0 20 20" fill="none">
      <path d="M5 7l-3 3 3 3M15 7l3 3-3 3M11 4l-2 12" stroke={c} stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  )
}

export function XIcon({ color, size }: IconProps) {
  var c = color || '#999999'
  var s = size || 18
  return (
    <svg width={s} height={s} viewBox="0 0 18 18" fill="none">
      <path d="M5 5l8 8M13 5l-8 8" stroke={c} stroke-width="1.5" stroke-linecap="round" />
    </svg>
  )
}

export function SpinnerIcon({ color, size }: IconProps) {
  var c = color || '#66b3ff'
  var s = size || 14
  return (
    <svg width={s} height={s} viewBox="0 0 14 14" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
      <circle cx="7" cy="7" r="5.5" stroke="#333" stroke-width="1.5" />
      <path d="M7 1.5a5.5 5.5 0 014.9 3" stroke={c} stroke-width="1.5" stroke-linecap="round" />
    </svg>
  )
}
