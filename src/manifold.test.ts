import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { createCanvas, loadImage } from 'canvas';
import * as THREE from 'three';
import { generateMeshes, type MeshResult } from './meshGenerator';
import { quantizeColors } from './imageProcessor';

/**
 * Represents an edge in the mesh, identified by two vertex indices (sorted)
 */
interface Edge {
  v1: number;
  v2: number;
}

/**
 * Creates a canonical edge key from two vertex indices
 */
function makeEdgeKey(i1: number, i2: number): string {
  const [v1, v2] = i1 < i2 ? [i1, i2] : [i2, i1];
  return `${v1}-${v2}`;
}

/**
 * Analyzes a BufferGeometry and counts how many times each edge is used.
 * For manifold geometry, each edge should be used exactly 2 times.
 *
 * @returns Object with edge statistics
 */
function analyzeEdges(geometry: THREE.BufferGeometry): {
  totalEdges: number;
  uniqueEdges: number;
  manifoldEdges: number;
  nonManifoldEdges: number;
  boundaryEdges: number;
  edgeUsageCounts: Map<string, number>;
} {
  const edgeCounts = new Map<string, number>();

  const index = geometry.getIndex();
  if (!index) {
    throw new Error('Geometry must be indexed');
  }

  const indices = index.array;
  const triangleCount = indices.length / 3;

  // Count edge usage
  for (let i = 0; i < triangleCount; i++) {
    const a = indices[i * 3];
    const b = indices[i * 3 + 1];
    const c = indices[i * 3 + 2];

    // Three edges per triangle
    const edges = [
      makeEdgeKey(a, b),
      makeEdgeKey(b, c),
      makeEdgeKey(c, a),
    ];

    for (const edge of edges) {
      edgeCounts.set(edge, (edgeCounts.get(edge) || 0) + 1);
    }
  }

  // Analyze results
  let manifoldEdges = 0;
  let nonManifoldEdges = 0;
  let boundaryEdges = 0;

  for (const count of edgeCounts.values()) {
    if (count === 2) {
      manifoldEdges++;
    } else if (count === 1) {
      boundaryEdges++;
    } else {
      nonManifoldEdges++;
    }
  }

  return {
    totalEdges: triangleCount * 3,
    uniqueEdges: edgeCounts.size,
    manifoldEdges,
    nonManifoldEdges,
    boundaryEdges,
    edgeUsageCounts: edgeCounts,
  };
}

/**
 * Checks if a geometry is fully manifold (all edges used exactly twice, no boundary edges)
 */
function isManifold(geometry: THREE.BufferGeometry): boolean {
  const analysis = analyzeEdges(geometry);
  return analysis.nonManifoldEdges === 0 && analysis.boundaryEdges === 0;
}

/**
 * Analyzes all geometries in a MeshResult
 */
function analyzeMeshResult(result: MeshResult): {
  colors: Map<number, ReturnType<typeof analyzeEdges>>;
  combined: ReturnType<typeof analyzeEdges>;
} {
  const colorAnalyses = new Map<number, ReturnType<typeof analyzeEdges>>();

  // Analyze color meshes (each is now a complete standalone extrusion)
  for (const [colorIndex, geometry] of result.colorMeshes) {
    if (geometry.attributes.position && geometry.attributes.position.count > 0) {
      colorAnalyses.set(colorIndex, analyzeEdges(geometry));
    }
  }

  // Combine all geometries for overall analysis
  const combinedGeometry = combineGeometries(result);
  const combinedAnalysis = analyzeEdges(combinedGeometry);
  combinedGeometry.dispose();

  return {
    colors: colorAnalyses,
    combined: combinedAnalysis,
  };
}

/**
 * Combines all geometries from a MeshResult into a single geometry for overall analysis
 */
function combineGeometries(result: MeshResult): THREE.BufferGeometry {
  const allPositions: number[] = [];
  const allIndices: number[] = [];
  let vertexOffset = 0;

  // Add color meshes (each is now a complete standalone extrusion)
  for (const [, geometry] of result.colorMeshes) {
    if (geometry.attributes.position && geometry.attributes.position.count > 0) {
      const positions = geometry.attributes.position.array;
      const indices = geometry.index?.array;

      for (let i = 0; i < positions.length; i++) {
        allPositions.push(positions[i]);
      }

      if (indices) {
        for (let i = 0; i < indices.length; i++) {
          allIndices.push(indices[i] + vertexOffset);
        }
      }

      vertexOffset += geometry.attributes.position.count;
    }
  }

  const combined = new THREE.BufferGeometry();
  combined.setAttribute('position', new THREE.Float32BufferAttribute(allPositions, 3));
  combined.setIndex(allIndices);

  return combined;
}

