import { build } from "esbuild";

await build({
  entryPoints: ["src/inject.js", "src/background.js"],
  bundle: true,
  format: "iife",
  outdir: "dist",
  define: {
    "process.env.PORT": JSON.stringify(process.env.PORT || "3000"),
  },
});
