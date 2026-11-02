// 한 파일 번들 — `vscode` 만 바깥(호스트가 준다). 런타임 의존성은 없다.
import * as esbuild from "esbuild";

const production = process.argv.includes("--production");
await esbuild.build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  outfile: "dist/extension.js",
  external: ["vscode"],
  logLevel: "warning",
});