/**
 * Loads an image and returns ImageData
 */
async function loadImageData(imagePath: string): Promise<ImageData> {
  const image = await loadImage(imagePath);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, image.width, image.height);
}

// Test data
const TEST_IMAGES = ['queen.png', 'ral.png'];
const DEFAULT_PARAMS = {
  pixelSize: 1, // 1mm per pixel for testing
  pixelHeight: 2,
  baseHeight: 1,
};

describe('Manifold Geometry Tests', () => {
  const testResults: Map<string, {
    meshResult: MeshResult;
    analysis: ReturnType<typeof analyzeMeshResult>;
  }> = new Map();

  beforeAll(async () => {
    // Load and process each test image
    for (const imageName of TEST_IMAGES) {
      const imagePath = path.resolve(process.cwd(), imageName);

      if (!fs.existsSync(imagePath)) {
        console.warn(`Test image not found: ${imagePath}`);
        continue;
      }

      const imageData = await loadImageData(imagePath);
      const quantized = quantizeColors(imageData);

      const meshResult = generateMeshes({
        pixelGrid: quantized.pixels,
        palette: quantized.palette,
        pixelSize: DEFAULT_PARAMS.pixelSize,
        pixelHeight: DEFAULT_PARAMS.pixelHeight,
        baseHeight: DEFAULT_PARAMS.baseHeight,
      });

      const analysis = analyzeMeshResult(meshResult);
      testResults.set(imageName, { meshResult, analysis });
    }
  });

  describe.each(TEST_IMAGES)('%s', (imageName) => {
    it('should generate mesh without errors', () => {
      const result = testResults.get(imageName);
      expect(result).toBeDefined();
      expect(result!.meshResult).toBeDefined();
    });

    it('should have valid color mesh geometries', () => {
      const result = testResults.get(imageName);
      if (!result) return;

      // Each color is a complete standalone extrusion
      expect(result.meshResult.colorMeshes.size).toBeGreaterThan(0);

      for (const [colorIndex, geometry] of result.meshResult.colorMeshes) {
        expect(geometry.attributes.position).toBeDefined();
        expect(geometry.attributes.position.count).toBeGreaterThan(0);
        expect(geometry.index).toBeDefined();
      }
    });

    it('should report manifold edge statistics for color meshes', () => {
      const result = testResults.get(imageName);
      if (!result) return;

      for (const [colorIndex, colorAnalysis] of result.analysis.colors) {
        console.log(`\n${imageName} - Color ${colorIndex} Mesh Edge Analysis:`);
        console.log(`  Total edges (with duplicates): ${colorAnalysis.totalEdges}`);
        console.log(`  Unique edges: ${colorAnalysis.uniqueEdges}`);
        console.log(`  Manifold edges (used 2x): ${colorAnalysis.manifoldEdges}`);
        console.log(`  Non-manifold edges (used >2x): ${colorAnalysis.nonManifoldEdges}`);
        console.log(`  Boundary edges (used 1x): ${colorAnalysis.boundaryEdges}`);
      }
    });

    it('should report combined manifold statistics', () => {
      const result = testResults.get(imageName);
      if (!result) return;

      const { combined } = result.analysis;
      console.log(`\n${imageName} - Combined Mesh Edge Analysis:`);
      console.log(`  Total edges (with duplicates): ${combined.totalEdges}`);
      console.log(`  Unique edges: ${combined.uniqueEdges}`);
      console.log(`  Manifold edges (used 2x): ${combined.manifoldEdges}`);
      console.log(`  Non-manifold edges (used >2x): ${combined.nonManifoldEdges}`);
      console.log(`  Boundary edges (used 1x): ${combined.boundaryEdges}`);

      // This is the key metric - record it
      expect(combined.uniqueEdges).toBeGreaterThan(0);
    });

    it('should have zero non-manifold edges in each color mesh', () => {
      const result = testResults.get(imageName);
      if (!result) return;

      // Each color mesh must be fully manifold (every edge shared by exactly 2 faces)
      for (const [colorIndex, colorAnalysis] of result.analysis.colors) {
        expect(
          colorAnalysis.nonManifoldEdges,
          `Color ${colorIndex} has ${colorAnalysis.nonManifoldEdges} non-manifold edges`
        ).toBe(0);
      }
    });

    it('should have zero open/boundary edges in each color mesh (watertight)', () => {
      const result = testResults.get(imageName);
      if (!result) return;

      // Each color mesh must be watertight (no open edges).
      // This is critical for 3D printing - boundary edges indicate holes.
      for (const [colorIndex, colorAnalysis] of result.analysis.colors) {
        expect(
          colorAnalysis.boundaryEdges,
          `Color ${colorIndex} has ${colorAnalysis.boundaryEdges} open/boundary edges`
        ).toBe(0);
      }
    });

    it('should report combined mesh statistics', () => {
      const result = testResults.get(imageName);
      if (!result) return;

      // For multi-color printing:
      // Each color mesh is watertight with minimal non-manifold edges
      // Combined mesh has zero BOUNDARY edges (no holes anywhere)
      expect(result.analysis.combined.boundaryEdges).toBe(0);

      // Non-manifold edges in combined mesh are expected at:
      // - Diagonal corners within same-color regions
      // - Where different color bodies overlap at their shared bottom faces
      console.log(`\n${imageName} - Combined: ${result.analysis.combined.nonManifoldEdges} non-manifold, ${result.analysis.combined.boundaryEdges} boundary edges`);
    });
  });
});

