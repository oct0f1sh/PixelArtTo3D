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
import type { QuantizedResult, PixelGrid } from './types';

/**
 * Calculates the bounding box of non-transparent pixels in the grid.
 * Returns the content dimensions (excluding transparent border).
 */
function getContentBounds(pixels: PixelGrid): { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } {
  const height = pixels.length;
  const width = pixels[0]?.length || 0;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[y][x] !== -1) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  // If no content found, return full dimensions
  if (maxX < 0) {
    return { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1, width, height };
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };
}

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

  // Pixel grid overlay
  pixelGridVisible: boolean;
  detectedScale: { scaleX: number; scaleY: number; offsetX: number; offsetY: number } | null;

  // Output preview
  outputGridVisible: boolean;
  processedImageData: ImageData | null;

  // Zoom and pan
  inputZoom: number;
  outputZoom: number;
  inputPan: { x: number; y: number };
  outputPan: { x: number; y: number };
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

  // Pixel grid overlay
  pixelGridVisible: false,
  detectedScale: null,

  // Output preview
  outputGridVisible: false,
  processedImageData: null,

  // Zoom and pan
  inputZoom: 1,
  outputZoom: 1,
  inputPan: { x: 0, y: 0 },
  outputPan: { x: 0, y: 0 },
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
  pixelGridToggle: document.getElementById('pixel-grid-toggle') as HTMLInputElement,
  pixelGridOverlay: document.getElementById('pixel-grid-overlay') as HTMLCanvasElement,

  // Output preview
  outputPreviewImage: document.getElementById('output-preview-image') as HTMLImageElement,
  outputDimensions: document.getElementById('output-dimensions') as HTMLSpanElement,
  outputGridToggle: document.getElementById('output-grid-toggle') as HTMLInputElement,
  outputGridOverlay: document.getElementById('output-grid-overlay') as HTMLCanvasElement,

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

/**
 * Converts ImageData to a data URL for displaying in an img element.
 */
function imageDataToDataURL(imageData: ImageData): string {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * Updates the image preview to show the given ImageData.
 */
function updateImagePreview(imageData: ImageData): void {
  const dataURL = imageDataToDataURL(imageData);
  elements.previewImage.src = dataURL;
}

/**
 * Creates an ImageData from a quantized result (palette + pixel grid).
 * This shows the image with merged colors applied.
 */
function quantizedResultToImageData(result: QuantizedResult): ImageData {
  const { palette, pixels, width, height } = result;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');

  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const colorIndex = pixels[y][x];
      const idx = (y * width + x) * 4;

      if (colorIndex === -1) {
        // Transparent pixel
        data[idx] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = 0;
      } else {
        const color = palette[colorIndex];
        data[idx] = color.r;
        data[idx + 1] = color.g;
        data[idx + 2] = color.b;
        data[idx + 3] = 255;
      }
    }
  }

  return imageData;
}

/**
 * Calculate the actual displayed size of an image with object-fit: contain.
 * Returns the rendered width and height within the container.
 */
function getContainedImageSize(
  img: HTMLImageElement,
  container: HTMLElement
): { width: number; height: number } {
  const containerWidth = container.clientWidth;
  const containerHeight = container.clientHeight;
  const imgNaturalWidth = img.naturalWidth;
  const imgNaturalHeight = img.naturalHeight;

  if (!imgNaturalWidth || !imgNaturalHeight) {
    return { width: containerWidth, height: containerHeight };
  }

  const containerAspect = containerWidth / containerHeight;
  const imageAspect = imgNaturalWidth / imgNaturalHeight;

  if (imageAspect > containerAspect) {
    // Image is wider relative to container, scale based on width
    return {
      width: containerWidth,
      height: containerWidth / imageAspect,
    };
  } else {
    // Image is taller relative to container, scale based on height
    return {
      width: containerHeight * imageAspect,
      height: containerHeight,
    };
  }
}

/**
 * Draws the pixel grid overlay based on detected scale.
 * Grid is drawn at screen resolution and stays sharp during zoom/pan.
 */
