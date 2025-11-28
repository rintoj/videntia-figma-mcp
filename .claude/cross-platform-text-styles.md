# Cross-Platform Typography System
## Complete Style Guide for Mobile, Web & Email

**Platforms Covered**: iOS, Android, Web (Desktop/Mobile), Email
**Total Styles**: 78 (36 base + 42 specialized)

---

## 🆕 Additional Styles Needed

### Navigation Styles (8 styles)

Essential for mobile apps and web navigation.

| Style Name | Size | Line Height | Letter Spacing | Weight | Platform | Use Case |
|------------|------|-------------|----------------|--------|----------|----------|
| `nav/title` | 17px | 22px (1.29) | -0.01em | Semibold (600) | iOS, Web | Navigation bar title |
| `nav/large-title` | 34px | 41px (1.21) | 0.01em | Bold (700) | iOS | Large navigation title |
| `nav/tab` | 10px | 12px (1.2) | 0.02em | Medium (500) | iOS, Android | Tab bar labels |
| `nav/action` | 17px | 22px (1.29) | 0 | Regular (400) | iOS | Nav bar actions |
| `nav/breadcrumb` | 14px | 20px (1.43) | 0 | Regular (400) | Web | Breadcrumb navigation |
| `nav/breadcrumb-active` | 14px | 20px (1.43) | 0 | Semibold (600) | Web | Active breadcrumb |
| `nav/menu-item` | 16px | 24px (1.5) | 0 | Medium (500) | Web | Dropdown menu items |
| `nav/mega-menu-title` | 14px | 20px (1.43) | 0.02em | Semibold (600) | Web | Mega menu section titles |

**Platform-Specific Notes:**
- **iOS**: Uses 17px for nav titles (HIG standard)
- **Android**: Uses 20sp (~20px) for app bar titles
- **Web**: More flexible, 16-18px typical

---

### Alert & Notification Styles (9 styles)

System messages, toasts, banners, and alerts.

| Style Name | Size | Line Height | Letter Spacing | Weight | Platform | Use Case |
|------------|------|-------------|----------------|--------|----------|----------|
| `alert/title` | 17px | 22px (1.29) | -0.01em | Semibold (600) | All | Alert dialog title |
| `alert/body` | 13px | 18px (1.38) | -0.01em | Regular (400) | iOS, Android | Alert dialog message |
| `alert/body-web` | 14px | 20px (1.43) | 0 | Regular (400) | Web | Alert/modal body text |
| `alert/action` | 17px | 22px (1.29) | 0 | Semibold (600) | iOS | Alert action buttons |
| `toast/title` | 14px | 20px (1.43) | 0 | Semibold (600) | All | Toast notification title |
| `toast/body` | 13px | 18px (1.38) | 0 | Regular (400) | All | Toast notification message |
| `banner/title` | 16px | 20px (1.25) | 0 | Semibold (600) | Web | Banner message title |
| `banner/body` | 14px | 20px (1.43) | 0 | Regular (400) | Web | Banner message body |
| `snackbar/message` | 14px | 20px (1.43) | 0.01em | Regular (400) | Android, Web | Snackbar text |

**Design Notes:**
- iOS alerts use smaller text (13px) than web
- Toast notifications should be brief, concise text
- Banners can have more content than toasts

---

### Badge & Status Styles (6 styles)

Notification counts, status indicators, chips.

| Style Name | Size | Line Height | Letter Spacing | Weight | Platform | Use Case |
|------------|------|-------------|----------------|--------|----------|----------|
| `badge/number` | 12px | 16px (1.33) | 0 | Semibold (600) | All | Notification count badges |
| `badge/small` | 10px | 12px (1.2) | 0.02em | Semibold (600) | All | Small status badges |
| `badge/dot` | — | — | — | — | All | Dot indicator (no text) |
| `chip/label` | 13px | 18px (1.38) | 0.01em | Medium (500) | All | Chip/tag labels |
| `chip/small` | 11px | 14px (1.27) | 0.02em | Medium (500) | All | Small chips |
| `status/label` | 12px | 16px (1.33) | 0.05em + UPPERCASE | Semibold (600) | All | Status labels (ACTIVE, PENDING) |

