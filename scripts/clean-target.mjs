#!/usr/bin/env node
/**
 * `src-tauri/target` 정리기.
 *
 * 카고는 **자기가 만든 옛 산출물을 지우지 않는다.** 이 저장소에서 그게
 * 어떻게 끝나는지 한 번 실측했다 (2026-09-04):
 *
 *   target            147 GB
 *   ├─ debug/incremental  79 GB — 증분 세션 디렉터리 994개 (크레이트 하나에 1.5GB)
 *   ├─ debug/deps         61 GB — .o 205,011개 + 테스트 바이너리 449개 (각 140MB)
 *   └─ 나머지              7 GB
 *
 * 2주치다. 14일 이상 된 파일은 하나도 없었다. 한 번 빌드가 크다기보다
 * (`Cargo.toml` 의 `debug = "line-tables-only"` 가 그건 이미 눌러 뒀다)
 * **세대가 쌓인다**: `tests/*.rs` 16개가 각각 라이브러리 전체를 링크한
 * 별도 바이너리가 되는데, 빌드 지문이 바뀔 때마다 새 해시로 하나 더 생기고
 * 옛것은 남는다.
 *
 * 그래서 주기적으로 이걸 돌린다. 지우는 것은 전부 **재생성되는 캐시**이므로
 * 최악의 대가는 다음 빌드가 느려지는 것뿐이다.
 *
 *   pnpm clean:target              # 증분 캐시 전부 + 3일 이상 묵은 산출물
 *   pnpm clean:target --days 7     # 문턱을 7일로
 *   pnpm clean:target --dry-run    # 지우지 않고 얼마나 나올지만
 *   pnpm clean:target --all        # cargo clean (릴리스 번들까지 전부)
 *
 * 묵은 것을 mtime 으로 고르는 건 보수적이지 않다 — 카고는 재사용하는 산출물의
 * mtime 을 갱신하지 않아서, 아직 유효한 것도 같이 지워질 수 있다. 그래도
 * 틀린 빌드가 나오지는 않는다 (지문이 산출물 없음을 보고 다시 만든다).
 * cargo-sweep 이 쓰는 것과 같은 방식이고, 의존성을 하나 더 들이지 않는 값이다.
 *
 * 의존성 0, Node 18+.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, rmSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const TARGET = join(ROOT, "src-tauri", "target");

/** 세대가 쌓이는 디렉터리들 — 프로파일 디렉터리 안에서 이 이름만 훑는다. */
const SWEPT = ["deps", "build", ".fingerprint", "examples"];

/** `du -sk` 로 잰 킬로바이트. 없는 경로는 0. */
export function sizeKb(path) {
  if (!existsSync(path)) return 0;
  try {
    const out = execFileSync("du", ["-sk", path], { encoding: "utf8" });
    return Number.parseInt(out.trim().split(/\s+/)[0], 10) || 0;
  } catch {
    return 0;
  }
}

export function human(kb) {
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)} GB`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(0)} MB`;
  return `${kb} KB`;
}

/**
 * `target` 아래에서 프로파일 디렉터리를 찾는다.
 *
 * `debug` / `release` 는 물론이고 `aarch64-apple-darwin/release` 처럼 타깃
 * 삼중자 아래에도 하나씩 더 있다. 이름을 나열하는 대신 **`deps` 를 가진
 * 디렉터리**를 프로파일로 본다 — 새 타깃이 붙어도 따라온다.
 */
export function findProfileDirs(target, depth = 2) {
  if (!existsSync(target)) return [];
  const found = [];
  const walk = (dir, left) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.isDirectory() && e.name === "deps")) {
      found.push(dir);
      return; // 프로파일 안으로는 더 안 내려간다
    }
    if (left <= 0) return;
    for (const e of entries) if (e.isDirectory()) walk(join(dir, e.name), left - 1);
  };
  walk(target, depth);
  return found;
}

function parseArgs(argv) {
  const args = { days: 3, dryRun: false, all: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--all") args.all = true;
    else if (argv[i] === "--dry-run" || argv[i] === "-n") args.dryRun = true;
    else if (argv[i] === "--days") args.days = Number.parseInt(argv[++i], 10);
  }
  if (!Number.isFinite(args.days) || args.days < 0) args.days = 3;
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const before = sizeKb(TARGET);
  if (before === 0) {
    console.log("target 이 비어 있다. 지울 것이 없다.");
    return;
  }
  console.log(`target: ${human(before)}`);

  if (args.all) {
    if (args.dryRun) {
      console.log(`\n[dry-run] cargo clean 이 ${human(before)} 를 회수한다.`);
      return;
    }
    execFileSync("cargo", ["clean"], { cwd: join(ROOT, "src-tauri"), stdio: "inherit" });
    console.log(`\ncargo clean — ${human(before)} 회수.`);
    return;
  }

  const cutoff = Date.now() - args.days * 24 * 60 * 60 * 1000;
  const doomed = []; // [경로, 킬로바이트]

  for (const profile of findProfileDirs(TARGET)) {
    const incremental = join(profile, "incremental");
    if (existsSync(incremental)) doomed.push([incremental, sizeKb(incremental)]);

    for (const name of SWEPT) {
      const dir = join(profile, name);
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        const path = join(dir, e.name);
        let st;
        try {
          st = statSync(path);
        } catch {
          continue;
        }
        if (st.mtimeMs >= cutoff) continue;
        doomed.push([path, e.isDirectory() ? sizeKb(path) : Math.ceil(st.size / 1024)]);
      }
    }
  }

  const reclaim = doomed.reduce((sum, [, kb]) => sum + kb, 0);
  const label = `증분 캐시 전부 + ${args.days}일 이상 묵은 산출물 ${doomed.length}건`;

  if (args.dryRun) {
    console.log(`\n[dry-run] ${label} — 약 ${human(reclaim)} 회수.`);
    return;
  }

  for (const [path] of doomed) rmSync(path, { recursive: true, force: true });
  const after = sizeKb(TARGET);
  console.log(`\n${label} 삭제.`);
  console.log(`target: ${human(before)} → ${human(after)} (${human(before - after)} 회수)`);
}

if (process.argv[1] && process.argv[1].endsWith("clean-target.mjs")) main();
