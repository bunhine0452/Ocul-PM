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
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// 규칙표(무엇을 재고 무엇을 빼는가)는 데이터라 옆 모듈이 소유한다 —
// 테스트가 모양을 순서까지 못박을 수 있게 (#ratchet-policy).
import { MAX_LINES, GOVERNED, EXCLUDED, isGoverned } from "./file-size-policy.mjs";

const ROOT = new URL("..", import.meta.url).pathname;

// 정책을 여기서도 다시 내보낸다 — 이 스크립트를 물고 있던 기존 테스트
// (`src/__tests__/file_size_ratchet.test.ts`)의 import 를 깨지 않는다.
export { MAX_LINES, GOVERNED, EXCLUDED, isGoverned };

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
      git(["rev-parse", "--verify", "HEAD^1"]);
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

function runGit(args) {
  // 훅이 내보내는 저장소-지역 GIT_* 변수가 자식 명령을 다른 저장소로 돌린다.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")),
  );
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env,
    // 셋 다 파이프. stderr 를 "ignore" 로 버리면 실패했을 때 **왜** 실패했는지가
    // 남지 않는다 — 예전에 여기서 버려서, 기준선을 못 읽은 게이트가 아무 말도
    // 없이 다른 답을 냈다. 파이프면 터미널을 더럽히지 않으면서 `error.stderr`
    // 로 붙잡을 수 있다.
    stdio: "pipe",
  });
}

/**
 * 기준선에 있던 그 파일의 내용. **실패하면 던진다.**
 *
 * 예전에는 `catch { return null }` 이었다 — `git show` 의 모든 실패를 "신규
 * 파일" 로 삼켰다. 신규 파일이 실제로 `git show` 를 실패시키기 때문에 그럴듯해
 * 보였지만, 손상된 ref·blobless 클론·권한·인코딩 실패도 똑같이 "신규"가 됐다.
 * 그러면 게이트는 **래칫이기를 그만두고** 그냥 800줄 평면 검사가 된다: 3,674줄
 * 짜리 파일을 줄이는 PR 이 붉어지고(허용 3,674 대신 800), 보고서에는 그 파일이
 * "신규" 라고 적힌다. 원인은 stderr 와 함께 버려져 아무 데도 안 남는다.
 *
 * 이제 신규 여부는 `baselineLinesFor` 가 **git 상태코드**로 판정하므로 여기로는
 * 기준선이 있는 경로만 온다 — 그래서 실패는 전부 진짜 사고다.
 */
function baseContent(base, relPath) {
  try {
    return runGit(["show", `${base}:${relPath}`]);
  } catch (error) {
    const stderr = String(error?.stderr ?? "").trim();
    throw new Error(
      `기준선을 못 읽었습니다: git show ${base}:${relPath}\n` +
        (stderr || String(error?.message ?? error)),
      { cause: error },
    );
  }
}

/**
 * 이 변경의 기준선 줄 수 — 없으면 `null`(신규).
 *
 * **신규 판정은 git 상태코드가 한다.** `A` 는 "기준선에 없던 경로"라는 git 의
 * 단언이다. 읽어 보고 실패하면 신규로 치는 방식은 신규가 아닌 실패까지 신규로
 * 만든다 (위 `baseContent` 주석).
 *
 * 이름이 바뀐 파일(`R`)·복사(`C`)의 기준선은 **옛 경로**에 있다.
 */
export function baselineLinesFor(change, readBase) {
  if (change.status === "A") return null;
  return countLines(readBase(change.oldPath ?? change.path));
}

/**
 * `git ls-files --others -z` 출력을 `parseChangedFiles` 와 같은 모양으로 만든다.
 *
 * 아직 추적되지 않는 파일은 기준선에 없으므로 전부 **신규**(`A`)다 — 그래서
 * 800줄 상한을 그대로 맞는다.
 */
export function parseUntracked(output) {
  return output
    .split("\0")
    .filter(Boolean)
    .map((path) => ({ status: "A", path }));
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

  // `git diff` 는 **추적 파일만** 본다. 아직 `git add` 하지 않은 새 파일은
  // 여기 안 잡히는데, 800줄을 처음부터 넘겨 태어나는 파일이 바로 그런 파일이다
  // (2026-09-04: 3,344줄짜리 `mcp/tools.rs` 를 가르며 나온 1,697줄 테스트 파일이
  // 로컬에서 "clean" 이었다가 커밋 직후 CI 를 붉혔다). 커밋하기 **전에** 말해
  // 주지 못하면 이 게이트는 늦게 오는 잔소리가 된다.
  const untracked = parseUntracked(runGit(["ls-files", "--others", "--exclude-standard", "-z"]));
  const changed = [
    ...parseChangedFiles(runGit(["diff", "--name-status", "-z", base])),
    ...untracked,
  ];
  const violations = [];

  for (const change of changed) {
    if (change.status === "D") continue;
    if (!isGoverned(change.path)) continue;
    const abs = join(ROOT, change.path);
    if (!existsSync(abs)) continue;

    const candidateLines = countLines(readFileSync(abs, "utf8"));
    let baseLines;
    try {
      baseLines = baselineLinesFor(change, (source) => baseContent(base, source));
    } catch (error) {
      // 기준선을 못 읽었으면 **판정하지 않는다.** 예전에는 여기서 조용히
      // "신규" 로 넘어가 다른 답을 냈다 (#ratchet-fail-open).
      console.error(`✗ ${change.path}: 기준선(${base})을 읽지 못해 판정할 수 없습니다.`);
      console.error(String(error?.message ?? error));
      process.exit(2);
    }
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

/**
 * 지금 이 모듈이 **직접 실행된** 것인가 (import 된 것이 아니라).
 *
 * 예전 판정은 `process.argv[1].endsWith("check-file-sizes.mjs")` 였다. 파일
 * **이름**만 보므로 두 방향으로 틀린다:
 *
 *  - 심링크(`.git/hooks/pre-commit` → 이 파일)나 다른 이름으로 실행하면 같은
 *    파일인데도 CLI 가 안 돈다 — 훅이 조용히 아무것도 안 한다.
 *  - 다른 저장소의 동명 파일(`/other/scripts/check-file-sizes.mjs`)이 이 모듈을
 *    import 하면 이름이 맞아떨어져 CLI 가 돈다.
 *
 * `realpathSync` 로 **실제 파일**을 비교하면 둘 다 사라진다. 비교 함수를 인자로
 * 받는 이유는 테스트가 심링크를 진짜로 만들지 않고도 이 판정을 물기 위해서다.
 */
export function isDirectInvocation(argv1, moduleUrl, resolve = realpathSync) {
  if (!argv1) return false;
  try {
    return resolve(argv1) === resolve(fileURLToPath(moduleUrl));
  } catch {
    // 어느 한쪽이 사라졌으면 "직접 실행" 이라고 우기지 않는다.
    return false;
  }
}

// 테스트가 import 할 때는 CLI 를 돌리지 않는다.
if (isDirectInvocation(process.argv[1], import.meta.url)) {
  main();
}
