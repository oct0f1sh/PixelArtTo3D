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
2. **Background Removal** (`imageProcessor.ts`): Optional removal of background color with tolerance
3. **Auto Scale Detection** (`imageProcessor.ts`): Detects if pixel art is upscaled and finds optimal dimensions
4. **Color Quantization** (`imageProcessor.ts`): `quantizeColors()` reduces to N colors, produces `QuantizedResult` with palette and `PixelGrid` (2D array of color indices, -1 = transparent)
5. **Mesh Generation** (`meshGenerator.ts`): `generateMeshes()` creates Three.js `BufferGeometry` for each color layer plus a base mesh
6. **Preview** (`preview.ts`): Three.js scene with OrbitControls displays the model
7. **Export** (`exporter.ts`): `exportSTL()` or `export3MF()` generates downloadable files

### Key Types

- `PixelGrid`: `number[][]` where -1 = transparent, other values = palette index
- `Color`: `{ r, g, b, hex }`
- `MeshResult`: `{ colorMeshes: Map<number, BufferGeometry>, baseMesh: BufferGeometry | null, keyholeApplied: boolean }`
- `QuantizedResult`: `{ palette: Color[], pixels: PixelGrid, width: number, height: number }`

### Mesh Structure

The 3D model consists of:
- **Base mesh**: Covers all non-transparent pixels (y=0 to y=baseHeight)
- **Color meshes**: One per color, sits on top of base (y=baseHeight to y=baseHeight+pixelHeight)

### Manifold Geometry

Meshes must be watertight (zero boundary edges) and manifold (each edge shared by exactly 2 faces) for 3D printing. The `generateManifoldGeometry()` function handles this by offsetting vertices at diagonal corners where 4 walls would otherwise share an edge.

### Export Formats

- **STL**: Single merged mesh, binary format, no color
- **3MF**: ZIP archive with XML, separate objects per color with material assignments

## UI Structure

The UI uses a three-column workspace layout with collapsible panels:

### Layout
- **Left Panel (Source)**: Image input, preview with zoom/pan, crop tool, background removal options
- **Center Panel (Preview)**: Full-size Three.js 3D preview canvas
- **Right Panel (Controls)**: Collapsible settings panels, color palette
- **Bottom Bar**: Export format toggle, filename input, download button

### Left Panel (Source)
- **Drop Zone**: Drag & drop, file selector, URL import
- **Image Preview**: Input/output tabs with zoom/pan (up to 50x), pixel grid overlay
- **Preview Toolbar**: Grid toggle, crop button, clear image
- **Background Section**: Toggle, color picker with eyedropper (always accessible), tolerance slider

### Right Panel (Controls)
- **Physical Dimensions**: Width/height inputs, unit toggle (mm/inches)
- **3D Height Settings**: Pixel height slider, base toggle and height, base color picker
- **Keyhole Options**: Enable toggle, type selector (holepunch/floating), diameter controls
- **Magnet Compartment**: Enable toggle, size presets, diameter/height/depth controls
- **Color Palette**: Expands to fill remaining space, horizontal rows showing label/hex/preview/delete button

### Features
- **Resizable Left Sidebar**: Drag handle between source panel and preview (200px-600px range)
- **Panel State Persistence**: Collapse states saved to localStorage
- **Mobile Responsive**: Stacks vertically on screens ≤900px with touch-optimized controls

### Image Input Features

- **URL Import**: Load images directly from URLs (with CORS support)
- **Image Cropping**: Click "Crop" button to enter crop mode, drag to select region, resize with handles, Apply/Cancel
- **Zoom/Pan**: Mouse wheel to zoom (up to 50x), click and drag to pan

### Undo/Redo

Full undo/redo support for most actions:
- `Cmd+Z` (Mac) / `Ctrl+Z` (Windows): Undo
- `Shift+Cmd+Z` (Mac) / `Ctrl+Y` (Windows): Redo
- Supports up to 50 history states

### Color Management

- **Reduce color count**: Slider sets target, +/- buttons for fine control
- **Individual deletion**: X button on each color swatch removes that color, remaps pixels to nearest
- **Color restoration**: Manually deleted colors (X button) are prioritized for restoration via + button
- **Auto-deleted colors**: Colors removed via slider can also be restored

## Testing

Test files:
- `src/manifold.test.ts` - Verifies mesh geometry is valid for 3D printing (zero non-manifold/boundary edges)
- `src/holepunch-manifold.test.ts` - Tests keyhole punch CSG operations maintain manifold geometry
- `src/magnet-manifold.test.ts` - Tests magnet compartment CSG operations maintain manifold geometry
- `src/merged-mesh.test.ts` - Tests merged mesh generation for STL export
- `src/imageProcessing.test.ts` - Tests background removal, pixel scale detection, color accuracy

Test images are located in `test-resources/` directory:
- `queen.png` - Native resolution pixel art
- `ral.png` - Small pixel art test image
- `ral2.jpg` - Upscaled pixel art for scale detection tests

## Default Values

| Setting | Default |
|---------|---------|
| Width | 50mm |
| Pixel Height | 1mm |
| Base Height | 2mm |
| Base Enabled | true |
| Color Reduce Target | 8 |
| Background Tolerance | 10 |
| Export Format | 3MF |

## Git Commits

- Do not include Co-Authored-By lines mentioning Claude in commit messages
