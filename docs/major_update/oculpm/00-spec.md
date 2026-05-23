# `.oculpm/` 명세서 (Single Source of Truth)

> 버전: **schema_version = 1** · 작성일 2026-05-22
> 다른 모든 구현 문서는 이 파일을 인용해야 한다. 스펙이 바뀌면 여기를 먼저 고친다.

---

## 1. 디렉토리 구조 (정식)

```
<프로젝트 루트>/
├── .oculpm/
│   ├── config.toml                 # 사용자 + 앱 공동 관리. 단일 파일.
│   ├── .lock                       # 다중 인스턴스 방지용 PID 락. JSON.
│   ├── .schema-version             # 단일 정수. 마이그레이션 게이트.
│   │
│   ├── index/                      # 앱 전용 (LLM 이 건드리면 안 됨). .gitignore 됨.
│   │   ├── projects.json           # 프로젝트 단위 메타 (root_path, created_at, last_opened_at)
│   │   └── 20260522/               # YYYYMMDD (workday tz 기준)
│   │       ├── sessions.json       # 그날의 모든 세션 (배열)
│   │       ├── file_changes.ndjson # append-only 이벤트 로그
│   │       ├── snapshot_open.json  # 워크데이 시작 시점의 git/tree 스냅샷
│   │       └── snapshot_close.json # 워크데이 종료 시점 (없을 수 있음 = 진행 중)
│   │
│   ├── journal/                    # 외부 LLM 작성 영역. .git 에 커밋됨.
│   │   └── 20260522/
│   │       ├── Bugs/
│   │       │   └── 2055_bug_changelog-export-param-mismatch.md
│   │       ├── Features_to_add/
│   │       │   └── 2101_feature_chat-quickedit-merge.md
│   │       ├── Errors/
│   │       │   └── 1330_error_specta-bigint-export.md
│   │       ├── Refactors/
│   │       │   └── 0935_refactor_workspace-context-split.md
│   │       ├── Chores/
│   │       │   └── 1015_chore_update-roadmap.md
│   │       └── _attachments/       # 스크린샷/로그. 같은 날의 .md 들이 상대 경로로 참조.
│   │
│   └── agents/                     # 에이전트 규칙의 원본(SSOT). 사용자 편집 가능.
│       ├── _template.md            # 마스터 프롬프트. 어댑터들이 이걸 참조.
│       └── per-agent/              # (선택) 에이전트별 오버라이드. 비어 있으면 _template.md 사용.
│           ├── claude-code.md
│           ├── cursor.md
│           ├── antigravity.md
│           └── gemini-cli.md
│
├── .gitignore                      # 앱이 ".oculpm/index/" 와 ".oculpm/.lock" 추가 (멱등 관리 블록)
│
├── .cursor/rules/ocul-pm.mdc       # 어댑터 — 앱이 자동 생성/갱신. 사용자 편집 가능하나 관리 블록은 보존됨.
├── .claude/CLAUDE.md               # 어댑터 — 관리 블록 형태로 append. 기존 사용자 콘텐츠 보존.
├── .agent/rules/ocul-pm.md         # 어댑터 — Antigravity 용. 디렉토리 없으면 생성.
└── GEMINI.md                       # 어댑터 — Gemini CLI 용. 관리 블록.
```

### 1.1 권한/소유 매트릭스

| 경로 | **앱(쓰기)** | **LLM(쓰기)** | **사용자(편집)** | git |
|---|---|---|---|---|
| `.oculpm/config.toml` | ✅ (마이그레이션/기본값 채움) | ❌ | ✅ | commit |
| `.oculpm/.lock`, `.schema-version` | ✅ | ❌ | ❌ | ignore |
| `.oculpm/index/**` | ✅ | ❌ (절대 금지) | 읽기만 | ignore |
| `.oculpm/journal/**` | ❌ (앱이 마이그레이션 시점 1회만 작성) | ✅ | ✅ (사후 보정) | commit |
| `.oculpm/agents/_template.md` | 초기 1회 생성 | ❌ | ✅ (튜닝) | commit |
| `.oculpm/agents/per-agent/**` | 초기 1회 생성 | ❌ | ✅ | commit |
| `.cursor/rules/ocul-pm.mdc` 등 어댑터 | ✅ (관리 블록만) | (자기들이 읽는 영역) | ✅ (블록 밖) | commit (사용자 정책에 맡김) |

