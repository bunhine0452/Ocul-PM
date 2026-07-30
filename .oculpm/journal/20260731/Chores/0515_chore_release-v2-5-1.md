---
schema_version: 1
type: chore
slug: "release-v2-5-1"
status: done
difficulty: low
created_at: "2026-07-31T05:15:47+09:00"
session_id: "mcp-20260731-051547"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "CHANGELOG.md"
    op: update
  - path: "src-tauri/tauri.conf.json"
    op: update
  - path: "package.json"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/Cargo.lock"
    op: update
  - path: "plugin/oculpm/.claude-plugin/plugin.json"
    op: update
  - path: ".claude-plugin/marketplace.json"
    op: update
  - path: "landing/index.html"
    op: update
related: []
tags:
  - "release"
  - "v2.5.1"
  - "notion-oauth"
  - "project-inception"
  - "mcp-tool"
---
[x] v2.5.1 릴리스 — Notion 계정 연결(OAuth) + project-inception v2

v2.5.0 태그 이후 쌓인 변경을 v2.5.1 로 묶어 배포:

- **Notion 계정 연결(OAuth)** — 설정 버튼 → 브라우저 승인 → 루프백 수신 → OS 키체인 저장 (수동 API 키 방식 병행 유지)
- **project-inception 스킬 v2** — 인터뷰(1차)→웹 리서치(2차) 2단 구체화
- 기타: README 한/영 v2.5.0 섹션, 랜딩 리뉴얼

릴리스 절차: 버전 동기화 6곳(tauri.conf.json/package.json/Cargo.toml/Cargo.lock/plugin.json/marketplace.json — build-sidecar 스탬프·plugin_manifest 테스트 정합) + 랜딩 JSON-LD softwareVersion, CHANGELOG `## v2.5.1` 섹션(release.yml awk 추출 규격), 릴리스 커밋에 태그 v2.5.1 → release.yml 빌드.

사전 검증: 3-에이전트 적대 워크플로(버전 동기화/체인지로그 정확성/파이프라인) — 블로커 1건은 "미커밋 상태에서 태그 금지"(절차상 예정된 순서로 해소), 체인지로그의 토큰 저장 문구를 "서버에는 아무것도 저장되지 않습니다"로 엄밀화. release.yml 은 cargo test 를 돌리지 않으므로 버전 동기화는 로컬 게이트가 유일한 방어선임을 확인.

## 검증

typecheck/lint/test/build/cargo test 전부 exit 0 (Cargo.lock 2.5.1 갱신 포함). awk 노트 추출 헤더 바이트 일치 확인. 태그 푸시 후 release.yml 성공·latest.json 2.5.1 서빙은 커밋 후 별도 확인.