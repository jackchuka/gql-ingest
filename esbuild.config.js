import esbuild from "esbuild";

const build = async () => {
  // Build CLI
  await esbuild.build({
    entryPoints: ["src/cli.ts"],
    bundle: true,
    outfile: "dist/cli.js",
    platform: "node",
    target: "node18",
    format: "esm",
    minify: true,
    sourcemap: false,
    banner: {
      js: "#!/usr/bin/env node",
    },
    external: [
      // Keep external dependencies as external to reduce bundle size
      "csv-parser",
      "graphql-request",
      "commander",
    ],
  });

  console.log("✅ CLI bundled successfully");

  // Build library
  await esbuild.build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    outfile: "dist/index.js",
    platform: "node",
    target: "node18",
    format: "esm",
    minify: false,
    sourcemap: true,
    external: [
      // Keep all dependencies as external for library
      "csv-parser",
      "graphql-request",
      "commander",
      "js-yaml",
      "path",
      "fs",
      "graphql",
    ],
  });

  console.log("✅ Library bundled successfully");
};

build().catch((error) => {
  console.error("❌ Build failed:", error);
  process.exit(1);
});
