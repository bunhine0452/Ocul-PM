#!/usr/bin/env node
// 진입 청크 실측 스크립트 ({#entry-chunk}) — vite.config.ts 를 건드리지 않고
// 프로덕션 빌드를 한 번 돌려, HTML 이 실제로 <script src> 로 참조하는 진짜
// 진입 청크 안에 "무엇이 들었는지" 모듈 단위 크기로 뽑는다.
//
// 방법: vite 의 build() 노드 API 를 그대로 불러 기존 vite.config.ts 를
// mergeConfig 로 얹고, 작은 rollup 플러그인 하나(generateBundle 훅)를 얹어
// 번들 청크의 modules 맵(모듈별 렌더된 코드 길이)을 dist 밖(별도 출력 폴더)에
// 찍는다. 새 의존성 없음 — vite/rollup 이 이미 devDependency.
import { build, loadConfigFromFile, mergeConfig } from "vite";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = "dist-measure";

/** @type {import('vite').Plugin} */
const measurePlugin = {
  name: "measure-entry-chunk",
  generateBundle(_opts, bundle) {
    const chunks = Object.values(bundle).filter((c) => c.type === "chunk");
    const entry = chunks.find((c) => c.isEntry);
    const report = {
      entry: entry
        ? {
            fileName: entry.fileName,
            bytes: Buffer.byteLength(entry.code, "utf8"),
            modules: Object.entries(entry.modules)
              .map(([id, m]) => ({
                id: id.replace(root + "/", ""),
                bytes: m.renderedLength,
                // 왜 이 모듈이 진입 청크에 들어왔는지 — 정적으로 임포트한
                // 모듈 목록(누가 이걸 끌어왔는지 역추적하려고 importers 도 함께).
                importers: (this.getModuleInfo(id)?.importers ?? []).map((i) =>
                  i.replace(root + "/", ""),
                ),
              }))
              .sort((a, b) => b.bytes - a.bytes),
          }
        : null,
      allChunks: chunks
        .map((c) => ({ fileName: c.fileName, bytes: Buffer.byteLength(c.code, "utf8"), isEntry: !!c.isEntry }))
        .sort((a, b) => b.bytes - a.bytes),
    };
    fs.mkdirSync(path.resolve(root, outDir), { recursive: true });
    fs.writeFileSync(
      path.resolve(root, outDir, "report.json"),
      JSON.stringify(report, null, 2),
    );
  },
};

const loaded = await loadConfigFromFile({ command: "build", mode: "production" }, undefined, root);
if (!loaded) throw new Error("vite.config.ts 를 못 불러왔다");

const merged = mergeConfig(loaded.config, {
  root,
  configFile: false,
  build: {
    outDir,
    emptyOutDir: true,
    // 경고 로그로 흐려지지 않게 리포트만 본다 — 사이즈 경고 자체는 pnpm build 로 확인.
    chunkSizeWarningLimit: 100_000,
  },
  plugins: [measurePlugin],
});

await build(merged);

const report = JSON.parse(fs.readFileSync(path.resolve(root, outDir, "report.json"), "utf8"));
const fmt = (n) => (n / 1024).toFixed(2) + " kB";

console.log(`\n=== 진짜 진입 청크 (index.html <script src>) ===`);
console.log(`${report.entry.fileName}  ${fmt(report.entry.bytes)}`);
console.log(`\n상위 기여 모듈 (렌더된 코드 길이 기준):`);
for (const m of report.entry.modules.slice(0, 30)) {
  console.log(`  ${fmt(m.bytes).padStart(10)}  ${m.id}`);
  if (m.importers.length) console.log(`             ← ${m.importers.join(", ")}`);
}

console.log(`\n=== 전체 청크 중 상위 10 (entry 여부 무관) ===`);
for (const c of report.allChunks.slice(0, 10)) {
  console.log(`  ${fmt(c.bytes).padStart(10)}  ${c.fileName}${c.isEntry ? "  [ENTRY]" : ""}`);
}
