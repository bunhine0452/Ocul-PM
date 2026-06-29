# 01. 데이터 모델 + 마크다운 SSOT 포맷

> 위상: [`00-master-plan.md`](./00-master-plan.md) §3 의 데이터 흐름을 구체화. 마크다운 = 진실, SQLite = 투영.
> 선행 인프라(재사용): `src-tauri/src/oculpm/{frontmatter,atomic_io,paths,index,watcher,redact,lock}.rs` (일지·플래너에서 검증됨).
> 직접 선례: [`../planner-upgrade/01-data-model-and-markdown-spec.md`](../planner-upgrade/01-data-model-and-markdown-spec.md) (동형 구조).

---

## 1. 파일 트리

```
.oculpm/
  journal/        ← (기존) 일지, 회고적, append-only
  planner/        ← (기존) Plan SSOT
  discussion/     ← (신규) 문제 해결 SSOT — 폴더-per-discussion
    onnx-cache-strategy/
      discussion.md          ← 문서 SSOT
      attachments/           ← 조사 자료 사이드카
        bench-screenshot.png
        vendor-notes.md
    multi-active-plan-reconcile/
      discussion.md
    _archive/                ← status: archived 이동 대상
      2026-q1-old-topic/
        discussion.md
  index/
    ...           ← (앱 관리, 절대 직접 쓰지 말 것)
```

`paths.rs` 에 추가(`WorkdayResolver` 메서드, 일지 `journal_root`/플래너 `planner_root` 패턴과 동형):
- `discussion_root(root) = root/.oculpm/discussion`
- `discussion_dir(root, slug) = …/discussion/<slug>`
- `discussion_path(root, slug) = …/discussion/<slug>/discussion.md`
- `discussion_attachments_dir(root, slug) = …/discussion/<slug>/attachments`

> **왜 폴더-per-discussion 인가** (플래너의 flat `<slug>.md` 와 다른 점): 문제 해결은 조사 자료 첨부가 1급 요구사항이라, 문서와 자료를 한 폴더로 묶으면 (a) 본문에서 `attachments/x.png` 짧은 상대경로로 참조하고, (b) 첨부의 소유 관계가 명확하며, (c) 보관/삭제가 폴더 단위로 원자적이다.

---

## 2. 마크다운 SSOT 포맷 (`discussion.md`)

### 2.1 Frontmatter

```yaml
---
oculpm_discussion: v1
id: onnx-cache-strategy          # 폴더명과 동일한 안정 slug (rename 내성은 id 가 보유)
title: "onnx 모델 캐시 전략 결정"
status: open                     # open | resolved | archived
created: 2026-06-29
updated: 2026-06-29T14:03:00+09:00
owner: user                      # 최초 작성 주체(agent_id). 사람=user
tags: ["fastembed", "packaging"] # 선택
resolution_ref:                  # 선택 — resolved 시에만 채워짐
  plan_id: fastembed-stabilize   # 승격된 plan slug
  decided_at: 2026-06-29T15:10:00+09:00
---
```

### 2.2 본문 — 섹션 (권장 순서, 관용 파서)

```markdown
## 문제 정의

패키징된 .app 의 CWD 가 `/` 라서 fastembed 의 상대 캐시 경로가 깨진다.
재다운로드(465MB)가 매 실행 발생할 수 있다. 어디에·어떻게 캐시를 고정할지 결정 필요.

## 배경 / 조사 자료

- 코드: `src-tauri/src/embedding.rs:42` (현재 캐시 경로 지정부)
- 일지: [[journal/20260607/Bugs/0902_bug_onnx-cache.md]]
- 첨부: ![벤치](attachments/bench-screenshot.png) · [벤더 노트](attachments/vendor-notes.md)
- 외부: https://github.com/.../fastembed#cache

## 후보 해결 방안

### 방안 A — app_data_dir 절대경로 고정 {#opt-app-data}
- 장점: CWD 무관, 영속적. 패키징/dev 동일 동작
- 단점: 첫 실행 시 다운로드는 여전. 사용자별 경로
- 비용/리스크: 낮음 (한 줄 변경)

### 방안 B — 모델을 앱 번들에 동봉 {#opt-bundle}
- 장점: 오프라인 즉시 동작
- 단점: 앱 용량 +465MB, 빌드 파이프라인 변경
- 비용/리스크: 중간

## 토의 / 메모

<!-- oculpm:discussion-log begin v1 -->
| 시각(ISO) | 작성자 | 내용 |
|---|---|---|
| 2026-06-29T14:03:00+09:00 | user | A 로 가되 다운로드 진행 UI 는 후속으로 분리 |
| 2026-06-29T14:20:00+09:00 | claude-code | B 는 배포 라운드에서 재검토 권장 |
<!-- oculpm:discussion-log end -->

## 결론

방안 A 채택 (app_data_dir 절대경로). B 는 배포 라운드 이월.
다운로드 진행 UI 는 별도 작업으로 분리.

## 다음 단계

- [ ] embedding.rs 캐시 경로를 app_data_dir 절대경로로 {#next-abs-cache}
- [ ] 첫 실행 다운로드 진행 UI {#next-dl-ux}
```

