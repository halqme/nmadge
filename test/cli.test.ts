import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "bun:test";
import { parseCliOptions } from "../src/cli/options.ts";

function runCli(...args: string[]): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const cliPath = join(dirname(fileURLToPath(import.meta.url)), "../src/cli/main.ts");
  const result = spawnSync(process.execPath, [cliPath, ...args], { encoding: "utf8" });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

test("accepts image options on either side of the input and rejects invalid modes", () => {
  const inputFirst = parseCliOptions(["src", "--image", "x.svg"]);
  const optionFirst = parseCliOptions(["--image", "x.svg", "src"]);

  expect(inputFirst).toEqual({
    paths: ["src"],
    format: "svg",
    imagePath: "x.svg",
    circular: false,
    includeNpm: false,
    includeTypeImports: true,
  });
  expect(optionFirst).toEqual(inputFirst);
  expect(() => parseCliOptions(["src", "--json", "--d2"])).toThrow("mutually exclusive");
  expect(() => parseCliOptions(["src", "--image", "graph.png"])).toThrow("only supports .svg");
});

test("runs help and version without an input path", () => {
  const help = runCli("--help");
  expect(help.status).toBe(0);
  expect(help.stderr).toBe("");
  expect(help.stdout).toContain("Usage: nmadge <path...> [options]");

  const version = runCli("--version");
  expect(version.status).toBe(0);
  expect(version.stderr).toBe("");
  expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
});
