// latest.json 병합·검증과 릴리스 본문의 픽스처 테스트 (크로스플랫폼 W4 · L-REL `#w4-latest-json`).
//
//   node --test .github/scripts/release/
//
// 증명하려는 것 (D7): 비-mac 항목이 더해지고 빠지고 다시 더해져도 **macOS 업데이터가 고르는
// 항목(URL·서명)은 한 글자도 바뀌지 않는다.** 출발점은 실제 v3.5.0 의 latest.json
// (`fixtures/latest-v3.5.0.json`, tauri-action 이 쓴 그대로)이고, 업데이터의 키 선택은
// tauri-plugin-updater 2.10.1 의 get_urls 를 복제한 `pickUpdaterEntry` 로 잰다.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { MAC_KEYS, NONMAC, mergeLatest, pickUpdaterEntry, verifyLatest } from "./latest-json.mjs";
import { changelogSection, composeBody, parseExcluded } from "./notes.mjs";
import { DRYRUN_VERSION } from "./dryrun-version.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REAL = JSON.parse(readFileSync(join(HERE, "fixtures", "latest-v3.5.0.json"), "utf8"));
const TAG = "v3.5.0";
const DL = "https://github.com/bunhine0452/Ocul-PM/releases/download";
// 서명 모양만 맞춘 가짜 (base64 한 덩어리). 진짜 minisign 검증은 앱이 한다.
const SIG_WIN = Buffer.from("untrusted comment: signature from tauri secret key\nWIN").toString("base64");
const SIG_LINUX = Buffer.from("untrusted comment: signature from tauri secret key\nLINUX").toString("base64");
const WIN = { platform: "windows", assetName: "Ocul-PM_3.5.0_x64-setup.exe", signature: SIG_WIN };
const LINUX = { platform: "linux", assetName: "Ocul-PM_3.5.0_amd64.AppImage", signature: SIG_LINUX };
const MAC_ASSETS = ["latest.json", "Ocul-PM_3.5.0_aarch64.dmg", "Ocul-PM_aarch64.app.tar.gz", "Ocul-PM_aarch64.app.tar.gz.sig", "ocul-pm-0.1.0.vsix"];
const ALL_ASSETS = [
  ...MAC_ASSETS,
  "Ocul-PM_3.5.0_x64-setup.exe",
  "Ocul-PM_3.5.0_x64-setup.exe.sig",
  "Ocul-PM_3.5.0_amd64.AppImage",
  "Ocul-PM_3.5.0_amd64.AppImage.sig",
  "Ocul-PM_3.5.0_amd64.deb",
];
const merge = (base, adds) => mergeLatest(base, adds, { tag: TAG, downloadBase: DL });

/** 실제 앱들이 업데이터에서 받게 될 항목 — 설치 형식별. */
const APPS = {
  macApp: { os: "darwin", arch: "aarch64", installer: "app" },
  macUnknown: { os: "darwin", arch: "aarch64", installer: null }, // 표식 없는 옛 빌드
  winNsis: { os: "windows", arch: "x86_64", installer: "nsis" },
  linuxAppImage: { os: "linux", arch: "x86_64", installer: "appimage" },
  linuxDeb: { os: "linux", arch: "x86_64", installer: "deb" },
};

describe("픽스처 — 실제 v3.5.0 latest.json", () => {
  test("지금 검증 규칙(macOS 만)을 그대로 통과한다", () => {
    assert.deepEqual(verifyLatest(REAL, { tag: TAG, assets: MAC_ASSETS }), []);
    assert.deepEqual(verifyLatest(REAL, { tag: TAG, assets: MAC_ASSETS, expect: [] }), []);
  });
  test("tauri-action 이 쓰는 macOS 키가 MAC_KEYS 와 같다", () => {
    assert.deepEqual(Object.keys(REAL.platforms).sort(), [...MAC_KEYS].sort());
  });
});

