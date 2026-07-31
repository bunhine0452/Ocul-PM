---
schema_version: 1
type: chore
slug: changelog-2-7-0-accuracy
status: done
created_at: 2026-07-31T23:12:00+09:00
session_id: "manual-20260731-231200"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - { path: CHANGELOG.md, op: update }
related: []
tags: [changelog, release, accuracy]
difficulty: verylow
---

[x] v2.7.0 체인지로그 정확성 수정 — 부정확 1·누락 2

사용자 요청("변경사항 changelog 에 잘 적용됐나?")으로 v2.6.0..v2.7.0 커밋 범위와 대조 검증:

- **부정확**: "미룬 일 원장 — 일지에서 수확" → 실제는 **코드 주석**(`oculpm-defer:` 마커, 기록 규칙 v8) 수확으로 정정 + no-trigger "썩는 중" 표기 언급.
- **누락**: 커맨드 완성 bullet 에 `/oculpm:project_init`(이 범위에 포함) 추가.
- **뉘앙스**: 상태줄 배지가 `/statusline` 옵인임을 명시.

게시된 GitHub 릴리스 노트 본문도 `gh release edit` 로 동일 패치 (3/3 반영 확인). 릴리스 자체는 건강: 태그·자산 4종·latest.json 2.7.0, 버전 동기화 4파일+랜딩 JSON-LD 전부 2.7.0, README/랜딩 헤드라인도 이미 갱신돼 있었음.

## 검증

패치 후 릴리스 본문 재조회로 3개 문구 반영 확인. 문서 전용 변경.
