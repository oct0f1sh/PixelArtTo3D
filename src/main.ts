/**
 * Main Application Entry Point
 * Integrates all modules: image processing, mesh generation, 3D preview, and export
 */

import './style.css';
import * as THREE from 'three';
import { loadImage, quantizeColors, removeBackground, resizeImage, getOptimalDimensions, resizePixelArt } from './imageProcessor';
import { initPreview, type PreviewController } from './preview';
import { generateMeshes, rotateForPrinting, type MeshResult } from './meshGenerator';
import { exportSTL, export3MF } from './exporter';
import type { QuantizedResult } from './types';

// ============================================================================
// State
// ============================================================================

interface AppState {
  originalFile: File | null;
  originalImageData: ImageData | null;
  quantizedResult: QuantizedResult | null;
  meshResult: MeshResult | null;
  previewController: PreviewController | null;

  // Settings
  unit: 'mm' | 'inches';
  setDimension: 'width' | 'height';
  dimensionValue: number;
  pixelHeight: number;
  baseEnabled: boolean;
  baseHeight: number;
  baseColor: string;
  colorMergeEnabled: boolean;
  colorMergeThreshold: number;
  keyholeEnabled: boolean;
  keyholePosition: 'top-left' | 'top-center' | 'top-right';
  exportFormat: 'stl' | '3mf';
  filename: string;

  // Background removal
  bgRemoveEnabled: boolean;
  bgColor: { r: number; g: number; b: number } | null;
  bgTolerance: number;
  eyedropperActive: boolean;
}

