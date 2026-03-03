import { h } from 'preact'
import { useRef } from 'preact/hooks'

interface ConnectionSectionProps {
  port: number
  connected: boolean
  buttonDisabled: boolean
  onConnect: (port: number) => void
  onDisconnect: () => void
  onPortChange: (port: number) => void
}

export function ConnectionSection({ port, connected, buttonDisabled, onConnect, onDisconnect, onPortChange }: ConnectionSectionProps) {
  var inputRef = useRef<HTMLInputElement>(null)

  function handleClick() {
    if (connected) {
      onDisconnect()
    } else {
      var el = inputRef.current
      var parsedPort = el ? parseInt(el.value, 10) : 3055
      var validPort = (parsedPort >= 1024 && parsedPort <= 65535) ? parsedPort : 3055
      onConnect(validPort)
    }
  }

  return (
    <div class="section">
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <input
          ref={inputRef}
          type="number"
          placeholder="3055"
          value={port}
          min={1024}
          max={65535}
          disabled={connected}
          onInput={(e) => {
            var val = parseInt((e.target as HTMLInputElement).value, 10)
            if (!isNaN(val)) onPortChange(val)
          }}
        />
        <button
          class={connected ? 'danger' : 'primary'}
          disabled={buttonDisabled}
          onClick={handleClick}
        >
          {connected ? 'Disconnect' : 'Connect'}
        </button>
      </div>
    </div>
  )
}
