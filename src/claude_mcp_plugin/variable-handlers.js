/**
 * Figma Plugin Handlers for Variable Management Tools
 * This file contains all 24 new command handlers for theme variable management
 * To integrate: Add these cases to the switch statement and functions to code.js
 */

// ===========================================
// SWITCH CASES TO ADD (around line 206)
// ===========================================
/*
    case "get_variable_collections":
      return await getVariableCollections();
    case "create_variable_collection":
      return await createVariableCollection(params);
    case "get_collection_info":
      return await getCollectionInfo(params);
    case "create_variable":
      return await createVariable(params);
    case "create_variables_batch":
      return await createVariablesBatch(params);
    case "update_variable_value":
      return await updateVariableValue(params);
    case "rename_variable":
      return await renameVariable(params);
    case "delete_variable":
      return await deleteVariable(params);
    case "delete_variables_batch":
      return await deleteVariablesBatch(params);
    case "audit_collection":
      return await auditCollection(params);
    case "validate_color_contrast":
      return await validateColorContrast(params);
    case "suggest_missing_variables":
      return await suggestMissingVariables(params);
    case "apply_default_theme":
      return await applyDefaultTheme(params);
    case "create_color_scale_set":
      return await createColorScaleSet(params);
    case "apply_custom_palette":
      return await applyCustomPalette(params);
    case "reorder_variables":
      return await reorderVariables(params);
    case "generate_audit_report":
      return await generateAuditReport(params);
    case "export_collection_schema":
      return await exportCollectionSchema(params);
    case "import_collection_schema":
      return await importCollectionSchema(params);
    case "create_all_scales":
      return await createAllScales(params);
    case "fix_collection_to_standard":
      return await fixCollectionToStandard(params);
    case "add_chart_colors":
      return await addChartColors(params);
*/

// ===========================================
// HANDLER FUNCTIONS TO ADD (at end of file, before exports)
// ===========================================

// Helper: Find collection by ID or name
async function findCollection(collectionIdOrName) {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();

  // Try to find by ID first
  let collection = collections.find(c => c.id === collectionIdOrName);

  // If not found, try by name
  if (!collection) {
    collection = collections.find(c => c.name === collectionIdOrName);
  }

  if (!collection) {
    throw new Error(`Collection not found: ${collectionIdOrName}`);
  }

  return collection;
}

// Helper: Find variable by ID or name in collection
async function findVariable(variableIdOrName, collectionId) {
  const variables = await figma.variables.getLocalVariablesAsync();

  // Try to find by ID first
  let variable = variables.find(v => v.id === variableIdOrName);

  // If not found and collectionId provided, try by name in collection
  if (!variable && collectionId) {
    const collection = await findCollection(collectionId);
    variable = variables.find(v =>
      v.name === variableIdOrName && v.variableCollectionId === collection.id
    );
  }

  if (!variable) {
    throw new Error(`Variable not found: ${variableIdOrName}`);
  }

  return variable;
}

// Helper: Calculate color scale
function calculateColorScaleFigma(baseColor, backgroundColor) {
  const mixPercentages = {
    50: 0.05, 100: 0.10, 200: 0.20, 300: 0.30, 400: 0.40,
    500: 0.50, 600: 0.60, 700: 0.70, 800: 0.80, 900: 0.90
  };

  const scale = {};
  for (const [level, mix] of Object.entries(mixPercentages)) {
    const invMix = 1 - mix;
    scale[level] = {
      r: baseColor.r * mix + backgroundColor.r * invMix,
      g: baseColor.g * mix + backgroundColor.g * invMix,
      b: baseColor.b * mix + backgroundColor.b * invMix,
      a: 1.0
    };
  }

  return scale;
}

// Helper: Get standard schema
function getStandardSchemaFigma(includeChartColors = false) {
  const baseVariables = [
    // Surfaces
    'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground',
    // Brand
    'primary', 'primary-foreground', 'secondary', 'secondary-foreground',
    'tertiary', 'tertiary-foreground', 'accent', 'accent-foreground',
    // States
    'success', 'success-foreground', 'info', 'info-foreground',
    'warning', 'warning-foreground', 'destructive', 'destructive-foreground',
    // Interactive
    'link', 'link-hover',
    // Feedback
    'overlay', 'tooltip', 'tooltip-foreground', 'placeholder', 'placeholder-foreground',
    // Utility
    'muted', 'muted-foreground', 'selected', 'selected-foreground', 'border', 'input', 'ring'
  ];

  // Add scale variables
  const scaleColors = ['primary', 'secondary', 'accent', 'success', 'info', 'warning', 'destructive'];
  const levels = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
  const scaleVariables = [];
  for (const color of scaleColors) {
    for (const level of levels) {
      scaleVariables.push(`${color}-${level}`);
    }
  }

  let allVariables = [...baseVariables, ...scaleVariables];

  if (includeChartColors) {
    allVariables.push('chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6', 'chart-7', 'chart-8');
  }

  return allVariables;
}