const state: AppState = {
  originalFile: null,
  originalImageData: null,
  quantizedResult: null,
  meshResult: null,
  previewController: null,

  unit: 'mm',
  setDimension: 'width',
  dimensionValue: 50,
  pixelHeight: 2,
  baseEnabled: true,
  baseHeight: 1,
  baseColor: '#000000',
  colorMergeEnabled: false,
  colorMergeThreshold: 1,
  keyholeEnabled: false,
  keyholePosition: 'top-center',
  exportFormat: '3mf',
  filename: 'pixel_art_keychain',

  // Background removal
  bgRemoveEnabled: false,
  bgColor: null,
  bgTolerance: 10,
  eyedropperActive: false,
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

  // Background removal
  bgRemoveToggle: document.getElementById('bg-remove-toggle') as HTMLInputElement,
  bgRemoveOptions: document.getElementById('bg-remove-options') as HTMLDivElement,
  bgColorPreview: document.getElementById('bg-color-preview') as HTMLDivElement,
  eyedropperBtn: document.getElementById('eyedropper-btn') as HTMLButtonElement,
  bgToleranceSlider: document.getElementById('bg-tolerance-slider') as HTMLInputElement,
  bgToleranceValue: document.getElementById('bg-tolerance-value') as HTMLSpanElement,

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
  baseToggle: document.getElementById('base-toggle') as HTMLInputElement,
  baseOptions: document.getElementById('base-options') as HTMLDivElement,
  baseHeightSlider: document.getElementById('base-height-slider') as HTMLInputElement,
  baseHeightValue: document.getElementById('base-height-value') as HTMLSpanElement,
  baseColorInput: document.getElementById('base-color-input') as HTMLInputElement,
  baseColorValue: document.getElementById('base-color-value') as HTMLSpanElement,

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
  colorMergeToggle: document.getElementById('color-merge-toggle') as HTMLInputElement,
  colorMergeOptions: document.getElementById('color-merge-options') as HTMLDivElement,
  colorMergeSlider: document.getElementById('color-merge-slider') as HTMLInputElement,
  colorMergeValue: document.getElementById('color-merge-value') as HTMLSpanElement,

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

  // Detect optimal dimensions (handles upscaled pixel art and large images)
  // Supports non-uniform scaling where X and Y may have different scale factors
  const { targetWidth, targetHeight, scaleX, scaleY, offsetX, offsetY } = getOptimalDimensions(state.originalImageData);

  let imageDataToProcess = state.originalImageData;
  const { width, height } = imageDataToProcess;

  // Downscale if needed
  if (targetWidth < width || targetHeight < height) {
    if (scaleX > 1 || scaleY > 1) {
      // Use pixel-art-aware resizing with grid offset and separate X/Y scales
      imageDataToProcess = resizePixelArt(imageDataToProcess, scaleX, scaleY, offsetX, offsetY);
      console.log(`Pixel art downscaled: ${width}x${height} -> ${imageDataToProcess.width}x${imageDataToProcess.height}` +
        ` (detected scaleX=${scaleX}, scaleY=${scaleY}, offset ${offsetX},${offsetY})`);
    } else {
      // Use standard resizing for non-pixel-art images
      const maxTargetDim = Math.max(targetWidth, targetHeight);
      imageDataToProcess = resizeImage(imageDataToProcess, maxTargetDim);
      console.log(`Image downscaled: ${width}x${height} -> ${imageDataToProcess.width}x${imageDataToProcess.height}`);
    }
  }

  // Apply background removal if enabled and a color is selected
  if (state.bgRemoveEnabled && state.bgColor) {
    imageDataToProcess = removeBackground(imageDataToProcess, {
      color: state.bgColor,
      tolerance: state.bgTolerance,
    });
  }

  // Extract colors from the processed image, optionally merging similar colors
  const threshold = state.colorMergeEnabled ? state.colorMergeThreshold : 0;
  state.quantizedResult = quantizeColors(imageDataToProcess, threshold);

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

  // Build palette HTML with base color first (if enabled), then extracted colors
  const baseSwatchHtml = state.baseEnabled ? `
    <div class="color-swatch">
      <div class="color-swatch-preview" style="background-color: ${state.baseColor}"></div>
      <div class="color-swatch-hex">${state.baseColor}</div>
      <div class="color-swatch-name">base</div>
    </div>
  ` : '';

  const colorSwatchesHtml = palette.map((color, index) => `
    <div class="color-swatch">
      <div class="color-swatch-preview" style="background-color: ${color.hex}"></div>
      <div class="color-swatch-hex">${color.hex}</div>
      <div class="color-swatch-name">color_${index + 1}</div>
    </div>
  `).join('');

  elements.colorPalette.innerHTML = baseSwatchHtml + colorSwatchesHtml;
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

  // Debug: log dimensions
  console.log(`3D Generation: pixelWidth=${pixelWidth}, pixelHeight=${pixelHeight}, pixelSize=${pixelSizeMm.toFixed(3)}mm`);
  console.log(`  Mesh dimensions: X=${(pixelWidth * pixelSizeMm).toFixed(2)}mm, Z=${(pixelHeight * pixelSizeMm).toFixed(2)}mm`);
  console.log(`  Aspect ratio: ${(pixelWidth / pixelHeight).toFixed(4)}`);

  // Generate meshes (pass 0 for baseHeight if base is disabled)
  state.meshResult = generateMeshes({
    pixelGrid: pixels,
    palette,
    pixelSize: pixelSizeMm,
    pixelHeight: toMm(state.pixelHeight, state.unit),
    baseHeight: state.baseEnabled ? toMm(state.baseHeight, state.unit) : 0,
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
  }

  // Always hide placeholder when showing 3D preview
  elements.canvasPlaceholder.style.display = 'none';

  // Create Three.js meshes from the result
  const meshes: THREE.Mesh[] = [];

  // Add base mesh with user-specified color
  if (state.meshResult.baseMesh && state.meshResult.baseMesh.attributes.position) {
    const baseMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(state.baseColor),
    });
    const baseMesh = new THREE.Mesh(state.meshResult.baseMesh, baseMaterial);
    meshes.push(baseMesh);
  }

  // Add colored meshes using MeshBasicMaterial for accurate colors
  for (const [colorIndex, geometry] of state.meshResult.colorMeshes) {
    const color = palette[colorIndex];
    if (color && geometry.attributes.position) {
      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(color.r / 255, color.g / 255, color.b / 255),
      });
      const mesh = new THREE.Mesh(geometry, material);
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

  // Clone and rotate geometries for export (model should lay flat on build plate)
  const rotatedGeometries: THREE.BufferGeometry[] = [];
  const rotatedColorGeometries = new Map<number, THREE.BufferGeometry>();
  let rotatedBaseMesh: THREE.BufferGeometry | null = null;

  // Clone and rotate base mesh if it exists
  if (state.meshResult.baseMesh && state.meshResult.baseMesh.attributes.position) {
    rotatedBaseMesh = state.meshResult.baseMesh.clone();
    rotateForPrinting(rotatedBaseMesh);
    rotatedGeometries.push(rotatedBaseMesh);
  }

  // Clone and rotate color meshes
  for (const [colorIndex, geometry] of state.meshResult.colorMeshes) {
    if (geometry.attributes.position) {
      const cloned = geometry.clone();
      rotateForPrinting(cloned);
      rotatedColorGeometries.set(colorIndex, cloned);
      rotatedGeometries.push(cloned);
    }
  }

  try {
    if (state.exportFormat === 'stl') {
      exportSTL(rotatedGeometries, filename);
      showStatus('STL file downloaded successfully!', 'success');

    } else {
      // 3MF export with base mesh and color layers
      await export3MF(
        rotatedColorGeometries,
        rotatedBaseMesh || new THREE.BufferGeometry(),
        state.quantizedResult.palette,
        filename
      );
      showStatus('3MF file downloaded successfully!', 'success');
    }
  } catch (error) {
    console.error('Export failed:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    showStatus(`Export failed: ${message}`, 'error');
  } finally {
    // Clean up cloned geometries
    rotatedGeometries.forEach(g => g.dispose());
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

    // Reset background removal
    state.bgColor = null;
    state.eyedropperActive = false;
    elements.eyedropperBtn.classList.remove('active');
    elements.imagePreview.classList.remove('eyedropper-mode');
    elements.bgColorPreview.style.backgroundColor = '';
    elements.bgColorPreview.classList.remove('has-color');
  });

  // Background removal toggle
  elements.bgRemoveToggle.addEventListener('change', () => {
    state.bgRemoveEnabled = elements.bgRemoveToggle.checked;

    if (state.bgRemoveEnabled) {
      elements.bgRemoveOptions.classList.add('visible');
    } else {
      elements.bgRemoveOptions.classList.remove('visible');
      // Deactivate eyedropper when disabling
      state.eyedropperActive = false;
      elements.eyedropperBtn.classList.remove('active');
      elements.imagePreview.classList.remove('eyedropper-mode');
    }

    if (state.originalImageData && state.bgColor) {
      processImage();
    }
  });

  // Eyedropper button
  elements.eyedropperBtn.addEventListener('click', () => {
    state.eyedropperActive = !state.eyedropperActive;

    if (state.eyedropperActive) {
      elements.eyedropperBtn.classList.add('active');
      elements.imagePreview.classList.add('eyedropper-mode');
    } else {
      elements.eyedropperBtn.classList.remove('active');
      elements.imagePreview.classList.remove('eyedropper-mode');
    }
  });

  // Image click for eyedropper color picking
  elements.previewImage.addEventListener('click', (e) => {
    if (!state.eyedropperActive || !state.originalImageData) return;

    const img = elements.previewImage;
    const rect = img.getBoundingClientRect();

    // Calculate the position relative to the image
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Scale to actual image dimensions
    const scaleX = state.originalImageData.width / rect.width;
    const scaleY = state.originalImageData.height / rect.height;

    const pixelX = Math.floor(x * scaleX);
    const pixelY = Math.floor(y * scaleY);

    // Bounds check
    if (pixelX < 0 || pixelX >= state.originalImageData.width ||
        pixelY < 0 || pixelY >= state.originalImageData.height) {
      return;
    }

    // Get the color at this pixel
    const index = (pixelY * state.originalImageData.width + pixelX) * 4;
    const r = state.originalImageData.data[index];
    const g = state.originalImageData.data[index + 1];
    const b = state.originalImageData.data[index + 2];

    // Set the background color
    state.bgColor = { r, g, b };

    // Update UI
    const hexColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    elements.bgColorPreview.style.backgroundColor = hexColor;
    elements.bgColorPreview.classList.add('has-color');

    // Deactivate eyedropper after picking
    state.eyedropperActive = false;
    elements.eyedropperBtn.classList.remove('active');
    elements.imagePreview.classList.remove('eyedropper-mode');

    // Reprocess image if background removal is enabled
    if (state.bgRemoveEnabled) {
      processImage();
    }
  });

  // Background tolerance slider
  elements.bgToleranceSlider.addEventListener('input', () => {
    state.bgTolerance = parseInt(elements.bgToleranceSlider.value) || 10;
    elements.bgToleranceValue.textContent = state.bgTolerance.toString();
  });

  elements.bgToleranceSlider.addEventListener('change', () => {
    if (state.originalImageData && state.bgRemoveEnabled && state.bgColor) {
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

    const previousUnit = state.unit;
    state.unit = input.value as 'mm' | 'inches';
    elements.dimensionUnitLabel.textContent = state.unit;

    // Convert all dimension values between units
    if (previousUnit !== state.unit) {
      if (state.unit === 'inches') {
        // Converting from mm to inches
        state.dimensionValue = state.dimensionValue / MM_PER_INCH;
        state.pixelHeight = state.pixelHeight / MM_PER_INCH;
        state.baseHeight = state.baseHeight / MM_PER_INCH;
      } else {
        // Converting from inches to mm
        state.dimensionValue = state.dimensionValue * MM_PER_INCH;
        state.pixelHeight = state.pixelHeight * MM_PER_INCH;
        state.baseHeight = state.baseHeight * MM_PER_INCH;
      }
      // Round to reasonable precision
      state.dimensionValue = Math.round(state.dimensionValue * 100) / 100;
      state.pixelHeight = Math.round(state.pixelHeight * 1000) / 1000;
      state.baseHeight = Math.round(state.baseHeight * 1000) / 1000;

      // Update UI
      elements.dimensionInput.value = state.dimensionValue.toString();
      elements.pixelHeightSlider.value = state.pixelHeight.toString();
      elements.pixelHeightValue.textContent = state.pixelHeight.toFixed(state.unit === 'inches' ? 2 : 1);
      elements.baseHeightSlider.value = state.baseHeight.toString();
      elements.baseHeightValue.textContent = state.baseHeight.toFixed(state.unit === 'inches' ? 2 : 1);

      // Update slider ranges for the new unit
      if (state.unit === 'inches') {
        // Convert mm ranges to inches
        elements.pixelHeightSlider.min = (0.5 / MM_PER_INCH).toFixed(3);
        elements.pixelHeightSlider.max = (10 / MM_PER_INCH).toFixed(3);
        elements.pixelHeightSlider.step = '0.01';
        elements.baseHeightSlider.min = (0.5 / MM_PER_INCH).toFixed(3);
        elements.baseHeightSlider.max = (5 / MM_PER_INCH).toFixed(3);
        elements.baseHeightSlider.step = '0.01';
      } else {
        // Reset to mm ranges
        elements.pixelHeightSlider.min = '0.5';
        elements.pixelHeightSlider.max = '10';
        elements.pixelHeightSlider.step = '0.1';
        elements.baseHeightSlider.min = '0.5';
        elements.baseHeightSlider.max = '5';
        elements.baseHeightSlider.step = '0.1';
      }
    }

    updateDimensionsDisplay();

    // Update grid to match unit
    if (state.previewController) {
      state.previewController.setUnit(state.unit);
    }

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
    elements.pixelHeightValue.textContent = state.pixelHeight.toFixed(state.unit === 'inches' ? 2 : 1);
  });

  elements.pixelHeightSlider.addEventListener('change', () => {
    if (state.quantizedResult) {
      generateAndDisplay3D();
    }
  });

  // Base toggle
  elements.baseToggle.addEventListener('change', () => {
    state.baseEnabled = elements.baseToggle.checked;

    if (state.baseEnabled) {
      elements.baseOptions.classList.remove('hidden');
    } else {
      elements.baseOptions.classList.add('hidden');
    }

    if (state.quantizedResult) {
      updateColorPalette();
      generateAndDisplay3D();
    }
  });

  // Base height slider
  elements.baseHeightSlider.addEventListener('input', () => {
    state.baseHeight = parseFloat(elements.baseHeightSlider.value) || 1;
    elements.baseHeightValue.textContent = state.baseHeight.toFixed(state.unit === 'inches' ? 2 : 1);
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

  // Base color picker
  elements.baseColorInput.addEventListener('input', () => {
    state.baseColor = elements.baseColorInput.value;
    elements.baseColorValue.textContent = state.baseColor;

    if (state.quantizedResult) {
      updateColorPalette();
      generateAndDisplay3D();
    }
  });

  // Color merge toggle
  elements.colorMergeToggle.addEventListener('change', () => {
    state.colorMergeEnabled = elements.colorMergeToggle.checked;

    if (state.colorMergeEnabled) {
      elements.colorMergeOptions.classList.add('visible');
    } else {
      elements.colorMergeOptions.classList.remove('visible');
    }

    if (state.originalImageData) {
      processImage();
    }
  });

  // Color merge slider
  elements.colorMergeSlider.addEventListener('input', () => {
    state.colorMergeThreshold = parseInt(elements.colorMergeSlider.value) || 10;
    elements.colorMergeValue.textContent = `${state.colorMergeThreshold}%`;
  });

  elements.colorMergeSlider.addEventListener('change', () => {
    if (state.originalImageData && state.colorMergeEnabled) {
      processImage();
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
  elements.dimensionInput.value = state.dimensionValue.toString();
  elements.pixelHeightSlider.value = state.pixelHeight.toString();
  elements.pixelHeightValue.textContent = state.pixelHeight.toFixed(1);
  elements.baseHeightSlider.value = state.baseHeight.toString();
  elements.baseHeightValue.textContent = state.baseHeight.toFixed(1);
  elements.baseColorInput.value = state.baseColor;
  elements.filenameInput.value = state.filename;

  // Setup event listeners
  setupEventListeners();

  console.log('Pixel Art to 3D Converter initialized');
}

// Start the app
init();
