# AI-PM 구현 로드맵

> **앱 정체성**: 코드를 직접 수정하지 않고, 개발자의 소통과 프로젝트 관리를 돕는 지능형 LLM 데스크톱 조력자.
> **핵심 가치**: 비용 효율성(토큰 절약) · 고성능 로컬 파일 분석 · 가벼운 구동 환경

---

## 0. 기술 스택 확정

| 영역 | 선택 | 이유 |
|------|------|------|
| 프레임워크 | **Tauri 2.x** | 가벼운 데스크톱 + Rust 백엔드로 대량 파일 I/O 최적 |
| 프론트엔드 | **React 19 + TypeScript + Vite** | shadcn/ui, AI 채팅 컴포넌트, 코드 에디터 생태계 최대 |
| 백엔드 | **Rust** | Tauri 네이티브, 안전성과 성능 |
| 벡터 DB | **sqlite-vec** | 서버리스, 단일 SQLite 파일, Rust 바인딩 우수 |
| 관계형 DB | **SQLite (rusqlite)** | 일정/목표/설정 저장 |
| 임베딩 | **fastembed-rs** | 로컬 임베딩, 외부 API 불필요 (BGE / MiniLM) |
| AST 분석 | **tree-sitter (Rust binding)** | 다중 언어, 빠른 파싱 |
| LLM 클라이언트 | **멀티 프로바이더 추상화** | OpenAI / Anthropic / Gemini / (옵션) Ollama |
| 타입 동기화 | **tauri-specta** | Rust → TS 타입 자동 생성 |
| UI 컴포넌트 | **shadcn/ui + Tailwind CSS** | 데스크톱풍 UI 빠른 구축 |

---

## 1. 개발 단계 (Milestones)

### M0. 환경 준비 ✅ 완료
- [x] Tauri 프로젝트 스캐폴딩
- [x] 디렉토리 평탄화
- [x] **Rust 툴체인 설치** (`rustup` — rustc 1.95.0)
- [x] `pnpm install`
- [x] `pnpm tauri dev` 첫 실행 확인 (Hello World 윈도우)
- [x] Tailwind CSS v4 + shadcn/ui 초기 셋업 (preset: nova, base: neutral)
- [x] `@/*` 경로 alias 설정 (Vite + tsconfig)
- [x] Button 컴포넌트 smoke test
- [x] **tauri-specta 통합** — `src/lib/bindings.ts` 자동 생성
- [x] `bindings.ts` `.gitignore` 등록

**완료 기준**: 빈 Tauri 윈도우가 뜨고 Rust → TS 타입이 자동 생성된다. ✅

---

### M1. 기반 인프라 (Foundation)
**목표**: 모든 기능이 의존하는 공통 모듈을 먼저 만든다.

#### M1-1. 데이터베이스 레이어 ✅
- [x] `src-tauri/src/db.rs` — DB 매니저 (`tokio-rusqlite::Connection`)
- [x] SQLite 마이그레이션 시스템 (PRAGMA `user_version` 기반, 트랜잭션 안전)
- [x] sqlite-vec 확장 자동 로드 (`sqlite3_auto_extension` + `Once`)
- [x] 초기 테이블 정의 (`migrations/001_initial.sql`):
  - `settings` (key-value 설정, 시크릿 제외)
  - `projects` (인덱싱 대상 프로젝트)
  - `files` (증분 인덱싱용 파일 메타)
  - `goals` (M4 일정/목표)
- [x] `db_health` 커맨드 + `DbHealth` 타입 (sqlite/vec 버전, schema_version, path 노출)
- [x] 통합 에러 타입 `error.rs` (thiserror)
- [x] tracing 로그 설정 (`RUST_LOG=info`)
- [ ] `chunks` + `chunk_embeddings` 테이블 (M3에서 임베딩 모델 확정 후 추가)

#### M1-2. 설정 관리 ✅
- [x] API 키 안전 저장 — `keyring` v3.6 (macOS Keychain / Windows Credential Manager / Linux Secret Service)
- [x] `secrets.rs` 모듈 — set/get/has/delete (get은 백엔드 전용)
- [x] DB `settings_set`/`settings_get` 메서드 (비밀이 아닌 설정용)
- [x] 커맨드 노출: `secretSet`, `secretHas`, `secretDelete`, `settingsSet`, `settingsGet`
  - **보안 결정**: `secretGet`은 IPC에 노출하지 않음. UI는 `secretHas`로 존재 여부만 확인하고, 실제 값은 Rust가 LLM 호출 시 직접 사용.
- [x] `SettingsPanel` UI — 프로바이더별 API 키 설정 + 기본 모델 저장

#### M1-3. IPC 명령 골격 ✅
- [x] Tauri 커맨드 모듈 분리: `commands/{mod,diagnostics,config}.rs`
- [x] `Error` 타입 통일 (`thiserror` 기반, `From` 변환 체인)
- [x] 모든 커맨드가 `Result<T, String>` 패턴으로 통일 (specta-typescript 호환)
- [x] tauri-specta로 타입 생성 파이프라인 — dev 빌드마다 `bindings.ts` 자동 갱신
- [x] `greet` smoke test 제거 (UI 미사용)

