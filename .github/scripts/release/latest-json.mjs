#!/usr/bin/env node
/**
 * latest.json — 비-mac 항목 병합과 검증 (크로스플랫폼 W4 · L-REL `#w4-latest-json`, 설계 D7).
 *
 * 앱 안 업데이터는 `releases/latest/download/latest.json` 한 파일을 모든 OS 가 함께 읽는다.
 * 그래서 이 파일은 **macOS 사용자의 업데이트 경로 그 자체**다. 규칙:
 *
 *   1. macOS 항목(`darwin-*`)의 주인은 tauri-action(macOS 잡)이다. 여기서는 읽기만 하고
 *      한 바이트도 바꾸지 않는다 — 병합 결과에서 baseline 과 deepEqual 로 단언한다.
 *   2. 비-mac 항목은 **설치 스모크·E2E 를 통과한 플랫폼만** 싣는다(D7). 병합은 기존
 *      비-mac 키를 전부 버리고 이번에 통과한 것으로 다시 쓴다 — 앞 시도(re-run)에서
 *      실렸다가 이번에 떨어진 플랫폼이 남지 않는다.
 *   3. 키 이름은 tauri-plugin-updater 2.10.1 `updater.rs` get_urls 가 찾는 순서
 *      `[{os}-{arch}-{installer}, {os}-{arch}]` 에 맞춘다 (`pickUpdaterEntry` 가 그 복제).
 *      - windows: `windows-x86_64-nsis` + `windows-x86_64` — Windows 설치 형식은 NSIS
 *        하나라 맨 키도 안전하다.
 *      - linux: `linux-x86_64-appimage` **만**. 맨 `linux-x86_64` 를 두면 deb 로 깐 앱
 *        (번들러가 실행 파일에 DEB 표식을 굽는다)이 `linux-x86_64-deb` 를 못 찾고 맨 키로
 *        떨어져 AppImage 를 받는다 — 서명은 맞으니 끝까지 받은 뒤 `install_deb` 가
 *        InvalidUpdaterFormat 으로 거절한다(~100MB 낭비 + 오류). deb 는 패키지 관리자로
 *        업데이트한다(D10) — deb 키는 싣지 않는다.
 *   4. 자산은 태그 URL(`/releases/download/<tag>/`)로 가리킨다. draft 의 `untagged-…`
 *      URL 은 공개 순간 404 가 된다.
 *
 * 의존성 0, Node 18+. 순수 함수는 export 하고 CLI 는 그것만 부른다
 * (`release.test.mjs` 가 그 함수들과 CLI 를 문다).
 *
 *   node latest-json.mjs merge  --base <latest.json> --out <file> --tag vX.Y.Z \
 *        --download-base https://github.com/<owner>/<repo>/releases/download \
 *        [--add windows=<setup.exe 경로>] [--add linux=<AppImage 경로>]
 *        (서명은 `<경로>.sig` 를 그대로 읽는다 — tauri-action 과 같다)
 *   node latest-json.mjs verify --file <latest.json> --tag vX.Y.Z --assets <자산 이름 목록 파일> \
 *        [--expect windows,linux|none] [--mac-baseline <병합 전 latest.json>]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";

/** macOS 잡(tauri-action)이 aarch64 .app 업데이터로 쓰는 두 키. 둘 다 있어야 한다. */
export const MAC_KEYS = ["darwin-aarch64", "darwin-aarch64-app"];

/**
 * 비-mac 플랫폼 → latest.json 키 · 업데이터 자산 이름.
 * 자산 이름은 tauri-bundler 가 정한다: `<productName>_<version>_<arch>…`.
 */
export const NONMAC = {
  windows: {
    keys: ["windows-x86_64", "windows-x86_64-nsis"],
    asset: (version) => `Ocul-PM_${version}_x64-setup.exe`,
  },
  linux: {
    keys: ["linux-x86_64-appimage"],
    asset: (version) => `Ocul-PM_${version}_amd64.AppImage`,
  },
};

/** 업데이터 서명은 minisign 서명 상자의 base64 한 덩어리다 — 공백·개행이 끼면 앱이 못 푼다. */
const SIGNATURE = /^[A-Za-z0-9+/]+={0,2}$/;

const isMacKey = (key) => key.startsWith("darwin-");

function platformOfKey(key) {
  for (const [platform, spec] of Object.entries(NONMAC)) {
    if (spec.keys.includes(key)) return platform;
  }
  return null;
}

/** tag `v3.5.0` → version `3.5.0`. */
export function versionOfTag(tag) {
  return tag.replace(/^v/, "");
}

/**
 * tauri-plugin-updater 2.10.1 `Updater::get_urls` 의 복제 (updater.rs:568-597).
 * 설치 형식을 아는 앱은 `{os}-{arch}-{installer}` 를 먼저, 그다음 `{os}-{arch}` 를 찾는다.
 * 형식은 번들러가 실행 파일에 굽는 표식(`__TAURI_BUNDLE_TYPE_VAR_*`)에서 온다.
 * 둘 다 없으면 null — 앱은 TargetsNotFound 오류로 끝나고 아무것도 받지 않는다.
 */
