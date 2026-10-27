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
 *   SECURITY.md — 「외부 리뷰 이력」 의 「반영: 다음 릴리스」 를 이 버전으로 (있을 때만)
 *
 * 알리는 것: 마지막 외부 리뷰 반영에서 마이너 5개째면 경고 — 막지 않는다 (RELEASE.md §0-1).
 *
 * 고치지 **않는** 곳: 변경 이력 `<li>` 와 FAQ 의 "vX.Y.Z 부터는" — 역사다.
 * `--title-*` 을 주면 ap-new 줄의 제목도 바꾼다(안 주면 버전만). Cargo.lock 은
 * `cargo test` 가 갱신한다 — 그 뒤 둘 다 커밋한다.
 *
 * 순수 함수는 export 하고 CLI 는 그것만 부른다 (`src/__tests__/bump_version.test.ts`).
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
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
 * 릴리스 리듬 (docs/RELEASE.md §0-2) — 두 경고, 둘 다 막지 않는다.
 *
 *  - 같은 날 둘째 릴리스: 10-24 에 v3.13.4~v3.13.7 넷이 하루에 나갔다 — 앞 판을
 *    확인하지 않고 다음 판을 낸 흔적이다.
 *  - 마이너 bump 때 육안 확인 대기(`- [ ] … {#eyes-…}`)가 남아 있으면 그 수를
 *    말한다. 확인 날은 마이너 전날이다 (`docs/PROMISE.md` 약속 9).
 */

/** 마이너(또는 메이저)가 오르는 bump 인가. 패치는 자유다. */
export function isMinorBump(from, to) {
  const [fM, fm] = from.split(".").map(Number);
  const [tM, tm] = to.split(".").map(Number);
  return tM > fM || (tM === fM && tm > fm);
}

/**
 * `git tag --format='%(refname:short) %(creatordate:short)'` 출력에서 `day`(YYYY-MM-DD)
 * 에 만들어진 태그 이름들. 입력이 비거나 모양이 다르면 빈 배열 — 경고가 조용히
 * 죽는 쪽이 아니라 **안 뜨는** 쪽으로 실패한다는 뜻이니, 호출측이 day 를 꼭 넘긴다.
 */
export function tagsCutOn(tagLines, day) {
  return tagLines
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(/\s+/))
    .filter(([, d]) => d === day)
    .map(([t]) => t);
}

/**
 * 활성 플랜들에서 미확인 육안 항목을 센다. 입력은 `[{ id, text }]` (파일명 → 본문);
 * `status: active` 가 아닌 플랜은 건너뛴다 (잠긴 플랜의 미완은 plan_status 가 따로 말한다).
 * 반환은 `[{ plan, count }]`, count 0 은 뺀다.
 */
