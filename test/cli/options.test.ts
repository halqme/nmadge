import { expect, test } from "bun:test";
import { parseCliOptions } from "../../src/cli/options.ts";

test("accepts image options on either side of the input and rejects invalid modes", () => {
  const inputFirst = parseCliOptions(["src", "--image", "x.svg"]);
  const optionFirst = parseCliOptions(["--image", "x.svg", "src"]);

  expect(inputFirst).toEqual({
    paths: ["src"],
    format: "svg",
    imagePath: "x.svg",
    circular: false,
    orphans: false,
    leaves: false,
    failOnCircular: false,
    includeNpm: false,
    includeTypeImports: true,
  });
  expect(optionFirst).toEqual(inputFirst);
  expect(() => parseCliOptions(["src", "--json", "--d2"])).toThrow("mutually exclusive");
  expect(() => parseCliOptions(["src", "--image", "graph.png"])).toThrow("only supports .svg");

  for (const args of [
    ["src", "--rankdir", "TB"],
    ["src", "--json", "--rankdir", "LR"],
    ["src", "--d2", "--rankdir", "RL"],
    ["src", "--leaves", "--rankdir", "BT"],
  ]) {
    expect(() => parseCliOptions(args)).toThrow("--rankdir can only be used");
  }
  expect(parseCliOptions(["src", "--mermaid", "--rankdir", "tb"]).rankdir).toBe("TB");
  expect(parseCliOptions(["src", "--image", "graph.svg", "--rankdir", "bt"]).rankdir).toBe("BT");
});

test("accepts options before, between, and after positional paths", () => {
  const inputFirst = parseCliOptions([
    "src",
    "--json",
    "--depends",
    "src/target.ts",
    "--exclude",
    "**/*.test.ts",
    "--cwd",
    "project",
  ]);
  const optionsFirst = parseCliOptions([
    "--exclude",
    "**/*.test.ts",
    "--cwd",
    "project",
    "--depends",
    "src/target.ts",
    "--json",
    "src",
  ]);
  const interleaved = parseCliOptions([
    "src",
    "--exclude",
    "**/*.test.ts",
    "--json",
    "--cwd",
    "project",
    "--depends",
    "src/target.ts",
  ]);

  expect(optionsFirst).toEqual(inputFirst);
  expect(interleaved).toEqual(inputFirst);
  expect(parseCliOptions(["src", "--json", "other"]).paths).toEqual(["src", "other"]);
});

test("parses Commander aliases and analysis options", () => {
  expect(parseCliOptions(["src", "-c"]).circular).toBe(true);
  expect(parseCliOptions(["src", "-j"]).format).toBe("json");
  expect(parseCliOptions(["src", "-i", "graph.svg"]).imagePath).toBe("graph.svg");
  expect(parseCliOptions(["src", "-d", "src/entry.ts"]).depends).toBe("src/entry.ts");

  expect(
    parseCliOptions([
      "src",
      "--orphans",
      "--extensions",
      "ts, .tsx",
      "--ts-config",
      "tsconfig.custom.json",
      "--exclude",
      "**/*.test.ts",
      "--exclude",
      "generated.ts",
      "--fail-on-circular",
    ]),
  ).toMatchObject({
    paths: ["src"],
    orphans: true,
    extensions: ["ts", ".tsx"],
    tsconfig: "tsconfig.custom.json",
    exclude: ["**/*.test.ts", "generated.ts"],
    failOnCircular: true,
  });
  expect(parseCliOptions(["src", "--no-type-imports"]).includeTypeImports).toBe(false);
  expect(() => parseCliOptions(["src", "--orphans", "--circular"])).toThrow(
    "cannot be combined with --circular",
  );
});
