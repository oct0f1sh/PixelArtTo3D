/**
 * Main Application Entry Point
 * Integrates all modules: image processing, mesh generation, 3D preview, and export
 */

import './style.css';
import * as THREE from 'three';
import { loadImage, resizeImage, quantizeColors } from './imageProcessor';
import { initPreview, type PreviewController } from './preview';
import { generateMeshes, createColoredMesh, type MeshResult } from './meshGenerator';
import { exportSTL, export3MF } from './exporter';
import type { QuantizedResult } from './types';

// ============================================================================
// State
// ============================================================================

interface AppState {
  originalFile: File | null;
  originalImageData: ImageData | null;
  processedImageData: ImageData | null;
  quantizedResult: QuantizedResult | null;
  meshResult: MeshResult | null;
  previewController: PreviewController | null;

  // Settings
  maxDimension: number;
  colorCount: number;
  unit: 'mm' | 'inches';
  setDimension: 'width' | 'height';
  dimensionValue: number;
  pixelHeight: number;
  baseHeight: number;
  keyholeEnabled: boolean;
  keyholePosition: 'top-left' | 'top-center' | 'top-right';
  exportFormat: 'stl' | '3mf';
  filename: string;
}

const state: AppState = {
  originalFile: null,
  originalImageData: null,
  processedImageData: null,
  quantizedResult: null,
  meshResult: null,
  previewController: null,

  maxDimension: 32,
  colorCount: 8,
  unit: 'mm',
  setDimension: 'width',
  dimensionValue: 50,
  pixelHeight: 2,
  baseHeight: 1,
  keyholeEnabled: false,
  keyholePosition: 'top-center',
  exportFormat: 'stl',
  filename: 'pixel_art_keychain',
};

// Conversion factor: 1 inch = 25.4mm
const MM_PER_INCH = 25.4;

// ============================================================================
// DOM Elements
// ============================================================================

const elements = {
  // Image input
  dropZone: document.getElementById('drop-zone') as HTMLDivElement,
  fileInput: document.getElementById('file-input') as HTMLInputElement,
  imagePreview: document.getElementById('image-preview') as HTMLDivElement,
  previewImage: document.getElementById('preview-image') as HTMLImageElement,
  imageDimensions: document.getElementById('image-dimensions') as HTMLSpanElement,
  imageFilename: document.getElementById('image-filename') as HTMLSpanElement,
  clearImageBtn: document.getElementById('clear-image-btn') as HTMLButtonElement,

  // Resize settings
  resizeInput: document.getElementById('resize-input') as HTMLInputElement,
  colorCountSlider: document.getElementById('color-count-slider') as HTMLInputElement,
  colorCountValue: document.getElementById('color-count-value') as HTMLSpanElement,

  // Physical dimensions
  unitToggle: document.getElementById('unit-toggle') as HTMLDivElement,
  dimensionToggle: document.getElementById('dimension-toggle') as HTMLDivElement,
  dimensionInput: document.getElementById('dimension-input') as HTMLInputElement,
  dimensionInputLabel: document.getElementById('dimension-input-label') as HTMLSpanElement,
  dimensionUnitLabel: document.getElementById('dimension-unit-label') as HTMLSpanElement,
  outputWidth: document.getElementById('output-width') as HTMLDivElement,
  outputHeight: document.getElementById('output-height') as HTMLDivElement,

  // Height settings
  pixelHeightSlider: document.getElementById('pixel-height-slider') as HTMLInputElement,
  pixelHeightValue: document.getElementById('pixel-height-value') as HTMLSpanElement,
  baseHeightSlider: document.getElementById('base-height-slider') as HTMLInputElement,
  baseHeightValue: document.getElementById('base-height-value') as HTMLSpanElement,

  // Keyhole settings
  keyholeToggle: document.getElementById('keyhole-toggle') as HTMLInputElement,
  keyholeOptions: document.getElementById('keyhole-options') as HTMLDivElement,
  keyholePosition: document.getElementById('keyhole-position') as HTMLSelectElement,

  // Preview
  previewContainer: document.getElementById('preview-container') as HTMLDivElement,
  canvasPlaceholder: document.getElementById('canvas-placeholder') as HTMLDivElement,
  resetViewBtn: document.getElementById('reset-view-btn') as HTMLButtonElement,

  // Color palette
  colorPalette: document.getElementById('color-palette') as HTMLDivElement,
  paletteCount: document.getElementById('palette-count') as HTMLSpanElement,

  // Export
  formatToggle: document.getElementById('format-toggle') as HTMLDivElement,
  formatHint: document.getElementById('format-hint') as HTMLParagraphElement,
  filenameInput: document.getElementById('filename-input') as HTMLInputElement,
  fileExtension: document.getElementById('file-extension') as HTMLSpanElement,
  exportStatus: document.getElementById('export-status') as HTMLDivElement,
  downloadBtn: document.getElementById('download-btn') as HTMLButtonElement,
};

