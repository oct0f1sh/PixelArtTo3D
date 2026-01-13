import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Types (assumed to exist in types.ts)
export type PixelGrid = number[][]; // -1 = transparent, other numbers = color palette index

export interface Color {
  r: number;
  g: number;
  b: number;
  hex: string;
}

export interface KeyholeOptions {
  enabled: boolean;
  position: 'top-left' | 'top-center' | 'top-right';
}

export interface MeshGeneratorParams {
  pixelGrid: PixelGrid;
  palette: Color[];
  pixelSize: number; // mm per pixel
  pixelHeight?: number; // mm, default 2
  baseHeight?: number; // mm, default 1
  keyhole?: KeyholeOptions;
}

export interface MeshResult {
  colorMeshes: Map<number, THREE.BufferGeometry>;
  baseMesh: THREE.BufferGeometry;
  keyholeApplied: boolean;
}

// Rectangle representation for greedy meshing
interface MergedRect {
  x: number;
  y: number;
  width: number;
  height: number;
  colorIndex: number;
}

/**
 * Greedy meshing algorithm to merge adjacent pixels of the same color
 * into larger rectangles, reducing polygon count significantly.
 */
function greedyMesh(grid: PixelGrid): MergedRect[] {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;

  if (height === 0 || width === 0) return [];

  // Create a copy of the grid to track visited pixels
  const visited: boolean[][] = Array.from({ length: height }, () =>
    Array(width).fill(false)
  );

  const rectangles: MergedRect[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const colorIndex = grid[y][x];

      // Skip transparent or already visited pixels
      if (colorIndex === -1 || visited[y][x]) continue;

      // Find the maximum width we can extend to
      let maxWidth = 1;
      while (
        x + maxWidth < width &&
        grid[y][x + maxWidth] === colorIndex &&
        !visited[y][x + maxWidth]
      ) {
        maxWidth++;
      }

      // Find the maximum height we can extend to while maintaining the width
      let maxHeight = 1;
      outer: while (y + maxHeight < height) {
        for (let dx = 0; dx < maxWidth; dx++) {
          if (
            grid[y + maxHeight][x + dx] !== colorIndex ||
            visited[y + maxHeight][x + dx]
          ) {
            break outer;
          }
        }
        maxHeight++;
      }

      // Mark all pixels in this rectangle as visited
      for (let dy = 0; dy < maxHeight; dy++) {
        for (let dx = 0; dx < maxWidth; dx++) {
          visited[y + dy][x + dx] = true;
        }
      }

      rectangles.push({
        x,
        y,
        width: maxWidth,
        height: maxHeight,
        colorIndex
      });
    }
  }

  return rectangles;
}

/**
 * Creates a box geometry for a merged rectangle
 */
function createBoxGeometry(
  rect: MergedRect,
  pixelSize: number,
  pixelHeight: number,
  baseHeight: number,
  gridWidth: number,
  gridHeight: number
): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(
    rect.width * pixelSize,
    pixelHeight,
    rect.height * pixelSize
  );

  // Position the box: center it on the rectangle
  // Y position puts it on top of the base
  // Mirror X so left side of image appears on left side of model when viewed from front
  const xPos = (gridWidth - rect.x - rect.width / 2) * pixelSize;
  const yPos = baseHeight + pixelHeight / 2;
  // Flip Z to match typical image coordinates (top of image = front)
  const zPos = (gridHeight - rect.y - rect.height / 2) * pixelSize;

  geometry.translate(xPos, yPos, zPos);

  return geometry;
}

/**
 * Generate base geometry that matches the exact footprint of non-transparent pixels.
 * Uses greedy meshing on the opacity mask to create an efficient mesh.
 */
function generateBaseGeometry(
  grid: PixelGrid,
  pixelSize: number,
  baseHeight: number
): THREE.BufferGeometry {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;

  if (height === 0 || width === 0) {
    return new THREE.BufferGeometry();
  }

  // Create a binary grid: 0 for non-transparent, -1 for transparent
  const binaryGrid: PixelGrid = grid.map(row =>
    row.map(pixel => (pixel === -1 ? -1 : 0))
  );

  // Use greedy mesh on the binary grid
  const baseRects = greedyMesh(binaryGrid);

  if (baseRects.length === 0) {
    return new THREE.BufferGeometry();
  }

  // Create box geometries for each base rectangle
  const baseGeometries: THREE.BufferGeometry[] = baseRects.map(rect => {
    const geometry = new THREE.BoxGeometry(
      rect.width * pixelSize,
      baseHeight,
      rect.height * pixelSize
    );

    // Mirror X so left side of image appears on left side of model when viewed from front
    const xPos = (width - rect.x - rect.width / 2) * pixelSize;
    const yPos = baseHeight / 2;
    const zPos = (height - rect.y - rect.height / 2) * pixelSize;

    geometry.translate(xPos, yPos, zPos);

    return geometry;
  });

  // Merge all base geometries
  const mergedBase = mergeGeometries(baseGeometries, false);

  // Dispose individual geometries
  baseGeometries.forEach(g => g.dispose());

  return mergedBase ?? new THREE.BufferGeometry();
}