describe("병합 — macOS 항목 불변", () => {
  const both = merge(REAL, [WIN, LINUX]);

  test("비-mac 둘을 더해도 macOS 항목은 deepEqual, 입력은 그대로", () => {
    for (const key of MAC_KEYS) assert.deepEqual(both.platforms[key], REAL.platforms[key]);
    assert.deepEqual(Object.keys(REAL.platforms).sort(), [...MAC_KEYS].sort(), "base 를 변형하지 않는다");
    assert.equal(both.version, REAL.version);
    assert.equal(both.notes, REAL.notes);
    assert.equal(both.pub_date, REAL.pub_date);
  });

  test("macOS 앱이 고르는 URL·서명이 병합 전후로 같다 (.app 표식 · 표식 없는 옛 빌드 둘 다)", () => {
    for (const app of [APPS.macApp, APPS.macUnknown]) {
      assert.deepEqual(pickUpdaterEntry(both.platforms, app), pickUpdaterEntry(REAL.platforms, app));
      assert.ok(pickUpdaterEntry(REAL.platforms, app), "병합 전에도 macOS 항목이 잡힌다");
    }
  });

  test("병합 결과가 공개 직전 검증(정확한 집합 + macOS baseline)을 통과한다", () => {
    const errors = verifyLatest(both, { tag: TAG, assets: ALL_ASSETS, expect: ["windows", "linux"], macBaseline: REAL });
    assert.deepEqual(errors, []);
  });

  test("Windows NSIS 앱은 windows-x86_64-nsis 를, AppImage 는 linux-x86_64-appimage 를 받는다", () => {
    assert.equal(pickUpdaterEntry(both.platforms, APPS.winNsis).target, "windows-x86_64-nsis");
    assert.match(pickUpdaterEntry(both.platforms, APPS.winNsis).url, /\/releases\/download\/v3\.5\.0\/Ocul-PM_3\.5\.0_x64-setup\.exe$/);
    assert.equal(pickUpdaterEntry(both.platforms, APPS.linuxAppImage).target, "linux-x86_64-appimage");
    assert.equal(pickUpdaterEntry(both.platforms, APPS.linuxAppImage).signature, SIG_LINUX);
  });

  test("deb 로 깐 앱은 아무 항목도 못 받는다 — AppImage 로 떨어지지 않는다 (D10)", () => {
    assert.equal(pickUpdaterEntry(both.platforms, APPS.linuxDeb), null);
    assert.equal(both.platforms["linux-x86_64"], undefined);
    assert.equal(both.platforms["linux-x86_64-deb"], undefined);
  });

  test("떨어진 플랫폼만 빠지고 다른 쪽은 그대로 — Windows 실패", () => {
    const linuxOnly = merge(REAL, [LINUX]);
    assert.equal(pickUpdaterEntry(linuxOnly.platforms, APPS.winNsis), null);
    assert.deepEqual(pickUpdaterEntry(linuxOnly.platforms, APPS.linuxAppImage), pickUpdaterEntry(both.platforms, APPS.linuxAppImage));
    for (const key of MAC_KEYS) assert.deepEqual(linuxOnly.platforms[key], REAL.platforms[key]);
    assert.deepEqual(verifyLatest(linuxOnly, { tag: TAG, assets: ALL_ASSETS, expect: ["linux"], macBaseline: REAL }), []);
  });

  test("비-mac 이 전부 떨어지면 결과는 원래 파일과 같다", () => {
    assert.deepEqual(merge(REAL, []), REAL);
  });

  test("re-run: 앞 시도에서 실렸다가 이번에 떨어진 플랫폼은 남지 않는다 · 같은 입력이면 멱등", () => {
    const again = merge(both, [WIN]); // Linux 가 이번엔 떨어졌다
    assert.equal(again.platforms["linux-x86_64-appimage"], undefined);
    assert.deepEqual(merge(both, [WIN, LINUX]), both);
    for (const key of MAC_KEYS) assert.deepEqual(again.platforms[key], REAL.platforms[key]);
  });

  test("tauri-action 이 macOS 잡 re-run 에서 비-mac 을 보존한 파일도 다시 병합된다", () => {
    // upload-version-json.ts: 기존 latest.json 의 platforms 를 읽고 자기 키만 덮는다.
    const rerun = structuredClone(both);
    rerun.platforms["darwin-aarch64"] = { ...rerun.platforms["darwin-aarch64"] };
    assert.deepEqual(merge(rerun, [WIN, LINUX]), both);
  });
});

