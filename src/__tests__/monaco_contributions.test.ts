import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// D1 의 자물쇠 — `monaco/setup.ts` 의 기여 목록이 Monaco 의 `editor.main.js` 와
// 어긋나면 여기서 잡는다.
//
// 왜 목록을 손으로 드는가: 0.56 에는 `editor.all.js` 가 없어 기여를 통째로
// 가져올 방법이 `editor.main` 뿐인데, 그 파일은 워커 기반 언어 서비스
// (`languages/features/*`)까지 함께 끌어온다 — D1 이 끄기로 한 바로 그것이다.
// 그래서 기여만 옮겨 적었고, 옮겨 적은 것은 반드시 원본과 대조해야 한다.
//
// 이 테스트가 붉어지면 Monaco 를 올린 것이다. 늘어난 줄은 `setup.ts` 에 더하고,
// 줄어든 줄은 지운다. **`languages/features/*` 가 목록에 들어오면 D1 위반이다.**

const ROOT = resolve(__dirname, "../..");

function contributionsFromMonaco(): string[] {
  const src = readFileSync(
    resolve(ROOT, "node_modules/monaco-editor/esm/vs/editor/editor.main.js"),
    "utf8",
  );
  const out: string[] = [];
  for (const line of src.split("\n")) {
    const m = /^import '(\.\/[^']+)';$/.exec(line) ?? /^import '(\.\.\/(?:features|base)\/[^']+)';$/.exec(line);
    if (!m) continue;
    const spec = m[1];
    const pkg = spec.startsWith("./")
      ? "monaco-editor/editor/" + spec.slice(2)
      : "monaco-editor/" + spec.slice(3);
    // 최상위 .css 임포트는 exports map(`./*` → `./esm/vs/*.js`)을 통과 못 한다.
    // 내부 모듈이 전이로 끌어오므로 우리 목록에서는 뺀다.
    if (pkg.endsWith(".css")) continue;
    out.push(pkg.replace(/\.js$/, ""));
  }
  return out;
}

function contributionsFromSetup(): string[] {
  const src = readFileSync(resolve(ROOT, "src/features/code/monaco/setup.ts"), "utf8");
  return [...src.matchAll(/^import "(monaco-editor\/(?:editor|base|features)\/[^"]+)";$/gm)].map(
    (m) => m[1],
  );
}

describe("monaco contribution list", () => {
  it("matches editor.main.js exactly", () => {
    expect(contributionsFromSetup()).toEqual(contributionsFromMonaco());
  });

  it("ships no language services (D1)", () => {
    const setup = readFileSync(resolve(ROOT, "src/features/code/monaco/setup.ts"), "utf8");
    // ts·json·css·html 의 워커 기반 서비스. 켜면 lsp_* 17커맨드와 완성·호버가
    // 두 벌 붙고 워커 페이로드가 9.2MB 늘어난다.
    expect(setup).not.toMatch(/monaco-editor\/languages\/features\//);
    expect(setup).not.toMatch(/monaco-editor\/language\//);
    // 워커도 editor.worker 하나뿐이어야 한다.
    expect([...setup.matchAll(/\?worker/g)]).toHaveLength(1);
  });

  it("installs the clipboard override before the first service lookup (A3)", () => {
    // `StandaloneServices.initialize` 는 첫 호출만 오버라이드를 받고, 언어 등록이
    // 그 첫 조회다. 순서가 뒤집히면 오류 없이 조용히 무시돼 WKWebView 에서
    // 키 입력마다 ERROR 두 줄이 되돌아온다 (감사 라운드 2026-09-11).
    const setup = readFileSync(resolve(ROOT, "src/features/code/monaco/setup.ts"), "utf8");
    const install = setup.indexOf("installClipboardService();");
    const firstLookup = setup.indexOf("registerExtraLanguages(monaco);");
    expect(install).toBeGreaterThan(-1);
    expect(firstLookup).toBeGreaterThan(install);

    const clip = readFileSync(resolve(ROOT, "src/features/code/monaco/clipboard.ts"), "utf8");
    expect(clip).toMatch(/override installWebKitWriteTextWorkaround\(\): void \{/);
    expect(clip).toMatch(/clipboardService: new SyncDescriptor\(/);
  });

  it("covers every language id we claim", () => {
    // Every id `codeLang.ts` can hand to the editor must have a grammar behind
    // it, or that extension opens silently colorless. Two sources only: Monaco's
    // own Monarch definitions (the register imports in `setup.ts`) and the two
    // we wrote by hand in `langExtra.ts`.
    const setup = readFileSync(resolve(ROOT, "src/features/code/monaco/setup.ts"), "utf8");
    const fromMonaco = new Set(
      [...setup.matchAll(/^import "monaco-editor\/languages\/definitions\/([^/]+)\/register";$/gm)].map(
        (m) => m[1],
      ),
    );
    const extra = readFileSync(resolve(ROOT, "src/features/code/monaco/langExtra.ts"), "utf8");
    const fromUs = new Set(
      [...extra.matchAll(/languages\.register\(\{ id: "([^"]+)"/g)].map((m) => m[1]),
    );

    const lang = readFileSync(resolve(ROOT, "src/features/code/codeLang.ts"), "utf8");
    const declared = lang.slice(lang.indexOf("export type CodeLangId"), lang.indexOf(";", lang.indexOf("export type CodeLangId")));
    const ids = [...declared.matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(fromMonaco.has(id) || fromUs.has(id), `no grammar registered for language id "${id}"`).toBe(true);
    }
  });

  it("hand-writes only what 0.56 actually lacks (D1a)", () => {
    // The only justification for hand-writing json/toml is that Monaco lacks
    // them. If it ever ships one, this goes red and ours should be deleted.
    const extra = readFileSync(resolve(ROOT, "src/features/code/monaco/langExtra.ts"), "utf8");
    const ours = [...extra.matchAll(/languages\.register\(\{ id: "([^"]+)"/g)].map((m) => m[1]);
    expect(ours).toEqual(["json", "toml"]);
    for (const id of ours) {
      expect(
        existsSync(resolve(ROOT, `node_modules/monaco-editor/esm/vs/languages/definitions/${id}`)),
        `Monaco now ships a "${id}" grammar — drop ours from langExtra.ts`,
      ).toBe(false);
    }
  });

  it("never imports editor.main wholesale", () => {
    const setup = readFileSync(resolve(ROOT, "src/features/code/monaco/setup.ts"), "utf8");
    // 주석에는 editor.main 이 설명으로 등장하므로 **임포트 구문만** 본다.
    const specs = [...setup.matchAll(/^import .*?["'](.+?)["'];$/gm)].map((m) => m[1]);
    expect(specs).not.toContain("monaco-editor");
    expect(specs.filter((s) => s.includes("editor.main"))).toEqual([]);
  });
});
