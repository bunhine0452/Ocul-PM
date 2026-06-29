# 04. 구현 체크리스트 — PR-DISC DoD · 결정 로그 · 진행 상태

> 본 문서의 위상: 문제 해결(Discussion) 라운드의 *진행 추적표*. 각 PR-DISC 머지 시 해당 행이 ✅ 로 갱신된다.
> 선례: [`../planner-upgrade/04-implementation-checklist.md`](../planner-upgrade/04-implementation-checklist.md).
> 메타: 이 라운드가 끝나면 *이 문서 자체가 첫 discussion 문서*(또는 plan)로 흡수될 수 있다(self-hosting).

---

## 0. 시작 전 잠금 항목 (확정 — 2026-06-29)

> 핵심 결정은 [`00-master-plan.md`](./00-master-plan.md) §5 가 보유. 본 §0 은 *구현 측 정책* 잠금만.

### 0.1 작성 모델 / 정체성
- [x] **파일 기반 `.md` SSOT + watcher 투영** (사용자 결정). SQLite 우선 안은 reversal.
- [x] SSOT = `.oculpm/discussion/<slug>/discussion.md` + `attachments/`. SQLite `oculpm_discussion*` 는 재구축 가능한 캐시.
- [x] 결정 *전* 탐색 문서 — **진척(progress) 추적 안 함**(불변식 §2-2). 결론은 플래너로 승격.

### 0.2 4개 기능 불변식(겹침 금지)
- [x] 시간축: discussion=결정전 / planner=결정후 / journal=실행후 / retro=사후 ([`00`](./00-master-plan.md) §2).
- [x] 소유 방향: discussion→plan/journal 단방향(`resolution_ref`/참조). 역소유 금지.
- [x] 변경 의미론: discussion=제자리 갱신(살아있음), 토의 로그만 append.

### 0.3 AI 경계
- [x] **v1 = 채팅 없는 수동 문서.** in-app AI 토의 엔진 미연동(다음 라운드).
- [x] forward-compat: 토의 로그 `작성자` 열·섹션 구조 고정 → 다음 라운드 `inapp:*` 합류 시 포맷 변경 0.

### 0.4 백엔드 재사용(신규 표면 최소)
- [x] frontmatter/atomic_io/paths/watcher/redact/lock = 일지·플래너 인프라 재사용.
- [x] 승격 = 플래너 `plan_create`/`plan_apply_edit` 재사용(LLM 불필요).
- [x] agents drift(013) = 문제 해결 절이 같은 managed block → 자동 커버(추가 동기화 0, template_version 4).

### 0.5 §0 결정 요약 (한 화면)

| 결정 | 잠금 값 |
|---|---|
| 정체성 | 결정 전 탐색·토의 문서, 진척 추적 안 함 |
| SSOT 경로 | `.oculpm/discussion/<slug>/discussion.md` + `attachments/` |
| 상태 어휘 | `open` · `resolved` · `archived` |
| 식별 | frontmatter `id`=폴더명 slug. 옵션·다음단계 `{#id}` |
| 작성 주체(v1) | `user`(앱) + 외부 `agent_id`(파일). AgentBreakdown 색 |
| AI | v1 미연동(다음 라운드), 포맷 forward-compat |
| 조사 자료 | repo/일지 참조 + `attachments/` 사이드카 + 인라인 링크 |
| 승격 | `discussion_promote_to_plan`: 다음단계→plan, `resolution_ref`, status=resolved |
| 마이그레이션 | **없음**(신규 기능 — 변환 대상 데이터 0) |
| 캐시 | migration `024_oculpm_discussion.sql`(023 까지 사용 중) |
| 동시성 | `.oculpm/.lock` + atomic_io(+ plan 류 write-lock 검토) |

위 잠금 → **PR-DISC 0** 진입 가능.

---

## 1. Phase A — Backend Foundation

### PR-DISC 0 — 스키마 + 파일트리 + 파서 + watcher + 읽기 커맨드

