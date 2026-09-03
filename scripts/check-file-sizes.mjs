#!/usr/bin/env node
/**
 * 파일 크기 래칫 (플랜 `evidence-based-rules` — block/buzz 의
 * `scripts/check-file-sizes-core.mjs` 차용).
 *
 * CLAUDE.md 는 "파일은 200~400줄이 보통, 800줄이 한계"라고 적어 두었지만 그동안
 * 강제되지 않았다. 감사에서 800줄 초과가 50개 나왔고, 그 뒤로도 줄지 않았다.
 *
 * 전부를 지금 고치라고 하면 게이트가 통째로 무시된다. 그래서 **래칫**이다:
 *
 *   allowedLineCount(base, max) = base == null || base <= max ? max : base
 *
 * 이미 넘은 파일은 **현재 크기까지만** 허용한다 — 줄이는 것은 되고 늘리는 것은
 * 안 된다. 부채를 갚으라고 하지 않고 악화만 막는다.
 *
 * 기준선은 `git merge-base origin/main HEAD` 로 잡은 **3점 diff** 다. 2점
 * (`HEAD` 대 브랜치 시작점)으로 잡으면 리베이스나 머지 뒤에 main 이 건드린
 * 파일까지 전부 이 브랜치의 변경으로 잡혀 무관한 파일이 붉어진다.
 *
 * 의존성 0, Node 18+. 순수 함수는 export 하고 CLI 는 그것만 부른다
 * (`src/__tests__/file_size_ratchet.test.ts` 가 그 함수들을 문다).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

/** 한 파일이 가질 수 있는 줄 수 (CLAUDE.md 의 "800줄이 한계"). */
export const MAX_LINES = 800;

/**
 * 검사 대상 — 손으로 쓰는 소스만.
 *
 * 생성물(`bindings.ts`)과 사전(`i18n/*.ts`)은 뺀다. 둘 다 사람이 설계하는
 * 표면이 아니라 목록이고, 길이가 곧 설계 냄새인 파일들이 아니다.
 */
export const GOVERNED = [
  { root: "src-tauri/src/", ext: [".rs"] },
  { root: "src/", ext: [".ts", ".tsx"] },
];

export const EXCLUDED = [
  "src/legacy/", // 빌드·lint 대상 밖 (보존된 죽은 코드)
  "src/lib/bindings.ts", // tauri-specta 생성물
  "src/i18n/ko.ts",
  "src/i18n/en.ts",
  // 명세서(manifest)들 — 길이가 **설계**가 아니라 **기능 수**의 함수인 파일.
  // `lib.rs` 는 커맨드 하나가 늘 때마다 `use` 한 줄과 `collect_commands!` 한
  // 줄이 반드시 는다. 여기에 래칫을 걸면 "커맨드를 더 못 붙인다"가 되고, 그건
  // 지켜지지 않고 우회될 규칙이다.
  "src-tauri/src/lib.rs",
  // 같은 이유의 스키마 파일. `.oculpm` 프론트매터/인덱스의 **모양 자체**라,
  // 필드가 하나 늘면 줄도 반드시 는다 (주석을 0줄로 줄여도 통과가 불가능하다).
  // 2026-09-04 에 `agent.session`·`Session.agent_sessions` 를 넣다가 확인됐다.
  "src-tauri/src/oculpm/spec.rs",
];

/** 이 경로가 래칫 대상인가. */
export function isGoverned(relPath) {
  if (EXCLUDED.some((skip) => relPath === skip || relPath.startsWith(skip))) {
    return false;
  }
  return GOVERNED.some(
    (rule) => relPath.startsWith(rule.root) && rule.ext.some((e) => relPath.endsWith(e)),
  );
}

/** 빈 파일은 0줄. 그 밖에는 개행으로 자른 조각 수(마지막 개행 뒤 빈 줄 포함). */
export function countLines(content) {
  if (content.length === 0) return 0;
  return content.split(/\r?\n/).length;
}

/**
 * 이 파일에 허용되는 줄 수.
 *
 * 기준선이 없거나(신규) 한계 안이면 한계가 곧 상한이다. 이미 넘어 있으면
 * **그 크기**가 상한이다 — 늘리지만 않으면 통과한다.
 */
export function allowedLineCount(baseLines, maxLines = MAX_LINES) {
  return baseLines == null || baseLines <= maxLines ? maxLines : baseLines;
}

export function evaluateFileSize({ baseLines, candidateLines, maxLines = MAX_LINES }) {
  const limit = allowedLineCount(baseLines, maxLines);
  return { limit, violates: candidateLines > limit };
}

/**
 * `git diff --name-status -z` 출력을 파싱한다.
 *
 * 이름이 바뀐 파일(`R`)과 복사(`C`)는 필드가 **셋**이다(상태·옛 경로·새 경로).
 * 둘로 세면 그 뒤 전부가 한 칸씩 밀린다.
 */