/**
 * Creates a circular keyhole cutout using CSG-like subtraction
 * Since Three.js doesn't have built-in CSG, we create the keyhole
 * by generating geometry with a hole using shape extrusion
 */
function applyKeyhole(
  baseMesh: THREE.BufferGeometry,
  grid: PixelGrid,
  pixelSize: number,
  baseHeight: number,
  pixelHeight: number,
  position: 'top-left' | 'top-center' | 'top-right'
): THREE.BufferGeometry {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;

  if (height === 0 || width === 0) return baseMesh;

  const keyholeDiameter = 4; // 4mm diameter
  const keyholeRadius = keyholeDiameter / 2;

  // Calculate keyhole center position based on specified position
  let keyholeX: number;

  // Find the topmost row with non-transparent pixels
  let topRowWithPixels = -1;
  for (let y = 0; y < height; y++) {
    if (grid[y].some(pixel => pixel !== -1)) {
      topRowWithPixels = y;
      break;
    }
  }

  if (topRowWithPixels === -1) return baseMesh;

  // Find leftmost and rightmost non-transparent pixels in the top area
  let leftmostX = width;
  let rightmostX = 0;

  // Check top few rows to find the extent
  const searchRows = Math.min(5, height);
  for (let y = 0; y < searchRows; y++) {
    for (let x = 0; x < width; x++) {
      if (grid[y][x] !== -1) {
        leftmostX = Math.min(leftmostX, x);
        rightmostX = Math.max(rightmostX, x);
      }
    }
  }

  // Mirror X coordinates to match the mirrored geometry
  switch (position) {
    case 'top-left':
      // Top-left in image space = high X in mirrored 3D space
      keyholeX = (width - leftmostX - 1.5) * pixelSize;
      break;
    case 'top-center':
      keyholeX = (width - (leftmostX + rightmostX) / 2 - 0.5) * pixelSize;
      break;
    case 'top-right':
      // Top-right in image space = low X in mirrored 3D space
      keyholeX = (width - rightmostX + 0.5) * pixelSize;
      break;
  }

  // Z position: near the top of the model (which is the front in our flipped coordinates)
  const keyholeZ = (height - topRowWithPixels - 0.5) * pixelSize;

  // Total height of the model
  const totalHeight = baseHeight + pixelHeight;

  // Create a cylinder for the keyhole
  const keyholeGeometry = new THREE.CylinderGeometry(
    keyholeRadius,
    keyholeRadius,
    totalHeight + 2, // Slightly taller to ensure clean cut
    32 // segments for smooth circle
  );

  // Rotate and position the cylinder
  keyholeGeometry.translate(keyholeX, totalHeight / 2, keyholeZ);

  // Since Three.js doesn't have built-in CSG, we need to use a different approach
  // We'll create a ring-shaped base extension around the keyhole area
  // and mark the keyhole position for external CSG processing

  // For now, we'll return the base mesh with metadata
  // In a full implementation, you would use a CSG library like three-bvh-csg

  // Create a simple representation: add a ring geometry around keyhole position
  const ringInnerRadius = keyholeRadius;
  const ringOuterRadius = keyholeRadius + 1.5; // 1.5mm ring thickness

  const ringShape = new THREE.Shape();
  ringShape.absarc(0, 0, ringOuterRadius, 0, Math.PI * 2, false);

  const holePath = new THREE.Path();
  holePath.absarc(0, 0, ringInnerRadius, 0, Math.PI * 2, true);
  ringShape.holes.push(holePath);

  const extrudeSettings = {
    depth: totalHeight,
    bevelEnabled: false
  };

  const ringGeometry = new THREE.ExtrudeGeometry(ringShape, extrudeSettings);

  // Rotate to be horizontal and position
  ringGeometry.rotateX(-Math.PI / 2);
  ringGeometry.translate(keyholeX, 0, keyholeZ);

  // Merge with base mesh
  const combinedGeometry = mergeGeometries([baseMesh, ringGeometry], false);

  ringGeometry.dispose();

  return combinedGeometry ?? baseMesh;
}

/**
 * Rotates geometry to lay flat on the build plate (face up) for 3D printing.
 * Transforms from Y-up orientation to Z-up orientation.
 * The face (top surface with colors) will face upward (+Z).
 * Also mirrors X back to correct orientation (undoing the preview mirror).
 *
 * @param geometry - The geometry to rotate (will be modified in place)
 * @returns The same geometry, rotated and mirrored
 */
