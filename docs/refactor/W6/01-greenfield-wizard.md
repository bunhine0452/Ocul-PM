# W6 — G4 + UI-6 + UI-7 구현 기록

> **일자**: 2026-05-22
> **주제**: Greenfield 프로젝트 생성, StartScreen, Polish
> **변경 파일**: 14개 신규/수정

---

## 요약

W6에서는 MASTER-GUIDE의 G4(Greenfield 프로젝트 생성), UI-6(StartScreen/GreenfieldWizard), UI-7(Polish: 디자인 토큰/A11y/카피 한국어 통일/마이크로 인터랙션)을 구현했다.

---

## 1. DB 변경 — `project_blueprints` 테이블

### 신규 파일
- `src-tauri/migrations/011_project_blueprints.sql`

### 테이블 스키마
| 컬럼 | 타입 | 용도 |
|---|---|---|
| `id` | INTEGER PK | 자동 증가 |
| `name` | TEXT | 프로젝트 이름 또는 아이디어 요약 |
| `idea_text` | TEXT | Step 0 자유 텍스트 |
| `target_users` | TEXT | Step 1 대상 사용자 |
| `stack_choice` | TEXT | Step 2 JSON (framework, language 등) |
| `folder_name` / `folder_path` | TEXT | Step 3 저장 위치 |
| `seed_goals_json` | TEXT | Step 4 JSON 배열 |
| `wizard_step` | INTEGER | 마지막 진행 단계 (0-4) |

### db.rs 변경
- `ProjectBlueprint` struct 추가 (serde + specta 파생)
- `save_blueprint` / `get_blueprint` / `list_blueprints` / `delete_blueprint` CRUD
- `blueprint_from_row` 헬퍼 추가

---

## 2. Greenfield Backend — `greenfield.rs`

### 커맨드 7종
| 커맨드 | 역할 |
|---|---|
| `save_blueprint` | 위저드 초안 저장 (INSERT/UPDATE) |
| `get_blueprint` | 초안 복원 |
| `list_blueprints` | 전체 초안 목록 |
| `delete_blueprint` | 초안 삭제 |
| `check_cli_available` | OS별 PATH 검증 (`which`/`where` + fallback) |
| `create_greenfield_project` | 폴더 생성 → CLI 실행 → DB 등록 → blueprint 정리 |
| `generate_seed_goals` | LLM으로 초기 goal 3~5개 생성 |

### CLI 검증 전략
1. `which`(Unix) / `where`(Windows)로 PATH 탐색
2. 발견 실패 시 일반적 설치 경로 fallback:
   - macOS: `/usr/local/bin`, `~/.cargo/bin`, `~/.nvm/current/bin`, `/opt/homebrew/bin`
   - Windows: `%APPDATA%\npm`, `%USERPROFILE%\.cargo\bin`
3. 발견 시 `--version` 실행해 버전 추출

### 스캐폴딩 실행
- `std::process::Command` + `tokio::task::spawn_blocking` (tokio process feature 미활성화 대응)
- 60초 타임아웃, stdout+stderr 캡처
- 실패 시 non-fatal: 프로젝트는 빈 폴더로 생성됨

---

## 3. StartScreen — 기존 Dashboard 대체

### 파일
- `src/features/onboarding/StartScreen.tsx` (신규)
- `src/App.tsx` (수정: Dashboard → StartScreen)

### 구성
- 📂 기존 폴더 불러오기 / ✨ 새 프로젝트 시작하기 — 두 CTA 카드
- 임시 저장된 blueprint 목록 (복원/삭제)
- 기존 프로젝트 카드 그리드 (마이크로 인터랙션 포함)
- 모든 카피 한국어

---

## 4. GreenfieldWizard — 5단계 위저드

### 파일
- `src/features/onboarding/GreenfieldWizard.tsx` (신규)