**완료 기준**: 프론트에서 Rust 명령을 타입 안전하게 호출하고, DB에 read/write 가능. ✅

---

### M2. 기능 ① — 맞춤형 프롬프트 & LLM 통신
**목표**: 한국어 입력 → (선택적) 영어 번역 → LLM 호출 → 응답 표시.

#### M2-1. LLM 추상화 레이어 (진행 중)
- [x] `LlmProvider` trait 정의 (`async-trait`, non-streaming `chat`)
- [x] 공통 타입: `Message`, `Role`, `ChatOptions`, `ChatResponse`, `LlmError`
- [x] `llm::create(name, api_key)` 팩토리
- [x] reqwest 직접 호출 방식 (option B 채택)
- [x] **GeminiProvider** — `v1beta/models/{model}:generateContent`
- [x] **AnthropicProvider** — `v1/messages` (anthropic-version: 2023-06-01)
- [x] **OpenAiProvider** — `v1/chat/completions`
- [x] `chat` 커맨드 (provider, messages, options → ChatResponse)
- [x] `ChatPanel` UI — 3개 프로바이더 선택, 멀티턴 대화 (메모리상)
- [x] **스트리밍** (`tauri::ipc::Channel<ChatEvent>`)
  - `chat_stream` 커맨드 + `ChatEvent::Delta/Done/Error`
  - 공용 SSE 라인 파서 `forward_sse_lines`
  - 프로바이더별 SSE 파싱 (Gemini `streamGenerateContent?alt=sse`, Anthropic `content_block_delta`, OpenAI `data: [DONE]` 종료)
  - 프론트: `Channel<ChatEvent>`로 청크 수신 → 마지막 어시스턴트 메시지에 append
- [x] **마크다운 렌더링** — `react-markdown` + GFM + highlight.js (assistant 메시지만)
- [ ] 대화 히스토리 SQLite 저장 (M2-3 UI iteration)

#### M2-2. 번역 모듈 (옵션)
- [ ] 자동 한→영 번역 toggle 설정
- [ ] 번역 자체도 LLM 또는 전용 API 사용 가능하도록 추상화
- [ ] 기본값: **OFF** (현대 LLM들은 한국어 직접 처리 우수)

#### M2-3. 채팅 UI
- [ ] shadcn-chat 또는 직접 구축
- [ ] 메시지 히스토리 SQLite 저장
- [ ] 스트리밍 응답 렌더링 (Markdown + 코드 하이라이트)
- [ ] 프롬프트 템플릿 관리 (사용자 정의 시스템 프롬프트)

**완료 기준**: 사용자가 채팅창에 입력하면 선택한 LLM이 스트리밍으로 응답하고, 히스토리가 남는다.

---

### M3. 기능 ② — 로컬 코드 분석 + RAG (핵심)
**목표**: 프로젝트를 인덱싱하고, 질문에 가장 관련된 코드만 LLM에 전달.

#### M3-1. 프로젝트 인덱싱 파이프라인 ✅ (Phase A)
- [x] 폴더 선택 다이얼로그 (`tauri-plugin-dialog`)
- [x] 파일 워커 (`ignore` crate) — `.gitignore` 존중, 바이너리/500KB 초과 제외
- [x] 파일 해시(blake3) 기반 증분 인덱싱 — 변경 안 된 파일은 건너뜀
- [x] 진행률 이벤트 (`Channel<IndexProgress>`) → 프로그레스 바
- [x] 마이그레이션 002 (chunks + chunk_embeddings vec0 + 삭제 트리거)

#### M3-2. 정적 분석 (tree-sitter) — Phase B (다음)
- [ ] 언어별 파서 등록 (TS/JS/Python/Rust/Go 우선)
- [ ] AST 추출 → `import/export`, 함수 정의/호출 그래프
- [ ] 함수/클래스 단위 청킹으로 교체 (현재는 line-window)
- [ ] 의존성 그래프를 DB에 저장 (`edges` 테이블)
- [ ] React Flow로 의존성 시각화 (사이드 패널)

#### M3-3. 임베딩 + 벡터 저장 ✅ (Phase A)
- [x] fastembed-rs 초기화 (모델: **MultilingualE5Small**, 384 dim — 한국어 포함 다국어 지원)
- [x] 청킹: **30줄 윈도우 + 4줄 오버랩** (Phase B에서 AST 단위로 교체 예정)
- [x] sqlite-vec에 임베딩 저장 (little-endian f32 바이트)
- [x] 배치 임베딩 (32개씩) — 처리량 최적화
- [x] 모델 lazy 로드 (첫 인덱싱 시 ~120MB 다운로드)
- [ ] 임베딩 모델 변경 시 재인덱싱 플로우 (현재는 schema 고정)

