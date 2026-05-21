# 03. EntryDetail 분리 + 검색 + Export 메뉴

> **작업 ID**: W4 / UI-4
> **일자**: 2026-05-21
> **참조**: MASTER-GUIDE §5.5

---

## 변경 요약

W2 의 ChangelogScreen 최소 버전을 분해해 정식 버전으로 승격:
- 우측 디테일 패널을 `EntryDetail.tsx` 컴포넌트로 추출
- 헤더에 텍스트 검색 input
- Export 드롭다운 (Markdown / JSON)
- 공통 헬퍼 (`CategoryChip`, `truncate`) 를 `util.tsx` 로 분리

## 신규 파일

### `src/features/changelog/EntryDetail.tsx`

기존 우측 패널 JSX 를 들어내 컴포넌트로 추출. 추가된 것:
- **DiffModal 통합**: 파일 행을 `<button>` 으로 바꾸고 클릭 시 `<DiffModal>` open
- **고정 토글의 비동기 처리**: `pinPending` 로 중복 클릭 방지
- **원본 영어 프롬프트 노출** (`prompt_text`): `<details>` 로 접어두기 (감사 추적용)
- `onChange?: (updated) => void` 콜백으로 부모(ChangelogScreen) 의 buckets 와
  동기화 — pin/unpin 후 리스트의 아이콘이 즉시 갱신됨.

### `src/features/changelog/util.tsx`

`CategoryChip` + `truncate` 헬퍼. ChangelogScreen / EntryDetail / TodayScreen
이 모두 사용. 중복 정의가 드리프트하는 걸 막기 위해 한 곳에 모음.

## 수정 파일

### `src/features/changelog/ChangelogScreen.tsx`

전면 재작성. 주요 변경:

1. **검색 input** (상단, 카테고리 chips 옆):
   ```ts
   const filtered = buckets.map(b => ({...b, entries: b.entries.filter(e => {
     const hay = [e.title, e.ai_summary, e.user_intent, e.category].join(" ").toLowerCase();
     return hay.includes(q);
   })})).filter(b => b.entries.length > 0)
   ```
   카테고리 → 검색 순으로 파이프라인. 빈 버킷은 떨어뜨림.

2. **Export 드롭다운**:
   ```ts
   async function doExport(kind: "md" | "json") {
     const content = kind === "md"
       ? (await commands.exportChangelogMarkdown(pid, null, null)).data
       : JSON.stringify({ exported_at, buckets }, null, 2);
     const blob = new Blob([content], { type: kind === "md" ? "text/markdown" : "application/json" });
     const url = URL.createObjectURL(blob);
     const a = document.createElement("a");
     a.href = url; a.download = `changelog-${stamp}.${kind}`;
     a.click();
     URL.revokeObjectURL(url);
   }
   ```
   브라우저 blob 다운로드 사용 — `@tauri-apps/plugin-dialog`/`-fs` 회피.
   JSON 은 in-memory buckets 를 직렬화 (백엔드 round-trip 불필요).

3. **EntryDetail 위임**: 우측 패널 100+ 줄을 `<EntryDetail entry={} files={} onChange={applyEntryUpdate}/>` 한 줄로 축약.

4. **`applyEntryUpdate`**: pin 토글 결과를 detail + buckets 양쪽에 반영하는
   업데이트 함수.

5. **새 헤더 레이아웃**: `flex flex-wrap items-center gap-3` — 좁은 화면에서
   검색바가 다음 줄로 떨어짐.

## 설계 결정

- **검색은 클라이언트 사이드**: 일별 버킷 1000 entry 캡 안에서는 indexedDB
  까지 안 필요. SQL `LIKE` 도 가능하지만 화면 즉시 반응 (debounce 없이) 이
  더 자연스러움.
- **JSON export 는 in-memory 데이터로**: 백엔드 새 커맨드를 더 만들 만한
  가치가 없음. 사용자가 같은 화면에서 보는 데이터를 그대로 받는 게 일관됨.
- **`util.tsx` (.tsx 확장자)**: `CategoryChip` 이 JSX 반환 — `.ts` 가 아닌 `.tsx`.
- **EntryDetail 의 `onChange` prop**: 부모가 상위 list 까지 갱신 책임을
  가짐. 이로써 EntryDetail 자체는 read-only 의 깔끔한 시그니처를 유지.
- **`details/summary` 로 prompt_text 숨김**: 영어 프롬프트는 길어서 기본
  노출하면 산만함. *원할 때만 펴 보는* 방식이 §5.5 의 "원본 프롬프트" 버튼과
  의도 동일.

## 검증

```
$ npx tsc --noEmit
exit=0
$ pnpm lint
✓ no direct localStorage access outside the allowlist
```

수동 검증 (다음 dev 런):
- 좌측 entry 클릭 → EntryDetail 표시
- 검색에 "OAuth" → 매칭 버킷만 노출, 카테고리 chip 과 AND 조건
- Export → md → 파일 다운로드, Keep-a-Changelog 형식
- Export → json → 시간 기록 + 버킷 raw 데이터
- 파일 행 클릭 → DiffModal 등장, +/-/context 색상 구분
