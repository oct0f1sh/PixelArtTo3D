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
  ColorBox,
} from './types';

/** Threshold for considering a pixel transparent (alpha < 128) */
const TRANSPARENCY_THRESHOLD = 128;

/** Minimum allowed color count for quantization */
const MIN_COLOR_COUNT = 2;

/** Maximum allowed color count for quantization */
const MAX_COLOR_COUNT = 16;

/** Default color count for quantization */
const DEFAULT_COLOR_COUNT = 8;

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
 * Creates a ColorBox from an array of pixels
 */
function createColorBox(pixels: RGBAPixel[]): ColorBox {
  let rMin = 255, rMax = 0;
  let gMin = 255, gMax = 0;
  let bMin = 255, bMax = 0;

  for (const pixel of pixels) {
    rMin = Math.min(rMin, pixel.r);
    rMax = Math.max(rMax, pixel.r);
    gMin = Math.min(gMin, pixel.g);
    gMax = Math.max(gMax, pixel.g);
    bMin = Math.min(bMin, pixel.b);
    bMax = Math.max(bMax, pixel.b);
  }

  return { pixels, rMin, rMax, gMin, gMax, bMin, bMax };
}

/**
 * Finds the channel with the largest range in a ColorBox
 */
function getLargestChannel(box: ColorBox): 'r' | 'g' | 'b' {
  const rRange = box.rMax - box.rMin;
  const gRange = box.gMax - box.gMin;
  const bRange = box.bMax - box.bMin;

  if (rRange >= gRange && rRange >= bRange) {
    return 'r';
  } else if (gRange >= bRange) {
    return 'g';
  }
  return 'b';
}

/**
 * Splits a ColorBox at the median of its largest channel
 */
function splitBox(box: ColorBox): [ColorBox, ColorBox] {
  const channel = getLargestChannel(box);

  // Sort pixels by the largest channel
  const sortedPixels = [...box.pixels].sort((a, b) => a[channel] - b[channel]);

  // Split at median
  const medianIndex = Math.floor(sortedPixels.length / 2);
  const lowerPixels = sortedPixels.slice(0, medianIndex);
  const upperPixels = sortedPixels.slice(medianIndex);

  return [createColorBox(lowerPixels), createColorBox(upperPixels)];
}

/**
 * Calculates the volume of a ColorBox (product of channel ranges)
 */
function getBoxVolume(box: ColorBox): number {
  return (
    (box.rMax - box.rMin + 1) *
    (box.gMax - box.gMin + 1) *
    (box.bMax - box.bMin + 1)
  );
}

/**
 * Performs median-cut color quantization
 *
 * @param pixels - Array of opaque pixels to quantize
 * @param colorCount - Target number of colors (2-16)
 * @returns Array of Color objects representing the palette
 */
function medianCut(pixels: RGBAPixel[], colorCount: number): Color[] {
  if (pixels.length === 0) {
    return [];
  }

  // Clamp color count to valid range
  const targetColors = Math.max(MIN_COLOR_COUNT, Math.min(MAX_COLOR_COUNT, colorCount));

  // Start with one box containing all pixels
  const boxes: ColorBox[] = [createColorBox(pixels)];

  // Split boxes until we have the target number of colors
  while (boxes.length < targetColors) {
    // Find the box with the largest volume that can be split
    let maxVolume = -1;
    let maxIndex = -1;

    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].pixels.length >= 2) {
        const volume = getBoxVolume(boxes[i]);
        if (volume > maxVolume) {
          maxVolume = volume;
          maxIndex = i;
        }
      }
    }

    // If no box can be split, we're done
    if (maxIndex === -1) {
      break;
    }

    // Split the largest box
    const boxToSplit = boxes.splice(maxIndex, 1)[0];
    const [box1, box2] = splitBox(boxToSplit);

    // Only add boxes that have pixels
    if (box1.pixels.length > 0) {
      boxes.push(box1);
    }
    if (box2.pixels.length > 0) {
      boxes.push(box2);
    }
  }

  // Calculate average color for each box
  return boxes.map((box) => {
    let rSum = 0, gSum = 0, bSum = 0;
    for (const pixel of box.pixels) {
      rSum += pixel.r;
      gSum += pixel.g;
      bSum += pixel.b;
    }
    const count = box.pixels.length;
    return createColor(rSum / count, gSum / count, bSum / count);
  });
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
 * Quantizes the colors in an ImageData to a reduced palette using median-cut algorithm
 *
 * @param imageData - The source ImageData to quantize
 * @param colorCount - Target number of colors (default: 8, range: 2-16)
 * @returns QuantizedResult containing the palette and pixel grid
 */
export function quantizeColors(
  imageData: ImageData,
  colorCount: number = DEFAULT_COLOR_COUNT
): QuantizedResult {
  const { data, width, height } = imageData;

  // Clamp color count to valid range
  const targetColors = Math.max(MIN_COLOR_COUNT, Math.min(MAX_COLOR_COUNT, colorCount));

  // Extract non-transparent pixels for quantization
  const opaquePixels = extractOpaquePixels(imageData);

  // Generate palette using median-cut
  const palette = medianCut(opaquePixels, targetColors);

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
        // Find nearest color in palette
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
