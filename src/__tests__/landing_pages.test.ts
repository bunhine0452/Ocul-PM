// Osaurus 라운드 Phase 8 — 랜딩 생성물이 소스와 어긋나지 않는지.
//
// `/changelog` 는 CHANGELOG.md 에서, `/themes` 는 테마 JSON 에서 생성된다
// (`node landing/wiki-src/build.mjs`). 릴리스에서 재생성을 잊으면 웹만 옛
// 버전에 멈춘다 — v2.8.1~2.8.3 에서 실제로 겪은 실패라 리마인더가 아니라
// 테스트로 막는다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// @ts-expect-error — 빌드 대상이 아닌 zero-dep 생성 스크립트 (.mjs, 타입 없음).
import { anchorOf, splitReleases } from "../../landing/wiki-src/pages.mjs";

const root = process.cwd();
const changelogMd = readFileSync(join(root, "CHANGELOG.md"), "utf8");
const changelogHtml = readFileSync(join(root, "landing", "changelog.html"), "utf8");
const sitemap = readFileSync(join(root, "landing", "sitemap.xml"), "utf8");
const releases = splitReleases(changelogMd) as Array<{ version: string; body: string }>;

describe("landing/changelog.html", () => {
  test("CHANGELOG.md 의 모든 릴리스가 앵커와 함께 실렸다", () => {
    expect(releases.length).toBeGreaterThan(0);
    for (const r of releases) {
      expect(
        changelogHtml,
        `${r.version} 이 changelog.html 에 없다 — node landing/wiki-src/build.mjs`,
      ).toContain(`id="${anchorOf(r.version)}"`);
    }
  });

  test("최신 릴리스가 package.json 버전과 같다", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      version: string;
    };
    expect(
      releases[0].version,
      "CHANGELOG.md 맨 위 섹션이 이번 버전이 아니다 (docs/RELEASE.md §2)",
    ).toBe(`v${pkg.version}`);
  });

  test("본문이 잘리지 않았다 — 첫 릴리스의 문장이 그대로 있다", () => {
    // 렌더러가 조용히 삼키는 회귀를 잡는다 (위키에서 겪었던 실패 모드).
    const firstWords = releases[0].body.replace(/[*`]/g, "").slice(0, 24).trim();
    expect(changelogHtml).toContain(firstWords.slice(0, 12));
  });
});

describe("landing/sitemap.xml", () => {
  test.each([
    ["/changelog", "daily"],
    ["/themes", "weekly"],
    ["/privacy", "monthly"],
    ["/plugin", "monthly"],
  ])("%s 가 changefreq %s 로 등재됐다", (loc, freq) => {
    const block = sitemap
      .split("<url>")
      .find((b) => b.includes(`<loc>https://oculpm.com${loc}</loc>`));
    expect(block, `${loc} 이 sitemap 에 없다`).toBeTruthy();
    expect(block).toContain(`<changefreq>${freq}</changefreq>`);
  });

  test("자동화 가이드가 ko/en 양쪽으로 등재됐다", () => {
    expect(sitemap).toContain("<loc>https://oculpm.com/wiki/automation</loc>");
    expect(sitemap).toContain("<loc>https://oculpm.com/wiki/en/automation</loc>");
  });
});
