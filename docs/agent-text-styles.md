# Agent Instructions: Create or Fix Figma Text Styles Using MCP

**For**: Claude Code Agent **Purpose**: Use ClaudeTalkToFigma MCP plugin to create or fix text
styles in Figma **MCP Server**: ClaudeTalkToFigma (port 3000)

---

## Agent Workflow Overview

When the user asks you to create or fix text styles in Figma, follow this workflow:

1. **Audit** - Get existing text styles from Figma
2. **Analyze** - Compare against standard system (36 base styles or 123 complete)
3. **Plan** - Determine what needs to be created/updated
4. **Execute** - Create/update text styles via MCP
5. **Validate** - Verify all styles were created correctly

---

## Step 1: Audit Existing Text Styles

### Get Current Styles

Use the MCP tool to retrieve all text styles:

```typescript
mcp__ClaudeTalkToFigma__get_styles()
```

### Analyze Response

The response will contain:

- `textStyles`: Array of existing text style objects
- Each style has: `id`, `name`, `fontSize`, `fontName`, `fontWeight`, `lineHeight`, `letterSpacing`

### Categorize Findings

Group existing styles into:

1. **Valid styles** - Match standard system (correct size, has line-height, proper naming)
2. **Invalid styles** - Missing properties (line-height, letter-spacing)
3. **Non-standard styles** - Wrong sizes (13px, 15px, 22px)
4. **Missing styles** - Expected styles that don't exist

---

## Step 2: Understand Standard Text Style System

### Core Principle

- **Base Size**: 16px (WCAG recommended)
- **Scale Ratio**: 1.25 (Major Third)
- **Total Base Styles**: 36 styles
- **Complete System**: 123 styles (includes platform-specific)

### Standard Size Scale

Only use these sizes (no exceptions):

```
10px, 12px, 14px, 16px, 18px, 20px, 24px, 28px, 30px, 32px, 34px, 36px, 38px, 48px, 60px, 76px, 96px
```

❌ **Never use**: 13px, 15px, 17px, 19px, 21px, 22px, 23px, 25px, 26px, 27px, 29px, 31px, 33px, 35px

---

## Step 3: Standard Text Styles Specification

### 3.1 Display Styles (5 styles)

Large, impactful text for marketing and heroes.

```
Style: display/hero
  Size: 96px
  Line Height: 104px (1.08)
  Letter Spacing: -0.03em
  Font Weight: Bold (700)
  Font Family: SF Pro
  Use Case: Hero sections, main headlines

Style: display/xl
  Size: 76px
  Line Height: 84px (1.11)
  Letter Spacing: -0.02em
  Font Weight: Bold (700)
  Font Family: SF Pro
  Use Case: Extra large displays

Style: display/lg
  Size: 60px
  Line Height: 68px (1.13)
  Letter Spacing: -0.02em
  Font Weight: Bold (700)
  Font Family: SF Pro
  Use Case: Large displays

Style: display/md
  Size: 48px
  Line Height: 56px (1.17)
  Letter Spacing: -0.02em
  Font Weight: Bold (700)
  Font Family: SF Pro
  Use Case: Medium displays

Style: display/sm
  Size: 38px
  Line Height: 48px (1.26)
  Letter Spacing: -0.01em
  Font Weight: Bold (700)
  Font Family: SF Pro
  Use Case: Small displays
```

---

### 3.2 Heading Styles (5 styles)

Hierarchical headings for content organization.

```
Style: heading/xl
  Size: 36px
  Line Height: 44px (1.22)
  Letter Spacing: -0.01em
  Font Weight: Bold (700)
  Font Family: SF Pro
  Use Case: Page titles, main headings

Style: heading/lg
  Size: 30px
  Line Height: 40px (1.33)
  Letter Spacing: -0.01em
  Font Weight: Bold (700)
  Font Family: SF Pro
  Use Case: Section titles

Style: heading/md
  Size: 24px
  Line Height: 32px (1.33)
  Letter Spacing: 0
  Font Weight: Bold (700)
  Font Family: SF Pro
  Use Case: Subsection titles

Style: heading/sm
  Size: 20px
  Line Height: 28px (1.4)
  Letter Spacing: 0
  Font Weight: Semibold (600)
  Font Family: SF Pro
  Use Case: Minor headings

Style: heading/xs
  Size: 18px
  Line Height: 24px (1.33)
  Letter Spacing: 0
  Font Weight: Semibold (600)
  Font Family: SF Pro
  Use Case: Smallest headings
```