| 체크 | 항목 |
|---|---|
| ✅ | `migrations/024_oculpm_discussion.sql` — discussions/log/attachments 3테이블 ([`01`](./01-data-model-and-markdown-spec.md) §3) + db.rs MIGRATIONS 등록(24) |
| ✅ | `oculpm/paths.rs` — `discussion_root`/`discussion_dir`/`discussion_path`/`discussion_attachments_dir` + 테스트 |
| ✅ | `oculpm/discussion/parse.rs` — `discussion.md → {Frontmatter, problem, background, options[], log[], conclusion, next_steps[], resolution_ref}` (섹션/`{#id}`/managed-log 파싱, 관용 폴백+⚠, fuzz) |
| ✅ | `oculpm/discussion/project.rs` — `DiscussionCache` 투영(3테이블 재구축) + DTO + on-read reproject + 첨부 dir 스캔 + `_archive/` 로드 + redact. round-trip 테스트 |
| ✅ | tauri-specta: `discussion_list`/`discussion_get` (commands/discussion.rs) + lib.rs 등록 + bindings.ts 재생성 |
| ✅ | watcher — `.oculpm/discussion/**` 단락 처리(코드변경 ndjson 오염 방지). 재투영 on-read. 라이브-push 는 PR-DISC 3 이월 |
| ✅ | `cargo test` green — parse 10건 + 투영 2건(list/get·첨부·`_archive`). 전체 lib 302 pass + 프론트 typecheck 0/test 121/lint 0/build green |

### PR-DISC 1 — 마크다운 SSOT 쓰기 경로 + redact

| 체크 | 항목 |
|---|---|
| ✅ | `oculpm/discussion/doc_edit.rs` — 골격 생성 / 본문 write(frontmatter `updated` 재스탬프·status/resolution_ref 보존) / `set_status`·`set_title`(`set_fm_field`). write→parse 무손실 |
| ✅ | `discussion_create(project_id, title)` — slug 폴더(중복 -N) + 골격 + write_atomic |
| ✅ | `discussion_write(project_id, id, body_md)` — 본문 갱신, closed(≠open) 가드, atomic. **앱 유일 본문 쓰기** |
| ✅ | `discussion_set_status`/`discussion_rename`/`discussion_delete` (archived→`_archive/` 물리 이동·복귀, delete=폴더 단위) |
| ✅ | redact = **투영(읽기) 측 적용**(PR-DISC 0의 `problem`/`log.body` 마스킹). 쓰기는 원본 보존(비파괴, 플래너와 동일) |
| ✅ | 원자성=`atomic_io::write_atomic`. 동시쓰기 = 단일 사용자 last-write-wins(별도 락 없음, 플래너 PR-PLN 1 동일). doc_edit 7건 + lib 309 green + 프론트 게이트 green |

---

## 2. Phase B — 조사 자료

### PR-DISC 2 — 첨부 사이드카 + repo/일지 참조

| 체크 | 항목 |
|---|---|
| ⬜ | `discussion_attach(project_id, id, source_path)` — 외부 파일을 `attachments/` 로 복사 in, `secure_discussion_join` 가드(경로 탈출 거부), kind 판정(image/doc/note/other), rel_path 반환 |
| ⬜ | `discussion_attachment_list` + `discussion_asset`(base64 — docs_asset 패턴 재사용) |
| ⬜ | 첨부 메타 투영(`oculpm_discussion_attachments`) — watcher 가 폴더 스캔 반영 |
| ⬜ | repo 파일(`path:line`)·일지(`[[journal/...]]`) 참조 파싱 → UI 클릭 핸드오프용 메타(선택) |
| ⬜ | 테스트: 경로 탈출 거부 단위테스트, 첨부 round-trip + lib green |

---

## 3. Phase C — UI

### PR-DISC 3 — DiscussionScreenV2

