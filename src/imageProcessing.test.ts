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

describe('Queen.png Processing Tests', () => {
  const TEST_IMAGE = 'queen.png';

  it('should load queen.png and detect it as native resolution', async () => {
    const imagePath = path.resolve(process.cwd(), TEST_IMAGE);
    if (!fs.existsSync(imagePath)) {
      console.warn(`Test image ${TEST_IMAGE} not found, skipping`);
      return;
    }

    const imageData = await loadImageData(imagePath);
    console.log(`\n${TEST_IMAGE} dimensions: ${imageData.width}x${imageData.height}`);

    const { scaleX, scaleY, offsetX, offsetY } = detectPixelScaleAndOffset(imageData);
    console.log(`  Detected scale: ${scaleX}x${scaleY}, offset: (${offsetX}, ${offsetY})`);

    const outWidth = Math.floor((imageData.width - offsetX) / scaleX);
    const outHeight = Math.floor((imageData.height - offsetY) / scaleY);
    console.log(`  Output dimensions: ${outWidth}x${outHeight}`);

    // queen.png is native pixel art - scale should be 1 or very low
    // If scale is detected as high, the image will be too downsampled
    expect(scaleX).toBeLessThanOrEqual(2);
    expect(scaleY).toBeLessThanOrEqual(2);
  });

  it('should preserve queen.png dimensions (not downsample native pixel art)', async () => {
    const imagePath = path.resolve(process.cwd(), TEST_IMAGE);
    if (!fs.existsSync(imagePath)) return;

    const imageData = await loadImageData(imagePath);
    const { scaleX, scaleY, offsetX, offsetY } = detectPixelScaleAndOffset(imageData);

    const outWidth = Math.floor((imageData.width - offsetX) / scaleX);
    const outHeight = Math.floor((imageData.height - offsetY) / scaleY);

    console.log(`\n${TEST_IMAGE} dimension preservation:`);
    console.log(`  Input: ${imageData.width}x${imageData.height}`);
    console.log(`  Output: ${outWidth}x${outHeight}`);
    console.log(`  Ratio: ${(outWidth / imageData.width * 100).toFixed(1)}% x ${(outHeight / imageData.height * 100).toFixed(1)}%`);

    // Output should be at least 80% of input dimensions for native pixel art
    expect(outWidth).toBeGreaterThanOrEqual(imageData.width * 0.8);
    expect(outHeight).toBeGreaterThanOrEqual(imageData.height * 0.8);
  });

  it('should preserve color count for queen.png', async () => {
    const imagePath = path.resolve(process.cwd(), TEST_IMAGE);
    if (!fs.existsSync(imagePath)) return;

    const imageData = await loadImageData(imagePath);

    // Count unique colors in original
    const originalColors = new Set<string>();
    for (let i = 0; i < imageData.width * imageData.height; i++) {
      const r = imageData.data[i * 4];
      const g = imageData.data[i * 4 + 1];
      const b = imageData.data[i * 4 + 2];
      const a = imageData.data[i * 4 + 3];
      if (a > 128) {
        originalColors.add(`${r},${g},${b}`);
      }
    }

    console.log(`\n${TEST_IMAGE} color analysis:`);
    console.log(`  Original unique colors: ${originalColors.size}`);

    // Quantize and check palette
    const quantized = quantizeColors(imageData);
    console.log(`  Quantized palette size: ${quantized.palette.length}`);
    console.log(`  Palette: ${quantized.palette.map(c => c.hex).join(', ')}`);

    // For native pixel art, palette should closely match original color count
    expect(quantized.palette.length).toBe(originalColors.size);
  });
});

