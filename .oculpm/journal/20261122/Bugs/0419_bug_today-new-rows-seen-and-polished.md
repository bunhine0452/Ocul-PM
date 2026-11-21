---
schema_version: 1
type: bug
slug: "today-new-rows-seen-and-polished"
status: done
difficulty: medium
created_at: "2026-11-22T04:19:19+09:00"
session_id: "20261122-001"
agent:
  id: "claude-code"
  version: "Fable 5.2"
  session: "fe824e5d-958c-4ffc-9c86-900de7c6682a"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/today/TodaySide.tsx"
    op: update
  - path: "src/features/today/TodayExceptions.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/__tests__/today_live_fold.test.tsx"
    op: update
  - path: "src/__tests__/today_v4.test.tsx"
    op: update
related:
  - ref: "20261122/Features_to_add/0341_feature_today-auto-mode-blocked.md"
    kind: "followup"
  - ref: "20261122/Features_to_add/0322_feature_today-live-fold.md"
    kind: "followup"
tags:
  - "오늘"
  - "화면"
  - "디테일"
  - "mcp-tool"
---
[x] 오늘: 새 줄들을 실제 화면으로 보고 다듬는다

## 발생 원인

이 라운드에 오늘 화면에 들어간 새 줄들(자동 모드가 막은 행동 · 「지금 일하는 중」 의 접힌 줄 · 「N건 더 보기」)은 jsdom 테스트로만 확인된 채 main 에 올라가 있었다. 사용자가 그 시점에 「정교한 디테일 있는 UI 를 추구한다, 애플처럼」 이라고 말했다. 실제 CSS 로 띄워 보니 글자 조합이 어긋난 곳이 셋 있었다.

- 접힌 줄이 「그 밖에 일하는 중 · 기록 없음 22 35」 로 그려졌다 — 단서의 수(22)와 접힌 수(35)가 붙어 한 수처럼 읽혔다.
- 조용한 세션이 없을 때의 줄이 「30분 넘게 조용한 세션은 없어요 40」 — 문장 끝에 수가 매달렸다.
- 막힌 행동 줄이 「Bash git push --force origin main」 을 통째로 고정폭으로 그려, 도구 이름이 명령의 일부처럼 읽혔다. 「외 2건」 은 이웃 줄의 「외 1」 과 낱말이 달랐다.

## 해결 방법

- 접힌 줄은 이름 → 수 → 단서 차례로: 「그 밖에 일하는 중 35 · 기록 없음 22」. 조용한 세션이 없으면 문장만 선다(몇 개인지는 카드 머리가 말한다).
- 막힌 행동 줄은 도구 이름을 본문 서체로, 하려던 것(명령 첫 줄 · 경로 · 주소)만 고정폭으로: 「Bash · git push --force origin main 외 2 · 04:01」. 하려던 것을 모르는 도구(MCP)는 이름이 곧 기계 글씨다. 「외 N」 은 이웃 줄과 같은 낱말로 맞췄다.

보는 방법: 임시 하네스(앱의 Vite 설정에 `@/lib/bindings` 만 테스트용 가짜 백엔드로 바꿔 끼운 것)로 오늘 화면을 브라우저에 띄웠다. 커밋하지 않았다.

## 검증

- 브라우저에서 눈으로: 밝은 · 어두운 테마, 폭 640 · 900 · 1280 — 새 줄이 이웃 줄과 같은 칸 · 서체 · 줄 간격에 서고, 좁은 폭에서 단추가 이웃처럼 아래로 내려간다
- `pnpm test`: `Test Files  213 passed (213)` · `Tests  2008 passed (2008)` · typecheck · lint · build exit 0

## 메모

눈으로 본 것은 오늘 화면뿐이다. 변경 화면의 「볼 것이 없어요」 줄, 계획 기록의 「N줄 더 보기」, 일지 화면의 빈 문장은 아직 실제 화면으로 보지 못했다 — 설치본 눈 확인에 남는다. 백엔드 없이 화면을 띄워 보는 하네스를 저장소에 정식으로 두면 다음부터는 화면을 고칠 때마다 볼 수 있다(제안, 사용자 결정).