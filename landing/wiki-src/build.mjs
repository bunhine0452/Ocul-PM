#!/usr/bin/env node
// ============================================================
// Ocul-PM 랜딩 빌더 — 위키 · 변경 이력 · 테마 갤러리 · sitemap.xml
//
//   landing/wiki-src/*.md                        → landing/wiki/*.html
//   CHANGELOG.md                                 → landing/changelog.html
//   builtin/*.json + landing/themes/*.json       → landing/themes.html
//   위 전부 + 손으로 쓴 페이지                    → landing/sitemap.xml
//
// 의존성 0. 문서를 고치는 사람이 알아야 하는 것은 세 걸음뿐이다:
//   1) wiki-src/*.md 수정 (머리에 front-matter)
//   2) node landing/wiki-src/build.mjs
//   3) cd landing && vercel deploy --prod --yes
//
// 페이지를 새로 만들면 사이드바·이전/다음 네비·sitemap.xml 이 전부 따라온다
// — order 만 안 겹치게 주면 된다. 생성물이 넷이라 **한 번만 돌리면** 릴리스의
// 랜딩 면이 통째로 최신이 된다 (docs/RELEASE.md §4).
//
// 마크다운 렌더러는 `md.mjs` 로 나갔다 — 변경 이력이 같은 렌더러를 쓴다.
// 지원 부분집합과 front-matter 규약은 그 파일 머리에 적혀 있다.
// ============================================================

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { CALLOUT_LABELS, esc, parseFrontmatter, render, validate } from "./md.mjs";
import { buildChangelog, buildPrivacy, buildThemes } from "./pages.mjs";

const SRC = dirname(fileURLToPath(import.meta.url));
const OUT = join(SRC, "..", "wiki");
/** 저장소 루트 — CHANGELOG.md · tokens.css 를 읽는 생성기가 쓴다. */
const ROOT = join(SRC, "..", "..");
mkdirSync(OUT, { recursive: true });

// ── 로케일 ─────────────────────────────────────────────────
// 한국어는 기존 URL(`/wiki/...`)을 그대로 지킨다 — 이미 색인됐고 외부 링크도
// 걸려 있다. 영어는 `/wiki/en/...` 아래로만 새로 난다.
const LOCALES = [
  {
    code: "ko",
    srcDir: SRC,
    outDir: OUT,
    base: "/wiki",
    // 이 로케일의 랜딩 페이지 — 위키 상단 네비가 돌아가는 자리다. 영문 위키에서
    // 「Features」를 눌렀는데 한국어 랜딩이 열리면 언어가 끊긴다.
    home: "/",
    srcRepoDir: "landing/wiki-src",
    suffix: "Ocul-PM 위키",
    ui: {
      wiki: "위키",
      updated: "마지막 수정",
      onThisPage: "이 페이지에서",
      prev: "← 이전",
      next: "다음 →",
      edit: "이 문서 고치기 →",
      nav: { features: "기능", keynote: "키노트", wiki: "위키", plugin: "플러그인", download: "다운로드" },
      switchTo: "English",
    },
  },
  {
    code: "en",
    srcDir: join(SRC, "en"),
    outDir: join(OUT, "en"),
    base: "/wiki/en",
    home: "/en",
    srcRepoDir: "landing/wiki-src/en",
    suffix: "Ocul-PM Wiki",
    ui: {
      wiki: "Wiki",
      updated: "Last updated",
      onThisPage: "On this page",
      prev: "← Previous",
      next: "Next →",
      edit: "Edit this page →",
      nav: { features: "Features", keynote: "Keynote", wiki: "Wiki", plugin: "Plugin", download: "Download" },
      switchTo: "한국어",
    },
  },
];

// ── 페이지 수집 ────────────────────────────────────────────
function collect(dir) {
  let files;
  try {
    files = readdirSync(dir);
  } catch {
    return []; // 아직 없는 로케일 — 조용히 건너뛴다.
  }
  return files
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const { meta, body } = parseFrontmatter(readFileSync(join(dir, f), "utf8"));
      validate(f, body);
      return { file: basename(f, ".md"), meta, body };
    })
    .sort((a, b) => +a.meta.order - +b.meta.order);
}

