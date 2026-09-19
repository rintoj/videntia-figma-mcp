import { h } from "preact";
import { Toggle } from "./toggle";
import { ConnectionSection } from "./connection-section";
import { SERVER_OPTIONS } from "../constants";

interface SettingsSectionProps {
  port: number;
  serverUrl: string;
  serverSecure: boolean;
  readOnly: boolean;
  autoFocus: boolean;
  connected: boolean;
  channelName: string;
  buttonDisabled: boolean;
  statusClass: string;
  onConnect: (port: number) => void;
  onDisconnect: () => void;
  onPortChange: (port: number) => void;
  onServerUrlChange: (url: string) => void;
  onServerSecureChange: (secure: boolean) => void;
  onReadOnlyChange: (value: boolean) => void;
  onAutoFocusChange: (value: boolean) => void;
}

var ENVIRONMENT_LABELS: { [host: string]: string } = {
  localhost: "Local",
  "figma-mcp.videntia.dev": "Hosted",
};

export function SettingsSection({
  port,
  serverUrl,
  serverSecure,
  readOnly,
  autoFocus,
  connected,
  channelName,
  buttonDisabled,
  statusClass,
  onConnect,
  onDisconnect,
  onPortChange,
  onServerUrlChange,
  onServerSecureChange,
  onReadOnlyChange,
  onAutoFocusChange,
}: SettingsSectionProps) {
  var selectedOption =
    SERVER_OPTIONS.find(function (o) {
      return o.host === serverUrl;
    }) || SERVER_OPTIONS[0];

  var environments = SERVER_OPTIONS.map(function (o) {
    return { label: ENVIRONMENT_LABELS[o.host] || o.label, host: o.host };
  });

  function handleHostChange(host: string) {
    var option =
      SERVER_OPTIONS.find(function (o) {
        return o.host === host;
      }) || SERVER_OPTIONS[0];
    onServerUrlChange(option.host);
    onServerSecureChange(option.defaultSecure);
  }

  return (
    <div class="flex flex-col gap-3 p-3 bg-card flex-1">
      <span class="text-muted-foreground text-[11px] font-medium leading-4 uppercase tracking-wide">Connection</span>
      <ConnectionSection
        port={port}
        connected={connected}
        channelName={channelName}
        buttonDisabled={buttonDisabled}
        statusClass={statusClass}
        readOnly={readOnly}
        serverHost={selectedOption.host}
        serverSecure={serverSecure}
        showPort={selectedOption.showPort}
        environments={environments}
        inset={true}
        onConnect={onConnect}
        onDisconnect={onDisconnect}
        onPortChange={onPortChange}
        onHostChange={handleHostChange}
      />
      <span class="text-muted-foreground text-[11px] font-medium leading-4 uppercase tracking-wide">Preferences</span>
      <div class="flex flex-col gap-2 p-2.5 bg-popover border border-solid border-border rounded-lg">
        <Toggle
          label="Read Only"
          description="Prevent changes, view only mode"
          checked={readOnly}
          onChange={onReadOnlyChange}
          activeColor="var(--color-success)"
        />
        <div class="h-px bg-border" />
        <Toggle
          label="Auto Focus"
          description="Follow along as Claude edits"
          checked={autoFocus}
          onChange={onAutoFocusChange}
          activeColor="var(--color-success)"
        />
      </div>
    </div>
  );
}
