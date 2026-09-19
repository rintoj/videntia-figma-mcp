// How the plugin turns saved settings into the relay WebSocket URL. Shared by
// the panel's connection hook and the headless copy command, so a custom port
// or host configured in Preferences is honoured by both.

export var DEFAULT_SOCKET_PORT = 3055;
export var DEFAULT_SOCKET_HOST = "localhost";

export interface SocketSettings {
  serverPort?: number | null;
  serverUrl?: string | null;
  serverSecure?: boolean | null;
}

/**
 * localhost is always plain ws: the relay runs unencrypted on the machine, and
 * a remote host picks its scheme from the serverSecure preference.
 */
export function socketUrlFrom(settings: SocketSettings): string {
  var port =
    typeof settings.serverPort === "number" && settings.serverPort > 0 ? settings.serverPort : DEFAULT_SOCKET_PORT;
  var host = (settings.serverUrl || "").trim() || DEFAULT_SOCKET_HOST;
  var isLocalhost = host === "localhost" || host === "127.0.0.1";
  if (isLocalhost) return "ws://" + DEFAULT_SOCKET_HOST + ":" + port;
  return (settings.serverSecure ? "wss://" : "ws://") + host;
}
