import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export interface KeyholePreviewConfig {
  type: 'holepunch' | 'floating';
  holeDiameter: number;
  innerDiameter: number;
  outerDiameter: number;
}

export interface MagnetPreviewConfig {
  diameter: number;
  height: number;
  depth: number;
}

export interface PreviewController {
  updateMesh(meshes: THREE.Mesh[]): void;
  dispose(): void;
  resetCamera(): void;
  setUnit(unit: 'mm' | 'inches'): void;
  enableKeyholePlacement(
    onPositionChange: (pos: { x: number; y: number }) => void,
    onDragEnd: () => void,
    config?: KeyholePreviewConfig
  ): void;
  disableKeyholePlacement(): void;
  updateKeyholeConfig(config: KeyholePreviewConfig): void;
  // Magnet placement
  enableMagnetPlacement(
    onMagnetAdded: (pos: { x: number; y: number }) => void,
    config?: MagnetPreviewConfig
  ): void;
  disableMagnetPlacement(): void;
  updateMagnetConfig(config: MagnetPreviewConfig): void;
  setMagnetPositions(positions: Array<{ x: number; y: number }>): void;
  clearMagnetIndicators(): void;
}

const BACKGROUND_COLOR = 0x1a1a1a;
const GRID_COLOR = 0x444444;
const DEFAULT_CAMERA_POSITION = new THREE.Vector3(50, 50, -50);

// Grid spacing: 10mm for metric (1cm), 25.4mm for imperial (1 inch)
const MM_GRID_SPACING = 10;
const INCH_GRID_SPACING = 25.4;