### 1.2 멱등 관리 블록 (Managed Block)

어댑터 파일과 `.gitignore` 같이 **기존 사용자 콘텐츠가 있을 수 있는 파일**에는 다음 마커 사이의 영역만 앱이 덮어쓴다:

```
<!-- oculpm:begin v1 -->
... auto-generated ...
<!-- oculpm:end -->
```

- 양 마커 모두 없으면 → 파일 끝에 새로 append.
- 한쪽만 있으면 → 에러, 사용자에게 수동 수정 요청 (덮어쓰지 않음).
- `.gitignore` 도 동일 패턴, 단 주석은 `#` 로 변경:
  ```
  # oculpm:begin v1
  .oculpm/index/
  .oculpm/.lock
  .oculpm/.schema-version
  # oculpm:end
  ```

---

## 2. 파일명 컨벤션

### 2.1 Journal 엔트리

```
<HHMM>_<type>_<slug>.md
```

| 토큰 | 규칙 |
|---|---|
| `HHMM` | 24h, workday timezone 기준. 0000–2359. zero-padded. |
| `<type>` | `bug` \| `feature` \| `error` \| `refactor` \| `chore` (정확히 이 5개). |
| `<slug>` | kebab-case. ASCII `[a-z0-9-]` 만 허용. 최대 60자. 한글/공백은 슬러그화 변환 (e.g. `chat-quickedit 통합` → `chat-quickedit-merge`). |

**충돌 회피**: 동일 파일명이 이미 존재하면 suffix `__2`, `__3`… 추가. (LLM 이 같은 분 같은 슬러그를 두 번 쓰면 자동 분리)

**카테고리 폴더 매핑**:
- `bug` → `Bugs/`
- `feature` → `Features_to_add/`
- `error` → `Errors/`
- `refactor` → `Refactors/`
- `chore` → `Chores/`

### 2.2 날짜 폴더

```
YYYYMMDD
```

- `workday timezone` 기준의 "오늘".
- `day_starts_at` 설정이 `00:00` 외 값이면 (예: `03:00`), 자정~03:00 사이의 작업은 **전날 폴더**에 들어간다.

### 2.3 첨부

```
journal/20260522/_attachments/<slug>__<index>.<ext>
```

마크다운 안에서는 같은 디렉토리 기준 상대경로로 참조:
```markdown
![에러 스크린샷](./_attachments/specta-bigint__1.png)
```

---

## 3. Frontmatter 스키마

### 3.1 공통 (모든 type 공유)

```yaml
schema_version: 1
type: bug                           # bug | feature | error | refactor | chore
slug: changelog-export-param-mismatch
status: done                        # planned | in_progress | done | abandoned
difficulty: medium                  # superhigh | high | medium | low | verylow  (Q11)
created_at: "2026-05-22T20:55:00+09:00"   # ISO 8601 with tz
updated_at: "2026-05-22T21:08:14+09:00"
session_id: "20260522-001"          # references index/<date>/sessions.json
agent:
  id: claude-code                   # claude-code | cursor | antigravity | gemini-cli | manual
  version: "opus-4.7"               # 선택. 식별 가능하면 채움
language: ko                        # ko | en (LLM 이 본문에 쓴 언어)
verified_by_user: false             # 앱 UI 에서 사용자가 수동 체크
files_touched:
  - path: "src-tauri/src/db.rs"
    op: update                      # create | update | delete | rename
    bytes_added: 42                 # 선택 (없으면 index/ 의 ground truth 로 채움)
    bytes_removed: 18
    rename_from: null               # op=rename 일 때만
related:
  - ref: "20260522/Bugs/2050_bug_diff-modal-empty.md"
    kind: followup                  # blocks | blocked_by | followup | duplicate
tags: ["changelog", "sqlite", "export"]   # 자유 태그. 검색용.
```

