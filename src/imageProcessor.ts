/**
 * Image Processing Module for Pixel Art to 3D Converter
 *
 * Handles image loading, pixel extraction, color quantization,
 * and image resizing for pixel art processing.
 */

import type {
  Color,
  PixelGrid,
  QuantizedResult,
  RGBAPixel,
} from './types';

/** Threshold for considering a pixel transparent (alpha < 128) */
const TRANSPARENCY_THRESHOLD = 128;


/**
 * Converts RGB values to a hex string
 */
function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (value: number): string => {
    const hex = Math.round(value).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Creates a Color object from RGB values
 */
function createColor(r: number, g: number, b: number): Color {
  return {
    r: Math.round(r),
    g: Math.round(g),
    b: Math.round(b),
    hex: rgbToHex(r, g, b),
  };
}

/**
 * Loads an image from a File object and returns its ImageData
 *
 * @param file - The image file to load
 * @returns Promise resolving to the ImageData of the loaded image
 * @throws Error if the file cannot be loaded as an image
 */
export function loadImage(file: File): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas 2D context'));
        return;
      }

      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      resolve(imageData);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image file'));
    };

    img.src = url;
  });
}

/**
 * Resizes/downscales an ImageData to fit within a maximum dimension
 * while maintaining aspect ratio.
 *
 * @param imageData - The source ImageData to resize
 * @param maxDimension - The maximum width or height of the output
 * @returns A new ImageData with the resized image
 */
export function resizeImage(imageData: ImageData, maxDimension: number): ImageData {
  const { width, height } = imageData;

  // If already within bounds, return a copy of the original
  if (width <= maxDimension && height <= maxDimension) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get canvas 2D context');
    }
    ctx.putImageData(imageData, 0, 0);
    return ctx.getImageData(0, 0, width, height);
  }

  // Calculate new dimensions maintaining aspect ratio
  let newWidth: number;
  let newHeight: number;

  if (width > height) {
    newWidth = maxDimension;
    newHeight = Math.round((height / width) * maxDimension);
  } else {
    newHeight = maxDimension;
    newWidth = Math.round((width / height) * maxDimension);
  }

  // Ensure minimum dimensions of 1
  newWidth = Math.max(1, newWidth);
  newHeight = Math.max(1, newHeight);

  // Create source canvas with original image
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  const sourceCtx = sourceCanvas.getContext('2d');
  if (!sourceCtx) {
    throw new Error('Failed to get canvas 2D context');
  }
  sourceCtx.putImageData(imageData, 0, 0);

  // Create destination canvas with new size
  const destCanvas = document.createElement('canvas');
  destCanvas.width = newWidth;
  destCanvas.height = newHeight;
  const destCtx = destCanvas.getContext('2d');
  if (!destCtx) {
    throw new Error('Failed to get canvas 2D context');
  }

  // Use nearest-neighbor interpolation for pixel art
  destCtx.imageSmoothingEnabled = false;
  destCtx.drawImage(sourceCanvas, 0, 0, newWidth, newHeight);

  return destCtx.getImageData(0, 0, newWidth, newHeight);
}

/**
 * Extracts non-transparent pixels from ImageData
 *
 * @param imageData - The source ImageData
 * @returns Array of RGBAPixel objects for non-transparent pixels
 */
function extractOpaquePixels(imageData: ImageData): RGBAPixel[] {
  const { data, width, height } = imageData;
  const pixels: RGBAPixel[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const a = data[index + 3];

      // Skip transparent pixels (alpha < 128)
      if (a < TRANSPARENCY_THRESHOLD) {
        continue;
      }

      pixels.push({
        r: data[index],
        g: data[index + 1],
        b: data[index + 2],
        a,
        x,
        y,
      });
    }
  }

  return pixels;
}

/**
 * Extracts unique colors from pixels
 */
