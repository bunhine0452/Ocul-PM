#!/usr/bin/env node
/**
 * 설치 채널 매니페스트(packaging/) 의 version · sha256 을 릴리스 자산에서 채운다.
 *
 *   node scripts/packaging/update-manifests.mjs --dmg <경로|URL> [--exe <경로|URL>] [--date YYYY-MM-DD] [--dry-run]
 *
 *   --dmg   `Ocul-PM_<버전>_aarch64.dmg` — packaging/homebrew/ocul-pm.rb 의 version · sha256
 *   --exe   `Ocul-PM_<버전>_x64-setup.exe` — packaging/winget/ 세 파일의 버전 · 주소 · sha256 · 날짜
 *   --date  winget ReleaseDate (기본: 오늘, UTC) — 릴리스가 공개된 날을 줄 때
 *   --dry-run  파일은 안 고치고 무엇이 바뀔지만 적는다
 *
 * 인자가 URL(http · https)이면 받아서 sha256 을 잰다 — **이 스크립트를 사람이 돌릴 때만** 네트워크에 닿는다.
 * 앱 코드가 아니고 앱은 이것을 부르지 않는다(egress 원장 밖의 개발 · 릴리스 도구). 로컬 경로를 주면 아무 데도
 * 안 나간다. 한쪽만 주면 그쪽 채널만 고친다(Windows 는 베타라 공개가 늦을 수 있다).
 *
 * 버전은 파일 이름 `Ocul-PM_<버전>_…` 에서 읽는다 — 이름이 그 모양이 아니면 거절한다(다른 파일을 해시해 올리는
 * 사고를 막는다). 순수 함수는 export 하고 CLI 는 그것만 부른다(src/__tests__/packaging_manifests.test.ts).
 * 의존성 0, Node 18+.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO = "bunhine0452/Ocul-PM";

/** 저장소 루트 아래 매니페스트 네 개의 자리. */
export const filesIn = (root) => ({
  cask: path.join(root, "packaging", "homebrew", "ocul-pm.rb"),
  wingetVersion: path.join(root, "packaging", "winget", "KimHyunbin.Ocul.yaml"),
  wingetInstaller: path.join(root, "packaging", "winget", "KimHyunbin.Ocul.installer.yaml"),
  wingetLocale: path.join(root, "packaging", "winget", "KimHyunbin.Ocul.locale.en-US.yaml"),
});

const SEMVER = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?`;
const NAME = { dmg: new RegExp(`^Ocul-PM_(${SEMVER})_aarch64\\.dmg$`), exe: new RegExp(`^Ocul-PM_(${SEMVER})_x64-setup\\.exe$`) };
const SHA = /^[0-9a-f]{64}$/i;

/** 자산 이름에서 버전을 읽는다. 모양이 다르면 던진다. */
export function versionOfAsset(kind, nameOrUrl) {
  const name = decodeURIComponent(String(nameOrUrl).split(/[?#]/)[0].split(/[\\/]/).pop() ?? "");
  const m = NAME[kind].exec(name);
  if (!m) throw new Error(`${kind === "dmg" ? "Ocul-PM_<버전>_aarch64.dmg" : "Ocul-PM_<버전>_x64-setup.exe"} 모양이 아니에요: ${name}`);
  return m[1];
}

/** 한 줄(`키 값` · `키: 값`)의 값만 바꾼다. 줄이 없으면 던진다 — 조용히 안 고치는 것이 가장 나쁘다. */
function replaceLine(text, re, next, what) {
  if (!re.test(text)) throw new Error(`${what} 줄을 못 찾았어요 — 매니페스트 모양이 바뀌었나요?`);
  return text.replace(re, next);
}

export function updateCask(text, { version, sha256 }) {
  if (!SHA.test(sha256)) throw new Error(`sha256 이 64자리 16진수가 아니에요: ${sha256}`);
  let out = replaceLine(text, /^(\s*version\s+)"[^"]*"/m, `$1"${version}"`, "cask version");
  out = replaceLine(out, /^(\s*sha256\s+)"[^"]*"/m, `$1"${sha256.toLowerCase()}"`, "cask sha256");
  return out;
}

export function updateWingetVersion(text, { version }) {
  return replaceLine(text, /^PackageVersion:.*$/m, `PackageVersion: ${version}`, "PackageVersion");
}

export function updateWingetInstaller(text, { version, sha256, date }) {
  if (!SHA.test(sha256)) throw new Error(`sha256 이 64자리 16진수가 아니에요: ${sha256}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`날짜는 YYYY-MM-DD 여야 해요: ${date}`);
  let out = replaceLine(text, /^PackageVersion:.*$/m, `PackageVersion: ${version}`, "PackageVersion");
  out = replaceLine(out, /^ReleaseDate:.*$/m, `ReleaseDate: ${date}`, "ReleaseDate");
  out = replaceLine(
    out,
    /^(\s*InstallerUrl:\s*).*$/m,
    `$1https://github.com/${REPO}/releases/download/v${version}/Ocul-PM_${version}_x64-setup.exe`,
    "InstallerUrl",
  );
  return replaceLine(out, /^(\s*InstallerSha256:\s*).*$/m, `$1${sha256.toUpperCase()}`, "InstallerSha256");
}

