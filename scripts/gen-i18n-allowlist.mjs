#!/usr/bin/env node
/**
 * `check-no-hardcoded-korean.mjs` 의 PENDING allowlist 를 **그 검사기 자신의
 * 스캐너로** 다시 만든다 (docs/20260811_three-features/03-i18n.md §5).
 *
 * 별도 grep 으로 목록을 만들면 검사기와 판정이 어긋나 "allowlist 에 없는데
 * 검사기는 잡는" 유령 위반이 생긴다. 같은 `scanSource` 를 쓰므로 그럴 수 없다.
 *
 * Phase 0 최초 시딩용. 이후에는 **줄이는 방향으로만** 손으로 편집한다 —
 * 이 스크립트를 다시 돌리면 Phase 2 진척이 되감긴다.
 *
 *   node scripts/gen-i18n-allowlist.mjs
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { scanSource } from "./check-no-hardcoded-korean.mjs";

const SRC = new URL("../src", import.meta.url).pathname;
const TARGET = new URL("./check-no-hardcoded-korean.mjs", import.meta.url).pathname;

const PERMANENT = new Set(["i18n/ko.ts", "i18n/en.ts"]);
const EXT = new Set([".ts", ".tsx"]);

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "legacy") continue;
      yield* walk(full);
    } else if (EXT.has(entry.name.slice(entry.name.lastIndexOf(".")))) yield full;
  }
}

const pending = [];
for await (const file of walk(SRC)) {
  const rel = relative(SRC, file).split("\\").join("/");
  if (PERMANENT.has(rel)) continue;
  if (scanSource(await readFile(file, "utf8")).length > 0) pending.push(rel);
}
pending.sort();

const block = pending.map((p) => `  ${JSON.stringify(p)},`).join("\n");
const src = await readFile(TARGET, "utf8");
const next = src.replace(
  /(\/\/ @PENDING_START[^\n]*\n)[\s\S]*?([ \t]*\/\/ @PENDING_END)/,
  (_m, start, end) => `${start}${block ? `${block}\n` : ""}${end}`,
);
if (next === src) {
  console.error("✗ @PENDING_START/@PENDING_END 마커를 찾지 못했습니다.");
  process.exit(1);
}
await writeFile(TARGET, next);
console.log(`✓ PENDING allowlist 시딩 완료 — ${pending.length}개 파일`);
