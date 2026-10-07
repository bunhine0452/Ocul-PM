---
schema_version: 1
type: bug
slug: "symlink-guard-general-files"
status: done
difficulty: high
created_at: "2026-10-07T20:26:19+09:00"
session_id: "20261007-004"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fdeb6d9e-9327-4e65-8f8a-4524621720ff"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/path_guard.rs"
    op: create
  - path: "src-tauri/src/commands/project.rs"
    op: update
  - path: "src-tauri/src/commands/external_editor.rs"
    op: update
  - path: "src-tauri/src/commands/diff.rs"
    op: update
  - path: "src-tauri/src/commands/code/mutate.rs"
    op: update
  - path: "src-tauri/src/commands/code/guards.rs"
    op: update
  - path: "src-tauri/src/indexer.rs"
    op: update
  - path: "src-tauri/src/oculpm/agents/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/lifecycle.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/register.rs"
    op: update
  - path: "src-tauri/src/plugins/install.rs"
    op: update
  - path: "src-tauri/src/oculpm/claude_hooks.rs"
    op: update
  - path: "src-tauri/src/oculpm/rules.rs"
    op: update
  - path: "src-tauri/src/commands/skills.rs"
    op: update
  - path: "src/features/settings/OculpmSettings.tsx"
    op: update
  - path: "src/i18n/errors.ts"
    op: update
related:
  - ref: "20261007/Bugs/0935_bug_symlink-escape-hardening.md"
    kind: "followup"
tags:
  - "security"
  - "symlink"
  - "external-review"
  - "mcp-tool"
---
[x] 일반 파일의 심볼릭 링크가 편집기 밖 창구와 열 때마다 도는 쓰기를 프로젝트 밖으로 돌리던 것

## 발생 원인

외부 보안 피드백 2차 #1: "`secure_join` 은 문자열만 비교하고 링크를 따라가지 않아, `docs -> ~/.config` 가 있으면 편집기의 읽기·저장·생성·삭제·이름 바꾸기가 밖에 닿는다. v3.8.0 의 링크 검사는 `.oculpm/` 안만 본다."

코드로 확인한 판정 — **맞되 자리가 달랐고, 더 컸다.**
- 코드 화면의 다섯 연산은 이미 둘째 관문(`canonical_within_root`·`resolve_for_mutation`)이 막고 있었다. 리뷰가 그 둘을 못 봤다.
- 첫 관문만 쓰는 창구는 정말 뚫려 있었다: 외부 편집기로 열기·터미널 경로 열기·심볼 펼침(`read_file_range`)·`read_project_file`·이미지 미리보기·변경 diff 의 디스크 읽기. 색인(`is_file()` 이 링크를 따라감)과 로컬 히스토리 캡처도 링크 대상 내용을 담았다.
- **리뷰가 짚지 않은 더 큰 자리**: 프로젝트를 열 때마다 도는 규칙 어댑터 동기(`sync_agents`)와 `.gitignore` 블록. 관리 블록 쓰기는 읽고 → 합치고 → rename 한다. `AGENTS.md -> ~/.zshrc` 는 대상 내용이 프로젝트 파일로 복사돼(에이전트 프롬프트·커밋으로 샐 수 있다) 링크가 일반 파일로 바뀌었고, `.claude -> ~/.claude` 는 쓰기가 전역 Claude 지침에 떨어졌다 — 블록 내용은 저장소의 `_template.md` 가 정한다.

## 해결 방법

- `path_guard` 모듈로 모았다. 어휘 검사 뒤 실재하는 가장 깊은 곳을 끝까지 풀어 정규화한 루트 안인지 본다. 마지막 구간은 셋 — 따라감(`secure_join`, 읽기·저장) · 링크 자체(`secure_join_entry`, 생성·삭제·이름 바꾸기) · 링크면 거부(`secure_join_managed`, 앱이 읽고 합쳐 쓰는 파일). 깨진 링크는 거부.
- 플러그인 설치기의 더 엄격한 판(안쪽 링크도 거부)은 그대로 두었다. 리뷰는 그걸 가져다 쓰자고 했지만 편집기는 안쪽 링크 폴더를 펼치는 기능이 있어 그대로 쓰면 기능이 깨진다.
- 어댑터 동기·`.gitignore` 블록·`.mcp.json`(등록·플러그인 병합)·훅 설정·Cursor 미러: 링크면 손대지 않는다. 규칙·스킬 화면의 프로젝트 범위는 링크까지 푼다. 설정 「지금 동기화」 가 멈춘 어댑터를 사유째 보인다(전에는 개수만). 오류 문구 셋을 ko/en 으로.
- 래칫 때문에 agents·rules·indexer 의 인라인 테스트를 옆 파일로 옮겼다.

## 검증

- 새 테스트: 경로 가드 7(폴더·파일 링크 밖/안·깨진 링크·링크 아래 루트) · 어댑터 동기 1(밖 파일 무변경·링크 보존) · 히스토리 캡처 1 · 색인 1. `cargo test` 2004 통과 · clippy 0 · `pnpm test`·lint·build 통과. PR #70.
- 실기기 미확인: 링크 든 저장소를 앱으로 열었을 때의 로그·동기화 사유 문구.