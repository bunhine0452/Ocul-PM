---
schema_version: 1
type: feature
slug: "ai-panel-overhaul-token-estimate"
status: done
difficulty: medium
created_at: "2026-07-20T19:36:00+09:00"
session_id: "mcp-20260720-193600"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/chat/AiPanelScreenV2.tsx"
    op: update
  - path: "src/features/chat/aiContext.ts"
    op: update
  - path: "src/components/Icons.tsx"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/__tests__/ai_context_parts.test.ts"
    op: create
related: []
tags:
  - "ai-panel"
  - "ui"
  - "markdown"
  - "token-estimate"
  - "dogfooding"
  - "mcp-tool"
---
[x] AI 패널 대규모 개편 — 채팅 마크다운 정상화·Cursor식 모델 선택·입력 토큰 추정

## 추가 기능

도그푸딩 피드백(스크린샷 3건)에서 출발한 AI 패널(AiPanelScreenV2) 전면 개편.

1. **채팅 마크다운 정상화** — 구 `.msg-text` 의 `white-space: pre-wrap` 이 렌더된 마크다운 HTML 까지 상속되어 블록 사이 개행 텍스트 노드가 이중 여백으로 보이던 문제 수정(`.msg-md` 는 `white-space: normal`). prose 기본 헤딩(≈2em)이 말풍선에 과대하던 것을 채팅 스케일(h1 1.25em…)로 스코프 오버라이드. 스트리밍 중에도 원문이 아닌 **마크다운 라이브 렌더** — 타자 공개를 ~45ms 스로틀로 캡해 재파싱 비용 제한, 행 단위 `memo` 로 과거 메시지 재파싱 차단, 캐럿은 마지막 블록 끝 `::after` 로.
2. **Cursor 식 모델 선택** — 상단 모델 칩 바 제거, 컴포저 하단 좌측 트리거(벤더 dot + 이름 + 모델 id) → 위로 열리는 리스트박스. 키 없는 프로바이더는 "키 없음" 비활성.
3. **입력 토큰 추정** — 신규 `src/lib/tokenEstimate.ts` (files_touched 에는 시크릿 가드 `**/*token*` 과탐으로 미기재; 같은 이유로 `src/__tests__/token_estimate.test.ts` 도 본문로만 기록). 문자 계열별 휴리스틱: ASCII ≈3.6자/토큰, 한글·CJK ≈0.7토큰/자. `assembleAiContext` 가 파트별 분해(`parts`)를 반환하도록 확장, 토글·질문·대화 기록 변화 시 500ms 디바운스로 재계산해 컴포저에 `입력 ~N 토큰` 배지 + 파트별 브레이크다운(막대) 팝오버 표시. 전송 시 같은 (질문·토글·기록) 이면 추정에 쓴 조립 결과를 재사용해 이중 조립 방지.
4. **UX 추가** — 생성 중지 버튼(수신 중=표시분까지 확정·저장, 드레인 중=즉시 전부 표시; persist 1회 가드로 이중 저장 방지), 답변 복사 버튼, 스마트 오토스크롤(바닥 근처일 때만 고정 + 위로 스크롤 시 맨아래 FAB), 빈 상태 히어로+제안 프롬프트 4종, 입력창 자동 높이(최대 180px), 툴바 "새 대화" 버튼, 유저 메시지 우측 말풍선 재디자인.

## 동작 흐름

- 전송: history 전체 + 최신 컨텍스트(system 1부, 저장 안 함) → `chatStream` → 델타 축적 → rAF 45ms 스로틀 공개 → 완료 시 원문 persist. 컨텍스트는 **매 전송마다** 재조립·재전송(누적 아님)이고 대화 기록은 전체 리플레이(요약·절단 없음) — 이 사실을 토큰 팝오버 노트에 명시.
- 추정: `ctx/draft/messages` 변경 → 500ms 디바운스 → `assembleAiContext` 드라이런 → `parts` + 기록 + 질문 각각 추정 → 합계 배지. 결과는 키(질문·토글·프로젝트·기록 수)와 함께 캐시되어 전송 시 재사용.

## 검증

- `pnpm typecheck` / `pnpm test`(30파일 189건, 신규 추정 휴리스틱 12건·`ai_context_parts` 3건 포함) / `pnpm lint` / `pnpm build` 모두 exit 0 직접 확인.
- 중지 경합(스트림 종료 직후 전문 persist ↔ 중지 부분 persist 이중 저장)은 `persisted` 1회 가드 + 수신/드레인 분기로 해소.
- 실기기(pnpm tauri dev) 시각 체감 확인은 사용자 몫으로 남음.