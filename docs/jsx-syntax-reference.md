# JSX + Tailwind Syntax Reference

Bidirectional format used by `get_selection`, `get_node_info`, and `jsx_to_figma`.

---

## Elements

### Text Nodes (→ Figma TEXT)

```
span, p, h1–h6, a, label, small, strong, em, b, i, u, s
```

Heading defaults: `h1` = 36px bold, `h2` = 30px bold, … `h6` = 16px semibold.

### Frame Nodes (→ Figma FRAME)

```
div, section, article, nav, header, footer, main, aside, form,
button, input, select, textarea, ul, ol, li, table, tr, td, th, img
```

Tag defaults: `button` → HUG + centered, `input` → 240×40 + border, `img` → 100×100 + image fill.

### SVG Nodes (→ Figma VECTOR)

```jsx
<svg name="icon" className="w-[20px] h-[20px] border-[1.5px] border-text-primary" width="20" height="20" />
```

Raw SVG markup is preserved. `border-*` classes map to strokes.

### Components (PascalCase → Figma COMPONENT / INSTANCE)

```jsx
<Button mainComponentName="Button" className="...">Click</Button>
```

---

## Attributes

| Attribute | Purpose |
|-----------|---------|
| `id` | Existing Figma node ID — triggers **update** instead of create |
| `name` | Node name in layers panel |
| `data-name` | Alternative name (overrides `name`; enables `Icon/*` placeholders) |
| `className` | Tailwind classes (see below) |
| `style` | Inline CSS object or string (see Style section) |
| `width`, `height` | SVG dimensions |
| `mainComponentId` | Instance → main component reference |
| `mainComponentName` | Instance → main component by name |
| `textStyleId` | Bound text style ID |
| `effectStyleId` | Bound effect style ID |
| `bindingIds` | Variable binding map |
| `componentProperties` | Instance property overrides |
| `variantProperties` | Component variant key-values |
| `propertyDefinitions` | Component set property schema |

---

## Tailwind Classes

### Layout

| Class | Figma Property |
|-------|---------------|
| `flex` | Auto-layout enabled |
| `flex-row` | `layoutMode: "HORIZONTAL"` |
| `flex-col` | `layoutMode: "VERTICAL"` |
| `justify-center` | `primaryAxisAlignItems: "CENTER"` |
| `justify-end` | `primaryAxisAlignItems: "MAX"` |
| `justify-between` | `primaryAxisAlignItems: "SPACE_BETWEEN"` |
| `items-center` | `counterAxisAlignItems: "CENTER"` |
| `items-end` | `counterAxisAlignItems: "MAX"` |
| `items-baseline` | `counterAxisAlignItems: "BASELINE"` |
| `flex-wrap` | `layoutWrap: "WRAP"` |
| `overflow-hidden` | `clipsContent: true` |
| `relative` | Non-layout container |
| `absolute` | Absolute positioning |
| `inset-0` | Fill parent (absolute) |

### Sizing

| Class | Figma Property |
|-------|---------------|
| `w-[Npx]` | Fixed width |
| `h-[Npx]` | Fixed height |
| `w-full`, `h-full` | `layoutSizingHorizontal/Vertical: "FILL"` |
| `w-auto`, `w-fit` | `layoutSizingHorizontal: "HUG"` |
| `h-auto`, `h-fit` | `layoutSizingVertical: "HUG"` |
| `flex-1` | Fill parent (in layout axis) |
| `w-screen` | 1440px |
| `h-screen` | 900px |
| `shrink-0` | Prevents shrinking |

### Spacing

| Class | Figma Property |
|-------|---------------|
| `p-[Npx]` | Uniform padding |
| `px-[Npx]` | Horizontal padding |
| `py-[Npx]` | Vertical padding |
| `pt-`, `pr-`, `pb-`, `pl-` | Per-side padding |
| `gap-[Npx]` | `itemSpacing` |
| `gap-x-[Npx]` | Horizontal gap (wrap layouts) |
| `gap-y-[Npx]` | Vertical gap (wrap layouts) |

**Variable binding:** `p-space-4` → binds to variable `space/4`. Same for `gap-space-2`, `px-space-5`, etc.

### Colors & Backgrounds

| Class | Figma Property |
|-------|---------------|
| `bg-[#RRGGBB]` | Solid fill (hex) |
| `bg-[#RRGGBB]/[opacity]` | Fill with opacity |
| `bg-red-500` | Tailwind palette color |
| `bg-background-primary` | Variable binding → `background/primary` |
| `bg-brand-accent` | Variable binding → `brand/accent` |
| `bg-gradient-to-r` | Linear gradient (direction: r, l, t, b, tr, tl, br, bl) |
| `from-[#hex]` | Gradient start |
| `via-[#hex]` | Gradient middle |
| `to-[#hex]` | Gradient end |
| `bg-cover bg-center` | Image fill indicator |

### Text Colors

| Class | Figma Property |
|-------|---------------|
| `text-[#RRGGBB]` | Text fill color |
| `text-text-primary` | Variable binding → `text/primary` |
| `text-text-secondary` | Variable binding → `text/secondary` |

