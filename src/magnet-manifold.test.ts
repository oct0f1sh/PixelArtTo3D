/**
 * Tests for magnet compartment manifold geometry
 * Ensures meshes with magnet cavities remain watertight for 3D printing
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { createCanvas, loadImage } from 'canvas';
import * as THREE from 'three';
import { generateMeshesAsync } from './meshGenerator';
import { quantizeColors } from './imageProcessor';

async function loadImageData(imagePath: string, maxDim = 100): Promise<ImageData> {
  const image = await loadImage(imagePath);
  const scale = Math.min(1, maxDim / Math.max(image.width, image.height));
  const w = Math.floor(image.width * scale);
  const h = Math.floor(image.height * scale);
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h) as unknown as ImageData;
}

function analyzeEdges(geometry: THREE.BufferGeometry) {
  const position = geometry.attributes.position;
  const index = geometry.index;
  if (!position) {
    return { nonManifoldEdges: 0, boundaryEdges: 0, totalEdges: 0 };
  }

  const EPSILON = 0.005;
  const positionToIndex = new Map<string, number>();
  const oldToNewIndex: number[] = [];

  for (let i = 0; i < position.count; i++) {
    const x = Math.round(position.getX(i) / EPSILON) * EPSILON;
    const y = Math.round(position.getY(i) / EPSILON) * EPSILON;
    const z = Math.round(position.getZ(i) / EPSILON) * EPSILON;
    const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
    let newIndex = positionToIndex.get(key);
    if (newIndex === undefined) {
      newIndex = positionToIndex.size;
      positionToIndex.set(key, newIndex);
    }
    oldToNewIndex[i] = newIndex;
  }

  const edgeCounts = new Map<string, number>();
  const triCount = index ? index.count / 3 : position.count / 3;

  for (let t = 0; t < triCount; t++) {
    let i0: number, i1: number, i2: number;
    if (index) {
      i0 = index.getX(t * 3);
      i1 = index.getX(t * 3 + 1);
      i2 = index.getX(t * 3 + 2);
    } else {
      i0 = t * 3;
      i1 = t * 3 + 1;
      i2 = t * 3 + 2;
    }

    const a = oldToNewIndex[i0];
    const b = oldToNewIndex[i1];
    const c = oldToNewIndex[i2];

    if (a === b || b === c || c === a) continue;

    for (const [v1, v2] of [[a, b], [b, c], [c, a]]) {
      const key = v1 < v2 ? `${v1}-${v2}` : `${v2}-${v1}`;
      edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
    }
  }

  let nonManifoldEdges = 0;
  let boundaryEdges = 0;
  for (const count of edgeCounts.values()) {
    if (count > 2) nonManifoldEdges++;
    else if (count === 1) boundaryEdges++;
  }

  return { nonManifoldEdges, boundaryEdges, totalEdges: edgeCounts.size };
}

function expectManifold(geometry: THREE.BufferGeometry | null, name: string) {
  expect(geometry, `${name} should exist`).not.toBeNull();
  if (!geometry) return;

  const analysis = analyzeEdges(geometry);
  console.log(`${name}: ${geometry.attributes.position?.count || 0} vertices, ${analysis.totalEdges} edges, ${analysis.nonManifoldEdges} non-manifold, ${analysis.boundaryEdges} boundary`);
  expect(analysis.nonManifoldEdges, `${name} has non-manifold edges`).toBe(0);
  expect(analysis.boundaryEdges, `${name} has boundary edges`).toBe(0);
}

describe('Magnet Compartment Manifold Tests', () => {
  it('single magnet at center - meshes should be manifold', async () => {
    const imagePath = path.resolve(process.cwd(), 'test-resources/queen.png');
    if (!fs.existsSync(imagePath)) {
      console.log('Skipping test - test-resources/queen.png not found');
      return;
    }

    const imageData = await loadImageData(imagePath);
    const quantized = quantizeColors(imageData, 5);

    const totalWidthMm = 30;
    const pixelSizeMm = totalWidthMm / quantized.width;
    const totalHeightMm = quantized.height * pixelSizeMm;

    // Place magnet at center
    const magnetX = totalWidthMm / 2;
    const magnetY = totalHeightMm / 2;

    console.log(`Image: ${quantized.width}x${quantized.height}, magnet at (${magnetX.toFixed(1)}, ${magnetY.toFixed(1)})`);

    const result = await generateMeshesAsync({
      pixelGrid: quantized.pixels,
      palette: quantized.palette,
      pixelSize: pixelSizeMm,
      pixelHeight: 2,
      baseHeight: 2,
      magnet: {
        enabled: true,
        positions: [{ x: magnetX, y: magnetY }],
        diameter: 6,
        height: 2,
        depth: 0.5,
      },
    });

    expectManifold(result.baseMesh, 'base');
    for (const [idx, geom] of result.colorMeshes) {
      expectManifold(geom, `color ${idx}`);
    }
  });

  it('multiple magnets - meshes should be manifold', async () => {
    const imagePath = path.resolve(process.cwd(), 'test-resources/ral2.jpg');
    if (!fs.existsSync(imagePath)) {
      console.log('Skipping test - test-resources/ral2.jpg not found');
      return;
    }

    const imageData = await loadImageData(imagePath, 75);
    const quantized = quantizeColors(imageData, 5);

    const totalWidthMm = 30;
    const pixelSizeMm = totalWidthMm / quantized.width;
    const totalHeightMm = quantized.height * pixelSizeMm;

    // Place magnets at corners (with offset from edges)
    const margin = 5;
    const magnetPositions = [
      { x: margin, y: margin },
      { x: totalWidthMm - margin, y: margin },
      { x: margin, y: totalHeightMm - margin },
      { x: totalWidthMm - margin, y: totalHeightMm - margin },
    ];

    console.log(`Image: ${quantized.width}x${quantized.height}, ${magnetPositions.length} magnets`);

    const result = await generateMeshesAsync({
      pixelGrid: quantized.pixels,
      palette: quantized.palette,
      pixelSize: pixelSizeMm,
      pixelHeight: 2,
      baseHeight: 2,
      magnet: {
        enabled: true,
        positions: magnetPositions,
        diameter: 4,
        height: 1.5,
        depth: 0.3,
      },
    });

    expectManifold(result.baseMesh, 'base');
    for (const [idx, geom] of result.colorMeshes) {
      expectManifold(geom, `color ${idx}`);
    }
  });

  it('magnet with holepunch - meshes should be manifold', async () => {
    const imagePath = path.resolve(process.cwd(), 'test-resources/queen.png');
    if (!fs.existsSync(imagePath)) {
      console.log('Skipping test - test-resources/queen.png not found');
      return;
    }

    const imageData = await loadImageData(imagePath);
    const quantized = quantizeColors(imageData, 5);

    const totalWidthMm = 30;
    const pixelSizeMm = totalWidthMm / quantized.width;
    const totalHeightMm = quantized.height * pixelSizeMm;

    // Holepunch at top center, magnet at bottom center
    const holeX = totalWidthMm / 2 + 0.13;
    const holeY = -3; // Near top (negative Y in mesh coords)
    const magnetX = totalWidthMm / 2;
    const magnetY = totalHeightMm - 5;

    console.log(`Testing combined holepunch and magnet`);

    const result = await generateMeshesAsync({
      pixelGrid: quantized.pixels,
      palette: quantized.palette,
      pixelSize: pixelSizeMm,
      pixelHeight: 2,
      baseHeight: 2,
      keyhole: {
        enabled: true,
        type: 'holepunch',
        position: { x: holeX, y: holeY },
        holeDiameter: 4,
        innerDiameter: 4,
        outerDiameter: 8,
      },
      magnet: {
        enabled: true,
        positions: [{ x: magnetX, y: magnetY }],
        diameter: 6,
        height: 2,
        depth: 0.5,
      },
    });

    expectManifold(result.baseMesh, 'base');
    for (const [idx, geom] of result.colorMeshes) {
      expectManifold(geom, `color ${idx}`);
    }
  });

  it('large magnet (8mm diameter) - meshes should be manifold', async () => {
    const imagePath = path.resolve(process.cwd(), 'test-resources/queen.png');
    if (!fs.existsSync(imagePath)) {
      console.log('Skipping test - test-resources/queen.png not found');
      return;
    }

    const imageData = await loadImageData(imagePath);
    const quantized = quantizeColors(imageData, 5);

    const totalWidthMm = 40;
    const pixelSizeMm = totalWidthMm / quantized.width;
    const totalHeightMm = quantized.height * pixelSizeMm;

    const result = await generateMeshesAsync({
      pixelGrid: quantized.pixels,
      palette: quantized.palette,
      pixelSize: pixelSizeMm,
      pixelHeight: 2,
      baseHeight: 3,
      magnet: {
        enabled: true,
        positions: [{ x: totalWidthMm / 2, y: totalHeightMm / 2 }],
        diameter: 8, // Large magnet
        height: 3,
        depth: 0.5,
      },
    });

    expectManifold(result.baseMesh, 'base');
    for (const [idx, geom] of result.colorMeshes) {
      expectManifold(geom, `color ${idx}`);
    }
  });

  it('centered depth magnet - meshes should be manifold', async () => {
    const imagePath = path.resolve(process.cwd(), 'test-resources/queen.png');
    if (!fs.existsSync(imagePath)) {
      console.log('Skipping test - test-resources/queen.png not found');
      return;
    }

    const imageData = await loadImageData(imagePath);
    const quantized = quantizeColors(imageData, 5);

    const totalWidthMm = 30;
    const pixelSizeMm = totalWidthMm / quantized.width;
    const totalHeightMm = quantized.height * pixelSizeMm;

    const pixelHeight = 2;
    const baseHeight = 2;
    const magnetHeight = 2;
    // Center depth calculation: (totalHeight - magnetHeight) / 2
    const totalModelHeight = pixelHeight + baseHeight;
    const centeredDepth = (totalModelHeight - magnetHeight) / 2;

    console.log(`Centered depth: ${centeredDepth.toFixed(2)}mm (total height: ${totalModelHeight}mm, magnet: ${magnetHeight}mm)`);

    const result = await generateMeshesAsync({
      pixelGrid: quantized.pixels,
      palette: quantized.palette,
      pixelSize: pixelSizeMm,
      pixelHeight,
      baseHeight,
      magnet: {
        enabled: true,
        positions: [{ x: totalWidthMm / 2, y: totalHeightMm / 2 }],
        diameter: 6,
        height: magnetHeight,
        depth: centeredDepth,
      },
    });

    expectManifold(result.baseMesh, 'base');
    for (const [idx, geom] of result.colorMeshes) {
      expectManifold(geom, `color ${idx}`);
    }
  });
});
