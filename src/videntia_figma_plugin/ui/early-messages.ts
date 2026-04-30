// Queue messages that arrive before the Preact app mounts.
// Figma fires 'auto-connect' synchronously via figma.on('run') which can
// arrive before useEffect registers its listener.
var earlyMessages: MessageEvent[] = [];
var capturing = true;

window.addEventListener("message", function (e) {
  if (capturing) earlyMessages.push(e);
});

export function consumeEarlyMessages(): MessageEvent[] {
  capturing = false;
  var msgs = earlyMessages;
  earlyMessages = [];
  return msgs;
}
