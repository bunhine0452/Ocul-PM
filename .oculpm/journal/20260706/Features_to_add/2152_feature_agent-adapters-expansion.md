---
schema_version: 1
type: feature
slug: agent-adapters-expansion
status: done
difficulty: medium
created_at: "2026-07-06T21:52:00+09:00"
session_id: "20260706-m01"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/src/oculpm/agents/mod.rs
    op: update
  - path: src-tauri/src/oculpm/agents/templates/windsurf.md.tpl
    op: create
  - path: src-tauri/src/oculpm/agents/templates/copilot.md.tpl
    op: create
  - path: src-tauri/src/oculpm/agents/templates/aider.md.tpl
    op: create
  - path: src-tauri/src/oculpm/agents/templates/cline.md.tpl
    op: create
  - path: src-tauri/src/oculpm/agents/templates/zed.md.tpl
    op: create
  - path: src-tauri/src/oculpm/config.rs
    op: update
  - path: src-tauri/src/oculpm/manager.rs
    op: update
  - path: src-tauri/src/oculpm/spec.rs
    op: update
  - path: src/features/settings/OculpmSettings.tsx
    op: update
  - path: src/features/today/agentColor.ts
    op: update
  - path: src/lib/bindings.ts
    op: update
related: []
tags: ["v2-release", "U4", "A1", "agents", "adapters"]
---

[x] U4 에이전트 감지 확대 — Windsurf·Copilot·aider·Cline·Zed 어댑터 + codex 귀속

## 추가 기능

- `known_adapters()` 5행 추가 (전부 기존 `@AGENTS.md` 위임 stub 패턴, 마스터 템플릿 내용 불변이라 template_version 유지):
  - windsurf → `.windsurf/rules/ocul-pm.md` (Overwrite) · cline → `.clinerules/ocul-pm.md` (Overwrite)
  - copilot → `.github/copilot-instructions.md` (ManagedBlock — 사용자 지침 공존) · aider → `CONVENTIONS.md` (ManagedBlock) · zed → `.rules` (ManagedBlock)
- **Codex CLI 는 AGENTS.md 를 네이티브로 읽으므로 어댑터 불필요** — git 백필 귀속(`infer_agent_id`)에만 codex 추가.
- `infer_agent_id` 확대: copilot/codex/windsurf/aider/cline/zed — 짧은 이름 오탐 방지를 위해 **단어 단위 매치**(zed⊂optimized, cline⊂decline 차단).
- 감지(`adjacent_marker_for`): windsurf(.windsurf/.windsurfrules)·aider(.aider*)·cline(.clinerules)·zed(.zed), agents-md 범용 힌트에 4종 추가. copilot 은 .github 이 모든 저장소에 있어 인접 마커 없이 adapter_path 존재로만 판단.
- `KNOWN_AGENT_IDS` 10종으로 (config 검증 통과), Settings 체크박스 5종 추가, Today 에이전트 색/라벨 6종(codex 포함) 추가.

## 동작 흐름

설정에서 활성화 → sync_agents 가 stub 렌더/기록 (ManagedBlock 은 marker 블록만 소유, Overwrite 는 파일 전체). 비활성화 → 블록 제거/파일 삭제. 해당 도구가 일지를 쓰면 agent.id 로 귀속, git 백필은 커밋 트레일러에서 추론.

## 검증

- 신규 Rust 테스트 2개: ① 어댑터 테이블 계약(id/경로 유일·신규 5종 존재·전 id 가 KNOWN_AGENT_IDS 수용) ② 신규 5종 sync 왕복(inserted→unchanged 멱등→비활성 제거, marker/파일 실검증).
- cargo test 332 passed / 0 failed (bindings.ts 재생성 — spec doc 주석 반영 +7/−3).
- 프런트 게이트: typecheck=0 / test=0 / lint=0 / build=0.
