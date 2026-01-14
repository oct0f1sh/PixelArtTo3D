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

/** Maximum dimension for processed images */
const MAX_PIXEL_DIMENSION = 256;

/**
 * Result of pixel scale detection including grid offset.
 * Supports non-uniform scaling where X and Y may have different scale factors.
 */
export interface PixelScaleResult {
  scale: number;    // Legacy: use scaleX for backward compatibility
  scaleX: number;   // Scale factor for X axis (horizontal)
  scaleY: number;   // Scale factor for Y axis (vertical)
  offsetX: number;
  offsetY: number;
}

/**
 * Detects the scale factor and grid offset of upscaled pixel art.
 * Uses block variance minimization - the correct scale has uniform blocks.
 *
 * @param imageData - The image to analyze
 * @returns The detected scale factors and grid offsets
 */
export function detectPixelScaleAndOffset(imageData: ImageData): PixelScaleResult {
  const { data, width, height } = imageData;

  // Test a range of candidate scales
  const minScale = 10;
  const maxScale = Math.min(30, Math.floor(Math.min(width, height) / 20));

  /**
   * Check if a pixel is part of the background (near-white)
   */
  const isBackground = (idx: number): boolean => {
    return data[idx] > 230 && data[idx + 1] > 230 && data[idx + 2] > 230;
  };

  /**
   * Measures block uniformity for given X and Y scales and offsets.
   * For correctly aligned pixel art, block interiors should have low variance.
   * Returns average variance across all non-background blocks.
   */
  const measureBlockVariance = (
    scaleX: number,
    scaleY: number,
    offsetX: number,
    offsetY: number
  ): number => {
    let totalVariance = 0;
    let blockCount = 0;

    // Margin to avoid JPEG edge artifacts within each block
    const marginX = Math.max(2, Math.floor(scaleX * 0.15));
    const marginY = Math.max(2, Math.floor(scaleY * 0.15));

    const blocksX = Math.floor((width - offsetX) / scaleX);
    const blocksY = Math.floor((height - offsetY) / scaleY);

    // Sample blocks from the content area (not edges)
    const startBx = Math.floor(blocksX * 0.1);
    const endBx = Math.floor(blocksX * 0.9);
    const startBy = Math.floor(blocksY * 0.1);
    const endBy = Math.floor(blocksY * 0.9);

    for (let by = startBy; by < endBy; by++) {
      for (let bx = startBx; bx < endBx; bx++) {
        const blockStartX = offsetX + bx * scaleX;
        const blockStartY = offsetY + by * scaleY;

        // Check if block center is background
        const centerX = blockStartX + Math.floor(scaleX / 2);
        const centerY = blockStartY + Math.floor(scaleY / 2);
        const centerIdx = (centerY * width + centerX) * 4;
        if (isBackground(centerIdx)) continue;

        let sumR = 0, sumG = 0, sumB = 0;
        let sumR2 = 0, sumG2 = 0, sumB2 = 0;
        let n = 0;

        // Sample the interior of this block (avoid edges where JPEG artifacts occur)
        for (let py = marginY; py < scaleY - marginY; py++) {
          for (let px = marginX; px < scaleX - marginX; px++) {
            const x = blockStartX + px;
            const y = blockStartY + py;
            if (x >= width || y >= height) continue;

            const idx = (y * width + x) * 4;
            if (isBackground(idx)) continue;

            const r = data[idx], g = data[idx + 1], b = data[idx + 2];
            sumR += r; sumG += g; sumB += b;
            sumR2 += r * r; sumG2 += g * g; sumB2 += b * b;
            n++;
          }
        }

        if (n >= 4) {
          const meanR = sumR / n, meanG = sumG / n, meanB = sumB / n;
          const varR = sumR2 / n - meanR * meanR;
          const varG = sumG2 / n - meanG * meanG;
          const varB = sumB2 / n - meanB * meanB;
          totalVariance += varR + varG + varB;
          blockCount++;
        }
      }
    }

    return blockCount > 0 ? totalVariance / blockCount : Infinity;
  };

  /**
   * Find the scale with minimum block variance.
   * Uses integer scaling for consistent pixel art alignment.
   */
  let bestScale = minScale;
  let bestVariance = Infinity;
  let bestOffsetX = 0;
  let bestOffsetY = 0;

  console.log(`Searching scales ${minScale}-${maxScale}...`);

  for (let scale = minScale; scale <= maxScale; scale++) {
    // For each scale, search for best offset
    let bestVarForScale = Infinity;
    let bestOxForScale = 0;
    let bestOyForScale = 0;

    // Coarse search first
    const step = Math.max(1, Math.floor(scale / 4));
    for (let ox = 0; ox < scale; ox += step) {
      for (let oy = 0; oy < scale; oy += step) {
        const variance = measureBlockVariance(scale, scale, ox, oy);
        if (variance < bestVarForScale) {
          bestVarForScale = variance;
          bestOxForScale = ox;
          bestOyForScale = oy;
        }
      }
    }

    // Fine-tune around best coarse offset
    for (let ox = Math.max(0, bestOxForScale - step); ox <= Math.min(scale - 1, bestOxForScale + step); ox++) {
      for (let oy = Math.max(0, bestOyForScale - step); oy <= Math.min(scale - 1, bestOyForScale + step); oy++) {
        const variance = measureBlockVariance(scale, scale, ox, oy);
        if (variance < bestVarForScale) {
          bestVarForScale = variance;
          bestOxForScale = ox;
          bestOyForScale = oy;
        }
      }
    }

    console.log(`  Scale ${scale}: variance=${bestVarForScale.toFixed(1)}, offset=(${bestOxForScale}, ${bestOyForScale})`);

    if (bestVarForScale < bestVariance) {
      bestVariance = bestVarForScale;
      bestScale = scale;
      bestOffsetX = bestOxForScale;
      bestOffsetY = bestOyForScale;
    }
  }

  console.log(`Best: scale=${bestScale}, variance=${bestVariance.toFixed(1)}, offset=(${bestOffsetX}, ${bestOffsetY})`);

  const scaleX = bestScale;
  const scaleY = bestScale;

  // Log detection results
  console.log(`Scale detection: scale=${bestScale}, offset=(${bestOffsetX}, ${bestOffsetY})`);
  console.log(`  Output dimensions: ${Math.floor((width - bestOffsetX) / scaleX)}x${Math.floor((height - bestOffsetY) / scaleY)}`);

  return {
    scale: bestScale,
    scaleX,
    scaleY,
    offsetX: bestOffsetX,
    offsetY: bestOffsetY,
  };
}

