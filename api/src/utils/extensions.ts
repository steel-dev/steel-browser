import fs from "fs";
import path, { dirname } from "path";
import { fileURLToPath } from "url";

export function getExtensionPaths(extensionNames: string[]): string[] {
  const extensionsDir = path.join(dirname(fileURLToPath(import.meta.url)), "..", "..", "extensions");

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
