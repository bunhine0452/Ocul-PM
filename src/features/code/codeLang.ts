// 확장자 → CodeMirror 언어 매핑. 이 화면 자체가 lazy 청크라 언어 패키지의
// 정적 임포트가 메인 번들에 실리지 않는다 (ShellV2 의 청크 분할 원칙).
import type { Extension } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { rust } from "@codemirror/lang-rust";
import { python } from "@codemirror/lang-python";
import { go } from "@codemirror/lang-go";
import { markdown } from "@codemirror/lang-markdown";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { yaml } from "@codemirror/lang-yaml";
import { StreamLanguage } from "@codemirror/language";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { shell } from "@codemirror/legacy-modes/mode/shell";

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

/** 확장자(소문자, 점 제외) → 언어 id. 상태줄 라벨과 CM 확장 선택의 단일 소스. */
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
 * 여기서 monaco 를 임포트하지 않는 것이 중요하다 — 이 모듈은 `CodePane` 과
 * jsdom 테스트가 함께 쓰는데, monaco 를 끌어오면 그 테스트가 편집기를 통째로
 * 로드하게 된다. 문자열 매핑이면 충분하다.
 *
 * `json`·`toml` 은 Monaco 0.56 의 Monarch 84종에 **없다** (json 은 워커 기반
 * 언어 서비스 전용, toml 은 아예 없음). D1 로 그 서비스를 끄므로 지금은 강조가
 * 없고, Phase 2 `reclaim-lang` 에서 Monarch 문법을 직접 써 채운다
 * (docs/20260908_monaco-editor/00-master-plan.md `{#d1a-json-toml}`).
 */
export function monacoLangForPath(path: string): string {
  // 우리 `CodeLangId` 12종은 Monaco id 와 이름이 그대로 겹친다 (10종은 문법이
  // 등록돼 있고, json·toml 은 id 만 맞고 문법이 아직 없다 — Phase 2 가 채우면
  // 이 함수를 고치지 않아도 켜진다).
  return langIdForPath(path) ?? "plaintext";
}

/** 경로에 맞는 CM 언어 확장. tsx/jsx 는 파일명으로 jsx 여부까지 구분한다. */
export function langExtensionForPath(path: string): Extension[] {
  const id = langIdForPath(path);
  const lower = path.toLowerCase();
  switch (id) {
    case "typescript":
      return [javascript({ typescript: true, jsx: lower.endsWith(".tsx") })];
    case "javascript":
      return [javascript({ jsx: lower.endsWith(".jsx") })];
    case "rust":
      return [rust()];
    case "python":
      return [python()];
    case "go":
      return [go()];
    case "markdown":
      return [markdown()];
    case "json":
      return [json()];
    case "html":
      return [html()];
    case "css":
      return [css()];
    case "yaml":
      return [yaml()];
    case "toml":
      return [StreamLanguage.define(toml)];
    case "shell":
      return [StreamLanguage.define(shell)];
    default:
      return [];
  }
}
