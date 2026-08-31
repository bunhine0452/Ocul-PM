---
schema_version: 1
type: chore
slug: release-v2-25-0
status: done
created_at: 2026-08-31T12:46:00+09:00
session_id: "manual-20260831-124600"
agent:
  id: claude-code
  version: claude-opus-5
language: ko
verified_by_user: false
difficulty: low
files_touched:
  - path: package.json
    op: update
  - path: src-tauri/tauri.conf.json
    op: update
  - path: src-tauri/Cargo.toml
    op: update
  - path: plugin/oculpm/.claude-plugin/plugin.json
    op: update
  - path: .claude-plugin/marketplace.json
    op: update
  - path: CHANGELOG.md
    op: update
  - path: README.md
    op: update
  - path: README.en.md
    op: update
  - path: landing/index.html
    op: update
  - path: src/__tests__/setup.ts
    op: update
related:
  - 20260831/Bugs/1208_bug_tab-reattach-lone-window.md
  - 20260830/Chores/1229_chore_release-v2-24-0.md
tags: [release, v2.25.0, ci, flake]
---

[x] v2.25.0 릴리스 — 다섯 면 · 빌드 캐시 93GiB 회수 · CI 플래키 한 건 수습

## 무엇을 했나

v2.24.0 이후 미릴리스로 쌓여 있던 polish-round 7커밋에 이번 탭 재부착 회귀
수정을 얹어 v2.25.0 으로 묶었다. `docs/RELEASE.md` 의 다섯 면을 전부 채웠다.

- 버전 5파일 (`package.json` · `tauri.conf.json` · `Cargo.toml` · plugin.json ·
  marketplace.json) — `plugin_manifest` 테스트가 동기를 강제한다
- `CHANGELOG.md` `## v2.25.0` (릴리스 노트의 유일한 소스)
- `README.md` · `README.en.md` **양쪽** — v2.24.0 은 `## 🚀` 에서 강등
- `landing/index.html` — 버전 문자열 6곳 + JSON-LD `featureList` 3줄 +
  변경사항 `<li>` + 다중 프로젝트 FAQ 를 JSON-LD·`<details>` **양쪽** 갱신
  (떼어낸 창이 되돌아온다는 사실이 이번 릴리스로 참이 됐다)
- 커밋 `2350977` → main → CI 그린 확인 → 태그 `v2.25.0` 단독 push →
  `landing/` 에서 `vercel --prod`

곁들여 빌드 캐시를 정리했다: `src-tauri/target` 이 69GB(debug/incremental 36GB ·
debug/deps 27GB)까지 부풀어 있었다. `cargo clean` 으로 191,909 파일 / 93.4GiB 를
지우고 한 번 재빌드해 5.1GB 로 되돌렸다 — 저장소 전체가 70GB → 5.6GB.

## 겪은 것 — 붉은 CI 한 번

릴리스 커밋의 main CI 에서 프런트 잡이 떨어졌다. `acp_parallel_sessions` 의
"A 가 도는 중에 연 새 대화는 곧장 나간다" 가 1183ms 에 죽었고, 실패 모양은
`sent` 가 빈 배열 — `waitFor` 기본 1000ms 예산 안에 커맨드가 도착하지 못한 것.
로컬 5회 연속 통과, 릴리스 변경과 무관한 파일이다.

`release.yml` 은 테스트를 돌리지 않고 번들만 굽기 때문에 붉은 main 에 태그를
밀면 깨진 빌드가 그대로 나간다 — 그래서 rerun 으로 넘기지 않고 원인을 고쳤다.
`src/__tests__/setup.ts` 에서 testing-library 의 `asyncUtilTimeout` 을 5s 로
올렸다(`dab12ce`). 성공 경로는 조건이 맞는 즉시 빠져나오므로 통과 시간은 그대로다
(1494건 12.4s). 이 파일은 2026-08-28 에도 같은 종류의 flake 를 한 번 고쳤는데,
그때는 버튼 라벨 정규식이 느린 순간에 다른 코드 경로를 눌렀던 것이었다.

## 검증

게이트 전량 exit 0 — `pnpm typecheck` · `lint` · `test`(1494) · `build` ·
`cargo test`(885) · `cargo fmt` · `cargo clippy --all-targets -D warnings`.
main CI `dab12ce` 두 잡 모두 success. `release.yml` 이 태그 `v2.25.0` 을 잡아
빌드 시작. 라이브 랜딩은 `curl https://oculpm.com/` 로 `softwareVersion 2.25.0`
· `nav-ver v2.25.0` 확인.

## 메모

탭 재부착의 **실기기 확인은 아직**이다 (`tab-reattach-regression` 플랜의
`#manual-verify-reattach`). 설치본이 도는 동안 dev 빌드를 띄우면 app-data·
SQLite·`.oculpm` 락을 다투므로, 이번 업데이트를 받은 뒤 실제 앱에서 본다.
