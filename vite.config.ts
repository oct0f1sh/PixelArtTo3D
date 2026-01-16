import { defineConfig } from 'vite'
import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { resolve } from 'path'

// Copy manifold WASM to public folder (served at root URL)
const wasmSrc = resolve(__dirname, 'node_modules/manifold-3d/manifold.wasm')
const wasmDest = resolve(__dirname, 'public/manifold.wasm')
if (existsSync(wasmSrc) && !existsSync(wasmDest)) {
  mkdirSync(resolve(__dirname, 'public'), { recursive: true })
  copyFileSync(wasmSrc, wasmDest)
}

export default defineConfig({
  base: '/PixelArtTo3D/',
  build: {
    outDir: 'dist'
  },
  optimizeDeps: {
    exclude: ['manifold-3d']
  }
})
