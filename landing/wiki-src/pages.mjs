// ============================================================
// 랜딩 문서 페이지 생성기 (Osaurus 라운드 Phase 8)
//
//   CHANGELOG.md                    → landing/changelog.html
//   (privacy 원장)                   → landing/privacy.html
//
// 손으로 쓰는 페이지(`privacy.html` · `plugin.html`)와 **같은 셸**을 쓴다 —
// nav/footer 가 페이지마다 다르면 사이트가 아니라 문서 뭉치가 된다.
//
// 왜 생성하는가: 변경 이력은 릴리스마다 바뀐다. 손으로 옮겨 적으면 반드시
// 어긋나고, 어긋난 쪽은 언제나 웹이다. (테마 갤러리 `/themes` 는 2026-10-24
// 원격 테마 설치와 함께 걷었다 — vercel.json 이 옛 주소를 위키로 보낸다.)
// ============================================================

import { readFileSync, writeFileSync } from "node:fs";
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
  ["/plugin", "플러그인"],
];

const FOOTER_LINKS = [
  ["/keynote", "키노트"],
  ["/wiki", "위키"],
  ["/plugin", "플러그인"],
  ["/changelog", "변경 이력"],
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

// ── /privacy ───────────────────────────────────────────────
// D6: 텔레메트리를 도입하지 않는다. 대신 **무엇이 나가고 무엇이 절대 나가지
// 않는지**를 목록으로 못박는다.
//
// 목록은 실제 코드에서 뽑았다: `src-tauri/tests/egress_inventory.rs` 의 원장 —
// 4.0 에서 남은 것은 updater endpoint 와 OS 브라우저에 넘기는 링크뿐이다
// (앱 안 LLM · GitHub 조회 · 번들 내려받기 · 임베딩 모델은 4.0 에서 걷었다).
// 새 아웃바운드를 추가하면 **여기부터** 고친다.
export function buildPrivacy(root) {
  const page = shell({
    version: appVersion(root),
    slug: "/privacy",
    active: null,
    title: "무엇이 나가고, 무엇이 절대 나가지 않는가 — Ocul-PM",
    desc: "Ocul-PM 은 계정도 서버도 텔레메트리도 없고, 앱은 LLM 을 부르지 않습니다. 앱에서 나가는 것 두 가지와, 절대 나가지 않는 것들을 목록으로 못박습니다.",
    hero: hero(
      "Privacy",
      "무엇이 나가고,<br />무엇이 절대 나가지 않는가.",
      "「전부 로컬」은 <b>주장</b>이지 증거가 아닙니다. 그래서 목록으로 적습니다 — 앱이 여는 연결 <b>전부</b>와, 어떤 경우에도 열지 않는 것들. 계정이 없고, 우리 서버가 없고, 사용 통계와 크래시 리포트를 <b>수집하지 않습니다</b>.",
    ),
    body: `    <section class="pg-sec">
      <h2 id="ledger">나가는 것 · 안 나가는 것</h2>
      <p>왼쪽이 전부입니다. <b>앱은 LLM 을 부르지 않고</b>, 화면(웹뷰)은 바깥 호스트에 닿지 않습니다 — 4.0 에서 앱 안 AI · GitHub 조회 · 번들 내려받기 · 임베딩 모델을 전부 걷었습니다.</p>
      <div class="pv-split">
        <div class="pv-col out">
          <h3>나가는 것 — 두 갈래</h3>
          <p>이 두 갈래 말고는 없습니다. 둘 다 당신이 시작합니다.</p>
          <ul>
            <li><b>업데이트 확인</b> — 앱 시작과 수동 확인 시 <code>github.com</code> 의 릴리스 파일 한 장. 목적지는 앱 설정(<code>tauri.conf.json</code>)에 고정돼 있고, 받은 것은 서명을 검증합니다. 보내는 것은 요청 그 자체뿐입니다.</li>
            <li><b>당신이 누른 링크</b> — 저장소 · 이슈 · 릴리스 페이지 같은 링크는 앱이 보내지 않고 <b>OS 의 기본 브라우저</b>에 넘깁니다. <code>http</code> · <code>https</code> · <code>mailto</code> 가 아닌 주소는 거절합니다.</li>
          </ul>
          <p>여기에 더해, <b>앱이 당신 대신 띄우는 도구</b>는 그 도구 자신의 동작을 합니다 — 설정에 적은 외부 편집기 명령, 변경 화면이 읽는 로컬 <code>git</code>. 앱이 띄우는 하위 프로세스는 자리마다 「송출 가능 / 로컬」로 분류해 원장(<code>egress_spawn_ledger.rs</code>)에 묶어 두었습니다.</p>
        </div>
        <div class="pv-col never">
          <h3>절대 안 나가는 것</h3>
          <p>기능이 아니라 구조입니다 — 보낼 코드가 없습니다.</p>
          <ul>
            <li><b>작업 일지 · 계획</b> — 앱은 그것을 어디에도 보내지 않습니다. 에이전트가 읽는 것은 당신의 터미널에서 도는 에이전트의 일입니다.</li>
            <li><b><code>.oculpm/</code> 파일 전부</b> — 일지 · 계획 · 세션 · 캐시. 저장소 안에 있고, 당신의 git 이 아니면 아무 데도 가지 않습니다.</li>
            <li><b>소스 코드</b> — 앱 안에 LLM 클라이언트가 없습니다.</li>
            <li><b>API 키</b> — 앱이 받지 않습니다. 3.x 가 키체인에 남긴 항목은 앱이 더 읽지도 지우지도 않습니다.</li>
            <li><b>사용 통계</b> — <b>수집하지 않습니다.</b> 분석 SDK 가 앱에 들어 있지 않습니다.</li>
            <li><b>크래시 리포트</b> — <b>수집하지 않습니다.</b> 오류는 기기의 <code>oculpm.log</code> 에만 남습니다.</li>
            <li><b>계정</b> — 만들 것이 없습니다. 로그인 화면이 없습니다.</li>
          </ul>
        </div>
      </div>
    </section>

    <section class="pg-sec">
      <h2 id="verify">믿지 말고 확인하세요</h2>
      <p>코어는 MIT 로 공개돼 있습니다. 위 목록은 저장소에서 직접 셀 수 있고, 빌드가 지킵니다 — <code>src-tauri/tests/egress_inventory.rs</code> 가 원장에 없는 새 송출을 빌드에서 막고, <code>webview_csp.rs</code> 가 화면의 <code>connect-src</code> 에 바깥 호스트가 돌아오면 실패합니다.</p>
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
      <p>Ocul-PM is local-first: no account, no server of ours, <b>no telemetry and no crash reporting</b> — and since 4.0 <b>the app calls no LLM</b> and its screens (the webview) reach no outside host. Exactly two kinds of outbound connection exist, and you start both: (1) update checks against a GitHub release file, whose destination is fixed in the app configuration and whose signature is verified; (2) links you click, which the app hands to your OS default browser (only http, https and mailto). Tools the app launches for you do their own thing: the external-editor command you configured and the local <code>git</code> the Diff screen reads.</p>
      <p>Never leaves the machine: your journal entries and plans, everything under <code>.oculpm/</code>, your source code (there is no LLM client in the app), usage statistics and crash reports (<b>not collected at all</b>). The app takes no API key. The core is MIT-licensed — the build keeps this list honest: <code>src-tauri/tests/egress_inventory.rs</code> fails on any outbound call that is not in its ledger, and <code>webview_csp.rs</code> fails if an outside host returns to the webview's <code>connect-src</code>.</p>
    </section>`,
  });

  writeFileSync(join(root, "landing", "privacy.html"), page);
  return { ok: true };
}