**Implementation:**
- Badges often use circular/pill backgrounds
- Status labels typically uppercase
- Chips are interactive, removable tags

---

### Table & Data Display Styles (8 styles)

Tables, data grids, pricing tables.

| Style Name | Size | Line Height | Letter Spacing | Weight | Platform | Use Case |
|------------|------|-------------|----------------|--------|----------|----------|
| `table/header` | 12px | 16px (1.33) | 0.05em + UPPERCASE | Semibold (600) | Web | Table column headers |
| `table/cell` | 14px | 20px (1.43) | 0 | Regular (400) | Web | Table cell content |
| `table/cell-numeric` | 14px | 20px (1.43) | 0 + tabular-nums | Medium (500) | Web | Numeric table data |
| `table/footer` | 13px | 18px (1.38) | 0 | Medium (500) | Web | Table footer/summary |
| `data/number-lg` | 48px | 56px (1.17) | -0.02em + tabular-nums | Bold (700) | All | Large stat numbers |
| `data/number-md` | 32px | 40px (1.25) | -0.01em + tabular-nums | Bold (700) | All | Medium stat numbers |
| `data/number-sm` | 24px | 32px (1.33) | 0 + tabular-nums | Semibold (600) | All | Small stat numbers |
| `data/label` | 12px | 16px (1.33) | 0.02em + UPPERCASE | Medium (500) | All | Data labels/metrics |

**Typography Features:**
- Use `tabular-nums` (monospace digits) for alignment
- Headers often uppercase and smaller than cells
- Numeric data right-aligned with consistent width

---

### List Styles (6 styles)

List items for mobile and web.

| Style Name | Size | Line Height | Letter Spacing | Weight | Platform | Use Case |
|------------|------|-------------|----------------|--------|----------|----------|
| `list/primary` | 17px | 22px (1.29) | -0.01em | Regular (400) | iOS | Primary list item text |
| `list/secondary` | 15px | 20px (1.33) | -0.01em | Regular (400) | iOS | Secondary list item text |
| `list/primary-web` | 16px | 24px (1.5) | 0 | Regular (400) | Web | Web list primary text |
| `list/secondary-web` | 14px | 20px (1.43) | 0 | Regular (400) | Web | Web list secondary text |
| `list/tertiary` | 12px | 16px (1.33) | 0 | Regular (400) | All | Tertiary list text |
| `list/bullet` | 14px | 24px (1.71) | 0 | Regular (400) | Web | Bulleted/numbered lists |

**Platform Differences:**
- iOS uses 17px/15px for list items
- Android uses 16px/14px
- Web can match either, typically 16px/14px

---

### Quote & Content Styles (5 styles)

Blockquotes, pull quotes, testimonials.

| Style Name | Size | Line Height | Letter Spacing | Weight | Platform | Use Case |
|------------|------|-------------|----------------|--------|----------|----------|
| `quote/blockquote` | 20px | 32px (1.6) | 0 | Regular (400) + italic | Web | Blockquotes in articles |
| `quote/pullquote` | 24px | 36px (1.5) | -0.01em | Medium (500) | Web | Pull quotes, highlights |
| `quote/testimonial` | 18px | 28px (1.56) | 0 | Regular (400) + italic | Web | Customer testimonials |
| `quote/attribution` | 14px | 20px (1.43) | 0 | Medium (500) | Web | Quote author attribution |
| `quote/citation` | 12px | 16px (1.33) | 0 | Regular (400) + italic | Web | Source citations |

**Styling:**
- Often use italic style
- May include quotation marks or styling
- Attribution typically smaller, medium weight

---

### Pricing & Commerce Styles (7 styles)

Pricing tables, product prices, discounts.

