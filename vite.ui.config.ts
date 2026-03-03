import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  plugins: [preact(), viteSingleFile()],
  root: 'src/claude_mcp_plugin/ui',
  build: {
    outDir: '..',
    emptyOutDir: false,
    target: 'es2017',
    rollupOptions: {
      input: 'src/claude_mcp_plugin/ui/ui.html',
    },
  },
})
