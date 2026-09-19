import { h } from "preact";
import { useState, useRef, useEffect } from "preact/hooks";
import { SignalIcon, LockIcon, SpinnerIcon } from "./icons";

interface ConnectionSectionProps {
  port: number;
  connected: boolean;
  channelName: string;
  buttonDisabled: boolean;
  statusClass: string;
  readOnly: boolean;
  serverHost: string;
  serverSecure: boolean;
  showPort: boolean;
  environments: Array<{ label: string; host: string }>;
  inset?: boolean;
  onConnect: (port: number) => void;
  onDisconnect: () => void;
  onPortChange: (port: number) => void;
  onHostChange: (host: string) => void;
}

export function ConnectionSection({
  port,
  connected,
  channelName,
  buttonDisabled,
  statusClass,
  readOnly,
  serverHost,
  serverSecure,
  showPort,
  environments,
  inset,
  onConnect,
  onDisconnect,
  onPortChange,
  onHostChange,
}: ConnectionSectionProps) {
  var connecting = buttonDisabled && !connected;
  var failed = !connected && !buttonDisabled && statusClass === "info";
  var [editing, setEditing] = useState(false);
  var [editPort, setEditPort] = useState(String(port));
  var inputRef = useRef<HTMLInputElement>(null);
  var portEditable = showPort && !connected;

  useEffect(
    function () {
      if (editing && inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    },
    [editing],
  );

  function handlePortClick() {
    if (portEditable) {
      setEditPort(String(port));
      setEditing(true);
    }
  }

  function handlePortCommit() {
    var parsed = parseInt(editPort, 10);
    var valid = parsed >= 1024 && parsed <= 65535 ? parsed : port;
    setEditing(false);
    if (valid !== port) {
      onPortChange(valid);
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      handlePortCommit();
    } else if (e.key === "Escape") {
      setEditing(false);
    }
  }

  var statusIcon = connecting ? (
    <SpinnerIcon color="var(--color-muted-foreground, #888)" size={14} />
  ) : connected && readOnly ? (
    <LockIcon color="var(--color-warning)" size={14} />
  ) : (
    <SignalIcon
      color={
        connected ? "var(--color-success)" : failed ? "var(--color-destructive, #ef4444)" : "var(--color-warning)"
      }
      size={14}
    />
  );

  var statusText = connecting ? "Connecting..." : failed ? "Failed to connect" : "Disconnected";

  var statusTextClass = connecting ? " text-muted-foreground" : failed ? " text-destructive" : " text-warning";

  var quietButtonClass =
    "bg-background border border-solid border-border text-foreground py-1 px-2 rounded-md cursor-pointer " +
    "text-[11px] leading-4 font-medium whitespace-nowrap transition-colors hover:border-input active:scale-95";
  var primaryButtonClass =
    "bg-primary border border-solid border-primary text-primary-foreground py-1 px-2 rounded-md cursor-pointer " +
    "text-[11px] leading-4 font-medium whitespace-nowrap transition-colors hover:brightness-110 active:scale-95";
  var destructiveButtonClass =
    "bg-destructive border border-solid border-destructive text-destructive-foreground py-1 px-2 rounded-md " +
    "cursor-pointer text-[11px] leading-4 font-medium whitespace-nowrap transition-colors hover:brightness-110 " +
    "active:scale-95";

  var scheme = serverSecure ? "wss" : "ws";
  var endpointPrefix = scheme + "://" + serverHost;

  var card = (
    <div class="flex flex-col gap-2 p-2.5 bg-popover border border-solid border-border rounded-lg">
      <div class="flex items-center justify-between gap-1.5">
        <div class="flex items-center gap-1.5 min-w-0 flex-1">
          <span class="flex items-center shrink-0">{statusIcon}</span>
          {connected ? (
            <span class="text-foreground text-xs leading-4 min-w-0 whitespace-nowrap overflow-hidden text-ellipsis">
              {channelName || "Connected"}
            </span>
          ) : (
            <span class={"text-xs leading-4 font-medium whitespace-nowrap" + statusTextClass}>{statusText}</span>
          )}
        </div>
        {connecting ? (
          <span class="flex items-center text-muted-foreground opacity-60">
            <SpinnerIcon color="currentColor" size={13} />
          </span>
        ) : connected ? (
          <button class={quietButtonClass} disabled={buttonDisabled} onClick={onDisconnect}>
            Disconnect
          </button>
        ) : (
          <button
            class={failed ? destructiveButtonClass : primaryButtonClass}
            onClick={function () {
              onConnect(port);
            }}
          >
            {failed ? "Retry" : "Connect"}
          </button>
        )}
      </div>

      {editing ? (
        <div class="flex items-center gap-1">
          <span class="text-muted-foreground text-xs font-mono leading-4 whitespace-nowrap">{endpointPrefix}:</span>
          <input
            ref={inputRef}
            type="number"
            value={editPort}
            min={1024}
            max={65535}
            onInput={function (e) {
              setEditPort((e.target as HTMLInputElement).value);
            }}
            onBlur={handlePortCommit}
            onKeyDown={handleKeyDown}
            class="py-0.5 px-1 text-xs font-mono leading-4 bg-secondary text-foreground border border-solid border-border rounded-md outline-none w-[56px] text-center focus:border-ring"
          />
        </div>
      ) : (
        <span
          class={
            "text-muted-foreground text-xs font-mono leading-4 whitespace-nowrap overflow-hidden text-ellipsis" +
            (portEditable ? " cursor-pointer hover:text-foreground" : "")
          }
          title={portEditable ? "Click to edit the port" : undefined}
          onClick={handlePortClick}
        >
          {endpointPrefix}
          {showPort ? ":" + port : ""}
        </span>
      )}

      <div class="flex items-stretch gap-0.5 p-0.5 bg-muted border border-solid border-border rounded-md">
        {environments.map(function (env) {
          var active = env.host === serverHost;
          return (
            <button
              key={env.host}
              class={
                "flex-1 min-w-0 py-1 px-2 rounded-md cursor-pointer text-[11px] leading-4 font-medium " +
                "whitespace-nowrap overflow-hidden text-ellipsis transition-colors border border-solid " +
                (active
                  ? "bg-background border-border text-foreground"
                  : "bg-transparent border-transparent text-muted-foreground hover:text-foreground")
              }
              onClick={function () {
                onHostChange(env.host);
              }}
            >
              {env.label}
            </button>
          );
        })}
      </div>
    </div>
  );

  if (inset) {
    return card;
  }
  return <div class="px-3 py-1.5">{card}</div>;
}
