---
schema_version: 1
type: bug
slug: "bug-hunt-round3-settings-writeback"
status: done
created_at: "2026-09-18T20:00:07+09:00"
session_id: "20260918-002"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "02144d22-a518-4a7f-922a-6e2a1d78825d"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/settings/OculpmSettings.tsx"
    op: update
  - path: "src/features/settings/ShellIntegrationBlock.tsx"
    op: create
  - path: "src/api/shellIntegration.ts"
    op: create
  - path: "src/lib/format.ts"
    op: update
  - path: "src/features/oculpm/useJournalDays.ts"
    op: update
  - path: "src/features/tray/TrayPopover.tsx"
    op: update
  - path: "src/mobile/MobileApp.tsx"
    op: update
  - path: "src/features/settings/tabs/DataTab.tsx"
    op: update
  - path: "scripts/check-bindings-imports.mjs"
    op: update
related:
  - ref: "20260918/Bugs/1914_bug_bug-hunt-round2-git-quotepath.md"
    kind: "followup"
tags:
  - "bug-hunt"
  - "settings"
  - "config"
  - "api-facades"
  - "mobile"
  - "tray"
  - "mcp-tool"
---
[x] 버그 헌팅 3라운드 — 설정 화면이 열 때마다 config.toml 을 되쓰던 것 · 시각 정렬 오프셋 · 늦게 오는 정리 함수 · 클립보드</title>
<parameter name="difficulty">low

## 발생 원인

1라운드 휴리스틱이 짚었지만 아직 안 읽은 effect 들과 정렬·정리 코드를 훑었다.

1. **`OculpmSettings` 의 디바운스 저장이 열 때마다 헛 저장을 한다** — `lastSaved` 가 `null` 로 시작하는데 초기 `getConfig` 결과를 `setConfig` 하면 저장 effect 가 "바뀐 값" 으로 보고 `DEBOUNCE_MS` 뒤 읽은 그대로를 `setConfig` 로 디스크에 되쓴다. 화면엔 "저장됨" 시각이 찍힌다. 또 `lastSaved` 를 **요청 전에** 갱신해, 저장이 실패한 값도 저장된 것으로 적혀 다음 편집까지 재시도하지 않았다.
2. `created_at` 정렬이 `localeCompare`/`<` 문자열 비교 — `+09:00` 과 `Z` 가 섞이면(백필·임포트) 순서가 어긋난다 (`useJournalDays` 두 곳, 트레이 최근 일지).
3. `MobileApp` 테마 effect — `applyDesktopTheme()` 가 끝나기 전에 effect 가 내려가면 나중에 온 정리 함수를 아무도 부르지 않아 구독이 남는다.
4. `DataTab.copy` — `clipboard.writeText` 를 기다리지 않아 실패해도 "복사됨" 이 뜨고 거부가 unhandled 로 흐른다.

## 해결 방법

1. 초기 로드 값의 직렬화를 `lastSaved` 에 심고, `lastSaved` 갱신을 성공 콜백으로 옮겼다. 파일 크기 래칫(1260>1253)에 걸려 `ShellIntegrationBlock` 을 별 파일로 떼고, 새 파일 규율(bindings 직접 호출 금지)에 맞춰 `src/api/shellIntegration.ts` 파사드를 만들었다 — `{#api-facades}` 두 번째 조각. 블록의 상태 조회에 `cancelled` 가드도 붙였다.
2. `format.ts` 에 `compareIsoDesc`(epoch 비교, 못 읽으면 문자열로 물러섬) 를 두고 세 정렬을 바꿨다.
3. `disposed` 플래그 — 늦게 온 정리 함수는 즉시 호출.
4. `await` + `catch` 로 실패 시 "복사됨" 을 띄우지 않는다.

살펴봤지만 그대로 둔 것: `lspOpen: Path escapes the project root` (프로젝트 밖을 가리키는 심볼릭 링크 거부는 `code_read` 와 같은 의도된 가드), `close_tab: 레지스트리에 없는 탭` (재현 대기 진단 로그), 손으로 지운 config 키에 전체 로드가 실패하는 것(`config_valid=false` 로 표면화되는 설계).

## 검증

- `pnpm typecheck` · `pnpm lint` 6게이트 exit 0 (래칫·bindings 게이트 포함) · `vitest` 2740 · `pnpm build` 성공
- Rust 는 이번 라운드 무변경 (2라운드 게이트 결과 유효)