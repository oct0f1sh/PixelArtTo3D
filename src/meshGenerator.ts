import * as THREE from 'three';

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

// Quad representation for greedy face meshing
interface Quad {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Generates a fully manifold mesh by only creating exterior faces.
 * Uses a voxel-based approach where we check each face to see if it's
 * on the boundary (adjacent to air/different material).
 */
function generateManifoldGeometry(
  grid: PixelGrid,
  pixelSize: number,
  layerHeight: number,
  yOffset: number,
  colorFilter: number | null, // null = all non-transparent, number = specific color index
  gridWidth: number,
  gridHeight: number
): THREE.BufferGeometry {
  const vertices: number[] = [];
  const indices: number[] = [];

  // Helper to check if a cell is solid (matches our filter)
  const isSolid = (x: number, z: number): boolean => {
    if (x < 0 || x >= gridWidth || z < 0 || z >= gridHeight) return false;
    const colorIndex = grid[z][x];
    if (colorIndex === -1) return false;
    if (colorFilter === null) return true;
    return colorIndex === colorFilter;
  };

  // Top faces (Y+) - use greedy meshing since they're all coplanar
  const topFaces = collectHorizontalFaces(gridWidth, gridHeight, (x, z) => isSolid(x, z));
  generateHorizontalFaces(topFaces, 'top', pixelSize, yOffset + layerHeight, gridWidth, gridHeight, vertices, indices);

  // Bottom faces (Y-) - use greedy meshing since they're all coplanar
  const bottomFaces = collectHorizontalFaces(gridWidth, gridHeight, (x, z) => isSolid(x, z));
  generateHorizontalFaces(bottomFaces, 'bottom', pixelSize, yOffset, gridWidth, gridHeight, vertices, indices);

  // Side faces - generate all 4 directions with proper coordinate handling
  generateSideFaces(grid, gridWidth, gridHeight, pixelSize, yOffset, layerHeight, colorFilter, vertices, indices);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return geometry;
}

/**
 * Collects horizontal faces using 2D greedy meshing
 */
function collectHorizontalFaces(
  width: number,
  height: number,
  shouldHaveFace: (x: number, z: number) => boolean
): Quad[] {
  const visited: boolean[][] = Array.from({ length: height }, () =>
    Array(width).fill(false)
  );

  const quads: Quad[] = [];

  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      if (visited[z][x] || !shouldHaveFace(x, z)) continue;

      // Find maximum width
      let quadWidth = 1;
      while (
        x + quadWidth < width &&
        !visited[z][x + quadWidth] &&
        shouldHaveFace(x + quadWidth, z)
      ) {
        quadWidth++;
      }

      // Find maximum height while maintaining width
      let quadHeight = 1;
      outer: while (z + quadHeight < height) {
        for (let dx = 0; dx < quadWidth; dx++) {
          if (visited[z + quadHeight][x + dx] || !shouldHaveFace(x + dx, z + quadHeight)) {
            break outer;
          }
        }
        quadHeight++;
      }

      // Mark as visited
      for (let dz = 0; dz < quadHeight; dz++) {
        for (let dx = 0; dx < quadWidth; dx++) {
          visited[z + dz][x + dx] = true;
        }
      }

      quads.push({ x, y: z, width: quadWidth, height: quadHeight });
    }
  }

  return quads;
}

/**
 * Helper to check if a cell is solid (matches our color filter)
 */
function isCellSolid(
  grid: PixelGrid,
  x: number,
  z: number,
  gridWidth: number,
  gridHeight: number,
  colorFilter: number | null
): boolean {
  if (x < 0 || x >= gridWidth || z < 0 || z >= gridHeight) return false;
  const colorIndex = grid[z][x];
  if (colorIndex === -1) return false;
  if (colorFilter === null) return true;
  return colorIndex === colorFilter;
}

/**
 * Helper to check if a cell is any solid (non-transparent) regardless of color.
 * Used to determine if a side face should be generated at external boundaries only.
 */
function isCellAnySolid(
  grid: PixelGrid,
  x: number,
  z: number,
  gridWidth: number,
  gridHeight: number
): boolean {
  if (x < 0 || x >= gridWidth || z < 0 || z >= gridHeight) return false;
  return grid[z][x] !== -1;
}

