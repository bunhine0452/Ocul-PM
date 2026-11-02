// VS Code 내장 git 확장의 API — 확장이 git 을 직접 띄우지 않는다(자식 프로세스 0).
// 쓰는 것만 옮긴 최소 타입이다 (vscode/extensions/git/src/api/git.d.ts, API 1).

import * as vscode from "vscode";

interface Change {
  readonly uri: vscode.Uri;
}
interface Ref {
  readonly name?: string;
}
interface RepositoryState {
  readonly HEAD: (Ref & { readonly commit?: string }) | undefined;
  readonly refs: Ref[];
  readonly workingTreeChanges: Change[];
  readonly indexChanges: Change[];
  readonly untrackedChanges?: Change[];
  readonly onDidChange: vscode.Event<void>;
}
export interface Repository {
  readonly rootUri: vscode.Uri;
  readonly state: RepositoryState;
  getMergeBase(ref1: string, ref2: string): Promise<string | undefined>;
  diffWith(ref: string): Promise<Change[]>;
  log(options?: { range?: string; maxEntries?: number }): Promise<unknown[]>;
}
interface API {
  readonly repositories: Repository[];
  getRepository(uri: vscode.Uri): Repository | null;
  readonly onDidOpenRepository: vscode.Event<Repository>;
}

export async function gitApi(): Promise<API | undefined> {
  const ext = vscode.extensions.getExtension<{ getAPI(v: 1): API }>("vscode.git");
  if (!ext) return undefined;
  try {
    const exports = ext.isActive ? ext.exports : await ext.activate();
    return exports.getAPI(1);
  } catch {
    return undefined;
  }
}

/** `root` 기준 상대경로 — 밖이면 null. 경로 구분자는 늘 `/`. */
export function relativeTo(root: vscode.Uri, uri: vscode.Uri): string | null {
  const base = root.path.endsWith("/") ? root.path : root.path + "/";
  return uri.path.startsWith(base) ? uri.path.slice(base.length) : null;
}

function relAll(root: vscode.Uri, changes: readonly Change[]): string[] {
  return changes.map((c) => relativeTo(root, c.uri)).filter((p): p is string => p !== null);
}

/** 커밋 전 변경 — 작업 트리 · 스테이지 · 추적 안 됨. */
export function uncommitted(repo: Repository, root: vscode.Uri): string[] {
  const s = repo.state;
  return [...new Set(relAll(root, [...s.workingTreeChanges, ...s.indexChanges, ...(s.untrackedChanges ?? [])]))].sort();
}

const BASES = ["origin/main", "main", "origin/master", "master"];

export interface BranchChanges {
  branch: string;
  baseLabel: string;
  commits: number;
  /** 기준과 갈라진 뒤 + 커밋 전 + 추적 안 됨. */
  changed: string[];
}

/** 이 가지가 기준 가지에서 갈라진 뒤의 변경 (`git::receipt::build` 와 같은 범위). */
export async function branchChanges(repo: Repository, root: vscode.Uri): Promise<BranchChanges> {
  const branch = repo.state.HEAD?.name ?? "HEAD";
  const names = new Set(repo.state.refs.map((r) => r.name));
  let baseLabel = "";
  let sha: string | undefined;
  for (const b of BASES) {
    if (!names.has(b)) continue;
    sha = await repo.getMergeBase("HEAD", b).catch(() => undefined);
    if (sha) {
      baseLabel = b;
      break;
    }
  }
  const changed = new Set(uncommitted(repo, root));
  let commits = 0;
  if (sha) {
    for (const p of relAll(root, await repo.diffWith(sha))) changed.add(p);
    commits = (await repo.log({ range: `${sha}..HEAD`, maxEntries: 10000 }).catch(() => [])).length;
  }
  return { branch, baseLabel, commits, changed: [...changed].sort() };
}
