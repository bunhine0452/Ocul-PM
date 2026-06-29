---
schema_version: 1
type: chore
slug: discussion-feature-design-docs
status: done
difficulty: low
created_at: "2026-06-29T11:40:12+09:00"
session_id: "20260629-m01"
agent:
  id: claude-code
  version: "Opus 4.8"
language: ko
verified_by_user: false
files_touched:
  - path: docs/discussion-feature/README.md
    op: create
  - path: docs/discussion-feature/00-master-plan.md
    op: create
  - path: docs/discussion-feature/01-data-model-and-markdown-spec.md
    op: create
  - path: docs/discussion-feature/02-agents-protocol.md
    op: create
  - path: docs/discussion-feature/03-ui-screen-spec.md
    op: create
  - path: docs/discussion-feature/04-implementation-checklist.md
    op: create
related: []
tags: ["discussion-feature", "design-doc", "planner", "dogfooding"]
---

[x] 문제 해결(Discussion) 기능 설계 문서 세트 작성

## 배경

작업일지(실행 후)·플래너(결정 후)·회고(사후)·AI 패널(휘발성) 어디에도 **"결정 전(pre-decision) 탐색"** 단계가 없다. 사용자가 *"이 문제부터 같이 정리하자 / 한 세션에 안 끝나는 큰 결정 / 대규모 계획 회의록"* 을 할 곳이 필요 — 문제를 정의하고, 후보안을 저울질하고, 조사 자료를 붙여가며 여러 세션에 걸쳐 다듬는 살아있는 문서. 퍼널 `문제 해결 → 플래너 → 작업일지 → 회고` 의 맨 앞을 채운다.

## 한 일

`docs/discussion-feature/` 에 planner-upgrade 세트와 동형의 설계 문서 6종 작성:
- README — 방향·확정 결정·문서 인덱스
- 00 마스터플랜 — 정체성, 4개 기능과의 구분(불변식 5), 데이터 흐름, scope, §5 잠금 결정
- 01 데이터모델 — `.oculpm/discussion/<slug>/discussion.md`(폴더-per) + frontmatter/섹션/토의로그(managed) + 첨부 사이드카 + SQLite 투영 3테이블(`024_oculpm_discussion.sql`) + 커맨드 11종
- 02 AGENTS 프로토콜 — "문제 해결 문서" 규칙(요청 기반·문제정의 우선) + 귀속 + **AI 참여를 다음 라운드로 명시 분리**(forward-compat)
- 03 UI 스펙 — DiscussionScreenV2(10번째 화면, 목록+2-pane), 첨부 레일, 플래너 승격 다이얼로그, Today 노출
- 04 구현 체크리스트 — PR-DISC 0~5 DoD + 결정 로그 + 진행표

## 핵심 결정 (사용자 잠금 2026-06-29)

- 별도 기능(퍼널 맨 앞). 진척 추적 안 함 — 결론은 플래너로 *승격*(`resolution_ref`).
- 저장 = 파일 기반 `.md` SSOT + watcher(SQLite 캐시). SQLite 우선 안 기각.
- AI 패널 관계 = **v1 채팅 없는 수동 문서**(사람+외부 에이전트 작성), in-app AI 토의는 다음 라운드.
- 범위 = 풀 기능 한 라운드(구조화 문서 + 첨부 + 플래너 승격 + Today 노출), 단 AI 토의 제외.

## 검증

설계 문서(.md)만 작성 — 코드 변경 0. 정확성 확인:
- 다음 마이그레이션 번호 = `024` (`ls migrations` 로 023 까지 사용 중 확인).
- `UiV2View` 에 `"discussion"` 추가가 신규임을 현재 union(today…settings)에서 확인.
- 형식/링크는 planner-upgrade 세트 선례에 맞춤(상대경로 인용).
