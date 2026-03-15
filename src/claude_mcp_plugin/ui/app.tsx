import { h } from 'preact'
import { useState, useEffect, useRef } from 'preact/hooks'
import { ConnectionSection } from './components/connection-section'
import { SettingsSection } from './components/settings-section'
import { ActionsList } from './components/actions-list'
import { TabBar, TabId } from './components/tab-bar'
import { SelectionSection } from './components/selection'
import { useConnection } from './hooks/use-connection'
import { consumeEarlyMessages } from './early-messages'

export function App() {
  var [port, setPort] = useState(3055)
  var [readOnly, setReadOnly] = useState(false)
  var [autoFocus, setAutoFocus] = useState(false)
  var [activeTab, setActiveTab] = useState<TabId>('actions')

  var connection = useConnection()

  var connectionRef = useRef(connection)
  connectionRef.current = connection

  useEffect(function () {
    function handleMessage(event: MessageEvent) {
      var msg = event.data && event.data.pluginMessage
      if (!msg) return

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
            if (msg.settings.activeTab) {
              setActiveTab(msg.settings.activeTab)
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

    var early = consumeEarlyMessages()
    for (var i = 0; i < early.length; i++) {
      handleMessage(early[i])
    }

    return function () {
      window.removeEventListener('message', handleMessage)
    }
  }, [])

  function handleTabChange(tab: TabId) {
    setActiveTab(tab)
    parent.postMessage({ pluginMessage: { type: 'update-settings', activeTab: tab } }, '*')
  }

  function handleReadOnlyChange(value: boolean) {
    setReadOnly(value)
    parent.postMessage({ pluginMessage: { type: 'update-settings', readonlyMode: value } }, '*')
  }

  function handleAutoFocusChange(value: boolean) {
    setAutoFocus(value)
    parent.postMessage({ pluginMessage: { type: 'update-settings', autoFocus: value } }, '*')
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

  function handleClose() {
    parent.postMessage({ pluginMessage: { type: 'close-plugin' } }, '*')
  }

  return (
    <div class="flex flex-col h-screen overflow-hidden bg-background">
      <div class="flex flex-col overflow-hidden flex-1 min-h-0 bg-card">
        <TabBar activeTab={activeTab} onTabChange={handleTabChange} />
        <div class="flex-1 min-h-0 flex flex-col">
          {activeTab === 'actions' && <ActionsList actions={connection.actions} />}
          <div style={{ display: activeTab === 'selection' ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
            <SelectionSection />
          </div>
          {activeTab === 'settings' && (
            <SettingsSection
              port={port}
              readOnly={readOnly}
              autoFocus={autoFocus}
              onPortChange={handlePortChange}
              onReadOnlyChange={handleReadOnlyChange}
              onAutoFocusChange={handleAutoFocusChange}
            />
          )}
        </div>
      </div>
      {activeTab === 'actions' && (
        <ConnectionSection
          port={port}
          connected={connection.connState.connected}
          channelName={connection.connState.channelName}
          buttonDisabled={connection.connState.buttonDisabled}
          readOnly={readOnly}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          onPortChange={handlePortChange}
        />
      )}
    </div>
  )
}
