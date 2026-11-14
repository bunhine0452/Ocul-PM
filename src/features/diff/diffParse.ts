// PR-UI 8b — pure git-unified-diff parsers extracted from LocalDiffView.tsx so
// the live DiffScreenV2 (+ the Lite-W6 safety-net tests) can keep importing
// them while the LocalDiffView *component* (which carried the last Tailwind
// dark-variants) moves to src/legacy/. No JSX, no theming — just parsing.

export type DiffLineKind =
  | "header"
  | "hunk"
  | "addition"
  | "deletion"
  | "context"
  /** 덩이 안의 표식 줄 — `\ No newline at end of file` 같은 것. 줄 번호를 먹지 않는다. */
  | "meta";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

/** Map a file path's extension to a highlight.js language id (or null). */
export function langFromPath(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = path.split("/").pop() ?? path;
  const ext = base.includes(".") ? base.split(".").pop()!.toLowerCase() : "";
  const byExt: Record<string, string> = {
    ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
    js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
    py: "python", rs: "rust", go: "go", java: "java", kt: "kotlin",
    rb: "ruby", php: "php", swift: "swift", c: "c", h: "c", cpp: "cpp",
    cc: "cpp", hpp: "cpp", cs: "csharp", scala: "scala", lua: "lua",
    json: "json", jsonc: "json", yml: "yaml", yaml: "yaml", toml: "ini",
    ini: "ini", md: "markdown", markdown: "markdown", css: "css",
    scss: "scss", less: "less", html: "xml", xml: "xml", vue: "xml",
    svelte: "xml", sh: "bash", bash: "bash", zsh: "bash", sql: "sql",
    graphql: "graphql", gql: "graphql", dockerfile: "dockerfile",
  };
  if (ext && byExt[ext]) return byExt[ext];
  if (base.toLowerCase() === "dockerfile") return "dockerfile";
  return null;
}

/**
 * Parse a `@@ -oldStart[,n] +newStart[,m] @@ …` hunk header into the 1-based
 * starting line numbers of each side, so the gutters can show REAL file line
 * numbers instead of per-hunk 1-based counters. Returns null for the preamble
 * sentinel / malformed headers (renderer falls back to per-hunk numbering).
 */
export function parseHunkHeader(
  text: string,
): { oldStart: number; newStart: number } | null {
  const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
  if (!m) return null;
  return { oldStart: Number(m[1]), newStart: Number(m[2]) };
}

/**
 * Classify each line of a git unified diff — **by position**, the same state machine
 * `countPatchStats` uses (11-15 #diff-exact). `diff ` resets to the file header, `@@` opens a
 * hunk, and inside a hunk only the first character decides. Classifying by prefix
 * (`startsWith("--- ")`) took a deleted SQL/Lua comment line (`--- old comment`) for a file
 * header: the line vanished and every number after it shifted.
 *
 * The empty piece after a trailing newline is not a line (it used to stand as a numbered
 * context row). A line starting with `\` (`\ No newline at end of file`) is `meta` — it takes no
 * line number. Lines before any header (a headerless snippet) fall back to prefix rules.
 * Exported (pure) for unit testing of the renderer's coloring rules.
 */
export function classifyDiffLines(patch: string): DiffLine[] {
  const raw = patch.split("\n");
  if (raw.length > 1 && raw[raw.length - 1] === "") raw.pop();
  let zone: "start" | "header" | "hunk" = "start";
  return raw.map((text): DiffLine => {
    if (text.startsWith("diff ")) {
      zone = "header";
      return { kind: "header", text };
    }
    if (text.startsWith("@@")) {
      zone = "hunk";
      return { kind: "hunk", text };
    }
    const first = text.charAt(0);
    if (zone === "hunk") {
      if (first === "+") return { kind: "addition", text };
      if (first === "-") return { kind: "deletion", text };
      // 공백 · 빈 줄(끝 공백을 지우는 도구가 있다)만 문맥이다. 그 밖의 글자로 시작하는 줄은
      // 덩이의 줄이 아니다 — 번호를 먹으면 뒤 번호가 밀린다.
      if (first === " " || text === "") return { kind: "context", text };
      return { kind: "meta", text };
    }
    // 머리 구역 — `index` · `---` · `+++` · `new file mode` · `rename from` · `Binary files …`.
    if (zone === "header") return { kind: "header", text };
    if (text.startsWith("index ") || text.startsWith("--- ") || text.startsWith("+++ ")) {
      return { kind: "header", text };
    }
    if (first === "+") return { kind: "addition", text };
    if (first === "-") return { kind: "deletion", text };
    if (first === "\\") return { kind: "meta", text };
    return { kind: "context", text };
  });
}

/** git 의 표식 줄 — 화면은 이 글을 「파일 끝 줄바꿈 없음」 으로 바꿔 그린다. */
export function isNoNewlineMarker(text: string): boolean {
  return text.startsWith("\\ No newline at end of file");
}

