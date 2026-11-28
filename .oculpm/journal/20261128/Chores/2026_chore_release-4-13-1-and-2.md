---
schema_version: 1
type: chore
slug: "release-4-13-1-and-2"
status: done
difficulty: low
created_at: "2026-11-28T20:26:58+09:00"
session_id: "20261128-001"
agent:
  id: "claude-code"
  version: "Fable 5.2"
  session: "6fe2b56e-24f4-4ecc-9cdf-cb61ec923378"
language: "ko"
verified_by_user: false
files_touched:
  - path: "CHANGELOG.md"
    op: update
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
  - path: "landing/index.html"
    op: update
  - path: "landing/en/index.html"
    op: update
  - path: "package.json"
    op: update
  - path: "src-tauri/tauri.conf.json"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
related:
  - ref: "20261128/Bugs/1930_bug_quit-teardown-dock-reopen.md"
    kind: "followup"
  - ref: "20261128/Bugs/1956_bug_image-peek-stutter.md"
    kind: "followup"
tags:
  - "출시"
  - "릴리스"
  - "mcp-tool"
---
[x] 출시: v4.13.1 · v4.13.2 를 낸다

## 한 일

- v4.13.1 — PR #178(종료 정리 · 끄기 전 묻기 · 숨긴 마지막 창 · 유휴 깨어남 · 업데이트 두 번 적용 · 클립보드 재시도). 릴리스 커밋 `8805058a`.
- v4.13.2 — PR #179(터미널 그림 미리보기 버벅임). 릴리스 커밋 `4efdbe41`. 같은 날 둘째 패치이고 앞 판을 설치본에서 확인하기 전에 냈다(사용자 결정 「바로 내!」) — CHANGELOG 그 절 첫 줄에 적었다.
- 다섯 면: 버전 6파일 · `Cargo.lock` · CHANGELOG · README ko/en · 랜딩 ko/en(버전 자리 · 변경 이력 줄 · 플러그인 페이지 배지) · `node landing/wiki-src/build.mjs`.

## 걸린 것

- PR #178 의 첫 CI 가 `cargo fmt --check` 에서 붉었다 — 로컬에서 clippy 와 대상 테스트만 돌리고 fmt 를 빠뜨렸다. 포맷 커밋을 더해 통과.
- CHANGELOG 첫 문단의 굵은 문장이 짧으면 `landing_pages.test.ts` 의 「본문이 잘리지 않았다」 가 붉다(굵은 글 끝의 태그가 검사 문장 사이에 낀다). 첫 굵은 문장을 길게 썼다.

## 검증

- `gh run view 46136410109 --json conclusion` → `"conclusion":"success"` (v4.13.1), `gh run view 46137975162 --json conclusion` → `"conclusion":"success"` (v4.13.2)
- `gh release view v4.13.1 …` → `{"assets":9,"isDraft":false,"notes":2361}`, `gh release view v4.13.2 …` → `{"assets":9,"isDraft":false,"notes":1689}`
- `gh api repos/bunhine0452/Ocul-PM/releases/latest --jq .tag_name` → `v4.13.2`
- v4.13.2 의 `latest.json`: `"version": "4.13.2"`, 키 다섯(darwin-aarch64 · darwin-aarch64-app · windows-x86_64 · windows-x86_64-nsis · linux-x86_64-appimage) 모두 `releases/download/v4.13.2`
- 못 한 것: 랜딩 배포(`vercel --prod`)는 사용자 몫으로 남았다. brew · winget 정의는 갱신하지 않았다. 설치본 눈 확인(⌘Q 묻기 · Dock 다시 열기 · 그림 미리보기)도 남았다.