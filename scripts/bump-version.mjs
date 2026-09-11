#!/usr/bin/env node
/**
 * 버전 올리기 — 한 번에 (감사 라운드 2026-09-11 F3).
 *
 * docs/RELEASE.md 가 적어 둔 자리를 손으로 고치다가 버전 파일 하나를 빠뜨려
 * 게이트가 붉게 난 일이 v2.10.3 · v2.40.0 두 번, 영문 랜딩을 두고 온 일이
 * v2.40.0 에 있었다. 이 스크립트가 그 자리를 **전부** 고치고, 자리 수가 예상과
 * 다르면 아무것도 쓰지 않고 멈춘다.
 *
 *   node scripts/bump-version.mjs 2.48.0 [--title-ko "…"] [--title-en "…"] [--dry-run]
 *
 * 고치는 곳:
 *   버전 파일 6 — package.json · src-tauri/tauri.conf.json · src-tauri/Cargo.toml ·
 *     plugin/oculpm/.claude-plugin/plugin.json · plugin/oculpm-codex/.codex-plugin/plugin.json ·
 *     .claude-plugin/marketplace.json(plugins[0])
 *   랜딩 ko·en 각 6 — JSON-LD softwareVersion · nav-ver · ap-new 줄 · 다운로드 버튼 2 · CTA eyebrow
 *
 * 고치지 **않는** 곳: 변경 이력 `<li>` 와 FAQ 의 "vX.Y.Z 부터는" — 역사다.
 * `--title-*` 을 주면 ap-new 줄의 제목도 바꾼다(안 주면 버전만). Cargo.lock 은
 * `cargo test` 가 갱신한다 — 그 뒤 둘 다 커밋한다.
 *
 * 순수 함수는 export 하고 CLI 는 그것만 부른다 (`src/__tests__/bump_version.test.ts`).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = new URL("..", import.meta.url).pathname;

const SEMVER = /^\d+\.\d+\.\d+$/;

function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 정확히 `expected` 번 바꾼다. 어긋나면 throw — 조용히 반만 고치지 않는다. */
function replaceExactly(text, re, replacement, expected, label) {
  const n = (text.match(re) ?? []).length;
  if (n !== expected) {
    throw new Error(`${label}: expected ${expected} site(s), found ${n}`);
  }
  return text.replace(re, replacement);
}

/** 6 버전 파일 중 하나. JSON 은 첫 `"version": "OLD"` 만, Cargo 는 `^version = "OLD"`. */
export function bumpVersionFile(path, text, from, to) {
  if (path.endsWith("Cargo.toml")) {
    return replaceExactly(text, new RegExp(`^version = "${esc(from)}"$`, "m"), `version = "${to}"`, 1, path);
  }
  if (path.endsWith("marketplace.json")) {
    // plugins[0].version — 파일에 그 하나뿐이다.
    return replaceExactly(text, new RegExp(`"version": "${esc(from)}"`, "g"), `"version": "${to}"`, 1, path);
  }
  // package.json · tauri.conf.json · plugin.json ×2 — 최상위 "version" 하나.
  return replaceExactly(text, new RegExp(`^  "version": "${esc(from)}",$`, "m"), `  "version": "${to}",`, 1, path);
}

/**
 * 랜딩 한 언어. `lang` 이 "ko" 면 `vX 받기`, "en" 이면 `Get vX`. `title` 을
 * 주면 ap-new 줄의 " — 제목" 도 바꾼다.
 */
export function bumpLanding(html, from, to, lang, title) {
  let out = html;
  out = replaceExactly(out, new RegExp(`"softwareVersion": "${esc(from)}"`, "g"), `"softwareVersion": "${to}"`, 1, `${lang} softwareVersion`);
  out = replaceExactly(out, new RegExp(`(<span class="nav-ver" data-version>)v${esc(from)}(</span>)`, "g"), `$1v${to}$2`, 1, `${lang} nav-ver`);
  out = replaceExactly(
    out,
    new RegExp(`(<span class="ap-new">NEW</span>&nbsp; )v${esc(from)}( — )([^<]*)(</a>)`, "g"),
    (_m, pre, dash, oldTitle, post) => `${pre}v${to}${dash}${title ?? oldTitle}${post}`,
    1,
    `${lang} ap-new`,
  );
  const button = lang === "ko" ? new RegExp(`(<span class="lg">)v${esc(from)}( 받기</span>)`, "g") : new RegExp(`(<span class="lg">Get )v${esc(from)}(</span>)`, "g");
  out = replaceExactly(out, button, `$1v${to}$2`, 2, `${lang} download buttons`);
  out = replaceExactly(out, new RegExp(`(<span class="eyebrow reveal">)v${esc(from)}( — )`, "g"), `$1v${to}$2`, 1, `${lang} eyebrow`);
  return out;
}

/** 랜딩에 남은 옛 버전 문자열의 줄 번호 — 변경 이력·FAQ 만 남는 것이 정상이다. */
export function leftoverLines(html, from) {
  const re = new RegExp(`\\bv?${esc(from)}\\b`);
  return html
    .split("\n")
    .map((line, i) => (re.test(line) ? i + 1 : null))
    .filter((n) => n !== null);
}

export const VERSION_FILES = [
  "package.json",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
  "plugin/oculpm/.claude-plugin/plugin.json",
  "plugin/oculpm-codex/.codex-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
];

export const LANDINGS = [
  { path: "landing/index.html", lang: "ko" },
  { path: "landing/en/index.html", lang: "en" },
];

function currentVersion() {
  return JSON.parse(readFileSync(ROOT + "package.json", "utf8")).version;
}

function main(argv) {
  const args = argv.slice(2);
  const to = args.find((a) => !a.startsWith("--"));
  const dry = args.includes("--dry-run");
  const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  if (!to || !SEMVER.test(to)) {
    console.error("usage: node scripts/bump-version.mjs X.Y.Z [--title-ko …] [--title-en …] [--dry-run]");
    process.exit(2);
  }
  const from = currentVersion();
  if (from === to) {
    console.error(`already at ${to}`);
    process.exit(2);
  }
  const titles = { ko: flag("--title-ko"), en: flag("--title-en") };

  // 전부 메모리에서 먼저 — 하나라도 어긋나면 디스크는 그대로다.
  const writes = [];
  for (const rel of VERSION_FILES) {
    const text = readFileSync(ROOT + rel, "utf8");
    writes.push([rel, bumpVersionFile(rel, text, from, to)]);
  }
  const leftovers = [];
  for (const { path, lang } of LANDINGS) {
    const html = readFileSync(ROOT + path, "utf8");
    const out = bumpLanding(html, from, to, lang, titles[lang]);
    writes.push([path, out]);
    leftovers.push([path, leftoverLines(out, from)]);
  }

  for (const [rel, out] of writes) {
    if (!dry) writeFileSync(ROOT + rel, out);
    console.log(`${dry ? "would write" : "wrote"} ${rel}`);
  }
  for (const [path, lines] of leftovers) {
    console.log(`${path}: v${from} still on lines ${lines.join(", ") || "(none)"} — 변경 이력·FAQ 면 정상`);
  }
  console.log(`\n${from} → ${to}. 다음: CHANGELOG.md 에 "## v${to}" · README ko/en · 랜딩 <li>/bento/FAQ · cargo test(Cargo.lock) · node landing/wiki-src/build.mjs`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv);
}
