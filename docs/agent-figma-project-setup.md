# Agent Instructions: Complete Figma Project Setup

**For**: Claude Code Agent (Orchestrator)
**Purpose**: Coordinate complete Figma project setup by delegating to specialized agents
**MCP Server**: ClaudeTalkToFigma (port 3000)

---

## Overview

This orchestrator agent coordinates a complete Figma project setup by **delegating** to specialized agents:

1. **Phase 1**: Use `agent-theme-variables.md` → Create theme variables (102-110 variables)
2. **Phase 2**: Use `agent-text-styles.md` → Create text styles (36-123 styles)
3. **Phase 3**: Validate and document the complete setup

**Total Setup Time**: ~2-3 minutes for complete project

---

## Architecture

```
┌─────────────────────────────────────┐
│  agent-figma-project-setup.md      │  ← YOU ARE HERE (Orchestrator)
│  (This file - Coordinates workflow) │
└────────────┬────────────────────────┘
             │
             ├─────► Phase 1: Theme Variables
             │       └─► Delegate to: agent-theme-variables.md
             │
             ├─────► Phase 2: Text Styles
             │       └─► Delegate to: agent-text-styles.md
             │
             └─────► Phase 3: Final Validation & Documentation
                     └─► Use both agents' validation tools
```

---

## Prerequisites

Before starting, verify:
- ✅ Figma plugin is loaded and connected
- ✅ MCP server is running (port 3000)
- ✅ User has a Figma file open
- ✅ You have access to specialized agent instructions:
  - `docs/agent-theme-variables.md`
  - `docs/agent-text-styles.md`

---

## Phase 1: Theme Variables Setup

**Delegate to**: `docs/agent-theme-variables.md`

### Your Task as Orchestrator

1. **Read the specialized agent instructions**:
   ```
   Read file: docs/agent-theme-variables.md
   ```

2. **Follow the complete workflow** from that agent, which includes:
   - Step 1: Audit existing variable collections
   - Step 2: Understand the standard 102-variable system
   - Step 3: Determine create vs fix strategy
   - Step 4: Execute theme variable creation/fixing
   - Step 5: Validate WCAG compliance
   - Step 6: Generate audit reports

3. **Quick reference** for common scenarios:

   **Scenario A**: No existing theme → Create new
   - Use `create_variable_collection` + `fix_collection_to_standard`

   **Scenario B**: Existing theme needs fixing → Fix existing
   - Use `audit_collection` + `fix_collection_to_standard`

   **Scenario C**: Custom brand colors → Apply custom palette
   - Use `fix_collection_to_standard` + `apply_custom_palette`

4. **Success criteria** before moving to Phase 2:
   - ✅ 102 variables created (or 110 with chart colors)
   - ✅ WCAG AA compliance validated
   - ✅ Audit report generated and clean

**Important**: Follow the detailed instructions in `agent-theme-variables.md`. That agent contains comprehensive guidance on all MCP tools, color calculations, schema validation, and troubleshooting.

---

## Phase 2: Text Styles Setup

**Delegate to**: `docs/agent-text-styles.md`

### Your Task as Orchestrator

1. **Read the specialized agent instructions**:
   ```
   Read file: docs/agent-text-styles.md
   ```

2. **Follow the complete workflow** from that agent, which includes:
   - Step 1: Audit existing text styles
   - Step 2: Understand the standard type scale (36 or 123 styles)
   - Step 3: Categorize existing styles (valid/invalid/non-standard/missing)
   - Step 4: Load required fonts (Inter, SF Pro, etc.)
   - Step 5: Create text styles with proper formatting
   - Step 6: Validate all styles were created correctly

3. **Quick reference** for common scenarios:

   **Scenario A**: No existing styles → Create from scratch
   - Ask user: 36 base or 123 complete?
   - Create text nodes with formatting
   - Guide user to create styles manually in Figma

   **Scenario B**: Some existing styles → Fix and complete
   - Audit existing styles
   - Identify invalid/non-standard styles
   - Create missing styles
   - Validate all styles

   **Scenario C**: Non-standard sizes (13px, 15px, etc.) → Migrate
   - Document current styles
   - Recommend standard size replacements
   - Create new standard styles
   - Guide migration from old to new