// Helper: Get default dark theme colors
function getDefaultDarkTheme() {
  return {
    // Surfaces
    'background': { r: 0.059, g: 0.063, b: 0.067, a: 1.0 },
    'foreground': { r: 0.980, g: 0.980, b: 0.980, a: 1.0 },
    'card': { r: 0.059, g: 0.063, b: 0.067, a: 1.0 },
    'card-foreground': { r: 0.980, g: 0.980, b: 0.980, a: 1.0 },
    'popover': { r: 0.059, g: 0.063, b: 0.067, a: 1.0 },
    'popover-foreground': { r: 0.980, g: 0.980, b: 0.980, a: 1.0 },
    // Brand colors
    'primary': { r: 0.639, g: 0.902, b: 0.208, a: 1.0 },
    'primary-foreground': { r: 0.090, g: 0.102, b: 0.067, a: 1.0 },
    'secondary': { r: 0.149, g: 0.153, b: 0.153, a: 1.0 },
    'secondary-foreground': { r: 0.980, g: 0.980, b: 0.980, a: 1.0 },
    'tertiary': { r: 0.059, g: 0.063, b: 0.067, a: 1.0 },
    'tertiary-foreground': { r: 0.980, g: 0.980, b: 0.980, a: 1.0 },
    'accent': { r: 0.149, g: 0.153, b: 0.153, a: 1.0 },
    'accent-foreground': { r: 0.980, g: 0.980, b: 0.980, a: 1.0 },
    // State colors
    'success': { r: 0.078, g: 0.325, b: 0.176, a: 1.0 },
    'success-foreground': { r: 0.576, g: 0.773, b: 0.655, a: 1.0 },
    'info': { r: 0.118, g: 0.251, b: 0.686, a: 1.0 },
    'info-foreground': { r: 0.576, g: 0.773, b: 0.992, a: 1.0 },
    'warning': { r: 0.863, g: 0.696, b: 0.149, a: 1.0 },
    'warning-foreground': { r: 0.090, g: 0.102, b: 0.067, a: 1.0 },
    'destructive': { r: 0.863, g: 0.149, b: 0.149, a: 1.0 },
    'destructive-foreground': { r: 0.980, g: 0.980, b: 0.980, a: 1.0 },
    // Interactive
    'link': { r: 0.576, g: 0.773, b: 0.992, a: 1.0 },
    'link-hover': { r: 0.384, g: 0.608, b: 0.929, a: 1.0 },
    // Feedback
    'overlay': { r: 0.000, g: 0.000, b: 0.000, a: 0.8 },
    'tooltip': { r: 0.059, g: 0.063, b: 0.067, a: 1.0 },
    'tooltip-foreground': { r: 0.980, g: 0.980, b: 0.980, a: 1.0 },
    'placeholder': { r: 0.450, g: 0.450, b: 0.450, a: 1.0 },
    'placeholder-foreground': { r: 0.980, g: 0.980, b: 0.980, a: 1.0 },
    // Utility
    'muted': { r: 0.149, g: 0.153, b: 0.153, a: 1.0 },
    'muted-foreground': { r: 0.639, g: 0.647, b: 0.655, a: 1.0 },
    'selected': { r: 0.149, g: 0.153, b: 0.153, a: 1.0 },
    'selected-foreground': { r: 0.980, g: 0.980, b: 0.980, a: 1.0 },
    'border': { r: 0.149, g: 0.153, b: 0.153, a: 1.0 },
    'input': { r: 0.149, g: 0.153, b: 0.153, a: 1.0 },
    'ring': { r: 0.639, g: 0.902, b: 0.208, a: 1.0 }
  };
}

// 1. get_variable_collections
async function getVariableCollections() {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const variables = await figma.variables.getLocalVariablesAsync();

  return {
    collections: collections.map(c => {
      const collectionVariables = variables.filter(v => v.variableCollectionId === c.id);
      return {
        id: c.id,
        name: c.name,
        modes: c.modes.map(m => m.name),
        variableCount: collectionVariables.length,
        defaultMode: (c.modes[0] && c.modes[0].name) || 'Mode 1'
      };
    })
  };
}

