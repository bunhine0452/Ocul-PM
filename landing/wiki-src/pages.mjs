// ============================================================
// 랜딩 문서 페이지 생성기 (Osaurus 라운드 Phase 8)
//
//   CHANGELOG.md                    → landing/changelog.html
//   src/features/theme/builtin/*.json + landing/themes/*.json
//                                   → landing/themes.html
//
// 손으로 쓰는 페이지(`privacy.html` · `plugin.html`)와 **같은 셸**을 쓴다 —
// nav/footer 가 페이지마다 다르면 사이트가 아니라 문서 뭉치가 된다.
//
// 왜 생성하는가: 변경 이력은 릴리스마다 바뀌고 테마는 PR 로 늘어난다. 손으로
// 옮겨 적으면 반드시 어긋나고, 어긋난 쪽은 언제나 웹이다.
// ============================================================

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { esc, render } from "./md.mjs";

/**
 * 배지에 처음 찍히는 버전. 페이지가 뜨면 GitHub 릴리스 API 가 덮어쓰지만,
 * 그 전(또는 오프라인)에도 옛 버전이 보이면 안 된다 — `package.json` 이
 * 릴리스 체크리스트 §1 의 정본이므로 거기서 읽는다.
 */
function appVersion(root) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  return `v${pkg.version}`;
}

const OUT_CLASSES = { table: "pg-table", code: "", callout: "wk-callout" };

// ── 공용 셸 ────────────────────────────────────────────────
const NAV_LINKS = [
  ["/#acts", "기능"],
  ["/keynote", "키노트"],
  ["/wiki", "위키"],
  ["/changelog", "변경 이력"],
  ["/themes", "테마"],
  ["/plugin", "플러그인"],
];

const FOOTER_LINKS = [
  ["/keynote", "키노트"],
  ["/wiki", "위키"],
  ["/plugin", "플러그인"],
  ["/changelog", "변경 이력"],
  ["/themes", "테마"],
  ["/privacy", "개인정보"],
];

/**
 * 문서 페이지 한 장. `slug` 는 canonical URL 이자 파일명이다.
 *
 * 손으로 쓰는 페이지도 이 마크업을 그대로 복사한다 — 정적 사이트라 셸을
 * 런타임에 공유할 방법이 없고, 네 장뿐이라 생성기를 더 만들 이유도 없다.
 */
export function shell({ slug, title, desc, hero, body, active, version, script }) {
  const nav = NAV_LINKS.map(
    ([href, label]) =>
      `<a href="${href}"${href === active ? ' style="color: var(--ink);"' : ""}>${label}</a>`,
  ).join("\n      ");
  const foot = FOOTER_LINKS.map(([href, label]) => `<a href="${href}">${label}</a>`).join("\n    ");
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
<meta name="robots" content="index, follow" />
<meta name="theme-color" content="#0a0f0c" />
<link rel="canonical" href="https://oculpm.com${slug}" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="Ocul-PM" />
<meta property="og:locale" content="ko_KR" />
<meta property="og:url" content="https://oculpm.com${slug}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:image" content="https://oculpm.com/og.png" />
<link rel="icon" href="/icon.svg" />
<link rel="stylesheet" href="/landing.css" />
<link rel="stylesheet" href="/page.css" />
</head>
<body>

<nav class="nav">
  <div class="nav-inner">
    <a class="nav-brand" href="/"><img src="/icon.svg" alt="" width="22" height="22" />Ocul-PM</a>
    <span class="nav-ver" data-version>${version}</span>
    <div class="nav-links">
      ${nav}
      <a href="https://github.com/bunhine0452/Ocul-PM" target="_blank" rel="noreferrer">GitHub</a>
    </div>
    <a class="nav-lang" href="/en" hreflang="en">English</a>
    <a class="nav-cta" href="https://github.com/bunhine0452/Ocul-PM/releases/latest" target="_blank" rel="noreferrer">다운로드</a>
  </div>
</nav>

${hero}

<main class="pg-main">
  <div class="wrap">
${body}
  </div>
</main>

<footer class="footer">
  <div class="footer-inner">
    <span>© 2026 Ocul-PM</span>
    ${foot}
    <a href="https://github.com/bunhine0452/Ocul-PM" target="_blank" rel="noreferrer">GitHub</a>
    <a href="/en" hreflang="en">English</a>
    <span class="footer-spacer"></span>
    <span>로컬-우선 · 계정 없음 · 텔레메트리 없음</span>
  </div>
</footer>

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

  // 복사 버튼 (data-copy 속성) — 명령을 손으로 옮겨 적게 하지 않는다.
  document.querySelectorAll('.copy').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var text = btn.getAttribute('data-copy');
      if (!text || !navigator.clipboard) return;
      navigator.clipboard.writeText(text).then(function () {
        btn.classList.add('copied');
        setTimeout(function () { btn.classList.remove('copied'); }, 1600);
      }).catch(function () {});
    });
  });