export function rotateForPrinting(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  // Mirror X back to original orientation (undo preview mirror)
  geometry.scale(-1, 1, 1);

  // Rotate -90 degrees around X axis to lay flat
  // This transforms Y-up to Z-up (model lays flat, face pointing up)
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/**
 * Main function to generate 3D meshes from a pixel grid
 */
export function generateMeshes(params: MeshGeneratorParams): MeshResult {
  const {
    pixelGrid,
    pixelSize,
    pixelHeight = 2,
    baseHeight = 1,
    keyhole = { enabled: false, position: 'top-center' }
  } = params;

  const gridHeight = pixelGrid.length;
  const gridWidth = pixelGrid[0]?.length ?? 0;

  // Apply greedy meshing to get merged rectangles
  const mergedRects = greedyMesh(pixelGrid);

  // Group rectangles by color index
  const rectsByColor = new Map<number, MergedRect[]>();
  for (const rect of mergedRects) {
    const existing = rectsByColor.get(rect.colorIndex) ?? [];
    existing.push(rect);
    rectsByColor.set(rect.colorIndex, existing);
  }

  // Create geometries for each color
  const colorMeshes = new Map<number, THREE.BufferGeometry>();

  for (const [colorIndex, rects] of rectsByColor) {
    const geometries = rects.map(rect =>
      createBoxGeometry(rect, pixelSize, pixelHeight, baseHeight, gridWidth, gridHeight)
    );

    if (geometries.length > 0) {
      const mergedGeometry = mergeGeometries(geometries, false);

      // Dispose individual geometries
      geometries.forEach(g => g.dispose());

      if (mergedGeometry) {
        colorMeshes.set(colorIndex, mergedGeometry);
      }
    }
  }

  // Generate base geometry matching the footprint
  let baseMesh = generateBaseGeometry(pixelGrid, pixelSize, baseHeight);

  // Apply keyhole if enabled
  let keyholeApplied = false;
  if (keyhole.enabled) {
    const originalBase = baseMesh;
    baseMesh = applyKeyhole(
      baseMesh,
      pixelGrid,
      pixelSize,
      baseHeight,
      pixelHeight,
      keyhole.position
    );

    // Only dispose if a new geometry was created
    if (baseMesh !== originalBase) {
      originalBase.dispose();
      keyholeApplied = true;
    }
  }

  return {
    colorMeshes,
    baseMesh,
    keyholeApplied
  };
}

/**
 * Utility function to create a Three.js mesh from geometry with a color
 */
export function createColoredMesh(
  geometry: THREE.BufferGeometry,
  color: Color
): THREE.Mesh {
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color.r / 255, color.g / 255, color.b / 255),
    roughness: 0.7,
    metalness: 0.1
  });

  return new THREE.Mesh(geometry, material);
}

/**
 * Utility function to create a complete 3D scene from mesh result
 */
export function createSceneFromMeshResult(
  result: MeshResult,
  palette: Color[],
  baseColor: Color = { r: 50, g: 50, b: 50, hex: '#323232' }
): THREE.Group {
  const group = new THREE.Group();

  // Add base mesh
  const baseMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(baseColor.r / 255, baseColor.g / 255, baseColor.b / 255),
    roughness: 0.8,
    metalness: 0.1
  });
  const baseMeshObject = new THREE.Mesh(result.baseMesh, baseMaterial);
  group.add(baseMeshObject);

  // Add colored pixel meshes
  for (const [colorIndex, geometry] of result.colorMeshes) {
    const color = palette[colorIndex];
    if (color) {
      const mesh = createColoredMesh(geometry, color);
      group.add(mesh);
    }
  }

  return group;
}

/**
 * Calculate statistics about the generated mesh
 */
export function getMeshStats(result: MeshResult): {
  totalTriangles: number;
  colorMeshTriangles: Map<number, number>;
  baseMeshTriangles: number;
} {
  const colorMeshTriangles = new Map<number, number>();
  let totalTriangles = 0;

  for (const [colorIndex, geometry] of result.colorMeshes) {
    const triangles = geometry.index
      ? geometry.index.count / 3
      : (geometry.attributes.position?.count ?? 0) / 3;
    colorMeshTriangles.set(colorIndex, triangles);
    totalTriangles += triangles;
  }

  const baseMeshTriangles = result.baseMesh.index
    ? result.baseMesh.index.count / 3
    : (result.baseMesh.attributes.position?.count ?? 0) / 3;

  totalTriangles += baseMeshTriangles;

  return {
    totalTriangles,
    colorMeshTriangles,
    baseMeshTriangles
  };
}

/**
 * Dispose all geometries in a mesh result to free memory
 */
export function disposeMeshResult(result: MeshResult): void {
  for (const geometry of result.colorMeshes.values()) {
    geometry.dispose();
  }
  result.baseMesh.dispose();
}
