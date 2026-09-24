---
schema_version: 1
type: bug
slug: "port-e2e-frontend-defects-lui2"
status: done
difficulty: high
created_at: "2026-09-25T02:43:43+09:00"
session_id: "mcp-20260925-024343"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ed4447b7-7384-4a70-82ba-26748d6773e1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/lib/osPath.ts"
    op: create
  - path: "src/features/terminal/ptyWrite.ts"
    op: create
  - path: "src/features/terminal/dispatchTarget.ts"
    op: update
  - path: "src/features/terminal/TerminalInstanceImpl.tsx"
    op: update
  - path: "src/features/terminal/shellName.ts"
    op: create
  - path: "src/windows/StartTab.tsx"
    op: update
  - path: "src/features/onboarding/GreenfieldWizard.tsx"
    op: update
  - path: "src/styles/tokens.css"
    op: update
  - path: "src/i18n/index.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/i18n/errors.ts"
    op: update
related:
  - ref: "20260924/Features_to_add/2030_feature_port-e2e-harness-le2e.md"
    kind: "followup"
tags:
  - "cross-platform"
  - "terminal"
  - "i18n"
  - "e2e"
  - "mcp-tool"
---
[x] E2E 가 찾은 프런트 결함 — 경로 이름·터미널 입력 순서·한글 자간·탭 라벨·토스트, 비-mac 문구 (L-UI2, PR #44)

## 발생 원인

E2E 하네스(PR #41)가 실제 앱을 Windows·Linux 러너에서 띄워 찾은 결함:
1. Windows 에서 프로젝트 이름이 경로 전체 — `StartTab`·`GreenfieldWizard` 가 `/` 로만 잘랐다.
2. **터미널에 빠르게 친 키가 뒤섞인다** — 키마다 따로 가는 `void commands.writeToPty(...)` 는 IPC 도착 순서를 아무도 약속하지 않는다(Windows 3/3, macOS·Linux 는 창이 좁아 안 보였을 뿐 같은 구조).
3. 비-mac `--mono` 의 한글이 xterm 격자용 D2Coding Term(advance 1.204em) 때문에 자간이 벌어졌다.
4. Linux 탭 라벨 "zsh" 하드코딩, 영어 전환 토스트가 한국어(언어가 i18n 스토어에 닿기 전에 `t()` — 모든 OS).

## 해결 방법

- `src/lib/osPath.ts` — Windows 는 `\`·`/`·UNC·`\\?\`, 유닉스는 `/` 만(맥 판정 불변).
- `ptyWrite.ts` `createPtyWriter` — 세션마다 보내는 중인 쓰기 하나, 그 사이 입력은 이어 붙여 응답 뒤 한 번에. 모든 입력(키·붙여넣기·IME 확정·첫 명령·프리필)이 한 창구 `writePty` — 오케스트레이터가 `writeToPty` 직접 호출이 그 창구뿐임을 확인. 호스트가 `Request::Write` 를 큐에 넣은 뒤 답하므로 끝까지 순서 보장. 무작위 응답 순서 가짜 백엔드로 테스트.
- `'Pretendard Hangul'`(기존 파일, unicode-range)로 UI 고정폭 한글 폴백 교체 — 터미널·macOS 스택 불변.
- 탭 라벨은 `shell_integration_status` 로 실제 셸, 토스트는 `tIn(lang, …)`.
- i18n 판 조회(`__win`→`__linux`→`__pc`, macOS 는 조회 안 함) 47개: 메뉴바→트레이, Finder→탐색기, 키체인→자격 증명 관리자/시스템 키링. **Windows 에서 따르면 MCP 가 하나도 안 남던 권고 셋**을 앱의 MCP 등록 권고로. errors.ts 3규칙, pasteFiles 토스트, 비-mac 트레이 팝오버 불투명.

## macOS 영향

터미널 입력 직렬화는 macOS 동작을 바꾼다(잠복한 순서 경주 수리 — 키 하나의 지연 불변, 연타는 IPC 왕복 감소). 토스트 언어는 모든 OS 결함 수리. 그 밖은 구조적으로 불변.

## 검증

- **E2E run 35998921678: windows 59단계 전부 ✅ · ubuntu 58 ✅(IME CDP 1 skip)**. portability 전 잡 success(Windows vitest 3,131). PR #44 ci.yml 3잡 SUCCESS → rebase 머지 6e6b98f0.
- CI 로 못 본 것: E2E 가 찍지 않는 설정의 트레이·키·MCP 섹션 실물(vitest 3 OS 로만), 트레이 팝오버 실물, Linux Secret Service 안내. 후속: #ui-winpath-followups(딥링크 경로 비교·`~` 줄임).