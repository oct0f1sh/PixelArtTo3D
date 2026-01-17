/**
 * Test that meshes have zero non-manifold edges for 3D printing
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { createCanvas, loadImage } from 'canvas';
import * as THREE from 'three';
import { generateMeshes, generateMeshesAsync } from './meshGenerator';
import { quantizeColors } from './imageProcessor';

async function loadImageData(imagePath: string): Promise<ImageData> {
  const img = await loadImage(imagePath);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, img.width, img.height) as unknown as ImageData;
}

// Load and downsample large images for faster testing
async function loadDownsampledImageData(imagePath: string, maxDim: number): Promise<ImageData> {
  const img = await loadImage(imagePath);
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.floor(img.width * scale);
  const h = Math.floor(img.height * scale);
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h) as unknown as ImageData;
}

function analyzeEdges(geometry: THREE.BufferGeometry) {
  const position = geometry.attributes.position;
  if (!position) return { nonManifoldEdges: 0, boundaryEdges: 0 };

  const edgeCounts = new Map<string, number>();
  const vertexKey = (i: number) =>
    `${position.getX(i).toFixed(4)},${position.getY(i).toFixed(4)},${position.getZ(i).toFixed(4)}`;
  const edgeKey = (v1: string, v2: string) => v1 < v2 ? `${v1}|${v2}` : `${v2}|${v1}`;

  const indices = geometry.index;
  if (indices) {
    for (let i = 0; i < indices.count; i += 3) {
      const vA = vertexKey(indices.getX(i));
      const vB = vertexKey(indices.getX(i + 1));
      const vC = vertexKey(indices.getX(i + 2));
      for (const key of [edgeKey(vA, vB), edgeKey(vB, vC), edgeKey(vC, vA)]) {
        edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
      }
    }
  } else {
    for (let i = 0; i < position.count; i += 3) {
      const vA = vertexKey(i);
      const vB = vertexKey(i + 1);
      const vC = vertexKey(i + 2);
      for (const key of [edgeKey(vA, vB), edgeKey(vB, vC), edgeKey(vC, vA)]) {
        edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
      }
    }
  }

  let nonManifoldEdges = 0, boundaryEdges = 0;
  for (const count of edgeCounts.values()) {
    if (count > 2) nonManifoldEdges++;
    else if (count === 1) boundaryEdges++;
  }
  return { nonManifoldEdges, boundaryEdges };
}

function expectManifold(geometry: THREE.BufferGeometry | null, name: string) {
  if (!geometry) return;
  const { nonManifoldEdges, boundaryEdges } = analyzeEdges(geometry);
  expect(nonManifoldEdges, `${name} has non-manifold edges`).toBe(0);
  expect(boundaryEdges, `${name} has boundary edges`).toBe(0);
}

describe('Mesh Manifold Tests', () => {
  // STL mode tests (singleMeshMode)
  describe('STL mode (singleMeshMode)', () => {
    it('2-color grid', () => {
      const result = generateMeshes({
        pixelGrid: [[0, 1], [0, 1]],
        palette: [{ r: 255, g: 0, b: 0, hex: '#ff0000' }, { r: 0, g: 255, b: 0, hex: '#00ff00' }],
        pixelSize: 1, pixelHeight: 2, baseHeight: 1, singleMeshMode: true,
      });
      for (const [, geom] of result.colorMeshes) expectManifold(geom, 'unified');
    });

    it('4-color grid', () => {
      const result = generateMeshes({
        pixelGrid: [[0, 1], [2, 3]],
        palette: [
          { r: 255, g: 0, b: 0, hex: '#ff0000' }, { r: 0, g: 255, b: 0, hex: '#00ff00' },
          { r: 0, g: 0, b: 255, hex: '#0000ff' }, { r: 255, g: 255, b: 0, hex: '#ffff00' },
        ],
        pixelSize: 1, pixelHeight: 2, baseHeight: 1, singleMeshMode: true,
      });
      for (const [, geom] of result.colorMeshes) expectManifold(geom, 'unified');
    });

    it('checkerboard', () => {
      const result = generateMeshes({
        pixelGrid: [[0, 1, 0], [1, 0, 1], [0, 1, 0]],
        palette: [{ r: 255, g: 255, b: 255, hex: '#ffffff' }, { r: 0, g: 0, b: 0, hex: '#000000' }],
        pixelSize: 1, pixelHeight: 2, baseHeight: 1, singleMeshMode: true,
      });
      for (const [, geom] of result.colorMeshes) expectManifold(geom, 'unified');
    });

    it('with holepunch', async () => {
      // Note: Y coordinate is negative in mesh coordinate system
      const result = await generateMeshesAsync({
        pixelGrid: [[0, 1, 2], [0, 1, 2], [0, 1, 2]],
        palette: [
          { r: 255, g: 0, b: 0, hex: '#ff0000' }, { r: 0, g: 255, b: 0, hex: '#00ff00' },
          { r: 0, g: 0, b: 255, hex: '#0000ff' },
        ],
        pixelSize: 10, pixelHeight: 2, baseHeight: 1, singleMeshMode: true,
        keyhole: { enabled: true, type: 'holepunch', position: { x: 15.1, y: -15.1 }, holeDiameter: 4, innerDiameter: 4, outerDiameter: 8 },
      });
      for (const [, geom] of result.colorMeshes) expectManifold(geom, 'unified');
    });
  });

  // 3MF mode tests (normal mode with separate base + colors)
  describe('3MF mode (normal)', () => {
    it('3-color grid with holepunch', async () => {
      // Note: Y coordinate is negative in mesh coordinate system
      const result = await generateMeshesAsync({
        pixelGrid: [[0, 1, 2], [0, 1, 2], [0, 1, 2]],
        palette: [
          { r: 255, g: 0, b: 0, hex: '#ff0000' }, { r: 0, g: 255, b: 0, hex: '#00ff00' },
          { r: 0, g: 0, b: 255, hex: '#0000ff' },
        ],
        pixelSize: 10, pixelHeight: 2, baseHeight: 1,
        keyhole: { enabled: true, type: 'holepunch', position: { x: 15.1, y: -15.1 }, holeDiameter: 4, innerDiameter: 4, outerDiameter: 8 },
              });
      expectManifold(result.baseMesh, 'base');
      for (const [idx, geom] of result.colorMeshes) expectManifold(geom, `color ${idx}`);
    });

    it('base/color Y offset prevents top/bottom overlap', () => {
      // This test verifies that base top and color bottom don't overlap at y=baseHeight
      // Color meshes are offset by 0.02mm to prevent face coincidence
      const result = generateMeshes({
        pixelGrid: [[0]],  // Single pixel, single color
        palette: [{ r: 255, g: 0, b: 0, hex: '#ff0000' }],
        pixelSize: 10, pixelHeight: 2, baseHeight: 1,
      });

      // Get Y coordinates from base top and color bottom
      const baseMesh = result.baseMesh!;
      const colorMesh = result.colorMeshes.get(0)!;

      // Find Y values in each mesh
      const baseYs = new Set<number>();
      const colorYs = new Set<number>();
      const basePos = baseMesh.attributes.position;
      const colorPos = colorMesh.attributes.position;

      for (let i = 0; i < basePos.count; i++) {
        baseYs.add(Math.round(basePos.getY(i) * 100) / 100);
      }
      for (let i = 0; i < colorPos.count; i++) {
        colorYs.add(Math.round(colorPos.getY(i) * 100) / 100);
      }

      // Base should have y=0 (bottom) and y=1 (top)
      expect(baseYs.has(0)).toBe(true);
      expect(baseYs.has(1)).toBe(true);

      // Color should have y=1.02 (bottom, offset) and y=3.02 (top)
      // Note: color bottom is offset by 0.02mm to prevent overlap with base top
      expect(colorYs.has(1.02)).toBe(true);
      expect(colorYs.has(3.02)).toBe(true);

      // Verify NO overlap: base max Y (1.0) < color min Y (1.02)
      const baseMaxY = Math.max(...baseYs);
      const colorMinY = Math.min(...colorYs);
      expect(colorMinY).toBeGreaterThan(baseMaxY);
    });

    it('queen.png without holepunch', async () => {
      const imagePath = path.resolve(process.cwd(), 'test-resources/queen.png');
      if (!fs.existsSync(imagePath)) return;

      const imageData = await loadImageData(imagePath);
      const quantized = quantizeColors(imageData, 5);
      const result = generateMeshes({
        pixelGrid: quantized.pixels, palette: quantized.palette,
        pixelSize: 1, pixelHeight: 2, baseHeight: 1,
      });

      expectManifold(result.baseMesh, 'base');
      for (const [idx, geom] of result.colorMeshes) expectManifold(geom, `color ${idx}`);
    });

    it('ral2.jpg with holepunch (downsampled)', async () => {
      const imagePath = path.resolve(process.cwd(), 'test-resources/ral2.jpg');
      if (!fs.existsSync(imagePath)) return;

      // Downsample to 75x100 for faster testing (10% of original)
      const imageData = await loadDownsampledImageData(imagePath, 100);
      const quantized = quantizeColors(imageData, 5);

      const totalWidthMm = 30;
      const pixelSizeMm = totalWidthMm / imageData.width;
      // Slight offset to avoid edge cases, negative Y for mesh coordinate system
      const holeX = totalWidthMm / 2 + 0.13;
      const holeY = -(imageData.height * pixelSizeMm) / 2 - 0.17;

      const result = await generateMeshesAsync({
        pixelGrid: quantized.pixels, palette: quantized.palette,
        pixelSize: pixelSizeMm, pixelHeight: 2, baseHeight: 1,
        keyhole: { enabled: true, type: 'holepunch', position: { x: holeX, y: holeY }, holeDiameter: 4, innerDiameter: 4, outerDiameter: 8 },
              });

      expectManifold(result.baseMesh, 'base');
      for (const [idx, geom] of result.colorMeshes) expectManifold(geom, `color ${idx}`);
    });

    // Full resolution test - only run when debugging specific issues
    it.skip('ral2.jpg with holepunch (FULL RESOLUTION)', async () => {
      const imagePath = path.resolve(process.cwd(), 'test-resources/ral2.jpg');
      if (!fs.existsSync(imagePath)) return;

      const imageData = await loadImageData(imagePath);
      const quantized = quantizeColors(imageData, 5);

      const totalWidthMm = 30;
      const pixelSizeMm = totalWidthMm / imageData.width;
      const holeX = totalWidthMm / 2 + 0.13;
      const holeY = -(imageData.height * pixelSizeMm) / 2 - 0.17;

      const result = await generateMeshesAsync({
        pixelGrid: quantized.pixels, palette: quantized.palette,
        pixelSize: pixelSizeMm, pixelHeight: 2, baseHeight: 1,
        keyhole: { enabled: true, type: 'holepunch', position: { x: holeX, y: holeY }, holeDiameter: 4, innerDiameter: 4, outerDiameter: 8 },
              });

      expectManifold(result.baseMesh, 'base');
      for (const [idx, geom] of result.colorMeshes) expectManifold(geom, `color ${idx}`);
    }, 300000); // 5 minute timeout
  });
});