---

### 3.3 Body Text Styles (5 styles)

Primary text styles for readable content.

```
Style: body/xl
  Size: 20px
  Line Height: 32px (1.6)
  Letter Spacing: 0
  Font Weight: Regular (400)
  Font Family: SF Pro
  Use Case: Large body text, intro paragraphs

Style: body/lg
  Size: 18px
  Line Height: 28px (1.56)
  Letter Spacing: 0
  Font Weight: Regular (400)
  Font Family: SF Pro
  Use Case: Emphasized body text

Style: body/md
  Size: 16px
  Line Height: 24px (1.5)
  Letter Spacing: 0
  Font Weight: Regular (400)
  Font Family: SF Pro
  Use Case: DEFAULT body text (most common)

Style: body/sm
  Size: 14px
  Line Height: 20px (1.43)
  Letter Spacing: 0
  Font Weight: Regular (400)
  Font Family: SF Pro
  Use Case: Secondary text

Style: body/xs
  Size: 12px
  Line Height: 16px (1.33)
  Letter Spacing: 0.01em
  Font Weight: Regular (400)
  Font Family: SF Pro
  Use Case: Fine print
```

---

### 3.4 Label Styles (4 styles)

Text for labels, badges, and UI components.

```
Style: label/lg
  Size: 16px
  Line Height: 20px (1.25)
  Letter Spacing: 0.01em
  Font Weight: Medium (500)
  Font Family: SF Pro
  Use Case: Large labels, emphasized

Style: label/md
  Size: 14px
  Line Height: 20px (1.43)
  Letter Spacing: 0.01em
  Font Weight: Medium (500)
  Font Family: SF Pro
  Use Case: Default labels, form fields

Style: label/sm
  Size: 12px
  Line Height: 16px (1.33)
  Letter Spacing: 0.02em
  Font Weight: Medium (500)
  Font Family: SF Pro
  Use Case: Small labels, badges

Style: label/xs
  Size: 10px
  Line Height: 12px (1.2)
  Letter Spacing: 0.02em
  Font Weight: Medium (500)
  Font Family: SF Pro
  Use Case: Tiny labels, tags
```

---

### 3.5 Button Styles (5 styles)

Typography for buttons and CTAs.

```
Style: button/xl
  Size: 20px
  Line Height: 24px (1.2)
  Letter Spacing: 0.02em
  Font Weight: Semibold (600)
  Font Family: SF Pro
  Use Case: Extra large CTAs

Style: button/lg
  Size: 18px
  Line Height: 20px (1.11)
  Letter Spacing: 0.02em
  Font Weight: Semibold (600)
  Font Family: SF Pro
  Use Case: Large buttons

Style: button/md
  Size: 16px
  Line Height: 20px (1.25)
  Letter Spacing: 0.02em
  Font Weight: Semibold (600)
  Font Family: SF Pro
  Use Case: Default buttons

Style: button/sm
  Size: 14px
  Line Height: 16px (1.14)
  Letter Spacing: 0.02em
  Font Weight: Semibold (600)
  Font Family: SF Pro
  Use Case: Small buttons

Style: button/xs
  Size: 12px
  Line Height: 16px (1.33)
  Letter Spacing: 0.02em
  Font Weight: Medium (500)
  Font Family: SF Pro
  Use Case: Tiny buttons
```

---

### 3.6 Link Styles (3 styles)

Text for links and navigation elements.

```
Style: link/lg
  Size: 18px
  Line Height: 28px (1.56)
  Letter Spacing: 0
  Font Weight: Medium (500)
  Font Family: SF Pro
  Use Case: Large standalone links

Style: link/md
  Size: 16px
  Line Height: 24px (1.5)
  Letter Spacing: 0
  Font Weight: Medium (500)
  Font Family: SF Pro
  Use Case: Default inline links

Style: link/sm
  Size: 14px
  Line Height: 20px (1.43)
  Letter Spacing: 0
  Font Weight: Medium (500)
  Font Family: SF Pro
  Use Case: Small links
```