export function parseChangedFiles(output) {
  const fields = output.split("\0");
  const changes = [];
  for (let i = 0; i < fields.length - 1; ) {
    const status = fields[i++];
    if (!status) break;
    if (status.startsWith("R") || status.startsWith("C")) {
      const oldPath = fields[i++];
      const path = fields[i++];
      changes.push({ status: status[0], oldPath, path });
    } else {
      changes.push({ status: status[0], path: fields[i++] });
    }
  }
  return changes;
}

/**
 * 무엇과 비교할 것인가.
 *
 * CI 는 직전 커밋(`HEAD^1`), 로컬은 `origin/main` 과의 merge-base. 브랜치가
 * 곧 main 이면 merge-base 가 HEAD 라 "커밋 안 된 변경만" 보게 된다 — 그게
 * 맞다. **origin/main 을 못 찾으면 조용히 통과하지 않고 실패한다.** 기준선을
 * 모르는 채로 통과시키면 게이트가 있다는 착각만 남는다.
 */
export function resolveBaseRef(env = process.env, git = runGit) {
  if (env.OCULPM_FILESIZE_BASE) return env.OCULPM_FILESIZE_BASE;
  if (env.GITHUB_ACTIONS === "true") {
    // 얕은 체크아웃(depth 1)에는 직전 커밋이 없다. 워크플로가 `fetch-depth: 2`
    // 를 주는 것이 정답이고, 안 줬을 때 스택트레이스 대신 **왜 못 잡았는지**를
    // 말한다 — 통과시키지는 않는다.
    try {
      git(["rev-parse", "--verify", "HEAD^1"], { quiet: true });
    } catch {
      throw new Error(
        "얕은 체크아웃이라 HEAD^1 이 없습니다 — 워크플로 checkout 에 fetch-depth: 2 를 주세요.",
      );
    }
    return "HEAD^1";
  }
  const mergeBase = git(["merge-base", "origin/main", "HEAD"]).trim();
  const head = git(["rev-parse", "HEAD"]).trim();
  return mergeBase === head ? "HEAD" : mergeBase;
}

function runGit(args, { quiet = false } = {}) {
  // 훅이 내보내는 저장소-지역 GIT_* 변수가 자식 명령을 다른 저장소로 돌린다.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")),
  );
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env,
    // 신규 파일은 `git show` 가 "fatal: path ... exists on disk" 를 stderr 로
    // 뱉는다 — 우리에게는 정상 경로(기준선 없음)라 삼킨다.
    stdio: quiet ? ["ignore", "pipe", "ignore"] : "pipe",
  });
}

function baseContent(base, relPath) {
  try {
    return runGit(["show", `${base}:${relPath}`], { quiet: true });
  } catch {
    return null; // 기준선에 없던 파일 = 신규
  }
}

function main() {
  let base;
  try {
    base = resolveBaseRef();
  } catch (error) {
    console.error(
      "✗ 파일 크기 기준선을 못 잡았습니다 — origin/main 을 fetch 하거나 OCULPM_FILESIZE_BASE 를 지정하세요.",
    );
    console.error(String(error?.message ?? error));
    process.exit(2);
  }

  const changed = parseChangedFiles(runGit(["diff", "--name-status", "-z", base]));
  const violations = [];

  for (const change of changed) {
    if (change.status === "D") continue;
    if (!isGoverned(change.path)) continue;
    const abs = join(ROOT, change.path);
    if (!existsSync(abs)) continue;

    const candidateLines = countLines(readFileSync(abs, "utf8"));
    // 이름이 바뀐 파일의 기준선은 **옛 경로**에 있다.
    const source = change.oldPath ?? change.path;
    const prior = baseContent(base, source);
    const baseLines = prior == null ? null : countLines(prior);
    const { limit, violates } = evaluateFileSize({ baseLines, candidateLines });
    if (violates) {
      violations.push({ path: change.path, candidateLines, limit, baseLines });
    }
  }

  if (violations.length === 0) {
    console.log(`✓ file size: clean (기준 ${base.slice(0, 12)}, 한계 ${MAX_LINES}줄)`);
    return;
  }

  console.error("✗ 파일이 한계를 넘었습니다 — 쪼개거나 줄이세요:");
  for (const v of violations) {
    const was = v.baseLines == null ? "신규" : `이전 ${v.baseLines}줄`;
    console.error(`  ${v.path}: ${v.candidateLines}줄 (허용 ${v.limit}, ${was})`);
  }
  console.error("");
  console.error("래칫 규칙: 이미 800줄을 넘은 파일은 **더 늘리지만** 않으면 통과합니다.");
  console.error("한 파일이 800줄을 넘어야 하는 이유가 있다면 먼저 쪼갤 자리를 찾으세요.");
  process.exit(1);
}

// 테스트가 import 할 때는 CLI 를 돌리지 않는다.
if (process.argv[1] && process.argv[1].endsWith("check-file-sizes.mjs")) {
  main();
}