export function pickUpdaterEntry(platforms, { os, arch, installer }) {
  const targets = installer ? [`${os}-${arch}-${installer}`, `${os}-${arch}`] : [`${os}-${arch}`];
  for (const target of targets) {
    const entry = platforms[target];
    if (entry && entry.url && entry.signature) return { target, ...entry };
  }
  return null;
}

/**
 * 병합. `base` 는 macOS 잡이 올린 latest.json(파싱된 것), `adds` 는
 * `[{ platform, assetName, signature }]`. 새 객체를 돌려주고 `base` 는 건드리지 않는다.
 */
export function mergeLatest(base, adds, { tag, downloadBase }) {
  const platforms = base?.platforms;
  if (!platforms || typeof platforms !== "object") {
    throw new Error("base latest.json 에 platforms 가 없다 — macOS 잡의 tauri-action 이 올린 파일이 아니다");
  }
  for (const key of MAC_KEYS) {
    if (!platforms[key]) {
      throw new Error(`base latest.json 에 ${key} 가 없다 — macOS 항목 없이 병합하지 않는다`);
    }
  }
  const version = versionOfTag(tag);
  if (base.version !== version) {
    throw new Error(`base latest.json 의 version(${base.version})이 태그(${tag})와 다르다`);
  }
  const seen = new Set();
  const out = structuredClone(base);
  out.platforms = {};
  // 1) macOS 항목 — 복사만. (비-mac 키는 여기서 전부 버려진다: 규칙 2)
  for (const [key, entry] of Object.entries(platforms)) {
    if (isMacKey(key)) out.platforms[key] = structuredClone(entry);
  }
  // 2) 이번에 통과한 비-mac — NONMAC 순서로(파일 모양이 실행마다 같도록).
  for (const platform of Object.keys(NONMAC)) {
    const add = adds.find((a) => a.platform === platform);
    if (!add) continue;
    seen.add(platform);
    const spec = NONMAC[platform];
    const expected = spec.asset(version);
    if (add.assetName !== expected) {
      throw new Error(`${platform}: 업데이터 자산 이름이 ${expected} 이어야 하는데 ${add.assetName}`);
    }
    if (typeof add.signature !== "string" || !SIGNATURE.test(add.signature)) {
      throw new Error(`${platform}: 서명이 비었거나 base64 한 덩어리가 아니다 (${add.assetName}.sig)`);
    }
    const entry = { signature: add.signature, url: `${downloadBase.replace(/\/+$/, "")}/${encodeURIComponent(tag)}/${encodeURIComponent(add.assetName)}` };
    for (const key of spec.keys) out.platforms[key] = { ...entry };
  }
  for (const add of adds) {
    if (!seen.has(add.platform)) throw new Error(`알 수 없는 플랫폼: ${add.platform}`);
  }
  return out;
}

/**
 * 검증. 문제 목록(문자열)을 돌려준다 — 빈 배열이면 통과.
 *
 * `expect` 가 배열이면 비-mac 플랫폼 집합이 **정확히** 그것이어야 한다(공개 직전).
 * null 이면 있는 것만 규칙대로인지 본다(macOS 잡 — 첫 실행이면 비-mac 이 없고,
 * re-run 이면 앞선 공개 단계가 실은 비-mac 이 있을 수 있다).
 * `macBaseline` 을 주면 macOS 항목이 그것과 한 글자도 다르지 않아야 한다.
 */
