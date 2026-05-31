import { describe, it, expect, beforeAll } from "@jest/globals";
import { DESIGN_KNOWLEDGE_MODULES } from "../../../src/videntia_figma_mcp/resources/design-knowledge/types.js";
import { ANTI_AI_SLOP } from "../../../src/videntia_figma_mcp/resources/design-knowledge/anti-ai-slop.js";
import { TYPOGRAPHY } from "../../../src/videntia_figma_mcp/resources/design-knowledge/typography.js";
import { COLOR } from "../../../src/videntia_figma_mcp/resources/design-knowledge/color.js";
import { MOTION } from "../../../src/videntia_figma_mcp/resources/design-knowledge/motion.js";
import { ICONS } from "../../../src/videntia_figma_mcp/resources/design-knowledge/icons.js";
import { CRAFT_DETAILS } from "../../../src/videntia_figma_mcp/resources/design-knowledge/craft-details.js";
import { SKILL } from "../../../src/videntia_figma_mcp/resources/design-knowledge/skill.js";
import { DEPTH_ELEVATION } from "../../../src/videntia_figma_mcp/resources/design-knowledge/depth-elevation.js";
import { SPACING_RADIUS } from "../../../src/videntia_figma_mcp/resources/design-knowledge/spacing-radius.js";

// Trigger module map population by importing the registration index
import "../../../src/videntia_figma_mcp/resources/design-knowledge/index.js";

const ALL_MODULES = [ANTI_AI_SLOP, TYPOGRAPHY, COLOR, MOTION, ICONS, CRAFT_DETAILS, SKILL, DEPTH_ELEVATION, SPACING_RADIUS];
const EXPECTED_IDS = ["anti-ai-slop", "typography", "color", "motion", "icons", "craft-details", "skill", "depth-elevation", "spacing-radius"];

describe("Design Knowledge Modules", () => {
  describe("Module map completeness", () => {
    it("contains all 9 modules", () => {
      expect(DESIGN_KNOWLEDGE_MODULES.size).toBe(9);
    });

    it.each(EXPECTED_IDS)("contains module '%s'", (id) => {
      expect(DESIGN_KNOWLEDGE_MODULES.has(id)).toBe(true);
    });
  });

  describe("Module structure", () => {
    it.each(ALL_MODULES)("$id has required fields", (mod) => {
      expect(typeof mod.id).toBe("string");
      expect(mod.id.length).toBeGreaterThan(0);
      expect(typeof mod.name).toBe("string");
      expect(mod.name.length).toBeGreaterThan(0);
      expect(typeof mod.description).toBe("string");
      expect(mod.description.length).toBeGreaterThan(0);
      expect(typeof mod.content).toBe("string");
      expect(mod.content.length).toBeGreaterThan(200);
    });
  });

  describe("anti-ai-slop content", () => {
    it("mentions banned colors", () => {
      expect(ANTI_AI_SLOP.content).toContain("#6366f1");
      expect(ANTI_AI_SLOP.content).toContain("#8b5cf6");
      expect(ANTI_AI_SLOP.content).toContain("#7c3aed");
    });

    it("lists safe alternative colors", () => {
      expect(ANTI_AI_SLOP.content).toContain("#2563eb");
    });

    it("mentions typography tells", () => {
      expect(ANTI_AI_SLOP.content.toLowerCase()).toContain("letter-spacing");
    });

    it("includes a checklist", () => {
      expect(ANTI_AI_SLOP.content).toContain("Checklist");
    });
  });

  describe("typography content", () => {
    it("references 1.2x scale ratio", () => {
      expect(TYPOGRAPHY.content).toContain("1.2x");
    });

    it("includes letter-spacing rules for ALL CAPS", () => {
      expect(TYPOGRAPHY.content).toContain("ALL CAPS");
      expect(TYPOGRAPHY.content).toContain("0.06");
    });

    it("lists font pairing options", () => {
      expect(TYPOGRAPHY.content).toContain("Inter");
    });

    it("specifies text color values for light and dark mode", () => {
      expect(TYPOGRAPHY.content).toContain("#0B0B0B");
      expect(TYPOGRAPHY.content).toContain("#F5F5F5");
    });
  });

  describe("color content", () => {
    it("mentions 60/30/10 rule", () => {
      expect(COLOR.content).toContain("60/30/10");
    });

    it("specifies dark theme background (not pure black)", () => {
      expect(COLOR.content).toContain("#0f0f0f");
    });

    it("includes token naming by purpose not color", () => {
      expect(COLOR.content.toLowerCase()).toContain("purpose");
    });

    it("mentions WCAG contrast ratios", () => {
      expect(COLOR.content).toContain("4.5:1");
    });
  });

  describe("motion content", () => {
    it("includes timing ranges", () => {
      expect(MOTION.content).toContain("90");
      expect(MOTION.content).toContain("500ms");
    });

    it("specifies easing curves for enter and exit", () => {
      expect(MOTION.content.toLowerCase()).toContain("ease-out");
      expect(MOTION.content.toLowerCase()).toContain("ease-in");
    });

    it("mentions prefers-reduced-motion", () => {
      expect(MOTION.content).toContain("prefers-reduced-motion");
    });
  });

  describe("icons content", () => {
    it("specifies sizing values", () => {
      expect(ICONS.content).toContain("16px");
      expect(ICONS.content).toContain("24px");
    });

    it("mentions optical corrections", () => {
      expect(ICONS.content.toLowerCase()).toContain("optical");
    });

    it("lists Lucide as top library", () => {
      expect(ICONS.content).toContain("Lucide");
    });

    it("includes one-style rule", () => {
      expect(ICONS.content.toLowerCase()).toContain("one");
    });
  });

  describe("craft-details content", () => {
    it("mentions focus-visible", () => {
      expect(CRAFT_DETAILS.content).toContain(":focus-visible");
    });

    it("specifies 44x44px touch targets", () => {
      expect(CRAFT_DETAILS.content).toContain("44");
    });

    it("mentions touch-action manipulation", () => {
      expect(CRAFT_DETAILS.content).toContain("touch-action");
    });

    it("includes content copy rules (active voice)", () => {
      expect(CRAFT_DETAILS.content.toLowerCase()).toContain("active voice");
    });
  });

  describe("skill content", () => {
    it("describes 5-phase workflow", () => {
      expect(SKILL.content.toLowerCase()).toContain("discover");
      expect(SKILL.content.toLowerCase()).toContain("research");
      expect(SKILL.content.toLowerCase()).toContain("analyze");
      expect(SKILL.content.toLowerCase()).toContain("design");
      expect(SKILL.content.toLowerCase()).toContain("implement");
    });

    it("includes quality gate dimensions", () => {
      expect(SKILL.content).toContain("Functional");
      expect(SKILL.content).toContain("Visual");
      expect(SKILL.content).toContain("Persuasion");
      expect(SKILL.content).toContain("Polish");
    });

    it("mentions minimum reference count", () => {
      expect(SKILL.content).toContain("50");
    });

    it("includes discovery questions", () => {
      expect(SKILL.content.toLowerCase()).toContain("job-to-be-done");
    });
  });
});
