import fs from "fs";
import path, { dirname } from "path";
import { fileURLToPath } from "url";

export async function getExtensionPaths(extensionNames: string[]): Promise<string[]> {
  // Try to find extensions directory relative to this package
  // In the steel repo, it's at apps/steel-browser/api/extensions/
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const extensionsDir = path.resolve(currentDir, "../../../extensions");

  try {
    await fs.promises.access(extensionsDir);
  } catch {
    console.warn("[Extensions] Extensions directory does not exist at:", extensionsDir);
    return [];
  }

  const allExtensions = await fs.promises.readdir(extensionsDir);

  const candidatePaths = extensionNames
    .filter((name) => allExtensions.includes(name))
    .map((dir) => path.join(extensionsDir, dir));

  const validationResults = await Promise.all(
    candidatePaths.map(async (fullPath) => {
      try {
        await fs.promises.access(fullPath);
        return { path: fullPath, valid: true };
      } catch {
        console.warn(`[Extensions] Extension directory ${fullPath} does not exist`);
        return { path: fullPath, valid: false };
      }
    }),
  );

  return validationResults.filter((result) => result.valid).map((result) => result.path);
}