/**
 * Count the +N/−M summary of a real unified diff. Header lines are excluded
 * by POSITION (only lines inside `@@` hunks count), not by prefix — deleting
 * a `---` content line (YAML front-matter, Markdown rule) yields `----`,
 * which a startsWith("---") check misclassifies as a file header and drops.
 * Exported (pure) for unit testing.
 */
export function countPatchStats(patch: string): { add: number; del: number } {
  let add = 0;
  let del = 0;
  let inHunk = false;
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff ")) inHunk = false;
    else if (line.startsWith("@@")) inHunk = true;
    else if (inHunk && line.startsWith("+")) add++;
    else if (inHunk && line.startsWith("-")) del++;
  }
  return { add, del };
}

/** 패치가 바이트 예산에서 잘렸다 — 보인 것 · 전체 (바이트). */
export interface PatchCut {
  shown: number;
  total: number;
}

const LEGACY_CUT = /\n\n\.\.\. \(truncated, (\d+) bytes total\)\s*$/;

/**
 * 옛 자르기 표지(`... (truncated, N bytes total)`)를 떼어 낸다. 일지 사이드카는 저장된 글이라
 * 이 영어 문장을 그대로 들고 있다 — 떼지 않으면 코드 줄처럼 번호를 달고 그려졌다. 변경 화면의
 * diff 는 백엔드가 문장 대신 `truncated` 를 따로 준다 (`compute_diff`).
 */
export function splitLegacyCut(patch: string): { body: string; cut: PatchCut | null } {
  const m = LEGACY_CUT.exec(patch);
  if (!m) return { body: patch, cut: null };
  const body = patch.slice(0, m.index);
  return { body, cut: { shown: new TextEncoder().encode(body).length, total: Number(m[1]) } };
}

/**
 * Lite-W6 PR6.5: split a classified line stream into hunks. Each `@@` line
 * starts a new hunk; lines before the first `@@` (file header) flow into a
 * sentinel "preamble" hunk with no header so the renderer can show them
 * once at the top. Exported for unit testing.
 */
export interface DiffHunk {
  header: DiffLine | null;
  lines: DiffLine[];
}

export function groupIntoHunks(lines: DiffLine[]): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk = { header: null, lines: [] };
  for (const line of lines) {
    if (line.kind === "hunk") {
      if (current.lines.length > 0 || current.header) hunks.push(current);
      current = { header: line, lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.length > 0) hunks.push(current);
  return hunks;
}

/**
 * 덩이의 새 쪽에서 처음 바뀐 줄 — 「e 편집기에서 그 줄」 이 여는 자리. 바뀐 줄이 지운 줄뿐이면
 * 그 자리(뒤따르는 새 쪽 줄)를 준다. 머리 없는 조각은 1행부터 센다.
 */
export function firstChangedLine(hunk: DiffHunk): number {
  let newNo = (hunk.header ? parseHunkHeader(hunk.header.text)?.newStart : null) ?? 1;
  for (const l of hunk.lines) {
    if (l.kind === "addition" || l.kind === "deletion") return Math.max(newNo, 1);
    if (l.kind === "context") newNo++;
  }
  return Math.max(newNo, 1);
}

/**
 * Lite-W6 PR6.5: pair `-`/`+` lines into rows for side-by-side rendering.
 * Consecutive deletions and the immediately following consecutive additions
 * are zipped index-by-index; longer side fills its remaining rows with
 * `null` on the opposite side. Context / header / hunk lines render
 * identically on both sides (truth-y on both). Exported for unit testing.
 *
 * 표식 줄(`meta`)은 짝짓기를 끊지 않는다 — 지운 줄 · 더한 줄 무리 안에 섞여 와도 짝은 그대로
 * 맞추고, 표식은 무리 뒤에 양쪽 같은 줄로 선다.
 */
export function pairDiffLines<L extends { kind: DiffLineKind }>(
  lines: readonly L[],
): Array<{ left: L | null; right: L | null }> {
  const rows: Array<{ left: L | null; right: L | null }> = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.kind === "deletion" || l.kind === "addition") {
      const dels: L[] = [];
      const adds: L[] = [];
      const metas: L[] = [];
      while (i < lines.length && (lines[i].kind === "deletion" || lines[i].kind === "meta")) {
        (lines[i].kind === "meta" ? metas : dels).push(lines[i]);
        i++;
      }
      while (i < lines.length && (lines[i].kind === "addition" || lines[i].kind === "meta")) {
        (lines[i].kind === "meta" ? metas : adds).push(lines[i]);
        i++;
      }
      const max = Math.max(dels.length, adds.length);
      for (let k = 0; k < max; k++) {
        rows.push({ left: dels[k] ?? null, right: adds[k] ?? null });
      }
      for (const m of metas) rows.push({ left: m, right: m });
    } else {
      // header / hunk / context / meta — same on both sides
      rows.push({ left: l, right: l });
      i++;
    }
  }
  return rows;
}
