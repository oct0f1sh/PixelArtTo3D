# Pixel Art to 3D Model Converter

Convert pixel art images into 3D printable models (STL/3MF). Perfect for creating keychains, magnets, and retro gaming decorations.

**[Try it live](https://oct0f1sh.github.io/PixelArtTo3D/)**

## Features

- **100% In-Browser** — Your images never leave your device. No uploads, no server processing.
- **STL Export** — Single mesh, binary format for universal slicer compatibility
- **3MF Export** — Multi-color support with separate objects per color
- **URL Import** — Load images directly from URLs (with CORS support)
- **Image Cropping** — Select and crop regions of your image before processing
- **Background Removal** — Auto-detect or manually pick background color with eyedropper
- **Color Reduction** — Reduce palette to target color count for cleaner prints
- **Keyhole Option** — Add a hanging hole for keychains (holepunch or floating ring style)
- **Magnet Compartments** — Add cylindrical cavities for embedding magnets
- **Auto Scale Detection** — Automatically detects upscaled pixel art and downsamples to native resolution
- **Real-time 3D Preview** — Orbit, zoom (up to 50x), and pan to inspect your model before export
- **Customizable Dimensions** — Set physical size in mm or inches
- **Undo/Redo** — Full history support (Cmd+Z / Ctrl+Z to undo, Shift+Cmd+Z / Ctrl+Y to redo)

## How It Works

1. **Drop an image** — PNG, JPG, or WebP
2. **Adjust settings** — Remove background, reduce colors, set dimensions
3. **Preview in 3D** — Rotate and inspect your model
4. **Export** — Download STL or 3MF file
5. **Print** — Load into your slicer and print!

## Tech Stack

- **Vite** — Build tool and dev server
- **TypeScript** — Type-safe JavaScript
- **Three.js** — 3D rendering and geometry generation
- **Vitest** — Unit testing

## Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Run tests
npm test

# Build for production
npm run build
```

## Deployment

The project is configured for GitHub Pages deployment. Push to `main` and the GitHub Action will automatically build and deploy.

```bash
git add -A && git commit -m "Your message" && git push
```

Live at: `https://<username>.github.io/PixelArtTo3D/`

## Project Structure

```
├── index.html          # Main HTML with SEO meta tags
├── src/
│   ├── main.ts         # App entry, UI state, event handlers
│   ├── style.css       # Dark theme styling
│   ├── imageProcessor.ts   # Image loading, background removal, color quantization
│   ├── meshGenerator.ts    # Pixel-to-3D conversion, greedy meshing
│   ├── exporter.ts     # STL and 3MF export
│   ├── preview.ts      # Three.js scene and controls
│   ├── types.ts        # TypeScript interfaces
│   └── *.test.ts       # Unit tests (Vitest)
├── test-resources/     # Test images (queen.png, ral.png, ral2.jpg)
├── public/
│   ├── robots.txt      # Search engine crawler rules
│   ├── sitemap.xml     # Sitemap for SEO
│   └── favicon.svg     # Browser tab icon
└── .github/workflows/
    └── deploy.yml      # GitHub Pages deployment
```

## How the 3D Conversion Works

1. **Parse image** — Extract pixel data from canvas
2. **Remove background** — Filter transparent and background-colored pixels
3. **Quantize colors** — Reduce to target palette using median-cut algorithm
4. **Greedy meshing** — Merge adjacent same-color pixels into larger rectangles (reduces polygon count 10-100x)
5. **Generate geometry** — Create manifold (watertight) meshes for 3D printing
6. **Export** — Package as binary STL or 3MF with color metadata

## License

MIT
