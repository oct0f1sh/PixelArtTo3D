import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { createCanvas, loadImage, ImageData as CanvasImageData } from 'canvas';
import {
  quantizeColors,
  detectPixelScale,
  getOptimalDimensions,
  detectPixelScaleAndOffset,
} from './imageProcessor';

// Node.js compatible implementations for testing
// (The browser versions use document.createElement which isn't available in Node)

/**
 * Removes background using flood-fill (Node.js compatible version)
 */
function removeBackgroundNode(
  imageData: ImageData,
  options: { color: { r: number; g: number; b: number }; tolerance: number }
): ImageData {
  const { width, height, data } = imageData;
  const { color, tolerance } = options;

  const newData = new Uint8ClampedArray(data);
  const maxDistanceSquared = 255 * 255 * 3;
  const toleranceDistanceSquared = (tolerance / 100) * maxDistanceSquared;

  const visited = new Uint8Array(width * height);

  const isBackgroundColor = (pixelIndex: number): boolean => {
    const dataIndex = pixelIndex * 4;
    const a = data[dataIndex + 3];
    if (a < 128) return false;

    const r = data[dataIndex];
    const g = data[dataIndex + 1];
    const b = data[dataIndex + 2];

    const dr = r - color.r;
    const dg = g - color.g;
    const db = b - color.b;
    return dr * dr + dg * dg + db * db <= toleranceDistanceSquared;
  };

  const scanlineFill = (startX: number, startY: number): void => {
    const startPixelIndex = startY * width + startX;
    if (visited[startPixelIndex] || !isBackgroundColor(startPixelIndex)) return;

    const stack: Array<[number, number]> = [[startX, startY]];

    while (stack.length > 0) {
      const [x, y] = stack.pop()!;
      let leftX = x;

      while (leftX > 0) {
        const leftPixelIndex = y * width + (leftX - 1);
        if (visited[leftPixelIndex] || !isBackgroundColor(leftPixelIndex)) break;
        leftX--;
      }

      let currentX = leftX;
      let aboveAdded = false;
      let belowAdded = false;

      while (currentX < width) {
        const pixelIndex = y * width + currentX;
        if (visited[pixelIndex] || !isBackgroundColor(pixelIndex)) break;

        visited[pixelIndex] = 1;
        newData[pixelIndex * 4 + 3] = 0;

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

  for (let x = 0; x < width; x++) {
    scanlineFill(x, 0);
    scanlineFill(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    scanlineFill(0, y);
    scanlineFill(width - 1, y);
  }

  return new CanvasImageData(newData, width, height) as unknown as ImageData;
}

/**
 * Resizes an image (Node.js compatible version using canvas library)
 */
function resizeImageNode(imageData: ImageData, maxDimension: number): ImageData {
  const { width, height } = imageData;

  if (width <= maxDimension && height <= maxDimension) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    const canvasImageData = new CanvasImageData(
      new Uint8ClampedArray(imageData.data),
      width,
      height
    );
    ctx.putImageData(canvasImageData, 0, 0);
    return ctx.getImageData(0, 0, width, height) as unknown as ImageData;
  }

  let newWidth: number;
  let newHeight: number;

  if (width > height) {
    newWidth = maxDimension;
    newHeight = Math.round((height / width) * maxDimension);
  } else {
    newHeight = maxDimension;
    newWidth = Math.round((width / height) * maxDimension);
  }

  newWidth = Math.max(1, newWidth);
  newHeight = Math.max(1, newHeight);

  const sourceCanvas = createCanvas(width, height);
  const sourceCtx = sourceCanvas.getContext('2d');
  const canvasImageData = new CanvasImageData(
    new Uint8ClampedArray(imageData.data),
    width,
    height
  );
  sourceCtx.putImageData(canvasImageData, 0, 0);

  const destCanvas = createCanvas(newWidth, newHeight);
  const destCtx = destCanvas.getContext('2d');
  destCtx.imageSmoothingEnabled = false;
  destCtx.drawImage(sourceCanvas, 0, 0, newWidth, newHeight);

  return destCtx.getImageData(0, 0, newWidth, newHeight) as unknown as ImageData;
}

/**
 * Loads an image and returns ImageData
 */
async function loadImageData(imagePath: string): Promise<ImageData> {
  const image = await loadImage(imagePath);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, image.width, image.height);
}

/**
 * Counts transparent pixels in ImageData
 */
function countTransparentPixels(imageData: ImageData): number {
  const { data, width, height } = imageData;
  let count = 0;
  for (let i = 0; i < width * height; i++) {
    if (data[i * 4 + 3] < 128) {
      count++;
    }
  }
  return count;
}

/**
 * Counts pixels of a specific color (within tolerance)
 */
function countPixelsOfColor(
  imageData: ImageData,
  targetR: number,
  targetG: number,
  targetB: number,
  tolerance: number = 10
): number {
  const { data, width, height } = imageData;
  let count = 0;
  const toleranceSquared = tolerance * tolerance * 3;

  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const a = data[i * 4 + 3];

    if (a >= 128) {
      const dr = r - targetR;
      const dg = g - targetG;
      const db = b - targetB;
      const distSquared = dr * dr + dg * dg + db * db;

      if (distSquared <= toleranceSquared) {
        count++;
      }
    }
  }
  return count;
}

describe('Background Removal Tests', () => {
  const TEST_IMAGE = 'ral2.jpg';

  it('should load the test image', async () => {
    const imagePath = path.resolve(process.cwd(), TEST_IMAGE);
    expect(fs.existsSync(imagePath), `Test image ${TEST_IMAGE} should exist`).toBe(true);

    const imageData = await loadImageData(imagePath);
    expect(imageData.width).toBeGreaterThan(0);
    expect(imageData.height).toBeGreaterThan(0);

    console.log(`\n${TEST_IMAGE} dimensions: ${imageData.width}x${imageData.height}`);
  });

  it('should have white/light gray background pixels before removal', async () => {
    const imagePath = path.resolve(process.cwd(), TEST_IMAGE);
    if (!fs.existsSync(imagePath)) return;

    const imageData = await loadImageData(imagePath);

    // Count near-white pixels (the background) - RGB around 240-255
    const whitePixels = countPixelsOfColor(imageData, 245, 245, 245, 15);
    const totalPixels = imageData.width * imageData.height;
    const whitePercentage = (whitePixels / totalPixels) * 100;

    console.log(`\nBefore background removal:`);
    console.log(`  Total pixels: ${totalPixels}`);
    console.log(`  White/near-white pixels: ${whitePixels} (${whitePercentage.toFixed(1)}%)`);

    // The background should be a significant portion of the image
    expect(whitePercentage).toBeGreaterThan(30);
  });

  it('should remove white background from edges', async () => {
    const imagePath = path.resolve(process.cwd(), TEST_IMAGE);
    if (!fs.existsSync(imagePath)) return;

    const imageData = await loadImageData(imagePath);
    const transparentBefore = countTransparentPixels(imageData);

    // Remove white background (RGB ~245,245,245 based on the image)
    const processedData = removeBackgroundNode(imageData, {
      color: { r: 245, g: 245, b: 245 },
      tolerance: 10,
    });

    const transparentAfter = countTransparentPixels(processedData);
    const removedPixels = transparentAfter - transparentBefore;
    const totalPixels = imageData.width * imageData.height;
    const removedPercentage = (removedPixels / totalPixels) * 100;

    console.log(`\nAfter background removal:`);
    console.log(`  Transparent pixels before: ${transparentBefore}`);
    console.log(`  Transparent pixels after: ${transparentAfter}`);
    console.log(`  Pixels removed: ${removedPixels} (${removedPercentage.toFixed(1)}%)`);

    // Background removal should have removed significant pixels
    expect(removedPixels).toBeGreaterThan(0);
    expect(removedPercentage).toBeGreaterThan(30);
  });

  it('should preserve interior pixels of the same color', async () => {
    const imagePath = path.resolve(process.cwd(), TEST_IMAGE);
    if (!fs.existsSync(imagePath)) return;

    const imageData = await loadImageData(imagePath);

    // Remove white background
    const processedData = removeBackgroundNode(imageData, {
      color: { r: 245, g: 245, b: 245 },
      tolerance: 10,
    });

    // Quantize to check remaining colors
    const quantized = quantizeColors(processedData);

    console.log(`\nAfter background removal:`);
    console.log(`  Colors in palette: ${quantized.palette.length}`);
    console.log(`  Palette: ${quantized.palette.map(c => c.hex).join(', ')}`);

    // Should still have multiple colors (not everything removed)
    expect(quantized.palette.length).toBeGreaterThan(1);

    // Count non-transparent pixels in the result
    let nonTransparentPixels = 0;
    for (let y = 0; y < quantized.height; y++) {
      for (let x = 0; x < quantized.width; x++) {
        if (quantized.pixels[y][x] !== -1) {
          nonTransparentPixels++;
        }
      }
    }

    console.log(`  Non-transparent pixels: ${nonTransparentPixels}`);
    expect(nonTransparentPixels).toBeGreaterThan(0);
  });

  it('should only remove background connected to edges (flood-fill behavior)', async () => {
    const imagePath = path.resolve(process.cwd(), TEST_IMAGE);
    if (!fs.existsSync(imagePath)) return;

    const imageData = await loadImageData(imagePath);

    // Get corner pixel color (should be background)
    const cornerColor = {
      r: imageData.data[0],
      g: imageData.data[1],
      b: imageData.data[2],
    };

    console.log(`\nCorner pixel color: rgb(${cornerColor.r}, ${cornerColor.g}, ${cornerColor.b})`);

    // Remove background using corner color
    const processedData = removeBackgroundNode(imageData, {
      color: cornerColor,
      tolerance: 10,
    });

    // Check that corner pixels are now transparent
    expect(processedData.data[3]).toBe(0); // Top-left corner alpha should be 0

    // Check opposite corner
    const bottomRightIndex = ((imageData.height - 1) * imageData.width + (imageData.width - 1)) * 4;
    expect(processedData.data[bottomRightIndex + 3]).toBe(0); // Bottom-right corner alpha should be 0
  });
});

describe('Pixel Scale Detection Tests', () => {
  const TEST_IMAGE = 'ral2.jpg';

  it('should detect pixel scale for upscaled pixel art', async () => {
    const imagePath = path.resolve(process.cwd(), TEST_IMAGE);
    if (!fs.existsSync(imagePath)) {
      console.warn(`Test image ${TEST_IMAGE} not found, skipping`);
      return;
    }

    const imageData = await loadImageData(imagePath);
    const scale = detectPixelScale(imageData);

    console.log(`\n${TEST_IMAGE} pixel scale detection:`);
    console.log(`  Original dimensions: ${imageData.width}x${imageData.height}`);
    console.log(`  Detected scale factor: ${scale}x`);

    if (scale > 1) {
      const nativeWidth = Math.round(imageData.width / scale);
      const nativeHeight = Math.round(imageData.height / scale);
      console.log(`  Native pixel art dimensions: ${nativeWidth}x${nativeHeight}`);
    }

    // For upscaled pixel art, scale should be > 1
    // ral2.jpg is 750x1000, upscaled pixel art - should detect significant scaling
    expect(scale).toBeGreaterThan(1);

    // The detected scale should result in reasonable pixel art dimensions
    // (typically under 256x256 for pixel art)
    const detectedWidth = Math.round(imageData.width / scale);
    const detectedHeight = Math.round(imageData.height / scale);
    expect(detectedWidth).toBeLessThanOrEqual(256);
    expect(detectedHeight).toBeLessThanOrEqual(256);
  });

  it('should calculate optimal dimensions for processing', async () => {
    const imagePath = path.resolve(process.cwd(), TEST_IMAGE);
    if (!fs.existsSync(imagePath)) return;

    const imageData = await loadImageData(imagePath);
    const { targetWidth, targetHeight, detectedScale } = getOptimalDimensions(imageData);

    console.log(`\n${TEST_IMAGE} optimal dimensions:`);
    console.log(`  Original: ${imageData.width}x${imageData.height}`);
    console.log(`  Detected scale: ${detectedScale}x`);
    console.log(`  Target dimensions: ${targetWidth}x${targetHeight}`);

    // Target dimensions should be smaller than original for large images
    expect(targetWidth).toBeLessThanOrEqual(imageData.width);
    expect(targetHeight).toBeLessThanOrEqual(imageData.height);

    // Target should be within reasonable bounds for processing
    expect(Math.max(targetWidth, targetHeight)).toBeLessThanOrEqual(256);
  });

  it('should downscale image to optimal dimensions', async () => {
    const imagePath = path.resolve(process.cwd(), TEST_IMAGE);
    if (!fs.existsSync(imagePath)) return;

    const imageData = await loadImageData(imagePath);
    const { targetWidth, targetHeight, detectedScale } = getOptimalDimensions(imageData);

    // Downscale the image
    const maxTargetDim = Math.max(targetWidth, targetHeight);
    const resized = resizeImageNode(imageData, maxTargetDim);

    console.log(`\n${TEST_IMAGE} downscaling:`);
    console.log(`  Original: ${imageData.width}x${imageData.height} (${imageData.width * imageData.height} pixels)`);
    console.log(`  Resized: ${resized.width}x${resized.height} (${resized.width * resized.height} pixels)`);
    console.log(`  Reduction: ${((1 - (resized.width * resized.height) / (imageData.width * imageData.height)) * 100).toFixed(1)}%`);

    // Verify dimensions are correct
    expect(resized.width).toBeLessThanOrEqual(maxTargetDim);
    expect(resized.height).toBeLessThanOrEqual(maxTargetDim);
    expect(Math.max(resized.width, resized.height)).toBe(maxTargetDim);
  });

  it('should preserve pixel art quality when downscaling (nearest-neighbor)', async () => {
    const imagePath = path.resolve(process.cwd(), TEST_IMAGE);
    if (!fs.existsSync(imagePath)) return;

    const imageData = await loadImageData(imagePath);
    const { targetWidth, targetHeight } = getOptimalDimensions(imageData);

    // Downscale
    const maxTargetDim = Math.max(targetWidth, targetHeight);
    const resized = resizeImageNode(imageData, maxTargetDim);

    // Quantize the resized image
    const quantized = quantizeColors(resized);

    console.log(`\n${TEST_IMAGE} color preservation after downscale:`);
    console.log(`  Colors detected: ${quantized.palette.length}`);
    console.log(`  Palette: ${quantized.palette.slice(0, 10).map(c => c.hex).join(', ')}${quantized.palette.length > 10 ? '...' : ''}`);

    // Should still have distinct colors (not blurred together)
    expect(quantized.palette.length).toBeGreaterThan(3);
  });
});

describe('Combined Background Removal and Downscaling', () => {
  const TEST_IMAGE = 'ral2.jpg';

  it('should process large image with background removal efficiently', async () => {
    const imagePath = path.resolve(process.cwd(), TEST_IMAGE);
    if (!fs.existsSync(imagePath)) return;

    const imageData = await loadImageData(imagePath);

    // Get optimal dimensions
    const { targetWidth, targetHeight, detectedScale } = getOptimalDimensions(imageData);

    // Downscale first
    const maxTargetDim = Math.max(targetWidth, targetHeight);
    let processedData = resizeImageNode(imageData, maxTargetDim);

    console.log(`\nFull processing pipeline for ${TEST_IMAGE}:`);
    console.log(`  Step 1 - Downscale: ${imageData.width}x${imageData.height} -> ${processedData.width}x${processedData.height}`);

    // Then remove background (using corner color)
    const cornerColor = {
      r: processedData.data[0],
      g: processedData.data[1],
      b: processedData.data[2],
    };

    const beforeBgRemoval = countTransparentPixels(processedData);
    processedData = removeBackgroundNode(processedData, {
      color: cornerColor,
      tolerance: 10,
    });
    const afterBgRemoval = countTransparentPixels(processedData);

    console.log(`  Step 2 - Background removal: ${afterBgRemoval - beforeBgRemoval} pixels removed`);

    // Quantize
    const quantized = quantizeColors(processedData);

    console.log(`  Step 3 - Quantize: ${quantized.palette.length} colors`);
    console.log(`  Final grid: ${quantized.width}x${quantized.height}`);

    // Count actual content pixels
    let contentPixels = 0;
    for (let y = 0; y < quantized.height; y++) {
      for (let x = 0; x < quantized.width; x++) {
        if (quantized.pixels[y][x] !== -1) {
          contentPixels++;
        }
      }
    }

    console.log(`  Content pixels: ${contentPixels}`);

    // Verify reasonable output
    expect(quantized.palette.length).toBeGreaterThan(0);
    expect(contentPixels).toBeGreaterThan(0);
    expect(quantized.width).toBeLessThanOrEqual(256);
    expect(quantized.height).toBeLessThanOrEqual(256);
  });
});

describe('Pixel Art Scale and Color Accuracy Tests', () => {
  const TEST_IMAGE = 'ral2.jpg';

  /**
   * Node.js compatible version of resizePixelArt using median color extraction
   */
  function resizePixelArtNode(
    imageData: ImageData,
    scale: number,
    offsetX: number,
    offsetY: number
  ): ImageData {
    const { data, width, height } = imageData;
    const outWidth = Math.floor((width - offsetX) / scale);
    const outHeight = Math.floor((height - offsetY) / scale);

    const canvas = createCanvas(outWidth, outHeight);
    const ctx = canvas.getContext('2d');
    const outData = ctx.createImageData(outWidth, outHeight);

    const margin = Math.max(1, Math.floor(scale * 0.2));

    for (let outY = 0; outY < outHeight; outY++) {
      for (let outX = 0; outX < outWidth; outX++) {
        const blockX = offsetX + outX * scale;
        const blockY = offsetY + outY * scale;

        const rValues: number[] = [];
        const gValues: number[] = [];
        const bValues: number[] = [];
        const aValues: number[] = [];

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

        if (rValues.length === 0) {
          const cx = Math.min(Math.max(0, blockX + Math.floor(scale / 2)), width - 1);
          const cy = Math.min(Math.max(0, blockY + Math.floor(scale / 2)), height - 1);
          const idx = (cy * width + cx) * 4;
          rValues.push(data[idx]);
          gValues.push(data[idx + 1]);
          bValues.push(data[idx + 2]);
          aValues.push(data[idx + 3]);
        }

        rValues.sort((a, b) => a - b);
        gValues.sort((a, b) => a - b);
        bValues.sort((a, b) => a - b);
        aValues.sort((a, b) => a - b);

        const mid = Math.floor(rValues.length / 2);
        const outIndex = (outY * outWidth + outX) * 4;
        outData.data[outIndex] = rValues[mid];
        outData.data[outIndex + 1] = gValues[mid];
        outData.data[outIndex + 2] = bValues[mid];
        outData.data[outIndex + 3] = aValues[mid];
      }
    }

    ctx.putImageData(outData, 0, 0);
    return ctx.getImageData(0, 0, outWidth, outHeight) as unknown as ImageData;
  }

  /**
   * Calculates variance of colors within a block (interior only)
   */
  function measureBlockVariance(
    imageData: ImageData,
    blockX: number,
    blockY: number,
    scale: number
  ): number {
    const { data, width, height } = imageData;
    const margin = Math.max(1, Math.floor(scale * 0.25));

    let sumR = 0, sumG = 0, sumB = 0;
    let sumR2 = 0, sumG2 = 0, sumB2 = 0;
    let count = 0;

    for (let py = margin; py < scale - margin; py++) {
      for (let px = margin; px < scale - margin; px++) {
        const x = blockX + px;
        const y = blockY + py;
        if (x < width && y < height) {
          const idx = (y * width + x) * 4;
          const r = data[idx], g = data[idx + 1], b = data[idx + 2];
          sumR += r; sumG += g; sumB += b;
          sumR2 += r * r; sumG2 += g * g; sumB2 += b * b;
          count++;
        }
      }
    }

    if (count === 0) return Infinity;
    const varR = (sumR2 / count) - Math.pow(sumR / count, 2);
    const varG = (sumG2 / count) - Math.pow(sumG / count, 2);
    const varB = (sumB2 / count) - Math.pow(sumB / count, 2);
    return varR + varG + varB;
  }

  it('should detect correct scale with uniform block interiors', async () => {
    const imagePath = path.resolve(process.cwd(), TEST_IMAGE);
    if (!fs.existsSync(imagePath)) return;

    const imageData = await loadImageData(imagePath);
    const { scale, offsetX, offsetY } = detectPixelScaleAndOffset(imageData);

    console.log(`\nScale detection validation for ${TEST_IMAGE}:`);
    console.log(`  Detected: scale=${scale}x, offset=(${offsetX}, ${offsetY})`);

    // Measure variance at multiple scales to find the best one
    console.log(`\n  Variance comparison across scales:`);
    const scaleVariances: Array<{ scale: number; variance: number; dims: string }> = [];

    for (let testScale = 8; testScale <= 14; testScale++) {
      const outWidth = Math.floor(imageData.width / testScale);
      const outHeight = Math.floor(imageData.height / testScale);

      let totalVariance = 0;
      let blockCount = 0;
      const sampleStep = Math.max(1, Math.floor(Math.min(outWidth, outHeight) / 15));

      for (let by = 0; by < outHeight; by += sampleStep) {
        for (let bx = 0; bx < outWidth; bx += sampleStep) {
          const blockX = bx * testScale;
          const blockY = by * testScale;
          const variance = measureBlockVariance(imageData, blockX, blockY, testScale);
          if (variance < Infinity) {
            totalVariance += variance;
            blockCount++;
          }
        }
      }

      const avgVariance = blockCount > 0 ? totalVariance / blockCount : Infinity;
      scaleVariances.push({
        scale: testScale,
        variance: avgVariance,
        dims: `${outWidth}x${outHeight}`
      });
      console.log(`    ${testScale}x -> ${outWidth}x${outHeight}: variance = ${avgVariance.toFixed(2)}`);
    }

    // Find the scale with lowest variance (for comparison)
    const bestVarianceScale = scaleVariances.reduce((a, b) => a.variance < b.variance ? a : b);
    console.log(`\n  Best scale by variance: ${bestVarianceScale.scale}x (${bestVarianceScale.dims}) with variance ${bestVarianceScale.variance.toFixed(2)}`);
    console.log(`  Current detection: ${scale}x`);

    // Note: variance-based detection is NOT correct for JPEG images because white background
    // has zero variance at any scale. Edge-based detection is more accurate.
    // For ral2.jpg, manual analysis of pixel boundaries confirms scale 11:
    // - Hat tip is ~12-13 source pixels (1 native pixel, JPEG blur adds ~1-2px)
    // - Hat just below tip is ~34 source pixels (3 native pixels, 34/3 = 11.3)
    // - Edge distances cluster around multiples of 11

    // The detected scale should be 11 for ral2.jpg (edge-aligned detection)
    expect(scale).toBe(11);

    // Measure variance at detected scale
    const outWidth = Math.floor((imageData.width - offsetX) / scale);
    const outHeight = Math.floor((imageData.height - offsetY) / scale);

    let totalVariance = 0;
    let blockCount = 0;
    const sampleStep = Math.max(1, Math.floor(Math.min(outWidth, outHeight) / 20));

    for (let by = 0; by < outHeight; by += sampleStep) {
      for (let bx = 0; bx < outWidth; bx += sampleStep) {
        const blockX = offsetX + bx * scale;
        const blockY = offsetY + by * scale;
        const variance = measureBlockVariance(imageData, blockX, blockY, scale);
        if (variance < Infinity) {
          totalVariance += variance;
          blockCount++;
        }
      }
    }

    const avgVariance = totalVariance / blockCount;
    console.log(`\n  Detected scale variance: ${avgVariance.toFixed(2)}`);

    // Variance should be reasonable (JPEG artifacts add noise)
    // Scale 11 will have higher variance than scale 9 because it samples
    // actual character pixels rather than mostly background
    expect(avgVariance).toBeLessThan(600);
  });

  it('should produce output with crisp colors (limited unique colors)', async () => {
    const imagePath = path.resolve(process.cwd(), TEST_IMAGE);
    if (!fs.existsSync(imagePath)) return;

    const imageData = await loadImageData(imagePath);
    const { scale, offsetX, offsetY } = detectPixelScaleAndOffset(imageData);

    // Downsample using our pixel art algorithm
    const output = resizePixelArtNode(imageData, scale, offsetX, offsetY);

    // Count unique colors in output
    const colorSet = new Set<string>();
    for (let i = 0; i < output.width * output.height; i++) {
      const r = output.data[i * 4];
      const g = output.data[i * 4 + 1];
      const b = output.data[i * 4 + 2];
      colorSet.add(`${r},${g},${b}`);
    }

    console.log(`\nOutput color crispness for ${TEST_IMAGE}:`);
    console.log(`  Output dimensions: ${output.width}x${output.height}`);
    console.log(`  Unique colors: ${colorSet.size}`);

    // True pixel art should have relatively few unique colors
    // (Original palette + some JPEG variation)
    // If scale is wrong, there will be many blended colors
    // JPEG artifacts introduce many slight color variations, so allow up to 600
    expect(colorSet.size).toBeLessThan(600);
  });

  it('should match output colors to source block median colors', async () => {
    const imagePath = path.resolve(process.cwd(), TEST_IMAGE);
    if (!fs.existsSync(imagePath)) return;

    const imageData = await loadImageData(imagePath);
    const { scale, offsetX, offsetY } = detectPixelScaleAndOffset(imageData);

    const output = resizePixelArtNode(imageData, scale, offsetX, offsetY);

    console.log(`\nColor matching validation for ${TEST_IMAGE}:`);
    console.log(`  Scale: ${scale}x, Offset: (${offsetX}, ${offsetY})`);
    console.log(`  Output: ${output.width}x${output.height}`);

    // Sample output pixels and verify they match source block colors
    let matchCount = 0;
    let totalSamples = 0;
    const tolerance = 30; // Allow some JPEG variation

    const sampleStep = Math.max(1, Math.floor(Math.min(output.width, output.height) / 15));

    for (let outY = 0; outY < output.height; outY += sampleStep) {
      for (let outX = 0; outX < output.width; outX += sampleStep) {
        const outIdx = (outY * output.width + outX) * 4;
        const outR = output.data[outIdx];
        const outG = output.data[outIdx + 1];
        const outB = output.data[outIdx + 2];

        // Get center pixel of corresponding source block
        const srcCenterX = offsetX + outX * scale + Math.floor(scale / 2);
        const srcCenterY = offsetY + outY * scale + Math.floor(scale / 2);
        const srcIdx = (srcCenterY * imageData.width + srcCenterX) * 4;
        const srcR = imageData.data[srcIdx];
        const srcG = imageData.data[srcIdx + 1];
        const srcB = imageData.data[srcIdx + 2];

        // Check if output color is close to source center color
        const dr = Math.abs(outR - srcR);
        const dg = Math.abs(outG - srcG);
        const db = Math.abs(outB - srcB);
        const maxDiff = Math.max(dr, dg, db);

        if (maxDiff <= tolerance) {
          matchCount++;
        }

        totalSamples++;
      }
    }

    const matchRate = (matchCount / totalSamples) * 100;
    console.log(`  Color match rate: ${matchRate.toFixed(1)}% (${matchCount}/${totalSamples})`);
    console.log(`  (Tolerance: ${tolerance} per channel)`);

    // At least 80% of output pixels should match source block colors
    expect(matchRate).toBeGreaterThan(80);
  });

  it('should have symmetric features (eyes should be same size)', async () => {
    const imagePath = path.resolve(process.cwd(), TEST_IMAGE);
    if (!fs.existsSync(imagePath)) return;

    const imageData = await loadImageData(imagePath);
    const { scale, offsetX, offsetY } = detectPixelScaleAndOffset(imageData);

    const output = resizePixelArtNode(imageData, scale, offsetX, offsetY);

    // The character's eyes are white pixels on a dark face
    // Find white pixels in the upper portion (head area)
    const headStartY = Math.floor(output.height * 0.15);
    const headEndY = Math.floor(output.height * 0.45);
    const centerX = Math.floor(output.width / 2);

    let leftWhitePixels = 0;
    let rightWhitePixels = 0;
    const whiteThreshold = 200;

    for (let y = headStartY; y < headEndY; y++) {
      for (let x = 0; x < output.width; x++) {
        const idx = (y * output.width + x) * 4;
        const r = output.data[idx];
        const g = output.data[idx + 1];
        const b = output.data[idx + 2];

        // Check if pixel is white/bright (eye pixels)
        if (r > whiteThreshold && g > whiteThreshold && b > whiteThreshold) {
          if (x < centerX) {
            leftWhitePixels++;
          } else {
            rightWhitePixels++;
          }
        }
      }
    }

    console.log(`\nSymmetry check for ${TEST_IMAGE}:`);
    console.log(`  Left side white pixels (head): ${leftWhitePixels}`);
    console.log(`  Right side white pixels (head): ${rightWhitePixels}`);

    // Eyes should be roughly symmetric (within 20% difference)
    const larger = Math.max(leftWhitePixels, rightWhitePixels);
    const smaller = Math.min(leftWhitePixels, rightWhitePixels);
    const symmetryRatio = larger > 0 ? smaller / larger : 0;

    console.log(`  Symmetry ratio: ${(symmetryRatio * 100).toFixed(1)}%`);

    // Should be at least 80% symmetric
    expect(symmetryRatio).toBeGreaterThan(0.8);
  });
});
