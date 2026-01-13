# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pixel Art to 3D Converter is a web application that converts pixel art images into 3D printable models (STL/3MF format). It uses Vite, TypeScript, and Three.js, and is deployed to GitHub Pages.

## Commands

```bash
npm run dev        # Start development server (http://localhost:5173/PixelArtConverter/)
npm run build      # TypeScript check + Vite build
npm test           # Run tests once
npm run test:watch # Run tests in watch mode
```

## Architecture

### Data Flow

1. **Image Input** (`imageProcessor.ts`): User uploads image → `loadImage()` extracts `ImageData`
2. **Color Quantization** (`imageProcessor.ts`): `quantizeColors()` reduces to N colors using median-cut algorithm, produces `QuantizedResult` with palette and `PixelGrid` (2D array of color indices, -1 = transparent)
3. **Mesh Generation** (`meshGenerator.ts`): `generateMeshes()` creates Three.js `BufferGeometry` for each color layer plus a base mesh
4. **Preview** (`preview.ts`): Three.js scene with OrbitControls displays the model
5. **Export** (`exporter.ts`): `exportSTL()` or `export3MF()` generates downloadable files

### Key Types

- `PixelGrid`: `number[][]` where -1 = transparent, other values = palette index
- `Color`: `{ r, g, b, hex }`
- `MeshResult`: `{ colorMeshes: Map<number, BufferGeometry>, baseMesh: BufferGeometry | null, keyholeApplied: boolean }`

### Mesh Structure

The 3D model consists of:
- **Base mesh**: Covers all non-transparent pixels (y=0 to y=baseHeight)
- **Color meshes**: One per color, sits on top of base (y=baseHeight to y=baseHeight+pixelHeight)

### Manifold Geometry

Meshes must be watertight (zero boundary edges) and manifold (each edge shared by exactly 2 faces) for 3D printing. The `generateManifoldGeometry()` function handles this by offsetting vertices at diagonal corners where 4 walls would otherwise share an edge.

### Export Formats

- **STL**: Single merged mesh, binary format, no color
- **3MF**: ZIP archive with XML, separate objects per color with material assignments

## Testing

Tests in `src/manifold.test.ts` verify mesh geometry is valid for 3D printing. They analyze edge usage to ensure:
- Zero non-manifold edges (used by >2 faces)
- Zero boundary edges (used by only 1 face)

Test images should be placed in the project root (e.g., `queen.png`, `ral.png`).