function updatePixelGridOverlay(): void {
  const canvas = elements.pixelGridOverlay;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  if (!state.pixelGridVisible || !state.detectedScale) {
    canvas.classList.remove('visible');
    return;
  }

  const img = elements.previewImage;
  const imgNaturalWidth = img.naturalWidth;
  const imgNaturalHeight = img.naturalHeight;

  // Wait for image to load
  if (!imgNaturalWidth || !imgNaturalHeight) {
    canvas.classList.remove('visible');
    return;
  }

  canvas.classList.add('visible');

  const container = img.parentElement;
  if (!container) return;

  const containerRect = container.getBoundingClientRect();

  // Set canvas to container size (screen resolution)
  canvas.width = containerRect.width;
  canvas.height = containerRect.height;
  canvas.style.transform = 'none';

  const { scaleX, scaleY, offsetX, offsetY } = state.detectedScale;

  // Get the actual displayed image size (accounting for object-fit: contain)
  const containedSize = getContainedImageSize(img, container);
  const baseDisplayWidth = containedSize.width;
  const baseDisplayHeight = containedSize.height;

  // Apply zoom
  const displayWidth = baseDisplayWidth * state.inputZoom;
  const displayHeight = baseDisplayHeight * state.inputZoom;

  // Calculate center position with pan offset
  const centerX = containerRect.width / 2 + state.inputPan.x;
  const centerY = containerRect.height / 2 + state.inputPan.y;

  // Image top-left corner
  const imgLeft = centerX - displayWidth / 2;
  const imgTop = centerY - displayHeight / 2;

  // Pixel size in screen coordinates
  const pixelScreenWidth = (scaleX / imgNaturalWidth) * displayWidth;
  const pixelScreenHeight = (scaleY / imgNaturalHeight) * displayHeight;

  // Offset in screen coordinates
  const screenOffsetX = (offsetX / imgNaturalWidth) * displayWidth;
  const screenOffsetY = (offsetY / imgNaturalHeight) * displayHeight;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(255, 0, 0, 0.6)';
  ctx.lineWidth = 1;

  // Draw vertical lines
  for (let x = screenOffsetX; x <= displayWidth + 0.5; x += pixelScreenWidth) {
    const screenX = imgLeft + x;
    if (screenX >= 0 && screenX <= containerRect.width) {
      ctx.beginPath();
      ctx.moveTo(screenX, Math.max(0, imgTop));
      ctx.lineTo(screenX, Math.min(containerRect.height, imgTop + displayHeight));
      ctx.stroke();
    }
  }

  // Draw horizontal lines
  for (let y = screenOffsetY; y <= displayHeight + 0.5; y += pixelScreenHeight) {
    const screenY = imgTop + y;
    if (screenY >= 0 && screenY <= containerRect.height) {
      ctx.beginPath();
      ctx.moveTo(Math.max(0, imgLeft), screenY);
      ctx.lineTo(Math.min(containerRect.width, imgLeft + displayWidth), screenY);
      ctx.stroke();
    }
  }
}

/**
 * Updates the output image preview to show the processed ImageData.
 */
function updateOutputPreview(imageData: ImageData): void {
  state.processedImageData = imageData;
  const dataURL = imageDataToDataURL(imageData);
  elements.outputPreviewImage.src = dataURL;
  elements.outputDimensions.textContent = `${imageData.width} x ${imageData.height} px`;
}

/**
 * Draws the pixel grid overlay for the output image (1 pixel = 1 cell).
 * Grid is drawn at screen resolution and stays sharp during zoom/pan.
 */