---

### 3.7 Input Styles (5 styles)

Typography for input fields and form elements.

```
Style: input/lg
  Size: 18px
  Line Height: 24px (1.33)
  Letter Spacing: 0
  Font Weight: Regular (400)
  Font Family: SF Pro
  Use Case: Large input fields

Style: input/md
  Size: 16px
  Line Height: 24px (1.5)
  Letter Spacing: 0
  Font Weight: Regular (400)
  Font Family: SF Pro
  Use Case: Default input fields

Style: input/sm
  Size: 14px
  Line Height: 20px (1.43)
  Letter Spacing: 0
  Font Weight: Regular (400)
  Font Family: SF Pro
  Use Case: Compact input fields

Style: input/placeholder
  Size: 16px
  Line Height: 24px (1.5)
  Letter Spacing: 0
  Font Weight: Regular (400)
  Font Family: SF Pro
  Opacity: 60%
  Use Case: Placeholder text

Style: input/helper
  Size: 12px
  Line Height: 16px (1.33)
  Letter Spacing: 0.01em
  Font Weight: Regular (400)
  Font Family: SF Pro
  Use Case: Helper text, error messages
```

---

### 3.8 Caption & Utility Styles (4 styles)

Supporting text for images, tooltips, and metadata.

```
Style: caption/lg
  Size: 14px
  Line Height: 20px (1.43)
  Letter Spacing: 0
  Font Weight: Regular (400)
  Font Family: SF Pro
  Use Case: Large captions

Style: caption/md
  Size: 12px
  Line Height: 16px (1.33)
  Letter Spacing: 0.01em
  Font Weight: Regular (400)
  Font Family: SF Pro
  Use Case: Default captions, tooltips

Style: caption/sm
  Size: 10px
  Line Height: 12px (1.2)
  Letter Spacing: 0.02em
  Font Weight: Regular (400)
  Font Family: SF Pro
  Use Case: Small metadata

Style: overline
  Size: 12px
  Line Height: 16px (1.33)
  Letter Spacing: 0.1em
  Font Weight: Semibold (600)
  Font Family: SF Pro
  Text Case: UPPERCASE
  Use Case: Category labels, eyebrows
```

---

## Step 4: Platform-Specific Styles (Optional)

### 4.1 Navigation Styles (8 styles) - **Critical for Mobile/Web**

```
Style: nav/title
  Size: 17px
  Line Height: 22px (1.29)
  Letter Spacing: -0.01em
  Font Weight: Semibold (600)
  Font Family: SF Pro
  Platform: iOS, Web
  Use Case: Navigation bar title

Style: nav/large-title
  Size: 34px
  Line Height: 41px (1.21)
  Letter Spacing: 0.01em
  Font Weight: Bold (700)
  Font Family: SF Pro
  Platform: iOS
  Use Case: Large navigation title

Style: nav/tab
  Size: 10px
  Line Height: 12px (1.2)
  Letter Spacing: 0.02em
  Font Weight: Medium (500)
  Font Family: SF Pro
  Platform: iOS, Android
  Use Case: Tab bar labels

Style: nav/action
  Size: 17px
  Line Height: 22px (1.29)
  Letter Spacing: 0
  Font Weight: Regular (400)
  Font Family: SF Pro
  Platform: iOS
  Use Case: Nav bar actions

Style: nav/breadcrumb
  Size: 14px
  Line Height: 20px (1.43)
  Letter Spacing: 0
  Font Weight: Regular (400)
  Font Family: SF Pro
  Platform: Web
  Use Case: Breadcrumb navigation

Style: nav/breadcrumb-active
  Size: 14px
  Line Height: 20px (1.43)
  Letter Spacing: 0
  Font Weight: Semibold (600)
  Font Family: SF Pro
  Platform: Web
  Use Case: Active breadcrumb

Style: nav/menu-item
  Size: 16px
  Line Height: 24px (1.5)
  Letter Spacing: 0
  Font Weight: Medium (500)
  Font Family: SF Pro
  Platform: Web
  Use Case: Dropdown menu items

Style: nav/mega-menu-title
  Size: 14px
  Line Height: 20px (1.43)
  Letter Spacing: 0.02em
  Font Weight: Semibold (600)
  Font Family: SF Pro
  Platform: Web
  Use Case: Mega menu section titles
```

