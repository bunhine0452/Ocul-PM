# B1 저장 시 정리 · B2 자동 저장

> [00-master-plan.md](00-master-plan.md) 의 Phase 1. 둘은 같은 저장 경로를 고치므로 한 문서다.
> 근거: `vscode/src/vs/workbench/contrib/codeEditor/browser/saveParticipants.ts` ·
> `vscode/src/vs/workbench/contrib/files/browser/files.contribution.ts`

## 지금 상태

`CodePane.tsx` 의 `save()` (현재 707행)가 저장의 유일한 입구다.

```
save(baseHashOverride?)
  ├ 미저장 아님 / 저장 중이면 no-op
  ├ codeFormatOnSave → formatRef.current(true)      // 쓰기 **전에** 다듬는다
  ├ commands.codeWrite(pid, path, restoreEol(buf.text, buf.eol), baseHash)
  ├ ok(saved)     → applySaved(path, hash)
  └ ok(conflict)  → setConflict({ diskHash })       // 충돌 배너
```

부르는 곳: CM 키맵 ⌘S → `onSave`, 창 레벨 ⌘S(포커스된 창만), 툴바 핸들(`CodePaneHandle.save`),
충돌 배너의 "덮어쓰기"(`overwriteDisk` → `save(diskHash)`).

## B1 — 저장 시 정리

### 무엇

저장 직전, 쓰기 전에 버퍼 본문을 다듬는다. VS Code 의 save participant 3종을 그대로 가져온다.

| 설정(우리) | VS Code | 동작 |
|---|---|---|
| `codeTrimTrailingWhitespace` | `files.trimTrailingWhitespace` | 각 줄 끝의 공백·탭 제거 |
| `codeInsertFinalNewline` | `files.insertFinalNewline` | 파일이 개행으로 끝나게 |
| `codeTrimFinalNewlines` | `files.trimFinalNewlines` | 끝의 빈 줄을 하나만 남김 |

전부 기본 **꺼짐** (D1).

### 설계

새 순수 모듈 `src/features/code/saveHygiene.ts`:

```ts
export interface HygieneOptions {
  trimTrailingWhitespace: boolean;
  insertFinalNewline: boolean;
  trimFinalNewlines: boolean;
  /** 자동 저장이면 이 줄(1-based)들은 건드리지 않는다. 수동 저장이면 빈 배열. */
  protectedLines: readonly number[];
}
export function applyHygiene(text: string, o: HygieneOptions): string;
```

규칙(전부 LF 정규화된 버퍼 기준 — `restoreEol` 은 그 뒤에 걸린다):

1. `trimTrailingWhitespace` — `line.replace(/[ \t]+$/, "")`. **`protectedLines` 의 줄은 제외.**
   VS Code 가 자동 저장일 때만 커서 줄을 살려 두는 이유가 그대로 우리에게도 적용된다
   (`saveParticipants.ts:60` `doTrimTrailingWhitespace(model, isAutoSaved, …)` — `isAutoSaved`
   일 때만 cursors 를 모아 그 줄을 보호한다: "to avoid having the cursors jump"). 들여쓰기를
   치고 잠깐 멈춘 순간 자동 저장이 그 공백을 먹으면 커서가 줄 앞으로 튄다.
2. `trimFinalNewlines` — 마지막 비어 있지 않은 줄 뒤의 빈 줄을 제거하되, 자동 저장이면
   `protectedLines` 의 최대 줄 번호 아래로는 자르지 않는다 (`doTrimFinalNewLines` 의
   `cannotTouchLineNumber`). 파일 전체가 빈 줄이면 손대지 않는다.
3. `insertFinalNewline` — 본문이 비어 있지 않고 `\n` 으로 끝나지 않으면 하나 붙인다.
   2와 함께 켜면 순서는 **trim → insert** (VS Code 와 같다: 끝을 하나로 정규화).

### 배선

`CodePane.tsx`:

