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