/**
 * Detects the scale factor of upscaled pixel art (simple version without offset).
 * @param imageData - The image to analyze
 * @returns The detected scale factor (1 if no scaling detected)
 */
export function detectPixelScale(imageData: ImageData): number {
  return detectPixelScaleAndOffset(imageData).scale;
}

/**
 * Calculates the optimal dimensions for processing an image.
 * Detects if the image is upscaled pixel art and returns native dimensions,
 * or caps at MAX_PIXEL_DIMENSION for non-pixel-art images.
 *
 * @param imageData - The image to analyze
 * @returns Object with target width, height, detected scale, and grid offset
 */
export function getOptimalDimensions(imageData: ImageData): {
  targetWidth: number;
  targetHeight: number;
  detectedScale: number;
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
} {
  const { width, height } = imageData;

  // Detect if this is upscaled pixel art (including grid offset)
  const { scaleX, scaleY, offsetX, offsetY } = detectPixelScaleAndOffset(imageData);

  let targetWidth = width;
  let targetHeight = height;

  if (scaleX > 1 || scaleY > 1) {
    // Downscale to native pixel art dimensions accounting for offset
    targetWidth = Math.floor((width - offsetX) / scaleX);
    targetHeight = Math.floor((height - offsetY) / scaleY);

    // Ensure minimum dimensions
    targetWidth = Math.max(8, targetWidth);
    targetHeight = Math.max(8, targetHeight);
  }

  // If still too large, cap at max dimension
  if (targetWidth > MAX_PIXEL_DIMENSION || targetHeight > MAX_PIXEL_DIMENSION) {
    const maxDim = Math.max(targetWidth, targetHeight);
    const scaleFactor = MAX_PIXEL_DIMENSION / maxDim;
    targetWidth = Math.round(targetWidth * scaleFactor);
    targetHeight = Math.round(targetHeight * scaleFactor);
  }

  return { targetWidth, targetHeight, detectedScale: scaleX, scaleX, scaleY, offsetX, offsetY };
}

/**
 * Downscales pixel art using detected scale factors.
 * Uses center pixel color from each block to handle JPEG artifacts.
 *
 * @param imageData - The source image
 * @param scaleX - The detected scale factor for X axis
 * @param scaleYOrOffsetX - Either scaleY (new) or offsetX (old signature)
 * @param offsetXOrOffsetY - Either offsetX (new) or offsetY (old signature)
 * @param offsetY - offsetY for new signature
 * @returns Downscaled ImageData
 */