**섹션 규칙** (파서가 `## ` 헤딩으로 블록 분리, 한국어/영어 표제 모두 인식):

| 섹션 | 투영 | 필수 | 비고 |
|---|---|---|---|
| `## 문제 정의` | `problem` (텍스트) | ✅ | 비면 UI 빈 상태 프롬프트. 정의 우선(불변식) |
| `## 배경 / 조사 자료` | (본문 보존) | — | repo 참조·첨부 링크·외부 URL |
| `## 후보 해결 방안` | `option_count` (`### … {#id}` 개수) | — | 각 옵션은 `### 제목 {#id}` |
| `## 토의 / 메모` | `oculpm_discussion_log` (managed block) | — | append-only. `작성자` 필드(forward-compat) |
| `## 결론` | (본문 보존) | resolved 시 | 채택안 + 근거 |
| `## 다음 단계` | `next_step_count` (`- [ ] … {#id}`) | — | 승격 시 plan 항목이 됨 |

규칙:
- **`{#id}`** = 옵션·다음단계 안정 식별자. 다음단계 항목은 승격 시 plan item id 로 재사용(추적 보존). 누락 시 파서가 title 해시로 생성 + ⚠.
- `## 토의 / 메모` 의 `작성자` = `agent_id`(일지와 동일 체계). 사람=`user`, 외부 에이전트=`claude-code` 등. (다음 라운드 in-app AI = `inapp:<provider>`.)
- 첨부 참조는 `attachments/<파일>` 상대경로. repo 파일은 `path:line`, 일지는 `[[journal/...]]`.
- managed block 밖 사용자 콘텐츠는 보존(일지/플래너 정책과 동일).

### 2.3 토의 로그 — managed block

`atomic_io::write_managed_block` 으로 앱·외부 에이전트가 안전하게 *append* 하는 영역. 파서가 여기서 `oculpm_discussion_log` 를 투영.

- **append-only.** 기존 행 수정 금지. 토의의 *흐름*(타임라인)을 보존.
- `작성자` 3열 포맷: `| 시각 | 작성자 | 내용 |`. 시각은 ISO-8601 + tz offset 필수(`created_at` 과 동일 규칙).
- v1 작성자 = `user` / 외부 `agent_id`. **forward-compat**: 다음 라운드에서 in-app AI 가 같은 표에 `inapp:<provider>` 로 합류 — 포맷 변경 0.

---

## 3. SQLite 투영 스키마 (캐시)

> 신규 migration `024_oculpm_discussion.sql` (023 까지 사용 중 — 확인 후 다음 번호). `oculpm_plans`(016) 패턴 그대로: 파일이 진실, watcher 가 재투영, 언제든 재구축 가능. PK 는 `(project_id, …)` 복합.

```sql
CREATE TABLE IF NOT EXISTS oculpm_discussions (
    project_id          INTEGER NOT NULL,
    discussion_id       TEXT    NOT NULL,        -- frontmatter id (= 폴더명 slug)
    title               TEXT    NOT NULL,
    status              TEXT    NOT NULL,         -- open | resolved | archived
    owner               TEXT    NOT NULL,         -- 최초 작성 agent_id
    problem             TEXT,                     -- "## 문제 정의" 본문(검색/미리보기, redacted)
    tags                TEXT,                     -- CSV (선택)
    option_count        INTEGER NOT NULL DEFAULT 0,
    next_step_count     INTEGER NOT NULL DEFAULT 0,
    resolution_plan_id  TEXT,                     -- resolution_ref.plan_id (nullable)
    file_path           TEXT    NOT NULL,         -- .oculpm/discussion/<slug>/discussion.md
    created_at          TEXT    NOT NULL,
    updated_at          TEXT    NOT NULL,
    PRIMARY KEY (project_id, discussion_id)
);

CREATE TABLE IF NOT EXISTS oculpm_discussion_attachments (
    project_id     INTEGER NOT NULL,
    discussion_id  TEXT    NOT NULL,
    rel_path       TEXT    NOT NULL,              -- attachments/<파일>
    kind           TEXT    NOT NULL,              -- image | doc | note | other
    bytes          INTEGER,
    added_at       TEXT    NOT NULL,
    PRIMARY KEY (project_id, discussion_id, rel_path)
);

CREATE TABLE IF NOT EXISTS oculpm_discussion_log (    -- append-only 토의 이력
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id     INTEGER NOT NULL,
    discussion_id  TEXT    NOT NULL,
    ts             TEXT    NOT NULL,
    author         TEXT    NOT NULL,              -- user | <agent_id> | (후속) inapp:*
    body           TEXT    NOT NULL               -- redacted
);
CREATE INDEX IF NOT EXISTS idx_oculpm_discussion_log
    ON oculpm_discussion_log(project_id, discussion_id, ts);
```

