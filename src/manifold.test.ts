import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { createCanvas, loadImage } from 'canvas';
import * as THREE from 'three';
import { generateMeshes, generateMeshesAsync } from './meshGenerator';
import { quantizeColors } from './imageProcessor';

async function loadImageData(imagePath: string, maxDim = 150): Promise<ImageData> {
  const image = await loadImage(imagePath);
  const scale = Math.min(1, maxDim / Math.max(image.width, image.height));
  const w = Math.floor(image.width * scale);
  const h = Math.floor(image.height * scale);
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

function analyzeEdges(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  if (!position || !index) return { nonManifoldEdges: 0, boundaryEdges: 0 };

  const EPSILON = 0.01;
  const positionToIndex = new Map<string, number>();
  const oldToNewIndex: number[] = [];

  for (let i = 0; i < position.count; i++) {
    const key = `${(Math.round(position.getX(i) / EPSILON) * EPSILON).toFixed(6)},${(Math.round(position.getY(i) / EPSILON) * EPSILON).toFixed(6)},${(Math.round(position.getZ(i) / EPSILON) * EPSILON).toFixed(6)}`;
    let newIndex = positionToIndex.get(key);
    if (newIndex === undefined) {
      newIndex = positionToIndex.size;
      positionToIndex.set(key, newIndex);
    }
    oldToNewIndex[i] = newIndex;
  }

  const edgeCounts = new Map<string, number>();
  const indices = index.array;
  for (let i = 0; i < indices.length; i += 3) {
    const a = oldToNewIndex[indices[i]], b = oldToNewIndex[indices[i + 1]], c = oldToNewIndex[indices[i + 2]];
    for (const [v1, v2] of [[a, b], [b, c], [c, a]]) {
      const key = v1 < v2 ? `${v1}-${v2}` : `${v2}-${v1}`;
      edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
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

const TEST_IMAGES = ['queen.png', 'ral.png'];
const DEFAULT_PARAMS = { pixelSize: 1, pixelHeight: 2, baseHeight: 1 };

describe('Manifold Geometry Tests', () => {
  describe.each(TEST_IMAGES)('%s', (imageName) => {
    it('should have manifold color meshes', async () => {
      const imagePath = path.resolve(process.cwd(), imageName);
      if (!fs.existsSync(imagePath)) return;

      const imageData = await loadImageData(imagePath);
      const quantized = quantizeColors(imageData);
      const result = generateMeshes({ pixelGrid: quantized.pixels, palette: quantized.palette, ...DEFAULT_PARAMS });

      for (const [idx, geometry] of result.colorMeshes) {
        expectManifold(geometry, `${imageName} color ${idx}`);
      }
    });

    it('should have manifold meshes with holepunch', async () => {
      const imagePath = path.resolve(process.cwd(), imageName);
      if (!fs.existsSync(imagePath)) return;

      const imageData = await loadImageData(imagePath);
      const quantized = quantizeColors(imageData);
      // Add slight offset to avoid edge cases at pixel boundaries
      const centerX = (quantized.width * DEFAULT_PARAMS.pixelSize) / 2 + 0.13;
      const centerY = -(quantized.height * DEFAULT_PARAMS.pixelSize) / 2 - 0.17;

      const result = await generateMeshesAsync({
        pixelGrid: quantized.pixels, palette: quantized.palette, ...DEFAULT_PARAMS,
        keyhole: { enabled: true, type: 'holepunch', position: { x: centerX, y: centerY }, holeDiameter: 4, innerDiameter: 4, outerDiameter: 8 },
              });

      expect(result.keyholeApplied).toBe(true);
      expectManifold(result.baseMesh, `${imageName} base`);
      for (const [idx, geometry] of result.colorMeshes) {
        expectManifold(geometry, `${imageName} color ${idx}`);
      }
    }, 120000); // 2 minute timeout for CSG operations
  });
});
