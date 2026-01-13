import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';

/**
 * Color type representing a color in the palette
 */
export interface Color {
  r: number;
  g: number;
  b: number;
  hex: string;
}

/**
 * Combines multiple BufferGeometries into a single merged geometry
 */
function mergeGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (geometries.length === 0) {
    return new THREE.BufferGeometry();
  }

  if (geometries.length === 1) {
    return geometries[0].clone();
  }

  // Calculate total vertex count and index count
  let totalVertices = 0;
  let totalIndices = 0;
  let hasIndices = true;

  for (const geometry of geometries) {
    const position = geometry.getAttribute('position');
    if (position) {
      totalVertices += position.count;
    }
    const index = geometry.getIndex();
    if (index) {
      totalIndices += index.count;
    } else {
      hasIndices = false;
    }
  }

  // Create merged arrays
  const mergedPositions = new Float32Array(totalVertices * 3);
  const mergedNormals = new Float32Array(totalVertices * 3);
  const mergedIndices = hasIndices ? new Uint32Array(totalIndices) : null;

  let vertexOffset = 0;
  let indexOffset = 0;
  let vertexIndexOffset = 0;

  for (const geometry of geometries) {
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');

    if (position) {
      const posArray = position.array as Float32Array;
      mergedPositions.set(posArray, vertexOffset * 3);

      if (normal) {
        const normArray = normal.array as Float32Array;
        mergedNormals.set(normArray, vertexOffset * 3);
      }

      const index = geometry.getIndex();
      if (index && mergedIndices) {
        const indexArray = index.array;
        for (let i = 0; i < index.count; i++) {
          mergedIndices[indexOffset + i] = indexArray[i] + vertexIndexOffset;
        }
        indexOffset += index.count;
      }

      vertexIndexOffset += position.count;
      vertexOffset += position.count;
    }
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(mergedPositions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(mergedNormals, 3));

  if (mergedIndices) {
    merged.setIndex(new THREE.BufferAttribute(mergedIndices, 1));
  }

  return merged;
}

/**
 * Triggers a download of a Blob with the specified filename
 */
function downloadBlob(blob: Blob, filename: string): void {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

/**
 * Exports multiple geometries to a binary STL file and triggers download
 * @param geometries - Array of BufferGeometry to export
 * @param filename - Name for the downloaded file (should end with .stl)
 */
export function exportSTL(geometries: THREE.BufferGeometry[], filename: string): void {
  if (geometries.length === 0) {
    throw new Error('No geometries provided for STL export');
  }

  // Merge all geometries into one
  const mergedGeometry = mergeGeometries(geometries);

  // Create a mesh from the merged geometry for the exporter
  const mesh = new THREE.Mesh(mergedGeometry);

  // Create an STL exporter and parse in binary mode
  const exporter = new STLExporter();
  const result = exporter.parse(mesh, { binary: true });

  // Create blob and trigger download
  const blob = new Blob([result as BlobPart], { type: 'application/octet-stream' });
  downloadBlob(blob, filename);

  // Clean up
  mergedGeometry.dispose();
}

/**
 * Converts a BufferGeometry to 3MF mesh XML format
 * Returns the vertices and triangles as XML strings
 */
function geometryToMeshXML(geometry: THREE.BufferGeometry): { vertices: string; triangles: string } {
  const position = geometry.getAttribute('position');
  if (!position) {
    return { vertices: '', triangles: '' };
  }

  const vertices: string[] = [];
  const triangles: string[] = [];

  // Extract vertices with consistent precision
  // Using 6 decimal places (micrometer precision for mm units)
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i).toFixed(6);
    const y = position.getY(i).toFixed(6);
    const z = position.getZ(i).toFixed(6);
    vertices.push(`        <vertex x="${x}" y="${y}" z="${z}" />`);
  }

  // Extract triangles
  const index = geometry.getIndex();
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const v1 = index.getX(i);
      const v2 = index.getX(i + 1);
      const v3 = index.getX(i + 2);
      triangles.push(`        <triangle v1="${v1}" v2="${v2}" v3="${v3}" />`);
    }
  } else {
    // Non-indexed geometry
    for (let i = 0; i < position.count; i += 3) {
      triangles.push(`        <triangle v1="${i}" v2="${i + 1}" v3="${i + 2}" />`);
    }
  }

  return {
    vertices: vertices.join('\n'),
    triangles: triangles.join('\n')
  };
}

