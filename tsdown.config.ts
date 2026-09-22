import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "cli/main": "src/cli/main.ts",
  },
  format: "esm",
  platform: "node",
  dts: true,
  sourcemap: true,
  clean: true,
  // Keep the emitted names aligned with package.json's .js/.d.ts exports.
  fixedExtension: false,
  deps: {
    neverBundle: ["@dagrejs/dagre", "oxc-parser", "oxc-resolver", "oxc-walker"],
  },
  minify: false,
});