### 5단계 흐름
| Step | 제목 | 핵심 UX |
|---|---|---|
| 0 | 어떤 앱을 만들까요? | 자유 텍스트 + 예시 chip 6종 |
| 1 | 누가 사용하나요? | 자유 텍스트 + chip (선택 사항) |
| 2 | 기술 스택 선택 | 6종 preset 카드 + CLI 설치 상태 뱃지 |
| 3 | 프로젝트 위치 | 폴더 picker + 이름 입력 + 경로 미리보기 |
| 4 | 초기 목표 확인 | 3개 기본 goal + 편집 가능 |

### 초안 저장
- debounce 2초로 자동 저장 (`save_blueprint`)
- X 클릭 시에도 마지막 상태 저장
- StartScreen에서 복원 버튼으로 중단 지점부터 재개

### 프로젝트 생성
- Step 4 "프로젝트 시작하기" → `create_greenfield_project` 호출
- 성공 시 Overview 화면으로 자동 전환

---

## 5. Polish — 디자인 토큰 / A11y / 카피

### 디자인 토큰 (`App.css`)
```css
--radius-card: 16px;
--radius-button: 8px;
--radius-chip: 999px;
--motion-fast: 150ms;
--motion-normal: 200ms;
```

### A11y
- 사이드바: `<aside>` → `<nav role="navigation" aria-label="메인 내비게이션">`
- 내비 버튼: `aria-label`, `aria-current`, `role="listitem"`
- StartScreen 버튼: 모두 `aria-label` 추가

### 카피 한국어 통일
- App.tsx: "Your Projects" → "내 프로젝트", "Settings" → "설정", 다이얼로그 전체
- TitleBar: "Dashboard" → "대시보드"
- CodeWorkbench: "No File Opened" → "열린 파일이 없습니다"
- PRIMARY_NAV: Overview → 개요, Today → 오늘, Plan → 계획, Changelog → 변경 기록, Code → 코드
- `src/locales/ko.json` 준비 (향후 `useTranslation()` 도입용)

---

## 6. 마이크로 인터랙션

### Project Card Hover
```css
.project-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 8px 25px -5px rgba(0,0,0,0.08), ...;
}
```

### Markdown 복사 버튼
- `Markdown.tsx`에 `CodeBlockWrapper` 추가
- hover 시 우상단 📋 버튼 노출
- 클릭 → 클립보드 복사 + "복사됨" 피드백 1.5초

### Icons 추가
`ArrowRight`, `ArrowLeft`, `AlertTriangle`, `Rocket`, `Clock`, `MessageCircle`, `ClipboardCheck` 아이콘 추가

---

## 변경 파일 목록

| 상태 | 파일 |
|---|---|
| NEW | `src-tauri/migrations/011_project_blueprints.sql` |
| NEW | `src-tauri/src/commands/greenfield.rs` |
| NEW | `src/features/onboarding/StartScreen.tsx` |
| NEW | `src/features/onboarding/GreenfieldWizard.tsx` |
| NEW | `src/locales/ko.json` |
| MOD | `src-tauri/src/db.rs` (migration 등록 + struct + CRUD) |
| MOD | `src-tauri/src/commands/mod.rs` (greenfield 모듈) |
| MOD | `src-tauri/src/lib.rs` (커맨드 7종 등록) |
| MOD | `src/App.tsx` (Dashboard→StartScreen, 한국어, A11y, Greenfield overlay) |
| MOD | `src/App.css` (디자인 토큰, .project-card) |
| MOD | `src/components/Icons.tsx` (7개 아이콘 추가) |
| MOD | `src/components/TitleBar.tsx` (한국어 breadcrumb) |
| MOD | `src/components/Markdown.tsx` (코드 복사 버튼) |
| MOD | `src/features/code/CodeWorkbench.tsx` (한국어 copy) |

---

## 검증 결과

| 검증 | 결과 |
|---|---|
| `cargo check` | ✅ 컴파일 성공 (기존 warning만) |
| `npx tsc --noEmit` | ✅ W6 관련 에러 0건 (기존 BottomDrawer 1건만) |
| specta 바인딩 생성 | ✅ 자동 생성 확인 (`saveBlueprint` 등 7종) |