---

### 4.2 Alert & Notification Styles (9 styles) - **Critical for User Feedback**

```
Style: alert/title
  Size: 17px
  Line Height: 22px (1.29)
  Letter Spacing: -0.01em
  Font Weight: Semibold (600)
  Font Family: SF Pro
  Platform: All
  Use Case: Alert dialog title

Style: alert/body
  Size: 13px
  Line Height: 18px (1.38)
  Letter Spacing: -0.01em
  Font Weight: Regular (400)
  Font Family: SF Pro
  Platform: iOS, Android
  Use Case: Alert dialog message

Style: alert/body-web
  Size: 14px
  Line Height: 20px (1.43)
  Letter Spacing: 0
  Font Weight: Regular (400)
  Font Family: SF Pro
  Platform: Web
  Use Case: Alert/modal body text

Style: alert/action
  Size: 17px
  Line Height: 22px (1.29)
  Letter Spacing: 0
  Font Weight: Semibold (600)
  Font Family: SF Pro
  Platform: iOS
  Use Case: Alert action buttons

Style: toast/title
  Size: 14px
  Line Height: 20px (1.43)
  Letter Spacing: 0
  Font Weight: Semibold (600)
  Font Family: SF Pro
  Platform: All
  Use Case: Toast notification title

Style: toast/body
  Size: 13px
  Line Height: 18px (1.38)
  Letter Spacing: 0
  Font Weight: Regular (400)
  Font Family: SF Pro
  Platform: All
  Use Case: Toast notification message

Style: banner/title
  Size: 16px
  Line Height: 20px (1.25)
  Letter Spacing: 0
  Font Weight: Semibold (600)
  Font Family: SF Pro
  Platform: Web
  Use Case: Banner message title

Style: banner/body
  Size: 14px
  Line Height: 20px (1.43)
  Letter Spacing: 0
  Font Weight: Regular (400)
  Font Family: SF Pro
  Platform: Web
  Use Case: Banner message body

Style: snackbar/message
  Size: 14px
  Line Height: 20px (1.43)
  Letter Spacing: 0.01em
  Font Weight: Regular (400)
  Font Family: SF Pro
  Platform: Android, Web
  Use Case: Snackbar text
```

---

### 4.3 Form Validation Styles (6 styles) - **Critical for Forms**

```
Style: form/error
  Size: 13px
  Line Height: 18px (1.38)
  Letter Spacing: 0
  Font Weight: Regular (400)
  Font Family: SF Pro
  Color: Use destructive-foreground variable
  Use Case: Inline error messages

Style: form/success
  Size: 13px
  Line Height: 18px (1.38)
  Letter Spacing: 0
  Font Weight: Regular (400)
  Font Family: SF Pro
  Color: Use success-foreground variable
  Use Case: Success messages

Style: form/warning
  Size: 13px
  Line Height: 18px (1.38)
  Letter Spacing: 0
  Font Weight: Regular (400)
  Font Family: SF Pro
  Color: Use warning-foreground variable
  Use Case: Warning messages

Style: form/hint
  Size: 12px
  Line Height: 16px (1.33)
  Letter Spacing: 0
  Font Weight: Regular (400)
  Font Family: SF Pro
  Color: Use muted-foreground variable
  Use Case: Field hints, character count

Style: form/required
  Size: 12px
  Line Height: 16px (1.33)
  Letter Spacing: 0
  Font Weight: Medium (500)
  Font Family: SF Pro
  Use Case: Required field indicator

Style: form/label-inline
  Size: 14px
  Line Height: 20px (1.43)
  Letter Spacing: 0
  Font Weight: Medium (500)
  Font Family: SF Pro
  Use Case: Inline floating labels
```

---

## Step 5: Agent Execution Instructions

### 5.1 Determine User's Request

When user says:

- **"Create text styles"** or **"Set up text styles"** → Create all 36 base styles
- **"Fix text styles"** or **"Update text styles"** → Audit and fix existing
- **"Add navigation styles"** → Add 8 navigation styles
- **"Complete system"** → Create all 123 styles

