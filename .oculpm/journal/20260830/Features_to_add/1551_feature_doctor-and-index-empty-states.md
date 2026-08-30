---
schema_version: 1
type: feature
slug: doctor-and-index-empty-states
status: done
created_at: 2026-08-30T15:51:00+09:00
session_id: "manual-20260830-155100"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
difficulty: medium
files_touched:
  - path: src-tauri/src/commands/project.rs
    op: update
  - path: src-tauri/src/db/code_index.rs
    op: update
  - path: src/features/settings/tabs/DoctorSection.tsx
    op: create
  - path: src/features/settings/tabs/DiagnosticsTab.tsx
    op: update
  - path: src/lib/integrityLog.ts
    op: create
  - path: src/contexts/WorkspaceContext.tsx
    op: update
  - path: src/features/search/SearchScreenV2.tsx
    op: update
  - path: src/features/graph/GraphScreenV2.tsx
    op: update
  - path: src/components/EmbeddingModelBanner.tsx
    op: update
  - path: src/components/Icons.tsx
    op: update
  - path: src/i18n/ko.ts
    op: update
  - path: src/i18n/en.ts
    op: update
related:
  - .oculpm/journal/20260830/Features_to_add/1551_feature_first-run-card-and-tab-close-guard.md
tags: [diagnostics, search, graph, embedding, polish-round]
---

[x] 진단 탭의 「닥터」 — 워처·락·ACP·키·색인·셸·훅·MCP 한 표 + 세션 무결성 경고 목록 · "색인 없음" 을 "결과 없음" 이라 하던 검색·코드 맵 · 임베딩 배너 닫기/다시 받기

## 배경

- "AI 가 일지를 써도 화면이 안 바뀐다" 를 겪은 사람이 워처·락·훅·색인 중 어디가 막혔는지 볼 곳이 없었다. 진단 탭은 DB 크기와 피드백 버튼이 전부였고, 락 상태와 마지막 색인 시각은 아예 노출되지 않았으며, 무결성 경고는 8초 토스트로 지나갔다.
- 검색의 세 커맨드(`search_symbols/text/chunks`)는 색인이 없어도 빈 배열을 돌려준다 → "결과가 없어요. 다른 키워드로…" 라는 거짓 안내. 코드 맵도 "인덱싱되지 않았거나 관계가 없을 수 있어요" 로 얼버무렸다. 임베딩 모델 실패 배너는 닫을 수도 다시 받을 수도 없었다.

## 변경

- `ProjectStats.last_indexed_at`(`MAX(files.indexed_at)`, f64) 추가.
- `DoctorSection`: 9행(ocul-pm 초기화·워처·락·Claude Code 런타임·API 키·코드 색인·셸 통합·Claude 훅·MCP) — 상태 점(ok/warn/danger/off) + 값 + 그 자리에서 고치는 버튼(활성화·워처 시작·락 넘겨받기·어댑터 설치·키 설정·색인 만들기·설정 열기). 조사는 `Promise.all` 로 한 번, 실패한 조사만 "확인 실패". 색인이 끝나면 행이 저절로 갱신된다.
- `lib/integrityLog.ts`: 세션 링 버퍼(50, `useSyncExternalStore`) — `WorkspaceContext` 의 워처 경고 리스너가 밀어 넣고 토스트에 「진단에서 보기」(`openSettings("diagnostics")`) 가 붙는다. 닥터가 프로젝트별로 목록·지우기.
- 검색: `projectStats` 로 `chunks===0` 이면 검색어 전에도 「아직 코드 색인이 없어요 + 색인 만들기」, 색인 중이면 진행률(`indexProgress`). 코드 맵: 같은 판정으로 제목·힌트·버튼이 갈라지고, 색인이 끝나면(indexing true→false) 그래프를 다시 읽는다. `graph.indexHint` 는 이제 엣지 유형 이야기만 한다.
- 임베딩 배너: 실패 시 「다시 받기」(= `requestReindex`, 임베더는 첫 사용 때 모델을 받는다) + ×, 완료 시에도 ×.

## 검증

앞 일지와 같은 게이트 전부 exit 0. 닥터는 프로젝트가 없는 시작 화면 설정에서도 죽지 않는다(`useOptionalWorkspace`).

## 한계 / 후속

- 락 보유자(pid·호스트)는 `LockStateView` 4값 enum 뿐이라 "다른 프로세스" 까지만 말한다 — Rust 가 `LockInfo` 를 내면 행에 붙인다.
- 무결성 경고는 메모리 — 앱을 껐다 켜면 워처가 다시 읽으며 다시 낸다.
