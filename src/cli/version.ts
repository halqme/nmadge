import { createRequire } from "node:module";

interface PackageMetadata {
  version?: unknown;
}

const require = createRequire(import.meta.url);
const packageMetadata = require("../../package.json") as PackageMetadata;

if (typeof packageMetadata.version !== "string") {
  throw new Error("package.json is missing a string version");
}

export const packageVersion = packageMetadata.version;
