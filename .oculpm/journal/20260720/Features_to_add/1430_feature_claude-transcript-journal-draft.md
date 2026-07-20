---
schema_version: 1
type: feature
slug: claude-transcript-journal-draft
status: done
difficulty: high
created_at: "2026-07-20T14:30:42+09:00"
session_id: "manual-20260720-143042"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/src/oculpm/transcript.rs
    op: create
  - path: src-tauri/src/oculpm/journal_draft.rs
    op: create
  - path: src-tauri/src/oculpm/watcher.rs
    op: update
  - path: src-tauri/src/oculpm/spec.rs
    op: update
  - path: src-tauri/src/oculpm/manager.rs
    op: update
  - path: src-tauri/src/oculpm/config.rs
    op: update
  - path: src/features/settings/OculpmSettings.tsx
    op: update
  - path: src/features/oculpm/ManualEntryModalV2.tsx
    op: update
related:
  - 20260720/Features_to_add/1411_feature_claude-hooks-bridge.md
tags: ["claude-integration", "PR-CI1", "transcript", "journal-draft", "llm"]
---

[x] PR-CI1 — transcript → 작업 일지 자동 초안 (옵인)

## 추가 기능

훅 브리지(PR-CI0)가 감지한 Claude Code 세션 종료(AgentExit) 시, 그 세션의 transcript 를
설정된 LLM 으로 요약해 규격 일지 1건을 자동 작성한다 (마스터플랜 D4).

- **`transcript.rs`**: 비공식 JSONL 의 방어적 파서 — `type ∈ {user, assistant}` 의 텍스트
  블록만 취하고 sidechain(서브에이전트)·tool_result·깨진 라인은 무시. 긴 세션은
  head 4 + tail 16 접기 + 메시지당 문자 캡. 첫 assistant 의 `message.model` 을 실측
  모델명으로 추출 (frontmatter `agent.version` 감).
- **`journal_draft.rs`**: ① 세션 창 안에 에이전트 자필 일지가 있으면 스킵(중복 방지,
  mtime 판정) ② 자격증명 없으면 조용히 스킵 ③ transcript/LLM 실패는 **강등** — 세션
  메타 전용 chore 엔트리로 기록 소실 방지 ④ **규격은 코드가 보장**: LLM 은 JSON 으로
  내용만 채우고(type/slug/title/primary/secondary/verification), 타입별 강제 헤더·slug
  ASCII kebab 강제·frontmatter 조립은 결정적 composer + `create_manual_journal_entry`
  재사용 ⑤ redact 이중 방어(본문·제목 재마스킹) ⑥ forbidden 경로 섞이면 파일 목록 없이
  1회 재시도.
- **귀속**: `ManualEntryDraft` 에 옵셔널 `agent`/`verified_by_user` 오버라이드 추가 —
  자동 초안은 `agent.id=claude-code` + transcript 실측 모델, `verified_by_user=false`
  (수동 모달은 기존 의미 그대로).
- **배선**: `agents.auto_journal_draft` 옵인 플래그(기본 off) + watcher 가 AgentEnded
  직전 세션 스냅샷을 확보(mpsc 순서 보장으로 finalize 전 질의)해 fire-and-forget 스폰
  (단일 인플라이트 try_lock, reconcile 동형). 설정 Agents 섹션에 토글 + 과금 고지.

## 동작 흐름

SessionEnd 훅 이벤트 → watcher 가 (옵인 시) 활성 세션 스냅샷 확보 → AgentExit 종료 →
백그라운드: 자필 일지 검사 → transcript 파싱 → LLM JSON 초안 → 타입별 헤더 조립 →
redact → `create_manual_journal_entry` (세션 id 링크·auto-draft 태그) → watcher 일지
이벤트로 인덱싱 (옵인이면 auto-reconcile 도 자연 연쇄).

## 검증

- `cargo test` 344 그린 — 신규 12: transcript 4(실측 형태 파싱/사이드체인·tool_result
  스킵/접기·캡/빈 입력), journal_draft 6(응답 관용 파싱·빈 초안 거부/slug 강제/타입별
  헤더 순서/이벤트→files dedupe·마스킹 제외/자필 일지 창 판정/강등 본문), manager 1
  (agent 오버라이드 frontmatter 반영), 기존 스위트 회귀 0.
- `pnpm typecheck` / `test` 139 / `lint` / `build` 전부 exit 0.
- LLM 호출 자체는 네트워크라 단위 테스트 제외 — 주변(프롬프트 조립·응답 파싱·강등)을
  전부 순수 함수로 분리해 커버. 실기기 확인은 플래너 #ci1-runtime-verify.

## 메모

- 여러 터미널 세션이 겹치면 마지막 SessionEnd 의 병합 창으로 초안 1건 (v1 한계, 문서화).
- 큐잉(앱 꺼짐) 이벤트의 정밀 시각은 payload 에 없음 — transcript timestamp 로 보강됨.
- 캐시 하이드레이션이 agent_version 을 버리던 잠복 버그를 이 작업의 테스트가 발견 —
  별도 일지 (related 참조).