- `save()` 안, 포맷 뒤·`codeWrite` 앞에서 `applyHygiene` 을 돌린다. 결과가 원본과 다르면
  `replaceBufferText(next)` 로 버퍼를 갈아끼운다 — **이미 있는 함수**다(포맷팅이 쓰는 것,
  에디터를 `editorEpoch` 로 재마운트하고 보던 줄을 `pendingJump` 로 복원한다).
- 왜 "쓰고 나서" 가 아니라 "쓰기 전" 인가: `codeFormatOnSave` 주석에 이미 답이 있다 —
  쓴 뒤에 고치면 저장 직후 다시 dirty 가 되어 무엇이 디스크에 있는지 알 수 없다.
- `protectedLines`: 수동 저장이면 `[]`, 자동 저장이면 `[cursorRef.current.line]`.
  (선택 영역까지 보호하려면 CM 의 모든 selection 이 필요하지만, 우리 `onCursor` 는 주
  커서만 올린다 — 자동 저장 보호에는 주 커서 한 줄이면 충분하다. 다중 커서 편집 중의
  자동 저장은 드물고, 최악이 "빈 공백이 지워진다" 다.)

### 실패 모드

- **거대한 diff**: 후행 공백이 흔한 레거시 파일을 처음 저장하면 파일 전체가 바뀐다.
  → 기본 꺼짐이고, 설정 설명에 "이미 있는 파일 전체가 한 번 바뀔 수 있다" 를 적는다.
- **CRLF**: 정리는 LF 정규화 버퍼에서 하고 `restoreEol` 이 그대로 뒤에 붙으므로 영향 없다.
  `code_screen.test.tsx` 의 CRLF 왕복 테스트가 이미 이 경로를 잠근다.
- **마크다운의 의미 있는 후행 공백**(줄 끝 두 칸 = 강제 개행): VS Code 도 `[markdown]`
  언어별 오버라이드로 끈다. 우리는 언어별 설정 축이 없으므로 **`.md`·`.markdown` 은
  `trimTrailingWhitespace` 대상에서 뺀다** (하드코딩, `saveHygiene.ts` 안의 상수).

## B2 — 자동 저장

### 무엇

`codeAutoSave` = `"off" | "afterDelay" | "onFocusChange"` (기본 `"off"`),
`codeAutoSaveDelay` = ms (기본 1000 — VS Code `files.autoSaveDelay` 기본과 같다).

VS Code 의 `onWindowChange` 는 넣지 않는다: Tauri 창 blur 는 트레이·터미널 창으로 옮길 때도
나서 "창을 떠났다" 의 의미가 흐리다. `onFocusChange`(다른 탭/파일로 이동, 에디터에서
포커스가 나감)가 그 값의 대부분을 준다.

### 왜 이 앱에서 특히 필요한가

사용자가 고치다 저장을 잊고 에이전트에게 "이 파일 봐" 라고 시키면, 에이전트는 **디스크**를
읽는다 — 화면의 내용과 다른 것을 읽고, 그 위에 작업하고, 그 결과가 충돌로 돌아온다.
일반 편집기의 자동 저장은 편의지만 여기서는 **정합성**이다.

### 설계

`CodePane.tsx` 안에 자동 저장 훅 하나(`useAutoSave`, 같은 파일 하단 또는 `useAutoSave.ts`):

```
트리거
  afterDelay      : handleChange 마다 타이머 리셋 → delay 뒤 saveRef.current({ auto: true })
  onFocusChange   : 활성 경로 변경(useEffect cleanup) · 이 창이 포커스를 잃음(isFocused false)
                    · CM blur
공통 게이트 (하나라도 걸리면 조용히 건너뛴다)
  · 버퍼 없음 / clean
  · savingRef.current (저장 진행 중)
  · conflict != null        ← 충돌 배너가 떠 있는 동안 자동으로 덮어쓰지 않는다 (D7)
  · diffMode != null        ← 인라인 비교 중에는 사용자가 읽는 중이다
  · fileView.kind !== "editor"
```

`save()` 시그니처를 `save(opts?: { baseHash?: string; auto?: boolean })` 로 넓힌다
(현재는 `baseHashOverride?: string` 위치 인자 하나 — 부르는 곳 4군데를 함께 고친다).