function updateOutputGridOverlay(): void {
  const canvas = elements.outputGridOverlay;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  if (!state.outputGridVisible) {
    canvas.classList.remove('visible');
    return;
  }

  const img = elements.outputPreviewImage;
  const imgNaturalWidth = img.naturalWidth;
  const imgNaturalHeight = img.naturalHeight;

  // Wait for image to load
  if (!imgNaturalWidth || !imgNaturalHeight) {
    canvas.classList.remove('visible');
    return;
  }

  canvas.classList.add('visible');

  const container = img.parentElement;
  if (!container) return;

  const containerRect = container.getBoundingClientRect();

  // Set canvas to container size (screen resolution)
  canvas.width = containerRect.width;
  canvas.height = containerRect.height;
  canvas.style.transform = 'none';

  // Get the actual displayed image size (accounting for object-fit: contain)
  const containedSize = getContainedImageSize(img, container);
  const baseDisplayWidth = containedSize.width;
  const baseDisplayHeight = containedSize.height;

  // Apply zoom
  const displayWidth = baseDisplayWidth * state.outputZoom;
  const displayHeight = baseDisplayHeight * state.outputZoom;

  // Calculate center position with pan offset
  const centerX = containerRect.width / 2 + state.outputPan.x;
  const centerY = containerRect.height / 2 + state.outputPan.y;

  // Image top-left corner
  const imgLeft = centerX - displayWidth / 2;
  const imgTop = centerY - displayHeight / 2;

  // Pixel size in screen coordinates (1 pixel = 1 cell for output)
  const pixelScreenWidth = displayWidth / imgNaturalWidth;
  const pixelScreenHeight = displayHeight / imgNaturalHeight;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(255, 0, 0, 0.6)';
  ctx.lineWidth = 1;

  // Draw vertical lines
  for (let i = 0; i <= imgNaturalWidth; i++) {
    const screenX = imgLeft + i * pixelScreenWidth;
    if (screenX >= 0 && screenX <= containerRect.width) {
      ctx.beginPath();
      ctx.moveTo(screenX, Math.max(0, imgTop));
      ctx.lineTo(screenX, Math.min(containerRect.height, imgTop + displayHeight));
      ctx.stroke();
    }
  }

  // Draw horizontal lines
  for (let i = 0; i <= imgNaturalHeight; i++) {
    const screenY = imgTop + i * pixelScreenHeight;
    if (screenY >= 0 && screenY <= containerRect.height) {
      ctx.beginPath();
      ctx.moveTo(Math.max(0, imgLeft), screenY);
      ctx.lineTo(Math.min(containerRect.width, imgLeft + displayWidth), screenY);
      ctx.stroke();
    }
  }
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
// Background Color Detection
// ============================================================================

/**
 * Guesses the background color by analyzing edge pixels of the image.
 * Samples colors from all four edges and finds the most common color.
 * Also checks corners for additional confidence.
 */
function guessBackgroundColor(imageData: ImageData): { r: number; g: number; b: number } | null {
  const { data, width, height } = imageData;

  // Helper to get pixel color at x, y
  function getPixel(x: number, y: number): { r: number; g: number; b: number; a: number } {
    const idx = (y * width + x) * 4;
    return {
      r: data[idx],
      g: data[idx + 1],
      b: data[idx + 2],
      a: data[idx + 3]
    };
  }

  // Helper to create a color key for counting
  function colorKey(r: number, g: number, b: number): string {
    // Quantize to reduce slight variations (group similar colors)
    const qr = Math.round(r / 8) * 8;
    const qg = Math.round(g / 8) * 8;
    const qb = Math.round(b / 8) * 8;
    return `${qr},${qg},${qb}`;
  }

  const colorCounts = new Map<string, { count: number; r: number; g: number; b: number }>();

  // Sample edge pixels
  const edgePixels: { x: number; y: number }[] = [];

  // Top and bottom edges
  for (let x = 0; x < width; x++) {
    edgePixels.push({ x, y: 0 });
    edgePixels.push({ x, y: height - 1 });
  }

  // Left and right edges (excluding corners already added)
  for (let y = 1; y < height - 1; y++) {
    edgePixels.push({ x: 0, y });
    edgePixels.push({ x: width - 1, y });
  }

  // Count colors from edge pixels
  for (const { x, y } of edgePixels) {
    const pixel = getPixel(x, y);

    // Skip fully transparent pixels
    if (pixel.a < 128) continue;

    const key = colorKey(pixel.r, pixel.g, pixel.b);
    const existing = colorCounts.get(key);

    if (existing) {
      existing.count++;
      // Average the actual colors for this bucket
      existing.r = Math.round((existing.r * (existing.count - 1) + pixel.r) / existing.count);
      existing.g = Math.round((existing.g * (existing.count - 1) + pixel.g) / existing.count);
      existing.b = Math.round((existing.b * (existing.count - 1) + pixel.b) / existing.count);
    } else {
      colorCounts.set(key, { count: 1, r: pixel.r, g: pixel.g, b: pixel.b });
    }
  }

  // Find the most common color
  let maxCount = 0;
  let bgColor: { r: number; g: number; b: number } | null = null;

  for (const [, value] of colorCounts) {
    if (value.count > maxCount) {
      maxCount = value.count;
      bgColor = { r: value.r, g: value.g, b: value.b };
    }
  }

  // Validate: check if corners mostly match this color
  if (bgColor) {
    const corners = [
      getPixel(0, 0),
      getPixel(width - 1, 0),
      getPixel(0, height - 1),
      getPixel(width - 1, height - 1)
    ];

    let matchingCorners = 0;
    const tolerance = 30;

    for (const corner of corners) {
      if (corner.a < 128) continue;
      const dr = Math.abs(corner.r - bgColor.r);
      const dg = Math.abs(corner.g - bgColor.g);
      const db = Math.abs(corner.b - bgColor.b);
      if (dr <= tolerance && dg <= tolerance && db <= tolerance) {
        matchingCorners++;
      }
    }

    // If less than 2 corners match, the guess might be wrong
    // but we still return it as our best guess
  }

  return bgColor;
}

/**
 * Updates the UI to show the guessed/selected background color
 */
function updateBgColorPreview(color: { r: number; g: number; b: number } | null): void {
  if (color) {
    const hex = `#${color.r.toString(16).padStart(2, '0')}${color.g.toString(16).padStart(2, '0')}${color.b.toString(16).padStart(2, '0')}`;
    elements.bgColorPreview.style.backgroundColor = hex;
    elements.bgColorPreview.classList.add('has-color');
  } else {
    elements.bgColorPreview.style.backgroundColor = '';
    elements.bgColorPreview.classList.remove('has-color');
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

    // Guess background color from edge pixels
    const guessedBgColor = guessBackgroundColor(state.originalImageData);
    if (guessedBgColor) {
      state.bgColor = guessedBgColor;
      updateBgColorPreview(guessedBgColor);
    }

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

  // Store detected scale for pixel grid overlay
  state.detectedScale = { scaleX, scaleY, offsetX, offsetY };

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
    // Update the image preview with background removed from ORIGINAL image (not downscaled)
    const previewImageData = removeBackground(state.originalImageData, {
      color: state.bgColor,
      tolerance: state.bgTolerance,
    });
    updateImagePreview(previewImageData);
  }

  // Extract colors from the processed image, optionally merging similar colors
  const threshold = state.colorMergeEnabled ? state.colorMergeThreshold : 0;
  state.quantizedResult = quantizeColors(imageDataToProcess, threshold);

  // Update output preview with the quantized image (shows merged colors)
  const quantizedImageData = quantizedResultToImageData(state.quantizedResult);
  updateOutputPreview(quantizedImageData);

  // Match output zoom to input zoom so both appear at same scale
  state.outputZoom = state.inputZoom;
  state.outputPan = { x: 0, y: 0 };
  elements.outputPreviewImage.style.transform = `translate(0px, 0px) scale(${state.outputZoom})`;

  // Update grid overlay if visible
  if (state.outputGridVisible) {
    requestAnimationFrame(() => updateOutputGridOverlay());
  }

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

  // Use content bounds (non-transparent pixels) for dimension calculations
  const contentBounds = getContentBounds(state.quantizedResult.pixels);
  const contentWidth = contentBounds.width;
  const contentHeight = contentBounds.height;
  const aspectRatio = contentWidth / contentHeight;

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

  const { pixels, palette } = state.quantizedResult;

  // Use content bounds (non-transparent pixels) for dimension calculations
  const contentBounds = getContentBounds(pixels);
  const contentWidth = contentBounds.width;
  const contentHeight = contentBounds.height;

  // Calculate pixel size in mm based on content dimensions
  const inputValueMm = toMm(state.dimensionValue, state.unit);
  let totalWidthMm: number;

  if (state.setDimension === 'width') {
    totalWidthMm = inputValueMm;
  } else {
    const aspectRatio = contentWidth / contentHeight;
    totalWidthMm = inputValueMm * aspectRatio;
  }

  const pixelSizeMm = totalWidthMm / contentWidth;

  // Debug: log dimensions
  console.log(`3D Generation: contentWidth=${contentWidth}, contentHeight=${contentHeight}, pixelSize=${pixelSizeMm.toFixed(3)}mm`);
  console.log(`  Content bounds: (${contentBounds.minX},${contentBounds.minY}) to (${contentBounds.maxX},${contentBounds.maxY})`);
  console.log(`  Mesh dimensions: X=${(contentWidth * pixelSizeMm).toFixed(2)}mm, Z=${(contentHeight * pixelSizeMm).toFixed(2)}mm`);
  console.log(`  Aspect ratio: ${(contentWidth / contentHeight).toFixed(4)}`);

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
    // Parse hex color and convert from sRGB to linear for correct rendering
    const baseColorObj = new THREE.Color();
    baseColorObj.setStyle(state.baseColor, THREE.SRGBColorSpace);
    const baseMaterial = new THREE.MeshBasicMaterial({
      color: baseColorObj,
    });
    const baseMesh = new THREE.Mesh(state.meshResult.baseMesh, baseMaterial);
    meshes.push(baseMesh);
  }

  // Add colored meshes using MeshBasicMaterial for accurate colors
  for (const [colorIndex, geometry] of state.meshResult.colorMeshes) {
    const color = palette[colorIndex];
    if (color && geometry.attributes.position) {
      // Use SRGBColorSpace to correctly interpret our sRGB color values
      const threeColor = new THREE.Color();
      threeColor.setRGB(color.r / 255, color.g / 255, color.b / 255, THREE.SRGBColorSpace);
      const material = new THREE.MeshBasicMaterial({
        color: threeColor,
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

  // Read filename directly from input to catch any pending changes
  const currentFilename = elements.filenameInput.value || 'pixel_art_keychain';
  state.filename = currentFilename;
  const filename = `${currentFilename}.${state.exportFormat}`;

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
    updateBgColorPreview(null);

    // Reset pixel grid
    state.detectedScale = null;
    state.pixelGridVisible = false;
    elements.pixelGridToggle.checked = false;
    elements.pixelGridOverlay.classList.remove('visible');

    // Reset output preview
    state.processedImageData = null;
    state.outputGridVisible = false;
    elements.outputGridToggle.checked = false;
    elements.outputGridOverlay.classList.remove('visible');
    elements.outputPreviewImage.src = '';
    elements.outputDimensions.textContent = '-- x -- px';

    // Reset zoom and pan
    state.inputZoom = 1;
    state.outputZoom = 1;
    state.inputPan = { x: 0, y: 0 };
    state.outputPan = { x: 0, y: 0 };
    elements.previewImage.style.transform = 'translate(0px, 0px) scale(1)';
    elements.outputPreviewImage.style.transform = 'translate(0px, 0px) scale(1)';
  });

  // Pixel grid toggle
  elements.pixelGridToggle.addEventListener('change', () => {
    state.pixelGridVisible = elements.pixelGridToggle.checked;
    updatePixelGridOverlay();
  });

  // Update pixel grid when image loads or resizes
  elements.previewImage.addEventListener('load', () => {
    if (state.pixelGridVisible) {
      requestAnimationFrame(() => updatePixelGridOverlay());
    }
  });

  // Output grid toggle
  elements.outputGridToggle.addEventListener('change', () => {
    state.outputGridVisible = elements.outputGridToggle.checked;
    updateOutputGridOverlay();
  });

  // Update output grid when image loads
  elements.outputPreviewImage.addEventListener('load', () => {
    if (state.outputGridVisible) {
      requestAnimationFrame(() => updateOutputGridOverlay());
    }
  });

  // Scroll to zoom on input image
  elements.previewImage.parentElement?.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    state.inputZoom = Math.max(0.5, Math.min(10, state.inputZoom * delta));
    elements.previewImage.style.transform = `translate(${state.inputPan.x}px, ${state.inputPan.y}px) scale(${state.inputZoom})`;
    if (state.pixelGridVisible) {
      requestAnimationFrame(() => updatePixelGridOverlay());
    }
  }, { passive: false });

  // Scroll to zoom on output image
  elements.outputPreviewImage.parentElement?.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    state.outputZoom = Math.max(0.5, Math.min(10, state.outputZoom * delta));
    elements.outputPreviewImage.style.transform = `translate(${state.outputPan.x}px, ${state.outputPan.y}px) scale(${state.outputZoom})`;
    if (state.outputGridVisible) {
      requestAnimationFrame(() => updateOutputGridOverlay());
    }
  }, { passive: false });

  // Drag to pan on input image
  let inputDragging = false;
  let inputDragStart = { x: 0, y: 0 };

  // Prevent native image dragging
  elements.previewImage.addEventListener('dragstart', (e) => e.preventDefault());
  elements.outputPreviewImage.addEventListener('dragstart', (e) => e.preventDefault());

  const inputContainer = elements.previewImage.parentElement;
  if (inputContainer) {
    inputContainer.addEventListener('mousedown', (e) => {
      // Don't start drag if eyedropper is active
      if (state.eyedropperActive) return;
      e.preventDefault(); // Prevent text selection and image drag
      inputDragging = true;
      inputDragStart = { x: e.clientX - state.inputPan.x, y: e.clientY - state.inputPan.y };
      inputContainer.style.cursor = 'grabbing';
    });

    inputContainer.addEventListener('mousemove', (e) => {
      if (!inputDragging) return;
      state.inputPan.x = e.clientX - inputDragStart.x;
      state.inputPan.y = e.clientY - inputDragStart.y;
      elements.previewImage.style.transform = `translate(${state.inputPan.x}px, ${state.inputPan.y}px) scale(${state.inputZoom})`;
      if (state.pixelGridVisible) {
        requestAnimationFrame(() => updatePixelGridOverlay());
      }
    });

    inputContainer.addEventListener('mouseup', () => {
      inputDragging = false;
      inputContainer.style.cursor = 'grab';
    });

    inputContainer.addEventListener('mouseleave', () => {
      inputDragging = false;
      inputContainer.style.cursor = 'grab';
    });

    // Set default cursor
    inputContainer.style.cursor = 'grab';
  }

  // Drag to pan on output image
  let outputDragging = false;
  let outputDragStart = { x: 0, y: 0 };

  const outputContainer = elements.outputPreviewImage.parentElement;
  if (outputContainer) {
    outputContainer.addEventListener('mousedown', (e) => {
      e.preventDefault(); // Prevent text selection and image drag
      outputDragging = true;
      outputDragStart = { x: e.clientX - state.outputPan.x, y: e.clientY - state.outputPan.y };
      outputContainer.style.cursor = 'grabbing';
    });

    outputContainer.addEventListener('mousemove', (e) => {
      if (!outputDragging) return;
      state.outputPan.x = e.clientX - outputDragStart.x;
      state.outputPan.y = e.clientY - outputDragStart.y;
      elements.outputPreviewImage.style.transform = `translate(${state.outputPan.x}px, ${state.outputPan.y}px) scale(${state.outputZoom})`;
      if (state.outputGridVisible) {
        requestAnimationFrame(() => updateOutputGridOverlay());
      }
    });

    outputContainer.addEventListener('mouseup', () => {
      outputDragging = false;
      outputContainer.style.cursor = 'grab';
    });

    outputContainer.addEventListener('mouseleave', () => {
      outputDragging = false;
      outputContainer.style.cursor = 'grab';
    });

    // Set default cursor
    outputContainer.style.cursor = 'grab';
  }

  // Background removal toggle
  const bgColorInline = elements.bgColorPreview.parentElement;

  // Set initial disabled state
  if (bgColorInline) {
    bgColorInline.classList.add('disabled');
  }

  elements.bgRemoveToggle.addEventListener('change', () => {
    state.bgRemoveEnabled = elements.bgRemoveToggle.checked;

    // Toggle color picker disabled state
    if (bgColorInline) {
      bgColorInline.classList.toggle('disabled', !state.bgRemoveEnabled);
    }

    if (state.bgRemoveEnabled) {
      elements.bgRemoveOptions.classList.add('visible');
    } else {
      elements.bgRemoveOptions.classList.remove('visible');
      // Deactivate eyedropper when disabling
      state.eyedropperActive = false;
      elements.eyedropperBtn.classList.remove('active');
      elements.imagePreview.classList.remove('eyedropper-mode');
      // Restore original image preview when background removal is disabled
      if (state.originalImageData) {
        updateImagePreview(state.originalImageData);
      }
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
    updateBgColorPreview(state.bgColor);

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

  // Setup collapsible panels
  setupCollapsiblePanels();

  console.log('Pixel Art to 3D Converter initialized');
}

// ============================================================================
// Collapsible Panels
// ============================================================================

function setupCollapsiblePanels(): void {
  const STORAGE_KEY = 'pixelart-panel-states';

  // Load saved states from localStorage
  function loadPanelStates(): Record<string, boolean> {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  }

  // Save states to localStorage
  function savePanelStates(states: Record<string, boolean>): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(states));
    } catch {
      // Ignore storage errors
    }
  }

  const savedStates = loadPanelStates();

  // Setup click handlers for all collapsible headers
  document.querySelectorAll('.panel-header[data-collapse]').forEach(header => {
    const contentId = (header as HTMLElement).dataset.collapse;
    if (!contentId) return;

    const content = document.getElementById(contentId);
    if (!content) return;

    // Restore saved state if available
    if (contentId in savedStates) {
      const isCollapsed = savedStates[contentId];
      header.classList.toggle('collapsed', isCollapsed);
      content.classList.toggle('collapsed', isCollapsed);
    }

    // Add click handler
    header.addEventListener('click', (e) => {
      // Don't toggle if clicking on badge or other interactive elements
      const target = e.target as HTMLElement;
      if (target.closest('.badge')) return;

      const isCollapsed = header.classList.toggle('collapsed');
      content.classList.toggle('collapsed', isCollapsed);

      // Save state
      const states = loadPanelStates();
      states[contentId] = isCollapsed;
      savePanelStates(states);
    });
  });
}

// Start the app
init();