/**
 * Simulates what a slicer does: merge vertices by position, then analyze edges.
 * This catches issues where geometry is manifold by index but not by position.
 */
function analyzeEdgesByPosition(geometry: THREE.BufferGeometry): ReturnType<typeof analyzeEdges> {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  if (!position || !index) {
    return {
      totalEdges: 0,
      uniqueEdges: 0,
      manifoldEdges: 0,
      nonManifoldEdges: 0,
      boundaryEdges: 0,
      edgeUsageCounts: new Map(),
    };
  }

  // Merge vertices by position using typical slicer tolerance (~0.01mm)
  const EPSILON = 0.01;
  const positionToIndex = new Map<string, number>();
  const oldToNewIndex: number[] = [];

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);

    const rx = Math.round(x / EPSILON) * EPSILON;
    const ry = Math.round(y / EPSILON) * EPSILON;
    const rz = Math.round(z / EPSILON) * EPSILON;

    const key = `${rx.toFixed(6)},${ry.toFixed(6)},${rz.toFixed(6)}`;

    let newIndex = positionToIndex.get(key);
    if (newIndex === undefined) {
      newIndex = positionToIndex.size;
      positionToIndex.set(key, newIndex);
    }
    oldToNewIndex[i] = newIndex;
  }

  // Count edge usage with merged indices
  const edgeCounts = new Map<string, number>();
  const indices = index.array;
  const triangleCount = indices.length / 3;

  for (let i = 0; i < triangleCount; i++) {
    const a = oldToNewIndex[indices[i * 3]];
    const b = oldToNewIndex[indices[i * 3 + 1]];
    const c = oldToNewIndex[indices[i * 3 + 2]];

    const edges = [
      makeEdgeKey(a, b),
      makeEdgeKey(b, c),
      makeEdgeKey(c, a),
    ];

    for (const edge of edges) {
      edgeCounts.set(edge, (edgeCounts.get(edge) || 0) + 1);
    }
  }

  // Analyze results
  let manifoldEdges = 0;
  let nonManifoldEdges = 0;
  let boundaryEdges = 0;

  for (const count of edgeCounts.values()) {
    if (count === 2) {
      manifoldEdges++;
    } else if (count === 1) {
      boundaryEdges++;
    } else {
      nonManifoldEdges++;
    }
  }

  return {
    totalEdges: triangleCount * 3,
    uniqueEdges: edgeCounts.size,
    manifoldEdges,
    nonManifoldEdges,
    boundaryEdges,
    edgeUsageCounts: edgeCounts,
  };
}

