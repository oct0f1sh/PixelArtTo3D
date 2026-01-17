import * as THREE from 'three';
import ManifoldModule from 'manifold-3d';

// Initialize manifold-3d module (lazy loaded)
let manifoldModule: Awaited<ReturnType<typeof ManifoldModule>> | null = null;
async function getManifold() {
  if (!manifoldModule) {
    // Configure WASM locator to load from the correct path
    const locateFile = (path: string) => {
      if (path.endsWith('.wasm')) {
        // Check if we're in Node.js (tests) or browser
        if (typeof window === 'undefined') {
          // Node.js - use node_modules path
          return 'node_modules/manifold-3d/manifold.wasm';
        }
        // Browser - use public folder path
        return (import.meta.env?.BASE_URL || '/') + 'manifold.wasm';
      }
      return path;
    };
    manifoldModule = await ManifoldModule({ locateFile } as Parameters<typeof ManifoldModule>[0]);
    manifoldModule.setup(); // Required to initialize Mesh and other types
    manifoldModule.setCircularSegments(32); // 32 segments for smooth circles
  }
  return manifoldModule;
}

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
  type: 'holepunch' | 'floating';
  position: { x: number; y: number } | null; // Position in mm (world coordinates)
  holeDiameter: number; // mm, for holepunch
  innerDiameter: number; // mm, for floating (hole size)
  outerDiameter: number; // mm, for floating (total ring size)
}

export interface MagnetOptions {
  enabled: boolean;
  positions: Array<{ x: number; y: number }>; // Multiple magnet positions in mm
  diameter: number; // mm
  height: number; // mm (magnet thickness)
  depth: number; // mm (distance from back surface to cavity start)
}

export interface MeshGeneratorParams {
  pixelGrid: PixelGrid;
  palette: Color[];
  pixelSize: number; // mm per pixel
  pixelHeight?: number; // mm, default 2
  baseHeight?: number; // mm, default 1
  keyhole?: KeyholeOptions;
  magnet?: MagnetOptions;
  /**
   * When true, generates full-height color meshes (y=0 to y=totalHeight) without a separate base.
   * This avoids overlapping faces when meshes are merged for STL export.
   * When false (default), generates separate base mesh + color layer meshes (for 3MF multi-material).
   */
  singleMeshMode?: boolean;
  /**
   * When true, generates meshes that don't overlap with each other.
   * - Base: bottom + outer walls + top only where no color exists
   * - Colors: top + exterior walls + bottom (no interior walls between colors)
   * This produces 0 non-manifold edges when combined but individual meshes have boundary edges.
   * Use this for 3MF export when you need zero non-manifold edges in the combined model.
   */
  noOverlapMode?: boolean;
}

