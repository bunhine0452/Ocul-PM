#!/usr/bin/env node
/**
 * 릴리스 본문 — CHANGELOG 절 + 실제로 올라간 플랫폼 표 (크로스플랫폼 W4 · L-REL `#w4-release-matrix`).
 *
 * 본문의 「Downloads」 표는 **릴리스 자산 목록에서** 만든다 — 검증을 통과해 올라간 파일만
 * 표에 오르고, 빠진 비-mac 플랫폼은 무엇에서 떨어졌는지 한 줄로 남는다(D7: 사용자가 파일이
 * 왜 없는지 모른 채 헤매지 않게). CHANGELOG.md 는 여전히 「What's new」 의 유일한 원천이다
 * (docs/RELEASE.md §2).
 *
 * `### ✨ What's new` 제목은 앱이 붙잡는 닻이다 — `src/lib/updater.ts` releaseHighlights 가
 * 그 절만 잘라 업데이트 배너에 싣는다. 이름을 바꾸지 말 것.
 *
 *   node notes.mjs section --changelog CHANGELOG.md --tag vX.Y.Z [--fallback-unreleased]
 *   node notes.mjs body    --changelog CHANGELOG.md --tag vX.Y.Z --assets <자산 이름 목록> \
 *        [--excluded windows=설치 스모크,linux=E2E] [--dry-run] [--commit <sha>]
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/**
 * `## <tag>` 절의 본문 (release.yml 이 쓰던 awk 와 같은 규칙: 제목 줄이 **정확히** 같아야
 * 하고, 다음 `## ` 에서 끝난다). 없으면 `fallbackUnreleased` 일 때 `## Unreleased` 절.
 */
export function changelogSection(md, tag, { fallbackUnreleased = false } = {}) {
  const pick = (heading) => {
    const lines = md.split(/\r?\n/);
    const start = lines.findIndex((l) => l === heading);
    if (start < 0) return null;
    const body = [];
    for (const line of lines.slice(start + 1)) {
      if (line.startsWith("## ")) break;
      body.push(line);
    }
    return body.join("\n").trim();
  };
  const exact = pick(`## ${tag}`);
  if (exact !== null) return exact;
  if (fallbackUnreleased) return pick("## Unreleased") ?? "";
  return "";
}

/** 자산 이름 → 표의 한 줄. 순서가 곧 표 순서다. */
const ROWS = [
  { test: /_aarch64\.dmg$/, platform: "macOS (Apple Silicon)", update: "앱 안 자동 업데이트" },
  { test: /_x64-setup\.exe$/, platform: "Windows 10 (2004+) · 11, x64 — **베타**", update: "앱 안 자동 업데이트" },
  { test: /_amd64\.AppImage$/, platform: "Linux x86_64 — **베타** (AppImage)", update: "앱 안 자동 업데이트" },
  { test: /_amd64\.deb$/, platform: "Linux x86_64 — **베타** (Debian · Ubuntu)", update: "패키지 관리자 (새 .deb 로)" },
];

const LABEL = { windows: "Windows", linux: "Linux" };

const MAC_INSTALL = `### macOS 설치
Apple Developer ID 서명 + 공증(notarization)을 마친 빌드입니다 — \`.dmg\` 를 열고
\`Applications\` 로 끌어다 놓으면 끝입니다. \`xattr\` 같은 우회는 더 이상 필요 없습니다.

이후 버전부터는 앱 안에서 **자동 업데이트**됩니다.`;

const WINDOWS_INSTALL = `### Windows 설치 (베타)
Windows 10 2004(빌드 19041) 이상 · Windows 11, x64. 그보다 낮은 Windows 에서는 설치 파일이 안내하고 멈춥니다.

코드 서명이 없는 **베타**라 처음 실행할 때 SmartScreen 이 「Windows의 PC 보호」 창을 띄웁니다 —
**추가 정보 → 실행** 을 누르면 설치가 이어집니다. 관리자 권한 없이 사용자 폴더에 설치되고,
Visual C++ 런타임이 없는 PC 에서는 설치 파일이 그것을 먼저 깝니다(그때만 확인 창이 한 번 뜹니다).
이후 버전은 앱 안에서 자동 업데이트됩니다.`;