> **저장하지 않는 것**: 옵션 본문·결론·다음단계 텍스트는 SQLite 에 풀로 안 넣는다(검색용 `problem` + 카운트만 투영). 상세는 `discussion_get` 이 디스크에서 직접 파싱 — 진척/집계가 아닌 *문서 열람* 이라 캐시 정규화 불필요(투영 단순화).

### 3.1 투영(파싱) 책임
- `oculpm/discussion/parse.rs` (신규): `discussion.md → {Frontmatter, problem, options[], log[], conclusion, next_steps[], resolution_ref}`.
- `oculpm/discussion/project.rs` (신규): `DiscussionCache` 투영(3테이블 재구축) + DTO + on-read reproject.
- watcher 가 `.oculpm/discussion/**` 변경 감지 → 해당 discussion 재파싱 → upsert(discussions/attachments replace, log append-dedup by (ts,author,body)).
- 파싱 관용성: 섹션 누락→빈 값, id 누락→해시+⚠, 깨진 표→스킵+⚠. **침묵 실패 금지**(UI 노출).
- redact.rs: `problem`/`log.body` 투영 시 시크릿 마스킹(일지/플래너와 동일).

---

## 4. tauri-specta 커맨드 (신규)

| 커맨드 | 용도 |
|---|---|
| `discussion_list(project_id)` | discussion 요약 목록(상태·문제 미리보기·옵션/다음단계 카운트·승격 plan) |
| `discussion_get(project_id, discussion_id)` | 전체 상세(문제·옵션·토의로그·결론·다음단계·첨부·resolution_ref) — 디스크 파싱 |
| `discussion_create(project_id, title)` | slug 생성(중복 -N) + 폴더 + 골격 `discussion.md` + write_atomic |
| `discussion_write(project_id, discussion_id, body_md)` | 본문(섹션) 갱신 → frontmatter `updated` 재스탬프 + redact + write_atomic. **앱 유일 본문 쓰기 경로** |
| `discussion_set_status(project_id, discussion_id, status)` | open/resolved/archived 전환. archived → `_archive/` 이동 |
| `discussion_rename(project_id, discussion_id, title)` | frontmatter title 변경(폴더/ id 불변) |
| `discussion_delete(project_id, discussion_id)` | 폴더 단위 삭제(첨부 포함) |
| `discussion_attach(project_id, discussion_id, source_path)` | 외부 파일을 `attachments/` 로 복사 in → rel_path 반환(`secure_*_join` 가드) |
| `discussion_attachment_list(project_id, discussion_id)` | 첨부 목록 |
| `discussion_asset(project_id, discussion_id, rel_path)` | 첨부를 base64 로 읽기(이미지 렌더 — docs_asset 패턴) |
| `discussion_promote_to_plan(project_id, discussion_id)` | `## 다음 단계` → 새 plan(`plan_create` + 항목별 `plan_apply_edit add_item`), `resolution_ref.plan_id` 기입, status=resolved. plan_id 반환 |

> 쓰기 경로: 앱 = 위 커맨드(atomic). 외부 에이전트 = 파일 직접 편집(AGENTS.md, [`02`](./02-agents-protocol.md)). 둘 다 watcher 흡수. `discussion_promote_to_plan` 은 플래너의 `plan_create`/`plan_apply_edit`([`../planner-upgrade/01-…`](../planner-upgrade/01-data-model-and-markdown-spec.md) §5)를 *재사용* — LLM 불필요.

### 4.1 lib.rs 등록
`use crate::commands::{ … discussion_list, discussion_get, discussion_create, discussion_write, discussion_set_status, discussion_rename, discussion_delete, discussion_attach, discussion_attachment_list, discussion_asset, discussion_promote_to_plan };` + `collect_commands![ … ]` 동일 추가 → `cargo test` 로 `bindings.ts` 재생성.
