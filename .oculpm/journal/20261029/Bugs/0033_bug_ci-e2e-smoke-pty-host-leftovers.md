---
schema_version: 1
type: bug
slug: "ci-e2e-smoke-pty-host-leftovers"
status: done
created_at: "2026-10-29T00:33:57+09:00"
session_id: "20261029-001"
agent:
  id: "claude-code"
  session: "d10a8c2c-116c-4611-b76f-b84aa7c64d3d"
language: "ko"
verified_by_user: false
files_touched:
  - path: "e2e/scenario.mjs"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: ".github/scripts/install-smoke-windows.ps1"
    op: update
related:
  - ref: "20261028/Bugs/1929_bug_e2e-toast-overlap-english-switch.md"
    kind: "followup"
tags:
  - "ci"
  - "e2e"
  - "windows"
  - "simplify-round"
  - "mcp-tool"
---
[x] 보류 등급 제거 뒤 E2E 하네스와 Windows 설치 스모크가 걷어낸 터미널·PTY 호스트를 찾아 죽던 것

## 증상
PR #112 (보류 등급 제거) 의 Windows·Linux E2E 가 첫 스텝에서 `하네스 예외 — 사전 ko.ts 에 "term.crashTitle" 가 없다` 로 죽고, 그 위에 쌓인 PR #113 의 Portability 는 Windows 설치 스모크 gate 2건이 빨갰다: `재설치 프로브 — 준비 (B·C·D 호스트가 떠 있다)` → "재설치 전에 이미 죽은 프로브: B,C,D".

## 원인
둘 다 앱에서 사라진 것을 CI 하네스가 그대로 찾았다.
- `e2e/scenario.mjs` 가 에러 경계 제목으로 `crash.title` 과 함께 터미널 전용 `term.crashTitle` 을 사전에서 읽었다. 터미널 사전 키는 #112 에서 걷혔다.
- `.github/scripts/install-smoke-windows.ps1` §4 는 앱 exe 를 `--pty-host` 로 세 번 띄워(B 설치본, C 다른 이름 복사본, D 대문자 복사본) NSIS 재설치가 무엇을 끝내는지 캐묻던 프로브였다 — L-PTY2(PTY 호스트 재설계)에게 넘길 사실 수집용. 호스트 모드가 없어진 exe 는 바로 종료해 4초 뒤 "죽은 프로브" 가 된다.
- macOS CI 는 E2E·설치 스모크를 돌리지 않아 로컬·CI 초록으로는 보이지 않았다 (10-24 라운드와 같은 함정).

## 수정
- E2E: `crashTitles` 는 `crash.title` ko·en 둘만. 사전에 남아 있던 고아 키 `term.shellPending`(ko·en, 앞 항목과 한 줄에 붙어 있던 것)과 term.crash* 주석도 걷음. 사전에서 `term.` 접두 0건.
- 설치 스모크: 프로브 B·C·D·E 와 `Start-PtyProbe` 를 걷고, 재설치 뒤 gate 는 「실행 중이던 설치본(GUI)이 끝났다」 하나로. 남은 프로세스 관찰과 사후 청소 목록에서 `ocul-pm-ptyhost.exe` 제외. 스크립트 -97줄.

## 검증
- `pnpm lint` 6게이트 통과(i18n 포함), `pnpm typecheck` exit 0, `vitest i18n.test.ts · i18n_glossary.test.ts` 39건 통과.
- `e2e/lib/source.mjs loadDict` 로 ko·en `crash.title` 둘 다 해석됨을 확인.
- 실제 판정은 CI: #112 브랜치 `a4c6aaf6`, #113 브랜치 `f9c5669c`(머지 커밋) 의 E2E·Portability 재실행 결과를 본다 — 이 일지 시점엔 아직 안 끝났다.

## 교훈
화면·바이너리 모드를 걷을 때 `src/` 밖의 하네스 셋을 같은 grep 에 넣는다: `e2e/`(사전 키·nav 상수), `.github/scripts/`(설치 스모크 프로브), `e2e/lib/source.mjs`(소스 파서). 셋 다 macOS 로컬에서는 안 돈다.