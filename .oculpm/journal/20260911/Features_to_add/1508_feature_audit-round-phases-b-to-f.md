---
schema_version: 1
type: feature
slug: "audit-round-phases-b-to-f"
status: done
created_at: "2026-09-11T15:08:56+09:00"
session_id: "20260911-008"
agent:
  id: "claude-code"
  session: "2322524d-287e-4492-b82a-3b8cd46a1cfa"
language: "ko"
verified_by_user: false
files_touched: []
related: []
tags:
  - "mcp-tool"
---
[x] 감사 라운드 B~F — Claude 5 호환·모델 피커 · Notion/일지 편집/에이전트 알림 · 저장 공간 넷 · 업데이트 주기·항목 드래그·⌘[ 뒤로·single-instance · 문서와 bump 스크립트

## 무엇을

감사 라운드 2026-09-11 의 Phase B~F (플랜 `audit-round-2026-09-11`). Phase A 는 별도 일지.

**B — LLM 어댑터 호환**
- Anthropic 에 `temperature`(설정 기본 0.7)를 늘 실었다. Opus 4.7+ · Opus 5 · Sonnet 5 · Fable 는 샘플링 파라미터를 400 으로 거절 — `claude-sonnet-5` 를 적는 순간 채팅이 죽었다. 모델 id 로 세대를 읽어 4.6 이하(+Haiku 4.5·3.x)에만 보내고, 모르는 id 는 안 보낸다(`accepts_sampling_params`).
- OpenAI 본진은 `max_completion_tokens`, 추론 모델(o1·o3·o4·gpt-5)은 temperature 생략. OpenRouter/NIM 은 옛 모양 유지.
- `llm_list_models` (5 프로바이더의 /models) + 설정 → LLM 모델 칸이 초점 때 그 키의 목록을 `<datalist>` 로 띄운다(`ModelInput.tsx`, `llmApi.listModels`). 키를 바꾸면 다시 받는다.
- 기본 모델 `claude-sonnet-4-6` → `claude-sonnet-5` (더 새롭고 더 싸다), 퇴역 placeholder 정리.

**C — 막다른 UI**
- Notion: 설정(토큰·부모·OAuth)은 남았는데 트리거가 09-08 회고 삭제와 함께 사라졌었다. 일지 상세 「Notion 으로」(`useNotionExport`, `notionApi`) — 토큰 없으면 버튼 자체가 없다.
- 일지 본문 인라인 편집 — W4 부터 있던 `oculpm_update_entry_body` 에 손잡이가 없었다. 「편집」 → textarea → ⌘↩ 저장 / Esc. 기간 다이제스트 내보내기도 일지 툴바로 복귀. 미호출 `oculpm_compare_layers` 커맨드 제거.
- 에이전트 주의 알림 — 앱 안 Claude Code·Codex 가 승인을 기다리거나 턴을 마쳤는데 창이 뒤에 있으면 OS 알림 (`notify_agent_attention`, `tray.notify_agent` 기본 켜짐, 일지 알림과 스로틀 공유). 창이 앞이면 조용하다 (`attention.ts`).

**D — 저장 공간**
- 로컬 히스토리 프로젝트 예산(있던 상수 512MB)을 설정 `code_local_history_budget_mb`(64~8192)로, 설정 → 편집기에 노출.
- 옛 임베딩 모델 캐시(`models--intfloat--multilingual-e5-small` 465MB)를 기동 때 정리(`prune_retired_model_caches`).
- 지워진 프로젝트의 `aipm:workspace:v2:p<id>` 레코드 정리(`workspacePrune.ts`).
- `claude-events.jsonl` 전부 소비 + 1MB 초과면 비움(`compact_inbox`).

**E — UX**
- 업데이트 확인 기동 1회 → 하루 한 번 + 깨어날 때(6h). 닫은 배너는 그 버전만.
- `PlanEditOp::move_item {item_id, phase, before}` + 문서 뷰 행 드래그(행=그 앞, 단계 머리=그 끝), plan-log 「이동」 행.
- ⌘[ / ⌘] 화면 뒤로/앞으로 — `useNavHistory` 관찰 기반(사이드바·팔레트 이동도 잡힘), cap 50.
- `tauri-plugin-single-instance` — 두 번째 인스턴스는 기존 창을 앞으로 (예전엔 기동 때 앞 인스턴스의 락을 전부 뺏었다).

**F — 문서·릴리스**
- CLAUDE.md 화면 목록 16→15(Retro·Docs 삭제, Branch 추가), features 폴더 목록.
- 위키 shortcuts(⌘9 문서·⌘0 터미널 → 에이전트·AI 패널) · screens(옛 이름) ko/en + ⌘[ 행, build.mjs 재빌드.
- `scripts/bump-version.mjs` — 버전 6파일 + 랜딩 ko/en 각 6곳. 자리 수가 어긋나면 아무것도 안 쓴다. RELEASE.md §1 이 가리킨다.

## 왜

09-04 UX 후보 조사가 남긴 P1-5(항목 이동)·P2-7(뒤로가기), 회고 삭제가 남긴 막다른 표면 둘, 그리고 claude-api 스킬 표로 확인한 Claude 5 의 파라미터 거절.

## 검증

- vitest 209 파일 2,671 통과 · cargo test 33 스위트 전부 초록 · lint 6 게이트 · build · cargo-deny(single-instance 포함) ok.
- 새 테스트: `model_input_datalist` · `acp_attention` · `nav_history` · `bump_version`(실제 파일 dry-run) · journal_v2 본문 편집 2건 · plan_body_upgrade 드래그 3건 · update_banner 주기 1건 · Rust `sampling_params_only_go_to_models_that_take_them` · `move_item_between_phases_and_before_siblings` · `prune_removes_only_other_model_dirs` · `compact_only_when_fully_consumed_and_large` · `budget_setting_parses_clamps_and_defaults`.
- 실기기 미확인: OS 알림 실제 표시(승인 대기·턴 종료), datalist 의 WKWebView 렌더, 드래그 손맛, single-instance 의 dev↔설치본 동작(둘 다 같은 identifier 라 dev 를 띄우면 설치본 창이 앞으로 오고 dev 는 끝난다 — 의도).

## 남긴 것

- 모델 목록은 datalist 라 라벨(display_name)이 Safari 에서 보조 텍스트로만 뜬다. 진짜 피커가 필요하면 `ModelInput` 만 바꾸면 된다.
- Notion 은 본문 마크다운을 보낸다(diff 부록 없음).
- ⌘[ 는 화면 단위다 — 화면 안 위치(어느 파일·어느 계획)는 기억하지 않는다.