export interface MeshResult {
  colorMeshes: Map<number, THREE.BufferGeometry>;
  baseMesh: THREE.BufferGeometry | null; // Base layer covering all pixels (y=0 to y=baseHeight)
  keyholeApplied: boolean;
  /** Unified mesh created by CSG union of all meshes (only when singleMeshMode is true) */
  unifiedMesh: THREE.BufferGeometry | null;
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
interface ManifoldGeometryOptions {
  skipBottomFace?: boolean;  // Skip bottom face (for color layers that sit on base)
  skipTopFace?: boolean;     // Skip top face (for base mesh that colors sit on)
  /**
   * When true, only generate walls at boundaries with transparent pixels or with
   * higher-indexed colors. This prevents duplicate walls when meshes are merged.
   */
  avoidDuplicateWalls?: boolean;
  /**
   * When true, only generate walls at transparent boundaries.
   * This means no walls between adjacent colors - they share boundary space.
   * Used for "puzzle piece" mode where meshes fit together without overlap.
   */
  exteriorWallsOnly?: boolean;
}

function generateManifoldGeometry(
  grid: PixelGrid,
  pixelSize: number,
  layerHeight: number,
  yOffset: number,
  colorFilter: number | null,
  gridWidth: number,
  gridHeight: number,
  options: ManifoldGeometryOptions = {}
): THREE.BufferGeometry {
  const { skipBottomFace = false, skipTopFace = false, avoidDuplicateWalls = false, exteriorWallsOnly = false } = options;

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

  // Helper to get the color index at a cell (returns -1 for transparent/out of bounds)
  const getColorAt = (gx: number, gz: number): number => {
    if (gx < 0 || gx >= gridWidth || gz < 0 || gz >= gridHeight) return -1;
    return grid[gz][gx];
  };

  // Helper to determine if we should generate a wall at a boundary
  // When avoidDuplicateWalls is true, only generate wall if:
  // - Adjacent cell is transparent (-1)
  // - OR this color has a lower index than the adjacent color (we "own" the wall)
  // When exteriorWallsOnly is true, only generate wall at transparent boundaries
  // Note: _gx, _gz are available for future use but currently unused
  const shouldGenerateWall = (_gx: number, _gz: number, adjGx: number, adjGz: number): boolean => {
    const adjColor = getColorAt(adjGx, adjGz);

    // If adjacent is transparent or out of bounds, always generate wall
    if (adjColor === -1) return true;

    // exteriorWallsOnly: only walls at transparent boundaries (handled above)
    // No walls between colors - they share the boundary space
    if (exteriorWallsOnly) return false;

    // If not avoiding duplicate walls, generate wall when adjacent isn't our color
    if (!avoidDuplicateWalls) {
      if (colorFilter === null) {
        // Base mesh: wall only at outer boundary (adjacent is transparent)
        return false; // Already handled above
      }
      return adjColor !== colorFilter;
    }

    // Avoiding duplicate walls: only generate if we have lower color index
    // This ensures each wall is generated by exactly one mesh
    if (colorFilter === null) {
      // Base mesh doesn't use this logic
      return false;
    }

    // Don't generate wall with same color
    if (adjColor === colorFilter) return false;

    // Generate wall only if our color index is lower
    return colorFilter < adjColor;
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
      // Skip for base mesh (colors will cover these)
      if (!skipTopFace) {
        const i0 = getCornerVertex(xMin, y2, zMin);
        const i1 = getCornerVertex(xMax, y2, zMin);
        const i2 = getCornerVertex(xMax, y2, zMax);
        const i3 = getCornerVertex(xMin, y2, zMax);
        indices.push(i0, i3, i2, i0, i2, i1);
      }

      // BOTTOM face (y=y1) - normal should point -Y (outward/down)
      // Skip for color layers that sit on the base mesh (avoids duplicate faces)
      if (!skipBottomFace) {
        const i0 = getCornerVertex(xMin, y1, zMin);
        const i1 = getCornerVertex(xMax, y1, zMin);
        const i2 = getCornerVertex(xMax, y1, zMax);
        const i3 = getCornerVertex(xMin, y1, zMax);
        indices.push(i0, i1, i2, i0, i2, i3);
      }

      // Wall faces - normals should point outward from the cell
      // For quad (i0,i1,i2,i3), winding (i0,i1,i2),(i0,i2,i3) gives normal from cross(i1-i0, i2-i0)
      //
      // When avoidDuplicateWalls is true, we only generate walls at boundaries where:
      // - Adjacent cell is transparent (outer boundary) OR
      // - This color has a lower index than the adjacent color (we "own" this inter-color wall)
      // This prevents duplicate walls when meshes are merged for STL export.

      // +X wall at xMax - normal should point +X
      // Looking from +X: vertices should be counter-clockwise in YZ plane
      // gx-1 is the "left" neighbor in grid coords which maps to +X direction
      if (!hasLeft && shouldGenerateWall(gx, gz, gx - 1, gz)) {
        const i0 = getCornerVertex(xMax, y1, zMax);
        const i1 = getCornerVertex(xMax, y1, zMin);
        const i2 = getCornerVertex(xMax, y2, zMin);
        const i3 = getCornerVertex(xMax, y2, zMax);
        indices.push(i0, i1, i2, i0, i2, i3);
      }

      // -X wall at xMin - normal should point -X
      // Looking from -X: vertices should be counter-clockwise in YZ plane
      // gx+1 is the "right" neighbor in grid coords which maps to -X direction
      if (!hasRight && shouldGenerateWall(gx, gz, gx + 1, gz)) {
        const i0 = getCornerVertex(xMin, y1, zMin);
        const i1 = getCornerVertex(xMin, y1, zMax);
        const i2 = getCornerVertex(xMin, y2, zMax);
        const i3 = getCornerVertex(xMin, y2, zMin);
        indices.push(i0, i1, i2, i0, i2, i3);
      }

      // +Z wall at zMax - normal should point +Z
      // Looking from +Z: vertices should be counter-clockwise in XY plane
      // gz-1 is the "back" neighbor in grid coords which maps to +Z direction
      if (!hasBack && shouldGenerateWall(gx, gz, gx, gz - 1)) {
        const i0 = getCornerVertex(xMin, y1, zMax);
        const i1 = getCornerVertex(xMax, y1, zMax);
        const i2 = getCornerVertex(xMax, y2, zMax);
        const i3 = getCornerVertex(xMin, y2, zMax);
        indices.push(i0, i1, i2, i0, i2, i3);
      }

      // -Z wall at zMin - normal should point -Z
      // Looking from -Z: vertices should be counter-clockwise in XY plane
      // gz+1 is the "front" neighbor in grid coords which maps to -Z direction
      if (!hasFront && shouldGenerateWall(gx, gz, gx, gz + 1)) {
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
 * Includes top faces to provide the floor for color layers.
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
  // Includes top faces which provide the floor for color layer walls
  return generateManifoldGeometry(grid, pixelSize, baseHeight, 0, null, width, height, {});
}

/**
 * Generate a color layer mesh for a specific color.
 * Each color goes from y=baseHeight to y=baseHeight+pixelHeight.
 * This sits on top of the base.
 * Each color mesh is individually watertight for 3MF multi-material export.
 *
 * @param noOverlapOffset - If true, adds a tiny Y offset to prevent overlapping with base top faces.
 *                          This is critical for 3MF export where overlapping faces cause non-manifold edges.
 */
function generateColorGeometry(
  grid: PixelGrid,
  pixelSize: number,
  pixelHeight: number,
  baseHeight: number,
  colorIndex: number,
  noOverlapOffset: boolean = false
): THREE.BufferGeometry {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;

  if (height === 0 || width === 0) {
    return new THREE.BufferGeometry();
  }

  // Add a small offset to prevent overlapping with base top faces.
  // 0.02mm is small enough to be imperceptible but large enough to prevent
  // face coincidence issues (typical slicer merge tolerance is ~0.01mm).
  const yOffset = noOverlapOffset ? 0.02 : 0;

  // Color layer starts at baseHeight (plus offset) and goes up by pixelHeight
  // Each color mesh is a complete watertight solid with ALL its walls.
  // This ensures each mesh is individually manifold for 3MF export.
  // Overlapping walls between adjacent colors are expected and handled by slicers.
  return generateManifoldGeometry(grid, pixelSize, pixelHeight, baseHeight + yOffset, colorIndex, width, height, {});
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
 * Convert THREE.js BufferGeometry to Manifold mesh format
 */
function threeGeometryToManifoldMesh(
  geometry: THREE.BufferGeometry,
  manifold: Awaited<ReturnType<typeof ManifoldModule>>
): InstanceType<typeof manifold.Mesh> {
  const position = geometry.attributes.position;
  const index = geometry.index;

  // Get vertex positions
  const vertCount = position.count;
  const vertProperties = new Float32Array(vertCount * 3);
  for (let i = 0; i < vertCount; i++) {
    vertProperties[i * 3] = position.getX(i);
    vertProperties[i * 3 + 1] = position.getY(i);
    vertProperties[i * 3 + 2] = position.getZ(i);
  }

  // Get triangle indices
  let triVerts: Uint32Array;
  if (index) {
    triVerts = new Uint32Array(index.array);
  } else {
    // Non-indexed geometry - create indices
    triVerts = new Uint32Array(vertCount);
    for (let i = 0; i < vertCount; i++) {
      triVerts[i] = i;
    }
  }

  // Create mesh and use Manifold's merge function to identify coincident vertices
  const mesh = new manifold.Mesh({
    numProp: 3,
    vertProperties,
    triVerts,
  });

  // Call merge() to identify vertices at the same position
  // This helps Manifold properly handle the topology
  mesh.merge();

  return mesh;
}

/**
 * Convert Manifold mesh back to THREE.js BufferGeometry
 */
function manifoldMeshToThreeGeometry(
  mesh: { vertProperties: Float32Array; triVerts: Uint32Array; numProp: number }
): THREE.BufferGeometry {
  const numProp = mesh.numProp;
  const vertProperties = mesh.vertProperties;
  const triVerts = mesh.triVerts;

  // Extract positions from interleaved properties
  const vertCount = vertProperties.length / numProp;
  const positions = new Float32Array(vertCount * 3);
  for (let i = 0; i < vertCount; i++) {
    positions[i * 3] = vertProperties[i * numProp];
    positions[i * 3 + 1] = vertProperties[i * numProp + 1];
    positions[i * 3 + 2] = vertProperties[i * numProp + 2];
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.Uint32BufferAttribute(triVerts, 1));
  geometry.computeVertexNormals();

  return geometry;
}

/**
 * Performs manifold CSG subtraction using manifold-3d library.
 * This is guaranteed to produce manifold output.
 */
async function subtractCylinderManifold(
  geometry: THREE.BufferGeometry,
  holePosition: { x: number; y: number },
  holeDiameter: number,
  yMin: number,
  yMax: number
): Promise<THREE.BufferGeometry | null> {
  try {
    const wasm = await getManifold();
    const { Manifold } = wasm;

    // Convert THREE geometry to Manifold
    const inputMesh = threeGeometryToManifoldMesh(geometry, wasm);
    let inputManifold: InstanceType<typeof Manifold>;

    try {
      inputManifold = Manifold.ofMesh(inputMesh);
    } catch {
      console.error('Failed to create manifold from input geometry - geometry may not be manifold');
      return null;
    }

    // Create cylinder in manifold-3d
    // Manifold cylinder is created along Z axis, so we need to rotate and translate
    const radius = holeDiameter / 2;
    const height = yMax - yMin;

    // Create cylinder centered at origin along Z axis
    let cylinder = Manifold.cylinder(height, radius, radius, 32, true);

    // Rotate 90 degrees around X to make it vertical (along Y axis)
    cylinder = cylinder.rotate([90, 0, 0]);

    // Translate to correct position
    // In our coordinate system: X stays X, Y maps to Y, hole position.y maps to -Z
    const centerY = (yMin + yMax) / 2;
    cylinder = cylinder.translate([holePosition.x, centerY, -holePosition.y]);

    // Perform boolean subtraction
    const result = inputManifold.subtract(cylinder);

    // Get mesh from result
    const resultMesh = result.getMesh();

    // Convert back to THREE geometry
    const resultGeometry = manifoldMeshToThreeGeometry(resultMesh);

    // Cleanup WASM memory (Manifold objects need delete(), Mesh objects don't)
    inputManifold.delete();
    cylinder.delete();
    result.delete();

    return resultGeometry;
  } catch (error) {
    console.error('Manifold CSG subtraction failed:', error);
    return null;
  }
}

/**
 * Subtracts a magnet cavity (blind pocket) from the geometry.
 * Unlike a through-hole, this creates a pocket starting from y=depth
 * and extending to y=depth+magnetHeight.
 */
async function subtractMagnetCavityManifold(
  geometry: THREE.BufferGeometry,
  magnetPosition: { x: number; y: number },
  diameter: number,
  magnetHeight: number,
  depth: number
): Promise<THREE.BufferGeometry | null> {
  try {
    const wasm = await getManifold();
    const { Manifold } = wasm;

    // Convert THREE geometry to Manifold
    const inputMesh = threeGeometryToManifoldMesh(geometry, wasm);
    let inputManifold: InstanceType<typeof Manifold>;

    try {
      inputManifold = Manifold.ofMesh(inputMesh);
    } catch {
      console.error('Failed to create manifold from input geometry for magnet cavity');
      return null;
    }

    // Create cylinder for the magnet cavity
    const radius = diameter / 2;

    // The cavity starts at y=depth and extends upward by magnetHeight
    // Add small epsilon for clean boolean operations
    const cavityYMin = depth - 0.01;
    const cavityYMax = depth + magnetHeight + 0.01;
    const cavityHeight = cavityYMax - cavityYMin;

    // Create cylinder centered at origin along Z axis
    let cylinder = Manifold.cylinder(cavityHeight, radius, radius, 32, true);

    // Rotate 90 degrees around X to make it vertical (along Y axis)
    cylinder = cylinder.rotate([90, 0, 0]);

    // Translate to correct position
    // In our coordinate system: X stays X, Y maps to Y, position.y maps to -Z
    const centerY = (cavityYMin + cavityYMax) / 2;
    cylinder = cylinder.translate([magnetPosition.x, centerY, -magnetPosition.y]);

    // Perform boolean subtraction
    const result = inputManifold.subtract(cylinder);

    // Get mesh from result
    const resultMesh = result.getMesh();

    // Convert back to THREE geometry
    const resultGeometry = manifoldMeshToThreeGeometry(resultMesh);

    // Cleanup WASM memory
    inputManifold.delete();
    cylinder.delete();
    result.delete();

    return resultGeometry;
  } catch (error) {
    console.error('Magnet cavity CSG subtraction failed:', error);
    return null;
  }
}


/**
 * Creates a torus geometry for the floating keyhole style.
 * The torus is positioned at the specified location.
 */
function createFloatingTorus(
  position: { x: number; y: number },
  innerDiameter: number,
  outerDiameter: number,
  totalHeight: number
): THREE.BufferGeometry {
  // Tube radius is half the wall thickness
  const tubeRadius = (outerDiameter - innerDiameter) / 4;
  // Torus radius is from center to tube center
  const torusRadius = (innerDiameter / 2) + tubeRadius;

  const geometry = new THREE.TorusGeometry(torusRadius, tubeRadius, 16, 32);

  // Rotate torus to be vertical (hole facing horizontally)
  geometry.rotateX(Math.PI / 2);

  // Position torus at the keyhole location
  // X maps to X, Y maps to -Z (since Y in 2D corresponds to Z in 3D, inverted)
  geometry.translate(position.x, totalHeight / 2, -position.y);

  return geometry;
}

/**
 * Merges a torus geometry with a base geometry.
 */
function mergeGeometries(
  baseGeometry: THREE.BufferGeometry,
  torusGeometry: THREE.BufferGeometry
): THREE.BufferGeometry {
  const basePositions = baseGeometry.attributes.position;
  const baseIndices = baseGeometry.index;
  const torusPositions = torusGeometry.attributes.position;
  const torusIndices = torusGeometry.index;

  if (!basePositions || !torusPositions) {
    return baseGeometry;
  }

  // Calculate new array sizes
  const baseVertexCount = basePositions.count;
  const torusVertexCount = torusPositions.count;
  const totalVertexCount = baseVertexCount + torusVertexCount;

  // Merge positions
  const newPositions = new Float32Array(totalVertexCount * 3);
  newPositions.set(new Float32Array(basePositions.array), 0);
  newPositions.set(new Float32Array(torusPositions.array), baseVertexCount * 3);

  // Merge indices (offset torus indices by base vertex count)
  const baseIndexArray = baseIndices ? Array.from(baseIndices.array) : [];
  const torusIndexArray = torusIndices
    ? Array.from(torusIndices.array).map(i => i + baseVertexCount)
    : [];
  const newIndices = [...baseIndexArray, ...torusIndexArray];

  // Create new geometry
  const mergedGeometry = new THREE.BufferGeometry();
  mergedGeometry.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
  mergedGeometry.setIndex(newIndices);
  mergedGeometry.computeVertexNormals();

  return mergedGeometry;
}

/**
 * Generate a unified mesh for STL export.
 * This creates a single watertight mesh with no internal divisions.
 * The mesh covers all non-transparent pixels from y=0 to y=totalHeight.
 */
function generateUnifiedMeshForSTL(
  grid: PixelGrid,
  pixelSize: number,
  totalHeight: number
): THREE.BufferGeometry {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;

  if (height === 0 || width === 0) {
    return new THREE.BufferGeometry();
  }

  // Generate a single solid covering all non-transparent pixels
  // colorFilter = null means include all non-transparent pixels
  // This creates outer walls only (no internal divisions)
  return generateManifoldGeometry(grid, pixelSize, totalHeight, 0, null, width, height, {});
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
    keyhole,
    singleMeshMode = false,
  } = params;

  const totalHeight = baseHeight + pixelHeight;

  let keyholeApplied = false;
  const workingGrid = pixelGrid;

  // For holepunch, we'll use CSG subtraction to create smooth round holes
  const holepunchEnabled = keyhole?.enabled && keyhole.position && keyhole.type === 'holepunch';
  if (holepunchEnabled) {
    console.log('Holepunch: Will create cylinder for CSG subtraction at', keyhole.position);
  }

  // Find all unique color indices in the (possibly modified) grid
  const colorIndices = new Set<number>();
  for (const row of workingGrid) {
    for (const colorIndex of row) {
      if (colorIndex !== -1) {
        colorIndices.add(colorIndex);
      }
    }
  }

  // Create color meshes
  const colorMeshes = new Map<number, THREE.BufferGeometry>();
  let baseMesh: THREE.BufferGeometry | null = null;

  if (singleMeshMode) {
    // Single mesh mode: generate a unified mesh for STL export
    // This creates a single watertight mesh with no internal divisions
    const unifiedGeometry = generateUnifiedMeshForSTL(workingGrid, pixelSize, totalHeight);
    if (unifiedGeometry.attributes.position && unifiedGeometry.attributes.position.count > 0) {
      // Store it as color mesh 0 for compatibility (actual color doesn't matter for STL)
      colorMeshes.set(0, unifiedGeometry);
    }
  } else {
    // Normal mode: separate base mesh + color layer meshes (for 3MF multi-material)
    // Generate base mesh (covers all non-transparent pixels)
    baseMesh = generateBaseGeometry(workingGrid, pixelSize, baseHeight);

    // Create manifold geometries for each color layer (sits on top of base)
    // Use noOverlapOffset to prevent color bottom faces from overlapping with base top faces.
    // This is critical for 3MF export to avoid non-manifold edges when meshes are analyzed together.
    for (const colorIndex of colorIndices) {
      const geometry = generateColorGeometry(
        workingGrid,
        pixelSize,
        pixelHeight,
        baseHeight,
        colorIndex,
        true // noOverlapOffset: adds 0.02mm offset to prevent overlap with base
      );

      if (geometry.attributes.position && geometry.attributes.position.count > 0) {
        colorMeshes.set(colorIndex, geometry);
      }
    }
  }

  // Note: CSG holepunch is applied asynchronously via applyHolepunch()
  // The caller should use generateMeshesAsync() or call applyHolepunch() separately

  // Apply floating torus if enabled
  if (keyhole?.enabled && keyhole.position && keyhole.type === 'floating') {
    console.log('Adding floating torus at position:', keyhole.position);
    try {
      const torusGeometry = createFloatingTorus(
        keyhole.position,
        keyhole.innerDiameter,
        keyhole.outerDiameter,
        totalHeight
      );

      if (baseMesh && baseMesh.attributes.position?.count > 0) {
        baseMesh = mergeGeometries(baseMesh, torusGeometry);
      }

      torusGeometry.dispose();
      keyholeApplied = true;
    } catch (error) {
      console.error('Failed to add floating torus:', error);
    }
  }

  return {
    colorMeshes,
    baseMesh: baseMesh && baseMesh.attributes.position?.count > 0 ? baseMesh : null,
    keyholeApplied,
    unifiedMesh: null
  };
}

/**
 * Async version of generateMeshes that applies holepunch using manifold-3d.
 * This produces guaranteed manifold output for 3D printing.
 */
export async function generateMeshesAsync(params: MeshGeneratorParams): Promise<MeshResult> {
  // First generate the basic meshes
  const result = generateMeshes(params);

  const {
    pixelHeight = 2,
    baseHeight = 1,
    keyhole,
  } = params;

  const totalHeight = baseHeight + pixelHeight;

  // Apply holepunch if enabled
  if (keyhole?.enabled && keyhole.position && keyhole.type === 'holepunch') {
    console.log('Holepunch: Applying manifold CSG at', keyhole.position);

    const yMin = -0.1;  // Slightly below the model
    const yMax = totalHeight + 0.1;  // Slightly above the model

    // Apply to base mesh
    if (result.baseMesh && result.baseMesh.attributes.position?.count > 0) {
      const newBaseMesh = await subtractCylinderManifold(
        result.baseMesh,
        keyhole.position,
        keyhole.holeDiameter,
        yMin,
        yMax
      );
      if (newBaseMesh) {
        result.baseMesh.dispose();
        result.baseMesh = newBaseMesh;
        result.keyholeApplied = true;
      }
    }

    // Apply to color meshes
    for (const [colorIndex, geometry] of result.colorMeshes) {
      if (geometry.attributes.position?.count > 0) {
        const newGeometry = await subtractCylinderManifold(
          geometry,
          keyhole.position,
          keyhole.holeDiameter,
          yMin,
          yMax
        );
        if (newGeometry) {
          geometry.dispose();
          result.colorMeshes.set(colorIndex, newGeometry);
          result.keyholeApplied = true;
        }
      }
    }
  }

  // Apply magnet cavities if enabled
  if (params.magnet?.enabled && params.magnet.positions.length > 0) {
    console.log('Magnet: Applying cavities at', params.magnet.positions.length, 'positions');

    const { diameter, height: magnetHeight, depth } = params.magnet;

    for (const magnetPosition of params.magnet.positions) {
      // Apply to base mesh
      if (result.baseMesh && result.baseMesh.attributes.position?.count > 0) {
        const newBaseMesh = await subtractMagnetCavityManifold(
          result.baseMesh,
          magnetPosition,
          diameter,
          magnetHeight,
          depth
        );
        if (newBaseMesh) {
          result.baseMesh.dispose();
          result.baseMesh = newBaseMesh;
        }
      }

      // Apply to color meshes (needed for STL single mesh mode)
      for (const [colorIndex, geometry] of result.colorMeshes) {
        if (geometry.attributes.position?.count > 0) {
          const newGeometry = await subtractMagnetCavityManifold(
            geometry,
            magnetPosition,
            diameter,
            magnetHeight,
            depth
          );
          if (newGeometry) {
            geometry.dispose();
            result.colorMeshes.set(colorIndex, newGeometry);
          }
        }
      }
    }
  }

  return result;
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
