// Shared TypeScript types for the Claude Figma MCP plugin.
// The Figma plugin API is available globally via @figma/plugin-typings.

// ---------------------------------------------------------------------------
// Basic colour types
// ---------------------------------------------------------------------------

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

// ---------------------------------------------------------------------------
// Plugin state
// ---------------------------------------------------------------------------

export interface PluginState {
  serverPort: number;
}

// ---------------------------------------------------------------------------
// Message types exchanged between the plugin iframe (UI) and the plugin code
// ---------------------------------------------------------------------------

export interface BaseMessage {
  type: string;
}

export interface AutoConnectMessage extends BaseMessage {
  type: 'auto-connect';
}

export interface FileNameMessage extends BaseMessage {
  type: 'file-name';
  fileName: string;
}

export interface UpdateSettingsMessage extends BaseMessage {
  type: 'update-settings';
  serverPort?: number;
}

export interface NotifyMessage extends BaseMessage {
  type: 'notify';
  message: string;
}

export interface ClosePluginMessage extends BaseMessage {
  type: 'close-plugin';
}

export interface GetFileNameMessage extends BaseMessage {
  type: 'get-file-name';
}

export interface ExecuteCommandMessage extends BaseMessage {
  type: 'execute-command';
  id: string;
  command: string;
  params: Record<string, unknown>;
}

export interface CommandResultMessage extends BaseMessage {
  type: 'command-result';
  id: string;
  command: string;
  result: unknown;
}

export interface CommandErrorMessage extends BaseMessage {
  type: 'command-error';
  id: string;
  command: string;
  error: string;
}

export interface CommandProgressMessage extends BaseMessage {
  type: 'command_progress';
  commandId: string;
  commandType: string;
  status: string;
  progress: number;
  totalItems: number;
  processedItems: number;
  message: string;
  timestamp: number;
  currentChunk?: number;
  totalChunks?: number;
  chunkSize?: number;
  payload?: ProgressPayload;
}

export interface ProgressPayload {
  currentChunk?: number;
  totalChunks?: number;
  chunkSize?: number;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Batch-actions types
// ---------------------------------------------------------------------------

export interface BatchAction {
  action: string;
  params: Record<string, unknown>;
}

export interface BatchActionResult {
  index: number;
  action: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

export interface BatchActionsParams {
  actions: BatchAction[];
  stopOnError?: boolean;
  commandId?: string;
}

export interface BatchActionsResult {
  success: boolean;
  totalActions: number;
  succeeded: number;
  failed: number;
  results: BatchActionResult[];
}

// ---------------------------------------------------------------------------
// SVG stroke types
// ---------------------------------------------------------------------------

export interface SvgRootStroke {
  color: string;
  width: number;
  opacity: number;
}

// ---------------------------------------------------------------------------
// Variable value types
// ---------------------------------------------------------------------------

export type VariableResolvedType = 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';

export type VariableValue =
  | RgbaColor
  | number
  | string
  | boolean
  | { type: 'VARIABLE_ALIAS'; id: string };
