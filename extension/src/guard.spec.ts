// 지키는 것 둘 — (1) 확장은 네트워크 · 자식 프로세스에 닿지 않는다, (2) 화면 글은 전부 한국어 묶음에 있다.
// 예외 하나: `bridge.ts` 가 앱 딥링크(`oculpm://`)를 `openExternal(appUri(…))` 로 연다 — 웹 주소는 아니다.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = new URL(".", import.meta.url).pathname;
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".ts") && !e.name.endsWith(".spec.ts") ? [join(dir, e.name)] : [],
  );
const shipped = files(SRC).map((f) => ({ f, src: readFileSync(f, "utf8") }));

describe("egress", () => {
  const FORBIDDEN = [
    /from\s+["'](node:)?(child_process|http|https|http2|net|tls|dgram|dns|worker_threads)["']/,
    /require\(/,
    /\bfetch\(/,
    /XMLHttpRequest|WebSocket|EventSource/,
    /https?:\/\//,
  ];
  it.each(shipped)("$f stays local", ({ f, src }) => {
    const code = src.replace(/\/\/.*$/gm, "");
    for (const re of FORBIDDEN) expect(code).not.toMatch(re);
    // 바깥으로 여는 것은 앱 딥링크 하나 — bridge.ts 의 appUri 를 거친 것만.
    const opens = code.match(/openExternal\(/g) ?? [];
    if (f.endsWith("/bridge.ts")) {
      expect(opens).toHaveLength(1);
      expect(code).toMatch(/openExternal\(appUri\(/);
    } else expect(opens).toHaveLength(0);
  });
  it("the app link only ever builds the oculpm scheme", () => {
    const link = readFileSync(join(SRC, "model", "applink.ts"), "utf8");
    expect(link).toMatch(/APP_SCHEME = "oculpm"/);
    expect(link).toMatch(/return `\$\{APP_SCHEME\}:\/\/open\?/);
  });
});

describe("l10n", () => {
  const ko = JSON.parse(readFileSync(new URL("../l10n/bundle.l10n.ko.json", import.meta.url), "utf8")) as Record<string, string>;
  const used = new Set(shipped.flatMap(({ src }) => [...src.matchAll(/\bt\("((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`) as string)));
  it("every source string has a Korean line", () => {
    expect([...used].filter((s) => !(s in ko))).toEqual([]);
  });
  it("no stale Korean lines", () => {
    expect(Object.keys(ko).filter((k) => !used.has(k))).toEqual([]);
  });
  it("the manifest strings exist in both languages", () => {
    const en = JSON.parse(readFileSync(new URL("../package.nls.json", import.meta.url), "utf8"));
    const kn = JSON.parse(readFileSync(new URL("../package.nls.ko.json", import.meta.url), "utf8"));
    expect(Object.keys(kn).sort()).toEqual(Object.keys(en).sort());
  });
});