// Position-based manifold tests (simulates slicer behavior)
describe('Position-Based Manifold Tests (Slicer Simulation)', () => {
  describe.each(TEST_IMAGES)('%s', (imageName) => {
    it('should have zero non-manifold edges when analyzed by position (like slicers do)', async () => {
      const imagePath = path.resolve(process.cwd(), imageName);

      if (!fs.existsSync(imagePath)) {
        console.warn(`Test image not found: ${imagePath}`);
        return;
      }

      const imageData = await loadImageData(imagePath);
      const quantized = quantizeColors(imageData);

      const meshResult = generateMeshes({
        pixelGrid: quantized.pixels,
        palette: quantized.palette,
        pixelSize: DEFAULT_PARAMS.pixelSize,
        pixelHeight: DEFAULT_PARAMS.pixelHeight,
        baseHeight: DEFAULT_PARAMS.baseHeight,
      });

      console.log(`\n${imageName} - Position-Based Analysis (Slicer Simulation):`);

      for (const [colorIndex, geometry] of meshResult.colorMeshes) {
        const analysis = analyzeEdgesByPosition(geometry);
        console.log(`  Color ${colorIndex}: ${analysis.nonManifoldEdges} non-manifold, ${analysis.boundaryEdges} boundary`);

        expect(
          analysis.nonManifoldEdges,
          `Color ${colorIndex} has ${analysis.nonManifoldEdges} non-manifold edges when analyzed by position`
        ).toBe(0);

        expect(
          analysis.boundaryEdges,
          `Color ${colorIndex} has ${analysis.boundaryEdges} boundary edges when analyzed by position`
        ).toBe(0);
      }

      // Cleanup
      for (const geometry of meshResult.colorMeshes.values()) {
        geometry.dispose();
      }
    });
  });
});

// Summary test
describe('Manifold Summary', () => {
  it('should print summary of all test results', async () => {
    console.log('\n========== MANIFOLD TEST SUMMARY ==========\n');

    for (const imageName of TEST_IMAGES) {
      const imagePath = path.resolve(process.cwd(), imageName);

      if (!fs.existsSync(imagePath)) {
        console.log(`${imageName}: SKIPPED (file not found)`);
        continue;
      }

      const imageData = await loadImageData(imagePath);
      const quantized = quantizeColors(imageData);

      const meshResult = generateMeshes({
        pixelGrid: quantized.pixels,
        palette: quantized.palette,
        pixelSize: DEFAULT_PARAMS.pixelSize,
        pixelHeight: DEFAULT_PARAMS.pixelHeight,
        baseHeight: DEFAULT_PARAMS.baseHeight,
      });

      const analysis = analyzeMeshResult(meshResult);

      // Check each color mesh is watertight (zero boundary edges)
      let allColorsWatertight = true;
      for (const [, colorAnalysis] of analysis.colors) {
        if (colorAnalysis.boundaryEdges > 0) allColorsWatertight = false;
      }
      const colorStatus = allColorsWatertight ? 'PASS' : 'FAIL';

      const combinedWatertight = analysis.combined.boundaryEdges === 0;
      const combinedStatus = combinedWatertight ? 'PASS' : 'FAIL';

      console.log(`${imageName}:`);
      console.log(`  Image size: ${quantized.width}x${quantized.height}`);
      console.log(`  Colors: ${quantized.palette.length}`);
      console.log(`  Color meshes (each is standalone extrusion): ${colorStatus}`);
      for (const [colorIndex, colorAnalysis] of analysis.colors) {
        const status = colorAnalysis.boundaryEdges === 0 ? 'watertight' : `${colorAnalysis.boundaryEdges} open edges`;
        console.log(`    - Color ${colorIndex}: ${status}, ${colorAnalysis.nonManifoldEdges} non-manifold`);
      }
      console.log(`  Combined: ${combinedStatus}`);
      console.log(`    - Non-manifold edges: ${analysis.combined.nonManifoldEdges}`);
      console.log(`    - Boundary edges: ${analysis.combined.boundaryEdges}`);
      console.log('');

      // Cleanup
      for (const geometry of meshResult.colorMeshes.values()) {
        geometry.dispose();
      }
    }

    console.log('============================================\n');
  });
});
