#!/usr/bin/env node
/**
 * 드라이런 버전 — 러너의 작업 폴더에서만 6 버전 파일을 가짜 버전으로 (크로스플랫폼 W4 · L-REL).
 *
 * release.yml 의 workflow_dispatch 드라이런은 태그 없이 `v0.0.<run_number>` draft 를 만든다.
 * 설치 파일 이름·deb Version·사이드카 `--version`·latest.json 의 version 이 전부 그 값이어야
 * 실제 릴리스와 같은 검증(설치 스모크의 버전 단언 · latest.json version == 태그)이 돈다 —
 * 그래서 tauri.conf.json 하나가 아니라 6 파일을 다 바꾼다(사이드카 버전은 Cargo.toml 에서 온다).
 *
 * 규칙은 `scripts/bump-version.mjs` 의 `bumpVersionFile` 을 그대로 쓴다(자리 수가 어긋나면
 * throw). 랜딩은 건드리지 않는다 — 번들과 무관하다. 커밋하지 않는다: 러너의 작업 폴더에서만.
 *
 * `0.0.N` 만 받는다 — 실수로 진짜 버전을 넣어 진짜 릴리스와 같은 태그의 draft 를 만들지
 * 않게. 0.0.N 은 어떤 공개 버전보다 낮아 업데이터가 이것을 새 버전으로 볼 일도 없다.
 *
 *   node .github/scripts/release/dryrun-version.mjs 0.0.123
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION_FILES, bumpVersionFile } from "../../../scripts/bump-version.mjs";

export const DRYRUN_VERSION = /^0\.0\.\d+$/;

function main(argv) {
  const to = argv[0];
  if (!to || !DRYRUN_VERSION.test(to)) {
    throw new Error(`드라이런 버전은 0.0.N 모양이어야 한다: ${to ?? "(없음)"}`);
  }
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const from = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  // 전부 메모리에서 먼저 — 하나라도 어긋나면 디스크는 그대로다.
  const writes = VERSION_FILES.map((rel) => [rel, bumpVersionFile(rel, readFileSync(join(root, rel), "utf8"), from, to)]);
  for (const [rel, text] of writes) {
    writeFileSync(join(root, rel), text);
    console.log(`드라이런 버전: ${rel} ${from} → ${to}`);
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.log(`::error::dryrun-version — ${e.message}`);
    process.exitCode = 1;
  }
}
