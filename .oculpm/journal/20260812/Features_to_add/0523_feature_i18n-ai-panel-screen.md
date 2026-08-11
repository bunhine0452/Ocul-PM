---
schema_version: 1
type: feature
slug: "i18n-ai-panel-screen"
status: done
difficulty: medium
created_at: "2026-08-12T05:23:55+09:00"
session_id: "mcp-20260812-052355"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/features/chat/AiPanelScreenV2.tsx"
    op: update
  - path: "src/features/chat/aiActions.tsx"
    op: update
  - path: "src/features/chat/aiContext.ts"
    op: update
  - path: "src/features/chat/ConversationHistoryModal.tsx"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags:
  - "i18n"
  - "ai-panel"
  - "prompt"
  - "mcp-tool"
---
[x] AI 패널 영어화 — 12개 ui_v2 화면 전부 완료

chat 묶음 4파일. allowlist 66 → 62. **12개 ui_v2 화면이 전부 끝났다** — 남은 62개는 테스트 44개 + 트레이/온보딩/스킬 모델 등 비화면 모듈이다.

## 추가 기능

`ai.*` / `chat.*` 키 약 100개. 패널 툴바·히어로·예시 질문 칩·컨텍스트 첨부 칩·토큰 추정 팝오버·모델 선택·작성기, 플래너 액션 승인 카드, 대화 기록 모달.

## 무엇을 번역하지 않았나 — 세 갈래로 나뉜다

`aiContext.ts` 가 특히 섞여 있었다. 같은 파일 안에서:

1. **모델에게 가는 프롬프트 본문** (`### 프로젝트 작업 맥락 …`, `… 규칙 N개 절 생략`) — 03-i18n.md §4.5 대로 **한국어 유지**. 본문을 두 벌로 두면 한쪽만 고치는 드리프트가 반드시 생기고, 어차피 출력 언어만 지시하면 된다. 8곳에 사유를 적었다.
2. **화면에 보이는 파트 라벨** (`시스템 프롬프트` · `코드 N곳` · `플래너` · `작업일지`) — 번역. `parts[].key` 가 이미 별도 sentinel(`"rag"` · `"planner"` …)이라 라벨을 바꿔도 판별에 영향이 없다. `attached` 배열도 소비처가 표시뿐이라(`setLastAttached`) 안전했다.
3. **디스크·DB 에 기록되는 내용값** — 축이 다르다. 설정의 "AI 작성 언어"(`contentLanguage`) 는 힌트 문구가 명시하듯 *일지·플래너 항목·회고* 를 가리킨다. 그래서:
   - `aiActions` 의 기본 단계명 `할 일` · 기본 계획명 `새 계획` → **AI 제안으로 플래너 파일에 기록되는 항목**이라 contentLanguage 축. 그 축은 설정만 있고 소비처가 아직 없어(미배선) 한국어로 두고 상수(`DEFAULT_PHASE` / `DEFAULT_PLAN_TITLE`)로 모았다. 프롬프트의 `default 할 일` 도 같은 상수를 참조하게 바꿔 둘이 어긋날 수 없게 했다.
   - 대화 제목 `AI 패널` · `새 대화` → **앱이 붙이는 표시용 라벨**이지 AI 가 쓰는 내용이 아니라 UI 언어를 따르게 했다.

## deps 에 t 가 빠진 콜백 — 범위를 좁혀 대응

`useT()` 의 `t` 는 언어가 바뀔 때만 아이덴티티가 바뀌도록 설계돼 있는데(deps 무효화 1회), 실제 변환된 화면 23곳 중 deps 에 `t` 를 넣은 곳은 **하나도 없다**. 대부분은 무해하다 — `settings` 가 deps 에 있고 언어도 설정의 일부라 같이 재생성되기 때문이다.

문제가 되는 건 **DB 에 저장돼 영구히 남는** 자리뿐이다: 언어를 바꾼 뒤 "새 대화" 를 누르면 제목이 옛 언어로 굳는다. 이 3곳만 모듈 `t()`(`tNow` 별칭)로 바꿨다 — 아이덴티티가 고정이라 deps 가 필요 없고 호출 시점 언어를 읽는다. 나머지 20곳은 기존 관례를 따랐다(별도 정리 대상).

## 함정

- `t` 섀도잉 3곳 (누적 29회) — `for (const t of action.titles)` 두 곳과 `action.titles.map((t, idx) =>`. 치환 전에 `title` 로 개명했다.
- `SUGGESTIONS` 가 모듈 상수 문자열 배열이었다. `[t(…)]` 로 바꿨으면 임포트 시점에 언어가 굳는다 — 키 배열(`SUGGESTION_KEYS`)로 바꾸고 렌더에서 `t()` 를 부른다.
- `MessageRow` 는 `memo` 컴포넌트다. 모듈 `t()` 를 쓰면 props 가 그대로일 때 언어를 바꿔도 그 행만 옛 언어로 남는다 — `useT()` 를 써야 구독이 걸린다.
- 카드 문장(`항목 {id} 상태 → {status}`)은 id·상태가 `<span>` 으로 강조돼 중간에 끼어든다. §4.2 대로 사전에 JSX 를 넣지 않고 조각으로 쪼갰다 — 두 언어 모두 "항목 → id → 서술" 어순이라 성립한다.

## 검증

게이트 4종 exit 0 직접 확인 — typecheck / vitest 655통과 / lint(남은 미번역 62) / build.