import * as esbuild from "npm:esbuild";
import inlineWorkerPlugin from "npm:esbuild-plugin-inline-worker";
import { denoPlugins } from "jsr:@luca/esbuild-deno-loader";

// Polyfill for Node.js require() to handle built-in modules in Deno
// This is injected at the top of the bundle to handle dynamic requires from npm packages
const requirePolyfill = `
import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);
`;

const result = await esbuild.build({
  plugins: [inlineWorkerPlugin(), ...denoPlugins()],
  entryPoints: ["./server.ts"],
  outfile: "./bundled.js",
  bundle: true,
  format: "esm",
  banner: {
    js: requirePolyfill,
  },
});

esbuild.stop();