export function verifyLatest(doc, { tag, assets, expect = null, macBaseline = null }) {
  const errors = [];
  const version = versionOfTag(tag);
  const assetSet = new Set(assets);
  if (!doc || typeof doc !== "object") return ["latest.json 이 JSON 객체가 아니다"];
  if (doc.version !== version) {
    errors.push(`version(${doc.version})이 태그(${tag})와 다르다 — 6 버전 파일 중 tauri.conf.json 이 안 올라간 것`);
  }
  const platforms = doc.platforms;
  if (!platforms || typeof platforms !== "object" || Object.keys(platforms).length === 0) {
    errors.push("platforms 가 비어 있다");
    return errors;
  }
  for (const key of MAC_KEYS) {
    if (!platforms[key]) errors.push(`${key} 가 없다 — macOS 업데이트가 끊긴다`);
  }
  const present = new Set();
  for (const [key, entry] of Object.entries(platforms)) {
    const platform = platformOfKey(key);
    if (!isMacKey(key) && !platform) {
      if (key === "linux-x86_64") {
        errors.push("맨 linux-x86_64 키는 싣지 않는다 — deb 로 깐 앱이 이 키로 떨어져 AppImage 를 받는다 (linux-x86_64-appimage 만)");
      } else {
        errors.push(`허용되지 않은 키: ${key} (deb·rpm·msi 는 자동 업데이트 대상이 아니다)`);
      }
      continue;
    }
    if (platform) present.add(platform);
    const url = typeof entry?.url === "string" ? entry.url : "";
    if (!url.includes(`/releases/download/${tag}/`)) {
      errors.push(`${key}: 다운로드 URL 이 이 태그를 가리키지 않는다: ${url || "(없음)"}`);
    }
    const name = decodeURIComponent(basename(url));
    if (!assetSet.has(name)) errors.push(`${key}: 가리키는 자산이 릴리스에 없다: ${name}`);
    if (platform && name !== NONMAC[platform].asset(version)) {
      errors.push(`${key}: 자산 이름이 ${NONMAC[platform].asset(version)} 이어야 하는데 ${name}`);
    }
    if (typeof entry?.signature !== "string" || !SIGNATURE.test(entry.signature)) {
      errors.push(`${key}: signature 가 비었거나 base64 한 덩어리가 아니다`);
    }
  }
  // 한 플랫폼의 키들은 같은 파일·같은 서명을 가리켜야 한다 (windows 두 키).
  for (const platform of present) {
    const entries = NONMAC[platform].keys.map((k) => platforms[k]);
    if (entries.some((e) => !e)) {
      errors.push(`${platform}: 키 ${NONMAC[platform].keys.join(" · ")} 가 다 있어야 한다`);
    } else if (entries.some((e) => !isDeepStrictEqual(e, entries[0]))) {
      errors.push(`${platform}: 키들이 서로 다른 자산·서명을 가리킨다`);
    }
  }
  if (Array.isArray(expect)) {
    const want = [...expect].sort().join(",");
    const got = [...present].sort().join(",");
    if (want !== got) errors.push(`비-mac 플랫폼이 [${want || "없음"}] 이어야 하는데 [${got || "없음"}]`);
  }
  if (macBaseline) {
    const baseMac = Object.keys(macBaseline.platforms ?? {}).filter(isMacKey);
    const docMac = Object.keys(platforms).filter(isMacKey);
    if (baseMac.sort().join(",") !== docMac.sort().join(",")) {
      errors.push(`macOS 키 집합이 바뀌었다: [${baseMac.join(", ")}] → [${docMac.join(", ")}]`);
    }
    for (const key of baseMac) {
      if (platforms[key] && !isDeepStrictEqual(platforms[key], macBaseline.platforms[key])) {
        errors.push(`${key}: macOS 항목이 병합 전과 다르다 — 병합은 macOS 항목을 건드리지 않는다`);
      }
    }
  }
  return errors;
}

/** 자산 이름 목록 파일 — 한 줄에 하나, 빈 줄 무시. */
export function readAssetList(path) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function main(argv) {
  const [command, ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    options: {
      base: { type: "string" },
      out: { type: "string" },
      file: { type: "string" },
      tag: { type: "string" },
      "download-base": { type: "string" },
      add: { type: "string", multiple: true },
      assets: { type: "string" },
      expect: { type: "string" },
      "mac-baseline": { type: "string" },
    },
  });
  if (!values.tag) throw new Error("--tag 가 필요하다");
  if (command === "merge") {
    const base = JSON.parse(readFileSync(values.base, "utf8"));
    const adds = (values.add ?? []).map((spec) => {
      const eq = spec.indexOf("=");
      if (eq < 0) throw new Error(`--add 는 <플랫폼>=<경로> 모양이어야 한다: ${spec}`);
      const path = spec.slice(eq + 1);
      return { platform: spec.slice(0, eq), assetName: basename(path), signature: readFileSync(`${path}.sig`, "utf8") };
    });
    const merged = mergeLatest(base, adds, { tag: values.tag, downloadBase: values["download-base"] });
    writeFileSync(values.out, `${JSON.stringify(merged, null, 2)}\n`);
    const keys = Object.keys(merged.platforms).join(", ");
    console.log(`병합: ${keys}`);
    return 0;
  }
  if (command === "verify") {
    const doc = JSON.parse(readFileSync(values.file, "utf8"));
    const expect =
      values.expect === undefined ? null : values.expect === "none" || values.expect === "" ? [] : values.expect.split(",");
    const macBaseline = values["mac-baseline"] ? JSON.parse(readFileSync(values["mac-baseline"], "utf8")) : null;
    const errors = verifyLatest(doc, { tag: values.tag, assets: readAssetList(values.assets), expect, macBaseline });
    for (const e of errors) console.log(`::error::latest.json — ${e}`);
    if (errors.length) return 1;
    console.log(`latest.json 검증 통과: ${Object.keys(doc.platforms).join(", ")} (version ${doc.version})`);
    return 0;
  }
  throw new Error(`알 수 없는 명령: ${command ?? "(없음)"} — merge | verify`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.log(`::error::latest.json — ${e.message}`);
    process.exitCode = 1;
  }
}
