import type { LintOptions, LintResult, LintCategories, ActiveChecks } from './types';
import { scanNode } from './checks';
import { applyFixes } from './fix';
import { buildLookupMaps } from './helpers';

export async function lintFrame(params: Record<string, unknown>): Promise<LintResult> {
  const lintParams = params as unknown as LintOptions;
  const nodeId = lintParams ? lintParams.nodeId : undefined;
  const checks = lintParams ? lintParams.checks : undefined;
  const fix = lintParams ? (lintParams.fix === true) : false;

  if (!nodeId) throw new Error('nodeId is required');

  const rootNode = await figma.getNodeByIdAsync(nodeId);
  if (!rootNode) throw new Error('Node not found: ' + String(nodeId).substring(0, 50));

  // rootFrame check only applies when the node is a direct child of a PAGE
  const isPageChild = rootNode.parent !== null && rootNode.parent !== undefined && rootNode.parent.type === 'PAGE';

  // Default checks — all on
  let chk: ActiveChecks = {
    rootFrame: isPageChild,
    colors: true,
    spacing: true,
    radius: true,
    textStyles: true,
    effectStyles: true,
    autoLayout: true,
    overflow: true,
  };
  if (checks) {
    if (checks.rootFrame === false) chk.rootFrame = false;
    if (checks.rootFrame === true) chk.rootFrame = true;
    if (checks.colors === false) chk.colors = false;
    if (checks.spacing === false) chk.spacing = false;
    if (checks.radius === false) chk.radius = false;
    if (checks.textStyles === false) chk.textStyles = false;
    if (checks.effectStyles === false) chk.effectStyles = false;
    if (checks.autoLayout === false) chk.autoLayout = false;
    if (checks.overflow === false) chk.overflow = false;
  }

  // Pre-load all lookup maps (parallel)
  const maps = await buildLookupMaps();

  // Category tallies
  const categories: LintCategories = {
    rootFrame:       { total: 0, bound: 0, unbound: 0, compliance: 100 },
    typography:      { total: 0, bound: 0, unbound: 0, compliance: 100 },
    spacing:         { total: 0, bound: 0, unbound: 0, compliance: 100 },
    borderRadius:    { total: 0, bound: 0, unbound: 0, compliance: 100 },
    iconColors:      { total: 0, bound: 0, unbound: 0, compliance: 100 },
    strokesBorders:  { total: 0, bound: 0, unbound: 0, compliance: 100 },
    backgroundFills: { total: 0, bound: 0, unbound: 0, compliance: 100 },
    effectStyles:    { total: 0, bound: 0, unbound: 0, compliance: 100 },
    overflow:        { total: 0, bound: 0, unbound: 0, compliance: 100 },
    autoLayout:      { total: 0, bound: 0, unbound: 0, compliance: 100 },
  };

  const violations: import('./types').Violation[] = [];
  const violationsCappedRef = { value: false };
  const totalNodesRef = { value: 0 };

  // Run the traversal
  scanNode(rootNode as SceneNode, 0, null, null, chk, categories, violations, violationsCappedRef, totalNodesRef);

  // Auto-fix pass (only when fix=true)
  if (fix) {
    await applyFixes(violations, categories, maps);
  }

  // Compute compliance percentages
  const catKeys: Array<keyof LintCategories> = ['rootFrame', 'typography', 'spacing', 'borderRadius', 'iconColors', 'strokesBorders', 'backgroundFills', 'effectStyles', 'overflow', 'autoLayout'];
  for (let ck = 0; ck < catKeys.length; ck++) {
    let cat = categories[catKeys[ck]];
    if (cat.total > 0) {
      cat.compliance = Math.round((cat.bound / cat.total) * 100);
    } else {
      cat.compliance = 100;
    }
  }

  // Compute summary
  let summaryCritical = 0;
  let summaryHigh = 0;
  let summaryMedium = 0;
  let summaryLow = 0;
  let summaryFixed = 0;
  for (let sv = 0; sv < violations.length; sv++) {
    if (violations[sv].fixed === true) {
      summaryFixed++;
      continue;
    }
    switch (violations[sv].severity) {
      case 'CRITICAL': summaryCritical++; break;
      case 'HIGH': summaryHigh++; break;
      case 'MEDIUM': summaryMedium++; break;
      case 'LOW': summaryLow++; break;
    }
  }
  let summaryTotal = violations.length - summaryFixed;

  // Overall compliance
  let overallTotal = 0;
  let overallBound = 0;
  for (let ok = 0; ok < catKeys.length; ok++) {
    overallTotal += categories[catKeys[ok]].total;
    overallBound += categories[catKeys[ok]].bound;
  }
  let overallCompliance = overallTotal > 0 ? Math.round((overallBound / overallTotal) * 100) : 100;

  return {
    nodeId: rootNode.id,
    nodeName: rootNode.name,
    nodeType: rootNode.type,
    totalNodes: totalNodesRef.value,
    categories: categories,
    violations: violations,
    violationsCapped: violationsCappedRef.value,
    summary: {
      total: summaryTotal,
      critical: summaryCritical,
      high: summaryHigh,
      medium: summaryMedium,
      low: summaryLow,
      compliance: overallCompliance,
      fixed: summaryFixed,
    },
  };
}
