import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export async function writeFixtureFiles(
  root: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [relativePath, source] of Object.entries(files)) {
    const filePath = join(root, relativePath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, source, "utf8");
  }
}

export async function createFixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nmadge-test-"));
  await writeFixtureFiles(root, files);
  return root;
}

export async function removeFixture(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}
