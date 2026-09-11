// Monaco 0.56 진입점 — **D1: 내장 언어 서비스는 켜지 않는다.**
//
// 0.56 에는 `editor.all.js` 가 없다. 기여(contribution) 목록이 `editor.main.js`
// 안에 인라인으로 들어 있고, 그 파일은 기여와 함께 `languages/features/*`
// (ts·json·css·html 의 **워커 기반 언어 서비스**)까지 끌어온다. 그래서
// `editor.main` 을 쓰면 D1 이 깨지고, `editor.api` 만 쓰면 폴딩·검색·다중커서·
// sticky·괄호매칭이 **하나도 등록되지 않는 빈 껍데기**가 된다
// (docs/20260908_monaco-editor/01-spike.md §r3-traps).
//
// 그래서 기여 목록만 여기 옮겨 적는다. 이 목록이 `editor.main.js` 와 어긋나면
// `monaco_contributions.test.ts` 가 붉어진다 — Monaco 를 올릴 때 그 테스트가
// 무엇이 늘고 줄었는지 알려 준다.
//
// 임포트 경로 주의: 0.56 의 exports map 이 `esm/vs` 를 뿌리로 잡아
// (`"./*": "./esm/vs/*.js"`) 흔히 쓰이는 `monaco-editor/esm/vs/...` 는 죽었다.
import * as monaco from "monaco-editor/editor/editor.api";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";

import { installClipboardService } from "./clipboard";
import { registerExtraLanguages } from "./langExtra";
import { registerProseLanguage } from "./langProse";

