import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export interface PreviewController {
  updateMesh(meshes: THREE.Mesh[]): void;
  dispose(): void;
  resetCamera(): void;
  setUnit(unit: 'mm' | 'inches'): void;
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

  return {
    updateMesh,
    dispose,
    resetCamera,
    setUnit,
  };
}
