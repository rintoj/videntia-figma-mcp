import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  plugins: [tailwindcss(), preact(), viteSingleFile()],
  root: 'src/figma_mcp_plugin/ui',
  build: {
    outDir: '..',
    emptyOutDir: false,
    target: 'es2017',
    rollupOptions: {
      input: 'src/figma_mcp_plugin/ui/ui.html',
    },
  },
})
