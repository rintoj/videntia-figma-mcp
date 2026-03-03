import { h } from 'preact'
import { useState, useEffect, useRef } from 'preact/hooks'
import { ConnectionSection } from './components/connection-section'
import { SectionHeader } from './components/section-header'
import { SettingsSection } from './components/settings-section'
import { ActionsList } from './components/actions-list'
import { useConnection } from './hooks/use-connection'
import { consumeEarlyMessages } from './early-messages'

export function App() {
  var [port, setPort] = useState(3055)
  var [readOnly, setReadOnly] = useState(false)
  var [autoFocus, setAutoFocus] = useState(false)
  var [prefsExpanded, setPrefsExpanded] = useState(true)
  var [actionsExpanded, setActionsExpanded] = useState(true)

  var connection = useConnection()

  // Keep connection in a ref so the message handler always sees the latest without re-registering
  var connectionRef = useRef(connection)
  connectionRef.current = connection

  useEffect(function () {
    function handleMessage(event: MessageEvent) {
      var msg = event.data && event.data.pluginMessage
      if (!msg) return

      console.log('Received message from plugin:', msg)
      var conn = connectionRef.current

      switch (msg.type) {
        case 'connection-status':
          break
        case 'init-settings':
          if (msg.settings) {
            if (msg.settings.serverPort) {
              setPort(msg.settings.serverPort)
              conn.setServerPort(msg.settings.serverPort)
            }
            if (msg.settings.readonlyMode !== undefined) {
              setReadOnly(msg.settings.readonlyMode)
            }
            if (msg.settings.autoFocus !== undefined) {
              setAutoFocus(msg.settings.autoFocus)
            }
            if (msg.settings.prefsExpanded !== undefined) {
              setPrefsExpanded(msg.settings.prefsExpanded)
            }
            if (msg.settings.actionsExpanded !== undefined) {
              setActionsExpanded(msg.settings.actionsExpanded)
            }
          }
          break
        case 'auto-connect':
          conn.triggerAutoConnect()
          break
        case 'auto-disconnect':
          conn.disconnect()
          break
        case 'command-result':
          conn.handleCommandResult(msg)
          break
        case 'command-error':
          conn.handleCommandError(msg)
          break
        case 'file-name':
          conn.handleFileName(msg.fileName)
          break
        case 'command_progress':
          conn.handleProgressUpdate(msg)
          break
      }
    }

    window.addEventListener('message', handleMessage)

    // Replay any messages that arrived before the app mounted
    var early = consumeEarlyMessages()
    for (var i = 0; i < early.length; i++) {
      handleMessage(early[i])
    }

    return function () {
      window.removeEventListener('message', handleMessage)
    }
  }, [])

  function handleReadOnlyChange(value: boolean) {
    setReadOnly(value)
    parent.postMessage({ pluginMessage: { type: 'update-settings', readonlyMode: value } }, '*')
  }

  function handleAutoFocusChange(value: boolean) {
    setAutoFocus(value)
    parent.postMessage({ pluginMessage: { type: 'update-settings', autoFocus: value } }, '*')
  }

  function handlePrefsToggle() {
    var next = !prefsExpanded
    setPrefsExpanded(next)
    parent.postMessage({ pluginMessage: { type: 'update-settings', prefsExpanded: next } }, '*')
  }

  function handleActionsToggle() {
    var next = !actionsExpanded
    setActionsExpanded(next)
    parent.postMessage({ pluginMessage: { type: 'update-settings', actionsExpanded: next } }, '*')
  }

  function handleConnect(p: number) {
    connection.connect(p)
  }

  function handleDisconnect() {
    connection.disconnect()
  }

  function handlePortChange(p: number) {
    setPort(p)
  }

  return (
    <div class="container">
      <ConnectionSection
        port={port}
        connected={connection.connState.connected}
        channelName={connection.connState.channelName}
        buttonDisabled={connection.connState.buttonDisabled}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        onPortChange={handlePortChange}
      />
      <div class="section-content">
        <SectionHeader label="Preferences" expanded={prefsExpanded} onToggle={handlePrefsToggle} />
        {prefsExpanded && (
          <SettingsSection
            readOnly={readOnly}
            autoFocus={autoFocus}
            onReadOnlyChange={handleReadOnlyChange}
            onAutoFocusChange={handleAutoFocusChange}
          />
        )}
      </div>
      <div class="section-content actions-section">
        <SectionHeader label="Actions" expanded={actionsExpanded} onToggle={handleActionsToggle} />
        {actionsExpanded && <ActionsList actions={connection.actions} />}
      </div>
    </div>
  )
}
