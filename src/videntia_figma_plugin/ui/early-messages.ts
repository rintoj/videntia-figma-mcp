// Queue messages that arrive before the Preact app mounts.
// Figma fires 'auto-connect' synchronously via figma.on('run') which can
// arrive before useEffect registers its listener.
var earlyMessages: MessageEvent[] = [];
var capturing = true;

function capture(e: MessageEvent) {
  if (capturing) earlyMessages.push(e);
}
window.addEventListener("message", capture);

export function consumeEarlyMessages(): MessageEvent[] {
  capturing = false;
  window.removeEventListener("message", capture);
  var msgs = earlyMessages;
  earlyMessages = [];
  return msgs;
}