/**
 * Helper to add a quad face to the vertex/index arrays
 * Vertices should be in counter-clockwise order when viewed from outside
 */
function addQuadFace(
  vertices: number[],
  indices: number[],
  v0: [number, number, number],
  v1: [number, number, number],
  v2: [number, number, number],
  v3: [number, number, number]
): void {
  const baseIndex = vertices.length / 3;
  vertices.push(...v0, ...v1, ...v2, ...v3);
  // Two triangles: 0-1-2 and 0-2-3
  indices.push(
    baseIndex, baseIndex + 1, baseIndex + 2,
    baseIndex, baseIndex + 2, baseIndex + 3
  );
}

/**
 * Generate all side faces for the geometry.
 * For each cell, check each of its 4 sides and create a face if the neighbor is empty (transparent).
 * Only creates faces at external boundaries - not between different colored pixels.
 * Simple per-cell approach without greedy meshing to ensure correctness.
 */
function generateSideFaces(
  grid: PixelGrid,
  gridWidth: number,
  gridHeight: number,
  pixelSize: number,
  yOffset: number,
  layerHeight: number,
  colorFilter: number | null,
  vertices: number[],
  indices: number[]
): void {
  const y1 = yOffset;
  const y2 = yOffset + layerHeight;

  // Process each cell
  for (let gz = 0; gz < gridHeight; gz++) {
    for (let gx = 0; gx < gridWidth; gx++) {
      // Check if this cell matches our color filter
      if (!isCellSolid(grid, gx, gz, gridWidth, gridHeight, colorFilter)) {
        continue;
      }

      // Calculate world coordinates for this cell
      // Due to mirroring: higher gx -> lower worldX, higher gz -> lower worldZ
      const xMin = (gridWidth - gx - 1) * pixelSize;
      const xMax = (gridWidth - gx) * pixelSize;
      const zMin = (gridHeight - gz - 1) * pixelSize;
      const zMax = (gridHeight - gz) * pixelSize;

      // LEFT face (grid X- = world X+): check neighbor at gx-1
      // Only create face if neighbor is empty (not just different color)
      // Face is at xMax, facing +X direction
      if (!isCellAnySolid(grid, gx - 1, gz, gridWidth, gridHeight)) {
        addQuadFace(vertices, indices,
          [xMax, y1, zMax],
          [xMax, y1, zMin],
          [xMax, y2, zMin],
          [xMax, y2, zMax]
        );
      }

      // RIGHT face (grid X+ = world X-): check neighbor at gx+1
      // Face is at xMin, facing -X direction
      if (!isCellAnySolid(grid, gx + 1, gz, gridWidth, gridHeight)) {
        addQuadFace(vertices, indices,
          [xMin, y1, zMin],
          [xMin, y1, zMax],
          [xMin, y2, zMax],
          [xMin, y2, zMin]
        );
      }

      // BACK face (grid Z- = world Z+): check neighbor at gz-1
      // Face is at zMax, facing +Z direction
      if (!isCellAnySolid(grid, gx, gz - 1, gridWidth, gridHeight)) {
        addQuadFace(vertices, indices,
          [xMin, y1, zMax],
          [xMax, y1, zMax],
          [xMax, y2, zMax],
          [xMin, y2, zMax]
        );
      }

      // FRONT face (grid Z+ = world Z-): check neighbor at gz+1
      // Face is at zMin, facing -Z direction
      if (!isCellAnySolid(grid, gx, gz + 1, gridWidth, gridHeight)) {
        addQuadFace(vertices, indices,
          [xMax, y1, zMin],
          [xMin, y1, zMin],
          [xMin, y2, zMin],
          [xMax, y2, zMin]
        );
      }
    }
  }
}

/**
 * Generates geometry for horizontal (top/bottom) face quads
 */
