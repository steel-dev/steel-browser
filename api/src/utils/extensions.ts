import { mkdir } from "fs/promises";
import fs from "fs";
import path, { join } from "path";
import AdmZip from "adm-zip";

export class ExtensionConflictError extends Error {
  constructor(name: string) {
    super(`Extension with name '${name}' already exists`);
    this.name = 'ExtensionConflictError';
  }
}

export const extensionsDir = path.join(__dirname, "..", "..", "extensions");

export const defaultExtensions = ["recorder"];

export function getExtensionPaths(extensionNames: string[]): string[] {
  if (!fs.existsSync(extensionsDir)) {
    console.warn("Extensions directory does not exist");
    return [];
  }

  const allExtensions = fs.readdirSync(extensionsDir);

  return extensionNames
    .filter((name) => allExtensions.includes(name))
    .map((dir) => path.join(extensionsDir, dir))
    .filter((fullPath) => {
      if (fs.existsSync(fullPath)) {
        return true;
      } else {
        console.warn(`Extension directory ${fullPath} does not exist`);
        return false;
      }
    });
}

export async function installExtensionArchive(name: string, buffer: Buffer) {
    // Create directory for the extension
    const extensionDir = join(extensionsDir, name);
    await mkdir(extensionDir, { recursive: true });

    // Skip CRX header bytes to get to ZIP content
    // CRX v2: 16 bytes (magic number + version + pub key length + sig length)
    // CRX v3: 12 bytes (magic number + version + header length) + header
    const CRX2_HEADER_SIZE = 16;
    const CRX3_MIN_HEADER_SIZE = 12;
    const CRX_MAGIC_NUMBER = 'Cr24'; // 43 72 32 34

    let zipBuffer = buffer;
    if (buffer.length > 4 && buffer.toString('utf8', 0, 4) === CRX_MAGIC_NUMBER) {
      const version = buffer.readUInt32LE(4);
      if (version === 2) {
        zipBuffer = buffer.subarray(CRX2_HEADER_SIZE);
      } else if (version === 3) {
        const headerSize = buffer.readUInt32LE(8);
        zipBuffer = buffer.subarray(CRX3_MIN_HEADER_SIZE + headerSize);
      }
    }

    // Extract the file to the extension directory
    const zip = new AdmZip(zipBuffer);
    zip.extractAllTo(extensionDir, true);
}