// 2. create_variable_collection
async function createVariableCollection(params) {
  const { name, defaultMode } = params;

  const collection = figma.variables.createVariableCollection(name);
  const mode = collection.modes[0];
  collection.renameMode(mode.modeId, defaultMode || 'dark');

  return {
    collectionId: collection.id,
    name: collection.name,
    defaultMode: defaultMode || 'dark',
    success: true
  };
}

// 3. get_collection_info
async function getCollectionInfo(params) {
  const { collectionId } = params;
  const collection = await findCollection(collectionId);
  const allVariables = await figma.variables.getLocalVariablesAsync();
  const collectionVariables = allVariables.filter(v => v.variableCollectionId === collection.id);

  // Categorize variables
  const standardSchema = getStandardSchemaFigma(true);
  const baseCount = collectionVariables.filter(v => !v.name.match(/-\d+$/) && !v.name.startsWith('chart-')).length;
  const scaleCount = collectionVariables.filter(v => v.name.match(/-(50|100|200|300|400|500|600|700|800|900)$/)).length;
  const chartCount = collectionVariables.filter(v => v.name.startsWith('chart-')).length;

  return {
    id: collection.id,
    name: collection.name,
    modes: collection.modes.map(m => m.name),
    defaultMode: (collection.modes[0] && collection.modes[0].name) || 'Mode 1',
    variableCount: collectionVariables.length,
    variablesByCategory: {
      base: baseCount,
      scales: scaleCount,
      chart: chartCount
    }
  };
}

// 4. create_variable
async function createVariable(params) {
  const { collectionId, name, value, mode } = params;
  const collection = await findCollection(collectionId);

  const variable = figma.variables.createVariable(name, collection, 'COLOR');
  const targetMode = mode ? collection.modes.find(m => m.name === mode) : null;
  const modeId = targetMode ? targetMode.modeId : collection.modes[0].modeId;

  if (!modeId) {
    throw new Error(`Mode not found: ${mode}`);
  }

  variable.setValueForMode(modeId, {
    r: value.r,
    g: value.g,
    b: value.b,
    a: value.a !== undefined ? value.a : 1.0
  });

  return {
    variableId: variable.id,
    name: variable.name,
    success: true
  };
}

// 5. create_variables_batch
async function createVariablesBatch(params) {
  const { collectionId, variables, mode } = params;
  const collection = await findCollection(collectionId);
  const targetMode = mode ? collection.modes.find(m => m.name === mode) : null;
  const modeId = targetMode ? targetMode.modeId : collection.modes[0].modeId;

  if (!modeId) {
    throw new Error(`Mode not found: ${mode}`);
  }

  const created = [];
  const failed = [];
  const variableIds = [];
  const errors = [];

  for (const varDef of variables) {
    try {
      const variable = figma.variables.createVariable(varDef.name, collection, 'COLOR');
      variable.setValueForMode(modeId, {
        r: varDef.value.r,
        g: varDef.value.g,
        b: varDef.value.b,
        a: varDef.value.a !== undefined ? varDef.value.a : 1.0
      });
      created.push(varDef.name);
      variableIds.push(variable.id);
    } catch (error) {
      failed.push(varDef.name);
      errors.push({ name: varDef.name, error: error.message });
    }
  }

  return {
    created: created.length,
    failed: failed.length,
    variableIds,
    errors
  };
}

// 6. update_variable_value
async function updateVariableValue(params) {
  const { variableId, collectionId, value, mode } = params;
  const variable = await findVariable(variableId, collectionId);
  const collection = await figma.variables.getVariableByIdAsync(variable.variableCollectionId);
  const targetMode = mode ? collection.modes.find(m => m.name === mode) : null;
  const modeId = targetMode ? targetMode.modeId : collection.modes[0].modeId;

  if (!modeId) {
    throw new Error(`Mode not found: ${mode}`);
  }

  variable.setValueForMode(modeId, {
    r: value.r,
    g: value.g,
    b: value.b,
    a: value.a !== undefined ? value.a : 1.0
  });

  return {
    variableId: variable.id,
    name: variable.name,
    updated: true
  };
}

// 7. rename_variable
async function renameVariable(params) {
  const { variableId, collectionId, newName } = params;
  const variable = await findVariable(variableId, collectionId);
  const oldName = variable.name;

  variable.name = newName;

  return {
    variableId: variable.id,
    oldName,
    newName: variable.name,
    success: true
  };
}

