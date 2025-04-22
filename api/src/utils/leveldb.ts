import path from "path";
import fs from "fs/promises";

/**
 * Utility to copy a LevelDB directory to a temporary path if opening directly fails (e.g. database lock).
 */
export async function copyDirectory(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await copyDirectory(srcPath, destPath);
      } else if (entry.isFile()) {
        const data = await fs.readFile(srcPath);
        await fs.writeFile(destPath, data);
      }
    }),
  );
}
