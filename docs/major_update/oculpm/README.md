# `.oculpm` 아키텍처 — 구현 계획 인덱스

> 상태: **확정 (1차 회의 종료)**  · 작성일 2026-05-22 · 작성자 Claude(Opus 4.7)
> 1차 회의 결과: [`../oculpm-architecture-review.md`](../oculpm-architecture-review.md)

---

## 0. 합의된 전제 (재확인)

| # | 결정 | 출처 |
|---|---|---|
| Q1 | **이중 레이어** — 앱 `index/`(ground truth) + 외부 LLM `journal/`(narrative) | review §3.1 |
| Q2 | **Markdown + YAML Frontmatter** 단일 포맷 | §3.2 |
| Q3 | git 정책 **C (분리)** — `index/` 는 ignore, `journal/` 은 commit (개인 git history 용도) | §3.3 |
| Q4 | 1차 지원 4종: **Claude Code, Cursor, Antigravity, Gemini CLI** | §3.4 |
| Q5 | **workday timezone** 명시적 설정 | §3.5 |
| Q6 | 파일명 `HHMM_<type>_<slug>.md` | §3.6 |
| Q7 | `.oculpm/{index,journal,agents,config.toml}` 디렉토리 분리 | §3.7 |
| Q8 | SQLite 는 **캐시**, `.oculpm/` 가 진실. 손실 없이 재생성 가능 | §3.8 |
| Q9 | Overview **재포지셔닝** (집계/메타 뷰), 죽이지 않음 | §3.9 |
| Q10 | Today 메인은 **타임라인 + 카테고리 필터** | §3.9 |
| Q11 | 버그 템플릿에도 **난이도 필드** 추가 | §3.10 |
| Intent-1 | 타깃: **개인 개발자** | — |
| Intent-2 | 외부 노출 **X** (로컬 only) | — |
| Intent-3 | "한 건의 작업" = **세션 단위** | — |
| Intent-4 | git 운영: **개인** | — |

→ 위 합의에 따라 **동시성/팀 협업 복잡도는 의도적으로 제거**됩니다. 단일 사용자, 단일 머신, 다중 인스턴스(여러 윈도우)만 방지.

---

## 1. 이 폴더의 문서 구성

| 파일 | 역할 | 독자 |
|---|---|---|
| [`00-spec.md`](./00-spec.md) | **명세서 (SSOT)**. 디렉토리 구조, 파일명, frontmatter 스키마, lock/atomic write, 에이전트 어댑터 형식. 다른 모든 문서가 이걸 참조한다. | 백엔드/프론트엔드/마이그레이션 담당 전원 |
| [`01-backend.md`](./01-backend.md) | Rust/Tauri 측 구체 구현. 신규 모듈, Cargo 의존성 추가, 20+ 신규 Tauri 커맨드, DB 캐시 테이블, 파일 워처, 세션 머신. | 백엔드 |
| [`02-frontend.md`](./02-frontend.md) | React/TS 측 구체 구현. 신규 타입, 컴포넌트, TodayScreen 재설계, Overview 재포지셔닝, 설정 UI. | 프론트엔드 |
| [`03-rollout.md`](./03-rollout.md) | W1–W6 페이즈 분해, 산출물, 인수 조건, 의존 그래프, SQLite→.oculpm 마이그레이션 UX, 리스크 레지스터, 롤백 전략. | PM (= 사용자), 전원 |

---

## 2. 마스터 의존 그래프

```
        ┌─ 00-spec.md (SSOT) ─┐
        │                     │
        ▼                     ▼
 01-backend.md           02-frontend.md
        │                     │
        └─────────┬───────────┘
                  ▼
            03-rollout.md
        (페이즈/마이그레이션/리스크)
```

스펙 변경이 발생하면 `00-spec.md` 만 수정하고, 다른 문서는 "스펙 §x 참조" 식으로만 갱신.

---

## 3. 빠른 요약 — 한 화면 개요

**무엇이 바뀌나**:
1. `.oculpm/` 가 프로젝트 루트에 생긴다. 앱이 `index/` (워처가 수집한 사실), 외부 LLM 이 `journal/` (서술).
2. 외부 LLM 에 자동으로 규칙 파일이 주입된다 (`.claude/CLAUDE.md` 의 관리 블록, `.cursor/rules/ocul-pm.mdc`, `.agent/rules/ocul-pm.md`, `GEMINI.md`).
3. 프로젝트 진입 시 디폴트 탭이 **Today** (타임라인 + 카테고리 필터). Overview 는 집계 뷰로 이동.
4. SQLite 의 changelog 시스템은 **read-only 모드**로 보존, 새 데이터는 `.oculpm/`. 마이그레이션 버튼으로 변환.

**무엇이 안 바뀌나**:
- 프로젝트 관리, AI Chat/QuickEdit, 터미널, planner, settings 같은 다른 기능은 그대로.
- Tauri/React/SQLite 라는 스택 자체는 그대로.

**가장 위험한 가정**:
- 외부 LLM 이 규칙 파일을 실제로 읽고 따른다는 가정. 따르지 않으면 `journal/` 이 비어버린다. → `index/` (ground truth) 가 항상 있으므로 데이터는 잃지 않지만, 사용자 경험이 "비어있는 카드들"이 된다. 완화책은 §03-rollout.md 의 리스크 레지스터 R-1.

---

## 4. 다음 액션

1. 사용자가 4개 문서를 읽고 코멘트 (필요 시 2차 회의).
2. 합의되면 `03-rollout.md` 의 W1 부터 착수.
3. 각 페이즈 종료 시 `docs/2026521/` 와 동일한 패턴으로 `docs/<workday>/Features_to_add/<HHMM>_features.md` 식 기록 — **이 자체가 본 프로젝트의 첫 `.oculpm/journal/` dogfooding**.
