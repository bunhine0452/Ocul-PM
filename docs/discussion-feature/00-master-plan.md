# 00. 문제 해결 (Discussion) — 마스터 플랜 (SSOT)

> 본 문서의 위상: 본 폴더의 모든 후속 문서가 참조하는 **단일 출처**.
> 변경 시 다른 문서의 표제 인용을 함께 업데이트한다.
> 작성일 2026-06-29. attribution: claude-code (Opus 4.8).
> 형식 선례: [`../planner-upgrade/00-master-plan.md`](../planner-upgrade/00-master-plan.md).

---

## 0. Executive Summary (한 페이지)

ocul-pm 의 작성형 기능은 셋이다. **작업일지**(`.oculpm/journal/`)는 *무엇을 했나* 의 회고적·불변 기록, **플래너**(`.oculpm/planner/`)는 *무엇을, 어디까지* 의 전망적·살아있는 계획, **회고**(retro_insights 캐시)는 일지에서 뽑은 *사후 파생 신호*다. 그리고 **AI 패널**(`conversations`/`chat_messages`)은 휘발성 대화 도구다.

이 넷 어디에도 **"결정 전(pre-decision) 탐색"** 단계가 없다. 사용자가 *"이거 문제부터 같이 얘기해보자"*, *"한 세션에 안 끝나는 큰 결정"*, *"대규모 계획을 세우기 전 회의록"* 을 하려면 — 문제를 *정의*하고, 후보 *해결 방안*을 저울질하고, 조사한 파일·정보를 붙여가며 *여러 세션에 걸쳐* 다듬을 곳이 필요하다. 플래너는 이미 "할 게 정해진 다음"을 전제하고, 일지는 과거형이며, AI 패널은 디스크에 남지 않는 휘발성 대화다.

이 라운드의 명령: **"문제 해결" 을 일지·플래너와 동일한 파일 기반 문서타입으로 추가한다.** `.oculpm/discussion/<slug>/discussion.md` 가 SSOT 인 *살아있는 회의록 문서* — `## 문제 정의` 가 맨 위에 보이고, `## 후보 해결 방안` 으로 옵션을 저울질하고, `attachments/` 사이드카에 조사 자료를 붙이고, 결론이 나면 그 `## 다음 단계` 체크리스트를 **플래너로 승격**한다. 승격된 plan 과는 `resolution_ref` 로 연결되어, 퍼널 `문제 해결 → 플래너 → 작업일지 → 회고` 가 처음으로 *처음부터 끝까지* 이어진다.

핵심 통찰: 이 기능의 산출물은 *결론* 이고, 결론은 *플래너로 승격되며 사라지지 않는다*. AI 패널이 "대화하고 잊는" 도구라면, 문제 해결은 "토의하고 *남기는*" 도구다. **채팅은(나중에 붙더라도) 입력 수단, 문서가 산출물.**

---

## 1. 문제 해결의 정체성

> "문제 해결 문서는 *아직 결정되지 않은 무언가* 를 정의하고 저울질하는 **작업 공간**이다. 결론이 서면 그 문서는 *닫히고*(resolved), 결론은 플래너로 *승격*된다."

| 기둥 | 의미 |
|---|---|
| 결정 전(pre-decision) | 시간축이 플래너보다 *앞*. "할까? 뭐가 문제? 어떤 안들?" 미결정이 기본값 |
| 다세션(multi-session) | 한 번에 안 끝남. 여러 날에 걸쳐 *제자리에서 다듬는* 살아있는 문서 |
| 문제 우선(problem-first) | `## 문제 정의` 가 1급·최상단·필수. 정의 없는 토의는 표류 |
| 자료 보유 | repo 파일 참조 + 첨부 사이드카(이미지·PDF·메모) + 외부 링크를 *문서에 붙여 보관* |
| 결론 → 승격 | resolved 시 `## 다음 단계` 를 플래너 plan 으로 변환, `resolution_ref` 로 연결 |
| 파일 SSOT | `.oculpm/discussion/<slug>/discussion.md` 가 진실. SQLite 는 목록/검색 투영. git-diff·사람·외부 에이전트 편집 가능 |

---

## 2. 4개 기능과의 구분 — 불변식 (가장 중요)

겹침을 영구히 막는 5개 불변식. 모든 후속 문서·코드·리뷰는 이를 위반하면 안 된다.