describe("병합 — 거부", () => {
  test("macOS 키가 없는 base 에는 병합하지 않는다", () => {
    const noApp = structuredClone(REAL);
    delete noApp.platforms["darwin-aarch64-app"];
    assert.throws(() => merge(noApp, [WIN]), /darwin-aarch64-app/);
    assert.throws(() => merge({ version: "3.5.0" }, [WIN]), /platforms/);
  });
  test("태그와 다른 version 의 base", () => {
    assert.throws(() => mergeLatest(REAL, [WIN], { tag: "v3.6.0", downloadBase: DL }), /version/);
  });
  test("업데이터 자산 이름이 버전·형식과 다르면", () => {
    assert.throws(() => merge(REAL, [{ ...WIN, assetName: "Ocul-PM_3.4.0_x64-setup.exe" }]), /x64-setup/);
    assert.throws(() => merge(REAL, [{ ...LINUX, assetName: "Ocul-PM_3.5.0_amd64.deb" }]), /AppImage/);
  });
  test("서명이 비었거나 개행·공백이 끼면", () => {
    assert.throws(() => merge(REAL, [{ ...WIN, signature: "" }]), /서명/);
    assert.throws(() => merge(REAL, [{ ...WIN, signature: `${SIG_WIN}\n` }]), /서명/);
  });
  test("모르는 플랫폼", () => {
    assert.throws(() => merge(REAL, [{ platform: "freebsd", assetName: "x", signature: SIG_WIN }]), /freebsd/);
  });
});

