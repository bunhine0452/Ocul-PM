// 앱 소스에서 읽어 오는 것 — 사전(i18n)의 라벨과 navRegistry 의 화면 목록.
//
// 하네스가 라벨·화면 목록을 따로 들고 있으면 앱이 바뀔 때 조용히 어긋난다
// (화면 하나를 안 도는데도 초록). 그래서 **앱과 같은 원본**을 읽는다. TS 를
// 실행하지 않고 정규식으로 읽으므로, 모양이 바뀌면 여기서 크게 실패한다.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export function loadDict(repo, lang) {
  const src = readFileSync(join(repo, "src", "i18n", `${lang}.ts`), "utf8");
  const cache = new Map();
  return (key) => {
    if (cache.has(key)) return cache.get(key);
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = new RegExp(`"${esc}":\\s*("(?:[^"\\\\]|\\\\.)*")`).exec(src);
    if (!m) throw new Error(`사전 ${lang}.ts 에 "${key}" 가 없다 — 하네스가 앱과 어긋났다`);
    const value = JSON.parse(m[1]);
    cache.set(key, value);
    return value;
  };
}

/**
 * navRegistry.ts 의 `NAV_ENTRIES`(사이드바 행)와 `NAV_DESTINATIONS`(갈래를 펼친
 * 목적지 = 화면) 를 읽는다. 갈래(`children: AGENT_BRANCHES`)는 부모 행의 라벨을
 * 함께 들고 있어야 사이드바에서 찾아 들어갈 수 있다.
 */
export function loadNav(repo) {
  const src = readFileSync(join(repo, "src", "lib", "navRegistry.ts"), "utf8");
  const block = (name) => {
    const start = src.indexOf(`const ${name}: NavEntry[] = [`);
    if (start < 0) throw new Error(`navRegistry.ts 에서 ${name} 를 못 찾았다`);
    return src.slice(start, src.indexOf("\n];", start));
  };
  const entryRe = /\{\s*id:\s*"(\w+)",\s*labelKey:\s*"([\w.]+)"[^\n]*/g;
  const parse = (text) => [...text.matchAll(entryRe)].map((m) => ({
    id: m[1],
    labelKey: m[2],
    hasChildren: /children:\s*AGENT_BRANCHES/.test(m[0]),
  }));
  const branches = parse(block("AGENT_BRANCHES"));
  const rows = parse(block("NAV_ENTRIES"));
  const destinations = rows.flatMap((row) =>
    row.hasChildren
      ? branches.map((b) => ({ id: b.id, labelKey: b.labelKey, parentLabelKey: row.labelKey }))
      : [{ id: row.id, labelKey: row.labelKey, parentLabelKey: null }],
  );
  if (rows.length === 0 || destinations.length === 0) throw new Error("navRegistry.ts 파싱 결과가 비었다");
  return { rows, destinations };
}