**필수 필드**: `schema_version`, `type`, `slug`, `status`, `created_at`, `session_id`, `agent.id`, `language`.
**나머지**: 선택. 비어 있으면 앱이 합리적 기본값으로 채워 표시.

### 3.2 Type-specific 확장 (frontmatter 가 아닌 본문 섹션으로 강제)

LLM 프롬프트(`agents/_template.md`)가 다음 헤더를 작성하도록 지시한다.

| Type | 강제 섹션 | 권장 섹션 |
|---|---|---|
| **bug** | `## 발생 원인`, `## 해결 방법` | `## 재현`, `## 검증` |
| **feature** | `## 추가 방법`, `## 인수 조건` | `## 디자인 노트`, `## 검증` |
| **error** | `## 증상`, `## 원인`, `## 해결` | `## 향후 방지책` |
| **refactor** | `## 동기`, `## 변경 요약` | `## 영향 범위`, `## 검증` |
| **chore** | `## 내용` | — |

**체크박스**: 본문 첫 줄은 항상 `[ ]` 또는 `[x]` 로 시작하는 한 줄 제목.
```markdown
[x] Changelog Export 시 파라미터 개수 불일치
```
파서가 첫 라인에서 체크박스/제목 추출.

### 3.3 검증 규칙

앱이 `journal/**/*.md` 를 인덱싱할 때:

1. **frontmatter 누락** → 파일은 표시하되 노란 경고 배지.
2. **schema_version 불일치** → 자동 마이그레이션 시도 (`migrate.rs`), 실패 시 빨간 배지 + 마이그레이션 다이얼로그.
3. **type 미정** → `chore` 로 분류.
4. **session_id 가 sessions.json 에 없음** → "고아 엔트리" 로 표시, 가장 가까운 세션에 attach 제안.
5. **files_touched 가 index/ 의 변경 파일 집합과 불일치** → "narrative mismatch" 배지 (review §3.1 의 이중 레이어 검증).

---

## 4. `index/` 스키마 (앱 ground truth)

### 4.1 `projects.json`

```json
{
  "schema_version": 1,
  "project_id": "ab12cd34",
  "root_path": "/Users/kim/Desktop/git/ai-pm",
  "created_at": "2026-05-22T09:00:00+09:00",
  "last_opened_at": "2026-05-22T20:55:12+09:00",
  "workday_timezone": "Asia/Seoul"
}
```

### 4.2 `sessions.json`

```json
{
  "schema_version": 1,
  "sessions": [
    {
      "id": "20260522-001",
      "started_at": "2026-05-22T09:13:22+09:00",
      "ended_at": "2026-05-22T11:47:08+09:00",
      "ended_reason": "inactivity_timeout",   // inactivity_timeout | app_quit | workday_boundary | manual | crash_recovered
      "active_window_ms": 8120300,
      "file_event_count": 47,
      "files_unique": 12,
      "git_head_at_start": "93e3060...",
      "git_head_at_end": "94c2fe7...",
      "agent_label_guess": "claude-code",     // 어떤 어댑터의 mtime 이 가장 최근인지로 추정
      "linked_journal_entries": [
        "Bugs/2055_bug_changelog-export-param-mismatch.md",
        "Features_to_add/2101_feature_chat-quickedit-merge.md"
      ]
    }
  ]
}
```

세션 ID 포맷: `YYYYMMDD-NNN` (그날 몇 번째 세션인지, 1부터).

### 4.3 `file_changes.ndjson` (append-only)

각 라인 = 한 이벤트. JSON Lines.

```json
{"ts":"2026-05-22T20:55:01.412+09:00","session_id":"20260522-001","op":"update","path":"src-tauri/src/db.rs","hash_before":"a1b2...","hash_after":"c3d4...","bytes":12480}
{"ts":"2026-05-22T20:55:02.118+09:00","session_id":"20260522-001","op":"create","path":"src/components/ModelSelector.tsx","hash_before":null,"hash_after":"e5f6...","bytes":3210}
{"ts":"2026-05-22T20:55:09.003+09:00","session_id":"20260522-001","op":"delete","path":"src/legacy/Foo.tsx","hash_before":"a9b8...","hash_after":null,"bytes":0}
```

