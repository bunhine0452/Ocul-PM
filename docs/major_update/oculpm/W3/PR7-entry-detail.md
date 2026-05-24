# W3-PR7 — `JournalEntryDetail` (디테일 패널 + 마크다운 렌더)

> **목표**: 선택된 entry 의 frontmatter 배지 + 본문 마크다운 + 액션 (verify / open / compare). 기존 `src/components/Markdown.tsx` 를 그대로 재사용 — 별도 마크다운 컴포넌트 만들지 않음.
> **선행**: W3-PR3 (`getJournalEntry`, `setJournalVerified`), W3-PR6 (selectedEntryPath context).
> **참조**: [`../phases/W3-journal-today-ui.md`](../phases/W3-journal-today-ui.md) §W3-PR7, [`../02-frontend.md`](../02-frontend.md) §7, [`../refactor-integration.md`](../refactor-integration.md) §I-4 (Markdown 재사용).

---

## 1. 구성 (계획)

```
JournalEntryDetail
├── DetailHeader
│   ├── FrontmatterBadges (type, status, difficulty, agent, session 링크, verified ✓/⚠)
│   └── TitleLine ("[x] Changelog Export 파라미터 불일치")
├── DetailBody
│   └── Markdown (재사용: src/components/Markdown.tsx)
└── DetailActions
    ├── [Verify ✓ / 미검증으로 되돌리기]   // 토글
    ├── [원본 파일 열기]                   // tauri-plugin-opener
    ├── [Compare with index]               // W4 까지 disabled, tooltip
    └── [복사 (markdown)]
```

---

## 2. Frontmatter 배지 (계획)

PR6 의 `JournalEntryCard` 의 배지 스타일과 동일 토큰을 사용 (페이즈 §3.4).

추가로 디테일에서만:
- `agent` 배지: `[agent: claude-code]` — `MessageCircle` 아이콘 + label.
- `session` 링크: 클릭 시 해당 SessionCard 펼치고 스크롤.
- `created_at` / `tz` 풀 표시 (예: `2026-05-24 09:25:13 KST`).
- `language` (en/ko/...) 작은 배지.
- frontmatter 깨진 경우: 빨간 ⚠ + 원본 YAML 보기 토글 (`raw_yaml` 표시).

---

## 3. 마크다운 렌더링 (계획)

**원칙**: `src/components/Markdown.tsx` 를 그대로 import. 별도 wrap 컴포넌트 만들지 말 것.

이 모듈은 refactor W6 (UI-7) 에서 `CodeBlockWrapper` 를 통해 코드블록 hover 시 📋 복사 버튼 + "복사됨" 피드백 1.5초를 이미 제공한다 ([refactor-integration §I-4](../refactor-integration.md)).

prop 시그니처가 부족한 경우 (예: 상대경로 이미지 base 해석) → **본 PR 은 prop 확장 안 함**. `Markdown.tsx` 에 prop 을 추가하는 별도 PR 로 분리하고 본 PR 은 그 PR 의 import 만 사용.

### body 안 상대경로 이미지

`./_attachments/...` → `.oculpm/journal/<workday>/_attachments/...` 를 base 로 해석.
- 변환: `Markdown` 의 transformLinkUri / transformImageUri prop 활용.
- Tauri `convertFileSrc` 로 안전 URL 생성.
- 미존재 이미지 → broken-image placeholder + 파일 경로 표시.

### XSS

`rehype-sanitize` 기본 schema 적용 (Markdown.tsx 가 이미 처리한다면 OK, 아니면 본 PR 에서 옵션 enable).
단일 사용자 / 로컬 only 환경이라 위험은 낮지만 default-safe.

---

## 4. 액션 (계획)

### Verify 토글

- 디스플레이: `verified_by_user` 가 true 면 "검증됨 ✓" / 클릭 시 "미검증으로 되돌리기".
- 동작: `oculpmApi.setJournalVerified(projectId, path, !currentVerified)`.
- 낙관적 UI: 즉시 토글, 실패 시 rollback + 토스트.
- frontmatter 깨진 entry → 버튼 disabled + tooltip "frontmatter 를 먼저 수정하세요".

### 원본 파일 열기

- `tauri-plugin-opener` 의 `openPath(absolutePath)`.
- 절대경로는 `projectRoot + '/.oculpm/journal/' + relative_path` 로 합성.
- 실패 (no editor associated) → 경로 복사 폴백 + 토스트.

### Compare with index

- W4 까지 disabled. 버튼 자체는 존재 (tooltip "다음 페이즈").
- W4 의 DiffVsNarrative 가 wire 시 활성화.

### 복사 (markdown)

- 전체 파일 (frontmatter + body) 을 clipboard 에.
- 토스트 "복사됨 (X bytes)".

---

## 5. 테스트 (계획)

- [ ] mock entry 정상 frontmatter → 본문 마크다운 렌더 (h2 / list / code block 확인).
- [ ] mock entry 깨진 frontmatter → 빨간 ⚠ + raw_yaml 토글.
- [ ] Verify 토글 클릭 → `setJournalVerified` 호출 + 낙관적 UI.
- [ ] Verify 토글 실패 (mock reject) → rollback + 토스트.
- [ ] [원본 열기] 클릭 → `openPath` 호출.
- [ ] body 안 `./_attachments/img.png` → `convertFileSrc` 결과 src 로 변환.
- [ ] [Compare with index] disabled 상태 + tooltip "다음 페이즈".

### 수동 QA (페이즈 §5 항목 4, 7)

- [ ] frontmatter 일부러 깨뜨림 → 카드 노란 dot + detail 의 빨간 ⚠ + 원본 보기 가능.
- [ ] verified 토글 → 파일 frontmatter 실제로 변경 (`cat` 확인).

---

## 6. DoD

- [ ] 본문에 코드 블록 / 리스트 / 이미지 정상 렌더.
- [ ] verified 토글 클릭 → frontmatter 파일 업데이트 + 카드 / 디테일 동시 반영.
- [ ] [원본 열기] 가 OS file manager 또는 에디터에서 열림.
- [ ] frontmatter 깨진 entry 도 본문은 보임.
- [ ] 별도 마크다운 컴포넌트 만들지 않음 (`Markdown.tsx` import 만).
- [ ] `pnpm test` 7+ 케이스 green.

---

## 7. 실행 노트 (작업 중 갱신)

### 의사결정 후보

1. **Verify 토글의 위치**: 헤더 우측 vs 액션 영역. 둘 다 두면 일관성 깨짐. → 액션 영역 1곳 + 카드 hover 의 빠른 토글 (PR6) 만.
2. **`Markdown.tsx` prop 확장이 필요한가**: 본 PR 시작 시 1) `transformImageUri` prop 존재 여부 확인 2) 없으면 별도 PR 분기.
3. **clipboard API**: Tauri 의 `clipboard` plugin vs 브라우저 `navigator.clipboard`. → Tauri 쪽이 일관.

### 발견된 함정 / 변경

(작성 중)

### 다음 PR 로 넘기는 메모

- W4 의 DiffVsNarrative 가 본 PR 의 [Compare with index] 자리에 wire.
- W4-PR4 의 `compare_layers` 커맨드가 본 패널의 우측에 inline diff 또는 별도 모달로 렌더.
- 본문 안 file_path 링크 (예: `src-tauri/src/db.rs:142`) → 미래 작업 (W6 후보): 클릭 시 IDE 열기.