export function pendingEyes(plans) {
  const out = [];
  for (const { id, text } of plans) {
    if (!/^status:\s*active\s*$/m.test(text)) continue;
    const count = (text.match(/^\s*- \[ \][^\n]*\{#eyes-[^}]*\}\s*$/gm) ?? []).length;
    if (count > 0) out.push({ plan: id, count });
  }
  return out;
}

/** 저장소의 `.oculpm/planner/*.md` 를 `pendingEyes` 입력 모양으로. 폴더가 없으면 빈 배열. */
export function readPlans(plannerDir) {
  let names;
  try {
    names = readdirSync(plannerDir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith(".md") && !n.endsWith(".log.md"))
    .map((n) => ({ id: n.slice(0, -3), text: readFileSync(plannerDir + n, "utf8") }));
}

/** 오늘(로컬) YYYY-MM-DD. */
export function todayIso(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
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

/** 외부 리뷰 주기 (docs/RELEASE.md §0-1) — 이만큼 마이너가 쌓이면 알린다. 막지는 않는다. */
export const REVIEW_EVERY_MINORS = 5;

/** SECURITY.md 「외부 리뷰 이력」 표의 행 — 날짜로 시작하는 줄. 마지막 칸이 「반영」. */
const REVIEW_ROW = /^\|\s*\d{4}-\d{2}-\d{2}\s*\|/;

/**
 * 「반영」 칸이 `다음 릴리스` 인 행에 이번 버전을 채운다. 고친 것이 main 에 합류한 뒤
 * 그렇게 적어 두는 규약이라, 버전을 올리는 이 순간이 곧 그 릴리스다.
 */
export function stampPendingReviews(securityMd, to) {
  return securityMd
    .split("\n")
    .map((line) => (REVIEW_ROW.test(line) ? line.replace(/\|\s*다음 릴리스\s*\|\s*$/, `| v${to} |`) : line))
    .join("\n");
}

/**
 * 「반영」 칸에서 가장 높은 버전과, `to` 가 그보다 마이너 몇 개 앞섰는지. 메이저가 바뀌었으면
 * Infinity. 표를 못 읽으면 `last: null` — 표 모양이 바뀌어 경고가 조용히 죽지 않게 한다.
 * 리뷰 칸은 보지 않는다 — 「v3.8.0 이 막지 못한…」 같은 글이 반영 버전으로 읽히면 안 된다.
 */
export function reviewGap(securityMd, to) {
  const versions = securityMd
    .split("\n")
    .filter((line) => REVIEW_ROW.test(line))
    .map((line) => line.trim().replace(/\|$/, "").split("|").pop())
    .flatMap((cell) => [...cell.matchAll(/v(\d+)\.(\d+)\.(\d+)/g)].map((m) => m.slice(1, 4).map(Number)));
  if (versions.length === 0) return { last: null, minors: null };
  const last = versions.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]).at(-1);
  const [major, minor] = to.split(".").map(Number);
  return { last: last.join("."), minors: major === last[0] ? minor - last[1] : Infinity };
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
  const security = readFileSync(ROOT + "SECURITY.md", "utf8");
  const stamped = stampPendingReviews(security, to);
  if (stamped !== security) writes.push(["SECURITY.md", stamped]);

  for (const [rel, out] of writes) {
    if (!dry) writeFileSync(ROOT + rel, out);
    console.log(`${dry ? "would write" : "wrote"} ${rel}`);
  }
  for (const [path, lines] of leftovers) {
    console.log(`${path}: v${from} still on lines ${lines.join(", ") || "(none)"} — 변경 이력·FAQ 면 정상`);
  }
  const { last, minors } = reviewGap(stamped, to);
  if (last === null) {
    console.warn(`\n⚠ SECURITY.md 「외부 리뷰 이력」 표를 읽지 못했습니다 — 리뷰 주기를 판정할 수 없습니다 (docs/RELEASE.md §0-1)`);
  } else if (minors >= REVIEW_EVERY_MINORS) {
    console.warn(`\n⚠ 마지막 외부 리뷰 반영은 v${last} — v${to} 는 그 뒤 마이너 ${minors === Infinity ? "메이저 변경" : `${minors}개째`}입니다. 다음 리뷰를 청할 때입니다 (docs/RELEASE.md §0-1). 릴리스는 막지 않습니다.`);
  }
  // 릴리스 리듬 (RELEASE.md §0-2) — 둘 다 알리기만.
  let tagLines = "";
  try {
    tagLines = execFileSync("git", ["tag", "--format=%(refname:short) %(creatordate:short)"], { cwd: ROOT, encoding: "utf8" });
  } catch {
    console.warn(`\n⚠ git tag 를 읽지 못했습니다 — 같은 날 릴리스 수를 판정할 수 없습니다 (docs/RELEASE.md §0-2)`);
  }
  const today = tagsCutOn(tagLines, todayIso());
  if (today.length > 0) {
    console.warn(`\n⚠ 오늘 이미 ${today.join(", ")} 를 냈습니다 — v${to} 는 같은 날 ${today.length + 1}번째입니다. 앞 판을 확인했습니까? (docs/RELEASE.md §0-2). 릴리스는 막지 않습니다.`);
  }
  if (isMinorBump(from, to)) {
    const eyes = pendingEyes(readPlans(ROOT + ".oculpm/planner/"));
    const total = eyes.reduce((n, e) => n + e.count, 0);
    if (total > 0) {
      console.warn(`\n⚠ 마이너 릴리스인데 육안 확인 대기(eyes)가 ${total}건 남아 있습니다 — ${eyes.map((e) => `${e.plan} ${e.count}`).join(" · ")}. 마이너 전날이 확인 날입니다 (docs/RELEASE.md §0-2 · docs/PROMISE.md 약속 9). 릴리스는 막지 않습니다.`);
    }
  }
  console.log(`\n${from} → ${to}. 다음: CHANGELOG.md 에 "## v${to}" · README ko/en · 랜딩 <li>/bento/FAQ · cargo test(Cargo.lock) · node landing/wiki-src/build.mjs`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv);
}
