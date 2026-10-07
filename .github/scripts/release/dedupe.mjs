#!/usr/bin/env node
/**
 * 같은 태그로 릴리스 워크플로가 두 번 뜨면 뒤의 것이 물러난다 (2026-10-07 v3.9.0).
 *
 * GitHub 는 드물게 같은 push 이벤트를 두 번 전달한다 — v3.9.0 태그 하나에 Release run 이
 * 같은 초에 둘(37626868742 · 37626870355) 떴다. release.yml 에는 동시성 규칙이 없어서 둘이
 * 나란히 같은 draft 를 만들고 자산·latest.json 을 서로 덮을 수 있었다(그때는 손으로 하나를
 * 취소했다).
 *
 * concurrency 그룹으로 막지 않는 이유: `cancel-in-progress` 는 **진행 중인 run 을 끊는다** —
 * 태그를 다시 밀거나 옛 run 을 re-run 하는 순간 공개(publish) 도중의 run 이 잘릴 수 있다.
 * `cancel-in-progress` 없이 줄만 세우면 뒤 run 이 앞 run(1시간 반)을 기다렸다가 한 바퀴를 더
 * 돈다. 그래서 **뒤에 뜬 쪽이 스스로 물러난다**: 같은 워크플로 · 같은 커밋 · 같은 태그에
 * id 가 더 작은 run 이 아직 돌고 있거나 성공으로 끝났으면 이 run 은 중복이다. 둘이 동시에
 * 서로를 보더라도 id 로 갈리므로 정확히 하나만 남는다.
 *
 * 앞선 run 이 실패·취소로 끝났으면 막지 않는다 — 태그를 지웠다 다시 미는 복구 경로
 * (docs/RELEASE.md §6)가 살아 있어야 한다. 같은 run 의 re-run 은 id 가 같아 중복이 아니다.
 *
 *   gh api … | node .github/scripts/release/dedupe.mjs --self <run id> --tag <tag>
 *
 * stdin 은 그 워크플로의 run 배열(`{id, event, head_branch, status, conclusion, html_url}`).
 * 막는 run 이 있으면 `<id> <status>/<conclusion> <url>` 한 줄, 없으면 아무것도 쓰지 않는다.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** 이 run 보다 먼저 떠서 이 run 을 막는 run — 가장 앞선 것. 없으면 `null`. */
export function blockingRun(runs, self) {
  const ahead = runs.filter(
    (r) =>
      r.id < self.id &&
      r.event === "push" &&
      r.head_branch === self.tag &&
      (r.status !== "completed" || r.conclusion === "success"),
  );
  ahead.sort((a, b) => a.id - b.id);
  return ahead[0] ?? null;
}

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function main(argv) {
  const id = Number(arg(argv, "--self"));
  const tag = arg(argv, "--tag");
  if (!Number.isSafeInteger(id) || id <= 0 || !tag) {
    throw new Error("사용법: dedupe.mjs --self <run id> --tag <tag> < runs.json");
  }
  const runs = JSON.parse(readFileSync(0, "utf8"));
  if (!Array.isArray(runs)) throw new Error("stdin 은 run 배열이어야 한다");
  const b = blockingRun(runs, { id, tag });
  if (b) console.log(`${b.id} ${b.status}/${b.conclusion ?? "-"} ${b.html_url ?? ""}`.trim());
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.log(`::error::dedupe — ${e.message}`);
    process.exitCode = 1;
  }
}
