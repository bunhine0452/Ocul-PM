---
description: ocul-pm 플러그인 표면 전체 레퍼런스 카드 — 커맨드·MCP 도구·스킬·훅 한눈에
---

# /oculpm:help

아래 레퍼런스 카드를 사용자에게 **그대로 보여주고**, 상황에 맞는 다음 한 걸음을 한 줄로 추천하세요 (`.oculpm/` 이 없으면 `/oculpm:project_init`, 활성 플랜이 있으면 `/oculpm:next`).

## 커맨드 5종

| 커맨드 | 언제 |
|---|---|
| `/oculpm:project_init` | 새 저장소를 ocul-pm 추적 대상으로 초기화 (한 번) |
| `/oculpm:inception` | 새 프로젝트/기능 영역 설계 — 리서치→인터뷰→3-depth 계획 |
| `/oculpm:next` | 구현 루프 — 다음 미완 리프 구현→검증→일지→플랜 갱신 |
| `/oculpm:standup` | 오늘/최근 작업 요약 보고 |
| `/oculpm:help` | 이 카드 |

## MCP 도구 5종 (앱 설치 시)

`journal_write`(일지 작성) · `plan_status`(플랜 조회) · `plan_update`(항목 상태 갱신) · `plan_create`(새 플랜) · `project_init`(추적 초기화, confirm 필수)

## 스킬 5종 (자동 발동)

`oculpm-journal`(도구 없을 때 파일 기록 규격) · `project-inception`(설계) · `run-evals`(EVALS.md 실행) · `self-audit`(완료 선언 전 자기 감사) · `tdd-workflow`(테스트 먼저)

## 훅 (자동)

세션 시작/종료 이벤트 기록 · 활성 플랜 요약 주입(세션·서브에이전트) · 일지 미작성 세션 감지 + 배달 게이트(코드 변경에 일지가 없으면 세션당 1회 안내) · statusline 배지(옵인: `/statusline` 에서 `hooks/oculpm-statusline.sh` 지정)

전체 문서: oculpm.com/plugin
