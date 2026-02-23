import { defineConfig } from 'tsup';

export default defineConfig([
  // MCP server build (CJS + ESM)
  {
    entry: ['src/claude_figma_mcp/server.ts', 'src/socket.ts'],
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
  // During migration: outputs to code.next.js; switch entry key to 'code' after full verification
  {
    entry: { 'code.next': 'src/claude_mcp_plugin/index.ts' },
    outDir: 'src/claude_mcp_plugin',
    format: ['iife'],
    target: 'es2017',
    bundle: true,
    minify: false,
    sourcemap: false,
    splitting: false,
    clean: false, // don't wipe manifest.json / ui.html
    tsconfig: 'tsconfig.plugin.json',
    // Override tsup's default '.global.js' IIFE suffix so the output is a plain .js file
    outExtension: () => ({ js: '.js' }),
  },
]);