const LINUX_INSTALL = `### Linux 설치 (베타)
x86_64, glibc 2.35 이상(Ubuntu 22.04 · Debian 12 이후). 그래픽 라이브러리 libEGL · libGLESv2 가 필요합니다(데스크톱에는 대개 이미 있습니다).

- **AppImage** — \`chmod +x Ocul-PM_*_amd64.AppImage\` 뒤 실행. FUSE 2 가 필요합니다
  (Ubuntu 22.04 \`libfuse2\` · 24.04 \`libfuse2t64\`). 앱 안에서 자동 업데이트됩니다.
- **deb** — \`sudo apt install ./Ocul-PM_*_amd64.deb\`. 업데이트는 새 \`.deb\` 를 같은 방법으로 설치합니다
  (앱 안 자동 업데이트 대상이 아닙니다).`;

/**
 * 본문 전체. `assets` 는 릴리스에 실제로 올라간 자산 이름, `excluded` 는
 * `{ windows: "설치 스모크" }` 처럼 빠진 플랫폼과 떨어진 단계.
 */
export function composeBody({ tag, whatsNew, assets, excluded = {}, dryRun = false, commit = "" }) {
  const out = [];
  out.push(`## Ocul-PM ${tag}`, "");
  if (dryRun) {
    out.push(
      `> **[드라이런]** release.yml 을 태그 없이 검증하는 draft 입니다 — 공개되지 않고 \`releases/latest\` 도 움직이지 않습니다.${commit ? ` 커밋 \`${commit}\`.` : ""}`,
      "",
    );
  }
  out.push("### ✨ What's new", whatsNew?.trim() || "_(CHANGELOG 에 이 버전의 절이 없습니다)_", "");
  out.push("### Downloads", "| Platform | File | 업데이트 |", "|---|---|---|");
  for (const row of ROWS) {
    const name = assets.find((a) => row.test.test(a));
    if (name) out.push(`| ${row.platform} | \`${name}\` | ${row.update} |`);
  }
  out.push("");
  for (const [platform, stage] of Object.entries(excluded)) {
    out.push(
      `> **이번 버전에는 ${LABEL[platform] ?? platform} 빌드가 없습니다.** 릴리스 검증의 「${stage}」 단계를 통과하지 못해 올리지 않았습니다 — ` +
        `${LABEL[platform] ?? platform} 앱은 이 버전을 건너뛰고, 다음 버전에서 자동 업데이트가 이어집니다.`,
      "",
    );
  }
  out.push(MAC_INSTALL, "");
  if (assets.some((a) => /_x64-setup\.exe$/.test(a))) out.push(WINDOWS_INSTALL, "");
  if (assets.some((a) => /_amd64\.(AppImage|deb)$/.test(a))) out.push(LINUX_INSTALL, "");
  return `${out.join("\n").trimEnd()}\n`;
}

/** `windows=설치 스모크,linux=E2E` → `{ windows: "설치 스모크", linux: "E2E" }`. */
export function parseExcluded(spec) {
  const out = {};
  for (const part of (spec ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const eq = part.indexOf("=");
    out[eq < 0 ? part : part.slice(0, eq)] = eq < 0 ? "검증" : part.slice(eq + 1);
  }
  return out;
}

function main(argv) {
  const [command, ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    options: {
      changelog: { type: "string" },
      tag: { type: "string" },
      assets: { type: "string" },
      excluded: { type: "string" },
      "fallback-unreleased": { type: "boolean" },
      "dry-run": { type: "boolean" },
      commit: { type: "string" },
    },
  });
  const md = readFileSync(values.changelog, "utf8");
  const dryRun = Boolean(values["dry-run"]);
  if (command === "section") {
    process.stdout.write(`${changelogSection(md, values.tag, { fallbackUnreleased: Boolean(values["fallback-unreleased"]) })}\n`);
    return 0;
  }
  if (command === "body") {
    const assets = readFileSync(values.assets, "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const whatsNew = changelogSection(md, values.tag, { fallbackUnreleased: dryRun });
    process.stdout.write(
      composeBody({ tag: values.tag, whatsNew, assets, excluded: parseExcluded(values.excluded), dryRun, commit: values.commit ?? "" }),
    );
    return 0;
  }
  throw new Error(`알 수 없는 명령: ${command ?? "(없음)"} — section | body`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(`::error::notes — ${e.message}`);
    process.exitCode = 1;
  }
}
