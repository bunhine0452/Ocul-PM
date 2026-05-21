# 04. AssistPanel "Changelog 에 저장" 동선 + 골든 패스 검증

> **작업 ID**: W4 / UI-4
> **일자**: 2026-05-21
> **참조**: MASTER-GUIDE §7.3 ("e2e: 외부 수정 → 저장 → 타임라인 노출 골든 패스")

---

## 변경 요약

AssistPanel 의 "오늘 변경사항" 섹션 하단에 *Changelog 에 저장* CTA 추가.
변경사항이 감지되어 있을 때만 노출되며, 저장 성공 후 *타임라인에서 보기*
버튼이 등장해 한 번에 Changelog 화면으로 이동.

## 변경 파일

### `src/features/assist/AssistPanel.tsx`

1. **새 import**: `useWorkspace` (네비게이션용), `Save` 아이콘
2. **새 상태**:
   ```ts
   const [savingChangelog, setSavingChangelog] = useState(false);
   const [savedEntryId, setSavedEntryId] = useState<number | null>(null);
   ```
3. **새 핸들러**:
   ```ts
   async function handleSaveToChangelog() {
     const res = await commands.commitChangelogEntry(
       activeProjectId,
       userRequest.trim() || null,  // 의도
       null,                         // category (LLM 분류 위임)
       provider,
       model || FALLBACK_MODEL[provider],
     );
     if (res.status === "ok") setSavedEntryId(res.data.id);
   }
   ```
4. **상태 리셋**: `useEffect([activeProjectId])` 에 `setSavedEntryId(null)`
   추가 — 프로젝트 전환 시 다른 프로젝트의 success 카드가 따라오지 않게.
5. **UI 블록** (fileChanges.length > 0 일 때만):
   - savedEntryId == null → `[Changelog 에 저장]` 버튼 (full width, loading state)
   - savedEntryId != null → success 카드 + `[타임라인에서 보기]` 보조 버튼
   - 하단 hint: 같은 의도 중복 저장 경고

## 골든 패스 e2e 추적

마스터 가이드 §7.3 의 "외부 수정 → 저장 → 타임라인 노출" 흐름을 코드 레벨에서
끝까지 검증:

| # | 단계 | 코드 |
|---|---|---|
| 1 | 사용자가 외부 LLM (Claude Code 등) 으로 코드 수정 — 작업 트리 변경 | (외부) |
| 2 | AssistPanel 진입 (Code → Assist sub-tab) | `App.tsx` Workspace + codeSubTab="assist" |
| 3 | 마운트 시 `loadTodayChanges` → 오늘 변경 로드 | `useEffect([activeProjectId])` |
| 4 | "변경사항 스캔" 클릭 → `detect_file_changes` → file_changes 행 생성 | `handleScanChanges` |
| 5 | "Changelog 에 저장" 클릭 → `commit_changelog_entry` | `handleSaveToChangelog` |
| 6 | 백엔드: `git diff_stat` → `git diff_patch` → LLM 요약 → entry+files insert | `commands::changelog::commit_changelog_entry` |
| 7 | 성공 → savedEntryId 업데이트, success 카드 노출 | React state |
| 8 | "타임라인에서 보기" 클릭 → `setActiveView("changelog")` | `useWorkspace().setActiveView` |
| 9 | ChangelogScreen 마운트 → `listChangelogByDay(30)` 호출 | `useEffect([])` |
| 10 | 새 entry 가 오늘 버킷 최상단에 노출 (DESC 정렬) | `list_changelog_entries` ORDER |
| 11 | 사용자가 entry 클릭 → `getChangelogDetail` → EntryDetail 표시 | `useEffect([selectedEntryId])` |
| 12 | 파일 행 클릭 → DiffModal 라인 단위 표시 | `DiffModal` |
| 13 | (선택) Flame 아이콘 클릭 → `pinChangelog` → Today 의 pinned_entries 에 반영 | `daily_brief` |

## 발견된 작은 이슈 + 수정

1. **stale success 카드**: 다른 프로젝트로 전환해도 `savedEntryId` 가 남아
   "이미 저장됨" 처럼 보였음. → `useEffect([activeProjectId])` 에서 리셋.

## 알려진 제약 (정상 동작)

- **git 저장소가 아닐 때**: `git diff_stat` 실패 → 에러 메시지 표시.
  비-git 프로젝트의 diff 폴백 (`file_snapshots`) 은 별도 마이그레이션 010
  영역, 향후 작업.
- **작업 트리가 깨끗할 때**: `commit_changelog_entry` 가 "No uncommitted
  changes detected" 반환. CTA 클릭 시 빨간 에러 박스 표시.
- **중복 저장**: 같은 의도로 두 번 클릭하면 두 entry 가 생성됨. 하단
  안내 문구로 사용자에게 위임.

## 검증

```
$ cd src-tauri && cargo check
warning: 5 warnings (변화 없음), errors: 0
$ npx tsc --noEmit
exit=0
$ pnpm lint
✓ no direct localStorage access outside the allowlist
```

13 단계 골든 패스의 모든 코드 경로가 컴파일·타입체크 통과. 실 LLM 호출은
실 키 + 실 git 저장소가 있는 dev 런 환경에서 수동 확인 필요.
