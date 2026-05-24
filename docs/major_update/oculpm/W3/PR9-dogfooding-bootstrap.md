# W3-PR9 — 수동 dogfooding 부트스트랩

> **목표**: W3 코드 PR (PR1~PR8, PR10) 종료 직후 사용자(나) 가 직접 `.oculpm/journal/<오늘>/` 에 최소 5개 entry 를 작성한다. **이 단계는 코드 PR 이 아니다** — W4 의 어댑터 템플릿 품질을 좌우하는 회고 입력을 만든다.
> **선행**: W3-PR1~PR8, PR10 모두 ✅.
> **참조**: [`../phases/W3-journal-today-ui.md`](../phases/W3-journal-today-ui.md) §W3-PR9.

---

## 1. 시드 entry 작성 (계획)

최소 5개:
- bug × 2
- feature × 2
- refactor × 1

다양한 frontmatter 조합 (difficulty / status / tags / files_touched) 으로 작성 — W4 어댑터 템플릿이 다룰 케이스 폭을 미리 검증.

### 추천 시드 1개 (의무)

- **type**: feature
- **title**: "Greenfield 위저드 → Today 자동 진입 흐름"
- **출처**: PR10 의 통합 흐름 1회 수동 검증.
- 이유: PR10 의 DoD §6 마지막 항목 ("`_dogfooding-w3.md` 에 Greenfield 흐름 1회 기록") 충족.

### 작성 방법

- 손으로 디스크에 `.md` 떨굼 (PR2 가 1초 안에 cache 반영) **또는** 프론트 `cmd+shift+j` 모달 사용 (PR6 의 ManualEntryModal). 둘 다 시도 권장.

---

## 2. 회고 파일 (계획)

`docs/major_update/oculpm/phases/_dogfooding-w3.md` 작성. 항목:

### 각 entry 별

- 작성에 걸린 시간 (분).
- frontmatter 작성 시 헷갈렸던 필드 (예: created_at tz 형식, slug 길이 한도).
- 본문 강제 섹션이 자연스러웠는지 (## 발생 원인 / ## 해결 방법 등이 강제될 수 있는지 검토 — W4 어댑터 템플릿의 강제 섹션 정책 입력).
- UI 가 잘못 표시한 케이스 (Card / Detail / Filter).

### 전체 회고

- 가장 마찰이 큰 필드 top 3 → W4 어댑터 템플릿에서 예시 강조 또는 default 자동 채움.
- 가장 마찰이 작은 패턴 → W4 어댑터의 권장 패턴.
- W3 의 UI 가 시안 (페이즈 §3) 과 얼마나 일치했는가 → W4-PR5 의 DiffVsNarrative 디자인 입력.
- PR10 의 Greenfield 흐름이 의도대로 동작했는가 → R-13 / R-14 완화책 검증.

---

## 3. W4-PR1 (어댑터 템플릿) 로의 피드백 (계획)

회고에서 발견된 패턴을 W4-PR1 의 `agents/_template.md` 첫 draft 에 인용한다.

예시 (가설):
- "created_at 의 timezone 형식이 헷갈림" → 어댑터 템플릿에서 명시적 예시 강조 (`created_at: "2026-05-24T09:25:13+09:00"`).
- "slug 길이 60자가 너무 길어서 파일명이 길다" → 어댑터 템플릿에서 권장 40자로 제한.
- "files_touched 의 op 가 add/modify/delete 중 헷갈림" → 어댑터 템플릿에서 enum 그대로 + 짧은 매핑 표.

W4-PR1 의 PR 본문에 회고 인용이 **최소 1건** 들어가야 본 PR 의 DoD §4 마지막 항목 충족.

---

## 4. DoD

- [ ] `_dogfooding-w3.md` 파일 존재.
- [ ] 시드 entry 5+ 개 (bug×2 + feature×2 + refactor×1 minimum).
- [ ] 각 entry 의 작성 시간 / 헷갈린 필드 / UI 이슈 기록.
- [ ] 전체 회고 섹션 (가장 큰 마찰, UI ↔ 시안 일치도, PR10 흐름 검증).
- [ ] W4-PR1 의 PR 본문이 본 회고를 **최소 1건 인용** (W4 진입 시 검증).

---

## 5. 작성 가이드 (참고)

### 시드 entry 파일명 규칙 (`00-spec.md` 따름)

```
.oculpm/journal/<YYYYMMDD>/<TypeFolder>/<HHMM>_<type>_<slug>.md

예시:
.oculpm/journal/20260524/Bugs/0925_bug_changelog_export_param_mismatch.md
.oculpm/journal/20260524/Features/1015_feature_greenfield_to_today.md
.oculpm/journal/20260524/Refactors/1130_refactor_session_actor_query.md
```

### frontmatter 최소 셋

```yaml
---
schema_version: 1
type: bug
slug: changelog_export_param_mismatch
status: done
created_at: "2026-05-24T09:25:13+09:00"
session_id: "20260524-003"
agent:
  id: manual
  kind: manual
language: ko
difficulty: medium
title: "Changelog Export 파라미터 불일치"
tags: [changelog, sqlite]
files_touched:
  - { path: "src-tauri/src/db.rs", op: modify }
verified_by_user: false
---
```

### 본문 강제 섹션 (제안)

- `## 발생 원인` (bug / error 일 때)
- `## 해결 방법` (bug / error / refactor)
- `## 검증` (모든 type)
- `## 메모` (선택)

---

## 6. 실행 노트 (작업 중 갱신)

### 작성 진행

| # | type | 파일 | 작성 시간 | 비고 |
|---|---|---|---|---|
| 1 | feature | `…/Features/HHMM_feature_greenfield_to_today.md` | ⬜ | PR10 흐름 |
| 2 | bug | | ⬜ | |
| 3 | bug | | ⬜ | |
| 4 | feature | | ⬜ | |
| 5 | refactor | | ⬜ | |

### 발견된 마찰 (작성 중)

(작성하면서 갱신 — frontmatter 필드명, 디폴트 모호함, UI 가 표시 못한 케이스 등)

### W4 어댑터 템플릿으로 넘기는 메모

(작성 중)
