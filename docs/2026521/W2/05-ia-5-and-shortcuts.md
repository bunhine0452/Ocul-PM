# 05. IA 5단 통합 + 단축키 + Settings/Diagnostics 통합

> **작업 ID**: W2 / UI-2 (전체)
> **일자**: 2026-05-21
> **참조**: MASTER-GUIDE §5.1 (새 IA), §6.2 (chrome), §부록 A

---

## 변경 요약

기존 9 (+ W3 에서 추가된 2 = 11) 개의 IDE-식 탭을 PM 내러티브 5 단으로
통합. Code 탭이 옛 Files/Chat/Assist/Graph/Terminal/Git 을 sub-tab 으로
흡수. Settings 모달 폐기 → 풀 오버레이로 ⌘, 단축키 접근. Diagnostics 는
Settings 의 마지막 탭으로 흡수.

## IA 매핑

| 기존 9 탭 | 새 5 IA |
|---|---|
| Files | Code → Files |
| Chat | Code → Chat |
| Assist | Code → Assist |
| Graph | Code → Graph |
| Terminal | Code → Terminal (sub-tab) |
| Git | Code → Git |
| Planner | Plan |
| Settings | (모달 → ⌘, 풀 오버레이로 승격) |
| Diagnostics | Settings 의 마지막 탭으로 흡수 |
| (+) Overview (W3 추가) | Overview |
| (+) Today (W3 추가) | Today |

새 primary sidebar:

| 위치 | IA | 단축키 |
|---|---|---|
| 1 | Overview | ⌘1 |
| 2 | Today | ⌘2 |
| 3 | Plan | ⌘3 |
| 4 | Changelog | ⌘4 |
| 5 | Code | ⌘5 |

Code 탭 내부에 12 px 폭의 secondary sidebar 가 나타나 6 개 sub-tab 노출.
(UI-5 / W5 에서 통합 워크벤치로 흡수될 *과도기 구조*)

## 신규 컴포넌트

### `src/components/CommandPalette.tsx`

`cmdk` 기반. 그룹별로 명령 노출:
- **이동**: 5 개 IA + ⌘1~⌘5 표시
- **Code 화면**: 6 개 sub-tab 으로 점프
- **액션**: Settings 열기 / 재인덱싱 / Overview 재생성

특징:
- `keywords` prop 으로 한/영 alias fuzzy 매칭 ("체인지로그" → Changelog)
- `filter` 를 커스터마이즈해 alias 도 검색 대상에 포함
- `aria-selected` 상태로 키보드 네비게이션
- 배경 클릭 = 닫기, Esc = 닫기

### `src/hooks/useGlobalShortcuts.ts`

전역 keydown 리스너 한 곳에서 모든 단축키 처리:

| 키 | 액션 |
|---|---|
| `⌘K` / `Ctrl+K` | Command Palette 열기 |
| `⌘,` / `Ctrl+,` | Settings 오버레이 열기 |
| `⌘1`~`⌘5` | IA 5 화면 전환 |
| `⌘\` | AI Workbench 토글 (state 만; UI-5 정식 도입 전 임시) |
| `⌘J` | Bottom Drawer 토글 (state 만) |

⌘ / Ctrl 둘 다 인식. 텍스트 입력 중에도 가로채는 정책 — 사용자가 input
focus 안에서도 팔레트/설정 부르고 싶을 수 있음.

### `src/features/changelog/ChangelogScreen.tsx`

W4 정식 화면의 *최소 버전*:
- 좌측 320px: 날짜 버킷 (각 entry 카드)
- 우측: 선택된 entry 의 디테일 (title / 의도 / AI 요약 / 파일별 변경)
- 상단 헤더: 카테고리 chip 7 개 + 기간 토글 (7/30/90일)
- 핀 토글 작동
- 풀 diff modal / 검색 / Export 는 W4 에서 추가

## 수정 파일

### `src/App.tsx` (전면 재작성)

- WorkspaceContext 흡수 (06 문서)
- 5-IA primary sidebar
- Code 탭 내부 secondary sidebar
- Settings 모달 → 풀 오버레이 (`SettingsOverlay` 컴포넌트)
- Rename/Delete 다이얼로그는 `<Dialog>` helper 로 추출
- 글로벌 overlay: `<CommandPalette>` + `<SettingsOverlay>`

### `src/features/settings/SettingsPanel.tsx`

- `TabId` 에 `"diagnostics"` 추가
- `TABS` 마지막 항목으로 노출
- `DiagnosticsTab` + `Stat` 컴포넌트 신설 — DB health 표시 + Refresh 버튼

### `src/components/CommandPalette.tsx` 등 신규 파일 추가.

### `package.json`

- `cmdk@^1.1.1` 추가

## 설계 결정

- **Settings 모달 → 풀 오버레이**: 모달이 작아 6 개 탭이 가로로 답답함.
  85vh × 4xl 오버레이가 Linear-style 의 정돈된 인상.
- **⌘, 만으로 진입**: 사이드바 하단의 gear 아이콘은 유지 (마우스 사용자
  배려). 키보드 사용자는 ⌘, 직행.
- **Code sub-tab 을 컨텍스트에 저장**: 사용자가 Plan → Code 로 돌아왔을 때
  마지막으로 보던 sub-tab 복원. UI-5 의 통합 워크벤치가 들어오기 전까지의
  실용 타협.
- **단축키가 input focus 도 가로채기**: Palette/Settings 는 *escape hatch*
  성격이라 어디서든 접근 가능해야 함. ⌘1~⌘5 의 화면 전환도 동일.
- **`⌘N` 은 미구현**: §부록 A 에 있으나 Plan 화면이 직접 처리하는 게 자연스러움.
  Plan 화면에 위임 (현재 PlannerPanel 이 자체 단축키 핸들러를 가질 수 있음).
  필요해지면 후속 PR.
- **Terminal PiP 제거**: §5.6 결정. App.tsx 의 TerminalPanel mount 에서
  `isPip={false}` 고정. Detach 윈도우는 유지.

## 검증

```
$ npx tsc --noEmit
exit=0
$ pnpm lint
✓ no direct localStorage access outside the allowlist
$ cd src-tauri && cargo check
warning: 5 warnings (변화 없음)
errors: 0
```

수동 테스트 (다음 dev 런에서):
- 사이드바에 5 개 primary 아이콘만 보임 (+ gear)
- ⌘K → 팔레트 열림, "체인지로그" 검색 → Changelog 항목 강조
- ⌘1~⌘5 로 화면 즉시 전환
- ⌘, → Settings 오버레이, Diagnostics 탭이 마지막에 있음
- Code 탭 진입 시 12px secondary sidebar 등장, sub-tab 전환 가능
- 새로고침 후 마지막 활성 view + sub-tab 복원