4. **Success criteria** before moving to Phase 3:
   - ✅ 36 base text styles created (or 123 complete)
   - ✅ All sizes from standard type scale (no 13px, 15px, 22px)
   - ✅ Line heights properly set (1.2 ratio)
   - ✅ Letter spacing configured correctly
   - ✅ Consistent naming convention

**Important**: Follow the detailed instructions in `agent-text-styles.md`. That agent contains comprehensive guidance on type scales, font loading, style creation workflows, and validation.

---

## Phase 3: Final Validation & Documentation

### Step 3.1: Comprehensive Validation

Run final validation checks across both systems:

```typescript
// 1. Validate theme variables
mcp__ClaudeTalkToFigma__generate_audit_report({
  collection_id: "Theme",
  format: "markdown"
})

// 2. Validate text styles
mcp__ClaudeTalkToFigma__get_styles()
```

**Check for:**
- ✅ Theme: 102-110 variables, WCAG AA compliant
- ✅ Text Styles: 36-123 styles, standard type scale
- ✅ No errors in audit reports

### Step 3.2: Export Configuration

Export for version control and sharing:

```typescript
mcp__ClaudeTalkToFigma__export_collection_schema({
  collection_id: "Theme",
  mode: "dark",
  include_metadata: true
})
```

### Step 3.3: Report to User

**Provide comprehensive summary:**

```markdown
## Figma Project Setup Complete ✅

### Theme Variables
- ✅ 102 variables created (36 base + 70 scales + 8 chart)
- ✅ WCAG AA compliant
- ✅ Color scales generated for all 7 families

### Text Styles
- ✅ 36 base text styles created (or 123 with weights)
- ✅ Standard type scale (12-96px)
- ✅ Line heights and letter spacing configured

### Deliverables
- 📋 Theme audit report (markdown)
- 💾 Exported theme schema (JSON)
- 📝 Visual documentation recommended (user can create)

**Next Steps:**
1. Review theme colors in Figma
2. Test text styles in real components
3. Share JSON schema with team for version control
```

### Step 3.4: Success Criteria

**Complete setup checklist:**

✅ **Theme Variables**:
- [ ] 102+ variables exist
- [ ] WCAG AA compliant
- [ ] Audit report clean
- [ ] Schema exported

✅ **Text Styles**:
- [ ] 36+ styles exist
- [ ] All standard sizes
- [ ] Proper line heights
- [ ] Consistent naming

✅ **Documentation**:
- [ ] Audit reports generated
- [ ] JSON schema exported
- [ ] Summary provided to user

---

## Orchestration Decision Tree

**Use this to determine your workflow:**

```
START: User requests Figma project setup
  │
  ├─ Ask: "Quick default or custom setup?"
  │   │
  │   ├─ Quick → FAST PATH
  │   │   └─ Phase 1: fix_collection_to_standard (default theme)
  │   │   └─ Phase 2: 36 base text styles
  │   │   └─ Phase 3: Validate & export
  │   │   └─ DONE (3 minutes)
  │   │
  │   └─ Custom → CUSTOM PATH
  │       └─ Ask: "Do you have brand colors?"
  │       └─ Ask: "Need chart colors?"
  │       └─ Ask: "36 base or 123 complete text styles?"
  │       └─ Phase 1: Theme (with custom options)
  │       └─ Phase 2: Text Styles (with weight options)
  │       └─ Phase 3: Validate & export
  │       └─ DONE (5-10 minutes)
  │
  └─ Check existing setup
      ├─ Theme exists? → Delegate to agent-theme-variables.md (fix mode)
      ├─ Styles exist? → Delegate to agent-text-styles.md (fix mode)
      └─ Nothing exists? → Create from scratch (create mode)
```

