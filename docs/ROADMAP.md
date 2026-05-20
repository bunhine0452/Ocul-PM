# AI-PM 구현 로드맵 (ROADMAP)

> **앱 정체성**: 코드를 직접 수정하지 않고, 개발자의 소통과 프로젝트 관리를 돕는 지능형 LLM 데스크톱 조력자.
> **핵심 가치**: 비용 효율성(토큰 절약) · 고성능 로컬 파일 분석 · 가벼운 구동 환경 · 미려하고 실용적인 UI/UX

---

## 0. 기술 스택 확정

| 영역 | 선택 | 이유 |
|------|------|------|
| 프레임워크 | **Tauri 2.x** | 가벼운 데스크톱 + Rust 백엔드로 대량 파일 I/O 최적 |
| 프론트엔드 | **React 19 + TypeScript + Vite** | React Flow, Recharts, markdown-renderer 등 생태계 최대 |
| 백엔드 | **Rust** | Tauri 네이티브, 파일 시스템 엑세스 및 고성능 연산 |
| 벡터 DB | **sqlite-vec** | 서버리스, 단일 SQLite 파일, Rust 바인딩 |
| 관계형 DB | **SQLite (rusqlite / migrations)** | 일정/목표/대화 저장 및 인덱스 추적 |
| 임베딩 | **fastembed-rs** | 로컬 임베딩, 외부 API 불필요 (Multilingual-E5-Small) |
| AST 분석 | **tree-sitter v0.23 (Rust bindings)** | 다중 언어 구문 및 심볼 추출, 고속 의존성 해석 |
| LLM 클라이언트 | **멀티 프로바이더 추상화** | OpenAI, Anthropic, Gemini API 지원 및 스트리밍 연동 |
| 타입 동기화 | **tauri-specta** | Rust → TS 타입 자동 생성 및 IPC 안전 보장 |
| UI 컴포넌트 | **shadcn/ui + Tailwind CSS** | 프리미엄 테마 및 세련된 다크모드 컴포넌트 |

---

## 1. 개발 단계 및 현재 상태 (Milestones)

### M0. 환경 준비 ✅ 완료
- [x] Tauri 프로젝트 스캐폴딩 및 디렉토리 평탄화
- [x] Rust 툴체인 및 패키지 매니저 (`pnpm`) 환경 구축
- [x] Tailwind CSS v4 + 폰트 설정 적용
- [x] `tauri-specta` 통합 및 `src/lib/bindings.ts` 자동 생성 파이프라인 수립

---

### M1. 기반 인프라 (Foundation) ✅ 완료
- [x] **데이터베이스 레이어**: SQLite 마이그레이션 프레임워크(`tokio-rusqlite`) 구축 및 `sqlite-vec` 확장 로딩
- [x] **설정 및 보안 관리**: OS Keyring 연동을 통한 LLM API Key 안전 저장 및 중요 설정 저장 모듈 구현
- [x] **IPC 명령 골격**: `commands/` 패키징 모듈화 및 specta-typescript 동기화 체계 완비

---

### M2. 기능 ① — 맞춤형 프롬프트 & LLM 통신 ✅ 완료
- [x] **LLM 추상화 레이어**: OpenAI, Anthropic, Gemini 연동 및 SSE 스트리밍 라인 파서 구현
- [x] **채팅 UI & 영속화**: `conversations` + `chat_messages` 테이블 기반 대화 이력 보존, 대화 삭제/수정/사이드바 전환 지원
- [x] **마크다운 및 코드 하이라이트**: `react-markdown` + GFM 규격 코드 블록 및 텍스트 프리미엄 렌더링

---

### M3. 기능 ② — 로컬 코드 분석 + RAG (핵심) ✅ 완료
- [x] **프로젝트 인덱싱 파이프라인**: `ignore` 워커 기반 증분 인덱싱 및 로컬 임베딩(`fastembed-rs`) 벡터 DB 저장
- [x] **RAG 질의 연동**: 자연어 임베딩 매칭 및 top-K 청크 시스템 프롬프트 자동 주입, 참고 출처 collapsible 배지 표기
- [x] **AST 구문 분석 및 의존성 추출**:
  - `tree-sitter v0.23`으로 각 언어(Rust, TS, JS, Go, Python) 파싱
  - 파일별 AST 심볼 정보(`ast_symbols`) 및 의존성(`ast_dependencies`) 관계 정밀 적재
- [x] **의존성 시각화 맵**:
  - `@xyflow/react` 기반 위상 정렬 레이아웃(Topological Layout) 및 언어별 글래스모피즘 노드 시각화
  - 노드 클릭 시 해당 파일의 정의 심볼을 백엔드로부터 비동기식으로 가져오는 **Lazy Loading 구조 적용** (불필요한 전체 조회 최적화)
  - 인스펙터 패널(심볼 리스트 및 임포트 관계 링크) 및 실시간 카메라 트래킹(setCenter) 검색 탑재

---

### M4. 기능 ③ — 일정 및 목표 관리 ✅ 완료
- [x] **목표 및 서브태스크 CRUD**: 관계형 DB 연동 목표 관리 모델 구현 및 통계 연산 API 확보
- [x] **플래너 캘린더 및 대시보드**: `date-fns` 기반 일정 달력 및 `recharts` 연동 통계 그래프(달성도, 상태 분포) 시각화
- [x] **LLM 플래너 통합**:
  - 자연어로 "오늘 해야 할 목표 정리해줘" 혹은 "목표 XX의 하위 작업을 생성해줘"라고 입력 시 플래너가 대화 맥락을 기반으로 직접 DB 연동 태스크 관리 지원