</script>
${script ? `<script>
${script}
</script>
` : ""}<script defer src="/_vercel/insights/script.js"></script>
</body>
</html>
`;
}

const hero = (eyebrow, h1, lead) => `<header class="pg-hero">
  <div class="pg-hero-inner">
    <span class="eyebrow">${eyebrow}</span>
    <h1>${h1}</h1>
    <p class="pg-lead">${lead}</p>
  </div>
</header>`;

// ── /changelog ─────────────────────────────────────────────
/** `## v2.30.0` → `#v2-30-0`. 릴리스 노트에서 웹으로 링크할 수 있게. */
export const anchorOf = (version) => version.replace(/\./g, "-");

/** CHANGELOG.md → [{ version, body }] (최신 우선, 파일 순서 그대로). */
export function splitReleases(md) {
  const out = [];
  const lines = md.split("\n");
  let cur = null;
  for (const line of lines) {
    const h = line.match(/^##\s+(v\d+\.\d+\.\d+)\s*$/);
    if (h) {
      cur = { version: h[1], body: [] };
      out.push(cur);
      continue;
    }
    if (cur) cur.body.push(line);
  }
  return out.map((r) => ({ version: r.version, body: r.body.join("\n").trim() }));
}

/** CHANGELOG.md 가 마지막으로 바뀐 날 (git). 없으면 오늘. */
function changelogDate(root) {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cs", "--", "CHANGELOG.md"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(out)) return out;
  } catch {
    /* git 없는 환경 — 오늘로 떨어진다 */
  }
  return new Date().toISOString().slice(0, 10);
}

export function buildChangelog(root) {
  const version = appVersion(root);
  const md = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  const releases = splitReleases(md);
  if (!releases.length) throw new Error("CHANGELOG.md 에 `## vX.Y.Z` 섹션이 없습니다");

  const jump = releases
    .slice(0, 12)
    .map((r) => `<a href="#${anchorOf(r.version)}">${r.version}</a>`)
    .join("\n      ");

  const body = releases
    .map((r) => {
      const a = anchorOf(r.version);
      const { html } = render(r.body, undefined, OUT_CLASSES);
      return `    <section class="cl-rel">
      <h2 id="${a}"><a href="#${a}">${r.version}</a></h2>
      <div class="cl-body">
${html}
      </div>
    </section>`;
    })
    .join("\n");

  const page = shell({
    version,
    slug: "/changelog",
    active: "/changelog",
    title: `변경 이력 — Ocul-PM (최신 ${releases[0].version})`,
    desc: `Ocul-PM 의 전체 릴리스 노트 ${releases.length}개. 앱 안 업데이트 탭이 보여 주는 것과 같은 내용이고, 같은 파일(CHANGELOG.md)에서 나옵니다.`,
    hero: hero(
      "Changelog",
      "매주 조금씩, 꾸준히.",
      `릴리스 <b>${releases.length}개</b>의 전문입니다. 앱의 <b>설정 → 업데이트</b> 탭이 보여 주는 것과 같은 내용이고, 저장소의 <code>CHANGELOG.md</code> 한 장에서 이 페이지와 GitHub 릴리스 노트가 함께 나옵니다 — 세 곳이 어긋날 수 없습니다.`,
    ),
    body: `    <div class="pg-jump">
      ${jump}
      <a href="https://github.com/bunhine0452/Ocul-PM/releases" target="_blank" rel="noreferrer">GitHub 릴리스 →</a>
    </div>

${body}`,
  });

  writeFileSync(join(root, "landing", "changelog.html"), page);
  return { count: releases.length, latest: releases[0].version, lastmod: changelogDate(root) };
}