/**
 * Converts an RGB color to sRGB hex format for 3MF
 */
function colorToHex(color: Color): string {
  const toHex = (n: number) => {
    const clamped = Math.max(0, Math.min(255, Math.round(n)));
    return clamped.toString(16).padStart(2, '0').toUpperCase();
  };
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
}

/**
 * Creates the 3D Model XML content for 3MF format
 */
function create3DModelXML(
  colorGeometries: Map<number, THREE.BufferGeometry>,
  baseGeometry: THREE.BufferGeometry,
  palette: Color[]
): string {
  const objects: string[] = [];
  const buildItems: string[] = [];
  let objectId = 1;

  // Create base material (gray)
  const baseMaterialId = 1;
  const colorMaterialStartId = 2;

  // Build materials XML
  const materials: string[] = [];
  materials.push(`      <base name="base_material" displaycolor="#808080" />`);

  // Add color materials
  const colorIndexToMaterialId = new Map<number, number>();
  let materialId = colorMaterialStartId;

  for (const [colorIndex] of colorGeometries) {
    if (colorIndex < palette.length) {
      const color = palette[colorIndex];
      const hex = colorToHex(color);
      materials.push(`      <base name="color_${colorIndex + 1}_material" displaycolor="${hex}" />`);
      colorIndexToMaterialId.set(colorIndex, materialId);
      materialId++;
    }
  }

  // Create base object
  if (baseGeometry) {
    const { vertices, triangles } = geometryToMeshXML(baseGeometry);
    if (vertices && triangles) {
      objects.push(`    <object id="${objectId}" name="base" pid="1" pindex="0" type="model">
      <mesh>
        <vertices>
${vertices}
        </vertices>
        <triangles>
${triangles}
        </triangles>
      </mesh>
    </object>`);
      buildItems.push(`    <item objectid="${objectId}" />`);
      objectId++;
    }
  }

  // Create color objects
  for (const [colorIndex, geometry] of colorGeometries) {
    const { vertices, triangles } = geometryToMeshXML(geometry);
    if (vertices && triangles) {
      const matId = colorIndexToMaterialId.get(colorIndex) || baseMaterialId;
      const pindex = matId - 1; // pindex is 0-based within the basematerials group
      objects.push(`    <object id="${objectId}" name="color_${colorIndex + 1}" pid="1" pindex="${pindex}" type="model">
      <mesh>
        <vertices>
${vertices}
        </vertices>
        <triangles>
${triangles}
        </triangles>
      </mesh>
    </object>`);
      buildItems.push(`    <item objectid="${objectId}" />`);
      objectId++;
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">
  <metadata name="Application">PixelArtConverter</metadata>
  <resources>
    <basematerials id="1">
${materials.join('\n')}
    </basematerials>
${objects.join('\n')}
  </resources>
  <build>
${buildItems.join('\n')}
  </build>
</model>`;
}

/**
 * Creates the Content_Types XML for 3MF format
 */
function createContentTypesXML(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
</Types>`;
}

/**
 * Creates the relationships XML for 3MF format
 */
function createRelationshipsXML(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`;
}

/**
 * Creates a ZIP file from a map of filenames to content
 * Uses the deflate-raw compression via CompressionStream where available,
 * falls back to store (no compression) if not available
 */
async function createZipBlob(files: Map<string, string | Uint8Array>): Promise<Blob> {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const centralDirectory: Uint8Array[] = [];
  let offset = 0;

  for (const [filename, content] of files) {
    const filenameBytes = encoder.encode(filename);
    const contentBytes = typeof content === 'string' ? encoder.encode(content) : content;

    // Store method (no compression) - simpler and more compatible
    const compressionMethod = 0;
    const compressedData = contentBytes;
    const compressedSize = compressedData.length;
    const uncompressedSize = contentBytes.length;

    // Calculate CRC32
    const crc = crc32(contentBytes);

    // Local file header
    const localHeader = new Uint8Array(30 + filenameBytes.length);
    const localView = new DataView(localHeader.buffer);

    localView.setUint32(0, 0x04034b50, true); // Local file header signature
    localView.setUint16(4, 20, true); // Version needed to extract
    localView.setUint16(6, 0, true); // General purpose bit flag
    localView.setUint16(8, compressionMethod, true); // Compression method
    localView.setUint16(10, 0, true); // File last modification time
    localView.setUint16(12, 0, true); // File last modification date
    localView.setUint32(14, crc, true); // CRC-32
    localView.setUint32(18, compressedSize, true); // Compressed size
    localView.setUint32(22, uncompressedSize, true); // Uncompressed size
    localView.setUint16(26, filenameBytes.length, true); // Filename length
    localView.setUint16(28, 0, true); // Extra field length
    localHeader.set(filenameBytes, 30);

    chunks.push(localHeader);
    chunks.push(compressedData);

    // Central directory file header
    const centralHeader = new Uint8Array(46 + filenameBytes.length);
    const centralView = new DataView(centralHeader.buffer);

    centralView.setUint32(0, 0x02014b50, true); // Central directory file header signature
    centralView.setUint16(4, 20, true); // Version made by
    centralView.setUint16(6, 20, true); // Version needed to extract
    centralView.setUint16(8, 0, true); // General purpose bit flag
    centralView.setUint16(10, compressionMethod, true); // Compression method
    centralView.setUint16(12, 0, true); // File last modification time
    centralView.setUint16(14, 0, true); // File last modification date
    centralView.setUint32(16, crc, true); // CRC-32
    centralView.setUint32(20, compressedSize, true); // Compressed size
    centralView.setUint32(24, uncompressedSize, true); // Uncompressed size
    centralView.setUint16(28, filenameBytes.length, true); // Filename length
    centralView.setUint16(30, 0, true); // Extra field length
    centralView.setUint16(32, 0, true); // File comment length
    centralView.setUint16(34, 0, true); // Disk number start
    centralView.setUint16(36, 0, true); // Internal file attributes
    centralView.setUint32(38, 0, true); // External file attributes
    centralView.setUint32(42, offset, true); // Relative offset of local header
    centralHeader.set(filenameBytes, 46);

    centralDirectory.push(centralHeader);

    offset += localHeader.length + compressedData.length;
  }

  // Add central directory
  const centralDirectoryOffset = offset;
  for (const header of centralDirectory) {
    chunks.push(header);
    offset += header.length;
  }

  // End of central directory record
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);

  eocdView.setUint32(0, 0x06054b50, true); // End of central directory signature
  eocdView.setUint16(4, 0, true); // Number of this disk
  eocdView.setUint16(6, 0, true); // Disk where central directory starts
  eocdView.setUint16(8, files.size, true); // Number of central directory records on this disk
  eocdView.setUint16(10, files.size, true); // Total number of central directory records
  eocdView.setUint32(12, offset - centralDirectoryOffset, true); // Size of central directory
  eocdView.setUint32(16, centralDirectoryOffset, true); // Offset of start of central directory
  eocdView.setUint16(20, 0, true); // Comment length

  chunks.push(eocd);

  return new Blob(chunks as BlobPart[], { type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' });
}

/**
 * CRC32 calculation for ZIP files
 */
function crc32(data: Uint8Array): number {
  // CRC32 lookup table
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }

  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Exports colored geometries to 3MF format and triggers download
 * @param colorGeometries - Map of color index to BufferGeometry for each color
 * @param baseGeometry - BufferGeometry for the base plate
 * @param palette - Array of Color objects representing the color palette
 * @param filename - Name for the downloaded file (should end with .3mf)
 */
export async function export3MF(
  colorGeometries: Map<number, THREE.BufferGeometry>,
  baseGeometry: THREE.BufferGeometry,
  palette: Color[],
  filename: string
): Promise<void> {
  // Validate inputs
  if (colorGeometries.size === 0 && !baseGeometry) {
    throw new Error('3MF export failed: No geometries provided');
  }

  if (!palette || palette.length === 0) {
    throw new Error('3MF export failed: No color palette provided');
  }

  try {
    // Create the 3MF package files
    const files = new Map<string, string>();

    // Content Types
    files.set('[Content_Types].xml', createContentTypesXML());

    // Relationships
    files.set('_rels/.rels', createRelationshipsXML());

    // 3D Model
    const modelXML = create3DModelXML(colorGeometries, baseGeometry, palette);
    files.set('3D/3dmodel.model', modelXML);

    // Create ZIP blob
    const zipBlob = await createZipBlob(files);

    // Trigger download
    downloadBlob(zipBlob, filename);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`3MF export failed: ${message}`);
  }
}
