# Pixel Art to 3D Model Converter - Technical Specification

## Overview

A single-page web application that converts pixel art images or photographs into 3D printable models (STL/3MF format). Designed for creating keychains and small decorative items from pixel art.

**Target Deployment:** GitHub Pages (static site hosting)

---

## Tech Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Build Tool | Vite | Fast dev server, simple config, outputs static files for GitHub Pages |
| Language | TypeScript | Type safety, better IDE support, catches bugs at compile time |
| 3D Engine | Three.js | Industry standard for web 3D, handles rendering and geometry generation |
| Styling | CSS (dark theme with blue accents) | Native CSS, no framework dependency |
| Testing | Vitest | Fast unit testing compatible with Vite |

### For iOS Developers New to Web Dev

- **Vite** is like Xcode's build system - it compiles your code and runs a dev server
- **npm** is like CocoaPods/SPM - it manages third-party dependencies
- **TypeScript** is like Swift - adds type safety to JavaScript
- **Three.js** is like SceneKit - a 3D rendering framework

---

## Features

### 1. Image Input

- **Drag & drop zone** or file selector button
- Accepted formats: PNG, JPG, WebP
- **Transparency handling:** Pixels with <50% opacity are filtered out (treated as background)
- **Auto scale detection:** Automatically detects upscaled pixel art and downsamples to native resolution
- **Input/Output preview:** Side-by-side comparison with zoom and pan controls
- **Pixel grid overlay:** Toggle to visualize detected pixel boundaries

### 2. Background Removal

- **Toggle to enable/disable** background color removal
- **Color picker with eyedropper tool:** Click on image to select background color
- **Auto-detection:** Background color is automatically guessed when image loads (analyzes edge pixels)
- **Tolerance slider:** 0-50 range for color matching flexibility
- **Flood-fill behavior:** Only removes background connected to image edges

### 3. Color Processing

- **Color extraction:** Automatically extracts all unique colors from image
- **Color reduction toggle:** Enable to reduce palette to target count
- **Target color slider:** Set desired number of colors (2 to max detected)
- **Increment/decrement buttons:** Fine-tune color count one at a time
- **Individual color deletion:** X button on each color swatch to remove specific colors
- **Color restoration:** Deleted colors can be restored with + button
  - Manually deleted colors (X button) prioritized over auto-deleted (slider)
- **Color palette panel:** Shows all colors with hex values and delete buttons

### 4. Dimension Controls

- **Width/Height input:** User sets ONE dimension, the other auto-calculates from aspect ratio
  - Linked toggle to switch which dimension is primary
  - Default: 50mm width
- **Unit selection:** Toggle between Imperial (inches) and Metric (mm)
  - Internally always work in mm, convert for display only
- **Live dimension display:** Shows calculated output dimensions

### 5. 3D Height Settings

- **Pixel height:** Adjustable height of each pixel "block" (default: 1mm, range: 0.5-10mm)
- **Base toggle:** Enable/disable base layer
- **Base height:** Height of the solid base beneath pixels (default: 2mm, range: 0.5-5mm)
- **Base color picker:** Choose color for base layer in 3MF export

### 6. Base Geometry

