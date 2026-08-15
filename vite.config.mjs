import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 3100
  },
  preview: {
    host: '127.0.0.1',
    port: 3100
  },
  build: {
    outDir: 'build'
  },
  plugins: [
    viteStaticCopy({
      targets: [{ src: 'data', dest: '.' }]
    })
  ]
});
