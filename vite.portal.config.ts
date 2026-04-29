import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  plugins: [tailwindcss(), preact(), viteSingleFile()],
  root: 'src/portal',
  build: {
    outDir: '../../dist/portal',
    emptyOutDir: true,
    target: 'es2020',
    rollupOptions: {
      input: 'src/portal/index.html',
    },
  },
})