for (const loc of LOCALES) loc.pages = collect(loc.srcDir);

/** `/wiki`, `/wiki/journal`, `/wiki/en`, `/wiki/en/journal` */
const urlOf = (loc, file) => (file === "index" ? loc.base : `${loc.base}/${file}`);

/** 같은 슬러그가 상대 로케일에 있으면 그리로, 없으면 그쪽 첫 페이지로. */
function counterpart(loc, file) {
  const other = LOCALES.find((l) => l.code !== loc.code);
  if (!other || !other.pages.length) return null;
  const hit = other.pages.find((p) => p.file === file);
  return { loc: other, url: urlOf(other, hit ? file : "index") };
}

// ── 템플릿 ─────────────────────────────────────────────────
const shell = (loc, page, contentHtml, tocHtml) => {
  const { ui } = loc;
  const url = urlOf(loc, page.file);
  const alt = counterpart(loc, page.file);
  const title = `${esc(page.meta.title)} — ${loc.suffix}`;
  return `<!doctype html>
<html lang="${loc.code}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<meta name="description" content="${esc(page.meta.desc)}" />
<meta name="robots" content="index, follow" />
<meta name="theme-color" content="#0a0f0c" />
<link rel="canonical" href="https://oculpm.com${url}" />
${LOCALES.filter((l) => l.pages.some((p) => p.file === page.file))
  .map((l) => `<link rel="alternate" hreflang="${l.code}" href="https://oculpm.com${urlOf(l, page.file)}" />`)
  .join("\n")}
<meta property="og:type" content="article" />
<meta property="og:site_name" content="Ocul-PM" />
<meta property="og:locale" content="${loc.code === "ko" ? "ko_KR" : "en_US"}" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${esc(page.meta.desc)}" />
<meta property="og:image" content="https://oculpm.com/og.png" />
<link rel="icon" href="/icon.svg" />
<link rel="stylesheet" href="/landing.css" />
<link rel="stylesheet" href="/wiki.css" />
</head>
<body class="wk-body">

<nav class="nav">
  <div class="nav-inner">
    <a class="nav-brand" href="${loc.home}"><img src="/icon.svg" alt="" width="22" height="22" />Ocul-PM</a>
    <span class="nav-ver" data-version>v2.14.0</span>
    <div class="nav-links">
      <a href="${loc.home === "/" ? "/#acts" : `${loc.home}#acts`}">${ui.nav.features}</a>
      <a href="/keynote">${ui.nav.keynote}</a>
      <a href="${loc.base}" style="color: var(--ink);">${ui.nav.wiki}</a>
      <a href="/plugin">${ui.nav.plugin}</a>
      <a href="https://github.com/bunhine0452/Ocul-PM" target="_blank" rel="noreferrer">GitHub</a>
    </div>
    <a class="nav-cta" href="https://github.com/bunhine0452/Ocul-PM/releases/latest" target="_blank" rel="noreferrer">${ui.nav.download}</a>
  </div>
</nav>

<div class="wk-layout">
  <aside class="wk-side">
    <div class="wk-side-title"><a href="${loc.base}">${ui.wiki}</a></div>
    ${loc.pages
      .map(
        (p) =>
          `<a class="wk-side-link${p.file === page.file ? " on" : ""}" href="${urlOf(loc, p.file)}">${esc(p.meta.title)}</a>`,
      )
      .join("\n    ")}
    <div class="wk-side-foot">
      ${alt ? `<a href="${alt.url}">${ui.switchTo} →</a>` : ""}
      <a href="https://github.com/bunhine0452/Ocul-PM/tree/main/${loc.srcRepoDir}" target="_blank" rel="noreferrer">${ui.edit}</a>
    </div>
  </aside>

  <main class="wk-main">
    <article class="wk-article">
      <h1>${esc(page.meta.title)}</h1>
      <p class="wk-updated">${ui.updated} ${esc(page.meta.updated)}</p>
      ${tocHtml}
      ${contentHtml}
    </article>
    <footer class="wk-pager">${pager(loc, page)}</footer>
  </main>
</div>

<script>
  // 네비 버전 배지 동기 (index 와 같은 스크립트)
  (function () {
    try {
      fetch('https://api.github.com/repos/bunhine0452/Ocul-PM/releases/latest', {
        headers: { Accept: 'application/vnd.github+json' },
      }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
        if (!d || !d.tag_name) return;
        var tag = String(d.tag_name).replace(/^v?/, 'v');
        document.querySelectorAll('[data-version]').forEach(function (el) { el.textContent = tag; });
      }).catch(function () {});
    } catch (e) {}
  })();