### 5.2 Ask User for Scope (If Unclear)

Use `AskUserQuestion` tool:

```typescript
AskUserQuestion({
  questions: [
    {
      question: 'Which text style system should I create in Figma?',
      header: 'Text Styles',
      multiSelect: false,
      options: [
        {
          label: 'Base 36 styles',
          description:
            'Essential styles for any project (display, heading, body, label, button, link, input, caption)',
        },
        {
          label: 'Critical 65 styles',
          description: 'Base 36 + Navigation (8) + Alerts (9) + Form Validation (6) + Email (6)',
        },
        {
          label: 'Complete 123 styles',
          description: 'Full cross-platform system (iOS, Android, Web, Email)',
        },
        {
          label: 'Fix existing',
          description: 'Audit and fix current text styles',
        },
      ],
    },
  ],
})
```

### 5.3 Inform Figma Plugin Limitation

**IMPORTANT**: Currently, the ClaudeTalkToFigma MCP plugin does not have direct tools for creating
text style definitions. You can only modify text properties of existing nodes.

When creating text styles, you must:

1. **Inform the user** that text style creation requires manual steps in Figma or plugin updates
2. **Provide the complete specification** in a clear format
3. **Offer to create example text nodes** with the correct properties
4. **Provide a checklist** for manual style creation

### 5.4 Provide Style Creation Checklist

Generate a checklist like this:

```markdown
## Text Styles to Create in Figma

### Step 1: Open Text Styles Panel

In Figma: Right-click text → "Text styles" → "Create style"

### Step 2: Create Each Style

Copy these exact specifications:

#### Display Styles (5 styles)

□ display/hero

- Font: SF Pro Bold
- Size: 96px
- Line height: 104px
- Letter spacing: -0.03em

□ display/xl

- Font: SF Pro Bold
- Size: 76px
- Line height: 84px
- Letter spacing: -0.02em

[... continue for all styles ...]

### Step 3: Verify

After creating styles, ask me to verify them using:

- Get all styles: `mcp__ClaudeTalkToFigma__get_styles()`
- I'll check all 36 styles were created correctly
```

---

## Step 6: Validation After Creation

### 6.1 Get All Styles

```typescript
const styles = await mcp__ClaudeTalkToFigma__get_styles()
```

### 6.2 Check Completeness

Verify:

- ✅ All expected styles exist (36 base, or 65, or 123)
- ✅ All styles have explicit line heights (not "AUTO")
- ✅ Letter spacing is set where specified
- ✅ Font weights are correct
- ✅ Naming follows {category}/{size} pattern

### 6.3 Generate Report

```markdown
## Text Styles Validation Report

✅ **Complete**: 36/36 base styles created

### Display Styles (5/5)

✅ display/hero - 96px, Bold, 104px line-height, -0.03em spacing ✅ display/xl - 76px, Bold, 84px
line-height, -0.02em spacing ✅ display/lg - 60px, Bold, 68px line-height, -0.02em spacing ✅
display/md - 48px, Bold, 56px line-height, -0.02em spacing ✅ display/sm - 38px, Bold, 48px
line-height, -0.01em spacing

[... continue for all categories ...]

### Issues Found: None

All text styles are correctly configured! ✨
```

---

## Step 7: Fixing Existing Styles

### 7.1 Audit Current Styles

```typescript
const styles = await mcp__ClaudeTalkToFigma__get_styles()
```

### 7.2 Categorize Issues

**Missing Line Heights:**

- List all styles where lineHeight.unit === "AUTO"

**Missing Letter Spacing:**

- Compare against specifications above
- List styles that should have spacing but don't

**Non-Standard Sizes:**

- Flag any styles using: 13px, 15px, 17px, 22px, etc.
- Suggest standard replacements

**Missing Styles:**

- Compare existing count vs. expected (36, 65, or 123)
- List specific missing styles

**Naming Issues:**

- Flag styles not following {category}/{size} pattern

### 7.3 Generate Fix Report

