# Design System Style Guide

Reference specification for design system tokens. Used by `get_design_system` to identify missing items.

## Color Variables

| Variable Name | Tailwind Class | Purpose |
|---------------|----------------|---------|
| background/primary | bg-background-primary | Main app background |
| background/secondary | bg-background-secondary | Card/section backgrounds |
| background/tertiary | bg-background-tertiary | Subtle nested backgrounds |
| background/inverse | bg-background-inverse | Inverted backgrounds (dark on light) |
| text/primary | text-text-primary | Main body text |
| text/secondary | text-text-secondary | Supporting/muted text |
| text/tertiary | text-text-tertiary | Placeholder or disabled text |
| text/inverse | text-text-inverse | Text on inverse backgrounds |
| text/link | text-text-link | Hyperlinks and clickable text |
| brand/primary | bg-brand-primary | Primary brand color |
| brand/secondary | bg-brand-secondary | Secondary brand accent |
| brand/tertiary | bg-brand-tertiary | Tertiary brand accent |
| semantic/success | text-semantic-success | Success states |
| semantic/success/subtle | bg-semantic-success-subtle | Success background tint |
| semantic/warning | text-semantic-warning | Warning states |
| semantic/warning/subtle | bg-semantic-warning-subtle | Warning background tint |
| semantic/error | text-semantic-error | Error states |
| semantic/error/subtle | bg-semantic-error-subtle | Error background tint |
| semantic/info | text-semantic-info | Informational states |
| semantic/info/subtle | bg-semantic-info-subtle | Info background tint |
| border/primary | border-border-primary | Default borders |
| border/secondary | border-border-secondary | Subtle/divider borders |
| border/focus | border-border-focus | Focus ring borders |
| border/error | border-border-error | Error state borders |
| interactive/default | bg-interactive-default | Default button/control background |
| interactive/hover | bg-interactive-hover | Hover state |
| interactive/active | bg-interactive-active | Pressed/active state |
| interactive/disabled | bg-interactive-disabled | Disabled controls |
| interactive/focus | bg-interactive-focus | Focus indicator |
| overlay/light | bg-overlay-light | Light overlay/scrim |
| overlay/dark | bg-overlay-dark | Dark overlay/scrim |
| preview/1 | bg-preview-1 | Preview/avatar color 1 |
| preview/2 | bg-preview-2 | Preview/avatar color 2 |
| preview/3 | bg-preview-3 | Preview/avatar color 3 |
| preview/4 | bg-preview-4 | Preview/avatar color 4 |
| preview/5 | bg-preview-5 | Preview/avatar color 5 |
| preview/6 | bg-preview-6 | Preview/avatar color 6 |

## Spacing Variables

| Variable Name | Tailwind Class | Purpose |
|---------------|----------------|---------|
| space/0 | p-space-0, gap-space-0 | No spacing (0px) |
| space/1 | p-space-1, gap-space-1 | Micro spacing (4px) |
| space/2 | p-space-2, gap-space-2 | Tight spacing (8px) |
| space/3 | p-space-3, gap-space-3 | Compact spacing (12px) |
| space/4 | p-space-4, gap-space-4 | Default spacing (16px) |
| space/5 | p-space-5, gap-space-5 | Comfortable spacing (20px) |
| space/6 | p-space-6, gap-space-6 | Relaxed spacing (24px) |
| space/7 | p-space-7, gap-space-7 | Loose spacing (32px) |
| space/8 | p-space-8, gap-space-8 | Wide spacing (40px) |
| space/9 | p-space-9, gap-space-9 | Extra wide spacing (48px) |
| space/10 | p-space-10, gap-space-10 | Section spacing (64px) |

## Radius Variables

| Variable Name | Tailwind Class | Purpose |
|---------------|----------------|---------|
| radius/none | rounded-radius-none | No rounding (0px) |
| radius/sm | rounded-radius-sm | Small rounding (4px) |
| radius/md | rounded-radius-md | Medium rounding (8px) |
| radius/lg | rounded-radius-lg | Large rounding (12px) |
| radius/xl | rounded-radius-xl | Extra large rounding (16px) |
| radius/2xl | rounded-radius-2xl | Double XL rounding (24px) |
| radius/full | rounded-radius-full | Pill/circle rounding (9999px) |

## Text Styles

| Style Name | Tailwind Class | Purpose |
|------------|----------------|---------|
| display/large | text-display-large | Hero headlines |
| display/medium | text-display-medium | Section headlines |
| display/small | text-display-small | Sub-section headlines |
| heading/h1 | text-heading-h1 | Page title |
| heading/h2 | text-heading-h2 | Section title |
| heading/h3 | text-heading-h3 | Subsection title |
| heading/h4 | text-heading-h4 | Card/group title |
| body/large | text-body-large | Prominent body text |
| body/medium | text-body-medium | Default body text |
| body/small | text-body-small | Secondary body text |
| label/large | text-label-large | Large form labels |
| label/medium | text-label-medium | Default form labels |
| label/small | text-label-small | Small labels/captions |
| caption | text-caption | Fine print, timestamps |
| overline | text-overline | Category labels, eyebrows |

## Effect Styles

| Style Name | Tailwind Class | Purpose |
|------------|----------------|---------|
| shadow/sm | shadow-shadow-sm | Subtle elevation (cards) |
| shadow/md | shadow-shadow-md | Medium elevation (dropdowns) |
| shadow/lg | shadow-shadow-lg | High elevation (modals) |
| shadow/xl | shadow-shadow-xl | Highest elevation (popovers) |
| shadow/inner | shadow-shadow-inner | Inset shadow |
