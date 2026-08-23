---
schema_version: 1
type: feature
slug: nav-naming-ai-group
status: done
difficulty: low
created_at: "2026-08-24T01:52:00+09:00"
session_id: "manual-20260824-015200"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
files_touched:
  - path: "src/lib/navRegistry.ts"
    op: update
  - path: "src/components/Icons.tsx"
    op: update
  - path: "src/components/Sidebar.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/nav_registry.test.ts"
    op: update
  - path: "src/__tests__/sidebar_a11y.test.tsx"
    op: update
  - path: "src/__tests__/discussion_v2.test.tsx"
    op: update
related: []
tags: [sidebar, naming, ia, i18n]
---

[x] 사이드바 이름·아이콘·그룹 정비 — 논의 · Diff · AI 대화 · AI 섹션 분리

## 추가 기능

사이드바 라벨 3개가 실체와 어긋나 있었다 (사용자 지적: "이게 최선인가? 촌스럽게
지으면 안돼").

- **"문제 해결" → "논의"** — 실체는 논의 문서 편집기(옵션 비교·결정 기록)인데
  트러블슈팅처럼 읽혔다. 커밋 메시지의 내부 어휘("논의 편집기")와도 정렬.
  아이콘도 말풍선 하나(MessageSquare, 채팅과 겹침) → 둘(MessagesSquare, 토론).
  화면 안 문구 3곳(빈 상태·삭제 확인·Today 버튼)도 "논의"로 통일.
- **"변경 diff" → "Diff"** — 유일한 한글+영어 혼합 라벨이라 혼자 톤이 달랐다.
  개발자 대상 제품이니 diff 는 그 자체로 정확한 낱말이다 (en 도 Changes→Diff).
- **"에이전트" → "AI 대화"** — 실체는 프로바이더 API 채팅이지 에이전트가
  아니고, 진짜 에이전트 구동면(Claude Code)이 바로 아래라 역할이 충돌했다
  (en Agent→AI Chat).
- **"AI" 섹션 신설** — 도구에 혼재하던 AI 면을 분리: Claude Code(구동) →
  AI 대화(채팅) → 스킬·규칙(그 규칙). "코드"는 맨 끝에서 터미널 다음, 코드
  작업면(검색·맵·문서·터미널) 곁으로 이동.
- 유지한 것: Sunrise(오늘 현황)·Target(플래너)은 기능 직결도는 낮아도 개성이
  있어 남김. 옛 이름(에이전트·문제 해결·변경)은 ⌘K 별칭에 보존 — 손버릇 유지.

## 동작 흐름

⌘번호는 navRegistry 배열 앞 10개에만 붙는다(터미널=⌘0) — 11번째 이후끼리는
재배치해도 단축키가 하나도 안 밀린다는 계약을 이용해 코드·AI 면을 무비용으로
옮겼다. `NavEntry.group` 에 "ai" 를 추가하고 Sidebar 가 세 번째 섹션 헤더를
그린다. ⌘K 팔레트는 그룹에 의존하지 않아(자체 nav 그룹으로 평탄화) 무변경.

## 검증

- `pnpm typecheck` · `pnpm lint` · `pnpm build` 통과.
- `pnpm test` 109파일 1277개 그린 — nav_registry(그룹 수 6+5+3, ⌘번호 불변
  ⌘9=문서·⌘0=터미널 고정), sidebar_a11y(새 라벨), discussion 빈 상태 문구 갱신.

## 메모

- AI 프롬프트 문자열(disc.prompt.*)과 aiContext 헤더의 "문제 해결 문서" 는
  LLM 에게 가는 기능 텍스트라 이번 범위에서 제외 — 다음에 일괄 정리 후보.
- 저장된 uiV2View id("ai"·"discussion" 등)는 전부 유지 — 영속 상태 호환.