```markdown
## Text Styles Audit Report

**Current**: 19 styles **Expected**: 36 base styles **Status**: Incomplete

### Issues Found

#### Missing Line Heights (8 styles)

- page/h1: 36px - Add line-height: 44px
- page/h2: 24px - Add line-height: 32px
- page/body: 14px - Add line-height: 20px [... continue ...]

#### Non-Standard Sizes (3 styles)

- page/h3: 22px → Change to 20px (heading/sm)
- page/subtitle: 15px → Change to 16px (body/md)
- page/caption: 13px → Change to 12px (caption/md)

#### Missing Styles (17 styles)

Display category: Missing all 5 styles (display/hero → display/sm) Body category: Missing 4 styles
(body/xl, body/lg, body/sm, body/xs) [... continue ...]

### Recommended Actions

1. Update existing 8 styles with line heights
2. Resize 3 non-standard styles to standard sizes
3. Create 17 missing styles
4. Rename styles to follow {category}/{size} pattern
```

---

## Step 8: Migration Mapping

When fixing existing styles, use these mappings:

```
Current → Recommended

page/h1 (36px) → heading/xl (36px)
  ✅ Keep size
  + Add line-height: 44px
  + Add letter-spacing: -0.01em

page/h2 (24px) → heading/md (24px)
  ✅ Keep size
  + Add line-height: 32px

page/h3 (22px) → heading/sm (20px)
  ⚠️ Change size to 20px
  + Add line-height: 28px

page/h4 (16px) → heading/xs (18px)
  ⚠️ Change size to 18px
  + Add line-height: 24px

page/title (24px) → heading/md (24px)
  ✅ Keep size
  + Add line-height: 32px

page/subtitle (15px) → body/md (16px)
  ⚠️ Change size to 16px
  + Add line-height: 24px

page/body (14px) → body/md (16px)
  ⚠️ Change size to 16px
  + Add line-height: 24px
  ⚠️ CRITICAL: This affects readability

page/caption (13px) → caption/md (12px)
  ⚠️ Change size to 12px
  + Add line-height: 16px
  + Add letter-spacing: 0.01em

item/title (14px) → label/md (14px)
  ✅ Keep size
  + Add line-height: 20px
  + Add letter-spacing: 0.01em

item/subtitle (12px) → caption/md (12px)
  ✅ Keep size
  + Add line-height: 16px
  + Add letter-spacing: 0.01em

button/lg (18px) → button/lg (18px)
  ✅ Keep size
  + Add line-height: 20px
  + Add letter-spacing: 0.02em

button/default (16px) → button/md (16px)
  ✅ Keep size, rename to button/md
  + Add line-height: 20px
  + Add letter-spacing: 0.02em

button/sm (14px) → button/sm (14px)
  ✅ Keep size
  + Add line-height: 16px
  + Add letter-spacing: 0.02em

button/xs (12px) → button/xs (12px)
  ✅ Keep size
  + Add line-height: 16px
  + Add letter-spacing: 0.02em

button/link (16px) → link/md (16px)
  ✅ Keep size, rename to link/md
  + Add line-height: 24px
  + Change to Medium (500) weight

input/default (16px) → input/md (16px)
  ✅ Keep size, rename to input/md
  + Add line-height: 24px

input/label (14px) → label/md (14px)
  ✅ Keep size
  + Add line-height: 20px
  + Add letter-spacing: 0.01em

input/caption (13px) → input/helper (12px)
  ⚠️ Change size to 12px, rename to input/helper
  + Add line-height: 16px
  + Add letter-spacing: 0.01em

input/lg (20px) → input/lg (18px)
  ⚠️ Change size to 18px
  + Add line-height: 24px
```

---

## Step 9: Communication with User

### 9.1 Initial Response

When user requests text style creation/fixing:

```markdown
I'll help you create/fix text styles in Figma using the ClaudeTalkToFigma MCP plugin.

First, let me audit your current text styles to understand what needs to be done.
```

### 9.2 After Audit

```markdown
## Text Styles Audit Complete

I found [X] existing text styles in your Figma file.

**Issues Found:**

- [x] styles missing line heights
- [x] styles with non-standard sizes
- [x] styles missing from the standard system

**Recommended System:**

- 36 base styles (essential for any project)
- Optional: 87 platform-specific styles (navigation, alerts, forms, etc.)

Would you like me to:

1. Create all missing styles
2. Fix existing styles (add line heights, adjust sizes)
3. Generate a detailed specification for manual creation
```

