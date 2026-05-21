# 01. project_overviews 마이그레이션 신설

> **작업 ID**: W3 / G2 데이터 모델
> **일자**: 2026-05-21
> **참조**: MASTER-GUIDE §4.2 (G2. 프로젝트 개요 자동 생성), §8.2 (마이그레이션 순서)

---

## 변경 요약

LLM 이 생성한 README-급 프로젝트 개요를 영속화하기 위한 단일 테이블
`project_overviews` 를 추가. `project_id` 가 PK (1:1) 이므로 한 프로젝트당
한 줄만 존재한다.

## 변경 파일

### `src-tauri/migrations/008_project_overview.sql` (신규)

```sql
CREATE TABLE IF NOT EXISTS project_overviews (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  identity TEXT,
  stack_json TEXT,
  overview_md TEXT,
  source_signature TEXT,
  generated_at INTEGER,
  generated_by_model TEXT
);
```

| 컬럼 | 용도 | 비고 |
|---|---|---|
| `identity` | "이 앱이 무엇인지" 한 줄 정의 | 마케팅 카피 아님 |
| `stack_json` | 프레임워크/언어/패키지매니저 JSON | 스키마 변경 부담 없이 키 확장 가능 |
| `overview_md` | 본문 (마크다운) | 정체성/핵심 기능/디렉터리 가이드/진입점 섹션 |
| `source_signature` | 입력 신호 해시 (blake3) | 같은 시그니처면 재생성 스킵 |
| `generated_at` | 마지막 생성 시각 (unix sec) | 수동 편집 후 NULL 로 두면 자동 재생성 보호 |
| `generated_by_model` | 생성에 사용한 모델 id | 감사 추적 |

### `src-tauri/src/db.rs`

마이그레이션 목록에 v8 추가:

```rust
const MIGRATIONS: &[(i64, &str)] = &[
    ...
    (7, include_str!("../migrations/007_changelog.sql")),
    (8, include_str!("../migrations/008_project_overview.sql")),
];
```

## 설계 결정

- **단일 테이블 1:1**: 한 프로젝트의 개요는 자주 변하지 않아 히스토리 보존이
  큰 가치가 없다. `source_signature` 만 비교해 변화가 있을 때 덮어쓴다.
- **`stack_json` 을 TEXT 로 저장**: LLM 응답에 임의의 키가 추가돼도 마이그레이션
  없이 흡수 가능. 프론트는 `JSON.parse` 후 알려진 키만 chip 으로 렌더.
- **`overview_md` 와 `identity` 분리**: identity 는 hero copy 로 카드 상단에
  강조 표시되고, overview_md 는 본문에 들어간다. 분리하면 identity 만 다시
  쓸 때 본문 보존 가능.
- **`source_signature` 의 의미**: `Some(hex)` = LLM 이 마지막으로 본 입력의 해시.
  `None` = 사용자가 수동 편집한 상태 (자동 재생성에서 보호). 본 마이그레이션에서는
  컬럼만 마련하고, 보호 로직은 후속 PR.

## 검증

```
$ cd src-tauri && cargo check
warning: `ai-pm` (lib) generated 6 warnings
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 2.60s
```

신규 에러 0. PRAGMA user_version 이 7→8 로 자동 승격된다.