| Style Name | Size | Line Height | Letter Spacing | Weight | Platform | Use Case |
|------------|------|-------------|----------------|--------|----------|----------|
| `price/hero` | 60px | 68px (1.13) | -0.02em + tabular-nums | Bold (700) | Web | Large hero pricing |
| `price/large` | 48px | 56px (1.17) | -0.02em + tabular-nums | Bold (700) | All | Pricing table featured |
| `price/medium` | 32px | 40px (1.25) | -0.01em + tabular-nums | Bold (700) | All | Standard pricing |
| `price/small` | 20px | 28px (1.4) | 0 + tabular-nums | Semibold (600) | All | Small price displays |
| `price/currency` | 24px | 32px (1.33) | 0 | Semibold (600) | All | Currency symbol (smaller) |
| `price/period` | 14px | 20px (1.43) | 0 | Regular (400) | All | "/month", "/year" text |
| `price/strikethrough` | 20px | 28px (1.4) | 0 + tabular-nums | Regular (400) | All | Original price (crossed) |

**Design Patterns:**
- Currency symbol often smaller than price
- Period text smaller and lighter
- Use tabular numbers for alignment
- Strikethrough for discounts

---

### Empty State & Onboarding Styles (6 styles)

Empty states, onboarding, intro screens.

| Style Name | Size | Line Height | Letter Spacing | Weight | Platform | Use Case |
|------------|------|-------------|----------------|--------|----------|----------|
| `empty/title` | 24px | 32px (1.33) | -0.01em | Bold (700) | All | Empty state title |
| `empty/body` | 16px | 24px (1.5) | 0 | Regular (400) | All | Empty state description |
| `onboard/title` | 28px | 36px (1.29) | -0.01em | Bold (700) | Mobile | Onboarding screen title |
| `onboard/body` | 17px | 26px (1.53) | 0 | Regular (400) | Mobile | Onboarding description |
| `intro/hero` | 36px | 44px (1.22) | -0.01em | Bold (700) | All | Intro/welcome title |
| `intro/subtitle` | 18px | 28px (1.56) | 0 | Regular (400) | All | Intro subtitle |

**Best Practices:**
- Empty states should be friendly, encouraging
- Onboarding text should be concise
- Use larger, more spacious text

---

### Form Validation & Feedback Styles (6 styles)

Error messages, success messages, field hints.

| Style Name | Size | Line Height | Letter Spacing | Weight | Platform | Use Case |
|------------|------|-------------|----------------|--------|----------|----------|
| `form/error` | 13px | 18px (1.38) | 0 | Regular (400) | All | Inline error messages |
| `form/success` | 13px | 18px (1.38) | 0 | Regular (400) | All | Success messages |
| `form/warning` | 13px | 18px (1.38) | 0 | Regular (400) | All | Warning messages |
| `form/hint` | 12px | 16px (1.33) | 0 | Regular (400) | All | Field hints, character count |
| `form/required` | 12px | 16px (1.33) | 0 | Medium (500) | All | Required field indicator |
| `form/label-inline` | 14px | 20px (1.43) | 0 | Medium (500) | All | Inline floating labels |

**Color Associations:**
- Error: Red text
- Success: Green text
- Warning: Orange/yellow text
- Hint: Gray/muted text

---

### Email-Specific Styles (12 styles)

Email clients have unique requirements.

| Style Name | Size | Line Height | Letter Spacing | Weight | Platform | Use Case |
|------------|------|-------------|----------------|--------|----------|----------|
| `email/subject` | 18px | 24px (1.33) | 0 | Semibold (600) | Email | Email subject preview |
| `email/preheader` | 14px | 20px (1.43) | 0 | Regular (400) | Email | Preheader text |
| `email/h1` | 28px | 36px (1.29) | -0.01em | Bold (700) | Email | Email main heading |
| `email/h2` | 22px | 30px (1.36) | 0 | Bold (700) | Email | Email subheading |
| `email/body` | 16px | 24px (1.5) | 0 | Regular (400) | Email | Email body text |
| `email/body-large` | 18px | 28px (1.56) | 0 | Regular (400) | Email | Emphasized email text |
| `email/button` | 16px | 22px (1.38) | 0.02em | Semibold (600) | Email | Email CTA buttons |
| `email/button-large` | 18px | 24px (1.33) | 0.02em | Bold (700) | Email | Large email CTAs |
| `email/footer` | 12px | 18px (1.5) | 0 | Regular (400) | Email | Footer text, legal |
| `email/unsubscribe` | 11px | 16px (1.45) | 0 | Regular (400) | Email | Unsubscribe link |
| `email/table-cell` | 14px | 20px (1.43) | 0 | Regular (400) | Email | Email table content |
| `email/disclaimer` | 10px | 15px (1.5) | 0 | Regular (400) | Email | Legal disclaimers |