### Typography

| Class | Figma Property |
|-------|---------------|
| `text-[Npx]` | Font size (arbitrary) |
| `text-sm`, `text-base`, `text-lg`, `text-xl`, `text-2xl`… | Standard sizes |
| `text-text-heading-h1` | Text style binding → `text/heading-h1` |
| `text-text-body-md` | Text style binding → `text/body-md` |
| `font-normal`, `font-medium`, `font-semibold`, `font-bold` | Font weight |
| `font-[N]` | Custom weight (100–900) |
| `font-['Family_Name']` | Font family (underscores → spaces) |
| `leading-[Npx]`, `leading-[N%]` | Line height |
| `leading-tight`, `leading-normal`, `leading-relaxed` | Standard line heights |
| `tracking-[Npx]`, `tracking-[Nem]` | Letter spacing |
| `text-center`, `text-right`, `text-justify` | Text alignment |
| `uppercase`, `lowercase`, `capitalize` | Text case |
| `underline`, `line-through` | Text decoration |

### Borders & Strokes

| Class | Figma Property |
|-------|---------------|
| `border` | 1px stroke |
| `border-[Npx]` | Arbitrary stroke width |
| `border-2`, `border-4`, `border-8` | Standard widths |
| `border-t-[Npx]`, `border-b-[Npx]`… | Per-side stroke |
| `border-[#RRGGBB]` | Stroke color (hex) |
| `border-border-default` | Variable binding → `border/default` |
| `border-red-500` | Tailwind palette stroke color |

### Corners

| Class | Figma Property |
|-------|---------------|
| `rounded` | 4px radius |
| `rounded-[Npx]` | Arbitrary radius |
| `rounded-sm`, `rounded-md`, `rounded-lg`, `rounded-xl`, `rounded-2xl`, `rounded-3xl` | Standard sizes |
| `rounded-full` | 9999px (pill shape) |
| `rounded-tl-[Npx]`, `rounded-tr-[Npx]`, `rounded-bl-[Npx]`, `rounded-br-[Npx]` | Per-corner |

### Effects

| Class | Figma Property |
|-------|---------------|
| `shadow`, `shadow-sm`, `shadow-md`, `shadow-lg`, `shadow-xl`, `shadow-2xl` | Drop shadow |
| `blur-[Npx]` | Layer blur |
| `backdrop-blur-[Npx]` | Background blur |

### Opacity

| Class | Figma Property |
|-------|---------------|
| `opacity-[0.5]` | Node opacity (0–1) |
| `opacity-50` | Standard opacity (0–100 scale) |

---

## Style Attribute

For properties not expressible via Tailwind:

```jsx
<div style={{
  boxShadow: "0px 2px 4px 0px rgba(0,0,0,0.10)",
  background: "linear-gradient(...)",
  backgroundImage: "url(https://...)",
  transform: "rotate(45deg)",
  color: "#333",
  fontFamily: "Inter",
  borderColor: "#ccc",
  borderRadius: "8px",
  borderWidth: "1px",
  padding: "10px 20px",
  opacity: "0.8"
}} />
```

---

## Variable Binding Convention

Tailwind class names with dashes auto-bind to Figma variables with slashes:

| Class Pattern | Variable Bound |
|--------------|---------------|
| `bg-background-primary` | `background/primary` |
| `text-text-secondary` | `text/secondary` |
| `border-border-default` | `border/default` |
| `gap-space-4` | `space/4` |
| `p-space-6` | `space/6` |
| `text-text-heading-h1` | Text style `text/heading-h1` |
| `text-text-body-md` | Text style `text/body-md` |
| `rounded-radius-md` | `radius/md` |
| `bg-brand-primary` | `brand/primary` |

---

## Post-Processing Rules

1. **CSS flexbox stretch default**: Children of a flex container FILL on the cross-axis (matching `align-items: stretch`) unless the parent sets `items-center`/`items-end`/`items-baseline`.
2. **flex-N resolution**: All `flex-1`, `flex-2`, etc. map to `FILL` (Figma doesn't support weighted flex).
3. **Icon placeholders**: `<div data-name="Icon/save" className="w-[24px] h-[24px] shrink-0" />` — strips strokes from Icon/* frames.

---

## Full Example

```jsx
<div name="Card" className="flex flex-col gap-space-4 p-space-6 bg-background-primary border-[1px] border-border-default rounded-xl shadow-md">
  <span name="Title" className="text-text-primary text-text-heading-h2">
    Welcome Back
  </span>
  <span name="Subtitle" className="text-text-secondary text-text-body-md">
    Sign in to continue
  </span>
  <div name="Input" className="flex flex-row items-center gap-space-2 h-[48px] px-space-4 bg-background-tertiary border-[1px] border-border-default rounded-lg">
    <span name="Placeholder" className="flex-1 text-text-tertiary text-text-body-md">
      Email address
    </span>
  </div>
  <div name="Button" className="flex justify-center items-center h-[52px] bg-brand-primary rounded-xl">
    <span name="Label" className="text-text-inverse text-text-label-lg">
      Sign In
    </span>
  </div>
</div>
```