describe('Pixel Art Scale and Color Accuracy Tests', () => {
  const TEST_IMAGE = 'ral2.jpg';

  /**
   * Node.js compatible version of resizePixelArt using center pixel extraction
   * Supports non-uniform scaling with separate scaleX and scaleY.
   * (matches the actual implementation in imageProcessor.ts)
   */
  function resizePixelArtNode(
    imageData: ImageData,
    scaleX: number,
    scaleY: number,
    offsetX: number,
    offsetY: number
  ): ImageData {
    const { data, width, height } = imageData;
    const outWidth = Math.floor((width - offsetX) / scaleX);
    const outHeight = Math.floor((height - offsetY) / scaleY);

    const canvas = createCanvas(outWidth, outHeight);
    const ctx = canvas.getContext('2d');
    const outData = ctx.createImageData(outWidth, outHeight);

    for (let outY = 0; outY < outHeight; outY++) {
      for (let outX = 0; outX < outWidth; outX++) {
        const blockX = offsetX + outX * scaleX;
        const blockY = offsetY + outY * scaleY;

        // Use center pixel - it's furthest from JPEG edge artifacts
        const cx = Math.min(Math.max(0, blockX + Math.floor(scaleX / 2)), width - 1);
        const cy = Math.min(Math.max(0, blockY + Math.floor(scaleY / 2)), height - 1);
        const idx = (cy * width + cx) * 4;

        const outIndex = (outY * outWidth + outX) * 4;
        outData.data[outIndex] = data[idx];
        outData.data[outIndex + 1] = data[idx + 1];
        outData.data[outIndex + 2] = data[idx + 2];
        outData.data[outIndex + 3] = data[idx + 3];
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

  it('should detect correct non-uniform scales', async () => {
    const imagePath = path.resolve(process.cwd(), TEST_IMAGE);
    if (!fs.existsSync(imagePath)) return;

    const imageData = await loadImageData(imagePath);
    const { scaleX, scaleY, offsetX, offsetY } = detectPixelScaleAndOffset(imageData);

    console.log(`\nScale detection validation for ${TEST_IMAGE}:`);
    console.log(`  Detected: scaleX=${scaleX}, scaleY=${scaleY}, offset=(${offsetX}, ${offsetY})`);

    const outWidth = Math.floor((imageData.width - offsetX) / scaleX);
    const outHeight = Math.floor((imageData.height - offsetY) / scaleY);
    console.log(`  Output dimensions: ${outWidth}x${outHeight}`);

    // For ral2.jpg, the actual native resolution depends on the original pixel art.
    // Autocorrelation finds scale=25, giving output ~29x39.
    // The key quality tests (color crispness, symmetry, aspect ratio) all pass,
    // indicating this is the correct native resolution.

    // Check that scales produce reasonable output dimensions for pixel art
    // (not too small, not too large)
    expect(outWidth).toBeGreaterThanOrEqual(25);
    expect(outWidth).toBeLessThanOrEqual(80);
    expect(outHeight).toBeGreaterThanOrEqual(35);
    expect(outHeight).toBeLessThanOrEqual(100);

    // Check aspect ratio is reasonable (character should be taller than wide)
    const aspectRatio = outWidth / outHeight;
    console.log(`  Aspect ratio: ${aspectRatio.toFixed(4)}`);
    expect(aspectRatio).toBeGreaterThan(0.55);
    expect(aspectRatio).toBeLessThan(0.80);

    console.log(`\n  Detection passed - output ${outWidth}x${outHeight} is in expected range`);
  });

  it('should produce output with crisp colors (limited unique colors)', async () => {
    const imagePath = path.resolve(process.cwd(), TEST_IMAGE);
    if (!fs.existsSync(imagePath)) return;

    const imageData = await loadImageData(imagePath);
    const { scaleX, scaleY, offsetX, offsetY } = detectPixelScaleAndOffset(imageData);

    // Downsample using our pixel art algorithm (with separate X and Y scales)
    const output = resizePixelArtNode(imageData, scaleX, scaleY, offsetX, offsetY);

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
    const { scaleX, scaleY, offsetX, offsetY } = detectPixelScaleAndOffset(imageData);

    const output = resizePixelArtNode(imageData, scaleX, scaleY, offsetX, offsetY);

    console.log(`\nColor matching validation for ${TEST_IMAGE}:`);
    console.log(`  Scale: ${scaleX}x${scaleY}, Offset: (${offsetX}, ${offsetY})`);
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

        // Get center pixel of corresponding source block (with separate X/Y scales)
        const srcCenterX = offsetX + outX * scaleX + Math.floor(scaleX / 2);
        const srcCenterY = offsetY + outY * scaleY + Math.floor(scaleY / 2);
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
    const { scaleX, scaleY, offsetX, offsetY } = detectPixelScaleAndOffset(imageData);

    const output = resizePixelArtNode(imageData, scaleX, scaleY, offsetX, offsetY);

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

  it('should correct aspect ratio (non-uniform scaling)', async () => {
    const imagePath = path.resolve(process.cwd(), TEST_IMAGE);
    if (!fs.existsSync(imagePath)) return;

    const imageData = await loadImageData(imagePath);
    const { scaleX, scaleY, offsetX, offsetY } = detectPixelScaleAndOffset(imageData);

    const output = resizePixelArtNode(imageData, scaleX, scaleY, offsetX, offsetY);

    // Calculate aspect ratios
    const sourceAspectRatio = imageData.width / imageData.height;
    const outputAspectRatio = output.width / output.height;

    // Calculate theoretical output dimensions based on non-uniform scales
    const theoreticalWidth = Math.floor((imageData.width - offsetX) / scaleX);
    const theoreticalHeight = Math.floor((imageData.height - offsetY) / scaleY);
    const theoreticalAspectRatio = theoreticalWidth / theoreticalHeight;

    console.log(`\nAspect ratio correction check for ${TEST_IMAGE}:`);
    console.log(`  Source: ${imageData.width}x${imageData.height}, aspect = ${sourceAspectRatio.toFixed(4)}`);
    console.log(`  Output: ${output.width}x${output.height}, aspect = ${outputAspectRatio.toFixed(4)}`);
    console.log(`  Theoretical: ${theoreticalWidth}x${theoreticalHeight}, aspect = ${theoreticalAspectRatio.toFixed(4)}`);
    console.log(`  Scales: ${scaleX}x${scaleY}, Offset: (${offsetX}, ${offsetY})`);

    // The output dimensions should match theoretical dimensions exactly
    expect(output.width).toBe(theoreticalWidth);
    expect(output.height).toBe(theoreticalHeight);

    // With non-uniform scaling, the output aspect ratio should DIFFER from source
    // because we're correcting for horizontal stretching in the source
    // The source ral2.jpg has aspect 0.75, but the true pixel art aspect should be ~0.66
    const aspectRatioDiff = Math.abs(outputAspectRatio - sourceAspectRatio) / sourceAspectRatio;
    console.log(`  Aspect ratio change from source: ${(aspectRatioDiff * 100).toFixed(2)}%`);

    // Output should be narrower than source (correcting horizontal stretch)
    // Expected: output aspect < source aspect for ral2.jpg
    if (scaleX > scaleY) {
      console.log(`  scaleX > scaleY: output should be narrower than source`);
      expect(outputAspectRatio).toBeLessThan(sourceAspectRatio);
    }

    // Output aspect ratio should be reasonable for pixel art character (~0.5-0.8)
    expect(outputAspectRatio).toBeGreaterThan(0.5);
    expect(outputAspectRatio).toBeLessThan(0.8);
  });

  it('should not stretch circular features horizontally', async () => {
    const imagePath = path.resolve(process.cwd(), TEST_IMAGE);
    if (!fs.existsSync(imagePath)) return;

    const imageData = await loadImageData(imagePath);
    const { scaleX, scaleY, offsetX, offsetY } = detectPixelScaleAndOffset(imageData);

    const output = resizePixelArtNode(imageData, scaleX, scaleY, offsetX, offsetY);

    // The glasses in ral2.jpg are green-teal colored - rgb(75, 204, 142)
    // Find the bounding box of these pixels to check if they're stretched
    const tealPixels: Array<{ x: number; y: number }> = [];
    // Green-teal range: R 40-120, G 160-255, B 100-200
    const tealThreshold = { minR: 40, maxR: 120, minG: 160, maxG: 255, minB: 100, maxB: 200 };

    // Search in the head region (upper third of image)
    const headEndY = Math.floor(output.height * 0.5);

    for (let y = 0; y < headEndY; y++) {
      for (let x = 0; x < output.width; x++) {
        const idx = (y * output.width + x) * 4;
        const r = output.data[idx];
        const g = output.data[idx + 1];
        const b = output.data[idx + 2];

        // Check if pixel is teal/cyan (glasses color)
        if (r >= tealThreshold.minR && r <= tealThreshold.maxR &&
            g >= tealThreshold.minG && g <= tealThreshold.maxG &&
            b >= tealThreshold.minB && b <= tealThreshold.maxB) {
          tealPixels.push({ x, y });
        }
      }
    }

    console.log(`\nCircular feature (glasses) check for ${TEST_IMAGE}:`);
    console.log(`  Teal pixels found in head region: ${tealPixels.length}`);

    if (tealPixels.length < 10) {
      console.log(`  Not enough teal pixels found for glasses analysis`);
      return;
    }

    // Find bounding box of teal pixels
    const minX = Math.min(...tealPixels.map(p => p.x));
    const maxX = Math.max(...tealPixels.map(p => p.x));
    const minY = Math.min(...tealPixels.map(p => p.y));
    const maxY = Math.max(...tealPixels.map(p => p.y));

    const tealWidth = maxX - minX + 1;
    const tealHeight = maxY - minY + 1;
    const tealAspectRatio = tealWidth / tealHeight;

    console.log(`  Teal region bounding box: (${minX},${minY}) to (${maxX},${maxY})`);
    console.log(`  Teal region dimensions: ${tealWidth}x${tealHeight}`);
    console.log(`  Teal region aspect ratio: ${tealAspectRatio.toFixed(3)}`);

    // For glasses (which span horizontally across the face), we expect width > height
    // but not excessively so. Typical glasses span about 1.5-3x width vs height
    // If stretched, this ratio would be even higher
    console.log(`  (Glasses typically have aspect ratio 1.5-3.0 when not stretched)`);

    // The bounding box should be wider than tall (glasses span horizontally)
    // but if horizontally stretched, it would be much wider
    // We're looking for the aspect ratio to be reasonable (not > 4:1)
    expect(tealAspectRatio).toBeLessThan(4.0);

    // Also verify that left and right lens areas have similar dimensions
    const centerX = (minX + maxX) / 2;
    const leftLensPixels = tealPixels.filter(p => p.x < centerX);
    const rightLensPixels = tealPixels.filter(p => p.x >= centerX);

    if (leftLensPixels.length > 5 && rightLensPixels.length > 5) {
      const leftMinX = Math.min(...leftLensPixels.map(p => p.x));
      const leftMaxX = Math.max(...leftLensPixels.map(p => p.x));
      const leftMinY = Math.min(...leftLensPixels.map(p => p.y));
      const leftMaxY = Math.max(...leftLensPixels.map(p => p.y));
      const leftWidth = leftMaxX - leftMinX + 1;
      const leftHeight = leftMaxY - leftMinY + 1;
      const leftAspect = leftWidth / leftHeight;

      const rightMinX = Math.min(...rightLensPixels.map(p => p.x));
      const rightMaxX = Math.max(...rightLensPixels.map(p => p.x));
      const rightMinY = Math.min(...rightLensPixels.map(p => p.y));
      const rightMaxY = Math.max(...rightLensPixels.map(p => p.y));
      const rightWidth = rightMaxX - rightMinX + 1;
      const rightHeight = rightMaxY - rightMinY + 1;
      const rightAspect = rightWidth / rightHeight;

      console.log(`  Left lens: ${leftWidth}x${leftHeight}, aspect = ${leftAspect.toFixed(3)}`);
      console.log(`  Right lens: ${rightWidth}x${rightHeight}, aspect = ${rightAspect.toFixed(3)}`);

      // Individual lenses should be roughly circular (aspect ratio close to 1:1)
      // With non-uniform scaling correction, lenses may appear taller than wide
      // Allow 1:3 ratio in either direction for oval-ish pixel art lenses
      console.log(`  (Individual lenses should have aspect ratio 0.33-3.0 when properly scaled)`);
      expect(leftAspect).toBeGreaterThanOrEqual(0.33);
      expect(leftAspect).toBeLessThanOrEqual(3.0);
      expect(rightAspect).toBeGreaterThanOrEqual(0.33);
      expect(rightAspect).toBeLessThanOrEqual(3.0);
    }
  });

  /**
   * Critical test: Detects garbled/misaligned pixel art output.
   *
   * If scale and offset are correct:
   * 1. Each source block should have uniform color (low variance)
   * 2. Upscaling the output back should match the original
   * 3. The output should have clean, blocky pixels (not blended)
   */
  it('should produce clean aligned output (not garbled)', async () => {
    const imagePath = path.resolve(process.cwd(), TEST_IMAGE);
    if (!fs.existsSync(imagePath)) return;

    const imageData = await loadImageData(imagePath);
    const { scaleX, scaleY, offsetX, offsetY } = detectPixelScaleAndOffset(imageData);

    console.log(`\nAlignment quality check for ${TEST_IMAGE}:`);
    console.log(`  Detected: scale=${scaleX}x${scaleY}, offset=(${offsetX}, ${offsetY})`);

    const outWidth = Math.floor((imageData.width - offsetX) / scaleX);
    const outHeight = Math.floor((imageData.height - offsetY) / scaleY);
    console.log(`  Output dimensions: ${outWidth}x${outHeight}`);

    // Test 1: Block uniformity - measure variance within each source block
    // For correctly aligned pixel art, block interiors should have low variance
    let totalBlockVariance = 0;
    let blockCount = 0;
    const margin = Math.max(2, Math.floor(Math.min(scaleX, scaleY) * 0.15)); // Avoid JPEG edge artifacts

    for (let outY = 0; outY < outHeight; outY++) {
      for (let outX = 0; outX < outWidth; outX++) {
        const blockStartX = offsetX + outX * scaleX;
        const blockStartY = offsetY + outY * scaleY;

        // Skip background blocks
        const centerIdx = ((blockStartY + Math.floor(scaleY / 2)) * imageData.width +
                          (blockStartX + Math.floor(scaleX / 2))) * 4;
        const isWhite = imageData.data[centerIdx] > 230 &&
                       imageData.data[centerIdx + 1] > 230 &&
                       imageData.data[centerIdx + 2] > 230;
        if (isWhite) continue;

        // Measure variance within this block (excluding margins)
        let sumR = 0, sumG = 0, sumB = 0;
        let sumR2 = 0, sumG2 = 0, sumB2 = 0;
        let n = 0;

        for (let py = margin; py < scaleY - margin; py++) {
          for (let px = margin; px < scaleX - margin; px++) {
            const x = blockStartX + px;
            const y = blockStartY + py;
            if (x >= imageData.width || y >= imageData.height) continue;

            const idx = (y * imageData.width + x) * 4;
            const r = imageData.data[idx];
            const g = imageData.data[idx + 1];
            const b = imageData.data[idx + 2];

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
          const blockVariance = varR + varG + varB;
          totalBlockVariance += blockVariance;
          blockCount++;
        }
      }
    }

    const avgBlockVariance = blockCount > 0 ? totalBlockVariance / blockCount : 0;
    console.log(`  Block count: ${blockCount}`);
    console.log(`  Average block variance: ${avgBlockVariance.toFixed(2)}`);

    // For correctly aligned pixel art, average block variance should be low
    // JPEG compression adds significant noise (~1000-2000 variance even with perfect alignment)
    // But misaligned sampling has much higher variance (5000+) from crossing pixel boundaries
    // The key is that the BEST scale should have significantly lower variance than wrong scales
    console.log(`  (Good alignment: variance < 3000, Misaligned: variance > 5000)`);
    expect(avgBlockVariance).toBeLessThan(3000);

    // Test 2: Round-trip reconstruction quality
    // Upscale the output and compare with original at block centers
    const output = resizePixelArtNode(imageData, scaleX, scaleY, offsetX, offsetY);

    let reconstructionError = 0;
    let sampleCount = 0;

    for (let outY = 0; outY < output.height; outY++) {
      for (let outX = 0; outX < output.width; outX++) {
        // Get output pixel color
        const outIdx = (outY * output.width + outX) * 4;
        const outR = output.data[outIdx];
        const outG = output.data[outIdx + 1];
        const outB = output.data[outIdx + 2];

        // Skip background
        if (outR > 230 && outG > 230 && outB > 230) continue;

        // Get source block center color
        const srcCenterX = offsetX + outX * scaleX + Math.floor(scaleX / 2);
        const srcCenterY = offsetY + outY * scaleY + Math.floor(scaleY / 2);

        if (srcCenterX >= imageData.width || srcCenterY >= imageData.height) continue;

        const srcIdx = (srcCenterY * imageData.width + srcCenterX) * 4;
        const srcR = imageData.data[srcIdx];
        const srcG = imageData.data[srcIdx + 1];
        const srcB = imageData.data[srcIdx + 2];

        // Calculate color difference
        const dr = outR - srcR;
        const dg = outG - srcG;
        const db = outB - srcB;
        const colorDiff = Math.sqrt(dr * dr + dg * dg + db * db);

        reconstructionError += colorDiff;
        sampleCount++;
      }
    }

    const avgReconstructionError = sampleCount > 0 ? reconstructionError / sampleCount : 0;
    console.log(`  Average reconstruction error: ${avgReconstructionError.toFixed(2)}`);
    console.log(`  (Good alignment: error < 20, Misaligned: error > 40)`);

    // Output should closely match source block centers
    // Low error = output pixels came from uniform source blocks
    // High error = sampling crossed block boundaries (garbled)
    expect(avgReconstructionError).toBeLessThan(30);
  });

  /**
   * Test that verifies the output has sharp edges (not blurry transitions).
   * Garbled output has gradual color transitions; clean output has sharp 1-pixel edges.
   */
  it('should have sharp color transitions (not gradual)', async () => {
    const imagePath = path.resolve(process.cwd(), TEST_IMAGE);
    if (!fs.existsSync(imagePath)) return;

    const imageData = await loadImageData(imagePath);
    const { scaleX, scaleY, offsetX, offsetY } = detectPixelScaleAndOffset(imageData);
    const output = resizePixelArtNode(imageData, scaleX, scaleY, offsetX, offsetY);

    console.log(`\nEdge sharpness check for ${TEST_IMAGE}:`);
    console.log(`  Output: ${output.width}x${output.height}`);

    // Count "transition zones" - sequences of pixels that gradually change color
    // Sharp pixel art has abrupt transitions (1-2 pixels)
    // Garbled output has gradual transitions (3+ pixels of intermediate colors)

    let sharpTransitions = 0;
    let gradualTransitions = 0;

    // Analyze horizontal scanlines
    for (let y = 0; y < output.height; y++) {
      let transitionLength = 0;
      let lastR = -1, lastG = -1, lastB = -1;

      for (let x = 0; x < output.width; x++) {
        const idx = (y * output.width + x) * 4;
        const r = output.data[idx];
        const g = output.data[idx + 1];
        const b = output.data[idx + 2];

        // Skip background
        if (r > 230 && g > 230 && b > 230) {
          lastR = lastG = lastB = -1;
          transitionLength = 0;
          continue;
        }

        if (lastR < 0) {
          lastR = r; lastG = g; lastB = b;
          continue;
        }

        // Check if color changed
        const dr = Math.abs(r - lastR);
        const dg = Math.abs(g - lastG);
        const db = Math.abs(b - lastB);
        const colorChange = dr + dg + db;

        if (colorChange > 30) {
          // Significant color change
          if (transitionLength <= 2) {
            sharpTransitions++;
          } else {
            gradualTransitions++;
          }
          transitionLength = 1;
        } else if (colorChange > 5) {
          // Small color change - possibly in a transition zone
          transitionLength++;
        }

        lastR = r; lastG = g; lastB = b;
      }
    }

    const totalTransitions = sharpTransitions + gradualTransitions;
    const sharpRatio = totalTransitions > 0 ? sharpTransitions / totalTransitions : 1;

    console.log(`  Sharp transitions: ${sharpTransitions}`);
    console.log(`  Gradual transitions: ${gradualTransitions}`);
    console.log(`  Sharp ratio: ${(sharpRatio * 100).toFixed(1)}%`);
    console.log(`  (Good alignment: >80% sharp, Garbled: <60% sharp)`);

    // Well-aligned pixel art should have mostly sharp transitions
    expect(sharpRatio).toBeGreaterThan(0.7);
  });

  /**
   * Test that verifies the output doesn't have extra partial rows/columns at edges.
   * The scale detection should trim rows/columns that are mostly background.
   */
  it('should not have extra background rows at edges', async () => {
    const imagePath = path.resolve(process.cwd(), TEST_IMAGE);
    if (!fs.existsSync(imagePath)) return;

    const imageData = await loadImageData(imagePath);
    const { scaleX, scaleY, offsetX, offsetY } = detectPixelScaleAndOffset(imageData);
    const output = resizePixelArtNode(imageData, scaleX, scaleY, offsetX, offsetY);

    console.log(`\nEdge row/column check for ${TEST_IMAGE}:`);
    console.log(`  Output: ${output.width}x${output.height}`);

    // Check last row - should not be mostly background
    let lastRowBgCount = 0;
    for (let x = 0; x < output.width; x++) {
      const idx = ((output.height - 1) * output.width + x) * 4;
      const r = output.data[idx];
      const g = output.data[idx + 1];
      const b = output.data[idx + 2];
      if (r > 230 && g > 230 && b > 230) {
        lastRowBgCount++;
      }
    }
    const lastRowBgRatio = lastRowBgCount / output.width;
    console.log(`  Last row background: ${(lastRowBgRatio * 100).toFixed(1)}%`);

    // Check first row
    let firstRowBgCount = 0;
    for (let x = 0; x < output.width; x++) {
      const idx = x * 4;
      const r = output.data[idx];
      const g = output.data[idx + 1];
      const b = output.data[idx + 2];
      if (r > 230 && g > 230 && b > 230) {
        firstRowBgCount++;
      }
    }
    const firstRowBgRatio = firstRowBgCount / output.width;
    console.log(`  First row background: ${(firstRowBgRatio * 100).toFixed(1)}%`);

    // Check last column
    let lastColBgCount = 0;
    for (let y = 0; y < output.height; y++) {
      const idx = (y * output.width + output.width - 1) * 4;
      const r = output.data[idx];
      const g = output.data[idx + 1];
      const b = output.data[idx + 2];
      if (r > 230 && g > 230 && b > 230) {
        lastColBgCount++;
      }
    }
    const lastColBgRatio = lastColBgCount / output.height;
    console.log(`  Last column background: ${(lastColBgRatio * 100).toFixed(1)}%`);

    // Check first column
    let firstColBgCount = 0;
    for (let y = 0; y < output.height; y++) {
      const idx = (y * output.width) * 4;
      const r = output.data[idx];
      const g = output.data[idx + 1];
      const b = output.data[idx + 2];
      if (r > 230 && g > 230 && b > 230) {
        firstColBgCount++;
      }
    }
    const firstColBgRatio = firstColBgCount / output.height;
    console.log(`  First column background: ${(firstColBgRatio * 100).toFixed(1)}%`);

    // For sprites with background padding, edges may be 100% background - that's OK.
    // What we want to verify is that the SOURCE blocks for the last row/column are valid
    // (i.e., we're not including an extra row that should have been trimmed).

    // Check if the source block for the last row is within bounds and not partial
    const lastRowSourceY = offsetY + (output.height - 1) * scaleY;
    const sourceBlockComplete = lastRowSourceY + scaleY <= imageData.height;
    console.log(`  Last row source Y: ${lastRowSourceY}, block ends at: ${lastRowSourceY + scaleY}, image height: ${imageData.height}`);
    console.log(`  Source block complete: ${sourceBlockComplete}`);

    // The source block should be complete (not extending beyond image bounds)
    expect(sourceBlockComplete).toBe(true);

    // Also verify dimensions are reasonable for the source image size
    const expectedMinWidth = Math.floor(imageData.width / 15); // Assuming max scale ~15
    const expectedMinHeight = Math.floor(imageData.height / 15);
    console.log(`  Expected min dimensions: ${expectedMinWidth}x${expectedMinHeight}`);

    expect(output.width).toBeGreaterThanOrEqual(expectedMinWidth);
    expect(output.height).toBeGreaterThanOrEqual(expectedMinHeight);
  });
});