export function resizePixelArt(
  imageData: ImageData,
  scaleX: number,
  scaleYOrOffsetX: number,
  offsetXOrOffsetY?: number,
  offsetY?: number
): ImageData {
  // Handle both old (scale, offsetX, offsetY) and new (scaleX, scaleY, offsetX, offsetY) signatures
  let scaleY: number;
  let offX: number;
  let offY: number;

  if (offsetY !== undefined) {
    // New signature: resizePixelArt(imageData, scaleX, scaleY, offsetX, offsetY)
    scaleY = scaleYOrOffsetX;
    offX = offsetXOrOffsetY!;
    offY = offsetY;
  } else {
    // Old signature: resizePixelArt(imageData, scale, offsetX, offsetY)
    scaleY = scaleX;
    offX = scaleYOrOffsetX;
    offY = offsetXOrOffsetY!;
  }

  const { data, width, height } = imageData;

  // Calculate output dimensions
  const outWidth = Math.floor((width - offX) / scaleX);
  const outHeight = Math.floor((height - offY) / scaleY);

  // Create output canvas
  const canvas = document.createElement('canvas');
  canvas.width = outWidth;
  canvas.height = outHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas 2D context');
  }

  const outData = ctx.createImageData(outWidth, outHeight);

  /**
   * Extract the color from a block using mode-based sampling.
   * Samples multiple points in the block interior and returns the most common color.
   * This avoids JPEG artifacts which create spurious intermediate colors.
   */
  const extractBlockColor = (blockX: number, blockY: number): [number, number, number, number] => {
    // Sample a grid of points within the block (avoiding edges where JPEG artifacts occur)
    const margin = Math.max(1, Math.floor(Math.min(scaleX, scaleY) * 0.15));
    const samples: Array<[number, number, number, number]> = [];

    // Sample interior points
    const sampleStep = Math.max(1, Math.floor(Math.min(scaleX, scaleY) / 4));
    for (let dy = margin; dy < scaleY - margin; dy += sampleStep) {
      for (let dx = margin; dx < scaleX - margin; dx += sampleStep) {
        const x = Math.min(blockX + dx, width - 1);
        const y = Math.min(blockY + dy, height - 1);
        const idx = (y * width + x) * 4;
        samples.push([data[idx], data[idx + 1], data[idx + 2], data[idx + 3]]);
      }
    }

    // If no interior samples (small scale), fall back to center
    if (samples.length === 0) {
      const cx = Math.min(blockX + Math.floor(scaleX / 2), width - 1);
      const cy = Math.min(blockY + Math.floor(scaleY / 2), height - 1);
      const idx = (cy * width + cx) * 4;
      return [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];
    }

    // Find the most common color (mode) by binning similar colors
    // Group colors that are within tolerance of each other
    const colorBins: Array<{ color: [number, number, number, number]; count: number }> = [];
    const tolerance = 30; // Colors within this distance are considered the same

    for (const sample of samples) {
      // Find existing bin for this color
      let foundBin = false;
      for (const bin of colorBins) {
        const dr = sample[0] - bin.color[0];
        const dg = sample[1] - bin.color[1];
        const db = sample[2] - bin.color[2];
        const dist = Math.sqrt(dr * dr + dg * dg + db * db);
        if (dist < tolerance) {
          bin.count++;
          foundBin = true;
          break;
        }
      }
      if (!foundBin) {
        colorBins.push({ color: sample, count: 1 });
      }
    }

    // Return the color from the most common bin
    let bestBin = colorBins[0];
    for (const bin of colorBins) {
      if (bin.count > bestBin.count) {
        bestBin = bin;
      }
    }

    return bestBin.color;
  };

  // Process each output pixel
  for (let outY = 0; outY < outHeight; outY++) {
    for (let outX = 0; outX < outWidth; outX++) {
      const blockX = offX + outX * scaleX;
      const blockY = offY + outY * scaleY;

      const [r, g, b, a] = extractBlockColor(blockX, blockY);

      const outIndex = (outY * outWidth + outX) * 4;
      outData.data[outIndex] = r;
      outData.data[outIndex + 1] = g;
      outData.data[outIndex + 2] = b;
      outData.data[outIndex + 3] = a;
    }
  }

  ctx.putImageData(outData, 0, 0);
  return ctx.getImageData(0, 0, outWidth, outHeight);
}

