---
schema_version: 1
type: chore
slug: "readme-landing-one-sentence-round-trip"
status: done
difficulty: low
created_at: "2026-09-22T19:44:32+09:00"
session_id: "20260922-005"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "256d1ee0-6a6c-4ddd-bb2b-659045f7df5e"
language: "ko"
verified_by_user: false
files_touched:
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
  - path: "landing/index.html"
    op: update
  - path: "landing/en/index.html"
    op: update
  - path: "landing/landing.css"
    op: update
related: []
tags:
  - "landing"
  - "readme"
  - "onboarding"
  - "first-record-loop"
  - "mcp-tool"
---
[x] README·랜딩을 「어제를 다시 설명하지 마세요」 한 문장과 왕복 3단계 중심으로 편집

## 동기
사용자가 첫 사용자 3명 확보 전략을 가져왔다: 「AI로 개발하다가 다음 날 맥락을 다시 설명하는 게 귀찮은 사람」이 대상이고, 소개는 기능 목록 대신 한 문장 — **「AI와 어제 어디까지 작업했는지, 오늘 다시 설명하지 마세요」** — 을 앞세우며, 시연은 작업 → 첫 일지 → 이어하기 왕복. v3.4.0 의 첫 기록 카드·이어하기가 정확히 그 불편을 겨냥하므로 소개 면을 거기에 맞췄다.

## 변경 요약
- **README.md / README.en.md** — 상단 태그라인을 그 한 문장으로, 도입 문단을 「다음 날 다시 설명하는 비용」으로 다시 썼고, 「세 가지처럼 보이지만」 앞에 새 섹션 **「한 왕복 — 작업 · 첫 일지 · 이어하기」**(3단계 + 검증 경로 명시)를 넣었다. 프라이버시 문단은 도입에 남기고 섹션 위로 올렸다.
- **landing/index.html / landing/en/index.html** — `<title>`·description·og·twitter·JSON-LD SoftwareApplication description 을 그 문장으로, `<h1>`·hero-sub·hero-fine 교체, 히어로 영상 캡션에 「왕복의 1 → 2 단계」 표기, 히어로와 문제 제기 사이에 `#loop` 섹션(3 카드 + 주석), 문제 제기 문단을 「오늘 아침 첫 10분」으로, FAQ 맨 앞에 「누구를 위한 앱인가요?」(details + FAQPage JSON-LD).
- **landing/landing.css** — `.loop / .loop-steps / .loop-step / .loop-note` (3열 → 860px 이하 1열, 카드 사이 → / ↓ 화살표).

## 정직성 경계
- 왕복 검증 경로는 **터미널 Claude Code + oculpm 플러그인** 만 적었고, Codex·Cursor·Gemini CLI 는 1·2 단계(규칙 파일)만, 3 단계 훅은 Claude Code 뿐이라고 명시.
- 왕복 영상은 아직 없다 — 기존 데모는 1 → 2 단계라고만 적었다. 「30초」 같은 측정 안 된 숫자는 쓰지 않았다.
- 카드 문구(「첫 기록」·「이어하기」·「이 맥락으로 이어서 작업」)는 `src/i18n/ko.ts`·`en.ts` 의 실제 키와 대조했다.

## 남은 것
- 시작 위키(landing/wiki-src)는 이번 요청 범위 밖이라 손대지 않음. 실제 왕복 촬영(3단계 포함)과 설치본 왕복 확인은 사용자 몫({#p1-verify}).
- 랜딩은 git 연동이 없으므로 `cd landing && vercel --prod` 로 별도 배포.

## 검증
- JSON-LD 두 블록 × 두 로케일 `json.loads` 통과, FAQ 31문항. `python -m http.server` + Chrome 으로 ko/en 히어로·`#loop` 섹션 렌더 육안 확인.
- `pnpm lint`: storage·i18n·bindings·design·filesize 통과. eslint 는 `.claude/worktrees/agent-*` 세 개(다른 세션의 locked worktree)가 tsconfigRootDir 후보로 잡혀 실패 — 이 변경(md/html/css)과 무관, 워크트리 정리 뒤 재실행 필요.
- `landing_pages.test.ts` 8/8.