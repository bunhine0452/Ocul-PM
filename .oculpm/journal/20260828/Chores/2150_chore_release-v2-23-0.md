---
schema_version: 1
type: chore
slug: release-v2-23-0
status: done
difficulty: verylow
created_at: "2026-08-28T21:50:00+09:00"
session_id: "manual-20260828-215000"
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
verified_by_user: false
files_touched:
  - path: "package.json"
    op: update
  - path: "src-tauri/tauri.conf.json"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/Cargo.lock"
    op: update
  - path: "plugin/oculpm/.claude-plugin/plugin.json"
    op: update
  - path: ".claude-plugin/marketplace.json"
    op: update
  - path: "CHANGELOG.md"
    op: update
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
  - path: "landing/index.html"
    op: update
related:
  - "20260828/Features_to_add/2111_feature_terminal-agent-control-room.md"
  - "20260828/Features_to_add/2130_feature_terminal-command-blocks.md"
  - "20260828/Bugs/2145_bug_acp-test-clicked-wrong-button.md"
tags: [release, landing, changelog]
---

[x] v2.23.0 릴리스 — 다섯 면 전부 갱신

## 배경

터미널 정체성 라운드 Phase 2(에이전트 관제탑)·Phase 3(명령 블록)과 ACP 테스트
경로 결함 수정을 함께 낸다. Phase 1 은 v2.22.0 으로 이미 나갔다.

`docs/RELEASE.md` 의 다섯 면을 전부 적었다 — 하나씩 빠지기 쉬운 곳이라
체크리스트 순서를 그대로 따랐다.

- **버전 5파일** — package.json · tauri.conf.json · Cargo.toml ·
  plugin.json · marketplace.json (뒤 둘은 `cargo test --test plugin_manifest`
  가 앱 버전과의 동기를 강제한다).
- **CHANGELOG.md** — `## v2.23.0`. 이것이 GitHub 릴리스 노트의 유일한 소스라
  헤더가 태그와 정확히 일치해야 한다.
- **README.md · README.en.md 양쪽** — 최신 하이라이트를 🚀 로 올리고 직전
  v2.22.0 은 평범한 헤딩으로 강등했다(하이라이트는 언제나 하나).
- **landing/index.html** — 버전 문자열 6곳(softwareVersion · nav-ver ·
  NEW 배지 · 다운로드 버튼 2곳 · CTA eyebrow) + 변경사항 `<li>` + JSON-LD
  `featureList` 2줄 + FAQ 1건 + 벤토 셀 3개(= 한 줄).

FAQ 는 JSON-LD 와 `<details>` **두 곳**에 같은 문장이 있어 둘 다 넣었다.
기존 FAQ 가 이번 변경으로 거짓이 되는 것은 없었다 — 터미널 관련 두 항목은
"v2.22.0 부터 …" 식 역사 서술이라 그대로 참이다.

플러그인 커맨드·MCP 도구·스킬은 이번에 바뀌지 않아 `landing/plugin.html` 은
손대지 않았다.

## 검증

- 게이트 전부 exit 0 — typecheck · test(120파일 1,416건) · lint · build ·
  `cargo test`(플러그인 매니페스트 버전 동기 포함).
- `grep -n '2\.22\.0' landing/index.html` 로 옛 버전 문자열 전수 확인 — 남은
  것은 전부 "v2.22.0 부터" 형태의 역사 서술이다.
- JSON-LD 블록 전체를 `json.loads` 로 파싱해 문법 확인, FAQ 개수가 JSON-LD ↔
  `<details>` 양쪽 15건으로 일치.
- 태그 푸시 후 release.yml 이 번들을 굽는다 — **로컬 빌드는 하지 않는다**.
- 랜딩은 git 연동이 없어 `cd landing && vercel --prod` 로 따로 배포한다.

## 메모

실기기 확인 3건(`#p1-manual-verify` · `#p2-manual-verify` · `#p3-manual-verify`)은
플래너에 열린 채로 나간다. 사용자가 이 빌드를 받아 직접 확인하겠다고 해서, 확인의
전제였던 "설치본이 안 돌 때" 조건이 이 릴리스로 해소된다.
