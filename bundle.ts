import * as esbuild from "npm:esbuild";
import inlineWorkerPlugin from "npm:esbuild-plugin-inline-worker";
import { denoPlugins } from "jsr:@luca/esbuild-deno-loader";

const result = await esbuild.build({
  plugins: [inlineWorkerPlugin(), ...denoPlugins()],
  entryPoints: ["./server.ts"],
  outfile: "./bundled.js",
  bundle: true,
  format: "esm",
});

esbuild.stop();