// ============================================================================
// Utility Functions
// ============================================================================

function toMm(value: number, unit: 'mm' | 'inches'): number {
  return unit === 'inches' ? value * MM_PER_INCH : value;
}

function fromMm(value: number, unit: 'mm' | 'inches'): number {
  return unit === 'inches' ? value / MM_PER_INCH : value;
}

function formatDimension(valueMm: number, unit: 'mm' | 'inches'): string {
  const value = fromMm(valueMm, unit);
  return unit === 'inches' ? value.toFixed(2) : value.toFixed(1);
}

function showStatus(message: string, type: 'success' | 'error'): void {
  elements.exportStatus.textContent = message;
  elements.exportStatus.className = `status-message visible ${type}`;

  if (type === 'success') {
    setTimeout(() => {
      elements.exportStatus.className = 'status-message';
    }, 3000);
  }
}


// ============================================================================
// Image Processing
// ============================================================================

async function handleImageFile(file: File): Promise<void> {
  try {
    // Store original file and load image data
    state.originalFile = file;
    state.originalImageData = await loadImage(file);

    // Update UI
    const url = URL.createObjectURL(file);
    elements.previewImage.src = url;
    elements.previewImage.onload = () => URL.revokeObjectURL(url);

    elements.imageDimensions.textContent = `${state.originalImageData.width} x ${state.originalImageData.height} px`;
    elements.imageFilename.textContent = file.name;

    // Update default filename
    const baseName = file.name.replace(/\.[^/.]+$/, '');
    state.filename = `${baseName}_keychain`;
    elements.filenameInput.value = state.filename;

    // Show preview, hide drop zone
    elements.dropZone.style.display = 'none';
    elements.imagePreview.classList.add('visible');

    // Process the image
    await processImage();

  } catch (error) {
    console.error('Failed to load image:', error);
    showStatus('Failed to load image. Please try another file.', 'error');
  }
}

async function processImage(): Promise<void> {
  if (!state.originalImageData) return;

  // Resize image
  state.processedImageData = resizeImage(state.originalImageData, state.maxDimension);

  // Quantize colors
  state.quantizedResult = quantizeColors(state.processedImageData, state.colorCount);

  // Update color palette display
  updateColorPalette();

  // Update dimensions display
  updateDimensionsDisplay();

  // Generate and display 3D mesh
  await generateAndDisplay3D();

  // Enable download button
  elements.downloadBtn.disabled = false;
}

function updateColorPalette(): void {
  if (!state.quantizedResult) return;

  const { palette } = state.quantizedResult;

  elements.paletteCount.textContent = `${palette.length} colors`;

  if (palette.length === 0) {
    elements.colorPalette.innerHTML = `
      <div class="color-palette-empty">
        No colors extracted. The image may be fully transparent.
      </div>
    `;
    return;
  }

  elements.colorPalette.innerHTML = palette.map((color, index) => `
    <div class="color-swatch">
      <div class="color-swatch-preview" style="background-color: ${color.hex}"></div>
      <div class="color-swatch-hex">${color.hex}</div>
      <div class="color-swatch-name">color_${index + 1}</div>
    </div>
  `).join('');
}

