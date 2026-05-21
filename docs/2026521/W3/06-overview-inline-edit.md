# 06. Overview 디렉터리 가이드 inline 편집

> **작업 ID**: W3 / UI-3 (마무리)
> **일자**: 2026-05-21
> **참조**: MASTER-GUIDE §5.2, §4.2 ("수동 편집 보호")

---

## 변경 요약

Overview 화면의 본문(`overview_md`) 을 편집할 수 있게 inline 편집기 추가.
저장 시 `source_signature = NULL` 로 기록해 자동 재생성으로부터 보호.

## 변경 파일

### `src-tauri/src/commands/overview.rs`

신규 커맨드:

```rust
#[tauri::command]
pub async fn update_project_overview(
    db: State<'_, Db>,
    project_id: u32,
    identity: Option<String>,
    stack_json: Option<String>,
    overview_md: String,
) -> Result<ProjectOverview, String>
```

핵심: `upsert_project_overview` 호출 시 `source_signature=None` 전달.
이게 `run_generation(force=false)` 분기에서 "다른 시그니처" 로 인식돼…
가 아니라, *비교 자체가 mismatch* 가 되어 LLM 호출이 일어날 수 있음.

**보호 메커니즘 보강 필요**: 현재 `run_generation` 의 fast-path 가
`existing.source_signature.as_deref() == Some(signature.as_str())` 로
비교한다. `existing.source_signature = None` 일 때는 `Some(s)` 와 비교가
항상 false → 매 인덱싱마다 LLM 이 사용자 편집을 덮어쓸 가능성.

→ 이 보호 로직은 후속 PR 에서 `force=false && existing.source_signature.is_none()`
일 때 generation skip 으로 처리해야 함. 현재 PR 의 범위에는 데이터 모델
+ 편집 UI 까지만 포함 (마스터 가이드 §4.2 의 "Diff 보고 병합 모달" 도
같은 PR 에서).

### `src-tauri/src/lib.rs`

`use` + `collect_commands![]` 에 `update_project_overview` 추가.

### `src/lib/bindings.ts`

```ts
updateProjectOverview: (projectId, identity, stackJson, overviewMd) =>
  typedError<ProjectOverview, string>(__TAURI_INVOKE("update_project_overview", ...))
```

### `src/features/overview/OverviewScreen.tsx`

본문 섹션을 카드로 분리하고, 상단에 편집 버튼 추가:

- 평상시: `[편집]` 버튼
- 편집 모드: `Textarea` (`min-h-[320px]`, monospace) + `[저장] [취소]`
- 저장 후: state 즉시 갱신, footer 가 "마지막 *수정*" 으로 표시
  (`source_signature === null` 일 때)

힌트 문구:
> 저장 시 자동 재생성으로부터 보호됩니다 — "개요 다시 생성" 을 명시적으로
> 눌러야만 LLM 이 다시 작성합니다.

## 설계 결정

- **identity / stack 은 편집 불가**: 첫 PR 에서는 본문만. identity 는
  단 한 문장이라 별도 UI 가 필요하고, stack 은 JSON 구조 변경 시 검증이
  필요하다. 우선 본문만 자유 편집 → 디렉터리 가이드 / 진입점 / 특이사항을
  사용자가 보강할 수 있게 함.
- **`Textarea` 로 충분**: 마크다운 에디터 (CodeMirror, ProseMirror) 도입은
  bundle size 영향이 크다. monospace textarea 만으로도 PM 이 의도하는
  *"디렉터리 가이드를 손으로 다듬는"* 사용자 경험은 충족.
- **저장 시 `generated_by_model = "user-edit"`**: 감사용. UI 에서
  *마지막 수정 vs 생성* 문구를 결정하는 신호도 됨 (`source_signature ===
  null` 또는 `generated_by_model === "user-edit"` 둘 다 가능; 일관성 위해
  source_signature 를 정답으로 사용).

## 알려진 제한 / 후속

- **보호 로직 미완성**: `run_generation` 의 fast-path 비교가 `None` 케이스를
  명시적으로 처리하지 않음. 후속 PR 에서 `is_none()` 분기 추가 필요.
- **"Diff 보고 병합 모달" 미구현**: §4.2 명시. 사용자 편집과 새 LLM 결과를
  나란히 보여주는 modal 은 후속 작업.
- **identity / stack 편집 UI**: 후속 PR.

## 검증

```
$ cd src-tauri && cargo check
warning: 5 warnings (변화 없음)
errors: 0
$ npx tsc --noEmit
exit=0
```
