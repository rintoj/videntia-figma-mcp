# Figma Text Styles Documentation

**Document Generated**: 2025-11-20
**Channel**: n1puvv3y

## Overview

This document catalogs all text styles currently defined in the Figma design file. The styles are organized into four main categories: page content, list items, buttons, and form inputs.

---

## Text Style Categories

### Page Styles (8 styles)

Typography styles for general page content and structure.

| Style Name | Font Size | Font Family | Font Weight | Usage |
|------------|-----------|-------------|-------------|-------|
| `page/h1` | 36px | SF Pro | Heavy | Primary page headings |
| `page/h2` | 24px | SF Pro | Bold | Secondary headings |
| `page/h3` | 22px | SF Pro | Bold | Tertiary headings |
| `page/h4` | 16px | SF Pro | Semibold | Quaternary headings |
| `page/title` | 24px | SF Pro | Bold | Section titles |
| `page/subtitle` | 15px | SF Pro | Regular | Section subtitles |
| `page/body` | 14px | SF Pro | Medium | Body text content |
| `page/caption` | 13px | SF Pro | Regular | Caption text |

### Item Styles (2 styles)

Typography for list items and content blocks.

| Style Name | Font Size | Font Family | Font Weight | Usage |
|------------|-----------|-------------|-------------|-------|
| `item/title` | 14px | SF Pro | Medium | Item/card titles |
| `item/subtitle` | 12px | SF Pro | Medium | Item/card subtitles |

### Button Styles (5 styles)

Typography for interactive button elements.

| Style Name | Font Size | Font Family | Font Weight | Usage |
|------------|-----------|-------------|-------------|-------|
| `button/lg` | 18px | SF Pro | Bold | Large buttons |
| `button/default` | 16px | SF Pro | Semibold | Default buttons |
| `button/link` | 16px | SF Pro | Medium | Link-styled buttons |
| `button/sm` | 14px | SF Pro | Semibold | Small buttons |
| `button/xs` | 12px | SF Pro | Medium | Extra small buttons |

### Input Styles (4 styles)

Typography for form inputs and labels.

| Style Name | Font Size | Font Family | Font Weight | Usage |
|------------|-----------|-------------|-------------|-------|
| `input/lg` | 20px | SF Pro | Regular | Large input fields |
| `input/default` | 16px | SF Pro | Regular | Default input fields |
| `input/label` | 14px | SF Pro | Medium | Input field labels |
| `input/caption` | 13px | SF Pro | Medium | Input helper text |

---

## Color Styles

### Gradient Styles (1 style)

| Style Name | Type | Description |
|------------|------|-------------|
| `Graident` | Linear Gradient | Black gradient with opacity transitions (0.2 → 0.9 → 1.0) |

**Gradient Details**:
- Direction: Vertical (top to bottom)
- Stop 1: 25% - Black @ 20% opacity
- Stop 2: 47.6% - Black @ 90% opacity
- Stop 3: 100% - Black @ 100% opacity
- Opacity: 70%
- Blend Mode: Normal

---

## Font Family Summary

**Primary Font**: SF Pro (San Francisco Pro)

All text styles use the SF Pro font family with varying weights:
- **Heavy**: page/h1
- **Bold**: page/h2, page/h3, page/title, button/lg
- **Semibold**: page/h4, button/default, button/sm
- **Medium**: page/body, item/title, item/subtitle, button/xs, button/link, input/label, input/caption
- **Regular**: page/subtitle, page/caption, input/default, input/lg

---

## Size Scale

The design system uses the following font size scale:

| Size (px) | Styles Using This Size |
|-----------|------------------------|
| 36 | page/h1 |
| 24 | page/h2, page/title |
| 22 | page/h3 |
| 20 | input/lg |
| 18 | button/lg |
| 16 | page/h4, button/default, button/link, input/default |
| 15 | page/subtitle |
| 14 | page/body, item/title, button/sm, input/label |
| 13 | page/caption, input/caption |
| 12 | item/subtitle, button/xs |

---

## Design System Observations

### Consistency
- ✅ All styles use SF Pro font family
- ✅ Clear size hierarchy (12px - 36px range)
- ✅ Organized naming convention with categories

### Recommendations
1. **Accessibility**: Ensure minimum font sizes meet WCAG standards (12px is minimum, which is acceptable)
2. **Line Height**: Consider adding line-height specifications to text styles for better readability
3. **Typo in Gradient**: "Graident" should be renamed to "Gradient"
4. **Letter Spacing**: Consider adding letter spacing values, especially for headings and buttons

### Style Coverage
- **Total Text Styles**: 19
- **Total Color Styles**: 1
- **Total Effect Styles**: 0
- **Total Grid Styles**: 0

---

## Technical Details

### Style IDs

For programmatic access, here are the style keys:

**Page Styles:**
- page/h1: `0311ac8f67a7c2f42b9cd3b3d260a31b3a03a4a4`
- page/h2: `ad293b36d136589f13e894ef5be9cc8d9c4d5b24`
- page/h3: `dd4c9a0de97ca3334c241ec490e3fedbbf6af0ed`
- page/h4: `4daeba66daa801c18be15a5d589f85115fb8bcfe`
- page/title: `2a35202e340f2a67bfeb37835258b2e89645bc91`
- page/subtitle: `1642e550f4e12671fdccaf2d3a300d053994eb12`
- page/body: `3f28c4b1d1715e2c202f37d4e2ff78214175589d`
- page/caption: `eeec6c98ef0d789264676282cda99c28fa8c819a`

**Item Styles:**
- item/title: `6a3723f56b9fe0a5c0ef76a9aa7fd32194e6e107`
- item/subtitle: `3de1402c72ea5315d7f5bcb9e4122eeed83e6c1e`

**Button Styles:**
- button/default: `7f0f49ed339daf3456815e334eafc759c50baeea`
- button/lg: `8b57e6b1b8d5abfa19c5e0d223f8fe8b5cc95658`
- button/sm: `394c49460a55b39f6482d082ad0cfff0e2c913a6`
- button/xs: `30429861c5a586513ce6361b50a5a134813e5149`
- button/link: `fbb77ada92294d1f0f75d265283a4bb0736f39a5`

**Input Styles:**
- input/default: `a56463258520c9045bb165a60cec556b5b9e4537`
- input/label: `8afb8e2387edecea16b38eaa3b5acc82b7533ed2`
- input/caption: `9f2112f4af6efeaea9cd12455f5bf394bc161024`
- input/lg: `98995ec1a7a7eada0f3465ec766e3508e77e8395`

**Color Styles:**
- Graident: `0e38b47a927d03c5b8954e7b3050db428f9c7507`

---

## Usage Guidelines

### When to Use Each Style

**Headings Hierarchy:**
1. Use `page/h1` for main page titles
2. Use `page/h2` for major section headings
3. Use `page/h3` for subsection headings
4. Use `page/h4` for minor subsection headings

**Content Text:**
- Use `page/body` for primary content
- Use `page/caption` for supplementary information
- Use `page/title` and `page/subtitle` for titled sections

**Interactive Elements:**
- Use `button/lg` for primary CTAs
- Use `button/default` for standard actions
- Use `button/sm` and `button/xs` for compact UIs
- Use `button/link` for text-only links

**Forms:**
- Use `input/lg` for prominent input fields
- Use `input/default` for standard form fields
- Use `input/label` for field labels
- Use `input/caption` for help text and errors

---

**End of Document**
