// 한 프로젝트(`.oculpm/` 가 있는 폴더)의 일지 · 계획을 메모리에 들고, 파일이 바뀌면 그 파일만 다시 읽는다.
// 읽기만 한다 — 기록은 에이전트가 플러그인(MCP)으로 쓴다. 플러그인 훅의 인박스(`.oculpm/hooks/`)도 읽어
// Claude 가 기다리는 세션 · 앱에 띄운 질문을 든다(앱 없이도).

import * as vscode from "vscode";
import { parseJournal, type Journal } from "./model/journal";
import { parsePlan, type Plan } from "./model/plan";
import { parseQuestion, waitingFrom, type Question, type Waiting } from "./model/waiting";

const decoder = new TextDecoder();

export class Store implements vscode.Disposable {
  private readonly journalMap = new Map<string, Journal>();
  private readonly planMap = new Map<string, Plan>();
  private readonly emitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inbox = "";
  private questionList: Question[] = [];
  readonly onDidChange = this.emitter.event;

  constructor(readonly root: vscode.Uri) {
    const watch = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(root, ".oculpm/{journal/**/*.md,planner/*.md}"),
    );
    const reread = (uri: vscode.Uri) => void this.readOne(uri).then(() => this.changed());
    const drop = (uri: vscode.Uri) => {
      const rel = this.rel(uri);
      if (rel.journal) this.journalMap.delete(rel.journal);
      if (rel.plan) this.planMap.delete(rel.plan);
      this.changed();
    };
    this.disposables.push(watch, watch.onDidCreate(reread), watch.onDidChange(reread), watch.onDidDelete(drop), this.emitter);
    const hooks = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(root, ".oculpm/hooks/{claude-events.jsonl,questions/*.json}"),
    );
    const rehook = () => void this.readHooks().then(() => this.changed());
    this.disposables.push(hooks, hooks.onDidCreate(rehook), hooks.onDidChange(rehook), hooks.onDidDelete(rehook));
  }

  /** Claude 가 사람을 기다리는 세션 — 30분 넘은 것은 뺀다(부를 때마다 잰다). */
  get waiting(): Waiting[] {
    return waitingFrom(this.inbox, Date.now());
  }

  /** 앱에 떠 있는 Claude 의 질문(`ask_user`) — 답이 아직 없는 것, 오래된 것부터. */
  get questions(): Question[] {
    return this.questionList;
  }

  get name(): string {
    return this.root.path.split("/").filter(Boolean).pop() ?? this.root.path;
  }

  get journals(): Journal[] {
    return [...this.journalMap.values()];
  }

  get plans(): Plan[] {
    return [...this.planMap.values()];
  }

  journalUri(path: string): vscode.Uri {
    return vscode.Uri.joinPath(this.root, ".oculpm", "journal", ...path.split("/"));
  }

  planUri(file: string): vscode.Uri {
    return vscode.Uri.joinPath(this.root, ".oculpm", "planner", file);
  }

  async load(): Promise<void> {
    this.journalMap.clear();
    this.planMap.clear();
    const files = [
      ...(await walk(vscode.Uri.joinPath(this.root, ".oculpm", "journal"), 3)),
      ...(await walk(vscode.Uri.joinPath(this.root, ".oculpm", "planner"), 0)),
    ];
    await Promise.all([...files.map((f) => this.readOne(f)), this.readHooks()]);
    this.emitter.fire();
  }

  private rel(uri: vscode.Uri): { journal?: string; plan?: string } {
    const base = vscode.Uri.joinPath(this.root, ".oculpm").path + "/";
    if (!uri.path.startsWith(base)) return {};
    const rest = uri.path.slice(base.length);
    if (rest.startsWith("journal/")) return { journal: rest.slice("journal/".length) };
    if (rest.startsWith("planner/") && !rest.slice(8).includes("/")) return { plan: rest.slice(8) };
    return {};
  }

  private async readOne(uri: vscode.Uri): Promise<void> {
    const rel = this.rel(uri);
    if (!rel.journal && !rel.plan) return;
    let raw: string;
    try {
      raw = decoder.decode(await vscode.workspace.fs.readFile(uri));
    } catch {
      return; // 쓰는 도중 · 지운 직후 — 다음 이벤트가 다시 부른다.
    }
    if (rel.journal) this.journalMap.set(rel.journal, parseJournal(rel.journal, raw));
    if (rel.plan) this.planMap.set(rel.plan, parsePlan(rel.plan, raw));
  }

  /** 훅 인박스와 질문 폴더를 다시 읽는다. 앱이 다 읽은 인박스를 비우면(1MB 넘을 때) 그 앞의 기다림은 잊는다. */
  private async readHooks(): Promise<void> {
    const hooks = vscode.Uri.joinPath(this.root, ".oculpm", "hooks");
    try {
      this.inbox = decoder.decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(hooks, "claude-events.jsonl")));
    } catch {
      this.inbox = "";
    }
    const dir = vscode.Uri.joinPath(hooks, "questions");
    let names: string[] = [];
    try {
      names = (await vscode.workspace.fs.readDirectory(dir)).map(([n]) => n);
    } catch {
      names = [];
    }
    const answered = new Set(names.filter((n) => n.endsWith(".answer.json")).map((n) => n.slice(0, -".answer.json".length)));
    const qs = await Promise.all(
      names
        .filter((n) => n.endsWith(".json") && !n.endsWith(".answer.json") && !answered.has(n.slice(0, -5)))
        .map(async (n) => {
          try {
            return parseQuestion(decoder.decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, n))));
          } catch {
            return null;
          }
        }),
    );
    this.questionList = qs.filter((q): q is Question => q !== null).sort((a, b) => a.askedAt.localeCompare(b.askedAt));
  }

  /** 에이전트가 일지 여러 건을 잇달아 쓴다 — 화면은 한 번만 다시 그린다. */
  private changed(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.emitter.fire(), 200);
  }

  dispose(): void {
    clearTimeout(this.timer);
    for (const d of this.disposables) d.dispose();
  }
}

/** `.md` 파일을 `depth` 단계 아래까지 (일지 = 날짜/폴더/파일 → 2, 넉넉히 3). */
async function walk(dir: vscode.Uri, depth: number): Promise<vscode.Uri[]> {
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(dir);
  } catch {
    return [];
  }
  const out: vscode.Uri[] = [];
  for (const [name, type] of entries) {
    const child = vscode.Uri.joinPath(dir, name);
    if (type === vscode.FileType.File && name.endsWith(".md")) out.push(child);
    else if (type === vscode.FileType.Directory && depth > 0) out.push(...(await walk(child, depth - 1)));
  }
  return out;
}

/** 작업 영역 폴더 중 `.oculpm/` 이 있는 것. */
export async function trackedFolders(): Promise<vscode.Uri[]> {
  const out: vscode.Uri[] = [];
  for (const f of vscode.workspace.workspaceFolders ?? []) {
    try {
      const stat = await vscode.workspace.fs.stat(vscode.Uri.joinPath(f.uri, ".oculpm"));
      if (stat.type & vscode.FileType.Directory) out.push(f.uri);
    } catch {
      // 없는 폴더 — 추적하지 않는다.
    }
  }
  return out;
}