// ── /themes ────────────────────────────────────────────────
/** `[data-preset]` 밖의 가족 기본값 — 부분 지정 테마의 나머지 색. */
export function familyDefaults(css) {
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
  const block = (selector) => {
    const head = `${selector} {`;
    const start = css.indexOf(head);
    if (start < 0) throw new Error(`tokens.css 에 ${selector} 블록이 없습니다`);
    const end = css.indexOf("}", start);
    const out = {};
    for (const decl of strip(css.slice(start + head.length, end)).split(";")) {
      const idx = decl.indexOf(":");
      if (idx < 0) continue;
      const key = decl.slice(0, idx).trim();
      const value = decl.slice(idx + 1).trim();
      if (key.startsWith("--") && value) out[key] = value;
    }
    return out;
  };
  return { light: block(":root"), dark: block('[data-theme="dark"]') };
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/** WCAG 상대 휘도. 불투명 hex 만 — 반투명은 배경에 얹혀야 정해진다. */
function luminance(color) {
  const hex = String(color).trim().match(/^#([0-9a-fA-F]{6})$/);
  if (!hex) return null;
  const n = parseInt(hex[1], 16);
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** 카드에 찍는 본문 대비. 테스트가 4.5:1 을 막지만, **숫자를 보여 주면** 고르는
 *  쪽이 스스로 판단한다 — 눈이 아픈 테마를 받아 놓고 이유를 모르는 일이 없게. */
function contrastRatio(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  if (a === null || b === null) return null;
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

const swatch = (token, value) =>
  `<span title="${esc(token)} · ${esc(value)}" style="background:${value}"></span>`;

/** 미리보기가 쓰는 CSS 변수 — 인라인 스타일 한 줄로 카드 전체를 칠한다. */
const PREVIEW_VARS = [
  ["win", "--bg-window"],
  ["side", "--bg-sidebar"],
  ["content", "--bg-content"],
  ["card", "--bg-card"],
  ["inset", "--bg-inset"],
  ["t", "--text"],
  ["t2", "--text-2"],
  ["t3", "--text-3"],
  ["a", "--accent"],
  ["a-soft", "--accent-soft"],
  ["oa", "--text-on-accent"],
  ["bd", "--border-card"],
  ["sep", "--sep-strong"],
  ["ok", "--ok"],
  ["warn", "--warn"],
  ["danger", "--danger"],
];

/** 스와치 줄 — 배경·글자·강조·상태색을 한 줄에. */
const SWATCH_TOKENS = [
  "--bg-window",
  "--bg-card",
  "--text",
  "--text-2",
  "--accent",
  "--ok",
  "--warn",
  "--danger",
];

/**
 * 갤러리 카드 하나. `install` 이 있으면 딥링크 버튼이 붙는다.
 *
 * 미리보기는 **색 견본이 아니라 앱의 축소판**이다 — 창틀·사이드바·일지 카드·
 * diff 줄·강조 버튼까지, 실제 화면이 그 색을 쓰는 자리에 그대로 얹는다. 색을
 * 고를 때 궁금한 것은 "이 초록이 예쁜가" 가 아니라 "내 화면이 이래도 되는가"다.
 */
function themeCard(theme, defaults, install) {
  const fam = theme.family === "light" ? defaults.light : defaults.dark;
  const tok = (name) => theme.tokens?.[name] ?? fam[name] ?? "#000";
  const vars = PREVIEW_VARS.map(([k, t]) => `--th-${k}:${tok(t)}`).join(";");
  const swatches = SWATCH_TOKENS.map((n) => swatch(n, tok(n))).join("");
  const author = theme.metadata.author || "익명";
  const count = Object.keys(theme.tokens ?? {}).length;
  const ratio = contrastRatio(tok("--text"), tok("--bg-content"));
  const famLabel = theme.family === "light" ? "라이트" : "다크";
  const badge = install ? "" : `<span class="th-tagline">앱 내장</span>`;
  const facts = [
    esc(author),
    `${count}색 지정`,
    ratio ? `<span class="ratio" title="--text / --bg-content 대비 (WCAG AA 는 4.5:1)">본문 대비 ${ratio.toFixed(1)}:1</span>` : null,
  ]
    .filter(Boolean)
    .join('<span class="dot">·</span>');
  const foot = install
    ? `        <div class="pg-actions">
          <a class="pg-btn primary" href="oculpm://theme/install?url=${encodeURIComponent(install.url)}">앱에서 가져오기</a>
          <a class="pg-btn ghost" href="${install.href}" download>.json 내려받기</a>
        </div>`
    : `        <p class="th-note">설치하면 이미 있습니다 — <b>설정 → 모양</b>에서 고르세요.</p>`;
  return `      <article class="th-card" data-family="${theme.family}">
        <div class="th-prev" style="${vars}">
          <div class="th-win">
            <div class="th-top"><i class="d1"></i><i class="d2"></i><i class="d3"></i><span class="th-crumb"></span></div>
            <div class="th-body">
              <div class="th-side">
                <span class="th-nav on"></span>
                <span class="th-nav"></span>
                <span class="th-nav"></span>
                <span class="th-nav sm"></span>
              </div>
              <div class="th-main">
                <div class="th-hd"><span class="th-h1"></span><span class="th-chip"></span></div>
                <div class="th-entry">
                  <span class="th-tag"></span>
                  <span class="th-l l1"></span>
                  <span class="th-l l2"></span>
                </div>
                <div class="th-rows"><span class="th-row add"></span><span class="th-row del"></span></div>
                <div class="th-cta"><span class="th-btn"></span><span class="th-ghost"></span></div>
              </div>
            </div>
          </div>
        </div>
        <div class="th-meta">
          <div class="th-head">
            <h3>${esc(theme.metadata.name)}</h3>
            <span class="th-fam" data-fam="${theme.family}">${famLabel}</span>
            ${badge}
          </div>
          <p class="th-facts">${facts}</p>
          <div class="th-sw">${swatches}</div>
        </div>
${foot}
      </article>`;
}

/** 라이트/다크 필터. 테마가 늘면 갤러리는 목록이 아니라 **고르는 자리**가 된다. */
function filterBar(list) {
  const dark = list.filter((t) => t.family === "dark").length;
  const light = list.length - dark;
  const btn = (key, label, n, on) =>
    `<button type="button" class="th-f${on ? " on" : ""}" data-filter="${key}" aria-pressed="${on}">${label}<span>${n}</span></button>`;
  return `    <div class="th-filter">
      ${btn("all", "전체", list.length, true)}
      ${btn("dark", "다크", dark, false)}
      ${btn("light", "라이트", light, false)}
    </div>`;
}

const THEME_FILTER_JS = `  // 라이트/다크 필터 — 갤러리마다 독립이라 버튼이 속한 섹션만 건드린다.
  document.querySelectorAll('.th-filter').forEach(function (bar) {
    var grid = bar.parentElement.querySelector('.th-grid');
    if (!grid) return;
    bar.addEventListener('click', function (e) {
      var btn = e.target.closest('.th-f');
      if (!btn) return;
      var want = btn.getAttribute('data-filter');
      bar.querySelectorAll('.th-f').forEach(function (b) {
        var on = b === btn;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
      });
      grid.querySelectorAll('.th-card').forEach(function (card) {
        card.hidden = want !== 'all' && card.getAttribute('data-family') !== want;
      });
    });
  });`;

export function buildThemes(root) {
  const version = appVersion(root);
  const css = readFileSync(join(root, "src/styles/tokens.css"), "utf8");
  const defaults = familyDefaults(css);

  const builtinDir = join(root, "src/features/theme/builtin");
  const builtins = readdirSync(builtinDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJson(join(builtinDir, f)))
    .sort((a, b) => a.metadata.name.localeCompare(b.metadata.name));

  const communityDir = join(root, "landing/themes");
  const community = readdirSync(communityDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ file: f, theme: readJson(join(communityDir, f)) }))
    .sort((a, b) => a.theme.metadata.name.localeCompare(b.theme.metadata.name));

  const cards = (list) => `    <div class="th-grid">
${list.join("\n")}
    </div>`;

  const page = shell({
    version,
    slug: "/themes",
    active: "/themes",
    title: "테마 갤러리 — Ocul-PM",
    desc: `Ocul-PM 의 색을 고르고 만듭니다. 배포 테마 ${community.length}종과 내장 ${builtins.length}종을 실제 화면 축소판으로 미리 보고, 링크 한 번으로 앱에 가져옵니다. 테마는 JSON 한 장이라 PR 로 기여할 수 있습니다.`,
    hero: hero(
      "Themes",
      "색은 파일입니다.",
      `테마는 CSS 변수 이름을 그대로 쓰는 <b>JSON 한 장</b>입니다 — 내장 ${builtins.length}종도 같은 형식이라 <b>내장이 곧 예제</b>입니다. 만들고, 내보내고, 주고받고, PR 로 여기에 실을 수 있습니다.`,
    ),
    script: THEME_FILTER_JS,
    body: `    <section class="pg-sec">
      <h2 id="community">배포 테마 <span class="th-count">${community.length}</span></h2>
      <p>앱에 들어 있지 않은 테마입니다. <b>가져오기</b>를 누르면 앱이 열리고 <b>확인 창</b>이 뜹니다 — 승인하기 전에는 아무것도 바뀌지 않고, 가져와도 <b>지금 쓰는 테마는 그대로</b>입니다 (갤러리에 한 장 늘어날 뿐입니다). 앱이 없다면 <code>.json</code> 을 내려받아 두었다가 <b>설정 → 모양 → 가져오기</b> 로 열어도 같습니다.</p>
${filterBar(community.map(({ theme }) => theme))}
${cards(community.map(({ file, theme }) => themeCard(theme, defaults, { url: `https://oculpm.com/themes/${file}`, href: `/themes/${file}` })))}
      <div class="pg-quiet">
        <b>기여하기</b> — 테마 파일 한 장을 <code>landing/themes/</code> 에 올리는 PR 을 보내 주세요.
        앱의 <b>설정 → 모양</b>에서 테마를 만들고 <b>내보내기</b> 하면 그대로 쓸 수 있는 파일이 나옵니다.
        저장소 테스트가 <b>스키마·색 값·본문 대비</b>를 자동으로 검사하므로, 통과하면 다음 배포 때 이 페이지에 실립니다 —
        <a href="https://github.com/bunhine0452/Ocul-PM/tree/main/landing/themes" target="_blank" rel="noreferrer">landing/themes/</a> ·
        <a href="/wiki/settings">테마 만들기 문서 →</a>
      </div>
    </section>

    <section class="pg-sec">
      <h2 id="builtin">앱 내장 <span class="th-count">${builtins.length}</span></h2>
      <p>설치하면 바로 있는 테마입니다. 가져올 것이 없습니다 — <b>설정 → 모양</b>에서 고르거나, <b>복제해서 편집</b>으로 자기 테마의 출발점으로 씁니다.</p>
${cards(builtins.map((t) => themeCard(t, defaults, null)))}
    </section>

    <section class="pg-sec">
      <h2 id="format">형식</h2>
      <p>테마가 칠할 수 있는 것은 <b>정해진 색 토큰 목록</b>뿐입니다. 파일에 다른 무엇이 적혀 있어도 화면에 새지 않고, 값은 <code>#hex</code> · <code>rgb()</code> · <code>rgba()</code> · <code>hsl()</code> 만 받습니다. <b>적지 않은 색은 건드리지 않습니다</b> — 배경만 다섯 줄 적은 테마도 온전한 테마이고 나머지는 밝게/어둡게 기본값을 물려받습니다.</p>
      <p>강조 계열(<code>--accent*</code>)을 <b>하나도</b> 적지 않으면 사용자가 고른 강조색이 그대로 남습니다. 색 하나 바꾸려다 강조색을 잃지 않도록 한 규칙입니다.</p>
      <p>카드에 적힌 <b>본문 대비</b>는 <code>--text</code> 와 <code>--bg-content</code> 의 WCAG 대비율입니다. 저장소 테스트가 <b>4.5:1 미만인 테마를 막으므로</b>, 여기 실린 테마는 전부 본문을 읽을 수 있습니다.</p>
    </section>`,
  });

  writeFileSync(join(root, "landing", "themes.html"), page);
  return { builtins: builtins.length, community: community.length };
}

// ── /privacy ───────────────────────────────────────────────
// D6: 텔레메트리를 도입하지 않는다. 대신 **무엇이 나가고 무엇이 절대 나가지
// 않는지**를 목록으로 못박는다 — 자동화가 배경에서 LLM 을 부르게 된 이상
// (Phase 1·2) 이 페이지는 선택이 아니라 필수다.
//
// 목록은 실제 코드에서 뽑았다: `src-tauri/` 의 아웃바운드 호출 전부
// (LLM 어댑터 · updater endpoint · GitHub · fastembed 모델 · Notion 옵인).
// 새 아웃바운드를 추가하면 **여기부터** 고친다.
export function buildPrivacy(root) {
  const page = shell({
    version: appVersion(root),
    slug: "/privacy",
    active: null,
    title: "무엇이 나가고, 무엇이 절대 나가지 않는가 — Ocul-PM",
    desc: "Ocul-PM 은 계정도 서버도 텔레메트리도 없습니다. 앱에서 나가는 통신 다섯 가지와, 절대 나가지 않는 것들을 목록으로 못박습니다.",
    hero: hero(
      "Privacy",
      "무엇이 나가고,<br />무엇이 절대 나가지 않는가.",
      "「전부 로컬」은 <b>주장</b>이지 증거가 아닙니다. 그래서 목록으로 적습니다 — 앱이 여는 연결 <b>전부</b>와, 어떤 경우에도 열지 않는 것들. 계정이 없고, 우리 서버가 없고, 사용 통계와 크래시 리포트를 <b>수집하지 않습니다</b>.",
    ),
    body: `    <section class="pg-sec">
      <h2 id="ledger">나가는 것 · 안 나가는 것</h2>
      <p>왼쪽이 전부입니다. 하나는 항상(업데이트 확인), 나머지 넷은 <b>당신이 그 기능을 쓸 때만</b> 열립니다.</p>
      <div class="pv-split">
        <div class="pv-col out">
          <h3>나가는 것 — 다섯</h3>
          <p>이 다섯 말고는 없습니다.</p>
          <ul>
            <li><b>LLM 요청</b> — AI 패널에 묻거나 자동화가 돌 때. <b>당신이 고른 프로바이더</b>로만 갑니다 (Anthropic · OpenAI · Google · OpenRouter · NVIDIA NIM …). 우리를 거치지 않습니다 — 중계 서버가 없습니다.</li>
            <li><b>업데이트 확인</b> — 앱 시작과 수동 확인 시 <code>github.com</code> 의 릴리스 파일 한 장. 보내는 것은 요청 그 자체뿐입니다.</li>
            <li><b>GitHub 조회</b> — 과거 패치노트(<code>api.github.com</code>), 플러그인·스킬 번들 내려받기(<code>codeload.github.com</code>), 테마 파일(<code>raw.githubusercontent.com</code>). 눌렀을 때만.</li>
            <li><b>임베딩 모델 최초 1회</b> — 의미 검색을 처음 켤 때 <code>huggingface.co</code> 에서 모델 파일을 받아 <b>기기에 저장</b>합니다. 그 뒤로는 검색이 전부 오프라인이고, 코드가 모델에 <b>올라가지 않습니다</b> — 모델이 내려옵니다.</li>
            <li><b>Notion 연동(옵인)</b> — 켜야만 존재합니다. 인증 중계(<code>oculpm.com/api/notion/oauth</code>, 토큰을 저장하지 않는 통과 지점)와 <code>api.notion.com</code>. 켜지 않으면 이 줄은 없는 것과 같습니다.</li>
          </ul>
        </div>
        <div class="pv-col never">
          <h3>절대 안 나가는 것</h3>
          <p>기능이 아니라 구조입니다 — 보낼 코드가 없습니다.</p>
          <ul>
            <li><b>작업 일지 본문</b> — 당신이 AI 에게 그 일지를 묻는 순간을 빼고. 그때 무엇이 실리는지는 <b>설정 → 컨텍스트</b>에서 원문 그대로 볼 수 있습니다.</li>
            <li><b><code>.oculpm/</code> 파일 전부</b> — 일지 · 계획 · 세션 · 색인. 저장소 안에 있고, 당신의 git 이 아니면 아무 데도 가지 않습니다.</li>
            <li><b>소스 코드</b> — 질문에 답하려고 <b>당신이 고른 모델</b>에 실려 가는 스니펫을 빼고. 무엇을 실을지는 검색이 고르고, 실린 목록은 화면에 표시됩니다.</li>
            <li><b>API 키</b> — OS 키체인에만 들어갑니다. 데이터베이스에도, <code>localStorage</code> 에도, 설정 파일에도 쓰지 않습니다. 내보내는 설정 YAML 에도 담기지 않습니다.</li>
            <li><b>사용 통계</b> — <b>수집하지 않습니다.</b> 분석 SDK 가 앱에 들어 있지 않습니다.</li>
            <li><b>크래시 리포트</b> — <b>수집하지 않습니다.</b> 오류는 기기의 <code>oculpm.log</code> 에만 남습니다.</li>
            <li><b>계정</b> — 만들 것이 없습니다. 로그인 화면이 없습니다.</li>
          </ul>
        </div>
      </div>
    </section>

    <section class="pg-sec">
      <h2 id="automation">배경에서 도는 자동화</h2>
      <p>스케줄과 감시 자동화는 <b>당신이 없을 때</b> LLM 을 부를 수 있습니다. 그래서 세 가지를 구조로 못박았습니다.</p>
      <div class="pg-table">
        <table>
          <thead><tr><th>규칙</th><th>무엇을 막는가</th></tr></thead>
          <tbody>
            <tr><td>전부 옵인 · 기본 꺼짐</td><td>설정하지 않은 사람의 기기에서는 배경 요청이 <b>하나도</b> 일어나지 않습니다.</td></tr>
            <tr><td>배경 작업 모델을 따로 고름</td><td>「몰랐는데 돈이 나갔다」를 막습니다. 배경 모델을 고르지 않으면 자동화 UI 가 잠기고 작업은 <b>돌지 않습니다</b>.</td></tr>
            <tr><td>발동 원장</td><td>무엇이 언제 왜 돌았는지가 기록으로 남습니다 — 배경 작업이 조용히 일어나지 않습니다.</td></tr>
          </tbody>
        </table>
      </div>
      <p>오프라인이면 자동화는 실패가 아니라 <b>연기</b>됩니다. 연결되면 따라잡되, 밀린 것을 몰아서 쏟지 않습니다.</p>
    </section>

    <section class="pg-sec">
      <h2 id="verify">믿지 말고 확인하세요</h2>
      <p>코어는 MIT 로 공개돼 있습니다. 위 목록은 저장소에서 직접 셀 수 있습니다 — 아웃바운드 호출은 전부 <code>src-tauri/src/</code> 안에 있고, 프런트엔드는 네트워크를 직접 열지 않습니다.</p>
      <div class="pg-code">
        <div class="pg-code-row">
          <code>rg -n 'https://' src-tauri/src --type rust</code>
          <button class="copy" type="button" data-copy="rg -n 'https://' src-tauri/src --type rust" aria-label="명령 복사"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg></button>
        </div>
      </div>
      <p>기기 밖으로 나가는 것을 직접 보고 싶다면 Little Snitch · LuLu 같은 방화벽으로 앱을 감시해도 됩니다. 위 목록에 없는 호스트가 보이면 <a href="https://github.com/bunhine0452/Ocul-PM/issues" target="_blank" rel="noreferrer">이슈로 알려 주세요</a> — 그건 버그입니다.</p>
    </section>

    <section class="pg-sec">
      <h2 id="website">이 웹사이트</h2>
      <p>앱이 아니라 <b>oculpm.com</b> 이야기입니다. 이 사이트는 Vercel 에 정적으로 올라가 있고, 페이지 조회수를 세는 <b>Vercel Analytics</b> 스크립트가 하나 있습니다 (쿠키를 쓰지 않고 개인을 식별하지 않습니다). 상단 버전 배지는 GitHub 릴리스 API 를 한 번 부릅니다. 그 밖에 추적기·광고·폰트 CDN 이 없습니다.</p>
    </section>

    <section class="pg-sec">
      <h2 id="english">English summary</h2>
      <p>Ocul-PM is local-first: no account, no server of ours, <b>no telemetry and no crash reporting</b>. Exactly five outbound connections exist: (1) LLM requests, sent directly to <b>the provider you chose</b> — never through us; (2) update checks against GitHub releases; (3) GitHub fetches for patch notes, plugin bundles and theme files, only when you click; (4) a one-time embedding-model download from <code>huggingface.co</code> the first time you enable semantic search — the model comes down, your code never goes up; (5) Notion, only if you opt in.</p>
      <p>Never leaves the machine: your journal entries (except what you explicitly ask the AI about), everything under <code>.oculpm/</code>, your source code (except snippets you send with a question), API keys (OS keychain only), usage statistics and crash reports (<b>not collected at all</b>). Background automation is off by default, requires its own model slot so it cannot bill you silently, and logs every firing. The core is MIT-licensed — count the outbound calls yourself with <code>rg -n 'https://' src-tauri/src</code>.</p>
    </section>`,
  });

  writeFileSync(join(root, "landing", "privacy.html"), page);
  return { ok: true };
}
