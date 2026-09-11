// 확장자 → 언어 id. **문자열 매핑뿐이다** (Phase 2 `{#reclaim-lang}`).
//
// CodeMirror 판에서는 이 파일이 언어 패키지 12개를 정적으로 임포트해
// `Extension[]` 을 만들어 줬다. Monaco 는 문법을 **언어 id 로** 찾으므로
// (`monaco/setup.ts` 가 Monarch 를 등록하고, 0.56 에 없는 json·toml 은
// `monaco/langExtra.ts` 가 채운다) 여기 남는 것은 표 하나다 —
// `@codemirror/lang-*` 8개와 `legacy-modes` 의존성이 그래서 사라졌다.
//
// 여기서 monaco 를 임포트하지 않는 것이 중요하다: 이 모듈은 `CodePane` 과
// jsdom 테스트가 함께 쓰는데, monaco 를 끌어오면 그 테스트가 편집기를 통째로
// 로드하게 된다.

export type CodeLangId =
  | "typescript"
  | "javascript"
  | "rust"
  | "python"
  | "go"
  | "markdown"
  | "json"
  | "html"
  | "css"
  | "yaml"
  | "toml"
  | "shell";

/** 확장자(소문자, 점 제외) → 언어 id. 상태줄 라벨과 Monaco 문법 선택의 단일 소스. */
const EXT_TO_LANG: Record<string, CodeLangId> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  rs: "rust",
  py: "python",
  go: "go",
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  json: "json",
  jsonc: "json",
  html: "html",
  htm: "html",
  // Vue/Svelte SFC 는 정확한 문법이 아니지만 html 이 가장 가깝다.
  vue: "html",
  svelte: "html",
  css: "css",
  scss: "css",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
};

/** `src/a/b.test.tsx` → "typescript". 모르는 확장자는 null (플레인 텍스트). */
export function langIdForPath(path: string): CodeLangId | null {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  return EXT_TO_LANG[ext] ?? null;
}

/** 상태줄에 그리는 언어 라벨. 번역 대상이 아닌 고유명사라 i18n 을 타지 않는다. */
export function langLabel(id: CodeLangId | null): string {
  switch (id) {
    case "typescript":
      return "TypeScript";
    case "javascript":
      return "JavaScript";
    case "rust":
      return "Rust";
    case "python":
      return "Python";
    case "go":
      return "Go";
    case "markdown":
      return "Markdown";
    case "json":
      return "JSON";
    case "html":
      return "HTML";
    case "css":
      return "CSS";
    case "yaml":
      return "YAML";
    case "toml":
      return "TOML";
    case "shell":
      return "Shell";
    default:
      return "Plain Text";
  }
}

/**
 * 경로에 맞는 **Monaco 언어 id**.
 *
 * 우리 `CodeLangId` 12종은 Monaco id 와 이름이 그대로 겹친다 — 10종은 Monaco 의
 * Monarch 문법이 등록돼 있고, json·toml 은 `monaco/langExtra.ts` 가 등록한다.
 * 모르는 확장자는 `plaintext`(강조 없음).
 */
export function monacoLangForPath(path: string): string {
  return langIdForPath(path) ?? "plaintext";
}

/**
 * 산문 파일인가 — 줄바꿈의 기본값이 갈린다 (`codeWordWrap: "auto"`). 코드는
 * 긴 줄이 곧 정보(들여쓰기·정렬)라 자르지 않고, 산문은 한 문단이 한 줄이라
 * 안 접으면 화면 밖으로 달아난다 (2026-09-11 스크린샷의 AGENTS.md 가 그랬다).
 */
export function isProsePath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  const ext = dot < 0 ? "" : path.slice(dot + 1).toLowerCase();
  return ext === "md" || ext === "markdown" || ext === "mdx" || ext === "txt" || ext === "rst" || ext === "adoc";
}