/**
 * Options for background removal
 */
export interface BackgroundRemovalOptions {
  color: { r: number; g: number; b: number };
  tolerance: number; // 0-50, percentage of max color distance
}

/**
 * Removes background color from the edges of an image using scanline flood-fill.
 * Only removes the specified color when it's connected to the image border,
 * preserving that same color if it appears in the interior of the image.
 *
 * Uses an optimized scanline algorithm for better performance on large images.
 *
 * @param imageData - The source ImageData to process
 * @param options - Background removal options (color and tolerance)
 * @returns A new ImageData with background pixels made transparent
 */
export function removeBackground(
  imageData: ImageData,
  options: BackgroundRemovalOptions
): ImageData {
  const { width, height, data } = imageData;
  const { color, tolerance } = options;

  // Create a copy of the image data
  const newData = new Uint8ClampedArray(data);

  // Convert tolerance (0-50) to a squared distance threshold
  // Max RGB distance squared = 255^2 * 3 = 195075
  const maxDistanceSquared = 255 * 255 * 3;
  const toleranceDistanceSquared = (tolerance / 100) * maxDistanceSquared;

  // Track which pixels have been visited
  const visited = new Uint8Array(width * height);

  // Check if a pixel matches the background color within tolerance
  const isBackgroundColor = (pixelIndex: number): boolean => {
    const dataIndex = pixelIndex * 4;
    const a = data[dataIndex + 3];

    // Already transparent pixels are not background
    if (a < TRANSPARENCY_THRESHOLD) {
      return false;
    }

    const r = data[dataIndex];
    const g = data[dataIndex + 1];
    const b = data[dataIndex + 2];

    const dr = r - color.r;
    const dg = g - color.g;
    const db = b - color.b;
    const distanceSquared = dr * dr + dg * dg + db * db;

    return distanceSquared <= toleranceDistanceSquared;
  };

  // Scanline flood fill - much faster for large areas
  const scanlineFill = (startX: number, startY: number): void => {
    const startPixelIndex = startY * width + startX;

    // Check if starting point is valid
    if (visited[startPixelIndex] || !isBackgroundColor(startPixelIndex)) {
      return;
    }

    // Stack stores [x, y]
    const stack: Array<[number, number]> = [[startX, startY]];

    while (stack.length > 0) {
      const [x, y] = stack.pop()!;

      // Find the leftmost pixel in this scanline that matches
      let leftX = x;
      while (leftX > 0) {
        const leftPixelIndex = y * width + (leftX - 1);
        if (visited[leftPixelIndex] || !isBackgroundColor(leftPixelIndex)) {
          break;
        }
        leftX--;
      }

      // Scan right from leftX, marking pixels and checking rows above/below
      let currentX = leftX;
      let aboveAdded = false;
      let belowAdded = false;

      while (currentX < width) {
        const pixelIndex = y * width + currentX;

        if (visited[pixelIndex] || !isBackgroundColor(pixelIndex)) {
          break;
        }

        // Mark as visited and make transparent
        visited[pixelIndex] = 1;
        newData[pixelIndex * 4 + 3] = 0;

        // Check pixel above
        if (y > 0) {
          const abovePixelIndex = (y - 1) * width + currentX;
          if (!visited[abovePixelIndex] && isBackgroundColor(abovePixelIndex)) {
            if (!aboveAdded) {
              stack.push([currentX, y - 1]);
              aboveAdded = true;
            }
          } else {
            aboveAdded = false;
          }
        }

        // Check pixel below
        if (y < height - 1) {
          const belowPixelIndex = (y + 1) * width + currentX;
          if (!visited[belowPixelIndex] && isBackgroundColor(belowPixelIndex)) {
            if (!belowAdded) {
              stack.push([currentX, y + 1]);
              belowAdded = true;
            }
          } else {
            belowAdded = false;
          }
        }

        currentX++;
      }
    }
  };

  // Start flood fill from all edge pixels
  // Top and bottom edges
  for (let x = 0; x < width; x++) {
    scanlineFill(x, 0);
    scanlineFill(x, height - 1);
  }

  // Left and right edges
  for (let y = 0; y < height; y++) {
    scanlineFill(0, y);
    scanlineFill(width - 1, y);
  }

  // Create new ImageData with the modified data
  return new ImageData(newData, width, height);
}


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
