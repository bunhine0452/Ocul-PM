# 05. AssistPanel 삭제 + Terminal PiP 제거 + GitPanel Changelog 탭 제거

> **작업 ID**: W5 / 잔여 정리
> **일자**: 2026-05-21
> **참조**: MASTER-GUIDE §5.6 (PiP 안티패턴), §7.3 (W5 잔여)

---

## AssistPanel.tsx 삭제

`AiWorkbench` 의 Quick Edit 모드가 모든 기능 (input + 검색 + 영어 프롬프트
생성 + 오늘 변경 스캔 + Changelog 저장 CTA) 을 흡수했으므로 원본 파일 삭제.

- `src/features/assist/AssistPanel.tsx` 삭제
- `src/features/assist/` 디렉토리 삭제 (빈 폴더)
- `App.tsx` 의 import + 마운트 전부 제거 (UI-2 IA 통합과 함께)

남은 영향: 없음. 위 동선이 정확히 보존됨.

## Terminal PiP 제거

`src/features/terminal/TerminalPanel.tsx` 에서 PiP (floating draggable
overlay) 관련 코드 전부 제거:

- 제거된 상태: `position`, `isDragging`, `dragStart`, `posStart`
- 제거된 핸들러: `handleMouseDown`, mousemove/mouseup useEffect
- 제거된 localStorage 키: `terminalPipX`, `terminalPipY`
  (W1 의 마이그레이션이 이미 삭제했으므로 추가 정리 불필요)
- 제거된 props: `isPip`, `onTogglePip` (legacy compat 으로 optional `?` 표시,
  내부에서는 사용 안 함 — 호출자 정리 후 prop 자체도 제거 예정)
- 제거된 UI: PiP 토글 버튼 (Maximize/Minimize 아이콘), PiP 전용 CSS 클래스

유지된 것: Detach 윈도우 (별도 OS 윈도우로 분리) — `?window=terminal` URL
파라미터로 동작.

## GitPanel Changelog 탭 제거

`src/features/git/GitPanel.tsx` 에서 `"changelog"` view 제거:

- `GitView` 타입에서 `"changelog"` 멤버 제거
- TabBar 의 `CHANGELOG` 버튼 제거
- `ChangelogView` 함수 전체 (46 줄) 삭제
- 미사용 import (`ChangelogFile`) 제거

대체: 별도 최상위 Changelog 화면 (`/src/features/changelog/ChangelogScreen.tsx`,
W2/W4 에서 신설). 데이터 출처도 다름:
- 옛 GitPanel.Changelog: `read_changelog` (저장소 루트의 CHANGELOG.md 파일 파싱)
- 새 Changelog 화면: `list_changelog_by_day` (DB 의 LLM-생성 entries)

두 데이터 소스가 의미상 다르므로 통합하지 않고 *대체* — Keep-a-Changelog
형식 export 가 필요한 경우 새 화면의 Export → md 가 그 역할을 함.

## 결과

```
src/features/assist/    ← 삭제됨
src/features/code/      ← 신설 (ClarifyDialog, BottomDrawer, AiWorkbench, CodeWorkbench)
src/features/terminal/  ← PiP 코드 ~80 줄 삭제
src/features/git/       ← ChangelogView ~50 줄 삭제 + import 정리
```

총 ~130 줄 제거, ~1200 줄 신설 (W5 UI 컴포넌트 4 개 합).

## 검증

```
$ npx tsc --noEmit
exit=0
$ pnpm lint
✓ no direct localStorage access outside the allowlist
$ cd src-tauri && cargo check
warning: `ai-pm` (lib) generated 5 warnings, 0 errors
```
