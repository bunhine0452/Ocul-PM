---
schema_version: 1
type: refactor
slug: "unify-destructive-confirm"
status: done
difficulty: low
created_at: "2026-09-09T20:58:46+09:00"
session_id: "20260909-001"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "c997b348-9e50-41e9-845f-4681b1fda66a"
language: "ko"
verified_by_user: false
files_touched: []
related: []
tags:
  - "design"
  - "i18n"
  - "destructive"
  - "mcp-tool"
---
[x] 앱에서 가장 파괴적인 동작이 목록 행의 「버리기」와 같은 무게였다

## 동기

같은 "정말 지울래?" 를 세 방언으로 물었다.

| 경로 | 질문 | 버튼 |
|---|---|---|
| `useConfirm` (표준, AppDialog 모달) | "테마를 지울까요?" | `[취소]` `[삭제]` |
| `settings.danger.*` | "이 작업은 되돌릴 수 없습니다. 정말로 삭제하시겠습니까?" | `[예, 모두 삭제]` |
| `home/rows.tsx` | "정말 버릴까요?" | `[예]` `[아니오]` |

## 변경 요약

**둘 다 인라인 2단계 버튼이라는 게 핵심이었다.** 그래서 "모달로 통일" 이 답이 아니었다 — 목록 행의 초안 버리기는 인라인이 **맞다**. 모달을 띄우면 가벼운 정리 작업에 과한 무게가 실린다.

문제는 `DataTab` 쪽이었다. **이 컴퓨터의 모든 프로젝트 · 인덱스 · 대화 · 설정 · 저장된 API 키를 지우는** 앱 최대의 파괴적 동작이 목록 행의 「버리기」와 **같은 생김새**(인라인 2단계 버튼)였다. `useConfirm` 으로 옮겼다 — 마침 그 컴포넌트는 이미 훅을 쓰고 `confirmDialog` 를 렌더하고 있어서 상태 하나를 지우는 일이었다.

`rows.tsx` 는 인라인을 유지하되 **버튼이 결과를 말하게** 했다. `[예]/[아니오]` 는 2000년대 윈도우 대화상자 관용구다 — 사용자는 질문을 다시 읽어야 어느 쪽이 파괴인지 안다. `common.discard`("버리기") / `common.cancel`("취소") 로 바꾸고 `home.yes`/`home.no` 키를 지웠다.

문안도 다수결로 맞췄다. `"…하시겠습니까?"` 2건이 **하필 가장 위험한 자리 둘**(전체 삭제 · 프로젝트 제거)이었고, 나머지 28건은 `"…할까요?"` 였다.

```
이 작업은 되돌릴 수 없습니다. 정말로 삭제하시겠습니까?
  → 제목: 모든 데이터를 삭제할까요?
     본문: 이 컴퓨터의 모든 프로젝트 · 인덱스 · 대화 · 설정 · 저장된 API 키가
           사라집니다. 되돌릴 수 없습니다.
     버튼: [모두 삭제]
```

## 검증

`i18n_glossary.test.ts` 에 게이트 둘 추가(총 19개) — `"…하시겠습니까?"` 금지 · 버튼 라벨 `"예"`/`"아니오"` 금지.

`pnpm typecheck` · `pnpm lint`(6게이트) · `pnpm test`(195 파일 2,541개) · `pnpm build` 각 exit 0.