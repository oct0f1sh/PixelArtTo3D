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
  baseMesh: THREE.BufferGeometry | null; // Base layer covering all pixels (y=0 to y=baseHeight)
  keyholeApplied: boolean;
}

/**
 * Generates a fully manifold mesh with zero non-manifold edges and zero boundary edges.
 *
 * The key insight: at diagonal corners (where cells exist at (x,z) and (x+1,z+1) but not
 * at (x+1,z) and (x,z+1)), four wall faces meet at a single vertical edge. This creates
 * non-manifold geometry (edge used by >2 faces).
 *
 * Solution: At diagonal corners, we offset the wall vertices slightly inward so that
 * each cell's walls don't share the exact same edge position. This creates a tiny gap
 * at diagonal corners (imperceptible visually) but ensures manifold geometry even when
 * vertices are merged by position (as slicers do).
 */
function generateManifoldGeometry(
  grid: PixelGrid,
  pixelSize: number,
  layerHeight: number,
  yOffset: number,
  colorFilter: number | null,
  gridWidth: number,
  gridHeight: number
): THREE.BufferGeometry {
  const y1 = yOffset;
  const y2 = yOffset + layerHeight;

  // Offset to separate walls at diagonal corners.
  // Must be larger than slicer vertex merge tolerance (typically ~0.01mm).
  // Using 0.02mm minimum ensures walls stay separate after slicer processing.
  const DIAGONAL_OFFSET = Math.max(0.02, pixelSize * 0.02);

  const vertices: number[] = [];
  const indices: number[] = [];

  // Helper to check if cell is solid for this color
  const isSolid = (gx: number, gz: number): boolean => {
    return isCellSolid(grid, gx, gz, gridWidth, gridHeight, colorFilter);
  };

  // Identify diagonal corners and which direction to offset for each cell
  // Key: "gx,gz,corner" where corner is "xMin,zMin", "xMin,zMax", "xMax,zMin", "xMax,zMax"
  // Value: {dx, dz} offset direction for this cell at this corner
  const diagonalOffsets = new Map<string, { dx: number; dz: number }>();

  for (let gz = 0; gz < gridHeight; gz++) {
    for (let gx = 0; gx < gridWidth; gx++) {
      if (!isSolid(gx, gz)) continue;

      const hasLeft = isSolid(gx - 1, gz);
      const hasRight = isSolid(gx + 1, gz);
      const hasBack = isSolid(gx, gz - 1);
      const hasFront = isSolid(gx, gz + 1);
      const hasDiagTL = isSolid(gx - 1, gz - 1);
      const hasDiagTR = isSolid(gx + 1, gz - 1);
      const hasDiagBL = isSolid(gx - 1, gz + 1);
      const hasDiagBR = isSolid(gx + 1, gz + 1);

      // At diagonal corners, offset toward cell center
      // Top-Left diagonal (xMax, zMax corner) - offset toward cell center (-x, -z)
      if (hasDiagTL && !hasLeft && !hasBack) {
        diagonalOffsets.set(`${gx},${gz},xMax,zMax`, { dx: -DIAGONAL_OFFSET, dz: -DIAGONAL_OFFSET });
      }
      // Top-Right diagonal (xMin, zMax corner) - offset toward cell center (+x, -z)
      if (hasDiagTR && !hasRight && !hasBack) {
        diagonalOffsets.set(`${gx},${gz},xMin,zMax`, { dx: DIAGONAL_OFFSET, dz: -DIAGONAL_OFFSET });
      }
      // Bottom-Left diagonal (xMax, zMin corner) - offset toward cell center (-x, +z)
      if (hasDiagBL && !hasLeft && !hasFront) {
        diagonalOffsets.set(`${gx},${gz},xMax,zMin`, { dx: -DIAGONAL_OFFSET, dz: DIAGONAL_OFFSET });
      }
      // Bottom-Right diagonal (xMin, zMin corner) - offset toward cell center (+x, +z)
      if (hasDiagBR && !hasRight && !hasFront) {
        diagonalOffsets.set(`${gx},${gz},xMin,zMin`, { dx: DIAGONAL_OFFSET, dz: DIAGONAL_OFFSET });
      }
    }
  }

  // Global vertex pool for shared vertices
  const sharedVertices = new Map<string, number>();

  const getSharedVertex = (x: number, y: number, z: number): number => {
    const key = `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;
    let index = sharedVertices.get(key);
    if (index === undefined) {
      index = vertices.length / 3;
      vertices.push(x, y, z);
      sharedVertices.set(key, index);
    }
    return index;
  };

  // Generate geometry for each cell
  for (let gz = 0; gz < gridHeight; gz++) {
    for (let gx = 0; gx < gridWidth; gx++) {
      if (!isSolid(gx, gz)) continue;

      const xMin = (gridWidth - gx - 1) * pixelSize;
      const xMax = (gridWidth - gx) * pixelSize;
      const zMin = (gridHeight - gz - 1) * pixelSize;
      const zMax = (gridHeight - gz) * pixelSize;

      const hasLeft = isSolid(gx - 1, gz);
      const hasRight = isSolid(gx + 1, gz);
      const hasBack = isSolid(gx, gz - 1);
      const hasFront = isSolid(gx, gz + 1);

      // Get vertex for a corner, applying diagonal offset if needed
      const getCornerVertex = (baseX: number, y: number, baseZ: number): number => {
        // Determine which corner this is
        const cornerKey = `${gx},${gz},${baseX === xMin ? 'xMin' : 'xMax'},${baseZ === zMin ? 'zMin' : 'zMax'}`;
        const offset = diagonalOffsets.get(cornerKey);

        let x = baseX;
        let z = baseZ;
        if (offset) {
          x += offset.dx;
          z += offset.dz;
        }

        return getSharedVertex(x, y, z);
      };

      // TOP face (y=y2) - normal should point +Y (outward/up)
      // Counter-clockwise when viewed from +Y: i0 -> i3 -> i2 -> i1
      {
        const i0 = getCornerVertex(xMin, y2, zMin);
        const i1 = getCornerVertex(xMax, y2, zMin);
        const i2 = getCornerVertex(xMax, y2, zMax);
        const i3 = getCornerVertex(xMin, y2, zMax);
        indices.push(i0, i3, i2, i0, i2, i1);
      }

      // BOTTOM face (y=y1) - normal should point -Y (outward/down)
      // Counter-clockwise when viewed from -Y: i0 -> i1 -> i2 -> i3
      {
        const i0 = getCornerVertex(xMin, y1, zMin);
        const i1 = getCornerVertex(xMax, y1, zMin);
        const i2 = getCornerVertex(xMax, y1, zMax);
        const i3 = getCornerVertex(xMin, y1, zMax);
        indices.push(i0, i1, i2, i0, i2, i3);
      }

      // Wall faces - normals should point outward from the cell
      // For quad (i0,i1,i2,i3), winding (i0,i1,i2),(i0,i2,i3) gives normal from cross(i1-i0, i2-i0)

      // +X wall at xMax - normal should point +X
      // Looking from +X: vertices should be counter-clockwise in YZ plane
      if (!hasLeft) {
        const i0 = getCornerVertex(xMax, y1, zMax);
        const i1 = getCornerVertex(xMax, y1, zMin);
        const i2 = getCornerVertex(xMax, y2, zMin);
        const i3 = getCornerVertex(xMax, y2, zMax);
        indices.push(i0, i1, i2, i0, i2, i3);
      }

      // -X wall at xMin - normal should point -X
      // Looking from -X: vertices should be counter-clockwise in YZ plane
      if (!hasRight) {
        const i0 = getCornerVertex(xMin, y1, zMin);
        const i1 = getCornerVertex(xMin, y1, zMax);
        const i2 = getCornerVertex(xMin, y2, zMax);
        const i3 = getCornerVertex(xMin, y2, zMin);
        indices.push(i0, i1, i2, i0, i2, i3);
      }

      // +Z wall at zMax - normal should point +Z
      // Looking from +Z: vertices should be counter-clockwise in XY plane
      if (!hasBack) {
        const i0 = getCornerVertex(xMin, y1, zMax);
        const i1 = getCornerVertex(xMax, y1, zMax);
        const i2 = getCornerVertex(xMax, y2, zMax);
        const i3 = getCornerVertex(xMin, y2, zMax);
        indices.push(i0, i1, i2, i0, i2, i3);
      }

      // -Z wall at zMin - normal should point -Z
      // Looking from -Z: vertices should be counter-clockwise in XY plane
      if (!hasFront) {
        const i0 = getCornerVertex(xMax, y1, zMin);
        const i1 = getCornerVertex(xMin, y1, zMin);
        const i2 = getCornerVertex(xMin, y2, zMin);
        const i3 = getCornerVertex(xMax, y2, zMin);
        indices.push(i0, i1, i2, i0, i2, i3);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return geometry;
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
 * Generate a base mesh covering all non-transparent pixels.
 * The base goes from y=0 to y=baseHeight.
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

  // Base covers all non-transparent pixels (colorFilter = null means any non-transparent)
  return generateManifoldGeometry(grid, pixelSize, baseHeight, 0, null, width, height);
}

/**
 * Generate a color layer mesh for a specific color.
 * Each color goes from y=baseHeight to y=baseHeight+pixelHeight.
 * This sits on top of the base.
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

  // Color layer starts at baseHeight and goes up by pixelHeight
  return generateManifoldGeometry(grid, pixelSize, pixelHeight, baseHeight, colorIndex, width, height);
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
  // Rotate -90 degrees around X axis to lay flat
  // This transforms Y-up to Z-up (model lays flat, face pointing up)
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/**
 * Main function to generate 3D meshes from a pixel grid.
 * Creates a base mesh covering all pixels, plus separate color meshes on top.
 * - Base: y=0 to y=baseHeight (covers all non-transparent pixels)
 * - Colors: y=baseHeight to y=baseHeight+pixelHeight (each color is separate)
 */
export function generateMeshes(params: MeshGeneratorParams): MeshResult {
  const {
    pixelGrid,
    pixelSize,
    pixelHeight = 2,
    baseHeight = 1,
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

  // Generate base mesh (covers all non-transparent pixels)
  const baseMesh = generateBaseGeometry(pixelGrid, pixelSize, baseHeight);

  // Create manifold geometries for each color layer (sits on top of base)
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

  return {
    colorMeshes,
    baseMesh: baseMesh.attributes.position?.count > 0 ? baseMesh : null,
    keyholeApplied: false
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
  palette: Color[]
): THREE.Group {
  const group = new THREE.Group();

  // Add colored pixel meshes - each is a complete standalone extrusion
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

  return {
    totalTriangles,
    colorMeshTriangles
  };
}

/**
 * Dispose all geometries in a mesh result to free memory
 */
export function disposeMeshResult(result: MeshResult): void {
  if (result.baseMesh) {
    result.baseMesh.dispose();
  }
  for (const geometry of result.colorMeshes.values()) {
    geometry.dispose();
  }
}
