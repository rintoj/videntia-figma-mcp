import { h } from 'preact'

interface ConnectionStatusProps {
  connected: boolean
  message: string
  statusClass: string
}

export function ConnectionStatus({ message, statusClass }: ConnectionStatusProps) {
  return (
    <div class={'status ' + statusClass}>
      {message}
    </div>
  )
}