- Base matches the exact footprint of non-transparent pixels (not a bounding rectangle)
- Base is a single solid color (neutral gray in preview, user's choice in export)
- All base geometry merged into one mesh for the base "object" in 3MF

### 7. Keyhole Feature

- **Optional toggle:** Enable/disable hanging hole for keychain ring
- **Position selector:** Dropdown with options:
  - Top-left
  - Top-center
  - Top-right
- **Hole specifications:**
  - Diameter: 4mm (standard for small keyring)
  - Position: Centered within a small tab extension from the base

### 8. 3D Preview

- **Renderer:** Three.js WebGL canvas
- **Camera controls:** Orbit, zoom, and pan (OrbitControls)
- **Reset view button:** Return camera to default position
- **Grid helper:** Shows scale reference (mm or inches based on unit selection)
- **Base color in preview:** Fixed neutral gray (#808080)
- **Pixel colors:** Match extracted/quantized palette from image
- Background: Dark (#1a1a1a) to match UI theme

### 9. Export Options

#### STL Export
- Single mesh containing all geometry
- Binary STL format (smaller file size)
- No color information

#### 3MF Export
- **Multiple objects:** One object per unique color + one object for base
- **Color mapping display:** Panel shows which object name corresponds to which color
  - Format: `color_1 (#FF5733)`, `color_2 (#33FF57)`, `base (#808080)`
- **Manifest includes:** Color metadata for compatible slicers

#### File Naming
- **Default filename:** `pixel_art_keychain.stl` or `.3mf`
- **Editable:** Text input to customize before export

### 10. UI/UX Features

- **Collapsible panels:** Most panels can be collapsed/expanded
- **State persistence:** Panel collapse states saved to localStorage
- **Dark theme:** Deep gray backgrounds with blue accent colors
- **Sharp modern styling:** Clean lines, subtle shadows, smooth transitions
- **Responsive layout:** Desktop-first with tablet/mobile adaptations

---

## Mesh Generation Algorithm

### Pixel-to-Geometry Conversion

1. Parse image data from canvas
2. Apply transparency filter (alpha < 128 = transparent)
3. Optionally remove background color with tolerance
4. Run color quantization/reduction if enabled
5. For each color in palette:
   - Identify all pixels of that color
   - **Merge adjacent pixels** into larger rectangles (greedy meshing algorithm)
   - Generate box geometry for each merged rectangle
   - Combine into single BufferGeometry per color

### Greedy Meshing (Optimization)

Instead of creating one cube per pixel:
1. Scan pixels left-to-right, top-to-bottom
2. For each unprocessed pixel, expand rectangle right while same color
3. Then expand rectangle down while entire row matches
4. Mark all pixels in rectangle as processed
5. Create single box for the rectangle

**Benefits:**
- 10-100x reduction in polygon count
- Smaller file sizes
- Faster slicing in 3D printing software

### Manifold Geometry

Meshes must be watertight for 3D printing:
- Zero boundary edges (used by only 1 face)
- Zero non-manifold edges (used by >2 faces)
- Vertex offsetting at diagonal corners prevents shared edges

### Base Generation

1. Create 2D polygon from outline of non-transparent pixels
2. Use marching squares or contour tracing to find perimeter
3. Extrude polygon to base height
4. Optionally add keyhole geometry (boolean subtraction)

---

## UI Layout

```
+--------------------------------------------------+
|  Pixel Art to 3D Converter                       |
+--------------------------------------------------+
|                                                  |
|  +-- IMAGE INPUT (collapsible) ---------------+ |
|  | [DROP IMAGE HERE or click to upload]       | |
|  | +--------+  +--------+                     | |
|  | | Input  |  | Output |  [Show Grid] toggle | |
|  | +--------+  +--------+                     | |
|  +--------------------------------------------+ |
|                                                  |
|  +-- BACKGROUND REMOVAL (collapsible) --------+ |
|  | [x] Remove background  [color] [eyedropper]| |
|  | Tolerance: [====o====] 10                  | |
|  +--------------------------------------------+ |
|                                                  |
|  +-- 3D PREVIEW (always visible) -------------+ |
|  | +--------------------------------------+   | |
|  | |                                      |   | |
|  | |         Three.js Canvas              |   | |
|  | |                                      |   | |
|  | +--------------------------------------+   | |
|  | [Reset View]                               | |
|  +--------------------------------------------+ |
|                                                  |
|  +-- PHYSICAL DIMENSIONS (collapsible) -------+ |
|  | Width: [50] mm    Height: [auto] mm        | |
|  | Units: [mm] / [inches]                     | |
|  +--------------------------------------------+ |
|                                                  |
|  +-- 3D HEIGHT SETTINGS (collapsible) --------+ |
|  | Pixel Height: [====o====] 1.0 mm           | |
|  | [x] Include base layer                     | |
|  | Base Height: [====o====] 2.0 mm            | |
|  | Base Color: [#000000]                      | |
|  +--------------------------------------------+ |
|                                                  |
|  +-- KEYHOLE OPTIONS (collapsible) -----------+ |
|  | [x] Add keyhole                            | |
|  | Position: [Top-center v]                   | |
|  +--------------------------------------------+ |
|                                                  |
|  +-- COLOR PALETTE (collapsible) -------------+ |
|  | [x] Reduce color count  [-] [====] [+]     | |
|  | +------+ +------+ +------+ +------+        | |
|  | |[x]   | |[x]   | |[x]   | |[x]   |        | |
|  | |color1| |color2| |color3| |color4|        | |
|  | +------+ +------+ +------+ +------+        | |
|  +--------------------------------------------+ |
|                                                  |
|  +-- EXPORT (always visible) -----------------+ |
|  | Format: [STL] / [3MF]                      | |
|  | Filename: [pixel_art_keychain] .3mf        | |
|  | [        DOWNLOAD        ]                 | |
|  +--------------------------------------------+ |
+--------------------------------------------------+
```

### Responsive Behavior (Desktop-First)

- **Desktop (>1024px):** Full layout as shown
- **Tablet (768-1024px):** Stacked panels, smaller preview
- **Mobile (<768px):** Single column, scrollable. Preview may be smaller.

---

## File Structure

```
/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── CLAUDE.md              # Claude Code guidance
├── SPECS.md               # This file
├── src/
│   ├── main.ts            # Entry point, event handlers, UI state
│   ├── style.css          # Global styles, dark theme, components
│   ├── imageProcessor.ts  # Load image, background removal, quantize colors
│   ├── meshGenerator.ts   # Pixel-to-3D conversion, greedy meshing, manifold
│   ├── exporter.ts        # STL and 3MF export logic
│   ├── preview.ts         # Three.js scene setup, controls
│   ├── types.ts           # TypeScript interfaces
│   ├── manifold.test.ts   # Mesh geometry tests
│   └── imageProcessing.test.ts  # Image processing tests
├── public/
│   └── favicon.ico
└── .github/
    └── workflows/
        └── deploy.yml     # GitHub Actions for Pages deployment
```

---

## Dependencies

```json
{
  "dependencies": {
    "three": "^0.160.0",
    "fflate": "^0.8.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "vite": "^5.0.0",
    "@types/three": "^0.160.0",
    "vitest": "^2.0.0"
  }
}
```

---

## GitHub Pages Deployment

### Vite Configuration

```typescript
// vite.config.ts
export default {
  base: '/PixelArtConverter/', // Repository name
  build: {
    outDir: 'dist'
  }
}
```

### GitHub Actions Workflow

```yaml
# .github/workflows/deploy.yml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run build
      - uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./dist
```

---

## Default Values Summary

| Setting | Default | Range/Options |
|---------|---------|---------------|
| Width | 50mm | 1-500mm |
| Units | Metric (mm) | mm / inches |
| Pixel Height | 1mm | 0.5-10mm |
| Base Height | 2mm | 0.5-5mm |
| Base Enabled | true | On/Off |
| Base Color | #000000 | Any hex color |
| Color Reduce Target | 8 | 2-max detected |
| Background Removal | Off | On/Off |
| Background Tolerance | 10 | 0-50 |
| Transparency Threshold | 50% | Fixed |
| Keyhole | Disabled | On/Off |
| Keyhole Position | Top-center | Top-left/center/right |
| Export Format | 3MF | STL / 3MF |

---

## Future Considerations

These features are explicitly out of scope for v1 but the architecture should not preclude them:

- Custom keyhole positioning (drag to place)
- Multiple keyhole support
- Beveled/rounded edges on pixels
- Magnet hole option (for fridge magnets)
- Batch processing multiple images
- Save/load project settings
- Undo/redo for color changes
- Color picker to change individual colors
- Import/export color palettes

---

## Browser Support

| Browser | Support Level |
|---------|--------------|
| Chrome 90+ | Full |
| Firefox 90+ | Full |
| Safari 15+ | Full |
| Edge 90+ | Full |
| Mobile Safari | Basic (may have WebGL limitations) |
| Mobile Chrome | Basic |

WebGL 2.0 required for Three.js. Fallback message shown if unavailable.
