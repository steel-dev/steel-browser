import fs from "fs/promises";
import path from "path";

export async function clearUserDataDir(userDataDir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(userDataDir);
  } catch (err: any) {
    if (err.code === "ENOENT") return;
    throw err;
  }

  await Promise.all(
    entries.map((entry) =>
      fs.rm(path.join(userDataDir, entry), { recursive: true, force: true }),
    ),
  );
}