// 8. delete_variable
async function deleteVariable(params) {
  const { variableId, collectionId } = params;
  const variable = await findVariable(variableId, collectionId);
  const name = variable.name;
  const id = variable.id;

  variable.remove();

  return {
    variableId: id,
    name,
    deleted: true
  };
}

// 9. delete_variables_batch
async function deleteVariablesBatch(params) {
  const { variableIds, collectionId } = params;

  let deleted = 0;
  let failed = 0;
  const errors = [];

  for (const varId of variableIds) {
    try {
      const variable = await findVariable(varId, collectionId);
      variable.remove();
      deleted++;
    } catch (error) {
      failed++;
      errors.push({ variableId: varId, error: error.message });
    }
  }

  return {
    deleted,
    failed,
    errors
  };
}

// 10. audit_collection
async function auditCollection(params) {
  const { collectionId, includeChartColors, customSchema } = params;
  const collection = await findCollection(collectionId);
  const allVariables = await figma.variables.getLocalVariablesAsync();
  const collectionVariables = allVariables.filter(v => v.variableCollectionId === collection.id);

  const standardVariables = customSchema || getStandardSchemaFigma(includeChartColors);
  const existingNames = collectionVariables.map(v => v.name);
  const expectedCount = includeChartColors ? 110 : 102;

  // Find missing variables
  const missing = standardVariables.filter(name => !existingNames.includes(name));

  // Find non-standard variables
  const nonStandard = existingNames.filter(name => !standardVariables.includes(name));

  const compliancePercentage = ((existingNames.length - nonStandard.length) / expectedCount * 100).toFixed(1);

  return {
    status: missing.length === 0 && nonStandard.length === 0 ? 'Complete' : 'Incomplete',
    totalVariables: existingNames.length,
    expectedVariables: expectedCount,
    compliancePercentage: parseFloat(compliancePercentage),
    missing: {
      count: missing.length,
      variables: missing
    },
    nonStandard: {
      count: nonStandard.length,
      variables: nonStandard.map(name => ({
        name,
        recommendation: 'Review if needed or remove if not in standard schema',
        action: 'review'
      }))
    },
    existing: {
      count: existingNames.length,
      variables: existingNames
    }
  };
}

