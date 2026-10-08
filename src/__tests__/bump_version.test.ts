import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// @ts-expect-error — 빌드 대상이 아닌 zero-dep 릴리스 스크립트 (.mjs, 타입 없음).
import { bumpLanding, bumpVersionFile, LANDINGS, leftoverLines, reviewGap, stampPendingReviews, VERSION_FILES } from "../../scripts/bump-version.mjs";

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
    const out = bumpLanding(html, pkgVersion, "9.9.9", "ko", "new title");
    expect(out).toContain(`<span class="ap-new">NEW</span>&nbsp; v9.9.9 — new title</a>`);
  });
});

// 외부 리뷰 2026-10-08 — 리뷰를 사건이 아니라 주기로 (docs/RELEASE.md §0-1).
// 계약: 「반영」 칸만 읽는다, 표를 못 읽으면 null 로 알린다, 「다음 릴리스」 는 이번 버전이 된다.
describe("bump-version — external review cadence", () => {
  const table = [
    "| 날짜 | 리뷰 | 반영 |",
    "|---|---|---|",
    "| 2026-09-15 | 첫 리뷰 | v3.2.0 |",
    "| 2026-10-07 | v3.8.0 이 막지 못한 자리 — 리뷰 칸의 v9.0.0 은 무시 | v3.9.0 |",
    "| 2026-10-08 | 아직 안 나간 수정 | 다음 릴리스 |",
    "| 2026-10-08 | 버전 없는 반영 | 범위 동결 |",
  ].join("\n");

  it("reads the highest version from the 반영 column only", () => {
    expect(reviewGap(table, "3.13.0")).toEqual({ last: "3.9.0", minors: 4 });
    expect(reviewGap(table, "3.14.0")).toEqual({ last: "3.9.0", minors: 5 });
    expect(reviewGap(table, "4.0.0").minors).toBe(Infinity);
  });

  it("stamps pending rows with the release being cut, and nothing else", () => {
    const out: string = stampPendingReviews(table, "3.10.0");
    expect(out).toContain("| 2026-10-08 | 아직 안 나간 수정 | v3.10.0 |");
    expect(out.split("\n").filter((l, i) => l !== table.split("\n")[i])).toHaveLength(1);
    expect(reviewGap(out, "3.10.0")).toEqual({ last: "3.10.0", minors: 0 });
  });

  it("says so when the table is gone, and reads the real SECURITY.md", () => {
    expect(reviewGap("# no table here", "3.10.0")).toEqual({ last: null, minors: null });
    const real = readFileSync(resolve(ROOT, "SECURITY.md"), "utf8");
    expect(reviewGap(real, pkgVersion).last).not.toBeNull();
  });
});
