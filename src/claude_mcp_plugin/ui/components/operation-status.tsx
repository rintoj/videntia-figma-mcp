import { h } from 'preact'

interface OperationStatusProps {
  text: string
  type: string
}

export function OperationStatus({ text, type }: OperationStatusProps) {
  if (!text) return null
  return (
    <div class={'operation-status ' + type}>
      {text}
    </div>
  )
}
