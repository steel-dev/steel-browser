import fs from "fs";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
export async function getExtensionPaths(extensionNames: string[]): Promise<string[]> {
  const extensionsDir = path.join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "extensions",
  );

  try {
    await fs.promises.access(extensionsDir);
  } catch {
    console.warn("Extensions directory does not exist");
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
        console.warn(`Extension directory ${fullPath} does not exist`);
        return { path: fullPath, valid: false };
      }
    }),
  );

  return validationResults.filter((result) => result.valid).map((result) => result.path);
}
