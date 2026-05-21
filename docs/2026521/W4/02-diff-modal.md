# 02. DiffModal.tsx — 라인 단위 diff 표시

> **작업 ID**: W4 / UI-4
> **일자**: 2026-05-21
> **참조**: MASTER-GUIDE §5.5 ("파일별 변경 행 클릭 → diff modal")

---

## 변경 요약

ChangelogEntry 의 파일 행을 클릭하면 라인 단위로 색상 처리된 unified diff 를
모달로 표시. 코드 본문은 백엔드 `commit_changelog_entry` 가 저장한 `diff_patch`
컬럼을 그대로 사용.

## 신규 파일

### `src/features/changelog/DiffModal.tsx`

구조:
1. **헤더**: 파일 경로 · `+N/-M` · change_type 배지 · 복사 · 닫기
2. **요약 바**: `per_file_summary` 가 있으면 secondary bg 로 표시
3. **본문**: `parseDiff()` 가 줄 단위 분류 → table 로 렌더

분류:

| kind | 매칭 | 표시 |
|---|---|---|
| `meta`  | `diff `, `index `, `+++`, `---`, `new file`, `deleted file` | dim italic |
| `hunk`  | `@@` 시작 | secondary bg · bold |
| `add`   | `+` 시작 | 녹색 bg + 텍스트 |
| `del`   | `-` 시작 | 적색 bg + 텍스트 |
| `ctx`   | 그 외 | 일반 텍스트 |

마커 컬럼 (`+` / `−` / 공백) 은 별도 셀로 렌더 — 본문 텍스트와 시각 분리.

### 동작

- Esc 키로 닫기 (`useEffect` 키 리스너)
- 백드롭 클릭으로 닫기
- 복사 버튼 → `navigator.clipboard.writeText(diff_patch)`

### Empty state

`diff_patch` 가 비어있을 때 (`deleted`, `created`, 바이너리) 친절한 안내:

```
파일이 삭제되어 본문이 없습니다.   ← change_type=deleted
신규 파일 — 전체 내용이 added 로 표시되어야 합니다.   ← change_type=created
diff 본문이 비어있습니다.   ← 그 외
```

## 설계 결정

- **syntax highlighting 없음**: diff_patch 는 *언어 모름* 인 상태로 truncate
  될 수 있어 (64KB cap) 토큰화 실패 케이스가 잦다. W7 polish 에서 hljs
  통합 검토.
- **table 렌더링**: 가변 폭 마커 + 가변 텍스트를 정렬하기에 `<table>` 이
  flex/grid 보다 간단. 폭 제한은 마커 6px 고정.
- **`whitespace-pre-wrap break-all`**: 긴 한 줄 (minified) 도 모달 밖으로
  넘치지 않게.
- **모달 z-index 95**: Settings overlay (90) 보다 위. 동시에 뜰 일은 없지만
  레이어 순서 안전.

## 검증

`tsc --noEmit` exit 0. 사용자 동선:
1. Changelog 에서 entry 클릭 → EntryDetail
2. 파일 행 클릭 → DiffModal 등장 → 라인 색상 표시
3. Esc 또는 백드롭 클릭 → 닫힘
