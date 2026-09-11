import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { bumpLanding, bumpVersionFile, LANDINGS, leftoverLines, VERSION_FILES } from "../../scripts/bump-version.mjs";

// 감사 라운드 2026-09-11 F3 — 릴리스 버전 6파일 + 랜딩 ko/en 각 6곳을 한 번에.
// 계약: 자리 수가 어긋나면 throw(반만 고치지 않는다), 변경 이력·FAQ 는 건드리지
// 않는다, 실제 저장소 파일에 대해 dry-run 이 성립한다.

const ROOT = resolve(__dirname, "../..");
const pkgVersion = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")).version as string;

describe("bump-version", () => {
  it("bumps every version file exactly once against the real files", () => {
    for (const rel of VERSION_FILES) {
      const text = readFileSync(resolve(ROOT, rel), "utf8");
      const out = bumpVersionFile(rel, text, pkgVersion, "9.9.9");
      expect(out).not.toBe(text);
      expect((out.match(/9\.9\.9/g) ?? []).length).toBe(1);
    }
  });

  it("bumps the six landing sites per language and leaves history alone", () => {
    for (const { path, lang } of LANDINGS) {
      const html = readFileSync(resolve(ROOT, path), "utf8");
      const out = bumpLanding(html, pkgVersion, "9.9.9", lang);
      expect((out.match(/9\.9\.9/g) ?? []).length).toBe(6);
      // 남은 옛 버전은 변경 이력 <li> · FAQ 뿐 — 각 줄에 <li 나 acceptedAnswer/details 가 있다.
      const lines = out.split("\n");
      for (const n of leftoverLines(out, pkgVersion)) {
        expect(lines[n - 1]).toMatch(/<li |acceptedAnswer|<details>/);
      }
    }
  });

  it("refuses when a site count is off, and can rewrite the NEW-badge title", () => {
    const html = readFileSync(resolve(ROOT, "landing/index.html"), "utf8");
    expect(() => bumpLanding(html, "0.0.1", "9.9.9", "ko")).toThrow(/expected 1 site/);
    const out = bumpLanding(html, pkgVersion, "9.9.9", "ko", "새 제목");
    expect(out).toContain(`<span class="ap-new">NEW</span>&nbsp; v9.9.9 — 새 제목</a>`);
  });
});
