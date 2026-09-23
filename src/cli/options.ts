import { Command, CommanderError, InvalidArgumentError } from "commander";
import { extname } from "node:path";
import { createExcludeMatcher } from "../analyzer/exclude.ts";
import type { GraphDirection } from "../types.ts";
import { packageVersion } from "./version.ts";

export interface CliOptions {
  paths: string[];
  format: "text" | "json" | "mermaid" | "d2" | "svg";
  imagePath?: string;
  circular: boolean;
  orphans: boolean;
  leaves: boolean;
  depends?: string;
  failOnCircular: boolean;
  rankdir?: GraphDirection;
  cwd?: string;
  tsconfig?: string;
  includeNpm: boolean;
  includeTypeImports: boolean;
  extensions?: string[];
  exclude?: string[];
  help?: boolean;
  version?: boolean;
}

export class CliUsageError extends Error {
  readonly reported: boolean;

  constructor(message: string, options: { cause?: unknown; reported?: boolean } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "CliUsageError";
    this.reported = options.reported ?? false;
  }
}

interface CommanderOptions {
  circular?: boolean;
  json?: boolean;
  mermaid?: boolean;
  d2?: boolean;
  image?: string;
  orphans?: boolean;
  leaves?: boolean;
  depends?: string;
  failOnCircular?: boolean;
  rankdir?: GraphDirection;
  cwd?: string;
  tsconfig?: string;
  tsConfig?: string;
  includeNpm?: boolean;
  typeImports?: boolean;
  extensions?: string[];
  exclude?: string[];
}

const GRAPH_DIRECTIONS = ["LR", "RL", "TB", "BT"] as const satisfies readonly GraphDirection[];

function parseExtensions(value: string): string[] {
  const extensions = value
    .split(",")
    .map((extension) => extension.trim())
    .filter((extension) => extension.length > 0);
  if (extensions.length === 0) {
    throw new InvalidArgumentError("expected a comma-separated extension list");
  }
  return extensions;
}

function collectExclude(value: string, previous: string[] = []): string[] {
  if (value.length === 0) {
    throw new InvalidArgumentError("exclude pattern must not be empty");
  }
  try {
    createExcludeMatcher([value]);
  } catch (error) {
    throw new InvalidArgumentError(error instanceof Error ? error.message : String(error));
  }
  return [...previous, value];
}

function parseRankdir(value: string): GraphDirection {
  const direction = value.toUpperCase() as GraphDirection;
  if (!GRAPH_DIRECTIONS.includes(direction)) {
    throw new InvalidArgumentError(`expected one of ${GRAPH_DIRECTIONS.join(", ")}`);
  }
  return direction;
}

function createProgram(): Command {
  return new Command()
    .name("oxdg")
    .usage("<path...> [options]")
    .description("Analyze JavaScript and TypeScript module dependencies.")
    .argument("<path...>", "file or directory to analyze")
    .option("-c, --circular", "show cycles, or render only the cyclic subgraph")
    .option("-j, --json", "render versioned graph JSON or JSON query results")
    .option("--mermaid", "render Mermaid flowchart syntax")
    .option("--d2", "render D2 source")
    .option("-i, --image <file.svg>", "write a standalone SVG file")
    .option("--orphans", "list modules without dependents")
    .option("--leaves", "list modules without dependencies")
    .option("-d, --depends <module>", "list modules that directly depend on a module")
    .option("--fail-on-circular", "exit with code 1 when circular dependencies are found")
    .option(
      "--rankdir <direction>",
      "graph direction (Mermaid/SVG only): LR, RL, TB, or BT",
      parseRankdir,
    )
    .option("--cwd <path>", "set the analysis root directory")
    .option("--tsconfig <path>", "use an explicit tsconfig.json")
    .option("--ts-config <path>", "alias for --tsconfig")
    .option("--include-npm", "include source files inside node_modules")
    .option("--no-type-imports", "exclude type-only imports")
    .option("--extensions <list>", "comma-separated source file extensions", parseExtensions)
    .option("--exclude <pattern>", "exclude a glob path pattern or regex:<pattern>", collectExclude)
    .helpOption("-h, --help", "show this help")
    .version(packageVersion, "-v, --version")
    .exitOverride();
}

function defaults(overrides: Partial<CliOptions> = {}): CliOptions {
  return {
    paths: [],
    format: "text",
    circular: false,
    orphans: false,
    leaves: false,
    failOnCircular: false,
    includeNpm: false,
    includeTypeImports: true,
    ...overrides,
  };
}

export function parseCliOptions(argv: readonly string[]): CliOptions {
  const program = createProgram();

  try {
    program.parse([...argv], { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.code === "commander.helpDisplayed") {
        return defaults({ help: true });
      }
      if (error.code === "commander.version") {
        return defaults({ version: true });
      }
      throw new CliUsageError(error.message, { cause: error, reported: true });
    }
    throw error;
  }

  const values = program.opts<CommanderOptions>();
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
      throw new CliUsageError("--image only supports .svg output files");
    }
    modes.push("svg");
  }

  if (modes.length > 1) {
    throw new CliUsageError("--json, --mermaid, --d2, and --image are mutually exclusive");
  }

  const queryCount = [
    values.orphans === true,
    values.leaves === true,
    values.depends !== undefined,
  ].filter(Boolean).length;
  if (queryCount > 1) {
    throw new CliUsageError("--orphans, --leaves, and --depends are mutually exclusive");
  }
  if (queryCount > 0 && values.circular === true) {
    throw new CliUsageError("query options cannot be combined with --circular");
  }
  if (queryCount > 0 && modes.some((mode) => mode !== "json")) {
    throw new CliUsageError("query options cannot be combined with a rendered output option");
  }
  const rankdirIsEffective = modes[0] === "mermaid" || modes[0] === "svg";
  if (values.rankdir !== undefined && (queryCount > 0 || !rankdirIsEffective)) {
    throw new CliUsageError("--rankdir can only be used with --mermaid or --image");
  }

  const tsconfig = values.tsconfig ?? values.tsConfig;
  if (values.tsconfig !== undefined && values.tsConfig !== undefined) {
    throw new CliUsageError("--tsconfig and --ts-config may not be used together");
  }

  const options = defaults({
    paths: program.args as string[],
    format: modes[0] ?? "text",
    circular: values.circular === true,
    orphans: values.orphans === true,
    leaves: values.leaves === true,
    failOnCircular: values.failOnCircular === true,
    includeNpm: values.includeNpm === true,
    includeTypeImports: values.typeImports !== false,
  });

  if (imagePath !== undefined) {
    options.imagePath = imagePath;
  }
  if (values.depends !== undefined) {
    options.depends = values.depends;
  }
  if (values.rankdir !== undefined) {
    options.rankdir = values.rankdir;
  }
  if (values.cwd !== undefined) {
    options.cwd = values.cwd;
  }
  if (tsconfig !== undefined) {
    options.tsconfig = tsconfig;
  }
  if (values.extensions !== undefined) {
    options.extensions = values.extensions;
  }
  if (values.exclude !== undefined && values.exclude.length > 0) {
    options.exclude = values.exclude;
  }

  return options;
}
