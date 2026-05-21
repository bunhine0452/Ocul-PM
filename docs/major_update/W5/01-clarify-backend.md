# 01. G3 백엔드: clarify_edit_intent + with_answers 분리

> **작업 ID**: W5 / G3
> **일자**: 2026-05-21
> **참조**: MASTER-GUIDE §4.3 (G3. Clarifying Question)

---

## 변경 요약

`generate_edit_prompt` 의 단일 LLM 호출을 *모호도 평가 + 답변 기반 생성* 두
단계로 분리. 기존 커맨드는 backward-compat shim 으로 남겨 호출자 영향 없음.

## 변경 파일

### `src-tauri/src/db.rs`

신규 타입 3 종:

```rust
pub struct ClarifyQuestion { id, kind: "choice"|"text", text, options }
pub struct ClarifyResult   { ambiguity_score: f32, questions, auto_proceed }
pub struct ClarifyAnswer   { id, answer }
```

`f32` 가 Specta 호환 (f64 도 가능하나 f32 가 더 작음). 모든 정수는 i32/u32.

### `src-tauri/src/commands/project.rs`

| 커맨드 | 시그니처 | 역할 |
|---|---|---|
| `clarify_edit_intent` | `(project_id, user_request, provider, model) → ClarifyResult` | 모호도 평가, 1~3 질문 생성 |
| `generate_edit_prompt_with_answers` | `(project_id, user_request, answers, provider, model) → EditPromptResult` | 답변 반영해 영어 프롬프트 생성 |
| `generate_edit_prompt` (legacy) | 기존 시그니처 | `with_answers([])` 호출하는 thin shim |

내부 공통 헬퍼 `generate_with_answers_inner` 가 두 명령의 코드 중복을 흡수.

**`clarify_edit_intent` 의 비용 최적화**:
- code chunk context **포함 안 함** — §4.3 의 "입력 ≤500 / 출력 ≤300 토큰" 목표
- file path sample 만 30 개 전달 (LLM 이 화면/모듈 이름을 알 수 있게)
- `temperature: 0.2`, `max_tokens: 400`

LLM 응답 JSON 스키마 강제:
```json
{
  "ambiguity_score": 0.0–1.0,
  "questions": [{ "id": "q1", "kind": "choice|text", "text": "...", "options": [...] }],
  "auto_proceed": bool
}
```
- score < 0.4 → auto_proceed=true, questions=[]
- score ≥ 0.4 → 1~3 questions, auto_proceed=false
- 답변 후 `generate_with_answers_inner` 는 embedding query 를
  `user_request + answers` 합쳐서 만들어 retrieval 도 정제된 의도를 반영.

## 설계 결정

- **legacy shim 유지**: AssistPanel 흡수가 W5 에서 끝나면 `generate_edit_prompt`
  를 호출하는 곳이 사라지므로, W7 polish 단계에서 삭제 가능. 지금 삭제하면
  외부 도구 / 향후 자동화에서 의존하는 케이스를 놓칠 위험.
- **questions hard-cap 3**: §4.3 의 명시 규칙. LLM 이 5 개를 보내도
  Rust 측에서 truncate.
- **answers 가 retrieval 도 steer**: 단순히 prompt 에 추가하는 것보다 embedding
  까지 합치면 *"q2 답이 /signup 에 적용된다"* 같은 정보가 RAG 결과를 바꿈.

## 검증

`cargo check` → 5 warnings, 0 errors (G3 도입 전과 동일).