function extractUniqueColors(pixels: RGBAPixel[]): Color[] {
  const colorMap = new Map<string, { r: number; g: number; b: number; count: number }>();

  for (const pixel of pixels) {
    const key = `${pixel.r},${pixel.g},${pixel.b}`;
    const existing = colorMap.get(key);
    if (existing) {
      existing.count++;
    } else {
      colorMap.set(key, { r: pixel.r, g: pixel.g, b: pixel.b, count: 1 });
    }
  }

  // Convert to Color array, sorted by frequency (most common first)
  return Array.from(colorMap.values())
    .sort((a, b) => b.count - a.count)
    .map(c => createColor(c.r, c.g, c.b));
}

/**
 * Calculates the Euclidean distance between two colors
 */
function colorDistance(c1: Color, c2: Color): number {
  const dr = c1.r - c2.r;
  const dg = c1.g - c2.g;
  const db = c1.b - c2.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * Merges similar colors based on a similarity threshold.
 * Colors within the threshold distance are merged into a single color.
 *
 * @param colors - Array of unique colors
 * @param threshold - Similarity threshold (0-100). Higher = more aggressive merging.
 *                    0 = no merging, 100 = very aggressive merging
 * @returns Array of merged colors
 */
function mergeSimilarColors(colors: Color[], threshold: number): Color[] {
  if (colors.length === 0) return [];
  if (threshold === 0) return colors;

  // Convert threshold (0-100) to a color distance (0-441, max RGB distance)
  const maxDistance = Math.sqrt(255 * 255 * 3); // ~441
  const distanceThreshold = (threshold / 100) * maxDistance;

  const merged: Color[] = [];
  const used = new Set<number>();

  for (let i = 0; i < colors.length; i++) {
    if (used.has(i)) continue;

    const baseColor = colors[i];
    used.add(i);

    // Find all similar colors
    for (let j = i + 1; j < colors.length; j++) {
      if (used.has(j)) continue;

      const distance = colorDistance(baseColor, colors[j]);
      if (distance <= distanceThreshold) {
        used.add(j);
      }
    }

    // Use the most common color (first one) as the representative
    merged.push(baseColor);
  }

  return merged;
}

/**
 * Calculates the squared Euclidean distance between two colors
 */
function colorDistanceSquared(
  r1: number, g1: number, b1: number,
  r2: number, g2: number, b2: number
): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return dr * dr + dg * dg + db * db;
}

/**
 * Finds the index of the nearest color in the palette
 */
function findNearestColorIndex(r: number, g: number, b: number, palette: Color[]): number {
  let minDistance = Infinity;
  let nearestIndex = 0;

  for (let i = 0; i < palette.length; i++) {
    const color = palette[i];
    const distance = colorDistanceSquared(r, g, b, color.r, color.g, color.b);
    if (distance < minDistance) {
      minDistance = distance;
      nearestIndex = i;
    }
  }

  return nearestIndex;
}

/**
 * Extracts all unique colors from an ImageData, optionally merging similar colors.
 *
 * @param imageData - The source ImageData to process
 * @param similarityThreshold - Optional threshold (0-100) for merging similar colors.
 *                              0 = no merging (default), higher = more aggressive merging
 * @returns QuantizedResult containing the palette and pixel grid
 */
export function quantizeColors(
  imageData: ImageData,
  similarityThreshold: number = 0
): QuantizedResult {
  const { data, width, height } = imageData;

  // Extract non-transparent pixels
  const opaquePixels = extractOpaquePixels(imageData);

  // Extract all unique colors sorted by frequency
  const uniqueColors = extractUniqueColors(opaquePixels);

  // Optionally merge similar colors
  const palette = similarityThreshold > 0
    ? mergeSimilarColors(uniqueColors, similarityThreshold)
    : uniqueColors;

  // Create pixel grid with color indices
  const pixels: PixelGrid = [];

  for (let y = 0; y < height; y++) {
    const row: number[] = [];
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const a = data[index + 3];

      // Mark transparent pixels with -1
      if (a < TRANSPARENCY_THRESHOLD) {
        row.push(-1);
      } else if (palette.length === 0) {
        // Edge case: no opaque pixels means empty palette
        row.push(-1);
      } else {
        // Find exact color in palette
        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];
        const colorIndex = findNearestColorIndex(r, g, b, palette);
        row.push(colorIndex);
      }
    }
    pixels.push(row);
  }

  return {
    palette,
    pixels,
    width,
    height,
  };
}
