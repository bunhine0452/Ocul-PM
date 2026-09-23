/**
 * 수정키 글리프 게이트 (크로스플랫폼 라운드 2026-09-23 {#ui-labels}).
 *
 * `⌘K` 를 소스에 그대로 적으면 Windows·Linux 에서도 `⌘K` 로 보인다. 표기는
 * `lib/kbd.ts` 의 `kbd()` 한 곳을 지나야 그 OS 의 것(`Ctrl+K`)이 된다. 이
 * 스위트는 **새로 적힌 글리프가 그 창구를 건너뛰지 못하게** 막는다:
 *
 *   - 문자열·템플릿·JSX 텍스트 안의 ⌘ ⇧ ⌥ ⌃ 는 `kbd(…)` 의 첫 인자여야 한다.
 *   - 예외는 아래 허용 목록 — 렌더 때 한꺼번에 옮기는 자리다.
 *   - 주석·테스트는 보지 않는다 (코드가 아니라 설명이다).
 *
 * 스크립트 게이트(`scripts/`)가 아니라 vitest 인 이유: 레인 소유가 `src/**` 라
 * `pnpm lint` 에 새 단계를 붙일 수 없었다. 대신 `pnpm test` 가 CI 에서 같은 일을 한다.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

import { ko } from "@/i18n/ko";

const posix = (p: string) => p.split("\\").join("/");
const ROOT = posix(join(__dirname, ".."));
const GLYPH = /[⌘⇧⌥⌃]/;

/** 렌더 때 한꺼번에 옮기는 자리 — 파일 → 이유. */
const ALLOWED: Record<string, string> = {
  "i18n/ko.ts": "dictionary is written in mac notation; t() localizes it (localizeShortcuts)",
  "i18n/en.ts": "dictionary is written in mac notation; t() localizes it (localizeShortcuts)",
  "lib/shortcutRegistry.ts": "cheatsheet table; buildShortcutGroups runs every row through kbd()",
  "lib/kbd.ts": "the formatter's own glyph table",
};

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = posix(join(dir, name));
    if (name === "__tests__" || name === "legacy") continue;
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) yield full;
  }
}

const rel = (file: string) => file.slice(ROOT.length + 1);

/** 이 노드(문자열 조각)를 품은 식이 `kbd(<그 식>, …)` 의 첫 인자인가. */
function isKbdArgument(node: ts.Node): boolean {
  let expr: ts.Node = node;
  // 템플릿 조각(head/middle/tail)은 템플릿 식 전체가 인자다.
  if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
    let p: ts.Node | undefined = node.parent;
    while (p && !ts.isTemplateExpression(p)) p = p.parent;
    if (!p) return false;
    expr = p;
  }
  const call = expr.parent;
  return (
    !!call &&
    ts.isCallExpression(call) &&
    ts.isIdentifier(call.expression) &&
    call.expression.text === "kbd" &&
    call.arguments[0] === expr
  );
}

interface Hit {
  file: string;
  line: number;
  text: string;
}

function scan(): { offenders: Hit[]; allowedHits: Map<string, number>; tcCalls: Hit[] } {
  const offenders: Hit[] = [];
  const allowedHits = new Map<string, number>();
  const tcCalls: Hit[] = [];
  const glyphKeys = new Set(Object.entries(ko).filter(([, v]) => GLYPH.test(v)).map(([k]) => k));
  for (const file of walk(ROOT)) {
    const name = rel(file);
    if (name === "lib/bindings.ts") continue; // 생성물 — 백엔드 doc 주석이 실린다
    const text = readFileSync(file, "utf8");
    const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
    const visit = (node: ts.Node) => {
      // 산출물 조회(tc)는 표기를 옮기지 않는다 — 글리프가 든 문구를 거기 쓰면 샌다.
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "tc" &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0]) &&
        glyphKeys.has(node.arguments[0].text)
      ) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        tcCalls.push({ file: name, line: line + 1, text: node.getText(sf) });
      }
      const isText =
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node) ||
        ts.isJsxText(node);
      if (isText && GLYPH.test(node.getText(sf))) {
        if (name in ALLOWED) {
          allowedHits.set(name, (allowedHits.get(name) ?? 0) + 1);
        } else if (ts.isJsxText(node) || !isKbdArgument(node)) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          offenders.push({ file: name, line: line + 1, text: node.getText(sf).slice(0, 80) });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return { offenders, allowedHits, tcCalls };
}

describe("modifier glyphs go through kbd()", () => {
  const { offenders, allowedHits, tcCalls } = scan();

  it("no ⌘⇧⌥⌃ literal outside kbd() in src ts/tsx (allowlist aside)", () => {
    const report = offenders.map((h) => `${h.file}:${h.line} ${h.text}`);
    expect(report, `wrap with kbd():\n${report.join("\n")}`).toEqual([]);
  });

  it("allowlist has no dead entries", () => {
    for (const file of Object.keys(ALLOWED)) {
      expect(allowedHits.get(file) ?? 0, `dead allowlist entry: ${file}`).toBeGreaterThan(0);
    }
  });

  it("dictionary strings with glyphs are never read through tc() (content lookup)", () => {
    const report = tcCalls.map((h) => `${h.file}:${h.line} ${h.text}`);
    expect(report).toEqual([]);
  });

  it("the gate actually catches an unwrapped literal", () => {
    const src = 'const a = "⌘K"; const b = kbd("⌘P"); const c = kbd(`⌘${n}`); const d = x("⇧⌘T");';
    const sf = ts.createSourceFile("probe.ts", src, ts.ScriptTarget.Latest, true);
    const found: string[] = [];
    const visit = (node: ts.Node) => {
      const isText =
        ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node);
      if (isText && GLYPH.test(node.getText(sf)) && !isKbdArgument(node)) found.push(node.getText(sf));
      ts.forEachChild(node, visit);
    };
    visit(sf);
    expect(found).toEqual(['"⌘K"', '"⇧⌘T"']);
  });
});
