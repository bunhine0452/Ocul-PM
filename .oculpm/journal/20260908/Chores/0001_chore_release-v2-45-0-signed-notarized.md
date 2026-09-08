---
schema_version: 1
type: chore
slug: "release-v2-45-0-signed-notarized"
status: done
difficulty: medium
created_at: "2026-09-08T00:01:11+09:00"
session_id: "mcp-20260908-000111"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "12a04cf3-30bb-4d04-9cee-cc975be14ee7"
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
  - path: "landing/plugin.html"
    op: update
  - path: "landing/en/plugin.html"
    op: update
  - path: "docs/RELEASE.md"
    op: update
  - path: "package.json"
    op: update
  - path: "src-tauri/tauri.conf.json"
    op: update
related:
  - ref: "20260907/Chores/2233_chore_notarization-dry-run-accepted.md"
    kind: "followup"
tags:
  - "release"
  - "macos"
  - "notarization"
  - "landing"
  - "mcp-tool"
---
[x] v2.45.0 — 첫 서명·공증 배포

Apple Developer ID 서명 + 공증이 붙은 첫 릴리스. 내용물은 v2.44.1 이후 main 에 쌓인 20커밋이다.

## 지형 조사에서 잡은 것

착수 전 상태 확인이 세 가지를 바꿨다.

- **`feat/v3-release-round` 브랜치는 낡은 사본이었다.** 15커밋 전부가 리베이스되어 이미 main 에 있었고(커밋 제목 전수 대조로 확인) main 은 거기서 4커밋 더 나가 있었다. 브랜치에서 태그를 태웠으면 그 4커밋이 빠진 채 나갔다.
- **병렬 세션이 같은 워킹트리에서 작업 중이었다** — 터미널 폭 관련 미커밋 변경과 22:23 에 쓰인 일지가 있었다. `git checkout` 은 HEAD 를 공유하므로 쓰지 않고, **격리된 `git worktree`** 를 origin/main 에 띄워 거기서만 작업했다. 내 5파일 변경은 패치로 옮겼다(브랜치 HEAD 와 origin/main 에서 그 5파일이 동일함을 먼저 확인).
- **버전을 3.0.0 으로 올릴 수 없었다.** `v3-release` 플랜이 29/78 이고, 그 플랜의 「릴리스 3.0.0」 단계(evals·게이트·릴리스)와 영문 표면(스크린샷 부재·i18n 잔여 ~500줄)이 전부 미완이다. 사용자에게 물어 v2.45.0 으로 확정했다.

## 릴리스 5면

버전 6파일 · CHANGELOG · README ko/en · 랜딩 ko/en(버전 문자열 6곳씩 + 변경이력 `<li>` + JSON-LD `featureList` + FAQ 2면[JSON-LD·`<details>`]) · `build.mjs` 재빌드(changelog·themes·privacy·sitemap). `landing/plugin.html` 과 `landing/en/plugin.html` 의 `nav-ver` 도 함께.

CHANGELOG 와 두 랜딩 FAQ 에 **키체인 프롬프트**를 적었다. API 키는 `keyring` 으로 OS 키체인에 있고 항목 ACL 이 생성 당시 코드 서명에 묶이므로, 애드혹에서 Developer ID 로 올라온 기존 사용자는 첫 실행에 한 번 묻는 창을 본다. 데이터 손실은 없지만 눈에 보이는 변화다.

## 문서 정정

`docs/RELEASE.md` 4장이 `landing/plugin.html` 만 적어 두어 **영문 플러그인 페이지가 옛 버전에 멈출 뻔했다**. 문구와 전수 확인 grep 에 두 파일을 모두 넣었다. §7(서명·공증 시크릿 절차)과 §6 의 `codesign -dvv`/`spctl -a -vvv` 검증도 이번에 신설한 것이다 — 시크릿이 하나라도 비면 번들러가 실패하지 않고 조용히 무서명 번들을 내놓기 때문에 이 검증이 매 릴리스 그물이 된다.

## 검증

격리 워크트리에서 `pnpm typecheck` · `test` · `lint` · `build` · `cargo test` 전부 exit 0 (Rust 는 `CARGO_TARGET_DIR` 을 본 저장소와 공유해 의존성 재빌드를 피했다). 베이스 `e9edb0d` 의 main CI 초록 확인 후 푸시. 태그 `v2.45.0`(147fd4b) 푸시로 release.yml run 34135940884 가 실제로 떴음을 확인했다.

**아직 확인 안 된 것**: CI 가 구운 `.dmg` 에서 `spctl` 이 `source=Notarized Developer ID` 를 답하는지 — 예행연습은 로컬 키체인 신원을 직접 썼으므로 `APPLE_CERTIFICATE` ↔ `APPLE_CERTIFICATE_PASSWORD` 짝은 이 빌드가 처음 실증한다. 릴리스 완료 후 §6 절차로 확인해야 완결이다.

## 메모

인증서 만료가 2027-02-01 이다. 타임스탬프가 붙은 서명은 만료 뒤에도 유효하므로 이번 빌드는 안전하지만, 그 이후 **새 빌드 서명에는 인증서 갱신이 필요**하다.