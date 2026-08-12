---
schema_version: 1
type: chore
slug: "release-v2-8-4"
status: done
difficulty: low
created_at: "2026-08-11T21:17:35+09:00"
session_id: "manual-20260811-211735"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "package.json"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/tauri.conf.json"
    op: update
  - path: "CHANGELOG.md"
    op: update
  - path: "landing/index.html"
    op: update
related:
  - ".oculpm/journal/20260811/Refactors/2101_refactor_font-swap-and-perf-round.md"
  - ".oculpm/journal/20260811/Bugs/2114_bug_unlisten-unhandled-rejection.md"
tags: ["release", "landing", "changelog"]
---

[x] v2.8.4 릴리스 — 3면(git · 랜딩 · GitHub 릴리스) 반영

## 한 일

사용자 지시: **"변경사항들 git과, oculpm 사이트, 릴리즈에도 적어야 해 — 이건 반복작업이니까 기억해둬."** 절차를 체크리스트로 굳혀 진행했다.

1. **버전 3파일** — `package.json` · `src-tauri/Cargo.toml` · `src-tauri/tauri.conf.json` 을 2.8.3 → 2.8.4. (`Cargo.lock` 도 동반 갱신되어 함께 커밋)
2. **CHANGELOG.md** — 맨 위에 `## v2.8.4` 섹션. 이게 **GitHub 릴리스 노트의 유일한 소스**다: `release.yml` 이 awk 로 태그와 같은 헤더의 본문만 뽑아 `releaseBody` 에 넣는다. 헤더가 태그와 어긋나면 릴리스 본문이 빈 채로 나가므로, 푸시 전에 같은 awk 를 로컬에서 돌려 추출 결과를 눈으로 확인했다.
3. **landing/index.html 5곳** — JSON-LD `softwareVersion` · NEW 배지 · 다운로드 버튼 · 히어로 eyebrow, 그리고 변경사항 `<ul class="update-points">` 맨 앞에 v2.8.4 항목 추가. `grep -n "2\.8\.3"` 으로 전수 확인 (272줄에 남은 v2.8.3 은 이력 항목이라 유지).
4. **커밋 → 태그 → 랜딩 배포** — 커밋은 명시 경로 33개만 stage (워킹트리에 다른 세션의 미커밋 작업이 섞여 있어 `git add -A` 금지). `v2.8.4` 태그 푸시로 `release.yml` 기동. 랜딩은 git 연동이 없어 `cd landing && npx vercel deploy --prod --yes` 로 따로 배포.

내용은 [[2101_refactor_font-swap-and-perf-round]] 의 최적화 라운드와 [[2114_bug_unlisten-unhandled-rejection]] 의 해제 가드를 합친 것이다.

## 검증

커밋 전 `pnpm typecheck` · `pnpm test`(611) · `pnpm lint` · `cargo test`(563) 전부 exit 0 직접 확인. 로컬 `pnpm build` 는 돌리지 않았다 — 태그 푸시가 `release.yml`(tauri-action)에서 빌드·서명·릴리스까지 한다.

3면 확인:

- **git** — `004d557` main 푸시, 태그 `v2.8.4` 푸시 완료.
- **랜딩** — `curl -s https://oculpm.com/ | grep softwareVersion` → `"2.8.4"`, 다운로드 버튼도 `v2.8.4 받기` 로 반영됨. Vercel `Aliased https://oculpm.com` READY.
- **릴리스** — 워크플로 run 31490438236 기동 확인. 빌드 완료까지 지켜보는 중 (v2.8.3 기준 13분대).

## 메모

- 랜딩 배포 로그에 `api/notion/oauth/{start,callback}.ts` 의 TS2580(`Buffer`/`process` 타입 없음) 오류가 6건 찍힌다. `@types/node` 가 devDependencies 에 없어서인데, 빌드는 완료되고 정적 사이트 배포에는 영향이 없다. **기존 문제이고 이번 릴리스와 무관** — 다만 그 OAuth 함수가 실제로 쓰이기 시작하면 먼저 손봐야 한다.
- 절차를 사용자 메모리(`release-checklist-three-surfaces`)에 상시 지시로 저장했다. 다음 릴리스부터는 이 순서 그대로.