### 9.3 Plugin Limitation Notice

```markdown
**Note**: The ClaudeTalkToFigma MCP plugin currently doesn't have direct tools for creating text
style definitions in Figma. I can:

✅ Audit existing styles ✅ Provide complete specifications ✅ Generate checklists for manual
creation ✅ Validate after you create them ✅ Create example text nodes with correct properties

❌ Cannot automatically create style definitions (requires plugin update)

I'll provide you with a complete, copy-paste-ready specification that you can use to create styles
in Figma.
```

### 9.4 Provide Actionable Output

Always give users:

1. **Complete specification** - Ready to copy into Figma
2. **Numbered checklist** - Step-by-step creation guide
3. **Validation command** - How to verify afterward
4. **Migration guide** - How to update existing designs

---

## Step 10: Style Specifications for User

### Format Specification Clearly

When providing specs to user, use this format:

```markdown
## Complete Text Style Specifications

### How to Create in Figma

1. Select any text layer
2. Right-click → "Text styles" → "Create style"
3. Name the style exactly as shown below
4. Set properties as specified
5. Click "Create style"

---

### Display Styles (5 styles)

#### 1. display/hero
```

Name: display/hero Font: SF Pro Bold (or your brand font) Size: 96px Line height: 104 Letter
spacing: -0.03em (or -2.88px)

```

#### 2. display/xl
```

Name: display/xl Font: SF Pro Bold Size: 76px Line height: 84 Letter spacing: -0.02em (or -1.52px)

```

[... continue with clear, copy-paste format ...]
```

---

## Step 11: Validation Commands

Teach user how to verify:

```markdown
## After Creating Styles

Ask me to validate by saying:

- "Validate text styles"
- "Check if all styles are correct"
- "Audit text styles"

I'll use the MCP plugin to verify: ✅ All 36 styles exist ✅ Line heights are set correctly ✅
Letter spacing is applied ✅ Font weights are correct ✅ Naming is consistent
```

---

## Summary: Agent Decision Tree

```
User requests text styles
    ↓
Get existing styles via MCP
    ↓
Analyze current state
    ↓
┌─────────────────┬─────────────────┐
│                 │                 │
0 styles        1-20 styles      36+ styles
│                 │                 │
↓                 ↓                 ↓
Create new    Fix + Add        Validate only
    │                 │                 │
    └─────────────────┴─────────────────┘
                      ↓
            Ask user for scope
                      ↓
        Generate specifications
                      ↓
         Provide checklist
                      ↓
      Wait for user to create
                      ↓
         Validate via MCP
                      ↓
          Generate report
```

---

## Key Agent Behaviors

### ✅ DO:

- Always audit first before recommending changes
- Use `AskUserQuestion` if scope is unclear
- Provide complete, actionable specifications
- Generate clear checklists
- Validate after user creates styles
- Explain plugin limitations upfront

### ❌ DON'T:

- Don't try to use non-existent MCP tools for style creation
- Don't assume user wants all 123 styles (ask first)
- Don't skip validation after creation
- Don't provide incomplete specifications
- Don't forget to mention line heights (critical!)

---

## WCAG Accessibility Requirements

Always validate these requirements:

✅ **Text Size**

- Minimum body text: 16px (body/md)
- Minimum acceptable: 10px (label/xs, caption/sm)

✅ **Line Height**

- Body text: 1.5 minimum (24px for 16px text)
- Headings: 1.2 minimum
- Buttons/Labels: 1.25 minimum

✅ **Letter Spacing**

- Small text (10-14px): Positive spacing improves legibility
- Large text (48px+): Negative spacing acceptable
- Uppercase: Wide spacing (0.05em-0.1em)

✅ **Contrast**

- Normal text (< 18px): 4.5:1 minimum (AA)
- Large text (≥ 18px): 3:1 minimum (AA)

---

**Version**: 2.0 (Agent Instructions) **Updated**: 2025-11-20 **For**: Claude Code Agent using
ClaudeTalkToFigma MCP **Plugin**: ClaudeTalkToFigma (WebSocket port 3000)
