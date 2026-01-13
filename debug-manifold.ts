import * as fs from 'fs';
import * as path from 'path';
import { createCanvas, loadImage } from 'canvas';
import * as THREE from 'three';
import { generateMeshes } from './src/meshGenerator';
import { quantizeColors } from './src/imageProcessor';

async function loadImageData(imagePath: string): Promise<ImageData> {
  const image = await loadImage(imagePath);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, image.width, image.height);
}

function makeEdgeKey(i1: number, i2: number): string {
  const [v1, v2] = i1 < i2 ? [i1, i2] : [i2, i1];
  return `${v1}-${v2}`;
}

function analyzeNonManifoldEdges(geometry: THREE.BufferGeometry) {
  const edgeCounts = new Map<string, number>();
  const edgeTriangles = new Map<string, number[]>();

  const index = geometry.getIndex();
  if (!index) throw new Error('Geometry must be indexed');

  const positions = geometry.attributes.position;
  const indices = index.array;
  const triangleCount = indices.length / 3;

  for (let i = 0; i < triangleCount; i++) {
    const a = indices[i * 3];
    const b = indices[i * 3 + 1];
    const c = indices[i * 3 + 2];

    const edges = [
      makeEdgeKey(a, b),
      makeEdgeKey(b, c),
      makeEdgeKey(c, a),
    ];

    for (const edge of edges) {
      edgeCounts.set(edge, (edgeCounts.get(edge) || 0) + 1);
      if (!edgeTriangles.has(edge)) {
        edgeTriangles.set(edge, []);
      }
      edgeTriangles.get(edge)!.push(i);
    }
  }

  // Find non-manifold edges
  let nonManifoldCount = 0;
  for (const [edge, count] of edgeCounts) {
    if (count > 2) {
      nonManifoldCount++;
      if (nonManifoldCount <= 5) {
        const [v1Idx, v2Idx] = edge.split('-').map(Number);
        const v1x = positions.getX(v1Idx);
        const v1y = positions.getY(v1Idx);
        const v1z = positions.getZ(v1Idx);
        const v2x = positions.getX(v2Idx);
        const v2y = positions.getY(v2Idx);
        const v2z = positions.getZ(v2Idx);
        console.log('Non-manifold edge ' + edge + ' used ' + count + ' times:');
        console.log('  v1: (' + v1x + ', ' + v1y + ', ' + v1z + ')');
        console.log('  v2: (' + v2x + ', ' + v2y + ', ' + v2z + ')');
        console.log('  triangles: ' + edgeTriangles.get(edge)!.join(', '));

        // Print triangle vertices
        for (const triIdx of edgeTriangles.get(edge)!) {
          const ta = indices[triIdx * 3];
          const tb = indices[triIdx * 3 + 1];
          const tc = indices[triIdx * 3 + 2];
          console.log('    tri ' + triIdx + ': vertices ' + ta + ', ' + tb + ', ' + tc);
        }
      }
    }
  }
  console.log('Total non-manifold edges: ' + nonManifoldCount);
}

async function main() {
  const imagePath = path.resolve(process.cwd(), 'queen.png');
  const imageData = await loadImageData(imagePath);
  const quantized = quantizeColors(imageData);

  const meshResult = generateMeshes({
    pixelGrid: quantized.pixels,
    palette: quantized.palette,
    pixelSize: 1,
    pixelHeight: 2,
    baseHeight: 1,
  });

  // Analyze Color 0 which has 62 non-manifold edges
  const color0Mesh = meshResult.colorMeshes.get(0);
  if (color0Mesh) {
    console.log('\n=== Color 0 non-manifold edges ===');
    analyzeNonManifoldEdges(color0Mesh);
  }
}

main();
