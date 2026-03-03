import { useState, useRef, useCallback } from 'preact/hooks'
import { ALLOWED_COMMANDS, RECONNECT_BASE_DELAY, RECONNECT_MAX_DELAY, MIN_PROGRESS_DISPLAY_MS } from '../constants'

function generateId(): string {
  var bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  var hex = ''
  for (var i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0')
  }
  return Date.now().toString(36) + hex
}

function generateChannelName(): string {
  var characters = 'abcdefghijklmnopqrstuvwxyz0123456789'
  var randomBytes = new Uint8Array(8)
  crypto.getRandomValues(randomBytes)
  var result = ''
  for (var i = 0; i < 8; i++) {
    result += characters.charAt(randomBytes[i] % characters.length)
  }
  return result
}

function formatCommandName(command: string): string {
  if (!command) return ''
  return command.replace(/_/g, ' ').replace(/^\w/, function (c) { return c.toUpperCase() })
}

export interface ConnectionState {
  connected: boolean
  statusMessage: string
  statusClass: string
  buttonDisabled: boolean
}

interface UseConnectionOptions {
  onOperationUpdate: (text: string, type: string) => void
  onOperationHide: (delayMs: number) => void
}

export function useConnection(options: UseConnectionOptions) {
  var [connState, setConnState] = useState<ConnectionState>({
    connected: false,
    statusMessage: 'Disconnected',
    statusClass: 'disconnected',
    buttonDisabled: false,
  })

  var socketRef = useRef<WebSocket | null>(null)
  var channelRef = useRef<string | null>(null)
  var fileNameRef = useRef<string | null>(null)
  var pendingRequestsRef = useRef<Map<string, { resolve: Function, reject: Function }>>(new Map())
  var intentionalDisconnectRef = useRef(false)
  var reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  var reconnectAttemptRef = useRef(0)
  var serverPortRef = useRef(3055)
  var progressStartTimesRef = useRef<Map<string, number>>(new Map())
  var connectedRef = useRef(false)
  // Keep options in a ref so WebSocket callbacks always see the latest
  var optionsRef = useRef(options)
  optionsRef.current = options

  function updateConnectionStatus(isConnected: boolean, message: string, cssClass?: string) {
    connectedRef.current = isConnected
    setConnState({
      connected: isConnected,
      statusMessage: message,
      statusClass: cssClass !== undefined ? cssClass : (isConnected ? 'connected' : 'disconnected'),
      buttonDisabled: false,
    })
  }

  function cancelReconnect() {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
  }

  function scheduleReconnect(wasConnected: boolean) {
    cancelReconnect()
    var delay = Math.min(
      RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttemptRef.current),
      RECONNECT_MAX_DELAY
    )
    var seconds = Math.round(delay / 1000)
    var msg = wasConnected
      ? 'Connection lost. Reconnecting in ' + seconds + 's...'
      : 'Connection failed. Retrying in ' + seconds + 's...'
    updateConnectionStatus(false, msg, 'info')

    reconnectTimerRef.current = setTimeout(function () {
      reconnectAttemptRef.current++
      console.log('Reconnect attempt ' + reconnectAttemptRef.current + ' (delay was ' + delay + 'ms)')
      updateConnectionStatus(false, 'Reconnecting...', 'info')
      setConnState(function (prev) { return Object.assign({}, prev, { buttonDisabled: true }) })
      connectToServer(serverPortRef.current)
    }, delay)
  }

  function sendViaSocket(data: any) {
    var sock = socketRef.current
    if (sock && sock.readyState === WebSocket.OPEN) {
      sock.send(JSON.stringify(data))
    }
  }

  function sendSuccessResponse(id: string, result: any) {
    sendViaSocket({
      id: id,
      type: 'message',
      channel: channelRef.current,
      message: { id: id, result: result },
    })
  }

  function sendErrorResponse(id: string, errorMessage: string) {
    sendViaSocket({
      id: id,
      type: 'message',
      channel: channelRef.current,
      message: { id: id, error: errorMessage },
    })
  }

  function sendProgressUpdateToServer(progressData: any) {
    sendViaSocket({
      id: progressData.commandId,
      type: 'progress_update',
      channel: channelRef.current,
      message: {
        id: progressData.commandId,
        type: 'progress_update',
        data: progressData,
      },
    })
  }

  function handleSocketMessage(payload: any) {
    var data = payload.message
    console.log('handleSocketMessage', data)

    // Response to a previous request
    if (data.id && pendingRequestsRef.current.has(data.id)) {
      var pending = pendingRequestsRef.current.get(data.id)!
      pendingRequestsRef.current.delete(data.id)
      if (data.error) {
        pending.reject(new Error(data.error))
      } else {
        pending.resolve(data.result)
      }
      return
    }

    // New command from server
    if (data.command) {
      if (!ALLOWED_COMMANDS.has(data.command)) {
        console.error('Blocked unknown command:', data.command)
        sendErrorResponse(data.id, 'Command not permitted')
        return
      }

      var name = formatCommandName(data.command)
      progressStartTimesRef.current.set(data.id, Date.now())
      optionsRef.current.onOperationUpdate('Running: ' + name + '...', 'running')

      try {
        parent.postMessage({
          pluginMessage: {
            type: 'execute-command',
            id: data.id,
            command: data.command,
            params: data.params,
          },
        }, '*')
      } catch (error: any) {
        optionsRef.current.onOperationUpdate(name + ' failed', 'error')
        optionsRef.current.onOperationHide(5000)
        sendErrorResponse(data.id, error.message || 'Error executing command')
      }
    }
  }

  function connectToServer(port: number) {
    var sock = socketRef.current
    if (sock && sock.readyState === WebSocket.OPEN) {
      updateConnectionStatus(true, 'Already connected to server')
      return
    }

    // Clean up stale socket
    if (sock) {
      try { sock.close() } catch (e) {}
      socketRef.current = null
    }

    serverPortRef.current = port
    var ws = new WebSocket('ws://localhost:' + port)
    socketRef.current = ws

    ws.onopen = function () {
      reconnectAttemptRef.current = 0
      cancelReconnect()

      var ch = channelRef.current || generateChannelName()
      console.log('Joining channel:', ch)
      channelRef.current = ch

      var joinPayload: any = { type: 'join', channel: ch.trim() }
      if (fileNameRef.current) {
        joinPayload.fileName = fileNameRef.current
      }
      ws.send(JSON.stringify(joinPayload))

      if (!fileNameRef.current) {
        parent.postMessage({ pluginMessage: { type: 'get-file-name' } }, '*')
      }
    }

    ws.onmessage = function (event) {
      try {
        var data = JSON.parse(event.data)
        console.log('Received message:', data)

        if (data.type === 'system') {
          if (data.message && data.message.result) {
            var channelName = data.channel
            updateConnectionStatus(true, 'Channel: ' + channelName)
            parent.postMessage({
              pluginMessage: { type: 'notify', message: 'Channel: ' + channelName },
            }, '*')
          }
        } else if (data.type === 'error') {
          console.error('Error:', data.message)
          updateConnectionStatus(false, 'Error: ' + String(data.message))
          ws.close()
        }

        handleSocketMessage(data)
      } catch (error) {
        console.error('Error parsing message:', error)
      }
    }

    ws.onclose = function () {
      var wasConnected = connectedRef.current
      connectedRef.current = false
      socketRef.current = null

      if (intentionalDisconnectRef.current) {
        intentionalDisconnectRef.current = false
        reconnectAttemptRef.current = 0
        updateConnectionStatus(false, 'Disconnected from server')
      } else {
        scheduleReconnect(wasConnected)
      }
    }

    ws.onerror = function (error) {
      console.error('WebSocket error:', error)
    }
  }

  var connect = useCallback(function (port: number) {
    cancelReconnect()
    reconnectAttemptRef.current = 0
    updateConnectionStatus(false, 'Connecting...', 'info')
    setConnState(function (prev) { return Object.assign({}, prev, { buttonDisabled: true }) })
    connectToServer(port)
  }, [])

  var disconnect = useCallback(function () {
    intentionalDisconnectRef.current = true
    cancelReconnect()
    var sock = socketRef.current
    if (sock) {
      sock.close()
      socketRef.current = null
    }
    connectedRef.current = false
    updateConnectionStatus(false, 'Disconnected from server')
  }, [])

  function handleCommandResult(message: any) {
    var resultName = formatCommandName(message.command || '')
    var resultStart = progressStartTimesRef.current.get(message.id)
    var resultDelay = resultStart !== undefined
      ? Math.max(0, MIN_PROGRESS_DISPLAY_MS - (Date.now() - resultStart))
      : 0
    progressStartTimesRef.current.delete(message.id)
    setTimeout(function () {
      optionsRef.current.onOperationUpdate(resultName + ' completed', 'success')
      optionsRef.current.onOperationHide(3000)
    }, resultDelay)
    sendSuccessResponse(message.id, message.result)
  }

  function handleCommandError(message: any) {
    var errorName = formatCommandName(message.command || '')
    var errorStart = progressStartTimesRef.current.get(message.id)
    var errorDelay = errorStart !== undefined
      ? Math.max(0, MIN_PROGRESS_DISPLAY_MS - (Date.now() - errorStart))
      : 0
    progressStartTimesRef.current.delete(message.id)
    setTimeout(function () {
      optionsRef.current.onOperationUpdate(errorName + ' failed', 'error')
      optionsRef.current.onOperationHide(5000)
    }, errorDelay)
    sendErrorResponse(message.id, message.error)
  }

  function handleProgressUpdate(message: any) {
    var name = formatCommandName(message.command || '')
    if (message.status === 'completed') {
      optionsRef.current.onOperationUpdate(message.message || (name + ' completed'), 'success')
      optionsRef.current.onOperationHide(3000)
    } else if (message.status === 'error') {
      optionsRef.current.onOperationUpdate(message.message || (name + ' failed'), 'error')
      optionsRef.current.onOperationHide(5000)
    } else {
      optionsRef.current.onOperationUpdate(message.message || (name + '...'), 'running')
    }
    sendProgressUpdateToServer(message)
  }

  function handleFileName(fileName: string) {
    fileNameRef.current = fileName
    console.log('File name received:', fileName)
    var sock = socketRef.current
    if (sock && sock.readyState === WebSocket.OPEN && channelRef.current) {
      sock.send(JSON.stringify({
        type: 'join',
        channel: channelRef.current,
        fileName: fileName,
      }))
    }
  }

  function triggerAutoConnect() {
    var port = serverPortRef.current
    cancelReconnect()
    reconnectAttemptRef.current = 0
    updateConnectionStatus(false, 'Connecting...', 'info')
    setConnState(function (prev) { return Object.assign({}, prev, { buttonDisabled: true }) })
    connectToServer(port)
  }

  function setServerPort(port: number) {
    serverPortRef.current = port
  }

  return {
    connState: connState,
    connect: connect,
    disconnect: disconnect,
    handleCommandResult: handleCommandResult,
    handleCommandError: handleCommandError,
    handleProgressUpdate: handleProgressUpdate,
    handleFileName: handleFileName,
    triggerAutoConnect: triggerAutoConnect,
    setServerPort: setServerPort,
  }
}