**불변식**:
- 이 파일은 append-only. 수정/삭제 금지. 잘못된 이벤트는 다음 줄에 `op: "correct"` 로 보정.
- **한 라인 ≤ 4096 바이트 (trailing `\n` 제외)** — POSIX `write()` 의 PIPE_BUF 단위 atomicity 보장에 기댄다. 초과 시 `path` 를 `…<short_blake3>` 로 단축 + `tags: ["path-truncated"]` 추가. 단축 후에도 초과면 reject + `oculpm:integrity_warning` emit. 코드 상수는 `oculpm::atomic_io::NDJSON_LINE_CAP`.
- 손상 라인 감지 시 `<filename>.corrupted-tail-<ts>` 로 백업 후 손상 지점부터 truncate (§9 의 손상 처리 표 참조).

### 4.4 `snapshot_open.json` / `snapshot_close.json`

```json
{
  "schema_version": 1,
  "captured_at": "2026-05-22T09:00:00+09:00",
  "git": {
    "head_sha": "93e3060abc123...",
    "branch": "main",
    "dirty_files": ["docs/Master_bugfix_and_feature_prompt.md"],
    "untracked_files": ["docs/111.md"]
  },
  "tree_summary": {
    "total_tracked_files": 412,
    "merkle_root": "blake3:7a8b..."
  }
}
```

`tree_summary.merkle_root` 는 단순 비교용 — 두 스냅샷의 merkle 이 같으면 워크데이 동안 트래킹 대상 파일 셋이 안 바뀐 것.

---

## 5. `config.toml`

```toml
schema_version = 1

[workday]
timezone = "Asia/Seoul"        # IANA tz 이름
day_starts_at = "00:00"        # HH:MM. 야간 코더는 "03:00" 같이 설정 가능.

[session]
inactivity_timeout_minutes = 30
auto_close_on_workday_boundary = true
auto_close_on_app_quit = true
crash_recovery_grace_minutes = 5   # 직전 lock 이 5분 이상 stale 이면 강제 회수 + crash_recovered

[git]
journal_committed = true       # journal/ commit, index/ ignore
# 절대 commit 금지 패턴 (auto_redact 와 별개) — 아예 journal/ 작성도 막음
forbid_journal_for_paths = [".env*", "*secret*", "*credential*"]
auto_redact_patterns = [
  "AKIA[0-9A-Z]{16}",            # AWS Access Key
  "sk-[A-Za-z0-9_-]{20,}",       # OpenAI/Anthropic 유사
  "ghp_[A-Za-z0-9]{36}",         # GitHub PAT
  "xox[baprs]-[A-Za-z0-9-]+",    # Slack
]

[watcher]
ignore = [
  ".oculpm/index/",              # 자기 자신 무한루프 방지
  ".oculpm/.lock",
  ".git/",
  "node_modules/",
  "target/",
  "dist/",
  ".next/",
  "build/",
  "*.log",
  ".DS_Store",
]
respect_gitignore = true         # 추가로 .gitignore 도 존중
debounce_ms = 500
batch_max_events = 200

[agents]
active = ["claude-code", "cursor"]   # 사용자가 다중 선택
auto_detect_on_open = true           # 어댑터 마커 파일 스캔
auto_sync_adapters = true            # _template.md 변경 시 어댑터 자동 갱신
```

**검증**:
- `timezone` 이 IANA tz 가 아니면 시작 실패 + 사용자에게 노출.
- `day_starts_at` HH:MM 정규식 검증.
- 알 수 없는 키는 경고만 (forward-compat).

---

## 6. Lock 파일 프로토콜

`.oculpm/.lock` (JSON):
```json
{
  "schema_version": 1,
  "pid": 78431,
  "hostname": "kim-macbook.local",
  "started_at": "2026-05-22T20:55:00+09:00",
  "heartbeat_at": "2026-05-22T20:57:30+09:00"
}
```

