---
schema_version: 1
type: chore
slug: readme-english-star
status: done
difficulty: low
created_at: "2026-07-16T20:12:00+09:00"
session_id: "20260716-m01"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: README.en.md
    op: create
  - path: README.md
    op: update
related:
  - journal/20260716/Features_to_add/2011_feature_skills-manager-screen.md
tags: ["docs", "readme", "i18n", "github-star"]
---

[x] README 영문판 신설 + 한글 README 스킬 화면 반영 — GitHub 글로벌 도달 정비

## 변경 요약

**README.en.md (신설)** — 한글 README v2.0 구조를 그대로 따르는 영문판. 직역이 아니라
전환(스타 유도) 목적의 자연스러운 영어로 재작성: 히어로/배지/내러티브 도입부/12화면/
에이전트 11종/설치(quarantine 안내 포함)/데이터 레이아웃/기술/빌드/로드맵/아웃트로.
비영어권 저장소의 star 상한을 푸는 최소 비용 항목이라 판단.

**README.md** — (1) 언어 스위처 줄(`한국어 · English`) 추가, (2) 화면 구성에 신규 "스킬"
불릿 추가 (.disabled 이동 규약 명시). 영문판에도 동일 반영.

## 검증

- 두 README 의 섹션 구조·링크 대상(oculpm.com/releases/CHANGELOG/LICENSE) 일치 눈검사.
- 앱 코드 무변경 — 게이트 영향 없음 (그래도 전체 게이트 재확인은 기능 일지 쪽에서 수행).

## 메모

- markdownlint 의 MD033(히어로 인라인 HTML) 경고는 GitHub README 관례상 기존과 동일하게 둠.
- 남은 star 정비는 저장소 밖 액션(topics·데모 GIF·런칭 글) — 사용자 결정 사항으로 플래너에 분리.