| 체크 | 항목 |
|---|---|
| ⬜ | `WorkspaceContext` — `UiV2View` 에 `"discussion"`, `WorkspaceState.discussionActiveId` + initialState ([`03`](./03-ui-screen-spec.md) §1) |
| ⬜ | `ShellV2` 라우터 분기 + `Sidebar` nav("문제 해결", 플래너 앞, lucide 아이콘) |
| ⬜ | `DiscussionScreenV2.tsx` — 목록(`discussion_list`) + 2-pane 상세(`discussion_get`) + 섹션 렌더(마크다운 렌더 재사용) |
| ⬜ | 편집 모드 textarea+프리뷰 → `discussion_write`. 빈 문서 골격. 옵션 카드·토의로그·첨부 레일 |
| ⬜ | Attribution 칩 = `agentColor.ts` 재사용. 첨부 이미지 = `discussion_asset` 인라인 |
| ⬜ | watcher 라이브-push(현재 문서 재조회) — 또는 reproject-on-read + 새로고침 버튼(이월 가능) |
| ⬜ | `discussion_v2.test.tsx`(렌더/빈상태/**axe 0**) + typecheck/test/lint green |

---

## 4. Phase D — 승격 & 연결

### PR-DISC 4 — 플래너 승격 브리지 + Today 노출

| 체크 | 항목 |
|---|---|
| ⬜ | `discussion_promote_to_plan(project_id, id)` — `## 다음 단계` 항목 → `plan_create` + 항목별 `plan_apply_edit(add_item)`(`{#id}` 보존), `resolution_ref.plan_id` 기입, status=resolved. plan_id 반환. **LLM 불필요** |
| ⬜ | `PromoteToPlanDialog`(미리보기→확인) + 승격 후 플래너 화면 이동 + resolved 헤더에 "→ 📋 plan" 링크 |
| ⬜ | resolved/archived 편집 가드(읽기전용, 불변식 §2-2,3) |
| ⬜ | Today "결정 대기 N건"(open 카운트) + 클릭 진입 |
| ⬜ | 승격 round-trip 테스트(다음단계 3항목→plan 3항목, resolution_ref) + lib/프론트 green |

---

## 5. Phase E — Agent Protocol

### PR-DISC 5 — AGENTS.md "문제 해결" 규칙 + 템플릿 동기화

| 체크 | 항목 |
|---|---|
| ⬜ | `master_ko.md.tpl` §8 "문제 해결 문서" — 언제(요청 기반)·어떻게(문제정의 우선→옵션→토의로그 append→결론/다음단계)·금지(진척추적·복붙·resolved 수정) ([`02`](./02-agents-protocol.md) §1.2) |
| ⬜ | claude_code/gemini/cursor/antigravity/pi 템플릿 delta + agent_id 명시. 전부 master 상속 |
| ⬜ | AGENTS.md 재생성: master §8 가 같은 managed block → drift 파이프라인 자동 커버. **template_version 4**. 가드 테스트 `master_template_carries_discussion_rules` |
| ⬜ | dogfood: 외부 LLM 이 discussion.md 생성·토의로그 append 수기 시나리오(런타임 검증) |

---

## 6. 운영 — 진행 중 새 결정의 흐름
1. PR 안에서 본 §0 에 *새 항목 추가*.
2. 영향 문서(§00~§03) *동일 PR* 동기화.
3. §0.5 결정 요약 + §7 상태표 갱신.

이 3단이 한 PR 내에 끝나지 않으면 결정은 *잠금 안 됨*.

---

## 7. 비상 — 회귀 시

| 단계 | 처리 |
|---|---|
| PR-DISC 0~2(백엔드) 회귀 | `oculpm_discussion*` 캐시는 재구축 가능, `.md` SSOT 무손실. 신규 기능이라 기존 사용자 영향 0 |
| PR-DISC 3(UI) 회귀 | ui_v2 discussion 화면만 영향, 나머지 9화면 0 diff |
| PR-DISC 4(승격) 회귀 | 승격은 *생성형*(plan_create) — discussion 비파괴. resolution_ref 미기입 시 수동 재시도 |
| PR-DISC 5(AGENTS) 회귀 | template_version 롤백 → drift 재싱크. discussion.md 포맷 불변 |

---

## 8. 진행 상태 (2026-06-29 작성 시점 — 설계 잠금, 구현 미착수)

| PR-DISC | 상태 | 머지 해시 |
|---|---|---|
| 0 — 스키마/파서/watcher/읽기 | ✅ done (lib 302 green · 미커밋) | — |
| 1 — .md 쓰기 + redact | ✅ done (lib 309 green · 미커밋) | — |
| 2 — 첨부 + read_raw | ✅ done (lib 311 green · 미커밋) | — |
| 3 — DiscussionScreenV2 + 배선 | ✅ done (프론트 124 green · 미커밋) | — |
| 4 — 승격 + Today | ✅ done (lib 312 green · 미커밋) | — |
| 5 — AGENTS.md + template_version 4 | ✅ done (lib 312 green · 미커밋) | — |

**라운드 종료 (2026-06-29).** 전 PR 구현·검증 완료. 각 PR 머지(커밋) 시 해시 갱신. (참고: `rev-parse` 로 확인, 추측 금지 — [[commit-gate-discipline]].)

> 구현 메모(설계와의 차이): 첨부 자료 참조는 **read-side redact + 편집 전용 `discussion_read_raw`(원본)** 로 분리(저장 무손실). 별도 `discussion_attachment_list` 는 `discussion_get.attachments` 로 대체(중복 제거). repo/일지 참조 클릭 핸드오프는 마크다운 링크로 동작(전용 파싱 없음). 첨부 파일 선택은 백엔드 `discussion_attach_via_dialog`(네이티브 피커).
