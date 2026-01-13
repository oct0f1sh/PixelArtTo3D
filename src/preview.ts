import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export interface PreviewController {
  updateMesh(meshes: THREE.Mesh[]): void;
  dispose(): void;
  resetCamera(): void;
}

const BACKGROUND_COLOR = 0x1a1a1a;
const BASE_COLOR = 0x808080;
const DEFAULT_CAMERA_POSITION = new THREE.Vector3(10, 10, 10);

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

  // Base plate (will be sized based on mesh data)
  let basePlate: THREE.Mesh | null = null;

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

    // Remove old base plate
    if (basePlate) {
      scene.remove(basePlate);
      basePlate.geometry.dispose();
      if (Array.isArray(basePlate.material)) {
        basePlate.material.forEach((m) => m.dispose());
      } else {
        basePlate.material.dispose();
      }
      basePlate = null;
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

    // Create base plate beneath the pixels
    const size = new THREE.Vector3();
    boundingBox.getSize(size);
    const center = new THREE.Vector3();
    boundingBox.getCenter(center);

    const baseGeometry = new THREE.BoxGeometry(
      size.x + 2,
      0.2,
      size.z + 2
    );
    const baseMaterial = new THREE.MeshStandardMaterial({
      color: BASE_COLOR,
      roughness: 0.8,
      metalness: 0.2,
    });
    basePlate = new THREE.Mesh(baseGeometry, baseMaterial);
    basePlate.position.set(center.x, boundingBox.min.y - 0.1, center.z);
    scene.add(basePlate);

    // Center the mesh group
    meshGroup.position.set(-center.x, -boundingBox.min.y, -center.z);
    if (basePlate) {
      basePlate.position.set(0, -0.1, 0);
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

    // Dispose base plate
    if (basePlate) {
      scene.remove(basePlate);
      basePlate.geometry.dispose();
      if (Array.isArray(basePlate.material)) {
        basePlate.material.forEach((m) => m.dispose());
      } else {
        basePlate.material.dispose();
      }
      basePlate = null;
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
  };
}