</script>
<script defer src="/_vercel/insights/script.js"></script>
</body>
</html>
`;
};

function pager(loc, page) {
  const at = loc.pages.findIndex((p) => p.file === page.file);
  const prev = loc.pages[at - 1];
  const next = loc.pages[at + 1];
  return [
    prev
      ? `<a class="wk-pg prev" href="${urlOf(loc, prev.file)}"><span>${loc.ui.prev}</span><b>${esc(prev.meta.title)}</b></a>`
      : "<span></span>",
    next
      ? `<a class="wk-pg next" href="${urlOf(loc, next.file)}"><span>${loc.ui.next}</span><b>${esc(next.meta.title)}</b></a>`
      : "<span></span>",
  ].join("\n");
}

// ── 빌드 ───────────────────────────────────────────────────
let total = 0;
for (const loc of LOCALES) {
  if (!loc.pages.length) {
    console.log(`(${loc.code}: 소스 없음 — 건너뜀)`);
    continue;
  }
  mkdirSync(loc.outDir, { recursive: true });
  for (const page of loc.pages) {
    const { html, toc } = render(page.body, CALLOUT_LABELS[loc.code] ?? CALLOUT_LABELS.ko);
    const tocHtml =
      toc.length >= 3
        ? `<nav class="wk-toc"><span>${loc.ui.onThisPage}</span>${toc.map((t) => `<a href="#${t.id}">${esc(t.text)}</a>`).join("")}</nav>`
        : "";
    writeFileSync(join(loc.outDir, `${page.file}.html`), shell(loc, page, html, tocHtml));
    console.log(`built ${loc.base.slice(1)}/${page.file}.html (${page.meta.title})`);
  }
  total += loc.pages.length;
  console.log(`  ${loc.code}: ${loc.pages.length} pages\n`);
}
console.log(`${total} pages → landing/wiki/`);

// ── 문서 페이지 (위키 밖) ──────────────────────────────────
// 변경 이력과 테마 갤러리는 소스가 위키가 아니다 (CHANGELOG.md · 테마 JSON).
// 그래도 **여기서** 굽는다 — sitemap 을 쓰는 곳이 하나여야 셋이 어긋나지 않는다.
const changelog = buildChangelog(ROOT);
console.log(
  `built changelog.html (릴리스 ${changelog.count}개, 최신 ${changelog.latest}, lastmod ${changelog.lastmod})`,
);
const themes = buildThemes(ROOT);
console.log(`built themes.html (내장 ${themes.builtins} + 배포 ${themes.community})`);
buildPrivacy(ROOT);
console.log("built privacy.html");

// ── sitemap.xml ────────────────────────────────────────────
// 위키 항목은 여기서 자동 생성한다. 손으로 관리하던 시절엔 페이지를 더해도
// sitemap 을 잊어 새 문서가 색인되지 않았다 (2026-08-21: 5개 누락 발견).
// 위키 밖 페이지만 아래 목록으로 남긴다 — 늘어날 일이 드물고, lastmod 를
// 사람이 판단해야 하기 때문.
// 랜딩은 두 로케일이 서로를 가리킨다 (`/` ↔ `/en`) — hreflang 을 여기서도
// 내보내야 검색엔진이 둘을 같은 문서의 번역으로 읽는다. 영문은 한 단계 낮춰
// 한국어를 정본으로 신호한다 (위키 규칙과 같다).
const LANDING_ALTERNATES = [
  { code: "ko", href: "/" },
  { code: "en", href: "/en" },
];

const STATIC_URLS = [
  {
    loc: "/",
    lastmod: "2026-09-01",
    changefreq: "weekly",
    priority: "1.0",
    alternates: LANDING_ALTERNATES,
  },
  {
    loc: "/en",
    lastmod: "2026-09-01",
    changefreq: "weekly",
    priority: "0.9",
    alternates: LANDING_ALTERNATES,
  },
  {
    loc: "/keynote",
    lastmod: "2026-09-07",
    changefreq: "monthly",
    priority: "0.8",
    alternates: [
      { code: "ko", href: "/keynote" },
      { code: "en", href: "/en/keynote" },
    ],
  },
  {
    loc: "/en/keynote",
    lastmod: "2026-09-07",
    changefreq: "monthly",
    priority: "0.7",
    alternates: [
      { code: "ko", href: "/keynote" },
      { code: "en", href: "/en/keynote" },
    ],
  },
  {
    loc: "/plugin",
    lastmod: "2026-09-07",
    changefreq: "monthly",
    priority: "0.7",
    alternates: [
      { code: "ko", href: "/plugin" },
      { code: "en", href: "/en/plugin" },
    ],
  },
  {
    loc: "/en/plugin",
    lastmod: "2026-09-07",
    changefreq: "monthly",
    priority: "0.6",
    alternates: [
      { code: "ko", href: "/plugin" },
      { code: "en", href: "/en/plugin" },
    ],
  },
  // 릴리스마다 갱신되는 유일한 면 — `changefreq: daily` 는 여기 하나뿐이다.
  // lastmod 는 CHANGELOG.md 의 마지막 커밋 날짜라 손으로 관리하지 않는다.
  { loc: "/changelog", lastmod: changelog.lastmod, changefreq: "daily", priority: "0.8" },
  { loc: "/themes", lastmod: "2026-09-02", changefreq: "weekly", priority: "0.7" },
  { loc: "/privacy", lastmod: "2026-09-02", changefreq: "monthly", priority: "0.6" },
];

const wikiUrls = LOCALES.flatMap((l) =>
  l.pages.map((p) => ({
    loc: urlOf(l, p.file),
    lastmod: p.meta.updated,
    changefreq: "monthly",
    // 위키 허브는 개별 문서보다 한 단계 높게. 영어는 한 단계 낮춰 한국어를
    // 정본으로 신호한다 (랜딩·플러그인 문서가 아직 한국어뿐이라).
    priority: (p.file === "index" ? 0.8 : 0.7) - (l.code === "ko" ? 0 : 0.1),
    alternates: LOCALES.filter((o) => o.pages.some((q) => q.file === p.file)).map((o) => ({
      code: o.code,
      href: urlOf(o, p.file),
    })),
  })),
);

const sitemap =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
  [...STATIC_URLS, ...wikiUrls]
    .map(
      (u) =>
        `  <url>\n` +
        `    <loc>https://oculpm.com${u.loc}</loc>\n` +
        (u.alternates ?? [])
          .map(
            (a) =>
              `    <xhtml:link rel="alternate" hreflang="${a.code}" href="https://oculpm.com${a.href}" />\n`,
          )
          .join("") +
        `    <lastmod>${u.lastmod}</lastmod>\n` +
        `    <changefreq>${u.changefreq}</changefreq>\n` +
        `    <priority>${Number(u.priority).toFixed(1)}</priority>\n` +
        `  </url>`,
    )
    .join("\n") +
  `\n</urlset>\n`;

writeFileSync(join(SRC, "..", "sitemap.xml"), sitemap);
console.log(`sitemap.xml → ${STATIC_URLS.length + wikiUrls.length} urls`);
