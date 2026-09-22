import { extname } from "node:path";
import { parseArgs } from "node:util";

export interface CliOptions {
  paths: string[];
  format: "text" | "json" | "mermaid" | "d2" | "svg";
  imagePath?: string;
  circular: boolean;
  cwd?: string;
  tsconfig?: string;
  includeNpm: boolean;
  includeTypeImports: boolean;
}

export function parseCliOptions(argv: readonly string[]): CliOptions {
  const parsed = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      cwd: { type: "string" },
      tsconfig: { type: "string" },
      "include-npm": { type: "boolean" },
      "no-type-imports": { type: "boolean" },
      circular: { type: "boolean" },
      json: { type: "boolean" },
      mermaid: { type: "boolean" },
      d2: { type: "boolean" },
      image: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  const values = parsed.values;
  const imagePath = typeof values.image === "string" ? values.image : undefined;
  const modes: CliOptions["format"][] = [];

  if (values.json === true) {
    modes.push("json");
  }
  if (values.mermaid === true) {
    modes.push("mermaid");
  }
  if (values.d2 === true) {
    modes.push("d2");
  }
  if (imagePath !== undefined) {
    if (extname(imagePath).toLowerCase() !== ".svg") {
      throw new Error("--image only supports .svg output files");
    }
    modes.push("svg");
  }

  if (modes.length > 1) {
    throw new Error("--json, --mermaid, --d2, and --image are mutually exclusive");
  }
  if (parsed.positionals.length === 0) {
    throw new Error("At least one input path is required");
  }

  const options: CliOptions = {
    paths: parsed.positionals,
    format: modes[0] ?? "text",
    circular: values.circular === true,
    includeNpm: values["include-npm"] === true,
    includeTypeImports: values["no-type-imports"] !== true,
  };

  if (imagePath !== undefined) {
    options.imagePath = imagePath;
  }
  if (typeof values.cwd === "string") {
    options.cwd = values.cwd;
  }
  if (typeof values.tsconfig === "string") {
    options.tsconfig = values.tsconfig;
  }

  return options;
}
