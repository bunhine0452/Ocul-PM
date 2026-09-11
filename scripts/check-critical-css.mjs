/**
 * 빌드 산출물에 **항상 필요한 CSS 가 실제로 들어갔는지** 검사한다.
 *
 * 왜 필요한가 — 2026-08-12 에 같은 종류의 사고를 두 번 냈고, 둘 다 typecheck·
 * vitest·vite build 를 전부 통과했다. jsdom 은 CSS 를 적용하지 않고, 번들러는
 * "이 스타일이 이 창에 도달하는가" 를 검사하지 않기 때문이다.
 *
 *   ① 탭 스트립 CSS 를 `styles/shell.css` 에 뒀는데 그 파일은 ShellV2(lazy
 *      청크)만 임포트한다 → 시작 탭만 있는 창에서 탭이 세로로 쌓였다.
 *   ② 시작 화면 격자 CSS 를 넣는 치환이 매치되지 않았는데 스크립트가 무조건
 *      성공을 찍었다 → 규칙이 파일에 아예 없는 채로 게이트가 전부 통과했다.
 *
 * 검사 방식: 창 엔트리(TabbedWindow)의 CSS 청크에 아래 선택자가 전부 있어야
 * 한다. lazy 청크(ShellV2)에만 있으면 실패다 — 그게 ① 의 증상이다.
 */
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = join(repoRoot, "dist", "assets");

/** 창 엔트리 CSS 청크에 반드시 있어야 하는 선택자. */
const REQUIRED = [
  // 창 셸 + 탭 스트립 — 트레이를 뺀 모든 창에 항상 있다.
  ".winroot",
  ".tabstrip",
  ".tabstrip-tab",
  ".tabpane",
  // 시작 탭(프로젝트 메인 화면) — 창을 열면 가장 먼저 보이는 화면이다.
  ".home-board",
  ".home-wrap",
  ".hl-lead",
  ".hl-ledger",
  ".hl-row",
  // 창 최상위 모달 — 탭 닫기 확인창(useConfirm) · ⌘/ 치트시트. 스킬 화면을
  // 한 번도 안 연 창에서도 뜨므로 lazy 청크에 있으면 뼈대만 남아 나온다
  // (2026-09-02: 실제로 skills.css/screens.css 에 갇혀 있었다).
  ".sk-modal-head",
  ".sk-modal-warn",
  ".sk-modal-foot",
  ".keys-grid",
];

/**
 * 창이 **열자마자** 들고 있는 CSS 청크들.
 *
 *  · `TabbedWindow-*.css` — 창 엔트리가 직접 임포트한 것 (tabs.css 등).
 *  · 공용 청크 — `import "@/App.css"` 가 여러 엔트리에 공유돼 빠진 것.
 *    토큰(tokens.css)·프리미티브(primitives.css)가 여기 산다. 엔트리 JS 가
 *    **정적으로** 물고 있으므로 창과 함께 무조건 로드된다. **이름으로 찾지
 *    않는다** — rollup 이 공용 청크를 그 안의 어떤 모듈 이름으로 부를지는
 *    공유 그래프에 따라 바뀐다 (`App-*` 였다가 `lib/blocked.ts` 가 화면
 *    마흔 곳에 들어가자 `blocked-*` 가 됐다). 대신 tokens.css 의 토큰 하나를
 *    지문으로 삼아 **내용**으로 찾는다.
 *
 * lazy 청크(ShellV2-*.css · SkillsScreenV2-*.css …)는 여기 없다 — 그게 이
 * 검사의 존재 이유다.
 */
const ENTRY_CSS = [/^TabbedWindow-.*\.css$/];
/** tokens.css 에만 사는 토큰 — 이걸 가진 CSS 청크가 공용 청크다. */
const SHARED_FINGERPRINT = "--dim-disabled:";

let files;
try {
  files = await readdir(assetsDir);
} catch {
  console.error(`✗ ${assetsDir} 가 없습니다 — 먼저 vite build 를 돌리세요.`);
  process.exit(1);
}

// 패턴마다 **하나씩은** 나와야 한다. 하나만 비어도 조용히 반쪽만 검사하게 된다.
const missingChunk = ENTRY_CSS.find((re) => !files.some((f) => re.test(f)));
if (missingChunk) {
  console.error(`✗ 창이 로드하는 CSS 청크(${missingChunk})를 찾지 못했습니다.`);
  console.error("  청크 이름이 바뀌었다면 이 스크립트의 ENTRY_CSS 도 함께 고치세요.");
  process.exit(1);
}
const cssFiles = files.filter((f) => f.endsWith(".css"));
const contents = new Map(
  await Promise.all(cssFiles.map(async (f) => [f, await readFile(join(assetsDir, f), "utf8")])),
);
const shared = cssFiles.filter((f) => contents.get(f).includes(SHARED_FINGERPRINT));
if (shared.length === 0) {
  console.error(`✗ 공용 CSS 청크(토큰 ${SHARED_FINGERPRINT} 를 가진 것)를 찾지 못했습니다.`);
  console.error("  tokens.css 의 토큰 이름이 바뀌었다면 이 스크립트의 SHARED_FINGERPRINT 도 함께 고치세요.");
  process.exit(1);
}
const entryCss = [...new Set([...cssFiles.filter((f) => ENTRY_CSS.some((re) => re.test(f))), ...shared])];

const css = entryCss.map((f) => contents.get(f)).join("\n");

// 부분 문자열이 아니라 **선택자 토큰**으로 찾는다 — `includes(".winroot")` 는
// `.winroot-DISABLED` 에도 걸려서, 규칙 이름이 바뀐 사고를 놓친다.
const hasSelector = (sel) =>
  new RegExp(`\\${sel}(?![\\w-])`).test(css);
const missing = REQUIRED.filter((sel) => !hasSelector(sel));
if (missing.length > 0) {
  console.error(`✗ 창 엔트리 CSS 에 빠진 선택자 ${missing.length}개:`);
  for (const sel of missing) console.error(`    ${sel}`);
  console.error("");
  console.error("고치는 법:");
  console.error("  · 규칙이 styles/index.css 계열(base/shell/primitives/screens)에 있다면");
  console.error("    그건 ShellV2(lazy 청크) 전용이다 — 항상 필요한 것은 styles/tabs.css");
  console.error("    처럼 창이 직접 임포트하는 파일로 옮긴다.");
  console.error("  · 규칙 자체가 사라졌다면 편집이 실제로 반영됐는지 확인한다.");
  process.exit(1);
}

console.log(`✓ 창 엔트리 CSS 에 핵심 선택자 ${REQUIRED.length}개가 모두 있습니다`);