**규칙**:
1. 앱 시작 시 락 파일 읽음.
2. 없으면 → 생성, 정상 모드.
3. 있으면 → `heartbeat_at` 검사:
   - 현재 시간 - heartbeat ≤ `crash_recovery_grace_minutes` → **이미 다른 인스턴스 가동 중**. 신규 인스턴스는 **read-only 모드** (워처 disable, 저장 disable, UI 만 동작).
   - 초과 → 좀비. 회수 + `sessions.json` 의 마지막 열린 세션을 `ended_reason: "crash_recovered"` 로 닫고 새 락 작성.
4. 정상 종료 시 락 파일 삭제.
5. heartbeat: 정상 모드에서 30초마다 `heartbeat_at` 갱신 (락 파일을 in-place 가 아닌 **atomic rename**으로 갱신).

**atomic rename**: 모든 `.oculpm/` 쓰기는 `path.tmp` 에 쓰고 fsync, 그다음 `rename(path.tmp, path)`. POSIX 보장. Windows 도 `MoveFileEx(MOVEFILE_REPLACE_EXISTING)`.

---

## 7. Workday Boundary

**"오늘이 언제 끝나고 내일이 시작되는가" 의 단일 정의**:

```
workday_boundary(t) = ceil_to_next( workday_timezone.local(t), day_starts_at )
```

예) `timezone = "Asia/Seoul"`, `day_starts_at = "03:00"`:
- 2026-05-22 14:00 KST 의 workday = `20260522`
- 2026-05-23 02:30 KST 의 workday = **`20260522`** (3시 안 됐으니 전날)
- 2026-05-23 03:00 KST 의 workday = `20260523`

**불변식**: `file_changes.ndjson` 의 한 파일은 같은 `workday` 의 이벤트만 담는다. 워크데이 경계가 넘어가면:
1. 진행 중 세션이 있으면 `ended_reason: "workday_boundary"` 로 닫는다.
2. `snapshot_close.json` 작성.
3. 새 워크데이 폴더 생성.
4. `snapshot_open.json` 작성.
5. 새 세션 시작 (사용자가 계속 작업 중이면).

이 5단계는 트랜잭션처럼 묶인다 — 도중 실패 시 다음 앱 시작 때 crash recovery.

---

## 8. 에이전트 어댑터 형식

### 8.1 마스터 템플릿 (`.oculpm/agents/_template.md`)

앱 초기화 시 생성. 사용자 편집 가능. 내용은 LLM 에게 직접 전달되는 프롬프트.