export function initPreview(container: HTMLElement): PreviewController {
  // Scene setup
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND_COLOR);

  // Camera setup
  const camera = new THREE.PerspectiveCamera(
    60,
    container.clientWidth / container.clientHeight,
    0.1,
    1000
  );
  camera.position.copy(DEFAULT_CAMERA_POSITION);
  camera.lookAt(0, 0, 0);

  // Renderer setup
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  // Use sRGB color space for correct color display
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  // OrbitControls setup
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.enablePan = true;
  controls.enableZoom = true;
  controls.enableRotate = true;
  controls.minDistance = 2;
  controls.maxDistance = 100;

  // Lighting setup
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(10, 20, 10);
  directionalLight.castShadow = true;
  scene.add(directionalLight);

  const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.3);
  directionalLight2.position.set(-10, 10, -10);
  scene.add(directionalLight2);

  // Group to hold pixel meshes
  const meshGroup = new THREE.Group();
  scene.add(meshGroup);

  // Grid helper (will be sized based on mesh data)
  let gridHelper: THREE.GridHelper | null = null;
  let currentUnit: 'mm' | 'inches' = 'mm';

  // Track current meshes for disposal
  const currentMeshes: THREE.Mesh[] = [];

  // Keyhole placement state
  let keyholePlacementEnabled = false;
  let keyholeOnPositionChange: ((pos: { x: number; y: number }) => void) | null = null;
  let keyholeOnDragEnd: (() => void) | null = null;
  let isDraggingKeyhole = false;
  let keyholeIndicator: THREE.Mesh | null = null;
  let keyholeConfig: KeyholePreviewConfig = {
    type: 'holepunch',
    holeDiameter: 4,
    innerDiameter: 4,
    outerDiameter: 8,
  };

  // Magnet placement state
  let magnetPlacementEnabled = false;
  let magnetOnMagnetAdded: ((pos: { x: number; y: number }) => void) | null = null;
  let magnetIndicators: THREE.Mesh[] = [];
  let magnetHoverIndicator: THREE.Mesh | null = null;
  let magnetConfig: MagnetPreviewConfig = {
    diameter: 8,
    height: 3,
    depth: 0.5,
  };

  const raycaster = new THREE.Raycaster();
  const mousePosition = new THREE.Vector2();

  // Track model bounds for keyhole placement
  let modelBounds: THREE.Box3 | null = null;
  let modelHeight = 10; // Will be updated when mesh loads

  // Animation loop
  let animationFrameId: number;
  let isDisposed = false;

  function animate() {
    if (isDisposed) return;
    animationFrameId = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  // Resize handler
  function handleResize() {
    if (isDisposed) return;
    const width = container.clientWidth;
    const height = container.clientHeight;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }

  window.addEventListener('resize', handleResize);

  // ResizeObserver for container size changes
  const resizeObserver = new ResizeObserver(handleResize);
  resizeObserver.observe(container);

  // Create or update the grid helper
  function updateGrid(boundingBox: THREE.Box3): void {
    // Remove old grid
    if (gridHelper) {
      scene.remove(gridHelper);
      gridHelper.dispose();
      gridHelper = null;
    }

    const size = new THREE.Vector3();
    boundingBox.getSize(size);

    // Calculate grid size to cover the model with some padding
    const gridSpacing = currentUnit === 'mm' ? MM_GRID_SPACING : INCH_GRID_SPACING;
    const maxSize = Math.max(size.x, size.z) + gridSpacing * 4;
    const gridSize = Math.ceil(maxSize / gridSpacing) * gridSpacing;
    const divisions = Math.ceil(gridSize / gridSpacing);

    // Create grid helper
    gridHelper = new THREE.GridHelper(gridSize, divisions, GRID_COLOR, GRID_COLOR);
    gridHelper.material.transparent = true;
    gridHelper.material.opacity = 0.5;
    scene.add(gridHelper);
  }

  // Create keyhole indicator mesh (wireframe cylinder or torus)
  function createKeyholeIndicator(): THREE.Mesh {
    const geometry = createIndicatorGeometry();
    const material = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      wireframe: true,
      transparent: true,
      opacity: 0.8,
    });
    const indicator = new THREE.Mesh(geometry, material);
    indicator.visible = false;
    scene.add(indicator);
    return indicator;
  }

  // Create geometry for the keyhole indicator based on current config
  function createIndicatorGeometry(): THREE.BufferGeometry {
    const height = modelHeight + 2;
    if (keyholeConfig.type === 'holepunch') {
      const radius = keyholeConfig.holeDiameter / 2;
      return new THREE.CylinderGeometry(radius, radius, height, 16);
    } else {
      // Floating torus
      const tubeRadius = (keyholeConfig.outerDiameter - keyholeConfig.innerDiameter) / 4;
      const torusRadius = (keyholeConfig.innerDiameter / 2) + tubeRadius;
      const geometry = new THREE.TorusGeometry(torusRadius, tubeRadius, 8, 16);
      geometry.rotateX(Math.PI / 2);
      return geometry;
    }
  }

  // Update keyhole indicator geometry when config changes
  function updateKeyholeIndicatorGeometry(): void {
    if (!keyholeIndicator) return;
    const oldGeometry = keyholeIndicator.geometry;
    keyholeIndicator.geometry = createIndicatorGeometry();
    oldGeometry.dispose();
  }

  // Create magnet indicator geometry (cylinder for the magnet cavity)
  function createMagnetIndicatorGeometry(): THREE.BufferGeometry {
    const radius = magnetConfig.diameter / 2;
    const height = magnetConfig.height;
    return new THREE.CylinderGeometry(radius, radius, height, 16);
  }

  // Create a magnet indicator mesh (always wireframe, renders through objects)
  function createMagnetIndicatorMesh(isHover: boolean): THREE.Mesh {
    const geometry = createMagnetIndicatorGeometry();
    const material = new THREE.MeshBasicMaterial({
      color: isHover ? 0xff8800 : 0xff6600, // Orange
      wireframe: true, // Always wireframe so it's visible through objects
      transparent: true,
      opacity: isHover ? 0.6 : 0.9,
      depthTest: false, // Render through other objects
    });
    const indicator = new THREE.Mesh(geometry, material);
    indicator.renderOrder = 999; // Render on top
    indicator.visible = false;
    scene.add(indicator);
    return indicator;
  }

  // Update magnet hover indicator geometry when config changes
  function updateMagnetIndicatorGeometry(): void {
    if (magnetHoverIndicator) {
      const oldGeometry = magnetHoverIndicator.geometry;
      magnetHoverIndicator.geometry = createMagnetIndicatorGeometry();
      oldGeometry.dispose();
    }
    // Update all placed magnet indicators
    magnetIndicators.forEach((indicator) => {
      const oldGeometry = indicator.geometry;
      indicator.geometry = createMagnetIndicatorGeometry();
      oldGeometry.dispose();
    });
  }

  // Position a magnet indicator at the correct Y position (based on depth)
  function positionMagnetIndicator(indicator: THREE.Mesh, worldX: number, worldZ: number): void {
    // Magnet is positioned from the back (y=depth to y=depth+height)
    // Center of cylinder should be at y = depth + height/2
    const centerY = magnetConfig.depth + magnetConfig.height / 2;
    indicator.position.set(worldX, centerY, worldZ);
  }

  // Update magnet hover indicator position based on mouse intersection
  function updateMagnetHoverPosition(event: MouseEvent): { x: number; y: number } | null {
    if (!modelBounds || currentMeshes.length === 0) return null;

    // Calculate mouse position in normalized device coordinates
    const rect = renderer.domElement.getBoundingClientRect();
    mousePosition.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mousePosition.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Update raycaster
    raycaster.setFromCamera(mousePosition, camera);

    // Check intersection with all meshes
    const intersects = raycaster.intersectObjects(currentMeshes, false);

    if (intersects.length > 0) {
      const intersection = intersects[0];

      // Get the intersection point in world coordinates
      const worldPoint = intersection.point.clone();

      // Account for mesh group offset to get original model coordinates
      const modelPoint = worldPoint.clone().sub(meshGroup.position);

      // Update hover indicator position
      if (magnetHoverIndicator) {
        positionMagnetIndicator(magnetHoverIndicator, worldPoint.x, worldPoint.z);
        magnetHoverIndicator.visible = true;
      }

      // Return position in mm (X and Z in model space, Z maps to Y for 2D position)
      return {
        x: modelPoint.x,
        y: -modelPoint.z, // Negate because Z axis is inverted in 3D view
      };
    }

    // Hide indicator if no intersection
    if (magnetHoverIndicator) {
      magnetHoverIndicator.visible = false;
    }

    return null;
  }

  // Add a placed magnet indicator at the given position
  function addPlacedMagnetIndicator(position: { x: number; y: number }): void {
    const indicator = createMagnetIndicatorMesh(false);
    // Convert 2D position to 3D world coordinates
    // Account for mesh group offset
    const worldX = position.x + meshGroup.position.x;
    const worldZ = -position.y + meshGroup.position.z; // Negate Y for Z
    positionMagnetIndicator(indicator, worldX, worldZ);
    indicator.visible = true;
    magnetIndicators.push(indicator);
  }

  // Clear all placed magnet indicators
  function clearAllMagnetIndicators(): void {
    magnetIndicators.forEach((indicator) => {
      scene.remove(indicator);
      indicator.geometry.dispose();
      (indicator.material as THREE.Material).dispose();
    });
    magnetIndicators = [];
  }

  // Update keyhole indicator position based on mouse intersection
  function updateKeyholeIndicatorPosition(event: MouseEvent): { x: number; y: number } | null {
    if (!modelBounds || currentMeshes.length === 0) return null;

    // Calculate mouse position in normalized device coordinates
    const rect = renderer.domElement.getBoundingClientRect();
    mousePosition.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mousePosition.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Update raycaster
    raycaster.setFromCamera(mousePosition, camera);

    // Check intersection with all meshes
    const intersects = raycaster.intersectObjects(currentMeshes, false);

    if (intersects.length > 0) {
      const intersection = intersects[0];

      // Get the intersection point in world coordinates
      const worldPoint = intersection.point.clone();

      // Account for mesh group offset to get original model coordinates
      const modelPoint = worldPoint.clone().sub(meshGroup.position);

      // Update indicator position (at model surface height)
      if (keyholeIndicator) {
        keyholeIndicator.position.set(worldPoint.x, worldPoint.y, worldPoint.z);
        keyholeIndicator.visible = true;
      }

      // Return position in mm (X and Z in model space, Z maps to Y for 2D position)
      return {
        x: modelPoint.x,
        y: -modelPoint.z, // Negate because Z axis is inverted in 3D view
      };
    }

    return null;
  }

  // Mouse event handlers for keyhole and magnet placement
  function handleMouseDown(event: MouseEvent): void {
    // Only respond to left mouse button
    if (event.button !== 0) return;

    // Magnet placement: click to add
    if (magnetPlacementEnabled) {
      const pos = updateMagnetHoverPosition(event);
      if (pos && magnetOnMagnetAdded) {
        magnetOnMagnetAdded(pos);
      }
      return;
    }

    // Keyhole placement: drag to position
    if (keyholePlacementEnabled) {
      const pos = updateKeyholeIndicatorPosition(event);
      if (pos) {
        isDraggingKeyhole = true;
        controls.enabled = false; // Disable orbit controls while dragging

        if (keyholeOnPositionChange) {
          keyholeOnPositionChange(pos);
        }
      }
    }
  }

  function handleMouseMove(event: MouseEvent): void {
    // Magnet placement: update hover indicator
    if (magnetPlacementEnabled) {
      updateMagnetHoverPosition(event);
      return;
    }

    // Keyhole placement: update position while dragging
    if (keyholePlacementEnabled) {
      const pos = updateKeyholeIndicatorPosition(event);

      if (isDraggingKeyhole && pos && keyholeOnPositionChange) {
        keyholeOnPositionChange(pos);
      }
    }
  }

  function handleMouseUp(): void {
    if (!keyholePlacementEnabled || !isDraggingKeyhole) return;

    isDraggingKeyhole = false;
    controls.enabled = true; // Re-enable orbit controls

    if (keyholeOnDragEnd) {
      keyholeOnDragEnd();
    }
  }

  // Add mouse event listeners
  renderer.domElement.addEventListener('mousedown', handleMouseDown);
  renderer.domElement.addEventListener('mousemove', handleMouseMove);
  renderer.domElement.addEventListener('mouseup', handleMouseUp);
  renderer.domElement.addEventListener('mouseleave', handleMouseUp);

  // Controller methods
  function updateMesh(meshes: THREE.Mesh[]): void {
    // Clear existing meshes
    currentMeshes.forEach((mesh) => {
      meshGroup.remove(mesh);
      mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((m) => m.dispose());
      } else {
        mesh.material.dispose();
      }
    });
    currentMeshes.length = 0;

    // Remove old grid
    if (gridHelper) {
      scene.remove(gridHelper);
      gridHelper.dispose();
      gridHelper = null;
    }

    if (meshes.length === 0) return;

    // Calculate bounding box for all meshes
    const boundingBox = new THREE.Box3();
    meshes.forEach((mesh) => {
      mesh.geometry.computeBoundingBox();
      const meshBox = mesh.geometry.boundingBox!.clone();
      meshBox.applyMatrix4(mesh.matrixWorld);
      boundingBox.union(meshBox);
    });

    // Add meshes to group
    meshes.forEach((mesh) => {
      meshGroup.add(mesh);
      currentMeshes.push(mesh);
    });

    // Get center and size for positioning
    const size = new THREE.Vector3();
    boundingBox.getSize(size);
    const center = new THREE.Vector3();
    boundingBox.getCenter(center);

    // Center the mesh group so it sits on the grid (Y=0)
    meshGroup.position.set(-center.x, -boundingBox.min.y, -center.z);

    // Store model bounds for keyhole placement
    modelBounds = boundingBox.clone();
    modelHeight = size.y;

    // Update keyhole indicator size if it exists
    if (keyholeIndicator) {
      updateKeyholeIndicatorGeometry();
    }

    // Create grid beneath the model
    updateGrid(boundingBox);
  }

  function setUnit(unit: 'mm' | 'inches'): void {
    if (currentUnit === unit) return;
    currentUnit = unit;

    // Recalculate grid if meshes are present
    if (currentMeshes.length > 0) {
      const boundingBox = new THREE.Box3();
      currentMeshes.forEach((mesh) => {
        mesh.geometry.computeBoundingBox();
        const meshBox = mesh.geometry.boundingBox!.clone();
        // Apply mesh world matrix and group position
        const worldMatrix = new THREE.Matrix4();
        worldMatrix.compose(
          new THREE.Vector3().addVectors(mesh.position, meshGroup.position),
          mesh.quaternion,
          mesh.scale
        );
        meshBox.applyMatrix4(worldMatrix);
        boundingBox.union(meshBox);
      });
      updateGrid(boundingBox);
    }
  }

  function resetCamera(): void {
    camera.position.copy(DEFAULT_CAMERA_POSITION);
    camera.lookAt(0, 0, 0);
    controls.reset();
    controls.target.set(0, 0, 0);
  }

  function dispose(): void {
    isDisposed = true;

    // Stop animation loop
    cancelAnimationFrame(animationFrameId);

    // Remove event listeners
    window.removeEventListener('resize', handleResize);
    resizeObserver.disconnect();

    // Remove mouse event listeners
    renderer.domElement.removeEventListener('mousedown', handleMouseDown);
    renderer.domElement.removeEventListener('mousemove', handleMouseMove);
    renderer.domElement.removeEventListener('mouseup', handleMouseUp);
    renderer.domElement.removeEventListener('mouseleave', handleMouseUp);

    // Dispose controls
    controls.dispose();

    // Clear meshes
    currentMeshes.forEach((mesh) => {
      meshGroup.remove(mesh);
      mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((m) => m.dispose());
      } else {
        mesh.material.dispose();
      }
    });
    currentMeshes.length = 0;

    // Dispose keyhole indicator
    if (keyholeIndicator) {
      scene.remove(keyholeIndicator);
      keyholeIndicator.geometry.dispose();
      (keyholeIndicator.material as THREE.Material).dispose();
      keyholeIndicator = null;
    }

    // Dispose magnet indicators
    clearAllMagnetIndicators();
    if (magnetHoverIndicator) {
      scene.remove(magnetHoverIndicator);
      magnetHoverIndicator.geometry.dispose();
      (magnetHoverIndicator.material as THREE.Material).dispose();
      magnetHoverIndicator = null;
    }

    // Dispose grid
    if (gridHelper) {
      scene.remove(gridHelper);
      gridHelper.dispose();
      gridHelper = null;
    }

    // Dispose renderer
    renderer.dispose();

    // Remove canvas from container
    if (renderer.domElement.parentNode === container) {
      container.removeChild(renderer.domElement);
    }
  }

  function enableKeyholePlacement(
    onPositionChange: (pos: { x: number; y: number }) => void,
    onDragEnd: () => void,
    config?: KeyholePreviewConfig
  ): void {
    keyholePlacementEnabled = true;
    keyholeOnPositionChange = onPositionChange;
    keyholeOnDragEnd = onDragEnd;

    // Update config if provided
    if (config) {
      keyholeConfig = config;
    }

    // Create indicator if not exists
    if (!keyholeIndicator) {
      keyholeIndicator = createKeyholeIndicator();
    } else {
      // Update geometry to match config
      updateKeyholeIndicatorGeometry();
    }

    // Change cursor to indicate placement mode
    renderer.domElement.style.cursor = 'crosshair';
  }

  function disableKeyholePlacement(): void {
    keyholePlacementEnabled = false;
    keyholeOnPositionChange = null;
    keyholeOnDragEnd = null;
    isDraggingKeyhole = false;
    controls.enabled = true;

    // Hide indicator
    if (keyholeIndicator) {
      keyholeIndicator.visible = false;
    }

    // Reset cursor
    renderer.domElement.style.cursor = '';
  }

  function updateKeyholeConfig(config: KeyholePreviewConfig): void {
    keyholeConfig = config;
    if (keyholeIndicator) {
      updateKeyholeIndicatorGeometry();
    }
  }

  // Magnet placement methods
  function enableMagnetPlacement(
    onMagnetAdded: (pos: { x: number; y: number }) => void,
    config?: MagnetPreviewConfig
  ): void {
    magnetPlacementEnabled = true;
    magnetOnMagnetAdded = onMagnetAdded;

    // Update config if provided
    if (config) {
      magnetConfig = config;
    }

    // Create hover indicator if not exists
    if (!magnetHoverIndicator) {
      magnetHoverIndicator = createMagnetIndicatorMesh(true);
    } else {
      // Update geometry to match config
      updateMagnetIndicatorGeometry();
    }

    // Change cursor to indicate placement mode
    renderer.domElement.style.cursor = 'crosshair';
  }

  function disableMagnetPlacement(): void {
    magnetPlacementEnabled = false;
    magnetOnMagnetAdded = null;

    // Hide hover indicator
    if (magnetHoverIndicator) {
      magnetHoverIndicator.visible = false;
    }

    // Reset cursor
    renderer.domElement.style.cursor = '';
  }

  function updateMagnetConfigMethod(config: MagnetPreviewConfig): void {
    magnetConfig = config;
    updateMagnetIndicatorGeometry();
  }

  function setMagnetPositions(positions: Array<{ x: number; y: number }>): void {
    // Clear existing placed indicators
    clearAllMagnetIndicators();

    // Create new indicators for each position
    positions.forEach((pos) => {
      addPlacedMagnetIndicator(pos);
    });
  }

  return {
    updateMesh,
    dispose,
    resetCamera,
    setUnit,
    enableKeyholePlacement,
    disableKeyholePlacement,
    updateKeyholeConfig,
    enableMagnetPlacement,
    disableMagnetPlacement,
    updateMagnetConfig: updateMagnetConfigMethod,
    setMagnetPositions,
    clearMagnetIndicators: clearAllMagnetIndicators,
  };
}
