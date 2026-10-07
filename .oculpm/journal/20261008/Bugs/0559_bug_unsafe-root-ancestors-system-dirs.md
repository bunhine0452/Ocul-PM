---
schema_version: 1
type: bug
slug: "unsafe-root-ancestors-system-dirs"
status: done
difficulty: low
created_at: "2026-10-08T05:59:27+09:00"
session_id: "20261008-003"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "4450d61f-8efa-44ff-b9ec-4e171492ed94"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/paths/tool_config.rs"
    op: update
  - path: "src-tauri/src/oculpm/error.rs"
    op: update
  - path: "src-tauri/src/commands/greenfield.rs"
    op: update
  - path: "src/features/onboarding/GreenfieldWizard.tsx"
    op: update
  - path: "src/windows/StartTab.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related:
  - ref: "20261007/Bugs/1048_bug_unsafe-project-root-guard.md"
    kind: "followup"
tags:
  - "security"
  - "project-root"
  - "mcp-tool"
---
[x] [x] /Users·/etc 같은 상위 폴더가 프로젝트로 추가되던 것 — 홈의 조상·최상위 시스템 폴더 거부

## 발생 원인

v3.8.0 의 `is_unsafe_project_root` 는 파일시스템 루트와 홈 **자체**만 막았다. 3차 피드백대로 `/Users`(홈의 위)·`/etc` 는 그대로 추가됐고, 그러면 `.oculpm/`·규칙 파일이 그 자리에 깔리고 워처·색인이 다른 사용자의 홈이나 시스템 트리를 걷는다. 새 프로젝트 마법사(`create_greenfield_project`)는 관문을 아예 지나지 않았다.

## 해결 방법

- 순수 판정 `is_unsafe_project_root_of(canon, home)` — 루트 · 홈과 그 조상(`home.starts_with(canon)`) · `SYSTEM_DIRS` 정확 일치. 시스템 폴더 목록은 소문자 `/` 모양이고, macOS 의 `/private/…` 정규화 모양과 Windows 의 드라이브 문자를 뗀 `\Windows`·`\Program Files`·`\ProgramData` 를 함께 둔다.
- 시스템 폴더는 **그 자체만** 막는다 — `/etc/nixos`·`/usr/local/src/앱`·`/opt/work` 처럼 그 아래에서 일하는 경우는 실제로 있다.
- 마법사도 같은 관문 + 거부 코드를 사람 말로. 문구는 루트·홈과 그 위·시스템 폴더 세 경우를 말한다.

## 검증

`top_level_system_folders_are_refused_but_not_what_is_inside_them`(유닉스·Windows 모양 표) + 기존 `the_filesystem_root_is_never_a_project_root` 에 홈의 부모 단언 추가, 통과. 실기기에서 거부 문구 육안은 아직.