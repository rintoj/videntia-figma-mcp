import { defineConfig } from 'tsup';

export default defineConfig([
  // MCP server build (CJS + ESM)
  {
    entry: ['src/hgraph_figma_mcp/server.ts', 'src/socket.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    outDir: 'dist',
    target: 'node18',
    sourcemap: true,
    minify: false,
    splitting: false,
    bundle: true,
  },
  // Figma plugin build (IIFE, single bundled file)
  {
    entry: { 'code': 'src/hgraph_figma_plugin/index.ts' },
    outDir: 'src/hgraph_figma_plugin',
    format: ['iife'],
    target: 'es2017',
    bundle: true,
    minify: true,
    sourcemap: false,
    splitting: false,
    clean: false, // don't wipe manifest.json / ui.html
    tsconfig: 'tsconfig.plugin.json',
    // Override tsup's default '.global.js' IIFE suffix so the output is a plain .js file
    outExtension: () => ({ js: '.js' }),
  },
]);
