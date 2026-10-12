import esbuild from "esbuild";
import { builtinModules } from "node:module";
import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const prod = process.argv[2] === "production";
const pluginDir = path.resolve(
  "../.obsidian/plugins/elevenlabs-reader",
);

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/state",
    "@codemirror/view",
    ...builtinModules,
    ...builtinModules.map((name) => `node:${name}`),
  ],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: path.join(pluginDir, "main.js"),
  plugins: [
    {
      name: "copy-manifest",
      setup(build) {
        build.onEnd(() => {
          mkdirSync(pluginDir, { recursive: true });
          cpSync("manifest.json", path.join(pluginDir, "manifest.json"));
          cpSync("styles.css", path.join(pluginDir, "styles.css"));
        });
      },
    },
  ],
});

if (prod) {
  await context.rebuild();
  process.exit(0);
}

await context.watch();