1. **시간축.** 문제 해결 = 결정 *전*(미결정). 플래너 = 결정 *후*(전망). 일지 = 실행 *후*(회고). 회고 = 사후 *집계*.
2. **결정 상태.** 문제 해결의 본질은 *미결정 → 결론 도출* 이다. 결론이 나면 `status: resolved` 로 잠그고 플래너로 승격한다. **문제 해결 문서는 진척(progress)을 추적하지 않는다** — 진척은 승격된 plan 의 소유.
3. **소유 방향.** 문제 해결은 플래너/일지를 *낳거나(승격) 참조* 한다. 역으로 플래너·일지가 문제 해결의 상태를 *소유하지 않는다*. (`resolution_ref` 는 discussion→plan 단방향 링크.)
4. **변경 의미론.** 문제 해결 = 플래너처럼 *제자리 갱신되는 살아있는 문서*(현재 내용 1개). 단 `## 토의 / 메모` 로그만 append. 일지처럼 불변(append-only 다건)이 아니고, 회고처럼 파생(읽기전용)도 아니다.
5. **AI 의 역할.** AI 패널 = 프로젝트 전체 컨텍스트의 *휘발성 Q&A*. 문제 해결 = *이 문제로 스코프된 지속 문서*. 엔진(LLM)은 (다음 라운드에) 공유하되, AI 패널은 디스크에 안 남고 문제 해결은 `.oculpm/` 에 남는다.

> 한 줄 테스트: *"아직 뭘 할지 안 정해졌고, 문제부터 정의하며 옵션을 저울질하나?"* → 문제 해결. *"할 게 정해졌고 진척을 추적하나?"* → 플래너. *"이미 한 일을 기록하나?"* → 일지. *"그냥 빠르게 물어보고 잊을 건가?"* → AI 패널.

### 2.1 퍼널 한눈에

```
  문제 해결            플래너            작업일지           회고
 (Discussion)        (Planner)        (Journal)        (Retro)
  결정 전              결정 후            실행 후            사후
  "할까/뭐가문제"  ──▶  "어떤순서로"  ──▶  "뭘했나"     ──▶  "패턴이뭐였나"
       │  resolution_ref      │  journal_ref       │  range aggregate │
       └── 승격(promote) ─────┘                     └──── 집계 ────────┘
```

---

## 3. 시스템 개요 (데이터 흐름)

```
                 ┌─────────────────── 작성자 (v1) ───────────────────┐
        사람 (앱 에디터)                          외부 에이전트(Claude Code/Gemini/…)
        │ discussion_write / _attach /            │ AGENTS.md "문제 해결" 규칙 따라
        │ _promote_to_plan 커맨드                  │ discussion.md 직접 편집(+ 토의로그 append)
        ▼                                          ▼
   ┌──────────────  .oculpm/discussion/<slug>/discussion.md  (SSOT)  ──────────────┐
   │  frontmatter + ## 문제정의 + ## 배경/자료 + ## 후보 해결방안(+{#id}) +          │
   │  ## 토의/메모(managed log) + ## 결론 + ## 다음단계(체크리스트 +{#id})           │
   │  └ 사이드카:  attachments/*.png|pdf|md  (조사 자료)                            │
   └───────────────────────────────────────────┬──────────────────────────────────┘
                                                │ watcher(기존 .oculpm watcher 확장)
                                                ▼  파싱·투영 (마크다운 = 진실)
            SQLite 캐시:  oculpm_discussions ·  _attachments ·  _log
                                                │
                          ┌─────────────────────┼─────────────────────┐
                          ▼                      ▼                     ▼
                  DiscussionScreenV2      "플래너로 승격"          Today 노출
               (목록 + 2-pane 문서)     plan_create/apply_edit   "결정 대기 N건"
                                        + resolution_ref 연결
```

- v1 작성 경로 2개(사람 앱 / 외부 에이전트 파일) **모두 같은 `discussion.md` SSOT 에 쓴다.** 귀속(`작성자`)으로 구분. (in-app AI = 다음 라운드 — 같은 SSOT 에 `inapp:*` 작성자로 합류 예정.)
- watcher·frontmatter·atomic_io·redact·index·lock 는 일지/플래너 인프라를 **재사용** → 백엔드 신규 표면 최소화.

---

## 4. Scope / Non-goals

### In scope (PR-DISC 0~5, [`04-implementation-checklist.md`](./04-implementation-checklist.md))
- `.oculpm/discussion/<slug>/` 트리 + `discussion.md` 마크다운 SSOT 포맷 + 첨부 사이드카 ([`01`](./01-data-model-and-markdown-spec.md)).
- SQLite `oculpm_discussion*` 투영 3테이블 + watcher 확장.
- 쓰기 경로: `discussion_create` / `discussion_write`(본문) / `discussion_set_status` / `discussion_rename` / `discussion_delete`.
- 조사 자료: `discussion_attach`(파일 복사 in) / `discussion_attachment_list` / `discussion_asset`(base64) + repo 파일/일지 참조.
- **플래너 승격**: `discussion_promote_to_plan` → `## 다음 단계` 를 plan 으로 변환 + `resolution_ref` 연결 + `status: resolved`.
- DiscussionScreenV2 신규 화면(10번째 ui_v2 화면) + Today "결정 대기 N건" 노출 ([`03`](./03-ui-screen-spec.md)).
- AGENTS.md "문제 해결 문서" 규칙 + 템플릿 동기화 ([`02`](./02-agents-protocol.md)).

