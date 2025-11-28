import {
  getStandardSchema,
  getAllStandardVariableNames,
  getVariableCategory,
  isScaleVariable,
  getBaseColorFromScale,
  getScaleLevelFromVariable,
  getScaleVariableNames,
  isStandardVariable,
  getStandardVariableOrder
} from '../../../src/talk_to_figma_mcp/utils/theme-schema';

describe('Theme Schema', () => {
  describe('getStandardSchema', () => {
    it('should return schema with 106 variables without chart colors', () => {
      const schema = getStandardSchema(false);

      expect(schema.totalVariables).toBe(106);
      expect(schema.version).toBe('1.2');
      expect(schema.categories).toBeDefined();
    });

    it('should return schema with 114 variables with chart colors', () => {
      const schema = getStandardSchema(true);

      expect(schema.totalVariables).toBe(114);
      expect(schema.categories.chart).toBeDefined();
      expect(schema.categories.chart.count).toBe(8);
    });

    it('should have correct category counts', () => {
      const schema = getStandardSchema(false);

      expect(schema.categories.surfaces.count).toBe(6);
      expect(schema.categories.brand.count).toBe(8);
      expect(schema.categories.states.count).toBe(8);
      expect(schema.categories.interactive.count).toBe(2);
      expect(schema.categories.feedback.count).toBe(5);
      expect(schema.categories.utility.count).toBe(7);
      expect(schema.categories.scales.count).toBe(70);
    });
  });

  describe('getAllStandardVariableNames', () => {
    it('should return 106 variables without chart colors', () => {
      const names = getAllStandardVariableNames(false);

      expect(names).toHaveLength(106);
    });

    it('should return 114 variables with chart colors', () => {
      const names = getAllStandardVariableNames(true);

      expect(names).toHaveLength(114);
    });

    it('should include base colors', () => {
      const names = getAllStandardVariableNames(false);

      expect(names).toContain('background');
      expect(names).toContain('foreground');
      expect(names).toContain('primary');
      expect(names).toContain('primary-foreground');
    });

    it('should include scale variables', () => {
      const names = getAllStandardVariableNames(false);

      expect(names).toContain('primary-50');
      expect(names).toContain('primary-500');
      expect(names).toContain('primary-900');
    });
  });

  describe('getVariableCategory', () => {
    it('should categorize surface variables', () => {
      expect(getVariableCategory('background')).toBe('surfaces');
      expect(getVariableCategory('foreground')).toBe('surfaces');
      expect(getVariableCategory('card')).toBe('surfaces');
    });

    it('should categorize brand variables', () => {
      expect(getVariableCategory('primary')).toBe('brand');
      expect(getVariableCategory('secondary')).toBe('brand');
      expect(getVariableCategory('accent')).toBe('brand');
    });

    it('should categorize state variables', () => {
      expect(getVariableCategory('success')).toBe('states');
      expect(getVariableCategory('warning')).toBe('states');
      expect(getVariableCategory('destructive')).toBe('states');
    });

    it('should categorize chart variables', () => {
      expect(getVariableCategory('chart-1')).toBe('chart');
      expect(getVariableCategory('chart-8')).toBe('chart');
    });

    it('should return unknown for invalid variables', () => {
      expect(getVariableCategory('invalid-var')).toBe('unknown');
    });
  });

  describe('isScaleVariable', () => {
    it('should identify scale variables', () => {
      expect(isScaleVariable('primary-50')).toBe(true);
      expect(isScaleVariable('primary-500')).toBe(true);
      expect(isScaleVariable('destructive-900')).toBe(true);
    });

    it('should reject non-scale variables', () => {
      expect(isScaleVariable('primary')).toBe(false);
      expect(isScaleVariable('primary-foreground')).toBe(false);
      expect(isScaleVariable('background')).toBe(false);
    });

    it('should reject invalid scale levels', () => {
      expect(isScaleVariable('primary-25')).toBe(false);
      expect(isScaleVariable('primary-1000')).toBe(false);
    });
  });

  describe('getBaseColorFromScale', () => {
    it('should extract base color name', () => {
      expect(getBaseColorFromScale('primary-50')).toBe('primary');
      expect(getBaseColorFromScale('success-500')).toBe('success');
      expect(getBaseColorFromScale('destructive-900')).toBe('destructive');
    });

    it('should return null for non-scale variables', () => {
      expect(getBaseColorFromScale('primary')).toBeNull();
      expect(getBaseColorFromScale('background')).toBeNull();
    });
  });

  describe('getScaleLevelFromVariable', () => {
    it('should extract scale level', () => {
      expect(getScaleLevelFromVariable('primary-50')).toBe(50);
      expect(getScaleLevelFromVariable('primary-500')).toBe(500);
      expect(getScaleLevelFromVariable('primary-900')).toBe(900);
    });

    it('should return null for non-scale variables', () => {
      expect(getScaleLevelFromVariable('primary')).toBeNull();
      expect(getScaleLevelFromVariable('background')).toBeNull();
    });
  });

  describe('getScaleVariableNames', () => {
    it('should generate all 10 scale variable names', () => {
      const names = getScaleVariableNames('primary');

      expect(names).toHaveLength(10);
      expect(names).toContain('primary-50');
      expect(names).toContain('primary-500');
      expect(names).toContain('primary-900');
    });

    it('should work for all base colors', () => {
      const colors = ['primary', 'secondary', 'accent', 'success', 'info', 'warning', 'destructive'];

      colors.forEach(color => {
        const names = getScaleVariableNames(color);
        expect(names).toHaveLength(10);
        expect(names[0]).toBe(`${color}-50`);
        expect(names[9]).toBe(`${color}-900`);
      });
    });
  });

  describe('isStandardVariable', () => {
    it('should identify standard base variables', () => {
      expect(isStandardVariable('background')).toBe(true);
      expect(isStandardVariable('primary')).toBe(true);
      expect(isStandardVariable('success-foreground')).toBe(true);
    });

    it('should identify standard scale variables', () => {
      expect(isStandardVariable('primary-50')).toBe(true);
      expect(isStandardVariable('success-500')).toBe(true);
      expect(isStandardVariable('destructive-900')).toBe(true);
    });

    it('should identify chart colors when included', () => {
      expect(isStandardVariable('chart-1', true)).toBe(true);
      expect(isStandardVariable('chart-8', true)).toBe(true);
    });

    it('should reject chart colors when not included', () => {
      expect(isStandardVariable('chart-1', false)).toBe(false);
    });

    it('should reject non-standard variables', () => {
      expect(isStandardVariable('custom-color')).toBe(false);
      expect(isStandardVariable('error')).toBe(false);
    });
  });

  describe('getStandardVariableOrder', () => {
    it('should return 106 variables in order without chart colors', () => {
      const order = getStandardVariableOrder(false);

      expect(order).toHaveLength(106);
    });

    it('should return 114 variables in order with chart colors', () => {
      const order = getStandardVariableOrder(true);

      expect(order).toHaveLength(114);
      expect(order).toContain('chart-1');
      expect(order).toContain('chart-8');
    });

    it('should have background as first variable', () => {
      const order = getStandardVariableOrder();

      expect(order[0]).toBe('background');
    });

    it('should have primary before its scales', () => {
      const order = getStandardVariableOrder();

      const primaryIndex = order.indexOf('primary');
      const primary50Index = order.indexOf('primary-50');

      expect(primaryIndex).toBeLessThan(primary50Index);
    });

    it('should have scales in correct order', () => {
      const order = getStandardVariableOrder();

      const primary50 = order.indexOf('primary-50');
      const primary500 = order.indexOf('primary-500');
      const primary900 = order.indexOf('primary-900');

      expect(primary50).toBeLessThan(primary500);
      expect(primary500).toBeLessThan(primary900);
    });

    it('should have chart colors at the end when included', () => {
      const order = getStandardVariableOrder(true);

      const lastVariable = order[order.length - 1];
      expect(lastVariable).toBe('chart-8');
    });
  });
});
