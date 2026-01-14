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
 * Result of pixel scale detection including grid offset
 */
export interface PixelScaleResult {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Detects the scale factor and grid offset of upscaled pixel art.
 * Uses interior block uniformity to handle JPEG compression artifacts.
 * JPEG artifacts concentrate at edges, so we sample from block interiors.
 *
 * @param imageData - The image to analyze
 * @returns The detected scale factor and grid offset
 */
export function detectPixelScaleAndOffset(imageData: ImageData): PixelScaleResult {
  const { data, width, height } = imageData;

  /**
   * Measures the uniformity of block interiors for a given scale and offset.
   * Higher uniformity (lower variance) indicates correct alignment.
   * Only samples the inner portion of each block to avoid JPEG edge artifacts.
   */
  const measureInteriorUniformity = (scale: number, offX: number, offY: number): number => {
    // Interior margin: skip outer 25% on each side to avoid JPEG edge artifacts
    const margin = Math.max(1, Math.floor(scale * 0.25));
    const innerSize = scale - 2 * margin;

    if (innerSize < 2) {
      // Scale too small for interior sampling, fall back to center sampling
      return measureCenterUniformity(scale, offX, offY);
    }

    let totalVariance = 0;
    let blockCount = 0;

    // Sample a grid of blocks ACROSS THE WHOLE IMAGE (not just top-left)
    const totalBlocksX = Math.floor((width - offX) / scale);
    const totalBlocksY = Math.floor((height - offY) / scale);
    const sampleCount = 15; // Sample ~15x15 blocks spread across image
    const stepX = Math.max(1, Math.floor(totalBlocksX / sampleCount));
    const stepY = Math.max(1, Math.floor(totalBlocksY / sampleCount));

    for (let by = 0; by < totalBlocksY; by += stepY) {
      for (let bx = 0; bx < totalBlocksX; bx += stepX) {
        const blockX = offX + bx * scale;
        const blockY = offY + by * scale;

        if (blockX + scale > width || blockY + scale > height) continue;

        // Sample only interior pixels (avoiding edges where JPEG artifacts are worst)
        let sumR = 0, sumG = 0, sumB = 0;
        let sumR2 = 0, sumG2 = 0, sumB2 = 0;
        let pixelCount = 0;

        for (let py = margin; py < scale - margin; py++) {
          for (let px = margin; px < scale - margin; px++) {
            const idx = ((blockY + py) * width + (blockX + px)) * 4;
            const r = data[idx], g = data[idx + 1], b = data[idx + 2];
            sumR += r; sumG += g; sumB += b;
            sumR2 += r * r; sumG2 += g * g; sumB2 += b * b;
            pixelCount++;
          }
        }

        if (pixelCount > 0) {
          const meanR = sumR / pixelCount;
          const meanG = sumG / pixelCount;
          const meanB = sumB / pixelCount;

          // Skip background blocks (near-white) - they have zero variance at any scale
          // and would dominate the uniformity calculation
          if (meanR > 230 && meanG > 230 && meanB > 230) {
            continue;
          }

          // Variance = E[X^2] - E[X]^2
          const varR = (sumR2 / pixelCount) - meanR * meanR;
          const varG = (sumG2 / pixelCount) - meanG * meanG;
          const varB = (sumB2 / pixelCount) - meanB * meanB;
          totalVariance += varR + varG + varB;
          blockCount++;
        }
      }
    }

    // Return uniformity score (higher = more uniform = lower variance)
    if (blockCount === 0) return 0;
    const avgVariance = totalVariance / blockCount;
    return 1.0 / (1.0 + avgVariance);
  };

  /**
   * Fallback for small scales: measure uniformity using center region only
   */
  const measureCenterUniformity = (scale: number, offX: number, offY: number): number => {
    let totalVariance = 0;
    let blockCount = 0;

    // Sample across the whole image
    const totalBlocksX = Math.floor((width - offX) / scale);
    const totalBlocksY = Math.floor((height - offY) / scale);
    const sampleCount = 15;
    const stepX = Math.max(1, Math.floor(totalBlocksX / sampleCount));
    const stepY = Math.max(1, Math.floor(totalBlocksY / sampleCount));

    // Sample 3x3 around center
    const centerOffset = Math.floor(scale / 2);

    for (let by = 0; by < totalBlocksY; by += stepY) {
      for (let bx = 0; bx < totalBlocksX; bx += stepX) {
        const blockX = offX + bx * scale;
        const blockY = offY + by * scale;

        if (blockX + scale > width || blockY + scale > height) continue;

        let sumR = 0, sumG = 0, sumB = 0;
        let sumR2 = 0, sumG2 = 0, sumB2 = 0;
        let pixelCount = 0;

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const px = blockX + centerOffset + dx;
            const py = blockY + centerOffset + dy;
            if (px >= 0 && px < width && py >= 0 && py < height) {
              const idx = (py * width + px) * 4;
              const r = data[idx], g = data[idx + 1], b = data[idx + 2];
              sumR += r; sumG += g; sumB += b;
              sumR2 += r * r; sumG2 += g * g; sumB2 += b * b;
              pixelCount++;
            }
          }
        }

        if (pixelCount > 0) {
          const meanR = sumR / pixelCount;
          const meanG = sumG / pixelCount;
          const meanB = sumB / pixelCount;

          // Skip background blocks (near-white)
          if (meanR > 230 && meanG > 230 && meanB > 230) {
            continue;
          }

          const varR = (sumR2 / pixelCount) - meanR * meanR;
          const varG = (sumG2 / pixelCount) - meanG * meanG;
          const varB = (sumB2 / pixelCount) - meanB * meanB;
          totalVariance += varR + varG + varB;
          blockCount++;
        }
      }
    }

