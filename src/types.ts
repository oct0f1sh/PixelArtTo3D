/**
 * Type definitions for the Pixel Art to 3D Converter
 */

/**
 * Represents an RGB color with a hex string representation
 */
export interface Color {
  r: number;
  g: number;
  b: number;
  hex: string;
}

/**
 * 2D array of color indices into the palette.
 * -1 indicates a transparent pixel.
 * Index >= 0 refers to a color in the palette array.
 */
export type PixelGrid = number[][];

/**
 * Result of color quantization
 */
export interface QuantizedResult {
  /** Array of colors in the reduced palette */
  palette: Color[];
  /** 2D grid of color indices (-1 for transparent) */
  pixels: PixelGrid;
  /** Width of the pixel grid */
  width: number;
  /** Height of the pixel grid */
  height: number;
}

/**
 * Internal representation of a pixel with RGBA values and position
 */
export interface RGBAPixel {
  r: number;
  g: number;
  b: number;
  a: number;
  x: number;
  y: number;
}

/**
 * A box/bucket used in the median-cut algorithm
 */
export interface ColorBox {
  pixels: RGBAPixel[];
  rMin: number;
  rMax: number;
  gMin: number;
  gMax: number;
  bMin: number;
  bMax: number;
}

/**
 * Type of keychain hole
 */
export type KeyholeType = 'holepunch' | 'floating';

/**
 * Position on the model surface (normalized 0-1)
 */
export interface KeyholePosition {
  x: number;
  y: number;
}

/**
 * Configuration for keychain hole feature
 */
export interface KeyholeConfig {
  enabled: boolean;
  type: KeyholeType;
  position: KeyholePosition | null;
  /** Hole diameter in mm (for holepunch) */
  holeDiameter: number;
  /** Inner diameter in mm (for floating - the hole) */
  innerDiameter: number;
  /** Outer diameter in mm (for floating - total ring size) */
  outerDiameter: number;
}
