---
schema_version: 1
type: chore
slug: "apple-developer-id-signing-notarize"
status: done
difficulty: low
created_at: "2026-09-07T21:31:22+09:00"
session_id: "20260907-003"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "12a04cf3-30bb-4d04-9cee-cc975be14ee7"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/tauri.conf.json"
    op: update
  - path: ".github/workflows/release.yml"
    op: update
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
  - path: "docs/RELEASE.md"
    op: update
related: []
tags:
  - "release"
  - "macos"
  - "codesign"
  - "notarization"
  - "ci"
  - "mcp-tool"
---
[x] Developer ID 서명·공증을 릴리스 파이프라인에 붙인다

Apple Developer Program 가입으로 **Developer ID Application** 인증서(팀 `BP57Z7L498`)가 생겼다. 그때까지 릴리스는 애드혹 서명(`signingIdentity: "-"`)이라, 내려받은 사용자가 "손상되었기 때문에 열 수 없습니다"를 보고 `xattr -dr com.apple.quarantine` 을 직접 쳐야 했다 — 다운로드 이후 첫 관문이 터미널 한 줄이었다는 뜻이다.

## 변경 요약

- `tauri.conf.json` — `bundle.macOS.signingIdentity: "-"` 를 걷고 `hardenedRuntime: true` 만 남겼다. 신원은 설정에 박지 않고 `APPLE_SIGNING_IDENTITY` 환경변수로 들어간다. 인증서 없는 로컬 `pnpm tauri build` 가 그대로 돌아가야 하고, 공개 저장소 설정 파일에 사람 이름을 박을 이유도 없다.
- `.github/workflows/release.yml` — tauri-action 스텝에 서명 3종(`APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` / `APPLE_SIGNING_IDENTITY`)과 공증 3종(`APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID`)을 넘긴다. 릴리스 본문의 `xattr` 우회 안내는 걷고 서명·공증 빌드라고 적었다.
- `README.md` · `README.en.md` — 설치 문단의 격리 해제 안내 제거, 로드맵의 "Apple 공증" 항목 제거.
- `docs/RELEASE.md` — 7장 신설(시크릿 6개를 `gh secret set` 으로 넣는 절차, 앱 암호 vs 계정 암호 구분, 엔타이틀먼트가 왜 필요 없는지, 키체인 프롬프트 경고)과 6장에 `codesign -dvv` / `spctl -a -vvv` 검증 두 줄.

**엔타이틀먼트 파일은 만들지 않았다.** 설치돼 있는 v2.4x 번들을 `codesign -dvv` 로 읽으니 이미 `flags=0x10002(adhoc,runtime)` — 하드닝 런타임이 켜진 채로 정상 동작 중이다. 번들 안 Mach-O 는 `ocul-pm` 과 `oculpm-mcp` 둘뿐이고 dylib 이 없다(`ort` 2.0.0-rc.12 · `rusqlite` bundled 모두 정적). WKWebView 는 Apple 서명 프로세스로 분리돼 있어 JIT 예외도 필요 없다. 즉 이번 변경은 **서명 주체만 애드혹 → Developer ID 로 바뀌는 것**이고, 런타임 제약은 이미 통과해 있던 상태다.

`@tauri-apps/cli` 2.11.2 네이티브 바이너리의 문자열을 뒤져 CLI 가 실제로 읽는 변수 이름과 도구(`security import` · `notarytool` · `stapler` · `--options runtime`)를 확인한 뒤 이름을 맞췄다 — 문서만 보고 짐작하지 않았다.

## 검증

`pnpm test` exit 0, `pnpm lint` 6게이트 통과(에러 0 · 경고 46, 기존값). **아직 확인 못 한 것**: 시크릿 6개가 저장소에 없어 서명·공증이 실제로 붙은 번들을 아직 만들어 보지 못했다 — 시크릿 투입 후 첫 태그에서 `spctl -a -vvv` 가 `source=Notarized Developer ID` 로 나오는지 봐야 완결이다. 시크릿이 하나라도 비면 번들러는 실패하지 않고 조용히 무서명 번들을 내놓으므로, 그 확인을 6장 체크리스트에 넣어 두었다.

## 메모

서명 주체가 바뀌는 첫 자동 업데이트에서 **키체인 프롬프트**가 한 번 뜬다. API 키는 `keyring` 으로 OS 키체인에 있고 항목 ACL 이 생성 당시 코드 서명에 묶이기 때문이다. 데이터가 사라지지는 않고 "항상 허용"을 누르면 끝나지만, 사용자 눈에 보이는 변화이므로 이 변경이 나가는 릴리스의 CHANGELOG 에 한 줄 적어야 한다.