function updateDimensionsDisplay(): void {
  if (!state.quantizedResult) {
    elements.outputWidth.textContent = '--';
    elements.outputHeight.textContent = '--';
    return;
  }

  const { width: pixelWidth, height: pixelHeight } = state.quantizedResult;
  const aspectRatio = pixelWidth / pixelHeight;

  const inputValueMm = toMm(state.dimensionValue, state.unit);

  let widthMm: number;
  let heightMm: number;

  if (state.setDimension === 'width') {
    widthMm = inputValueMm;
    heightMm = inputValueMm / aspectRatio;
  } else {
    heightMm = inputValueMm;
    widthMm = inputValueMm * aspectRatio;
  }

  elements.outputWidth.textContent = formatDimension(widthMm, state.unit);
  elements.outputHeight.textContent = formatDimension(heightMm, state.unit);

  // Update unit labels
  const unitLabel = state.unit;
  document.querySelectorAll('.output-unit').forEach(el => {
    el.textContent = unitLabel;
  });
  document.querySelectorAll('.height-unit').forEach(el => {
    el.textContent = unitLabel;
  });
}

// ============================================================================
// 3D Generation and Preview
// ============================================================================

async function generateAndDisplay3D(): Promise<void> {
  if (!state.quantizedResult) return;

  const { pixels, palette, width: pixelWidth, height: pixelHeight } = state.quantizedResult;

  // Calculate pixel size in mm
  const inputValueMm = toMm(state.dimensionValue, state.unit);
  let totalWidthMm: number;

  if (state.setDimension === 'width') {
    totalWidthMm = inputValueMm;
  } else {
    const aspectRatio = pixelWidth / pixelHeight;
    totalWidthMm = inputValueMm * aspectRatio;
  }

  const pixelSizeMm = totalWidthMm / pixelWidth;

  // Generate meshes
  state.meshResult = generateMeshes({
    pixelGrid: pixels,
    palette,
    pixelSize: pixelSizeMm,
    pixelHeight: toMm(state.pixelHeight, state.unit),
    baseHeight: toMm(state.baseHeight, state.unit),
    keyhole: {
      enabled: state.keyholeEnabled,
      position: state.keyholePosition,
    },
  });

  // Initialize preview if needed
  if (!state.previewController) {
    // Remove existing canvas content
    const existingCanvas = elements.previewContainer.querySelector('canvas');
    if (existingCanvas) {
      existingCanvas.remove();
    }

    state.previewController = initPreview(elements.previewContainer);
    elements.canvasPlaceholder.style.display = 'none';
  }

  // Create Three.js meshes from the result
  const meshes: THREE.Mesh[] = [];

  // Add base mesh
  if (state.meshResult.baseMesh.attributes.position) {
    const baseMaterial = new THREE.MeshStandardMaterial({
      color: 0x808080,
      roughness: 0.8,
      metalness: 0.1,
    });
    const baseMesh = new THREE.Mesh(state.meshResult.baseMesh, baseMaterial);
    meshes.push(baseMesh);
  }

  // Add colored meshes
  for (const [colorIndex, geometry] of state.meshResult.colorMeshes) {
    const color = palette[colorIndex];
    if (color && geometry.attributes.position) {
      const mesh = createColoredMesh(geometry, color);
      meshes.push(mesh);
    }
  }

  // Update preview
  state.previewController.updateMesh(meshes);
}

// ============================================================================
// Export Functions
// ============================================================================