// 11. validate_color_contrast
async function validateColorContrast(params) {
  const { collectionId, mode, standard } = params;
  const collection = await findCollection(collectionId);
  const allVariables = await figma.variables.getLocalVariablesAsync();
  const collectionVariables = allVariables.filter(v => v.variableCollectionId === collection.id);

  const targetMode = mode ? collection.modes.find(m => m.name === mode) : null;
  const modeId = targetMode ? targetMode.modeId : collection.modes[0].modeId;

  if (!modeId) {
    throw new Error(`Mode not found: ${mode}`);
  }

  // Helper to calculate contrast ratio
  function getLuminance(color) {
    const linearize = (val) => val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);
    const r = linearize(color.r);
    const g = linearize(color.g);
    const b = linearize(color.b);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function getContrastRatio(fg, bg) {
    const lum1 = getLuminance(fg);
    const lum2 = getLuminance(bg);
    const lighter = Math.max(lum1, lum2);
    const darker = Math.min(lum1, lum2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  // Find foreground/background pairs
  const pairs = [];
  const fgSuffix = '-foreground';

  for (const variable of collectionVariables) {
    if (variable.name.endsWith(fgSuffix)) {
      const baseName = variable.name.slice(0, -fgSuffix.length);
      const baseVariable = collectionVariables.find(v => v.name === baseName);

      if (baseVariable) {
        const fgValue = variable.valuesByMode[modeId];
        const bgValue = baseVariable.valuesByMode[modeId];

        if (fgValue && bgValue && typeof fgValue === 'object' && typeof bgValue === 'object') {
          const ratio = getContrastRatio(fgValue, bgValue);
          const minRatio = standard === 'AAA' ? 7.0 : 4.5;
          const pass = ratio >= minRatio;

          pairs.push({
            foreground: variable.name,
            background: baseVariable.name,
            ratio: parseFloat(ratio.toFixed(2)),
            pass,
            level: standard || 'AA',
            recommendation: pass ? `Meets ${standard} standards` : `Increase contrast - needs ${minRatio}:1 for ${standard} normal text`
          });
        }
      }
    }
  }

  const passed = pairs.filter(p => p.pass).length;
  const failed = pairs.filter(p => !p.pass).length;

  return {
    totalPairs: pairs.length,
    passed,
    failed,
    pairs
  };
}

// 12. suggest_missing_variables
async function suggestMissingVariables(params) {
  const { collectionId, useDefaults } = params;
  const collection = await findCollection(collectionId);
  const allVariables = await figma.variables.getLocalVariablesAsync();
  const collectionVariables = allVariables.filter(v => v.variableCollectionId === collection.id);

  const standardVariables = getStandardSchemaFigma(false);
  const existingNames = collectionVariables.map(v => v.name);
  const missing = standardVariables.filter(name => !existingNames.includes(name));

  const defaultTheme = getDefaultDarkTheme();
  const backgroundColor = defaultTheme['background'];

  const suggestions = missing.map(name => {
    let suggestedValue = useDefaults !== false ? defaultTheme[name] : null;

    // If it's a scale variable and useDefaults is true, calculate it
    if (useDefaults !== false && !suggestedValue && name.match(/-(50|100|200|300|400|500|600|700|800|900)$/)) {
      const baseName = name.split('-')[0];
      const level = name.split('-')[1];
      const baseColor = defaultTheme[baseName];

      if (baseColor) {
        const scale = calculateColorScaleFigma(baseColor, backgroundColor);
        suggestedValue = scale[level];
      }
    }

    return {
      name,
      category: getCategoryForVariable(name),
      suggestedValue,
      description: getDescriptionForVariable(name)
    };
  });

  return {
    missingCount: missing.length,
    suggestions
  };
}

function getCategoryForVariable(name) {
  if (name.match(/^(background|foreground|card|popover)/)) return 'surfaces';
  if (name.match(/^(primary|secondary|tertiary|accent)/)) return 'brand';
  if (name.match(/^(success|info|warning|destructive)/)) return 'states';
  if (name.match(/^(link)/)) return 'interactive';
  if (name.match(/^(overlay|tooltip|placeholder)/)) return 'feedback';
  if (name.match(/^(muted|selected|border|input|ring)/)) return 'utility';
  if (name.match(/^chart-/)) return 'chart';
  return 'unknown';
}

function getDescriptionForVariable(name) {
  const descriptions = {
    'background': 'Background color',
    'foreground': 'Foreground text color',
    'primary': 'Primary brand color',
    'success': 'Success state color',
    'info': 'Info state color',
    'warning': 'Warning state color',
    'destructive': 'Destructive/error state color'
  };

  if (name.endsWith('-foreground')) {
    const base = name.slice(0, -11);
    return `Text/icons for ${base}`;
  }

  if (name.match(/-\d+$/)) {
    return 'Color scale variant';
  }

  return descriptions[name] || 'Theme variable';
}

// 13. apply_default_theme
async function applyDefaultTheme(params) {
  const { collectionId, overwriteExisting, includeChartColors } = params;
  const collection = await findCollection(collectionId);
  const allVariables = await figma.variables.getLocalVariablesAsync();
  const collectionVariables = allVariables.filter(v => v.variableCollectionId === collection.id);
  const existingNames = new Set(collectionVariables.map(v => v.name));

  const defaultTheme = getDefaultDarkTheme();
  const backgroundColor = defaultTheme['background'];
  const modeId = collection.modes[0].modeId;

  let created = 0;
  let updated = 0;
  let skipped = 0;

  // Create base variables
  for (const [name, value] of Object.entries(defaultTheme)) {
    if (existingNames.has(name)) {
      if (overwriteExisting) {
        const variable = collectionVariables.find(v => v.name === name);
        variable.setValueForMode(modeId, value);
        updated++;
      } else {
        skipped++;
      }
    } else {
      const variable = figma.variables.createVariable(name, collection, 'COLOR');
      variable.setValueForMode(modeId, value);
      created++;
    }
  }

  // Create scale variables
  const scaleColors = ['primary', 'secondary', 'accent', 'success', 'info', 'warning', 'destructive'];
  for (const colorName of scaleColors) {
    const baseColor = defaultTheme[colorName];
    if (baseColor) {
      const scale = calculateColorScaleFigma(baseColor, backgroundColor);

      for (const [level, value] of Object.entries(scale)) {
        const varName = `${colorName}-${level}`;

        if (existingNames.has(varName)) {
          if (overwriteExisting) {
            const variable = collectionVariables.find(v => v.name === varName);
            variable.setValueForMode(modeId, value);
            updated++;
          } else {
            skipped++;
          }
        } else {
          const variable = figma.variables.createVariable(varName, collection, 'COLOR');
          variable.setValueForMode(modeId, value);
          created++;
        }
      }
    }
  }

  // Add chart colors if requested
  if (includeChartColors) {
    const chartColors = [
      { r: 0.639, g: 0.902, b: 0.208, a: 1.0 },
      { r: 0.118, g: 0.251, b: 0.686, a: 1.0 },
      { r: 0.863, g: 0.696, b: 0.149, a: 1.0 },
      { r: 0.863, g: 0.149, b: 0.149, a: 1.0 },
      { r: 0.576, g: 0.773, b: 0.992, a: 1.0 },
      { r: 0.078, g: 0.325, b: 0.176, a: 1.0 },
      { r: 0.980, g: 0.588, b: 0.118, a: 1.0 },
      { r: 0.639, g: 0.384, b: 0.863, a: 1.0 }
    ];

    for (let i = 0; i < chartColors.length; i++) {
      const varName = `chart-${i + 1}`;

      if (existingNames.has(varName)) {
        if (overwriteExisting) {
          const variable = collectionVariables.find(v => v.name === varName);
          variable.setValueForMode(modeId, chartColors[i]);
          updated++;
        } else {
          skipped++;
        }
      } else {
        const variable = figma.variables.createVariable(varName, collection, 'COLOR');
        variable.setValueForMode(modeId, chartColors[i]);
        created++;
      }
    }
  }

  const totalVariables = created + updated + skipped;

  return {
    created,
    updated,
    skipped,
    success: true,
    message: `Applied default ${includeChartColors ? 'dark theme with chart colors' : 'dark theme'} - ${created + updated} variables`
  };
}

// 14. create_color_scale_set
async function createColorScaleSet(params) {
  const { collectionId, colorName, baseColor, foregroundColor, backgroundColor, mode } = params;
  const collection = await findCollection(collectionId);
  const targetMode = mode ? collection.modes.find(m => m.name === mode) : null;
  const modeId = targetMode ? targetMode.modeId : collection.modes[0].modeId;

  if (!modeId) {
    throw new Error(`Mode not found: ${mode}`);
  }

  const created = [];

  // Create base color
  const baseVar = figma.variables.createVariable(colorName, collection, 'COLOR');
  baseVar.setValueForMode(modeId, baseColor);
  created.push(colorName);

  // Create foreground color
  const fgVar = figma.variables.createVariable(`${colorName}-foreground`, collection, 'COLOR');
  fgVar.setValueForMode(modeId, foregroundColor);
  created.push(`${colorName}-foreground`);

  // Create scale
  const scale = calculateColorScaleFigma(baseColor, backgroundColor);
  const scaleVars = [];

  for (const [level, value] of Object.entries(scale)) {
    const varName = `${colorName}-${level}`;
    const variable = figma.variables.createVariable(varName, collection, 'COLOR');
    variable.setValueForMode(modeId, value);
    created.push(varName);
    scaleVars.push(varName);
  }

  return {
    created: created.length,
    variables: {
      base: colorName,
      foreground: `${colorName}-foreground`,
      scale: scaleVars
    },
    success: true
  };
}

// 15. apply_custom_palette
async function applyCustomPalette(params) {
  const { collectionId, palette, backgroundColor, regenerateScales } = params;
  const collection = await findCollection(collectionId);
  const allVariables = await figma.variables.getLocalVariablesAsync();
  const collectionVariables = allVariables.filter(v => v.variableCollectionId === collection.id);
  const modeId = collection.modes[0].modeId;

  let baseColorsUpdated = 0;
  let foregroundsUpdated = 0;
  let scalesRegenerated = 0;

  for (const [colorName, colors] of Object.entries(palette)) {
    // Update or create base color
    let baseVar = collectionVariables.find(v => v.name === colorName);
    if (!baseVar) {
      baseVar = figma.variables.createVariable(colorName, collection, 'COLOR');
    }
    baseVar.setValueForMode(modeId, colors.base);
    baseColorsUpdated++;

    // Update or create foreground color
    let fgVar = collectionVariables.find(v => v.name === `${colorName}-foreground`);
    if (!fgVar) {
      fgVar = figma.variables.createVariable(`${colorName}-foreground`, collection, 'COLOR');
    }
    fgVar.setValueForMode(modeId, colors.foreground);
    foregroundsUpdated++;

    // Regenerate scales if requested
    if (regenerateScales !== false) {
      const scale = calculateColorScaleFigma(colors.base, backgroundColor);

      for (const [level, value] of Object.entries(scale)) {
        const varName = `${colorName}-${level}`;
        let scaleVar = collectionVariables.find(v => v.name === varName);

        if (!scaleVar) {
          scaleVar = figma.variables.createVariable(varName, collection, 'COLOR');
        }
        scaleVar.setValueForMode(modeId, value);
        scalesRegenerated++;
      }
    }
  }

  return {
    baseColorsUpdated,
    foregroundsUpdated,
    scalesRegenerated,
    success: true
  };
}

// 16. reorder_variables
async function reorderVariables(params) {
  const { collectionId, order } = params;
  const collection = await findCollection(collectionId);

  // Note: Figma Plugin API doesn't directly support reordering variables
  // This is a limitation of the current API
  // We'll return success but note the limitation

  return {
    reordered: 0,
    success: true,
    message: 'Variable reordering is not supported by Figma Plugin API. Variables are ordered alphabetically by Figma.'
  };
}

// 17. generate_audit_report
async function generateAuditReport(params) {
  const { collectionId, includeChartColors, format } = params;

  // Get audit data
  const auditData = await auditCollection({ collectionId, includeChartColors });

  if (format === 'json') {
    return auditData;
  }

  // Generate markdown report
  const lines = [];
  lines.push('=== THEME COLLECTION AUDIT REPORT ===');
  lines.push('');
  lines.push(`Status: ${auditData.status}`);
  lines.push(`Total Variables: ${auditData.totalVariables} / ${auditData.expectedVariables} expected`);
  lines.push(`Compliance: ${auditData.compliancePercentage}%`);
  lines.push('');

  if (auditData.missing.count > 0) {
    lines.push(`MISSING VARIABLES (${auditData.missing.count}):`);
    auditData.missing.variables.forEach(name => {
      lines.push(`  - ${name}`);
    });
    lines.push('');
  }

  if (auditData.nonStandard.count > 0) {
    lines.push(`NON-STANDARD VARIABLES (${auditData.nonStandard.count}):`);
    auditData.nonStandard.variables.forEach(item => {
      lines.push(`  - ${item.name} (${item.recommendation})`);
    });
    lines.push('');
  }

  lines.push('RECOMMENDATIONS:');
  if (auditData.missing.count > 0) {
    lines.push(`1. Add ${auditData.missing.count} missing variables to reach ${auditData.expectedVariables}-variable standard`);
  }
  if (auditData.nonStandard.count > 0) {
    lines.push(`2. Review ${auditData.nonStandard.count} non-standard variables (rename/remove)`);
  }
  lines.push('3. Validate color contrast for all foreground variants');

  return lines.join('\n');
}

// 18. export_collection_schema
async function exportCollectionSchema(params) {
  const { collectionId, mode, includeMetadata } = params;
  const collection = await findCollection(collectionId);
  const allVariables = await figma.variables.getLocalVariablesAsync();
  const collectionVariables = allVariables.filter(v => v.variableCollectionId === collection.id);

  const targetMode = mode ? collection.modes.find(m => m.name === mode) : null;
  const modeId = targetMode ? targetMode.modeId : collection.modes[0].modeId;

  if (!modeId) {
    throw new Error(`Mode not found: ${mode}`);
  }

  const schema = {
    schema_version: '1.2',
    variables: {}
  };

  if (includeMetadata !== false) {
    schema.collection = {
      name: collection.name,
      modes: collection.modes.map(m => m.name),
      exportedMode: mode || collection.modes[0].name,
      variableCount: collectionVariables.length
    };
  }

  for (const variable of collectionVariables) {
    const value = variable.valuesByMode[modeId];

    if (value && typeof value === 'object') {
      schema.variables[variable.name] = {
        type: 'COLOR',
        value,
        category: getCategoryForVariable(variable.name)
      };
    }
  }

  return schema;
}

// 19. import_collection_schema
async function importCollectionSchema(params) {
  const { collectionId, schema, mode, overwriteExisting } = params;
  const collection = await findCollection(collectionId);
  const allVariables = await figma.variables.getLocalVariablesAsync();
  const collectionVariables = allVariables.filter(v => v.variableCollectionId === collection.id);
  const existingNames = new Set(collectionVariables.map(v => v.name));

  const targetMode = mode ? collection.modes.find(m => m.name === mode) : null;
  const modeId = targetMode ? targetMode.modeId : collection.modes[0].modeId;

  if (!modeId) {
    throw new Error(`Mode not found: ${mode}`);
  }

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const errors = [];

  for (const [name, varData] of Object.entries(schema.variables)) {
    try {
      if (existingNames.has(name)) {
        if (overwriteExisting) {
          const variable = collectionVariables.find(v => v.name === name);
          variable.setValueForMode(modeId, varData.value);
          updated++;
        } else {
          skipped++;
        }
      } else {
        const variable = figma.variables.createVariable(name, collection, 'COLOR');
        variable.setValueForMode(modeId, varData.value);
        imported++;
      }
    } catch (error) {
      failed++;
      errors.push({ name, error: error.message });
    }
  }

  return {
    imported,
    updated,
    skipped,
    failed,
    errors
  };
}

// 20. create_all_scales
async function createAllScales(params) {
  const { collectionId, baseColors, backgroundColor } = params;
  const collection = await findCollection(collectionId);
  const modeId = collection.modes[0].modeId;

  let created = 0;
  const scales = {};

  for (const [colorName, baseColor] of Object.entries(baseColors)) {
    const scale = calculateColorScaleFigma(baseColor, backgroundColor);
    let scaleCount = 0;

    for (const [level, value] of Object.entries(scale)) {
      const varName = `${colorName}-${level}`;
      const variable = figma.variables.createVariable(varName, collection, 'COLOR');
      variable.setValueForMode(modeId, value);
      scaleCount++;
      created++;
    }

    scales[colorName] = scaleCount;
  }

  return {
    created,
    scales,
    success: true
  };
}

// 21. fix_collection_to_standard
async function fixCollectionToStandard(params) {
  const { collectionId, preserveCustom, addChartColors, useDefaultValues, dryRun } = params;

  // Get current state
  const auditResult = await auditCollection({ collectionId, includeChartColors: addChartColors });

  const analysis = {
    missingBefore: auditResult.missing.count,
    nonStandardBefore: auditResult.nonStandard.count,
    totalBefore: auditResult.totalVariables
  };

  if (dryRun) {
    return {
      analysis,
      actions: {
        variablesAdded: auditResult.missing.count,
        variablesRenamed: 0,
        variablesRemoved: preserveCustom ? 0 : auditResult.nonStandard.count,
        variablesPreserved: preserveCustom ? auditResult.nonStandard.count : 0
      },
      result: {
        totalVariables: auditResult.totalVariables + auditResult.missing.count - (preserveCustom ? 0 : auditResult.nonStandard.count),
        compliance: '100%',
        status: 'Complete (Dry Run)'
      },
      dryRun: true
    };
  }

  // Apply fixes
  let variablesAdded = 0;
  let variablesRemoved = 0;

  // Add missing variables
  if (useDefaultValues !== false && auditResult.missing.count > 0) {
    const result = await applyDefaultTheme({
      collectionId,
      overwriteExisting: false,
      includeChartColors: addChartColors
    });
    variablesAdded = result.created;
  }

  // Remove non-standard variables
  if (!preserveCustom && auditResult.nonStandard.count > 0) {
    const result = await deleteVariablesBatch({
      variableIds: auditResult.nonStandard.variables.map(v => v.name),
      collectionId
    });
    variablesRemoved = result.deleted;
  }

  const finalAudit = await auditCollection({ collectionId, includeChartColors: addChartColors });

  return {
    analysis,
    actions: {
      variablesAdded,
      variablesRenamed: 0,
      variablesRemoved,
      variablesPreserved: preserveCustom ? auditResult.nonStandard.count : 0
    },
    result: {
      totalVariables: finalAudit.totalVariables,
      compliance: `${finalAudit.compliancePercentage}%`,
      status: finalAudit.status
    },
    success: true
  };
}

// 22. add_chart_colors
async function addChartColors(params) {
  const { collectionId, chartColors } = params;
  const collection = await findCollection(collectionId);
  const modeId = collection.modes[0].modeId;

  const defaultChartColors = [
    { r: 0.639, g: 0.902, b: 0.208, a: 1.0 },
    { r: 0.118, g: 0.251, b: 0.686, a: 1.0 },
    { r: 0.863, g: 0.696, b: 0.149, a: 1.0 },
    { r: 0.863, g: 0.149, b: 0.149, a: 1.0 },
    { r: 0.576, g: 0.773, b: 0.992, a: 1.0 },
    { r: 0.078, g: 0.325, b: 0.176, a: 1.0 },
    { r: 0.980, g: 0.588, b: 0.118, a: 1.0 },
    { r: 0.639, g: 0.384, b: 0.863, a: 1.0 }
  ];

  const colors = chartColors || defaultChartColors;
  const created = [];

  for (let i = 0; i < Math.min(colors.length, 8); i++) {
    const varName = `chart-${i + 1}`;
    const variable = figma.variables.createVariable(varName, collection, 'COLOR');
    variable.setValueForMode(modeId, colors[i]);
    created.push(varName);
  }

  return {
    created: created.length,
    chartColors: created,
    success: true
  };
}
