import { useEffect, useState } from "react";
import { formatCode, isFormattable } from "./formatCode";

// A code-search result body: optionally pretty-printed (formatCode) and always
// syntax-highlighted with highlight.js (whose token classes are already themed
// in screens.css, shared with the diff + Markdown views). Both steps are async
// and best-effort — the raw text renders immediately and is swapped for the
// formatted/highlighted version once ready, so a slow or failed pass never
// blanks the result.

interface CodeSnippetProps {
  path: string;
  content: string;
  /** When true, run the snippet through the language formatter before display. */
  formatted: boolean;
}

let hljsPromise: Promise<typeof import("highlight.js/lib/common").default> | null = null;
function getHljs() {
  if (!hljsPromise)
    hljsPromise = import("highlight.js/lib/common").then((m) => m.default);
  return hljsPromise;
}

// Extension → highlight.js language id. Unknown extensions fall back to
// highlightAuto. lib/common (same subset PatchView uses — ~90KB vs the 808KB
// full build) lacks a few of these (e.g. protobuf); getLanguage() returns
// undefined for those and the highlightAuto fallback below covers them.
const HLJS_LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  json: "json", jsonc: "json", css: "css", scss: "scss", less: "less",
  html: "xml", htm: "xml", md: "markdown", mdx: "markdown", markdown: "markdown",
  yaml: "yaml", yml: "yaml", graphql: "graphql", gql: "graphql",
  c: "c", h: "c", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp", hxx: "cpp",
  cs: "csharp", java: "java", m: "objectivec", mm: "objectivec", proto: "protobuf",
  go: "go", py: "python", pyi: "python", sh: "bash", bash: "bash", zsh: "bash",
  rs: "rust", rb: "ruby", php: "php", sql: "sql", toml: "ini", kt: "kotlin", swift: "swift",
};

async function highlightCode(code: string, path: string): Promise<string> {
  const hljs = await getHljs();
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const lang = HLJS_LANG[ext];
  if (lang && hljs.getLanguage(lang)) {
    return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
  }
  return hljs.highlightAuto(code).value;
}

export function CodeSnippet({ path, content, formatted }: CodeSnippetProps) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    void (async () => {
      const text =
        formatted && isFormattable(path) ? await formatCode(content, path) : content;
      if (cancelled) return;
      try {
        const highlighted = await highlightCode(text, path);
        if (!cancelled) setHtml(highlighted);
      } catch {
        // highlight failed — fall through to the raw render below.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, content, formatted]);

  if (html != null) {
    return <div className="scode hljs" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  // Pre-highlight (or highlight failed): render the raw text safely.
  return <div className="scode">{content}</div>;
}