**Email Client Considerations:**
- Use larger line heights (email clients vary)
- Avoid small text (< 10px may not render)
- Body text should be 16-18px minimum
- Buttons need sufficient padding/line-height
- Always test in Gmail, Outlook, Apple Mail

---

### Pagination & Navigation Aids (5 styles)

Page numbers, step indicators, progress.

| Style Name | Size | Line Height | Letter Spacing | Weight | Platform | Use Case |
|------------|------|-------------|----------------|--------|----------|----------|
| `pagination/number` | 14px | 20px (1.43) | 0 | Regular (400) | Web | Page numbers |
| `pagination/active` | 14px | 20px (1.43) | 0 | Semibold (600) | Web | Active page number |
| `stepper/label` | 14px | 20px (1.43) | 0 | Medium (500) | All | Step labels |
| `stepper/number` | 16px | 24px (1.5) | 0 | Semibold (600) | All | Step numbers |
| `progress/label` | 12px | 16px (1.33) | 0 | Medium (500) | All | Progress indicators |

---

### Legal & Footer Styles (5 styles)

Legal text, copyright, disclaimers.

| Style Name | Size | Line Height | Letter Spacing | Weight | Platform | Use Case |
|------------|------|-------------|----------------|--------|----------|----------|
| `legal/default` | 11px | 16px (1.45) | 0 | Regular (400) | All | Legal text, terms |
| `legal/small` | 10px | 14px (1.4) | 0 | Regular (400) | All | Fine print |
| `footer/text` | 12px | 18px (1.5) | 0 | Regular (400) | Web | Footer content |
| `footer/link` | 12px | 18px (1.5) | 0 | Regular (400) | Web | Footer links |
| `copyright` | 11px | 16px (1.45) | 0 | Regular (400) | All | Copyright notices |

**Compliance:**
- Legal text must be readable (11px minimum)
- Some regulations require minimum sizes
- Adequate line height for legibility

---

### Loading & System States (4 styles)

Loading messages, system feedback.

| Style Name | Size | Line Height | Letter Spacing | Weight | Platform | Use Case |
|------------|------|-------------|----------------|--------|----------|----------|
| `loading/message` | 14px | 20px (1.43) | 0 | Regular (400) | All | Loading state text |
| `loading/title` | 16px | 24px (1.5) | 0 | Semibold (600) | All | Loading title |
| `placeholder/text` | 16px | 24px (1.5) | 0 | Regular (400) + 40% opacity | All | Skeleton/placeholder |
| `offline/message` | 14px | 20px (1.43) | 0 | Regular (400) | All | Offline state message |

---

## Complete System Summary

### Total Style Count by Category

| Category | Base Styles | Additional Styles | Total | Priority |
|----------|-------------|-------------------|-------|----------|
| Display | 5 | 0 | 5 | Medium |
| Heading | 5 | 0 | 5 | High |
| Body | 5 | 0 | 5 | Critical |
| Label | 4 | 0 | 4 | High |
| Button | 5 | 0 | 5 | Critical |
| Link | 3 | 0 | 3 | High |
| Input | 5 | 0 | 5 | Critical |
| Caption/Utility | 4 | 0 | 4 | Medium |
| **Navigation** | 0 | 8 | 8 | **Critical** |
| **Alert/Notification** | 0 | 9 | 9 | **Critical** |
| **Badge/Status** | 0 | 6 | 6 | **High** |
| **Table/Data** | 0 | 8 | 8 | **High** |
| **List** | 0 | 6 | 6 | **High** |
| **Quote/Content** | 0 | 5 | 5 | **Medium** |
| **Pricing** | 0 | 7 | 7 | **High** |
| **Empty State** | 0 | 6 | 6 | **Medium** |
| **Form Validation** | 0 | 6 | 6 | **Critical** |
| **Email** | 0 | 12 | 12 | **Critical** |
| **Pagination** | 0 | 5 | 5 | **Low** |
| **Legal/Footer** | 0 | 5 | 5 | **Medium** |
| **Loading/System** | 0 | 4 | 4 | **Medium** |
| **TOTAL** | **36** | **87** | **123** | — |