---

### M5. 마무리 및 데스크톱 고도화 (Polish & Desktop UX) ⬜ 진행 예정
**목표**: 사용자 편의성을 Claude Desktop 수준으로 향상하고 프로덕션 릴리즈 준비.

#### M5-1. Claude Desktop 스타일 UX 구현
- [ ] **네이티브 타이틀바 커스터마이징**: OS 기본 타이틀바를 숨기고(Frameless/Window Decoration False), 앱 내부에 일체형의 세련된 커스텀 타이틀바 영역 및 창 컨트롤 버튼(닫기, 최소화, 최대화) 배치
- [ ] **드래그 영역 지정**: `-webkit-app-region: drag` 스타일링을 활용하여 네이티브 드래그감을 주는 탑바 영역 설계
- [ ] **반응형 패널 그리드 최적화**: 윈도우 사이즈 조절 시 사이드바 및 메인 컨텐츠 영역의 자연스러운 미세 애니메이션 배치 및 글래스모피즘 효과(Backdrop Blur) 강화

#### M5-2. 데스크톱 시스템 통합 및 유틸리티
- [ ] **글로벌 단축키 (`tauri-plugin-global-shortcut`)**: 어디서든 앱을 즉시 호출(Show/Hide)할 수 있는 단축키 커스텀 설정
- [ ] **시스템 트레이 아이콘**: 백그라운드 구동 옵션 및 트레이 메뉴(앱 활성화, 빠른 설정, 종료) 지원
- [ ] **다크/라이트 시스템 테마 동기화**: OS 테마 변화 감지 및 수동 토글 옵션 UI 제공

#### M5-3. 프로덕션 빌드 및 릴리즈 준비
- [ ] **자동 업데이트 파이프라인 (`tauri-plugin-updater`)**: 릴리즈 채널 연동 및 업데이트 감지 팝업
- [ ] **플랫폼별 번들링 및 빌드 최적화**: Rust 릴리즈 컴파일 최적화(`opt-level = 3`, LTO 활성화) 및 코드 서명(Code Signing) 적용

---

## 2. 디렉토리 구조

```
ai-pm/
├── docs/                          # 개발 계획 및 문서 리소스
│   └── ROADMAP.md
├── src/                           # React 프론트엔드
│   ├── components/                # 공용 컴포넌트 (UI 및 단일 모달)
│   ├── features/
│   │   ├── chat/                  # M2: LLM 채팅 및 히스토리
│   │   ├── projects/              # M3: 코드 검색 및 의존성 시각화 (React Flow)
│   │   └── planner/               # M4: 일정/목표 CRUD, 대시보드, 달력
│   ├── lib/
│   │   ├── ipc.ts                 # Tauri invoke 래퍼
│   │   └── bindings.ts            # tauri-specta 자동 생성 연동 바인딩
│   ├── index.css                  # Nova CSS 테마 변수 및 글로벌 폰트
│   └── App.tsx
├── src-tauri/                     # Rust 백엔드
│   ├── migrations/                # SQLite DB 스키마 버전 마이그레이션
│   ├── src/
│   │   ├── commands/              # Tauri IPC 커맨드 구현체
│   │   │   ├── chat.rs
│   │   │   ├── project.rs
│   │   │   └── planner.rs
│   │   ├── db.rs                  # 관계형 DB 및 sqlite-vec 연동 매니저
│   │   ├── ast.rs                 # tree-sitter v0.23 파서 및 심볼 추출기
│   │   ├── indexer.rs             # ignore 워커 및 임베딩 파이프라인
│   │   ├── llm.rs                 # 멀티 LLM 프로바이더 구현
│   │   ├── embedding.rs           # fastembed-rs 로컬 임베딩 로직
│   │   ├── error.rs               # thiserror 기반 커스텀 에러 처리
│   │   └── lib.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
└── package.json
```

---

## 3. 비기능 요구사항 (NFR)

| 항목 | 목표 | 현재 상태 |
|------|------|------|
| 콜드 스타트 | < 2.0초 | 약 1.2초 (초기 윈도우 마운트 기준) |
| 1,000개 파일 인덱싱 | < 10초 | 약 3~4초 (SSD 기준 증분 인덱싱 작동 시 0.2초 미만) |
| RAG 검색 레이턴시 | < 1.0초 | 약 0.3초 (로컬 sqlite-vec 코사인 유사도 검색) |
| 메모리 사용량 (대기) | < 150MB | 약 110MB |
| 오프라인 동작 | 플래너 및 정적 분석 완전 오프라인 | 100% 충족 |

---

## 4. 위험 요소 및 대응 전략

- **대규모 프로젝트의 AST 분석 및 임베딩 메모리 폭증**:
  - *대응*: 백엔드에서 배치(batch) 처리를 통해 파이프라인 메모리를 평탄화하고, 지정된 용량 초과 파일(500KB)은 정적 분석에서 명시적으로 스킵.
- **최초 인덱싱 시 fastembed 모델 다운로드 지연**:
  - *대응*: 백엔드 로딩 진행 상태 이벤트를 채널로 쏴서 프론트엔드 화면에 '모델 다운로드 중...' 메시지와 상태 바를 명확하게 제시.
- **의존성 그래프(React Flow) 렌더링 부하**:
  - *대응*: 화면에 안 보이는 노드는 뷰포트에서 가상화하고, 심볼 정보를 lazy-load로 분리하여 초기 렌더링 데이터 전송 크기를 최적화함.
