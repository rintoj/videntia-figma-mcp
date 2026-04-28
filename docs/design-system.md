# Design System

> Source: Figma MCP plugin UI (dark theme)
> Colors extracted from selected frames and mapped to Tailwind color theory semantics.

## Color Variables

Collection: **Colors**

### Surface (background layering)

| Variable | Tailwind Class | Value | Purpose |
|----------|----------------|-------|---------|
| surface/base | bg-surface-base | #0f0f0f | Darkest surface — content list backgrounds |
| surface/elevated | bg-surface-elevated | #1c1c1c | Slightly raised — active tabs, hover states, bottom bars |
| surface/panel | bg-surface-panel | #242424 | Panel-level — connection bar, tab bar, detail panels |
| surface/input | bg-surface-input | #2a2a2a | Input/control surface — search bars, nav buttons, dividers |
| surface/default | bg-surface-default | #2b2b2b | Default window/frame background |
| surface/raised | bg-surface-raised | #383838 | Raised elements — track buttons, divider fills |

### Border

| Variable | Tailwind Class | Value | Purpose |
|----------|----------------|-------|---------|
| border/default | border-border-default | #383838 | Default border color |
| border/subtle | border-border-subtle | #333333 | Subtle border — panel/frame outlines |
| border/dim | border-border-dim | #555555 | Dim border — checkbox unchecked state |

### Text

| Variable | Tailwind Class | Value | Purpose |
|----------|----------------|-------|---------|
| text/inverse | text-text-inverse | #ffffff | White text — on colored/brand backgrounds |
| text/primary | text-text-primary | #e0e0e0 | Primary text — main content, node names |
| text/secondary | text-text-secondary | #a6a6a6 | Secondary text — input content, subtitles |
| text/muted | text-text-muted | #808080 | Muted text — port labels, timestamps, captions |
| text/disabled | text-text-disabled | #737373 | Disabled/placeholder text — inactive tabs, placeholders |
| text/dim | text-text-dim | #666666 | Dim text — node IDs, dimmed metadata |

### Icon

| Variable | Tailwind Class | Value | Purpose |
|----------|----------------|-------|---------|
| icon/default | text-icon-default | #9ca3af | Default icon — Tailwind gray-400 |
| icon/muted | text-icon-muted | #999999 | Muted icon — close button, secondary icons |

### Text (additional)

| Variable | Tailwind Class | Value | Purpose |
|----------|----------------|-------|---------|
| text/label | text-text-label | #cccccc | Label text — settings labels (Tailwind neutral-300 range) |

### Surface (additional)

| Variable | Tailwind Class | Value | Purpose |
|----------|----------------|-------|---------|
| surface/toggle | bg-surface-toggle | #545454 | Toggle track off state (Tailwind neutral-600 range) |

### Brand (Orange)

| Variable | Tailwind Class | Value | Purpose |
|----------|----------------|-------|---------|
| brand/default | bg-brand-default | #e85c2b | Brand orange — icon box, primary accent |
| brand/foreground | text-brand-foreground | #ffffff | Text/icon on brand backgrounds |

### Success (Green)

| Variable | Tailwind Class | Value | Purpose |
|----------|----------------|-------|---------|
| success/default | text-success-default | #4caf50 | Active/success green — tab indicator, check icons, channel status |
| success/foreground | text-success-foreground | #ffffff | Text/icon on success backgrounds |
| success/subtle | bg-success-subtle | #263726 | Subtle success background — selected row highlight |
| success/bg | bg-success-bg | #273e28 | Success button background — connect button fill |
| success/border | border-success-border | #2a5d2e | Success border — connect button outline |

### Danger (Red)

| Variable | Tailwind Class | Value | Purpose |
|----------|----------------|-------|---------|
| danger/default | text-danger-default | #ef4444 | Danger/error — Tailwind red-500, disconnect label, error icons |
| danger/foreground | text-danger-foreground | #ffffff | Text/icon on danger backgrounds |
| danger/subtle | bg-danger-subtle | #3d2222 | Subtle danger background — disconnect button fill |
| danger/border | border-danger-border | #643434 | Danger border — disconnect button outline |

### Warning (Amber)

| Variable | Tailwind Class | Value | Purpose |
|----------|----------------|-------|---------|
| warning/default | text-warning-default | #febc2f | Warning amber — lock icon, readonly channel status (Tailwind amber-400) |
| warning/foreground | text-warning-foreground | #ffffff | Text/icon on warning backgrounds |

### Figma Type Colors

| Variable | Tailwind Class | Value | Purpose |
|----------|----------------|-------|---------|
| figma/component | text-figma-component | #0fa958 | Figma component node type icon color |
| figma/component-set | text-figma-component-set | #9747ff | Figma component set / instance type icon color |

### Overlay

| Variable | Tailwind Class | Value | Purpose |
|----------|----------------|-------|---------|
| overlay/hover | bg-overlay-hover | rgba(204,204,204,0.10) | Hover overlay — 10% white for interactive states |

---

## Spacing Variables

_Not yet configured._

## Radius Variables

_Not yet configured._

## Text Styles

_Not yet configured._

## Effect Styles

_Not yet configured._
