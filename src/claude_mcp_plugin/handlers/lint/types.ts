export type ViolationSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type ViolationCategory =
  | 'rootFrame'
  | 'typography'
  | 'spacing'
  | 'borderRadius'
  | 'iconColors'
  | 'strokesBorders'
  | 'backgroundFills'
  | 'effectStyles'
  | 'overflow'
  | 'autoLayout';

export interface ViolationDetails {
  axis?: 'horizontal' | 'vertical';
  overflowAmount?: number;
  childRight?: number;
  parentRight?: number;
  childBottom?: number;
  parentBottom?: number;
}

export interface Violation {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  depth: number;
  severity: ViolationSeverity;
  category: ViolationCategory;
  property: string;
  message: string;
  details?: ViolationDetails;
  fixed?: boolean;
  fixedWith?: string;
}

export interface CategoryStats {
  total: number;
  bound: number;
  unbound: number;
  compliance: number;
}

export interface LintCategories {
  rootFrame: CategoryStats;
  typography: CategoryStats;
  spacing: CategoryStats;
  borderRadius: CategoryStats;
  iconColors: CategoryStats;
  strokesBorders: CategoryStats;
  backgroundFills: CategoryStats;
  effectStyles: CategoryStats;
  overflow: CategoryStats;
  autoLayout: CategoryStats;
}

export interface LintSummary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  compliance: number;
  fixed: number;
}

export interface LintResult {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  totalNodes: number;
  categories: LintCategories;
  violations: Violation[];
  violationsCapped: boolean;
  summary: LintSummary;
}

export interface LintChecks {
  rootFrame?: boolean;
  colors?: boolean;
  spacing?: boolean;
  radius?: boolean;
  textStyles?: boolean;
  effectStyles?: boolean;
  autoLayout?: boolean;
  overflow?: boolean;
}

export interface LintOptions {
  nodeId: string;
  checks?: LintChecks;
  fix?: boolean;
}

export interface ActiveChecks {
  rootFrame: boolean;
  colors: boolean;
  spacing: boolean;
  radius: boolean;
  textStyles: boolean;
  effectStyles: boolean;
  autoLayout: boolean;
  overflow: boolean;
}

export interface ColorVarEntry {
  id: string;
  nameLower: string;
  color: { r: number; g: number; b: number };
}

export interface FloatVarEntry {
  id: string;
  nameLower: string;
  value: number;
}

export interface LookupMaps {
  variableMap: Record<string, Variable>;
  textStyleMap: Record<string, TextStyle>;
  effectStyleMap: Record<string, EffectStyle>;
  paintStyleMap: Record<string, PaintStyle>;
  localVars: Variable[];
  localTextStyles: TextStyle[];
  colorVarEntries: ColorVarEntry[];
  floatVarEntries: FloatVarEntry[];
  textStyleExactMap: Record<string, TextStyle>;
}
