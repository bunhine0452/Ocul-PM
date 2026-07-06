---
schema_version: 1
type: chore
slug: v2-release-prep
status: done
difficulty: low
created_at: "2026-07-07T00:10:00+09:00"
session_id: "20260707-m01"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: package.json
    op: update
  - path: src-tauri/tauri.conf.json
    op: update
  - path: src-tauri/Cargo.toml
    op: update
  - path: src-tauri/Cargo.lock
    op: update
  - path: CHANGELOG.md
    op: update
related:
  - 20260706/Chores/2120_chore_v2-master-plan-docs.md
tags: ["v2-release", "release", "changelog", "version-bump"]
---

[x] v2.0.0 릴리스 준비 — 버전 bump + CHANGELOG + 최종 게이트

## 한 일

- 버전 1.20.0 → **2.0.0** (package.json / tauri.conf.json / Cargo.toml, Cargo.lock 은 cargo 가 동기화).
- CHANGELOG v2.0.0 섹션 — 기존 톤(사용자 대면·혜택 중심 한국어)으로 3축 정리: ⌘K go-to-anything·⌘번호/⌘P·키보드 diff·낙관 토글·포커스 트랩 / 스탠드업·PR·주간 산출물·에이전트 5종 확대 / 번들 −58%·리렌더 수술·IPC 12+α→3·FTS·토스트/스켈레톤/로그 보존. "기존 `.oculpm/` 데이터 그대로(마이그레이션 불필요)" 명시.
- v2 라운드 전체 완료: **U1~U13 13유닛, 커밋 15개, 신규 테스트 — vitest 129→135(+nav/store/dialog/diff/planner 낙관), cargo 332→344(+어댑터 2·엔티티검색 3·summary 4·FTS 5)**.

## 검증

최종 게이트 (커밋 직전 직접 확인): cargo test **344 passed / 0 failed** · pnpm typecheck=0 · test=0 (18파일 135) · lint=0 · build=0.

## 메모

main 머지·태그 푸시(release.yml 빌드 트리거)는 사용자 결정 대기 — 마스터 플랜 §4 절차대로. 이월 백로그(F6 Q&A, P2 검토 세션, 반응형, 폰트 서브셋 등)는 docs/20260706_v2/00-master-plan.md §2 에 기록.