describe("검증 — 잡아야 할 것", () => {
  const both = merge(REAL, [WIN, LINUX]);
  const check = (doc, opts = {}) => verifyLatest(doc, { tag: TAG, assets: ALL_ASSETS, ...opts });

  test("platforms 가 비었다 (지금 검증의 첫 규칙)", () => {
    assert.match(check({ ...REAL, platforms: {} }).join("\n"), /platforms 가 비어 있다/);
  });
  test("version 이 태그와 다르다", () => {
    assert.match(check({ ...REAL, version: "3.4.0" }).join("\n"), /version/);
  });
  test("draft 의 untagged URL 이 남았다", () => {
    const doc = structuredClone(REAL);
    doc.platforms["darwin-aarch64"].url = doc.platforms["darwin-aarch64"].url.replace("/v3.5.0/", "/untagged-abc123/");
    assert.match(check(doc).join("\n"), /태그를 가리키지 않는다/);
  });
  test("가리키는 자산이 릴리스에 없다 (Windows 자산을 올리기 전에 latest.json 만 올라감)", () => {
    const errors = check(both, { assets: MAC_ASSETS });
    assert.match(errors.join("\n"), /Ocul-PM_3\.5\.0_x64-setup\.exe/);
    assert.match(errors.join("\n"), /Ocul-PM_3\.5\.0_amd64\.AppImage/);
  });
  test("macOS 항목이 병합 중에 바뀌었다 — URL 한 글자 · 서명 한 글자 · 키 하나 빠짐", () => {
    const url = structuredClone(both);
    url.platforms["darwin-aarch64-app"].url += "x";
    assert.match(check(url, { macBaseline: REAL }).join("\n"), /darwin-aarch64-app: macOS 항목이 병합 전과 다르다/);
    const sig = structuredClone(both);
    sig.platforms["darwin-aarch64"].signature = `A${sig.platforms["darwin-aarch64"].signature.slice(1)}`;
    assert.match(check(sig, { macBaseline: REAL }).join("\n"), /darwin-aarch64: macOS 항목이 병합 전과 다르다/);
    const gone = structuredClone(both);
    delete gone.platforms["darwin-aarch64"];
    assert.match(check(gone, { macBaseline: REAL }).join("\n"), /darwin-aarch64 가 없다/);
  });
  test("맨 linux-x86_64 · deb · msi 키", () => {
    const bare = structuredClone(both);
    bare.platforms["linux-x86_64"] = bare.platforms["linux-x86_64-appimage"];
    assert.match(check(bare).join("\n"), /맨 linux-x86_64/);
    const deb = structuredClone(both);
    deb.platforms["linux-x86_64-deb"] = { url: `${DL}/v3.5.0/Ocul-PM_3.5.0_amd64.deb`, signature: SIG_LINUX };
    assert.match(check(deb).join("\n"), /허용되지 않은 키: linux-x86_64-deb/);
  });
  test("통과하지 못한 플랫폼이 실려 있다 (expect 와 다름)", () => {
    assert.match(check(both, { expect: ["windows"] }).join("\n"), /\[windows\] 이어야 하는데 \[linux,windows\]/);
    assert.match(check(REAL, { expect: ["windows"] }).join("\n"), /\[windows\] 이어야 하는데 \[없음\]/);
  });
  test("Windows 두 키 중 하나만 있거나 서로 다르다", () => {
    const one = structuredClone(both);
    delete one.platforms["windows-x86_64"];
    assert.match(check(one).join("\n"), /windows: 키/);
    const diff = structuredClone(both);
    diff.platforms["windows-x86_64"] = { ...diff.platforms["windows-x86_64"], signature: SIG_LINUX };
    assert.match(check(diff).join("\n"), /서로 다른 자산·서명/);
  });
  test("signature 가 비었다", () => {
    const doc = structuredClone(REAL);
    doc.platforms["darwin-aarch64"].signature = "";
    assert.match(check(doc).join("\n"), /signature/);
  });
});

describe("CLI — release.yml 이 부르는 모양 그대로", () => {
  const cli = join(HERE, "latest-json.mjs");
  const dir = mkdtempSync(join(tmpdir(), "latest-json-"));
  const base = join(dir, "base.json");
  const out = join(dir, "merged.json");
  const assets = join(dir, "assets.txt");
  writeFileSync(base, JSON.stringify(REAL));
  writeFileSync(join(dir, WIN.assetName), "exe");
  writeFileSync(join(dir, `${WIN.assetName}.sig`), SIG_WIN);
  writeFileSync(join(dir, LINUX.assetName), "appimage");
  writeFileSync(join(dir, `${LINUX.assetName}.sig`), SIG_LINUX);
  writeFileSync(assets, `${ALL_ASSETS.join("\n")}\n`);
  const run = (args) => {
    try {
      return { code: 0, out: execFileSync(process.execPath, [cli, ...args], { encoding: "utf8" }) };
    } catch (e) {
      return { code: e.status, out: `${e.stdout}` };
    }
  };

  test("merge → verify(expect + baseline) 통과", () => {
    const m = run(["merge", "--base", base, "--out", out, "--tag", TAG, "--download-base", DL, "--add", `windows=${join(dir, WIN.assetName)}`, "--add", `linux=${join(dir, LINUX.assetName)}`]);
    assert.equal(m.code, 0, m.out);
    assert.deepEqual(JSON.parse(readFileSync(out, "utf8")), merge(REAL, [WIN, LINUX]));
    const v = run(["verify", "--file", out, "--tag", TAG, "--assets", assets, "--expect", "windows,linux", "--mac-baseline", base]);
    assert.equal(v.code, 0, v.out);
  });
  test("verify 가 붉으면 ::error:: 줄과 exit 1", () => {
    const v = run(["verify", "--file", out, "--tag", TAG, "--assets", assets, "--expect", "none"]);
    assert.equal(v.code, 1);
    assert.match(v.out, /^::error::latest\.json — 비-mac 플랫폼이/m);
  });
  test("macOS 만 (--expect 없음) — macOS 잡의 검증", () => {
    const v = run(["verify", "--file", base, "--tag", TAG, "--assets", assets]);
    assert.equal(v.code, 0, v.out);
  });
});