    if (blockCount === 0) return 0;
    const avgVariance = totalVariance / blockCount;
    return 1.0 / (1.0 + avgVariance);
  };

  // Test a range of candidate scales
  const minScale = 4;
  const maxScale = Math.min(40, Math.floor(Math.min(width, height) / 8));

  /**
   * Find significant color transitions (edges) along a line.
   * Returns positions where color changes significantly.
   */
  const findEdges = (
    isHorizontal: boolean,
    linePos: number,
    threshold: number = 80
  ): number[] => {
    const edges: number[] = [];
    const maxPos = isHorizontal ? width : height;

    for (let pos = 1; pos < maxPos; pos++) {
      const idx1 = isHorizontal
        ? (linePos * width + pos - 1) * 4
        : ((pos - 1) * width + linePos) * 4;
      const idx2 = isHorizontal
        ? (linePos * width + pos) * 4
        : (pos * width + linePos) * 4;

      const diff =
        Math.abs(data[idx1] - data[idx2]) +
        Math.abs(data[idx1 + 1] - data[idx2 + 1]) +
        Math.abs(data[idx1 + 2] - data[idx2 + 2]);

      if (diff > threshold) {
        edges.push(pos);
      }
    }
    return edges;
  };

  /**
   * Measures how well edges align with a given scale and offset.
   * The correct scale should have edge distances that are multiples of the scale.
   */
  const measureEdgeAlignment = (
    scale: number,
    offset: number,
    edges: number[]
  ): { score: number; avgError: number } => {
    if (edges.length < 2) return { score: 0, avgError: Infinity };

    // Calculate distances between significant edges
    // Cluster edges that are within 3px of each other (JPEG artifact clusters)
    const clusteredEdges: number[] = [];
    let clusterStart = edges[0];
    for (let i = 1; i < edges.length; i++) {
      if (edges[i] - edges[i - 1] > 3) {
        // End current cluster, start new one
        clusteredEdges.push(Math.round((clusterStart + edges[i - 1]) / 2));
        clusterStart = edges[i];
      }
    }
    clusteredEdges.push(Math.round((clusterStart + edges[edges.length - 1]) / 2));

    // Calculate distances between clustered edges
    const distances: number[] = [];
    for (let i = 1; i < clusteredEdges.length; i++) {
      const dist = clusteredEdges[i] - clusteredEdges[i - 1];
      if (dist >= scale - 2) {
        // Ignore very short distances
        distances.push(dist);
      }
    }

    if (distances.length === 0) return { score: 0, avgError: Infinity };

    // For each distance, check how close it is to a multiple of scale
    let totalError = 0;
    let goodDivisions = 0;

    for (const d of distances) {
      const nearestMultiple = Math.round(d / scale) * scale;
      const error = Math.abs(d - nearestMultiple);

      if (error <= 2) {
        // Within 2px tolerance
        goodDivisions++;
      }
      totalError += error;
    }

    const avgError = totalError / distances.length;
    const score = goodDivisions / distances.length;

    return { score, avgError };
  };

  // Sample multiple lines to get edge positions
  const sampleLines = 5;
  const hEdges: number[][] = [];
  const vEdges: number[][] = [];

  for (let i = 0; i < sampleLines; i++) {
    const hLine = Math.floor((height * (i + 1)) / (sampleLines + 1));
    const vLine = Math.floor((width * (i + 1)) / (sampleLines + 1));
    hEdges.push(findEdges(true, hLine));
    vEdges.push(findEdges(false, vLine));
  }

  // Phase 1: Find best scale using edge alignment
  const scaleResults: Array<{
    scale: number;
    score: number;
    avgError: number;
    offsetX: number;
    offsetY: number;
  }> = [];

  for (let scale = minScale; scale <= maxScale; scale++) {
    // Check if output dimensions are reasonable for pixel art
    const resultMax = Math.max(
      Math.floor(width / scale),
      Math.floor(height / scale)
    );
    const resultMin = Math.min(
      Math.floor(width / scale),
      Math.floor(height / scale)
    );

    // Skip if output is too large (not typical pixel art) or too small
    if (resultMax > 150 || resultMin < 32) {
      continue;
    }

    // Test edge alignment for this scale across all sampled lines
    let totalScore = 0;
    let totalError = 0;
    let lineCount = 0;

    for (const edges of [...hEdges, ...vEdges]) {
      const { score, avgError } = measureEdgeAlignment(scale, 0, edges);
      if (avgError < Infinity) {
        totalScore += score;
        totalError += avgError;
        lineCount++;
      }
    }

    if (lineCount === 0) continue;

    const avgScore = totalScore / lineCount;
    const avgError = totalError / lineCount;

    // Find best offset using uniformity metric
    let bestUniformity = 0;
    let bestOffX = 0;
    let bestOffY = 0;

    const step = scale > 10 ? 2 : 1;
    for (let offY = 0; offY < scale; offY += step) {
      for (let offX = 0; offX < scale; offX += step) {
        const uniformity = measureInteriorUniformity(scale, offX, offY);
        if (uniformity > bestUniformity) {
          bestUniformity = uniformity;
          bestOffX = offX;
          bestOffY = offY;
        }
      }
    }

    // Fine search around best coarse result
    if (step > 1) {
      for (
        let offY = Math.max(0, bestOffY - 1);
        offY <= Math.min(scale - 1, bestOffY + 1);
        offY++
      ) {
        for (
          let offX = Math.max(0, bestOffX - 1);
          offX <= Math.min(scale - 1, bestOffX + 1);
          offX++
        ) {
          const uniformity = measureInteriorUniformity(scale, offX, offY);
          if (uniformity > bestUniformity) {
            bestUniformity = uniformity;
            bestOffX = offX;
            bestOffY = offY;
          }
        }
      }
    }

    scaleResults.push({
      scale,
      score: avgScore,
      avgError,
      offsetX: bestOffX,
      offsetY: bestOffY,
    });
  }

  // Sort by edge alignment score (highest first), then by error (lowest first)
  scaleResults.sort((a, b) => {
    // Primary: higher score is better
    if (Math.abs(a.score - b.score) > 0.1) {
      return b.score - a.score;
    }
    // Secondary: lower error is better
    return a.avgError - b.avgError;
  });

  if (scaleResults.length === 0) {
    return { scale: 1, offsetX: 0, offsetY: 0 };
  }

  // Return the scale with best edge alignment and its optimal offset
  const best = scaleResults[0];
  return { scale: best.scale, offsetX: best.offsetX, offsetY: best.offsetY };
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
  offsetX: number;
  offsetY: number;
} {
  const { width, height } = imageData;

  // Detect if this is upscaled pixel art (including grid offset)
  const { scale, offsetX, offsetY } = detectPixelScaleAndOffset(imageData);

  let targetWidth = width;
  let targetHeight = height;

  if (scale > 1) {
    // Downscale to native pixel art dimensions accounting for offset
    targetWidth = Math.floor((width - offsetX) / scale);
    targetHeight = Math.floor((height - offsetY) / scale);

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

  return { targetWidth, targetHeight, detectedScale: scale, offsetX, offsetY };
}

/**
 * Downscales pixel art using detected scale.
 * Uses median color from block interiors to handle JPEG artifacts.
 * JPEG artifacts concentrate at edges, so we sample from the inner region.
 *
 * @param imageData - The source image
 * @param scale - The detected scale factor
 * @param offsetX - The x offset of the pixel grid
 * @param offsetY - The y offset of the pixel grid
 * @returns Downscaled ImageData
 */
export function resizePixelArt(
  imageData: ImageData,
  scale: number,
  offsetX: number,
  offsetY: number
): ImageData {
  const { data, width, height } = imageData;

  // Calculate output dimensions
  const outWidth = Math.floor((width - offsetX) / scale);
  const outHeight = Math.floor((height - offsetY) / scale);

  // Create output canvas
  const canvas = document.createElement('canvas');
  canvas.width = outWidth;
  canvas.height = outHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas 2D context');
  }

  const outData = ctx.createImageData(outWidth, outHeight);

  // Interior margin: skip outer portion to avoid JPEG edge artifacts
  const margin = Math.max(1, Math.floor(scale * 0.2));

  /**
   * Extract the true color from a block using median of interior samples.
   * Median is robust to outliers (JPEG artifacts).
   */
  const extractBlockColor = (blockX: number, blockY: number): [number, number, number, number] => {
    const rValues: number[] = [];
    const gValues: number[] = [];
    const bValues: number[] = [];
    const aValues: number[] = [];

    // Determine sampling region (interior only for larger scales)
    const startX = blockX + (scale >= 6 ? margin : 0);
    const startY = blockY + (scale >= 6 ? margin : 0);
    const endX = blockX + scale - (scale >= 6 ? margin : 0);
    const endY = blockY + scale - (scale >= 6 ? margin : 0);

    for (let py = startY; py < endY; py++) {
      for (let px = startX; px < endX; px++) {
        if (px >= 0 && px < width && py >= 0 && py < height) {
          const idx = (py * width + px) * 4;
          rValues.push(data[idx]);
          gValues.push(data[idx + 1]);
          bValues.push(data[idx + 2]);
          aValues.push(data[idx + 3]);
        }
      }
    }

    // If we got no samples (shouldn't happen), fall back to center pixel
    if (rValues.length === 0) {
      const cx = Math.min(Math.max(0, blockX + Math.floor(scale / 2)), width - 1);
      const cy = Math.min(Math.max(0, blockY + Math.floor(scale / 2)), height - 1);
      const idx = (cy * width + cx) * 4;
      return [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];
    }

    // Sort and take median for each channel
    rValues.sort((a, b) => a - b);
    gValues.sort((a, b) => a - b);
    bValues.sort((a, b) => a - b);
    aValues.sort((a, b) => a - b);

    const mid = Math.floor(rValues.length / 2);
    return [rValues[mid], gValues[mid], bValues[mid], aValues[mid]];
  };

  // Process each output pixel
  for (let outY = 0; outY < outHeight; outY++) {
    for (let outX = 0; outX < outWidth; outX++) {
      const blockX = offsetX + outX * scale;
      const blockY = offsetY + outY * scale;

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

    // Stack stores [x, y, parentDirection] where parentDirection helps avoid redundant checks
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