export function updateWingetLocale(text, { version }) {
  let out = replaceLine(text, /^PackageVersion:.*$/m, `PackageVersion: ${version}`, "PackageVersion");
  out = replaceLine(out, /^ReleaseNotesUrl:.*$/m, `ReleaseNotesUrl: https://github.com/${REPO}/releases/tag/v${version}`, "ReleaseNotesUrl");
  return out;
}

async function sha256Of(source) {
  const hash = createHash("sha256");
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source, { redirect: "follow" });
    if (!res.ok || !res.body) throw new Error(`받지 못했어요(${res.status}): ${source}`);
    for await (const chunk of res.body) hash.update(chunk);
  } else {
    for await (const chunk of fs.createReadStream(source)) hash.update(chunk);
  }
  return hash.digest("hex");
}

function arg(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
}

// `root` 기본값은 CLI 로 돌 때만 평가된다(시험은 임시 폴더를 넘긴다).
export async function main(argv, root = path.resolve(import.meta.dirname, "..", "..")) {
  const FILES = filesIn(root);
  const dmg = arg(argv, "dmg");
  const exe = arg(argv, "exe");
  const dry = argv.includes("--dry-run");
  const date = arg(argv, "date") ?? new Date().toISOString().slice(0, 10);
  if (!dmg && !exe) {
    console.error("--dmg 나 --exe 가 필요해요 (경로 또는 URL). 자세히는 이 파일 머리말.");
    return 2;
  }
  const writes = [];
  if (dmg) {
    const version = versionOfAsset("dmg", dmg);
    const sha256 = await sha256Of(dmg);
    writes.push([FILES.cask, (t) => updateCask(t, { version, sha256 })]);
    console.log(`cask    ${version}  sha256 ${sha256}`);
  }
  if (exe) {
    const version = versionOfAsset("exe", exe);
    const sha256 = await sha256Of(exe);
    writes.push([FILES.wingetVersion, (t) => updateWingetVersion(t, { version })]);
    writes.push([FILES.wingetInstaller, (t) => updateWingetInstaller(t, { version, sha256, date })]);
    writes.push([FILES.wingetLocale, (t) => updateWingetLocale(t, { version })]);
    console.log(`winget  ${version}  sha256 ${sha256.toUpperCase()}  ReleaseDate ${date}`);
  }
  // 전부 계산이 끝난 뒤에 쓴다 — 중간에 던져도 반쯤 고친 매니페스트가 남지 않는다.
  const next = writes.map(([file, fn]) => [file, fn(fs.readFileSync(file, "utf8"))]);
  for (const [file, text] of next) {
    if (!dry) fs.writeFileSync(file, text);
    console.log(`${dry ? "(dry-run) " : ""}${path.relative(root, file)}`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(String(e?.message ?? e));
      process.exit(1);
    },
  );
}