---

## Troubleshooting

**For detailed troubleshooting**, refer to the specialized agents:

- **Theme variable issues** → See `agent-theme-variables.md` troubleshooting section
- **Text style issues** → See `agent-text-styles.md` troubleshooting section

**Common orchestration issues:**

**Issue**: Don't know which agent to use
- **Fix**: Read this orchestrator, it tells you exactly which agent for each phase

**Issue**: Agent instructions conflict
- **Fix**: Specialized agents are authoritative, this orchestrator just coordinates

**Issue**: User wants to skip a phase
- **Fix**: Phases can be run independently, update success criteria accordingly

---

## Quick Start (Fast Path)

**For fastest setup** (3 minutes):

1. **Read specialized agent instructions**:
   - `docs/agent-theme-variables.md`
   - `docs/agent-text-styles.md`

2. **Execute Phase 1** (Theme):
   - Follow "Quick Setup" workflow in `agent-theme-variables.md`
   - Use `fix_collection_to_standard` with defaults

3. **Execute Phase 2** (Text Styles):
   - Follow "36 Base Styles" workflow in `agent-text-styles.md`
   - Create text nodes, format, create styles

4. **Execute Phase 3** (Validate):
   - Run audit reports
   - Export schema
   - Provide summary to user

**That's it!** The specialized agents have all the detailed commands.

---

## Orchestrator Behavior Guidelines

### Your Role
- 📋 **Coordinate** workflow across specialized agents
- 🎯 **Decide** which agent to use for each phase
- ✅ **Validate** completion before moving to next phase
- 📊 **Report** overall progress to user

### Communication
- ✅ Announce each phase clearly ("Starting Phase 1: Theme Variables")
- ✅ Indicate which specialized agent you're using
- ✅ Report phase completion with metrics
- ✅ Provide final comprehensive summary
- ❌ Don't duplicate detailed instructions (let specialized agents handle that)

### Delegation
- **Always** read the specialized agent file before executing
- **Trust** the specialized agent's detailed instructions
- **Don't** override or contradict specialized agent guidance
- **Do** coordinate timing and sequencing between phases

### Error Handling
- If a phase fails, consult that phase's specialized agent for troubleshooting
- Don't proceed to next phase until current phase meets success criteria
- Report issues clearly and reference the specialized agent for fixes

---

## Success Metrics

**Complete setup achieves:**
- ⏱️ **Time**: 3 minutes (fast path) or 5-10 minutes (custom)
- 🎨 **Theme**: 102+ variables, WCAG AA compliant
- 📝 **Typography**: 36+ text styles, standard type scale
- ✅ **Validation**: All audit checks pass
- 📋 **Documentation**: Exported schema + reports

---

## Agent Architecture Summary

```
┌─────────────────────────────────────────────────┐
│ agent-figma-project-setup.md (THIS FILE)       │
│ Role: Orchestrator / Coordinator                │
│ - Determines workflow (quick vs custom)         │
│ - Delegates to specialized agents               │
│ - Validates phase completion                    │
│ - Provides final summary                        │
└────────────┬────────────────────────────────────┘
             │
             ├─► agent-theme-variables.md
             │   - Complete theme variable system
             │   - 102-variable standard
             │   - Color calculations & WCAG
             │   - Audit & validation tools
             │
             └─► agent-text-styles.md
                 - Complete text style system
                 - Type scale (36 or 123 styles)
                 - Font management
                 - Style creation workflows
```

**Key Principle**: DRY (Don't Repeat Yourself)
- Orchestrator → High-level coordination
- Specialized Agents → Detailed implementation

---

## References

- **Theme variables**: `docs/agent-theme-variables.md` (authoritative for theme)
- **Text styles**: `docs/agent-text-styles.md` (authoritative for typography)
- **MCP Tools**: See individual agents for complete tool documentation

---

**End of Orchestrator Instructions**

**Remember**: When executing this agent, you are the orchestrator. Read and follow the specialized agents for actual implementation details.