async function handleExport(): Promise<void> {
  if (!state.meshResult || !state.quantizedResult) {
    showStatus('No model to export. Please upload an image first.', 'error');
    return;
  }

  const filename = `${state.filename}.${state.exportFormat}`;

  try {
    if (state.exportFormat === 'stl') {
      // Collect all geometries for STL
      const geometries: THREE.BufferGeometry[] = [];

      if (state.meshResult.baseMesh.attributes.position) {
        geometries.push(state.meshResult.baseMesh);
      }

      for (const geometry of state.meshResult.colorMeshes.values()) {
        if (geometry.attributes.position) {
          geometries.push(geometry);
        }
      }

      exportSTL(geometries, filename);
      showStatus('STL file downloaded successfully!', 'success');

    } else {
      // 3MF export
      await export3MF(
        state.meshResult.colorMeshes,
        state.meshResult.baseMesh,
        state.quantizedResult.palette,
        filename
      );
      showStatus('3MF file downloaded successfully!', 'success');
    }
  } catch (error) {
    console.error('Export failed:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    showStatus(`Export failed: ${message}`, 'error');
  }
}

// ============================================================================
// Event Handlers
// ============================================================================

function setupEventListeners(): void {
  // Drop zone events
  elements.dropZone.addEventListener('click', () => elements.fileInput.click());

  elements.dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    elements.dropZone.classList.add('drag-over');
  });

  elements.dropZone.addEventListener('dragleave', () => {
    elements.dropZone.classList.remove('drag-over');
  });

  elements.dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    elements.dropZone.classList.remove('drag-over');

    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      handleImageFile(files[0]);
    }
  });

  elements.fileInput.addEventListener('change', () => {
    const files = elements.fileInput.files;
    if (files && files.length > 0) {
      handleImageFile(files[0]);
    }
  });

  // Clear image button
  elements.clearImageBtn.addEventListener('click', () => {
    state.originalFile = null;
    state.originalImageData = null;
    state.processedImageData = null;
    state.quantizedResult = null;
    state.meshResult = null;

    elements.dropZone.style.display = 'block';
    elements.imagePreview.classList.remove('visible');
    elements.downloadBtn.disabled = true;

    // Reset preview
    if (state.previewController) {
      state.previewController.updateMesh([]);
      elements.canvasPlaceholder.style.display = 'flex';
    }

    // Reset palette
    elements.colorPalette.innerHTML = `
      <div class="color-palette-empty">
        No colors extracted yet. Upload an image to see the palette.
      </div>
    `;
    elements.paletteCount.textContent = '0 colors';

    // Reset dimensions
    elements.outputWidth.textContent = '--';
    elements.outputHeight.textContent = '--';

    // Reset file input
    elements.fileInput.value = '';
  });

  // Resize input
  elements.resizeInput.addEventListener('change', () => {
    state.maxDimension = parseInt(elements.resizeInput.value) || 32;
    if (state.originalImageData) {
      processImage();
    }
  });

  // Color count slider
  elements.colorCountSlider.addEventListener('input', () => {
    state.colorCount = parseInt(elements.colorCountSlider.value) || 8;
    elements.colorCountValue.textContent = state.colorCount.toString();
  });

  elements.colorCountSlider.addEventListener('change', () => {
    if (state.originalImageData) {
      processImage();
    }
  });

  // Unit toggle
  elements.unitToggle.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const label = target.closest('.toggle-option');
    if (!label) return;

    const input = label.querySelector('input') as HTMLInputElement;
    if (!input) return;

    // Update active state
    elements.unitToggle.querySelectorAll('.toggle-option').forEach(opt => {
      opt.classList.remove('active');
    });
    label.classList.add('active');

    state.unit = input.value as 'mm' | 'inches';
    elements.dimensionUnitLabel.textContent = state.unit;

    updateDimensionsDisplay();

    if (state.quantizedResult) {
      generateAndDisplay3D();
    }
  });

  // Dimension toggle (width/height)
  elements.dimensionToggle.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const label = target.closest('.toggle-option');
    if (!label) return;

    const input = label.querySelector('input') as HTMLInputElement;
    if (!input) return;

    // Update active state
    elements.dimensionToggle.querySelectorAll('.toggle-option').forEach(opt => {
      opt.classList.remove('active');
    });
    label.classList.add('active');

    state.setDimension = input.value as 'width' | 'height';
    elements.dimensionInputLabel.textContent = state.setDimension === 'width' ? 'Width' : 'Height';

    updateDimensionsDisplay();

    if (state.quantizedResult) {
      generateAndDisplay3D();
    }
  });

  // Dimension input
  elements.dimensionInput.addEventListener('change', () => {
    state.dimensionValue = parseFloat(elements.dimensionInput.value) || 50;
    updateDimensionsDisplay();

    if (state.quantizedResult) {
      generateAndDisplay3D();
    }
  });

  // Pixel height slider
  elements.pixelHeightSlider.addEventListener('input', () => {
    state.pixelHeight = parseFloat(elements.pixelHeightSlider.value) || 2;
    elements.pixelHeightValue.textContent = state.pixelHeight.toFixed(1);
  });

  elements.pixelHeightSlider.addEventListener('change', () => {
    if (state.quantizedResult) {
      generateAndDisplay3D();
    }
  });

  // Base height slider
  elements.baseHeightSlider.addEventListener('input', () => {
    state.baseHeight = parseFloat(elements.baseHeightSlider.value) || 1;
    elements.baseHeightValue.textContent = state.baseHeight.toFixed(1);
  });

  elements.baseHeightSlider.addEventListener('change', () => {
    if (state.quantizedResult) {
      generateAndDisplay3D();
    }
  });

  // Keyhole toggle
  elements.keyholeToggle.addEventListener('change', () => {
    state.keyholeEnabled = elements.keyholeToggle.checked;

    if (state.keyholeEnabled) {
      elements.keyholeOptions.classList.add('visible');
    } else {
      elements.keyholeOptions.classList.remove('visible');
    }

    if (state.quantizedResult) {
      generateAndDisplay3D();
    }
  });

  // Keyhole position
  elements.keyholePosition.addEventListener('change', () => {
    state.keyholePosition = elements.keyholePosition.value as 'top-left' | 'top-center' | 'top-right';

    if (state.quantizedResult && state.keyholeEnabled) {
      generateAndDisplay3D();
    }
  });

  // Reset view button
  elements.resetViewBtn.addEventListener('click', () => {
    if (state.previewController) {
      state.previewController.resetCamera();
    }
  });

  // Export format toggle
  elements.formatToggle.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const label = target.closest('.toggle-option');
    if (!label) return;

    const input = label.querySelector('input') as HTMLInputElement;
    if (!input) return;

    // Update active state
    elements.formatToggle.querySelectorAll('.toggle-option').forEach(opt => {
      opt.classList.remove('active');
    });
    label.classList.add('active');

    state.exportFormat = input.value as 'stl' | '3mf';
    elements.fileExtension.textContent = `.${state.exportFormat}`;

    // Update hint
    if (state.exportFormat === 'stl') {
      elements.formatHint.textContent = 'Single color mesh, widely compatible';
    } else {
      elements.formatHint.textContent = 'Multi-color with separate objects per color';
    }
  });

  // Filename input
  elements.filenameInput.addEventListener('change', () => {
    state.filename = elements.filenameInput.value || 'pixel_art_keychain';
  });

  // Download button
  elements.downloadBtn.addEventListener('click', handleExport);
}

// ============================================================================
// Initialization
// ============================================================================

function init(): void {
  // Set initial values from state
  elements.resizeInput.value = state.maxDimension.toString();
  elements.colorCountSlider.value = state.colorCount.toString();
  elements.colorCountValue.textContent = state.colorCount.toString();
  elements.dimensionInput.value = state.dimensionValue.toString();
  elements.pixelHeightSlider.value = state.pixelHeight.toString();
  elements.pixelHeightValue.textContent = state.pixelHeight.toFixed(1);
  elements.baseHeightSlider.value = state.baseHeight.toString();
  elements.baseHeightValue.textContent = state.baseHeight.toFixed(1);
  elements.filenameInput.value = state.filename;

  // Setup event listeners
  setupEventListeners();

  console.log('Pixel Art to 3D Converter initialized');
}

// Start the app
init();
