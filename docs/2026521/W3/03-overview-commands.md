# 03. Overview 커맨드 + 인덱싱 훅

> **작업 ID**: W3 / G2 백엔드 파이프라인
> **일자**: 2026-05-21
> **참조**: MASTER-GUIDE §4.2 (커맨드 표), §7.3 (W3 체크리스트)

---

## 변경 요약

`commands/overview.rs` 신설 — G2 파이프라인 전체 (신호 수집 → 시그니처 →
LLM 호출 → upsert) 를 한 모듈에 모았다. `index_project` 종료 직후 fire-and-forget
으로 호출되는 자동화 훅도 함께 연결.

## 변경 파일

### `src-tauri/src/commands/overview.rs` (신규, ~280 lines)

**노출 커맨드 (Tauri)**:

| 커맨드 | 시그니처 | 역할 |
|---|---|---|
| `get_project_overview` | `(project_id) -> Option<ProjectOverview>` | 캐시 읽기. LLM 호출 안 함. |
| `generate_project_overview` | `(project_id, provider, model) -> ProjectOverview` | 강제 재생성. `force=true`. |
| `refresh_project_overview_if_stale` | `(project_id, provider, model) -> Option<ProjectOverview>` | 시그니처가 바뀐 경우에만 LLM 호출. 반환 `None` = 스킵. |

**파이프라인 (`run_generation`, crate-pub)**:

```
1. 신호 수집 (collect_signals)
   - top_level/ 디렉터리 (한 단계 깊이, sorted)
   - language_counts (인덱싱된 파일에서 language_for 매핑)
   - indexed_files / indexed_chunks 카운트
   - MANIFEST_FILES 11개 (README, package.json, Cargo.toml, tauri.conf.json,
     pyproject.toml, go.mod, Gemfile, pom.xml, build.gradle 등) 우선순위순,
     누적 24KB 캡

2. 시그니처 (compute_signature)
   - blake3 (manifests_text + sorted top_level + sorted language_counts)
   - file/chunk 카운트는 *의도적 제외* — 매 인덱싱마다 변해서 시그니처가
     쓸모없어지면 곤란

3. force=false 면 기존 source_signature 와 비교 → 같으면 즉시 None 반환

4. LLM 호출 (call_llm)
   - system: 정해진 JSON 스키마 (identity / stack / overview_md) 강제
   - user: 신호 텍스트 전체
   - temperature: 0.3, max_tokens: 2000

5. 응답 파싱 (markdown 코드펜스 허용)

6. upsert_project_overview 로 저장 + 반환
```

### `src-tauri/src/commands/project.rs` (수정)

`index_project` 의 시그니처에 `app: tauri::AppHandle` 을 추가하고, 인덱싱
종료부에 G2 훅 삽입:

```rust
// Settings 에서 default_provider 와 모델 키를 읽어 둘 다 있을 때만 시동.
// 키가 없으면 (fresh install) 조용히 스킵 — Overview 화면에 수동 버튼이 있다.
let default_provider = settings_map.get("default_provider").cloned();
let model_for_provider = default_provider.as_ref().and_then(|p| {
    settings_map.get(&format!("model_{}", p))
        .cloned()
        .or_else(|| settings_map.get("default_model").cloned())
});
if let (Some(provider), Some(model)) = (default_provider, model_for_provider) {
    let app_handle = app.clone();
    tokio::spawn(async move {
        let db_state = app_handle.state::<Db>();
        match crate::commands::overview::run_generation(
            &db_state, project_id, &provider, &model, /*force=*/ false,
        ).await {
            Ok(Some(_)) => info!(project_id, "overview refreshed after indexing"),
            Ok(None)    => info!(project_id, "overview signature unchanged; skipped"),
            Err(e)      => tracing::warn!(project_id, error = %e, "overview refresh failed"),
        }
    });
}
```

핵심:
- **fire-and-forget**: `index_project` 의 `IndexResult` 반환을 LLM 응답이
  블록하지 않는다. 사용자는 인덱싱이 끝났다고 즉시 인지.
- **AppHandle 클론**: `State<'_, Db>` 는 호출 스코프 lifetime 에 묶이지만
  AppHandle 은 `'static`. spawn 안에서 `state::<Db>()` 로 재획득.
- **에러는 warn 로그만**: 인덱싱 자체는 성공했으므로 사용자에게 에러로
  올리지 않는다. Overview 화면 진입 시 "다시 생성" 으로 복구 가능.

### `src-tauri/src/commands/mod.rs` (수정)

```rust
pub mod overview;
pub use overview::*;
```

### `src-tauri/src/lib.rs` (수정)

```rust
use crate::commands::{
    ...
    // G2 — Project Overview + Daily Brief
    get_project_overview, generate_project_overview, refresh_project_overview_if_stale,
    daily_brief,
};

let builder = Builder::<tauri::Wry>::new().commands(collect_commands![
    ...
    // G2 — Project Overview + Daily Brief
    get_project_overview,
    generate_project_overview,
    refresh_project_overview_if_stale,
    daily_brief,
]);
```

## LLM 프롬프트 설계

```
{
  "identity": "한 문장 (≤120자) 한국어. 이 프로젝트가 '무엇을 하는 무엇'인지 정의.",
  "stack": {
    "framework": "...",
    "languages": ["Rust", "TypeScript"],
    "package_manager": "...",
    "ui": "...",
    "data": "...",
    "notes": "선택. 통합/특이사항 (≤80자)"
  },
  "overview_md": "## 정체성\n## 핵심 기능\n## 디렉터리 가이드\n## 진입점\n## 특이사항"
}
```

규칙:
- 매니페스트가 없으면 추정 금지 (빈 문자열/배열)
- identity 는 마케팅이 아닌 *기능적 정의*
- 디렉터리 가이드는 실제 top_level 에서만

## 설계 결정

- **별도 prompts/*.md 파일 안 만든 이유**: §9.1 신규 파일 목록에는 있지만,
  현재 프롬프트 길이가 짧아 inline string 이 가독성/유지보수에 더 낫다.
  나중에 i18n 분리 시 함께 추출한다.
- **`MAX_SIGNAL_BYTES = 24 KB`**: 마스터 가이드 §4.2 의 권장치. 토큰으로
  ~6K, system 포함 ~7K 입력 → 응답 2K 합쳐 9K. 어떤 provider 도 한 번에 소화.
- **`MANIFEST_FILES` 우선순위**: README 가 절대적으로 먼저 — 다른 신호가 다
  쓰레기여도 README 만 있으면 합격 결과를 만들 수 있다.

## 검증

```
$ cd src-tauri && cargo check
warning: `ai-pm` (lib) generated 6 warnings   (기존과 동일, 신규 0)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 2.60s
```
