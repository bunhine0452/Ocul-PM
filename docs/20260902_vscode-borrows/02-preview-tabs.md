# B3 미리보기 탭

> [00-master-plan.md](00-master-plan.md) 의 Phase 2.
> 근거: `vscode/src/vs/workbench/browser/workbench.contribution.ts` (`workbench.editor.enablePreview`
> 외 2)

## 지금 상태

`codeTabs.ts` 의 `openFile(state, path, pane)` 은 **항상 탭을 하나 늘린다.** 트리에서 파일
20개를 훑으면 탭이 20개가 되고, 전역 검색 결과를 따라가면 더 빨리 는다. 지금 그걸 되돌리는
수단은 탭을 하나씩 닫거나 "다른 탭 모두 닫기" 뿐이다.

## 무엇

창(pane)마다 **미리보기 탭 한 자리**를 둔다. 미리보기로 열린 파일은 기울임으로 그려지고,
다음에 미리보기로 여는 파일이 **그 자리를 차지한다**. 고정(pin)되는 순간 보통 탭이 된다.

VS Code 의 기본값을 그대로 따른다:

| 여는 경로 | VS Code 기본 | 우리 |
|---|---|---|
| 탐색기 단일 클릭 | 미리보기 (`enablePreview: true`) | 트리 단일 클릭 → 미리보기 |
| 탐색기 더블 클릭 | 고정 | 트리 더블 클릭 → 고정 |
| Quick Open(⌘P) | 고정 (`enablePreviewFromQuickOpen: false`) | ⌘K 팔레트·전역 검색 → 고정 |
| 코드 이동(정의로 가기 등) | 고정 (`enablePreviewFromCodeNavigation: false`) | F12·참조·코드맵·일지 → 고정 |
| 편집 | 고정으로 승격 | 같음 |

즉 **미리보기로 여는 입구는 트리 단일 클릭 하나뿐**이다. "훑어보기" 가 일어나는 자리가
거기이고, 나머지는 전부 "이걸 하려고 왔다" 는 신호다. (설정 하나 `codePreviewTabs`,
기본 **켜짐** — 이건 D1 의 예외다. 지금 동작을 유지하는 쪽이 "탭이 계속 쌓인다" 이고,
그건 유지할 가치가 없는 동작이다. 끄면 예전 그대로가 되도록 설정을 남긴다.)

## 설계

### 상태

`CodePaneTabs` 에 필드 하나:

```ts
export interface CodePaneTabs {
  tabs: string[];
  active: string | null;
  /** 이 창의 미리보기 탭. `tabs` 안에 있거나 null. */
  preview: string | null;   // ← 신규
}
```

순수 함수(전부 `codeTabs.ts`, 기존 함수 시그니처는 유지):

```ts
openFile(state, path, pane, opts?: { preview?: boolean })
  · preview: true  → 기존 미리보기 탭을 **교체**한다 (자리 이동 없음: 같은 index 에 새 경로)
                     단 그 파일이 이미 열려 있으면 활성화만 (미리보기 자리 그대로)
                     교체 대상이 dirty 면 교체하지 않고 새 탭으로 연다  ← 아래 결정 참고
  · preview: false → 지금과 같다. 그 경로가 미리보기였다면 preview 를 null 로 (승격)
pinTab(state, pane, path)        // 더블클릭 · 편집 · 드래그 · 컨텍스트 메뉴 "고정"
previewPath(state, pane)         // 렌더용 셀렉터
```

`sanitizeTabs` 는 `preview` 를 검증한다: 문자열이 아니거나 `tabs` 에 없으면 `null`.
(영속된 예전 JSON 에는 필드가 없다 — `undefined` → `null`.)

### 고정 승격의 5가지 계기

1. 탭 더블 클릭 (`CodeTabsBar` 의 탭 `onDoubleClick`)
2. 트리 항목 더블 클릭
3. **편집** — `CodePane.handleChange` 에서 첫 변경 시 `onPinTab(path)` (dirty 로 바뀌는
   그 순간 1회, 이미 고정이면 no-op)
4. 탭을 다른 창으로 드래그/이동 (`moveTabToOtherPane`)
5. 탭 컨텍스트 메뉴의 새 항목 "고정" (`CodeContextMenu`)

VS Code 와 같은 목록이다. 3번이 핵심이다 — 미리보기로 연 파일을 고치기 시작했는데 다음
클릭에 사라지면 그건 데이터 손실처럼 느껴진다(버퍼는 남지만 화면에서 사라진다).

### 결정 — dirty 미리보기 탭은 교체하지 않는다

3번이 있으므로 원칙적으로 dirty 인 미리보기 탭은 존재할 수 없다. 그래도 방어한다:
`openFile(preview)` 는 교체 대상이 dirty 면 **교체를 포기하고 새 탭을 만든다.** 미저장
편집이 화면에서 사라지는 경로를 코드 수준에서 0으로 만든다. (`dirtyPaths` 는 이미
`CodeScreenV2` 가 들고 `CodePane` 에 내려보내는 값이라 순수 함수 인자로 넘기면 된다.)

### 렌더

- `CodeTabsBar`: `preview === path` 면 `.code-tab.preview` (font-style: italic). 아이콘·닫기
  버튼은 그대로. `title` 에 "더블클릭하면 고정됩니다" 를 붙인다.
- 미저장 점(dirty)과 기울임이 동시에 뜨는 일은 위 결정 때문에 사실상 없다.

## 파일별 변경

| 파일 | 변경 |
|---|---|
| `src/features/code/codeTabs.ts` | `preview` 필드 · `openFile` opts · `pinTab` · `sanitizeTabs` |
| `src/features/code/CodeScreenV2.tsx` | `openPath(…, { preview })` 배선 · 트리 단일/더블 클릭 분기 · `onPinTab` 내려보내기 |
| `src/features/code/CodeTree.tsx` | 더블 클릭 핸들러 (단일 클릭은 지금 그대로) |
| `src/features/code/CodePane.tsx` | 첫 편집 시 고정 · 탭 더블클릭 → 고정 |
| `src/features/code/CodeTabsBar.tsx` | 기울임 · 더블클릭 · 컨텍스트 메뉴 "고정" |
| `src/features/code/CodeContextMenu.tsx` | 항목 1개 |
| `src/features/code/code.css` | `.code-tab.preview { font-style: italic }` |
| `src/lib/settings.ts` · `CodeSettings.tsx` | `codePreviewTabs` (기본 true) |
| `src/i18n/*` | 라벨 3 |
| `src/__tests__/code_tabs.test.ts` | 순수 함수 |

## 테스트 (`code_tabs.test.ts`)

- 미리보기로 두 파일을 연속으로 열면 **탭은 하나**, 경로만 바뀐다.
- 이미 열린(고정) 파일을 미리보기로 열면 활성화만 되고 미리보기 자리는 그대로다.
- 편집(=`pinTab`) 후 다른 파일을 미리보기로 열면 **둘 다 남는다**.
- dirty 인 미리보기 탭은 교체되지 않는다(방어).
- `preview` 인 탭을 닫으면 `preview` 가 `null` 이 된다.
- 다른 창으로 옮기면 고정된다.
- `sanitizeTabs`: `preview` 가 `tabs` 밖이면 `null`, 필드가 없는 예전 JSON 도 받는다.
- 분할/합치기(`splitEditor`/`unsplitEditor`)에서 `preview` 가 창을 넘어가지 않는다 —
  합칠 때는 첫 창의 것만 남긴다.