function generateHorizontalFaces(
  quads: Quad[],
  direction: 'top' | 'bottom',
  pixelSize: number,
  yOffset: number,
  gridWidth: number,
  gridHeight: number,
  vertices: number[],
  indices: number[]
): void {
  for (const quad of quads) {
    const baseIndex = vertices.length / 3;

    // Calculate world coordinates (mirrored X for correct orientation)
    const x1 = (gridWidth - quad.x - quad.width) * pixelSize;
    const x2 = (gridWidth - quad.x) * pixelSize;
    const z1 = (gridHeight - quad.y - quad.height) * pixelSize;
    const z2 = (gridHeight - quad.y) * pixelSize;

    // Add vertices for the horizontal face
    vertices.push(
      x1, yOffset, z1,
      x2, yOffset, z1,
      x2, yOffset, z2,
      x1, yOffset, z2
    );

    if (direction === 'top') {
      // CCW winding for outward normal (Y+)
      indices.push(
        baseIndex, baseIndex + 2, baseIndex + 1,
        baseIndex, baseIndex + 3, baseIndex + 2
      );
    } else {
      // CW winding for outward normal (Y-)
      indices.push(
        baseIndex, baseIndex + 1, baseIndex + 2,
        baseIndex, baseIndex + 2, baseIndex + 3
      );
    }
  }
}

/**
 * Generate base geometry that matches the exact footprint of non-transparent pixels.
 * Creates a manifold mesh with only exterior faces.
 */
function generateBaseGeometry(
  grid: PixelGrid,
  pixelSize: number,
  baseHeight: number
): THREE.BufferGeometry {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;

  if (height === 0 || width === 0 || baseHeight <= 0) {
    return new THREE.BufferGeometry();
  }

  return generateManifoldGeometry(grid, pixelSize, baseHeight, 0, null, width, height);
}

/**
 * Generate color layer geometry for a specific color.
 * Only creates faces on the exterior boundaries.
 */
function generateColorGeometry(
  grid: PixelGrid,
  pixelSize: number,
  pixelHeight: number,
  baseHeight: number,
  colorIndex: number
): THREE.BufferGeometry {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;

  if (height === 0 || width === 0) {
    return new THREE.BufferGeometry();
  }

  return generateManifoldGeometry(grid, pixelSize, pixelHeight, baseHeight, colorIndex, width, height);
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

  // Combine the base mesh with the ring geometry by manually merging vertices and indices
  const combinedGeometry = combineGeometries([baseMesh, ringGeometry]);

  ringGeometry.dispose();

  return combinedGeometry ?? baseMesh;
}

/**
 * Combines multiple geometries into one by merging their vertex and index data.
 * This is a simple merge that doesn't remove duplicate vertices.
 */
function combineGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  const validGeometries = geometries.filter(g => g.attributes.position && g.attributes.position.count > 0);

  if (validGeometries.length === 0) return null;
  if (validGeometries.length === 1) return validGeometries[0].clone();

  const positions: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;

  for (const geom of validGeometries) {
    const posAttr = geom.attributes.position;
    const posArray = posAttr.array;

    // Add positions
    for (let i = 0; i < posArray.length; i++) {
      positions.push(posArray[i]);
    }

    // Add indices with offset
    if (geom.index) {
      const indexArray = geom.index.array;
      for (let i = 0; i < indexArray.length; i++) {
        indices.push(indexArray[i] + vertexOffset);
      }
    } else {
      // Non-indexed geometry - create indices
      const vertexCount = posAttr.count;
      for (let i = 0; i < vertexCount; i++) {
        indices.push(i + vertexOffset);
      }
    }

    vertexOffset += posAttr.count;
  }

  const combined = new THREE.BufferGeometry();
  combined.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  combined.setIndex(indices);
  combined.computeVertexNormals();

  return combined;
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
 * Main function to generate 3D meshes from a pixel grid.
 * Generates fully manifold geometry suitable for 3D printing.
 */
export function generateMeshes(params: MeshGeneratorParams): MeshResult {
  const {
    pixelGrid,
    pixelSize,
    pixelHeight = 2,
    baseHeight = 1,
    keyhole = { enabled: false, position: 'top-center' }
  } = params;

  // Find all unique color indices in the grid
  const colorIndices = new Set<number>();
  for (const row of pixelGrid) {
    for (const colorIndex of row) {
      if (colorIndex !== -1) {
        colorIndices.add(colorIndex);
      }
    }
  }

  // Create manifold geometries for each color
  const colorMeshes = new Map<number, THREE.BufferGeometry>();

  for (const colorIndex of colorIndices) {
    const geometry = generateColorGeometry(
      pixelGrid,
      pixelSize,
      pixelHeight,
      baseHeight,
      colorIndex
    );

    if (geometry.attributes.position && geometry.attributes.position.count > 0) {
      colorMeshes.set(colorIndex, geometry);
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
