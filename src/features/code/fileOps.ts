// 파일 조작의 경로 계산 — 순수 함수만. 백엔드(`normalize_rel`)가 최종 권한이고
// 여기는 **오지 않아도 될 왕복을 막고 더 나은 말을 해 주는** 층이다.
// (트리에서 폴더를 자기 안으로 끌어다 놓는 것 같은 실수는 서버까지 갈 필요가 없다.)

/** `src/a/b.rs` → `src/a`. 최상위면 `""`(프로젝트 루트). */
export function parentDir(path: string): string {
  const at = path.lastIndexOf("/");
  return at < 0 ? "" : path.slice(0, at);
}

/** `src/a/b.rs` → `b.rs`. */
export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** 폴더 경로와 이름을 잇는다. `dir` 이 비면 루트 바로 아래. */
export function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

/** 이름 입력이 왜 못 쓰는지 — i18n 키를 돌려주고, 문제가 없으면 null. */
export type NameProblem = "empty" | "dotdot" | "separator";

/**
 * 인라인 입력칸이 받은 이름 검사.
 *
 * `/` 는 **허용한다** — VS Code 처럼 `a/b/c.ts` 한 번에 만들기와 이름 바꾸기로
 * 옮기기를 그대로 쓸 수 있어야 한다. 대신 경로 구간이 비거나(`a//b`) `.`/`..`
 * 이면 막는다: 백엔드도 같은 이유로 거절하므로 여기서 먼저 말해 주는 편이 낫다.
 */
export function validateName(raw: string): NameProblem | null {
  const name = raw.trim();
  if (!name) return "empty";
  if (name.includes("\\")) return "separator";
  const segments = name.split("/");
  if (segments.some((s) => s.trim() === "")) return "empty";
  if (segments.some((s) => s.trim() === "." || s.trim() === "..")) return "dotdot";
  return null;
}

/** 이름 바꾸기의 목적지. 입력이 경로면 프로젝트 루트 기준으로 읽는다 (VS Code 와 같다). */
export function renameTarget(from: string, input: string): string {
  const name = input.trim();
  return name.includes("/") ? name : joinPath(parentDir(from), name);
}

/** 드래그 이동이 성립하지 않는 이유. */
export type MoveProblem = "sameDir" | "intoSelf";

/**
 * 드래그 이동의 목적지 경로. 성립하지 않으면 이유를 돌려준다.
 *
 * 폴더를 자기 자신이나 자기 후손 위에 떨어뜨리는 것은 트리에서 실제로 자주
 * 일어나는 실수다 — 백엔드도 막지만 여기서 잡으면 조용히 아무 일도 안 일어난
 * 것처럼 보이지 않고 이유를 말할 수 있다.
 */
export function moveTarget(
  from: string,
  toDir: string,
): { ok: true; to: string } | { ok: false; reason: MoveProblem } {
  if (from === toDir || toDir === `${from}/`.slice(0, -1)) return { ok: false, reason: "intoSelf" };
  if (toDir.startsWith(`${from}/`)) return { ok: false, reason: "intoSelf" };
  if (parentDir(from) === toDir) return { ok: false, reason: "sameDir" };
  return { ok: true, to: joinPath(toDir, baseName(from)) };
}
