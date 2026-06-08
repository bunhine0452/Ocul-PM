// Feature request 1 — pretty-print code-search snippets across many languages.
//
// Web languages go through Prettier (standalone + plugins); compiled / systems
// languages go through the @wasm-fmt family (clang-format, gofmt, ruff_fmt,
// shfmt — real WASM builds of the upstream tools). Every formatter is loaded
// **lazily on first use** (dynamic import) so none of this is in the initial
// bundle; a language's module only loads when a result of that language is
// actually shown. Anything we can't format (unsupported language, or a partial
// snippet that won't parse — search results are often mid-symbol) falls back to
// the original text unchanged, so this never breaks the results view.

type Lang =
  | { kind: "prettier"; parser: PrettierParser }
  | { kind: "wasm"; key: WasmKey; filename: string };

type PrettierParser =
  | "babel"
  | "typescript"
  | "json"
  | "css"
  | "scss"
  | "less"
  | "html"
  | "markdown"
  | "yaml"
  | "graphql";

type WasmKey = "clang" | "go" | "ruff" | "shfmt";

/** Extension (lower-case, no dot) → formatter. Extensions with no entry are
 *  left untouched. */
function langFor(filePath: string): Lang | null {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const base = filePath.split("/").pop() ?? filePath;
  switch (ext) {
    // --- Prettier (web languages) ---
    case "ts":
    case "tsx":
    case "mts":
    case "cts":
      return { kind: "prettier", parser: "typescript" };
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return { kind: "prettier", parser: "babel" };
    case "json":
    case "jsonc":
      return { kind: "prettier", parser: "json" };
    case "css":
      return { kind: "prettier", parser: "css" };
    case "scss":
      return { kind: "prettier", parser: "scss" };
    case "less":
      return { kind: "prettier", parser: "less" };
    case "html":
    case "htm":
      return { kind: "prettier", parser: "html" };
    case "md":
    case "mdx":
    case "markdown":
      return { kind: "prettier", parser: "markdown" };
    case "yaml":
    case "yml":
      return { kind: "prettier", parser: "yaml" };
    case "graphql":
    case "gql":
      return { kind: "prettier", parser: "graphql" };
    // --- clang-format (C family / Java / C# / Obj-C / Protobuf) ---
    case "c":
    case "h":
    case "cc":
    case "cpp":
    case "cxx":
    case "hpp":
    case "hh":
    case "hxx":
    case "cs":
    case "java":
    case "m":
    case "mm":
    case "proto":
      return { kind: "wasm", key: "clang", filename: base };
    // --- gofmt ---
    case "go":
      return { kind: "wasm", key: "go", filename: base };
    // --- ruff (Python) ---
    case "py":
    case "pyi":
      return { kind: "wasm", key: "ruff", filename: base };
    // --- shfmt (shell) ---
    case "sh":
    case "bash":
    case "zsh":
      return { kind: "wasm", key: "shfmt", filename: base };
    default:
      return null;
  }
}

/** True if we have a formatter for this path — lets the UI decide whether to
 *  offer the 정렬 toggle. Does not guarantee the snippet will format (a partial
 *  snippet may fail to parse, in which case `formatCode` returns it unchanged). */
export function isFormattable(filePath: string): boolean {
  return langFor(filePath) !== null;
}

// ── Prettier (lazy) ──────────────────────────────────────────────────────────

let prettierPromise: Promise<{
  format: (src: string, opts: { parser: string; plugins: unknown[] }) => Promise<string>;
  plugins: unknown[];
}> | null = null;

async function getPrettier() {
  if (!prettierPromise) {
    prettierPromise = (async () => {
      const [standalone, babel, estree, ts, postcss, html, markdown, yaml, graphql] =
        await Promise.all([
          import("prettier/standalone"),
          import("prettier/plugins/babel"),
          import("prettier/plugins/estree"),
          import("prettier/plugins/typescript"),
          import("prettier/plugins/postcss"),
          import("prettier/plugins/html"),
          import("prettier/plugins/markdown"),
          import("prettier/plugins/yaml"),
          import("prettier/plugins/graphql"),
        ]);
      return {
        format: standalone.format as never,
        plugins: [babel, estree, ts, postcss, html, markdown, yaml, graphql],
      };
    })();
  }
  return prettierPromise;
}

// ── WASM formatters (lazy, init once per language) ────────────────────────────

type WasmFormat = (code: string, filename: string) => string;

const wasmLoaders: Record<WasmKey, () => Promise<WasmFormat>> = {
  clang: async () => {
    const m = await import("@wasm-fmt/clang-format/vite");
    await m.default();
    return (code, fn) => m.format(code, fn, "Google");
  },
  go: async () => {
    const m = await import("@wasm-fmt/gofmt/vite");
    await m.default();
    return (code) => m.format(code);
  },
  ruff: async () => {
    const m = await import("@wasm-fmt/ruff_fmt/vite");
    await m.default();
    return (code, fn) => m.format(code, fn);
  },
  shfmt: async () => {
    const m = await import("@wasm-fmt/shfmt/vite");
    await m.default();
    return (code, fn) => m.format(code, fn);
  },
};

const wasmCache = new Map<WasmKey, Promise<WasmFormat>>();

function getWasm(key: WasmKey): Promise<WasmFormat> {
  let p = wasmCache.get(key);
  if (!p) {
    p = wasmLoaders[key]();
    wasmCache.set(key, p);
  }
  return p;
}

/**
 * Format `content` for `filePath`'s language. Returns the original text
 * unchanged when the language is unsupported or the snippet can't be parsed
 * (which is common for mid-symbol search fragments) — callers can render the
 * result directly either way.
 */
export async function formatCode(content: string, filePath: string): Promise<string> {
  const lang = langFor(filePath);
  if (!lang) return content;
  try {
    if (lang.kind === "prettier") {
      const { format, plugins } = await getPrettier();
      const out = await format(content, { parser: lang.parser, plugins });
      return out.trim() ? out : content;
    }
    const format = await getWasm(lang.key);
    const out = format(content, lang.filename);
    return out.trim() ? out : content;
  } catch {
    // Unparseable partial snippet / loader failure — keep the original.
    return content;
  }
}
