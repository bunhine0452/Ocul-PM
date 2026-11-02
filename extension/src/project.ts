// 프로젝트 하나 = `.oculpm/` 폴더 하나 + (있으면) 그 폴더의 git 저장소.

import * as vscode from "vscode";
import { uncommitted, type Repository } from "./git";
import { overview, dayKey, journalsForFile, type Overview } from "./model/overview";
import { Store } from "./store";

export class Project implements vscode.Disposable {
  readonly store: Store;
  private repo: Repository | undefined;
  private repoSub: vscode.Disposable | undefined;
  private changed: string[] = [];
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private readonly sub: vscode.Disposable;

  constructor(readonly root: vscode.Uri) {
    this.store = new Store(root);
    this.sub = this.store.onDidChange(() => this.emitter.fire());
  }

  get repository(): Repository | undefined {
    return this.repo;
  }

  attach(repo: Repository | null): void {
    if (!repo || this.repo === repo) return;
    this.repoSub?.dispose();
    this.repo = repo;
    const refresh = () => {
      this.changed = uncommitted(repo, this.root);
      this.emitter.fire();
    };
    this.repoSub = repo.state.onDidChange(refresh);
    refresh();
  }

  /** 이 프로젝트 안의 파일이면 상대경로. */
  rel(uri: vscode.Uri): string | null {
    const base = this.root.path.endsWith("/") ? this.root.path : this.root.path + "/";
    return uri.scheme === this.root.scheme && uri.path.startsWith(base) ? uri.path.slice(base.length) : null;
  }

  overview(now = new Date()): Overview {
    return overview(this.store.plans, this.store.journals, this.changed, dayKey(now));
  }

  journalsFor(rel: string) {
    return journalsForFile(rel, this.store.journals);
  }

  dispose(): void {
    this.sub.dispose();
    this.repoSub?.dispose();
    this.store.dispose();
    this.emitter.dispose();
  }
}