### Non-goals (이 라운드 아님)
- **in-app AI 토의 엔진 연동** (chat_stream → 문서 안 대화/제안). 포맷은 forward-compat, 연동은 다음 라운드.
- 일지/플래너/회고 파이프라인 변경.
- 외부 SaaS 연동, 멀티유저 실시간 협업.
- 리치 WYSIWYG 에디터 (v1 은 마크다운 textarea + 렌더 프리뷰).

---

## 5. §5 잠금 결정 (확정분 — 2026-06-29)

> 진행 중 추가 결정은 [`04-implementation-checklist.md`](./04-implementation-checklist.md) §0 에 누적하고 본 표를 갱신한다.

| 결정 | 잠금 값 |
|---|---|
| 기능 정체성 | 결정 *전* 탐색·토의 문서 (퍼널 맨 앞). 진척 추적 안 함(§2-2) |
| 작성 모델 | **파일 기반 `.md` SSOT + watcher 투영** (사용자 결정). SQLite 우선 안은 기각 |
| SSOT 위치 | `.oculpm/discussion/<slug>/discussion.md` + `attachments/` 사이드카 (폴더-per-discussion) |
| SQLite 역할 | 읽기 전용 투영(캐시). 진실 아님 → 재구축 가능 |
| AI 패널 관계 | 공존. **v1 = 채팅 없는 수동 문서** (in-app AI 미연동, 다음 라운드). AI 패널 무변경 |
| 작성 주체 (v1) | 사람(앱) + 외부 에이전트(파일). 귀속 = `user` / `claude-code`/`gemini-cli`/… (일지와 동일 체계) |
| 상태 어휘 | `open`(탐색중) · `resolved`(결론·승격됨) · `archived`(보관). 진척 글리프 없음 |
| 식별 | 안정 slug `id`(frontmatter) = 폴더명. 옵션·다음단계는 `{#id}`(승격 추적) |
| 조사 자료 | repo 파일/일지 참조(복사 안 함) + `attachments/` 사이드카(외부 파일 복사 in) + 인라인 링크 |
| 승격 | `discussion_promote_to_plan`: `## 다음 단계` → plan 항목, `resolution_ref.plan_id` 연결, status=resolved. **LLM 불필요** |
| 동시쓰기 안전 | 기존 `.oculpm/.lock` + atomic_io. (플래너의 `plan_write_lock` 패턴 검토) |
| Today 노출 | `status: open` discussion 카운트 "결정 대기 N건" |

---

## 6. 위험 & 완화

| 위험 | 완화 |
|---|---|
| 작업일지/플래너와 기능 중복으로 표류 | §2 불변식을 리뷰 체크리스트화. 문제 해결은 *미결정* 을 소유, 결론은 *승격*. 진척 추적 금지 |
| AI/사람이 .md 포맷을 깨뜨림 | 파서는 *관용적*(섹션 누락 시 빈 값, 토의로그 managed block 격리). 깨진 부분은 UI 에 ⚠ 노출(침묵 실패 금지) |
| "문제 정의 없이 토의만" 표류 문서 | `## 문제 정의` 를 필수 1급 섹션으로. 비면 UI 에 빈 상태 프롬프트 |
| 첨부 파일 비대화 / 시크릿 유입 | 첨부는 사이드카로 격리(git 사용자 판단). `discussion.md` 본문은 redact.rs 마스킹. 첨부 바이너리는 본문 텍스트 아님 |
| 승격 후 discussion/plan 이중 갱신 | 승격 시 discussion=resolved 잠금(편집 가드). 이후 진척은 plan 단독 소유(§2-2,3) |
| 경로 탈출(`../`) 통한 첨부 임의 쓰기 | `secure_*_join` 패턴(docs.rs) 재사용 — discussion 폴더 밖 경로 거부 |

---

## 7. 진행 상태 (요약 — 상세는 §04)

| PR-DISC | 제목 | 상태 |
|---|---|---|
| 0 | 스키마 + 파일트리 + 파서 + watcher + 읽기 커맨드 | ✅ done (lib 302 green) |
| 1 | 마크다운 SSOT 쓰기 경로(create/write/status/rename/delete) + redact | ✅ done (lib 309 green) |
| 2 | 조사 자료 — 첨부 사이드카(attach/asset/detach) + read_raw | ✅ done (lib 311 green) |
| 3 | DiscussionScreenV2 (목록 + 2-pane 문서 + 편집) + 배선 | ✅ done (프론트 124 green) |
| 4 | 플래너 승격 브리지 + Today "결정 대기" 노출 | ✅ done (lib 312 green) |
| 5 | AGENTS.md "문제 해결" 규칙 + template_version 4 + 가드 | ✅ done (lib 312 green) |

**라운드 종료 (2026-06-29).** PR-DISC 0~5 전부 구현·검증 완료(미커밋). cargo lib 312 · 프론트 typecheck 0/test 124/lint 0/build green. 이월: in-app AI 토의 연동(다음 라운드, 포맷 forward-compat).