```markdown
# ocul-pm 작업 기록 규칙 (v1)

당신은 ocul-pm 으로 추적되는 프로젝트에서 작업하고 있습니다. **하나의 논리적 작업 단위
(버그 수정, 기능 추가, 리팩토링, 에러 해결, 잡일)를 끝낼 때마다**, 그 작업에 관한 markdown
파일을 다음 위치에 작성하세요:

`.oculpm/journal/{TODAY}/{Bugs|Features_to_add|Errors|Refactors|Chores}/{HHMM}_{type}_{slug}.md`

- `TODAY` = workday 기준 YYYYMMDD (사용자에게 물어 확인하지 말고 OS 시각을 사용).
- `HHMM` = 24h.
- `type` ∈ {bug, feature, error, refactor, chore}.
- `slug` = ASCII kebab-case, 60자 이내, 작업 내용을 1줄로 압축.

## Frontmatter (반드시 포함)

(... 공통 frontmatter 스키마 — §3.1 참조 ...)

## 본문 구조

타입별 강제 섹션은 §3.2 표를 따른다.

## 금지 사항

- `.oculpm/index/**` 에 절대 쓰지 말 것 (앱이 자동 관리).
- secrets, API key, .env 파일 내용을 절대 본문/diff에 포함하지 말 것.
- 이미 존재하는 다른 journal 파일을 수정하지 말 것 (새 파일을 만들고 frontmatter `related`로 링크).
```

### 8.2 어댑터 매핑

| 에이전트 | 어댑터 경로 | 작성 방식 |
|---|---|---|
| **claude-code** | `.claude/CLAUDE.md` | **관리 블록 append** (기존 콘텐츠 보존) |
| **cursor** | `.cursor/rules/ocul-pm.mdc` | **전체 덮어쓰기** (단일 목적 파일) |
| **antigravity** | `.agent/rules/ocul-pm.md` | 전체 덮어쓰기 |
| **gemini-cli** | `GEMINI.md` | 관리 블록 append |

Cursor `.mdc` 메타 헤더는 다음을 강제:
```
---
description: ocul-pm 작업 기록 규칙
globs: ["**/*"]
alwaysApply: true
---
```

### 8.3 어댑터 갱신 트리거

- 사용자가 `.oculpm/agents/_template.md` 또는 `per-agent/*.md` 를 저장 → 워처가 감지 → 활성 에이전트의 어댑터 재생성.
- `config.toml` 의 `[agents].active` 가 변경 → 동일.
- 신규 활성화 → 어댑터 파일 생성.
- 비활성화 → 어댑터의 관리 블록만 제거 (블록 밖 사용자 콘텐츠는 보존).

---

## 9. 데이터 무결성 / 검증

매 앱 시작 시 (`integrity-check`):

| 검사 | 조치 |
|---|---|
| `schema-version` 미스매치 | 마이그레이션 다이얼로그 |
| `index/<today>/` 폴더 없음 | lazy 생성 안 함. 첫 이벤트에서 생성. |
| `journal/<date>/` 중 frontmatter 깨진 파일 | Today UI 에서 경고 배지로 표시 |
| 좀비 lock | §6 규칙으로 회수 |
| `file_changes.ndjson` 의 마지막 줄 손상 | 손상된 줄만 cut, `.corrupted-tail` 백업 |
| 같은 슬러그/HHMM 충돌 | rename → suffix |
| `forbid_journal_for_paths` 패턴 매치 | journal 작성 거부 + 사용자 토스트 |
| `auto_redact_patterns` 매치 | 매치된 부분을 `[REDACTED]` 로 치환 후 저장 (원본 보존 X) |

---

## 10. 마이그레이션 (schema_version 1 → N)

`.oculpm/.schema-version` 단일 파일.

```
1
```

업그레이드 시:
1. 백업: `.oculpm/` 전체를 `.oculpm.backup-<timestamp>/` 로 복사.
2. 마이그레이션 함수 실행 (`migrate.rs`).
3. 성공 시 `.schema-version` 갱신, 백업 7일 후 자동 삭제.
4. 실패 시 백업 복원 + 에러 다이얼로그.

---

## 11. 부록 — 예시 Journal 엔트리 (full)

`.oculpm/journal/20260522/Bugs/2055_bug_changelog-export-param-mismatch.md`:

```markdown
---
schema_version: 1
type: bug
slug: changelog-export-param-mismatch
status: done
difficulty: medium
created_at: "2026-05-22T20:55:00+09:00"
updated_at: "2026-05-22T21:08:14+09:00"
session_id: "20260522-002"
agent:
  id: claude-code
  version: opus-4.7
language: ko
verified_by_user: false
files_touched:
  - path: "src-tauri/src/db.rs"
    op: update
    bytes_added: 42
    bytes_removed: 18
related:
  - ref: "Bugs/2050_bug_diff-modal-empty.md"
    kind: followup
tags: ["changelog", "sqlite", "export"]
---

[x] Changelog Export 시 파라미터 개수 불일치

## 발생 원인

`Db::list_changelog_entries` 의 SQL 빌더가 `since=None` 분기에서도 마지막에
`LIMIT ?3` 을 그대로 붙여놔서, 바인딩은 `[project_id, limit]` 2개인데 자리표시자는
3개가 되어 sqlite 가 에러를 던졌음. Export 가 `from=None` 으로 호출하기 때문에
정확히 이 경로를 밟음.

## 해결 방법

`since` 유무에 따라 SQL 문자열과 자리표시자 번호를 분기해서 prepare.
since 가 있을 때는 `?1 ?2 ?3`, 없을 때는 `?1 ?2` 로 정확히 일치시킴.

## 검증

- `cargo test db::list_changelog_entries` 추가, 양 분기 모두 커버.
- 수동: Changelog 화면에서 Export 클릭 → 에러 없이 markdown/json 생성 확인.
```
