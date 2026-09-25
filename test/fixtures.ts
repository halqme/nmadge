import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyzer/analyze.ts";
import type { AnalyzeInput, AnalyzeOptions, AnalysisResult } from "../src/types.ts";

export function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}/`, import.meta.url));
}

export function analyzeFixture(
  name: string,
  input: AnalyzeInput = ".",
  options: Omit<AnalyzeOptions, "cwd"> = {},
): Promise<AnalysisResult> {
  return analyze(input, { ...options, cwd: fixturePath(name) });
}

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
  const root = await mkdtemp(join(tmpdir(), "oxdg-test-"));
  await writeFixtureFiles(root, files);
  return root;
}

export async function removeFixture(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}