---

## Platform-Specific Considerations

### iOS Design Guidelines (Human Interface Guidelines)

**Standard Text Sizes:**
```
Large Title:  34pt (34px) - Regular/Bold
Title 1:      28pt (28px) - Regular/Bold
Title 2:      22pt (22px) - Regular/Bold
Title 3:      20pt (20px) - Regular/Semibold
Headline:     17pt (17px) - Semibold
Body:         17pt (17px) - Regular
Callout:      16pt (16px) - Regular
Subheadline:  15pt (15px) - Regular
Footnote:     13pt (13px) - Regular
Caption 1:    12pt (12px) - Regular
Caption 2:    11pt (11px) - Regular
```

**Dynamic Type Support:**
- iOS supports dynamic type (user-adjustable text size)
- Recommended: Create responsive text styles
- Use SF Pro font family (Apple's system font)

### Android Material Design Guidelines

**Standard Text Sizes:**
```
H1: 96sp - Light
H2: 60sp - Light
H3: 48sp - Regular
H4: 34sp - Regular
H5: 24sp - Regular
H6: 20sp - Medium
Subtitle 1: 16sp - Regular
Subtitle 2: 14sp - Medium
Body 1: 16sp - Regular
Body 2: 14sp - Regular
Button: 14sp - Medium (Uppercase)
Caption: 12sp - Regular
Overline: 10sp - Regular (Uppercase)
```

**Note:** sp (scale-independent pixels) ≈ px on standard density

### Web Responsive Breakpoints

**Font Size Scaling:**
```
Mobile (< 640px):
  - Base: 16px
  - Display sizes: Scale down 30-50%
  - Example: display/hero 96px → 48px

Tablet (640-1024px):
  - Base: 16px
  - Display sizes: Scale down 20-30%
  - Example: display/hero 96px → 60px

Desktop (> 1024px):
  - Base: 16px
  - Use full sizes
```

### Email Client Support

**Safe Font Sizes:**
- Minimum: 11px (10px may not render in Outlook)
- Body text: 16-18px (larger than web)
- Line height: 1.5-1.7 (more generous)

**Client-Specific Issues:**
- Outlook: Limited CSS support, use tables
- Gmail: Strips some styles, test thoroughly
- Apple Mail: Best CSS support
- Mobile email: Use larger touch targets (48px min)

---

## Implementation Priority

### Phase 1: Critical (Week 1-2)
Must-have for functional product across all platforms.

**Top Priority (36 styles):**
- ✅ All base 36 styles from original system
- ✅ Navigation (8 styles) - Essential for mobile apps
- ✅ Alert/Notification (9 styles) - System feedback
- ✅ Form Validation (6 styles) - User feedback
- ✅ Email basics (6 styles) - If using email

**Total Phase 1: 65 styles**

### Phase 2: High Priority (Week 3-4)
Important for polished, professional product.

**High Priority (27 styles):**
- Badge/Status (6 styles)
- Table/Data (8 styles)
- List (6 styles)
- Pricing (7 styles)

**Total Phase 2: 27 styles**

### Phase 3: Medium Priority (Week 5-6)
Enhances user experience, content-rich sites.

**Medium Priority (20 styles):**
- Quote/Content (5 styles)
- Empty State (6 styles)
- Email advanced (6 styles)
- Legal/Footer (5 styles)
- Loading/System (4 styles)
- Display sizes (5 styles - if marketing-heavy)

**Total Phase 3: 31 styles**

### Phase 4: Optional (Week 7+)
Nice-to-have for specialized use cases.

**Low Priority:**
- Pagination (5 styles)
- Advanced data visualizations
- Platform-specific variants

---

## Phased Implementation Checklist

### ✅ Phase 1: Core System (Week 1-2)
- [ ] Implement 36 base styles with line heights
- [ ] Add 8 navigation styles (critical for mobile)
- [ ] Add 9 alert/notification styles
- [ ] Add 6 form validation styles
- [ ] Add 6 email styles (h1, h2, body, button, footer, preheader)
- [ ] Test on iOS, Android, Web, Email clients
- [ ] **Deliverable**: Functional cross-platform design system

### ✅ Phase 2: Data & Commerce (Week 3-4)
- [ ] Add 6 badge/status styles
- [ ] Add 8 table/data styles
- [ ] Add 6 list styles
- [ ] Add 7 pricing styles
- [ ] Create example components using new styles
- [ ] **Deliverable**: E-commerce and data-ready system

### ✅ Phase 3: Content & Polish (Week 5-6)
- [ ] Add 5 quote/content styles
- [ ] Add 6 empty state styles
- [ ] Add 6 additional email styles
- [ ] Add 5 legal/footer styles
- [ ] Add 4 loading/system styles
- [ ] Create style guide documentation
- [ ] **Deliverable**: Content-rich, polished system

### ✅ Phase 4: Refinement (Week 7+)
- [ ] Add pagination styles if needed
- [ ] Create platform-specific variants
- [ ] Add responsive breakpoint variants
- [ ] Export design tokens for all platforms
- [ ] Train team on system usage
- [ ] **Deliverable**: Complete, production-ready system

---

## Platform-Specific Style Guides

### iOS App Styles (Essential 25)

**Navigation:**
- nav/large-title (34px)
- nav/title (17px)
- nav/tab (10px)
- nav/action (17px)

**Content:**
- body/md (17px) - iOS standard
- heading/md (22px)
- heading/sm (20px)

**Lists:**
- list/primary (17px)
- list/secondary (15px)
- list/tertiary (12px)

**System:**
- alert/title (17px)
- alert/body (13px)
- alert/action (17px)
- badge/number (12px)
- badge/small (10px)

**Forms:**
- input/md (17px) - iOS standard
- input/helper (13px)
- form/error (13px)

### Android App Styles (Essential 25)

Similar to iOS, with Material Design adjustments:
- Adjust sizes to Material Design scale
- Use uppercase for buttons (optional)
- Follow Material motion/spacing

### Web Styles (Essential 40)

Core web styles needed:
- All base 36 styles
- nav/breadcrumb
- table/* (8 styles)
- pagination/* (5 styles)
- Plus others as needed

### Email Styles (Essential 12)

Minimal email-safe typography:
- email/h1, h2
- email/body, body-large
- email/button, button-large
- email/footer, unsubscribe
- email/preheader
- email/table-cell
- email/disclaimer

---

## Design Tokens for Export

### Additional CSS Variables

```css
/* Navigation */
--font-size-nav-title: 17px;
--font-size-nav-large-title: 34px;
--font-size-nav-tab: 10px;
--font-size-nav-breadcrumb: 14px;

/* Alerts */
--font-size-alert-title: 17px;
--font-size-alert-body: 13px;
--font-size-toast-title: 14px;

/* Badges */
--font-size-badge-number: 12px;
--font-size-badge-small: 10px;
--font-size-chip-label: 13px;

/* Tables */
--font-size-table-header: 12px;
--font-size-table-cell: 14px;

/* Lists */
--font-size-list-primary: 17px;
--font-size-list-secondary: 15px;

/* Email */
--font-size-email-h1: 28px;
--font-size-email-body: 16px;
--font-size-email-button: 16px;
--font-size-email-footer: 12px;

/* Data */
--font-size-data-number-lg: 48px;
--font-size-data-number-md: 32px;
--font-size-data-number-sm: 24px;

/* Pricing */
--font-size-price-hero: 60px;
--font-size-price-large: 48px;
--font-size-price-medium: 32px;

/* Forms */
--font-size-form-error: 13px;
--font-size-form-hint: 12px;

/* Legal */
--font-size-legal-default: 11px;
--font-size-legal-small: 10px;
```

---

## Naming Convention Guide

### Style Naming Pattern

```
{category}/{size-or-variant}

Examples:
- nav/title
- alert/body
- email/h1
- table/header
- price/large
```

### Size Naming

- `xs` = Extra Small
- `sm` = Small
- `md` = Medium (often default)
- `lg` = Large
- `xl` = Extra Large
- `xxl` = Double Extra Large
- `hero` = Largest, for heroes

### Variant Naming

- `primary` = Main content
- `secondary` = Supporting content
- `tertiary` = Least important
- `active` = Active/selected state
- `disabled` = Disabled state

---

## Quick Reference: Most Commonly Used Styles

### Top 20 Most-Used Styles (80/20 Rule)

1. `body/md` (16px) - Default body text
2. `heading/md` (24px) - Page sections
3. `button/md` (16px) - Default buttons
4. `label/md` (14px) - Form labels
5. `input/md` (16px) - Text inputs
6. `nav/title` (17px) - Mobile nav
7. `list/primary` (17px / 16px) - List items
8. `caption/md` (12px) - Helper text
9. `alert/body` (13px / 14px) - Alerts
10. `heading/xl` (36px) - Page titles
11. `body/sm` (14px) - Secondary text
12. `badge/number` (12px) - Notifications
13. `table/cell` (14px) - Table content
14. `email/body` (16px) - Email content
15. `form/error` (13px) - Validation
16. `link/md` (16px) - Inline links
17. `heading/sm` (20px) - Subsections
18. `button/lg` (18px) - Primary CTAs
19. `display/md` (48px) - Hero headlines
20. `price/medium` (32px) - Pricing

**Coverage**: These 20 styles cover ~80% of design needs

---

## Testing Checklist

### Cross-Platform Testing

**Mobile (iOS):**
- [ ] Test on iPhone SE (small screen)
- [ ] Test on iPhone Pro (standard)
- [ ] Test on iPhone Pro Max (large)
- [ ] Test with Dynamic Type enabled
- [ ] Verify SF Pro renders correctly

**Mobile (Android):**
- [ ] Test on small device (5")
- [ ] Test on standard device (6")
- [ ] Test on large device (6.5"+)
- [ ] Test with different system font sizes
- [ ] Verify Material Design compliance

**Web (Desktop):**
- [ ] Test Chrome, Firefox, Safari, Edge
- [ ] Test at 1920px, 1440px, 1024px widths
- [ ] Verify responsive scaling
- [ ] Test with browser zoom (100%, 125%, 150%)
- [ ] Check accessibility (screen readers)

**Web (Mobile):**
- [ ] Test on iOS Safari
- [ ] Test on Android Chrome
- [ ] Test at 375px, 414px, 428px widths
- [ ] Verify touch targets (48px min)
- [ ] Test landscape orientation

**Email:**
- [ ] Gmail (web, iOS, Android)
- [ ] Outlook (desktop, web)
- [ ] Apple Mail (macOS, iOS)
- [ ] Yahoo Mail
- [ ] Test in dark mode
- [ ] Verify minimum sizes render

---

## Next Steps

### Recommended Action Plan

1. **Review this document** with design & dev teams
2. **Prioritize by platform**:
   - Mobile app? → Start with iOS/Android styles
   - Web product? → Start with web styles
   - Email marketing? → Include email styles
3. **Implement in phases** (1, 2, 3, 4 above)
4. **Create component library** using these styles
5. **Export design tokens** for development
6. **Document usage examples** for team
7. **Establish governance** (who can add/change styles)

### Questions to Consider

- **Which platforms are you targeting?** (Helps prioritize)
- **Do you need email support?** (Adds 12 styles)
- **E-commerce product?** (Prioritize pricing styles)
- **Content-heavy site?** (Prioritize quote/content styles)
- **Mobile-first or web-first?** (Affects base sizing)

---

Would you like me to:
1. **Create a customized subset** based on your specific platforms?
2. **Implement Phase 1 styles in Figma** (65 critical styles)?
3. **Generate platform-specific design tokens** (iOS, Android, Web, Email)?
4. **Create visual examples** showing each style in context?
5. **Build a prioritized implementation plan** for your team?

Let me know your platforms and priorities! 🚀
