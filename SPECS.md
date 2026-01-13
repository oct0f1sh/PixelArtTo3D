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
| Styling | CSS (dark theme) | Native CSS, no framework dependency |
| Error Tracking | Sentry (free tier) | Capture JavaScript errors in production for debugging |

### For iOS Developers New to Web Dev

- **Vite** is like Xcode's build system - it compiles your code and runs a dev server
- **npm** is like CocoaPods/SPM - it manages third-party dependencies
- **TypeScript** is like Swift - adds type safety to JavaScript
- **Three.js** is like SceneKit - a 3D rendering framework

---

## Features

### 1. Image Input

- **Drag & drop zone** or file selector button
- Accepted formats: PNG, JPG, GIF, WebP
- **Transparency handling:** Pixels with <50% opacity are filtered out (treated as background)
- **Resize/downscale option:** User can reduce image resolution before conversion (e.g., "Treat as 32x32")
  - Show warning if image exceeds 64px in either dimension
  - Suggest appropriate downscale factor

### 2. Color Processing

- **Color quantization:** Reduce image to N colors using median-cut or k-means algorithm
- **Default:** 8 colors
- **Range:** 2-16 colors (user adjustable via slider or input)
- **Color palette panel:** Always visible, showing extracted colors with hex values

### 3. Dimension Controls

- **Width/Height input:** User sets ONE dimension, the other auto-calculates from aspect ratio
  - Linked toggle to switch which dimension is primary
  - Default: 50mm width
- **Unit selection:** Toggle between Imperial (inches) and Metric (mm)
  - Internally always work in mm, convert for display only
- **Pixel height:** Adjustable height of each pixel "block" (default: 2mm)
- **Base height:** Height of the solid base beneath pixels (default: 1mm)

### 4. Base Geometry

- Base matches the exact footprint of non-transparent pixels (not a bounding rectangle)
- Base is a single solid color (neutral gray in preview, user's choice in export)
- All base geometry merged into one mesh for the base "object" in 3MF

### 5. Keyhole Feature

- **Optional toggle:** Enable/disable hanging hole for keychain ring
- **Position selector:** Dropdown with options:
  - Top-left
  - Top-center
  - Top-right
- **Hole specifications:**
  - Diameter: 4mm (standard for small keyring)
  - Position: Centered within a small tab extension from the base

### 6. 3D Preview

- **Renderer:** Three.js WebGL canvas
- **Camera controls:** Orbit, zoom, and pan (OrbitControls)
- **Base color in preview:** Fixed neutral gray (#808080)
- **Pixel colors:** Match quantized palette from image
- Background: Dark (#1a1a1a) to match UI theme

### 7. Export Options

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
- **Default filename:** `{original_filename}_keychain.stl` or `.3mf`
- **Editable:** Text input to customize before export

### 8. Error Handling

- **3MF export failure:**
  - Show retry button
  - Display technical error details (expandable)
  - Suggest STL as fallback
- **General errors:** Toast notifications with actionable messages

---

## Mesh Generation Algorithm

### Pixel-to-Geometry Conversion

1. Parse image data from canvas
2. Apply transparency filter (alpha < 128 = transparent)
3. Run color quantization to reduce to target palette
4. For each color in palette:
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

### Base Generation

1. Create 2D polygon from outline of non-transparent pixels
2. Use marching squares or contour tracing to find perimeter
3. Extrude polygon to base height
4. Optionally add keyhole geometry (boolean subtraction)

---

## UI Layout

```
+--------------------------------------------------+
|  [Logo] Pixel Art to 3D Converter    [Dark Theme]|
+--------------------------------------------------+
|                    |                              |
|  +-------------+   |     +------------------+     |
|  | DROP IMAGE  |   |     |                  |     |
|  |   HERE      |   |     |   3D PREVIEW     |     |
|  |  or click   |   |     |    (Three.js)    |     |
|  +-------------+   |     |                  |     |
|                    |     +------------------+     |
|  SETTINGS          |                              |
|  ---------------   |     COLOR PALETTE           |
|  Width: [50] mm    |     +-----------------+     |
|  Height: auto      |     | #FF5733  [swatch]|     |
|  [x] Lock aspect   |     | #33FF57  [swatch]|     |
|                    |     | #3357FF  [swatch]|     |
|  Units: mm / in    |     | ...              |     |
|                    |     +-----------------+     |
|  Pixel Height: 2mm |                              |
|  Base Height: 1mm  |     EXPORT                  |
|                    |     +------------------+     |
|  Colors: [8] ----  |     | Filename:        |     |
|                    |     | [sprite_keychain]|     |
|  Resize to: [32px] |     |                  |     |
|                    |     | Format: STL / 3MF|     |
|  [ ] Add Keyhole   |     |                  |     |
|  Position: [v Top] |     | [DOWNLOAD]       |     |
|                    |     +------------------+     |
+--------------------------------------------------+
```

### Responsive Behavior (Desktop-First)

- **Desktop (>1024px):** Two-column layout as shown
- **Tablet (768-1024px):** Stack preview below controls
- **Mobile (<768px):** Single column, scrollable. Preview may be smaller.

---

## File Structure

```
/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── src/
│   ├── main.ts              # Entry point, event handlers
│   ├── style.css            # Global styles, dark theme
│   ├── imageProcessor.ts    # Load image, quantize colors
│   ├── meshGenerator.ts     # Pixel-to-3D conversion, greedy meshing
│   ├── exporter.ts          # STL and 3MF export logic
│   ├── preview.ts           # Three.js scene setup, controls
│   └── types.ts             # TypeScript interfaces
├── public/
│   └── favicon.ico
└── .github/
    └── workflows/
        └── deploy.yml       # GitHub Actions for Pages deployment
```

---

## Dependencies

```json
{
  "dependencies": {
    "three": "^0.160.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "vite": "^5.0.0",
    "@types/three": "^0.160.0",
    "@sentry/browser": "^7.0.0"
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
| Pixel Height | 2mm | 0.5-10mm |
| Base Height | 1mm | 0.5-5mm |
| Color Count | 8 | 2-16 |
| Transparency Threshold | 50% | Fixed |
| Keyhole | Disabled | On/Off |
| Keyhole Position | Top-center | Top-left/center/right |
| Export Format | STL | STL / 3MF |

---

## Future Considerations

These features are explicitly out of scope for v1 but the architecture should not preclude them:

- Custom keyhole positioning (drag to place)
- Multiple keyhole support
- Beveled/rounded edges on pixels
- Magnet hole option (for fridge magnets)
- Batch processing multiple images
- Save/load project settings

---

## Error Tracking Setup (Sentry)

Initialize in `main.ts`:

```typescript
import * as Sentry from "@sentry/browser";

Sentry.init({
  dsn: "YOUR_SENTRY_DSN",
  environment: import.meta.env.MODE,
});
```

Captures:
- Unhandled JavaScript exceptions
- 3MF export failures with stack traces
- Three.js WebGL context errors

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