describe("릴리스 본문", () => {
  const md = "# Changelog\n\n## Unreleased\n\n**새 것.** 설명\n\n## v3.5.0\n\n**눌러도.** 본문\n\n- 항목\n\n## v3.4.0\n\n옛 것\n";

  test("CHANGELOG 절 — 태그와 정확히 같은 제목만, 드라이런은 Unreleased 로", () => {
    assert.equal(changelogSection(md, "v3.5.0"), "**눌러도.** 본문\n\n- 항목");
    assert.equal(changelogSection(md, "v3.5"), "");
    assert.equal(changelogSection(md, "v0.0.7", { fallbackUnreleased: true }), "**새 것.** 설명");
    assert.equal(changelogSection(md, "v0.0.7"), "");
  });

  test("표는 올라간 자산에서 — 빠진 플랫폼은 단계와 함께 한 줄", () => {
    const body = composeBody({
      tag: "v3.6.0",
      whatsNew: "본문",
      assets: ["Ocul-PM_3.6.0_aarch64.dmg", "Ocul-PM_3.6.0_amd64.AppImage", "Ocul-PM_3.6.0_amd64.deb", "latest.json"],
      excluded: parseExcluded("windows=설치 스모크"),
    });
    assert.match(body, /^### ✨ What's new\n본문$/m, "앱의 releaseHighlights 가 붙잡는 제목");
    assert.match(body, /\| macOS \(Apple Silicon\) \| `Ocul-PM_3\.6\.0_aarch64\.dmg` \|/);
    assert.match(body, /Linux x86_64 — \*\*베타\*\* \(AppImage\)/);
    assert.doesNotMatch(body, /x64-setup\.exe/);
    assert.match(body, /이번 버전에는 Windows 빌드가 없습니다\.\*\* 릴리스 검증의 「설치 스모크」/);
    assert.doesNotMatch(body, /### Windows 설치/);
    assert.match(body, /### Linux 설치 \(베타\)/);
    assert.doesNotMatch(body, /드라이런/);
  });

  test("드라이런 표시 · macOS 만", () => {
    const body = composeBody({ tag: "v0.0.9", whatsNew: "", assets: ["Ocul-PM_0.0.9_aarch64.dmg"], dryRun: true, commit: "abc" });
    assert.match(body, /\[드라이런\]/);
    assert.doesNotMatch(body, /베타/);
  });

  test("parseExcluded", () => {
    assert.deepEqual(parseExcluded("windows=번들, linux=E2E"), { windows: "번들", linux: "E2E" });
    assert.deepEqual(parseExcluded(""), {});
  });
});

test("드라이런 버전은 0.0.N 만", () => {
  assert.ok(DRYRUN_VERSION.test("0.0.12"));
  for (const v of ["3.5.0", "0.1.0", "0.0.1-rc", "v0.0.1"]) assert.equal(DRYRUN_VERSION.test(v), false, v);
});

test("NONMAC 키에 맨 linux-x86_64 가 없다 (deb 폴백 방지)", () => {
  const keys = Object.values(NONMAC).flatMap((p) => p.keys);
  assert.ok(!keys.includes("linux-x86_64"));
  assert.ok(!keys.some((k) => /-(deb|rpm|msi)$/.test(k)));
});
