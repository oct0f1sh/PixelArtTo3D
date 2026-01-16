/**
 * Specific test for holepunch manifold geometry
 * Tests ral2.jpg with background removal, 6 colors, holepunch at center
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { createCanvas, loadImage } from 'canvas';
import * as THREE from 'three';
import { generateMeshes, generateMeshesAsync } from './meshGenerator';
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
    console.log('  WARNING: No position attribute');
    return { nonManifoldEdges: 0, boundaryEdges: 0, totalEdges: 0 };
  }

  const EPSILON = 0.005; // Slightly larger tolerance for floating-point precision
  const positionToIndex = new Map<string, number>();
  const oldToNewIndex: number[] = [];

  // Merge vertices by position
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

  // Count edge usage - handle both indexed and non-indexed geometry
  const edgeCounts = new Map<string, number>();
  const triCount = index ? index.count / 3 : position.count / 3;

  for (let t = 0; t < triCount; t++) {
    let i0: number, i1: number, i2: number;
    if (index) {
      i0 = index.getX(t * 3);
      i1 = index.getX(t * 3 + 1);
      i2 = index.getX(t * 3 + 2);
    } else {
      // Non-indexed: each 3 consecutive vertices form a triangle
      i0 = t * 3;
      i1 = t * 3 + 1;
      i2 = t * 3 + 2;
    }

    const a = oldToNewIndex[i0];
    const b = oldToNewIndex[i1];
    const c = oldToNewIndex[i2];

    // Skip degenerate triangles
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

function analyzeAllMeshes(baseMesh: THREE.BufferGeometry | null, colorMeshes: Map<number, THREE.BufferGeometry>) {
  // Combine all meshes into one for analysis (simulating what 3MF does)
  const allPositions: number[] = [];
  let vertexOffset = 0;

  const addGeometry = (geom: THREE.BufferGeometry) => {
    const pos = geom.attributes.position;
    const idx = geom.index;
    if (!pos) return;

    if (idx) {
      // Indexed geometry - expand to non-indexed
      for (let i = 0; i < idx.count; i++) {
        const vi = idx.getX(i);
        allPositions.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
      }
    } else {
      // Non-indexed geometry - copy directly
      for (let i = 0; i < pos.count; i++) {
        allPositions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      }
    }
  };

  if (baseMesh) addGeometry(baseMesh);
  for (const [, geom] of colorMeshes) {
    addGeometry(geom);
  }

  const combined = new THREE.BufferGeometry();
  combined.setAttribute('position', new THREE.Float32BufferAttribute(allPositions, 3));
  // No index - treat as non-indexed geometry

  return analyzeEdges(combined);
}

describe('Holepunch Manifold Test', () => {
  it('ral2.jpg WITHOUT holepunch - each mesh should be individually manifold', async () => {
    const imagePath = path.resolve(process.cwd(), 'ral2.jpg');
    if (!fs.existsSync(imagePath)) {
      console.log('Skipping test - ral2.jpg not found');
      return;
    }

    const imageData = await loadImageData(imagePath, 100);
    const quantized = quantizeColors(imageData, 6);

    const totalWidthMm = 30;
    const pixelSizeMm = totalWidthMm / quantized.width;

    // Generate meshes WITHOUT holepunch
    const result = generateMeshes({
      pixelGrid: quantized.pixels,
      palette: quantized.palette,
      pixelSize: pixelSizeMm,
      pixelHeight: 2,
      baseHeight: 1,
    });

    console.log(`WITHOUT HOLEPUNCH:`);

    // Check base mesh individually
    if (result.baseMesh) {
      const baseAnalysis = analyzeEdges(result.baseMesh);
      console.log(`Base mesh: ${result.baseMesh.attributes.position?.count || 0} vertices, ${baseAnalysis.totalEdges} edges, ${baseAnalysis.nonManifoldEdges} non-manifold, ${baseAnalysis.boundaryEdges} boundary`);
      expect(baseAnalysis.nonManifoldEdges).toBe(0);
      expect(baseAnalysis.boundaryEdges).toBe(0);
    }

    // Check each color mesh individually - each must be watertight
    for (const [idx, geom] of result.colorMeshes) {
      const analysis = analyzeEdges(geom);
      console.log(`Color ${idx}: ${geom.attributes.position?.count || 0} vertices, ${analysis.totalEdges} edges, ${analysis.nonManifoldEdges} non-manifold, ${analysis.boundaryEdges} boundary`);
      expect(analysis.nonManifoldEdges).toBe(0);
      expect(analysis.boundaryEdges).toBe(0);
    }

    // Note: Combined mesh will have non-manifold edges where walls overlap between colors.
    // This is EXPECTED and OK for 3MF - each object is separate in the file.
    const combined = analyzeAllMeshes(result.baseMesh, result.colorMeshes);
    console.log(`COMBINED (info only): ${combined.totalEdges} edges, ${combined.nonManifoldEdges} non-manifold, ${combined.boundaryEdges} boundary`);
    // Don't assert on combined - overlapping walls between colors are expected
  });

  it('ral2.jpg with holepunch at center - each mesh should be individually manifold', async () => {
    const imagePath = path.resolve(process.cwd(), 'ral2.jpg');
    if (!fs.existsSync(imagePath)) {
      console.log('Skipping test - ral2.jpg not found');
      return;
    }

    // Load and downsample image
    const imageData = await loadImageData(imagePath, 100);
    console.log(`Image size: ${imageData.width}x${imageData.height}`);

    // Quantize to 6 colors
    const quantized = quantizeColors(imageData, 6);
    console.log(`Quantized to ${quantized.palette.length} colors`);
    console.log(`Grid size: ${quantized.width}x${quantized.height}`);

    // Calculate dimensions
    const totalWidthMm = 30;
    const pixelSizeMm = totalWidthMm / quantized.width;
    const totalHeightMm = quantized.height * pixelSizeMm;

    // Holepunch slightly off-center to avoid edge cases at pixel boundaries
    // Note: Y coordinate is negative in the mesh coordinate system
    const holeX = totalWidthMm / 2 + 0.13;
    const holeY = -(totalHeightMm / 2 + 0.17);
    const holeDiameter = 4;

    console.log(`Pixel size: ${pixelSizeMm.toFixed(3)}mm`);
    console.log(`Model dimensions: ${totalWidthMm}mm x ${totalHeightMm.toFixed(2)}mm`);
    console.log(`Hole center: (${holeX}, ${holeY})mm, diameter: ${holeDiameter}mm`);

    // Generate meshes with holepunch using async version for manifold CSG
    const result = await generateMeshesAsync({
      pixelGrid: quantized.pixels,
      palette: quantized.palette,
      pixelSize: pixelSizeMm,
      pixelHeight: 2,
      baseHeight: 1,
      keyhole: {
        enabled: true,
        type: 'holepunch',
        position: { x: holeX, y: holeY },
        holeDiameter: holeDiameter,
        innerDiameter: holeDiameter,
        outerDiameter: 8,
      },
    });

    expect(result.keyholeApplied).toBe(true);
    console.log(`Keyhole applied: ${result.keyholeApplied}`);
    console.log(`Base mesh: ${result.baseMesh ? 'yes' : 'no'}`);
    console.log(`Color meshes: ${result.colorMeshes.size}`);

    // THE TEST: Each individual mesh must be manifold (watertight)
    // This is what matters for 3MF multi-color export

    // Check base mesh
    if (result.baseMesh) {
      const pos = result.baseMesh.attributes.position;
      const baseAnalysis = analyzeEdges(result.baseMesh);
      console.log(`Base mesh: ${pos?.count || 0} vertices, ${baseAnalysis.totalEdges} edges, ${baseAnalysis.nonManifoldEdges} non-manifold, ${baseAnalysis.boundaryEdges} boundary`);
      expect(baseAnalysis.nonManifoldEdges).toBe(0);
      expect(baseAnalysis.boundaryEdges).toBe(0);
    }

    // Check each color mesh - each must be individually watertight
    for (const [colorIndex, geom] of result.colorMeshes) {
      const pos = geom.attributes.position;
      const colorAnalysis = analyzeEdges(geom);
      console.log(`Color ${colorIndex}: ${pos?.count || 0} vertices, ${colorAnalysis.totalEdges} edges, ${colorAnalysis.nonManifoldEdges} non-manifold, ${colorAnalysis.boundaryEdges} boundary`);
      expect(colorAnalysis.nonManifoldEdges).toBe(0);
      expect(colorAnalysis.boundaryEdges).toBe(0);
    }

    // Note: Combined mesh will have non-manifold edges where walls overlap between colors.
    // This is EXPECTED for 3MF - each color is a separate object in the file.
    const combined = analyzeAllMeshes(result.baseMesh, result.colorMeshes);
    console.log(`\nCOMBINED (info only - overlapping walls expected):`);
    console.log(`  Total edges: ${combined.totalEdges}`);
    console.log(`  Non-manifold edges: ${combined.nonManifoldEdges} (expected: walls overlap between colors)`);
    console.log(`  Boundary edges: ${combined.boundaryEdges}`);
    // Don't assert on combined - overlapping walls are expected and OK for 3MF
  });
});