// ── 기여 (editor.main.js 에서 추출, 언어 서비스 제외) ──
import "monaco-editor/editor/contrib/anchorSelect/browser/anchorSelect";
import "monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching";
import "monaco-editor/editor/contrib/caretOperations/browser/transpose";
import "monaco-editor/editor/contrib/clipboard/browser/clipboard";
import "monaco-editor/editor/contrib/codeAction/browser/codeActionContributions";
import "monaco-editor/editor/browser/widget/codeEditor/codeEditorWidget";
import "monaco-editor/editor/contrib/codelens/browser/codelensController";
import "monaco-editor/editor/contrib/colorPicker/browser/colorPickerContribution";
import "monaco-editor/editor/contrib/comment/browser/comment";
import "monaco-editor/editor/contrib/contextmenu/browser/contextmenu";
import "monaco-editor/editor/contrib/cursorUndo/browser/cursorUndo";
import "monaco-editor/editor/browser/widget/diffEditor/diffEditor.contribution";
import "monaco-editor/editor/contrib/diffEditorBreadcrumbs/browser/contribution";
import "monaco-editor/editor/contrib/dnd/browser/dnd";
import "monaco-editor/editor/contrib/documentSymbols/browser/documentSymbols";
import "monaco-editor/editor/contrib/dropOrPasteInto/browser/dropIntoEditorContribution";
import "monaco-editor/features/find/register";
import "monaco-editor/editor/contrib/floatingMenu/browser/floatingMenu.contribution";
import "monaco-editor/editor/contrib/folding/browser/folding";
import "monaco-editor/editor/contrib/fontZoom/browser/fontZoom";
import "monaco-editor/editor/contrib/format/browser/formatActions";
import "monaco-editor/editor/contrib/gotoError/browser/gotoError";
import "monaco-editor/editor/standalone/browser/quickAccess/standaloneGotoLineQuickAccess";
import "monaco-editor/editor/contrib/gotoSymbol/browser/link/goToDefinitionAtPosition";
import "monaco-editor/editor/contrib/gpu/browser/gpuActions";
import "monaco-editor/editor/contrib/hover/browser/hoverContribution";
import "monaco-editor/editor/contrib/indentation/browser/indentation";
import "monaco-editor/editor/contrib/inlayHints/browser/inlayHintsContribution";
import "monaco-editor/editor/contrib/inlineCompletions/browser/inlineCompletions.contribution";
import "monaco-editor/editor/contrib/inlineProgress/browser/inlineProgress";
import "monaco-editor/editor/contrib/inPlaceReplace/browser/inPlaceReplace";
import "monaco-editor/editor/contrib/insertFinalNewLine/browser/insertFinalNewLine";
import "monaco-editor/editor/standalone/browser/inspectTokens/inspectTokens";
import "monaco-editor/editor/standalone/browser/iPadShowKeyboard/iPadShowKeyboard";
import "monaco-editor/editor/contrib/lineSelection/browser/lineSelection";
import "monaco-editor/editor/contrib/linesOperations/browser/linesOperations";
import "monaco-editor/editor/contrib/linkedEditing/browser/linkedEditing";
import "monaco-editor/editor/contrib/links/browser/links";
import "monaco-editor/editor/contrib/longLinesHelper/browser/longLinesHelper";
import "monaco-editor/editor/contrib/middleScroll/browser/middleScroll.contribution";
import "monaco-editor/editor/contrib/multicursor/browser/multicursor";
import "monaco-editor/editor/contrib/parameterHints/browser/parameterHints";
import "monaco-editor/editor/contrib/placeholderText/browser/placeholderText.contribution";
import "monaco-editor/editor/standalone/browser/quickAccess/standaloneCommandsQuickAccess";
import "monaco-editor/editor/standalone/browser/quickAccess/standaloneHelpQuickAccess";
import "monaco-editor/editor/standalone/browser/quickAccess/standaloneGotoSymbolQuickAccess";
import "monaco-editor/editor/contrib/readOnlyMessage/browser/contribution";
import "monaco-editor/editor/standalone/browser/referenceSearch/standaloneReferenceSearch";
import "monaco-editor/editor/contrib/rename/browser/rename";
import "monaco-editor/editor/contrib/sectionHeaders/browser/sectionHeaders";
import "monaco-editor/editor/contrib/semanticTokens/browser/viewportSemanticTokens";
import "monaco-editor/editor/contrib/smartSelect/browser/smartSelect";
import "monaco-editor/editor/contrib/snippet/browser/snippetController2";
import "monaco-editor/editor/contrib/stickyScroll/browser/stickyScrollContribution";
import "monaco-editor/editor/contrib/suggest/browser/suggestInlineCompletions";
import "monaco-editor/editor/standalone/browser/toggleHighContrast/toggleHighContrast";
import "monaco-editor/editor/contrib/toggleTabFocusMode/browser/toggleTabFocusMode";
import "monaco-editor/editor/contrib/tokenization/browser/tokenization";
import "monaco-editor/editor/contrib/unicodeHighlighter/browser/unicodeHighlighter";
import "monaco-editor/editor/contrib/unusualLineTerminators/browser/unusualLineTerminators";
import "monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter";
import "monaco-editor/editor/contrib/wordOperations/browser/wordOperations";
import "monaco-editor/editor/contrib/wordPartOperations/browser/wordPartOperations";
import "monaco-editor/editor/browser/coreCommands";
import "monaco-editor/editor/contrib/caretOperations/browser/caretOperations";
import "monaco-editor/editor/contrib/dropOrPasteInto/browser/copyPasteContribution";
import "monaco-editor/editor/contrib/find/browser/findController";
import "monaco-editor/editor/contrib/gotoSymbol/browser/goToCommands";
import "monaco-editor/editor/contrib/gotoError/browser/markerSelectionStatus";
import "monaco-editor/editor/contrib/semanticTokens/browser/documentSemanticTokens";
import "monaco-editor/editor/contrib/suggest/browser/suggestController";
import "monaco-editor/editor/common/standaloneStrings";
// ── Monarch 문법 — 지금 편집기가 강조하던 언어와 같은 집합 ──
// json·toml 은 0.56 의 Monarch 84종에 **없다** (json 은 워커 서비스 전용, toml 은
// 아예 없음). D1a 결정대로 `langExtra.ts` 에 직접 써서 아래에서 등록한다.
import "monaco-editor/languages/definitions/css/register";
import "monaco-editor/languages/definitions/go/register";
import "monaco-editor/languages/definitions/html/register";
import "monaco-editor/languages/definitions/javascript/register";
import "monaco-editor/languages/definitions/typescript/register";
import "monaco-editor/languages/definitions/markdown/register";
import "monaco-editor/languages/definitions/python/register";
import "monaco-editor/languages/definitions/rust/register";
import "monaco-editor/languages/definitions/yaml/register";
import "monaco-editor/languages/definitions/shell/register";

// 클립보드 서비스 오버라이드는 서비스가 하나라도 만들어지기 **전**이어야
// 받아들여진다 — 아래 언어 등록이 첫 서비스 조회다 (`clipboard.ts` 머리말).
installClipboardService();
// 0.56 이 안 주는 둘 — 등록은 전역이고 이 모듈이 한 번만 평가되므로 여기서 한다.
registerExtraLanguages(monaco);
// 논의 문서용 마크다운 — 제목 단계와 `{#id}` 를 갈라 칠한다 (`langProse.ts`).
registerProseLanguage(monaco);

// 워커는 D1 로 `editor.worker` 하나뿐이다 (기본 편집 서비스: diff 계산·링크 감지 등).
// 플러그인 계열(`vite-plugin-monaco-editor`)과 **섞지 않는다** — 둘 다 쓰면 깨진다.
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

export default monaco;
export { monaco };