`auto: true` 일 때 달라지는 것 **두 가지뿐**:

1. **포맷을 건너뛴다.** VS Code 가 정확히 그렇게 한다 (`saveParticipants.ts:230`
   `if (context.reason === SaveReason.AUTO) return;`). 타자 도중 1초마다 포매터가 도는 것은
   편집기가 아니라 방해다.
2. **정리는 커서 줄을 보호한다** (B1 의 `protectedLines`).

그리고 실패 표시가 다르다: 자동 저장이 충돌하면 **토스트를 띄우지 않고** 충돌 배너만 남긴다
(사용자가 요청하지 않은 동작이 토스트를 쏘면 소음이다). 쓰기 자체가 실패하면(권한 등)
한 번만 알린다 — 같은 경로에서 반복 실패 시 토스트를 억제(`goneNotifiedRef` 와 같은 부기).

### 상태줄

`code-status-dirty` 조각이 지금 `● 미저장 / ○ 저장됨` 이다. 자동 저장이 켜져 있으면
`○ 자동 저장` 으로 바꾸고, 저장이 도는 순간 잠깐 `저장 중…`. 사용자가 ⌘S 습관을 버려도
되는지 알 방법이 이것뿐이다.

### 실패 모드

- **워처 에코 루프**: 자동 저장 → 워처가 변경 감지 → 리로드 → …. 이미 막혀 있다
  (`res.data.hash === buf.baseHash` 면 자기 저장의 에코로 보고 무시). 자동 저장이
  빈도만 올릴 뿐 경로는 같다.
- **에이전트와의 경합**: 에이전트가 그 파일을 고치는 중이면 `base_hash` 가 어긋나
  충돌 배너가 뜬다 — 자동 저장이 남의 작업을 덮는 경로는 없다.
- **자동 색인 폭풍**: 저장마다 워처가 증분 색인을 예약한다. 이미 해시 동일이면 건너뛰고
  (dogfooding 2026-06-15 의 권한 프롬프트 fix), `afterDelay` 기본 1000ms 는 타자 도중이
  아니라 멈춘 뒤 1회다. 그래도 delay 하한을 **250ms** 로 강제한다.

## 파일별 변경

| 파일 | 변경 |
|---|---|
| `src/features/code/saveHygiene.ts` | 신규 — `applyHygiene` (순수) |
| `src/features/code/CodePane.tsx` | `save(opts)` 로 확장 · 정리 훅 · 자동 저장 훅 · 상태줄 문구 |
| `src/lib/settings.ts` | `KEYS`/`Settings`/`DEFAULTS` 에 5개 (`codeTrimTrailingWhitespace`, `codeInsertFinalNewline`, `codeTrimFinalNewlines`, `codeAutoSave`, `codeAutoSaveDelay`) |
| `src/features/settings/CodeSettings.tsx` | 토글 3 + 선택 1 + 숫자 1 |
| `src/i18n/ko.ts` · `en.ts` | 설정 라벨·설명, 상태줄 문구 |
| `src/__tests__/code_save_hygiene.test.ts` | 신규 — 순수 함수 |
| `src/__tests__/code_screen.test.tsx` | 자동 저장·정리 통합 |

## 테스트

**순수(`applyHygiene`)** — 후행 공백 제거 · 보호 줄 유지 · 끝줄 삽입 · 끝 빈 줄 정리 ·
셋 조합 순서 · 빈 파일 · 공백만 있는 파일 · `.md` 예외 · 이미 정돈된 본문은 **같은 문자열
그대로**(불필요한 재마운트를 만들지 않는다는 계약).

**통합(`code_screen.test.tsx`)** — ① 정리 켜고 저장하면 `code_write` 에 다듬어진 본문이
간다. ② 자동 저장 `afterDelay`: `vi.useFakeTimers()` 로 편집 → 시간 진행 → 쓰기 1회.
③ 충돌 배너가 떠 있으면 자동 저장이 쓰지 않는다. ④ 자동 저장은 포맷을 부르지 않는다
(포맷 목의 호출 수 0). ⑤ 수동 ⌘S 는 예전 그대로(회귀).