#### M3-4. RAG 질의
- [x] **검색 단독 동작** (Phase A): 자연어 → 임베딩 → top-K 청크 (`searchChunks` 커맨드 + UI)
- [ ] (Optional) 의존성 그래프로 관련 청크 확장 — Phase B
- [ ] 컨텍스트 조립 후 LLM 호출 — Phase B
- [ ] 응답에 출처 청크 표시 (citation) — Phase B

**완료 기준**: 임의의 프로젝트 폴더를 선택해 인덱싱한 뒤, "이 함수 어디서 호출돼?" 같은 질문에 출처와 함께 답한다. 평균 토큰 사용량이 전체 코드 전달 대비 90% 이상 감소.

---

### M4. 기능 ③ — 일정 및 목표 관리
**목표**: 오프라인에서도 동작하는 가벼운 PM 기능.

- [ ] 목표 CRUD (제목, 설명, 마감일, 우선순위, 진행률)
- [ ] 하위 작업 (체크리스트)
- [ ] 캘린더 뷰 (`react-big-calendar` 또는 shadcn 기반)
- [ ] 대시보드 — 오늘 할 일, 진행 중 목표, 달성률 차트 (`recharts`)
- [ ] LLM 연동 — "이번 주 할 일 요약해줘" 같은 자연어 쿼리
- [ ] (Stretch) 코드 분석 결과와 연결 — "이 PR 관련 목표"

**완료 기준**: 오프라인 상태에서 목표 생성/체크 가능하고, 대시보드에서 진행률을 시각화한다.

---

### M5. 마무리 (Polish)
- [ ] 다크/라이트 테마
- [ ] 단축키 (`tauri-plugin-global-shortcut`)
- [ ] 시스템 트레이 아이콘
- [ ] 자동 업데이트 (`tauri-plugin-updater`)
- [ ] 로깅 (`tracing` + Tauri log 플러그인)
- [ ] 에러 리포팅 (선택)
- [ ] macOS / Windows / Linux 빌드 스크립트
- [ ] 코드 서명 (배포 시)

---

## 2. 디렉토리 구조 (목표)

```
ai-pm/
├── docs/                          # 설계 문서
│   └── ROADMAP.md
├── src/                           # React 프론트엔드
│   ├── components/                # 재사용 컴포넌트 (shadcn/ui 포함)
│   ├── features/
│   │   ├── chat/                  # M2
│   │   ├── code-analysis/         # M3
│   │   └── planner/               # M4
│   ├── lib/
│   │   ├── ipc.ts                 # Tauri invoke 래퍼
│   │   └── bindings.ts            # tauri-specta 생성
│   ├── hooks/
│   ├── pages/
│   └── App.tsx
├── src-tauri/                     # Rust 백엔드
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs
│   │   ├── commands/              # Tauri 커맨드 (IPC 엔드포인트)
│   │   │   ├── chat.rs
│   │   │   ├── project.rs
│   │   │   └── planner.rs
│   │   ├── db/                    # SQLite + sqlite-vec
│   │   │   ├── mod.rs
│   │   │   ├── migrations/
│   │   │   └── schema.rs
│   │   ├── llm/                   # LLM 프로바이더 추상화
│   │   │   ├── mod.rs
│   │   │   ├── openai.rs
│   │   │   ├── anthropic.rs
│   │   │   └── gemini.rs
│   │   ├── embedding/             # fastembed-rs
│   │   ├── ast/                   # tree-sitter
│   │   ├── indexer/               # 파일 워커 + RAG 파이프라인
│   │   └── error.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
└── package.json
```

---

## 3. 비기능 요구사항 (NFR)

| 항목 | 목표 |
|------|------|
| 콜드 스타트 | < 2초 |
| 1만 파일 인덱싱 | < 60초 (HDD), < 20초 (SSD) |
| RAG 응답 latency | < 1초 (검색 단계) |
| 메모리 사용량 (idle) | < 200MB |
| 디스크 사용량 | 모델 포함 < 500MB |
| 오프라인 동작 | M4(일정/목표)는 완전 오프라인 |

---

## 4. 위험 요소 & 완화책

| 위험 | 영향 | 완화 |
|------|------|------|
| fastembed-rs 모델 다운로드 실패 | 인덱싱 불가 | 첫 실행 시 진행률 UI + 재시도 |
| sqlite-vec 확장 로드 실패 (플랫폼별) | 벡터 검색 불가 | 사전 빌드된 바이너리 번들링 |
| 대형 프로젝트 인덱싱 시 RAM 폭증 | 앱 크래시 | 배치 처리 + 백프레셔 |
| LLM API 키 노출 | 보안 사고 | OS keychain / Stronghold만 사용, 코드에 하드코딩 금지 |
| 토큰 비용 폭증 | UX 악화 | 호출 전 토큰 추산 + 예산 한도 UI |

---

## 5. 즉시 다음 단계 (M0 완료를 위해)

1. **Rust 설치** — `! curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y`
2. `pnpm install` — 프론트엔드 의존성 설치
3. `pnpm tauri dev` — 첫 윈도우 확인
4. Tailwind CSS + shadcn/ui 초기화
5. tauri-specta 통합

이후 M1 (데이터베이스 레이어)부터 본격 개발에 들어갑니다.
