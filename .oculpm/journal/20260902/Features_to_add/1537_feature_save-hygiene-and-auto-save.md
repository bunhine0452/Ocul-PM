---
schema_version: 1
type: feature
slug: "save-hygiene-and-auto-save"
status: done
difficulty: high
created_at: "2026-09-02T15:37:26+09:00"
session_id: "20260902-006"
agent:
  id: "claude-code"
  version: "Opus 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/code/saveHygiene.ts"
    op: create
  - path: "src/features/code/autoSave.ts"
    op: create
  - path: "src/features/code/CodePane.tsx"
    op: update
  - path: "src/lib/settings.ts"
    op: update
  - path: "src/features/settings/CodeSettings.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/code_save_hygiene.test.ts"
    op: create
  - path: "src/__tests__/code_auto_save.test.tsx"
    op: create
  - path: "src/__tests__/code_screen.test.tsx"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags:
  - "code"
  - "editor"
  - "save"
  - "auto-save"
  - "vscode-benchmark"
  - "mcp-tool"
---
[x] 코드 화면 — 저장할 때 공백이 정리되고, 저장을 잊어도 파일이 최신이다 (VS Code 라운드 Phase 1)

「VS Code 에서 가져오는 7가지」 라운드(`docs/20260902_vscode-borrows/`)의 Phase 1. 코드 화면에 없던 것은 기능이 아니라 **하루 종일 켜 두는 편집기의 위생**이었다 — 저장하면 공백이 정리되고, 저장을 잊어도 파일이 최신인 것.

## 추가 기능

**B1 저장 시 정리** — 설정 3개(`codeTrimTrailingWhitespace` · `codeInsertFinalNewline` · `codeTrimFinalNewlines`). 저장 직전, 쓰기 **전에** 버퍼를 다듬는다. 쓴 뒤에 고치면 저장 직후 다시 미저장이 되어 무엇이 디스크에 있는지 알 수 없다 (`codeFormatOnSave` 가 이미 내린 판단).

**B2 자동 저장** — `codeAutoSave` = `off` / `afterDelay` / `onFocusChange`, `codeAutoSaveDelay`(기본 1000ms). 이 앱에서는 편의가 아니라 **정합성**이다: 사용자가 저장을 잊고 에이전트에게 "이 파일 봐" 라고 시키면 에이전트는 화면이 아니라 **디스크**를 읽는다.

전부 기본 꺼짐 — 사용자가 만들지 않은 변경이 조용히 diff 를 덮으면 안 된다.

## 동작 흐름

정리는 순수 모듈(`saveHygiene.ts`)로 뗐다. 이 계산이 정하는 것은 **디스크에 쓸 본문**이라, 컴포넌트 안에 있으면 jsdom 이 못 보는 자리에서 조용히 틀리고 그 결과가 파일로 남는다.

- 순서는 `후행 공백 → 끝 빈 줄 → 끝줄 삽입`. 둘 다 켜면 끝이 정확히 개행 하나로 정규화된다.
- **자동 저장이면 커서 줄을 보호한다.** VS Code 가 자동 저장일 때만 커서 줄을 살려 두는 이유가 그대로 적용된다 — 들여쓰기를 치고 잠깐 멈춘 순간 자동 저장이 그 공백을 먹으면 커서가 줄 앞으로 튄다.
- **`.md`·`.markdown` 은 후행 공백 정리에서 뺀다** (줄 끝 두 칸 = 강제 개행). 언어별 설정 축이 없으므로 모듈 안에 하드코딩했다.
- **VS Code 와 갈라진 곳 하나**: 전부 빈 줄인 파일을 VS Code 는 통째로 지운다(`doTrimFinalNewLines`). 저장 한 번에 본문이 사라지는 편이 더 위험해서 손대지 않는다.

자동 저장의 트리거는 `autoSave.ts` 가 "언제" 만 정하고, "어떻게 쓰는지" 는 CodePane 이 갖는다 — 기존 낙관적 잠금(`base_hash`)을 그대로 지나가야 하기 때문이다.

- 게이트 — 미저장 아님 · 저장 중 · **충돌 배너가 떠 있음** · 인라인 비교 중 · 에디터가 아님. 하나라도 걸리면 조용히 지나간다.
- 자동 저장은 **포맷을 건너뛴다** (VS Code 의 `SaveReason.AUTO` 와 같은 결정). 타자 도중 1초마다 포매터가 도는 것은 편집기가 아니라 방해다.
- 실패는 조용히 — 충돌은 배너만(토스트 없음), 쓰기 실패는 **경로당 1회** 토스트.
- 지연 하한 250ms — 저장마다 워처가 증분 색인을 예약하므로 타자 속도로 저장이 나가면 색인 폭풍이 된다.

**설계하며 잡은 함정**: 탭을 옮길 때의 저장은 `pathRef` 를 쓰면 안 된다. effect cleanup 시점에는 `pathRef.current` 가 **이미 새 경로**이고 `bufferRef` 는 아직 옛 버퍼라, 그대로 저장하면 **옛 본문을 새 파일에 쓴다**. 그래서 훅이 effect 안에서 잡아 둔 경로를 `flushPath(path)` 로 넘기고, CodePane 은 그 경로의 버퍼를 캐시에서 직접 읽어 이 창의 state 를 건드리지 않고 쓴다.

상태줄은 `● 미저장` / `○ 저장됨` 에 `○ 자동 저장` · `저장 중…` 이 붙었다 — ⌘S 습관을 버려도 되는지 사용자가 알 방법이 이것뿐이다.

## 검증

- 순수 18 (`code_save_hygiene`: 보호 줄·끝줄 조합 순서·마크다운 예외·"이미 정돈된 본문은 같은 문자열" 계약) + 훅 12 (`code_auto_save`: 디바운스 1회·게이트·포커스 전이·떠난 경로 flush·off 무반응) + 통합 4 (`code_screen`: 다듬은 본문이 `code_write` 로 감 · 마크다운 예외 · 포커스 전환 자동 저장 · 충돌 배너 위로는 안 씀).
- `pnpm typecheck` · `test`(152파일 1913건) · `lint` · `build` 전부 exit 0.
- 육안 확인은 라운드 마감(Phase 7)에서 7가지를 한 번에 — 설치본 도는 중 dev 빌드 금지 규율.