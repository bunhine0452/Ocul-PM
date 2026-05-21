# 06. NVIDIA NIM LLM Provider 추가

> **작업 ID**: W5 / LLM 확장
> **일자**: 2026-05-21
> **참조**: §6 (provider abstraction)

---

## 변경 요약

NVIDIA NIM API 를 4 번째 LLM provider 로 추가. OpenAI 호환 endpoint 라
프로토콜 변환 없이 `openai.rs` 패턴을 그대로 재사용.

## 신규 파일

### `src-tauri/src/llm/nim.rs`

- Endpoint: `https://integrate.api.nvidia.com/v1/chat/completions`
- 인증: `Bearer <NVIDIA_API_KEY>`  (https://build.nvidia.com → "Get API Key")
- 요청/응답 형식: OpenAI 와 동일 (chat.completions). `openai.rs` 와 거의 1:1.
- 차이점:
  - `accept: application/json` (non-stream) / `text/event-stream` (stream) 명시
  - 응답에 `model` 필드가 빠질 수 있어 `opts.model` 로 fallback
  - `chat_stream` SSE 파서는 OpenAI 동일 (`data: …`, `[DONE]` 처리)

## 수정 파일

### `src-tauri/src/llm/mod.rs`

- `pub mod nim;`
- `create(name, key)` 에 `"nim" => Ok(Box::new(nim::Nim::new(key)))` 분기

### `src-tauri/src/commands/config.rs`

`clear_all_data` 의 provider 키 삭제 루프에 `"nim"` 추가:
```rust
for provider in &["openai", "anthropic", "gemini", "nim"] {
    let _ = secrets::delete(&format!("{}_api_key", provider));
}
```

### `src/lib/settings.ts`

- `Provider` union 에 `"nim"` 추가
- `PROVIDERS` 배열에 `"nim"` 추가
- 새 settings 키 `modelNim` (`"model_nim"`) + 필드 + DEFAULT (`"meta/llama-3.3-70b-instruct"`)
- `KEY_TO_FIELD` 매핑 추가
- `providerModel(settings, "nim")` 분기

### `src/features/settings/SettingsPanel.tsx`

- `hasKey` state 의 record 에 `nim: null` 추가
- "Default Provider" 그리드 `grid-cols-3` → `grid-cols-2 sm:grid-cols-4`
- Models 섹션에 `<Field label="NVIDIA NIM">` 추가 (placeholder + hint)

### `src/features/chat/ChatPanel.tsx`, `src/features/code/AiWorkbench.tsx`

- 로컬 `PROVIDERS` const 에 `"nim"` 추가
- `FALLBACK_MODEL.nim = "meta/llama-3.3-70b-instruct"` (AiWorkbench)

## 사용 흐름

1. Settings → LLM → "API Keys" select 에서 `nim` 선택 → API 키 붙여넣기 → Save
2. "Default Provider" 에서 NIM 선택 (또는 채팅 시 provider 토글)
3. "Models — NVIDIA NIM" 에서 원하는 모델 ID 입력 (예: `meta/llama-3.3-70b-instruct`,
   `nvidia/llama-3.1-nemotron-70b-instruct`, `mistralai/mixtral-8x22b-instruct-v0.1` …)
4. Chat/Quick Edit 사용 시 자동 라우팅

## 설계 결정

- **OpenAI 패턴 재사용**: NIM 이 OpenAI 호환을 광고하고 있고 실제로 byte
  단위 호환. 새 추상화 없이 모듈만 추가하는 게 가장 안전.
- **모델 ID 사용자 입력**: NIM 의 모델 카탈로그 (수십 종) 를 하드코딩하면
  빠르게 outdated 됨. settings 의 자유 입력 필드 + 친절한 placeholder.
- **응답 `model` 필드 fallback**: NIM 일부 모델이 응답에 `model` 키를 누락 →
  `parsed.model.is_empty()` 시 요청 model 그대로 반환.

## 검증

```
$ cargo check
warning: `ai-pm` (lib) generated 5 warnings, errors: 0
$ npx tsc --noEmit
exit=0
$ pnpm lint
✓ no direct localStorage access outside the allowlist
```

UI 동작은 다음 dev 런에서 (auto-regenerated bindings 가 변경된 settings 키
4 개를 자동 인식).
