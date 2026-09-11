// '오늘 일지' 트리 — 추적 폴더(여럿이면 폴더 층) → 날짜(최근 7일, 오늘만 펼침)
// → 타입 폴더 → 항목. 읽기만 한다. 갱신은 `refresh()`(워처가 `{#sb-watch}` 에서 잇는다).
import * as path from "node:path";
import * as vscode from "vscode";
import { readJournalEntry, listJournalFiles, localWorkday, type JournalFile } from "../oculpm/store";
import type { TypeFolder } from "../oculpm/journal";
import { trackedFolders } from "./workspace";

export type JournalNode =
  | { kind: "folder"; root: string; name: string }
  | { kind: "day"; root: string; day: string; count: number }
  | { kind: "type"; root: string; day: string; folder: TypeFolder; count: number }
  | { kind: "entry"; root: string; file: JournalFile };

const TYPE_LABEL: Record<TypeFolder, string> = {
  Bugs: "버그", Features_to_add: "기능", Errors: "에러", Refactors: "리팩토링", Chores: "잡일",
};
const TYPE_ICON: Record<TypeFolder, string> = {
  Bugs: "bug", Features_to_add: "sparkle-filled", Errors: "flame", Refactors: "tools", Chores: "checklist",
};
/** 보여줄 날짜 수 — 오늘 포함 최근 7일. */
export const DAYS_SHOWN = 7;

export class JournalTreeProvider implements vscode.TreeDataProvider<JournalNode> {
  private readonly changed = new vscode.EventEmitter<JournalNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  refresh(): void {
    this.changed.fire(undefined);
  }

  async getChildren(node?: JournalNode): Promise<JournalNode[]> {
    if (!node) {
      const roots = await trackedFolders();
      if (roots.length === 1) {
        return this.days(roots[0]);
      }
      return roots.map((root) => ({ kind: "folder", root, name: path.basename(root) }));
    }
    switch (node.kind) {
      case "folder":
        return this.days(node.root);
      case "day": {
        const files = await listJournalFiles(node.root, { workday: node.day });
        const byType = new Map<TypeFolder, number>();
        for (const f of files) {
          byType.set(f.typeFolder, (byType.get(f.typeFolder) ?? 0) + 1);
        }
        return [...byType].map(([folder, count]) => ({ kind: "type", root: node.root, day: node.day, folder, count }));
      }
      case "type": {
        const files = await listJournalFiles(node.root, { workday: node.day });
        return files.filter((f) => f.typeFolder === node.folder).reverse().map((file) => ({ kind: "entry", root: node.root, file }));
      }
      case "entry":
        return [];
    }
  }

  private async days(root: string): Promise<JournalNode[]> {
    const files = await listJournalFiles(root);
    const counts = new Map<string, number>();
    for (const f of files) {
      counts.set(f.workday, (counts.get(f.workday) ?? 0) + 1);
    }
    return [...counts]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .slice(0, DAYS_SHOWN)
      .map(([day, count]) => ({ kind: "day", root, day, count }));
  }

  /** `TreeView.reveal` 이 요구한다 — 항목→타입→날짜→(멀티루트면 폴더). */
  async getParent(node: JournalNode): Promise<JournalNode | undefined> {
    const multi = (await trackedFolders()).length > 1;
    switch (node.kind) {
      case "folder":
        return undefined;
      case "day":
        return multi ? { kind: "folder", root: node.root, name: path.basename(node.root) } : undefined;
      case "type":
        return { kind: "day", root: node.root, day: node.day, count: 0 };
      case "entry":
        return { kind: "type", root: node.root, day: node.file.workday, folder: node.file.typeFolder, count: 0 };
    }
  }

  async getTreeItem(node: JournalNode): Promise<vscode.TreeItem> {
    const C = vscode.TreeItemCollapsibleState;
    switch (node.kind) {
      case "folder": {
        const it = new vscode.TreeItem(node.name, C.Expanded);
        it.iconPath = vscode.ThemeIcon.Folder;
        it.contextValue = "folder";
        it.id = node.root;
        return it;
      }
      case "day": {
        const today = node.day === localWorkday();
        const it = new vscode.TreeItem(formatDay(node.day), today ? C.Expanded : C.Collapsed);
        it.description = today ? `오늘 · ${node.count}` : String(node.count);
        it.iconPath = new vscode.ThemeIcon("calendar");
        it.contextValue = "day";
        it.id = `${node.root}#${node.day}`;
        return it;
      }
      case "type": {
        const it = new vscode.TreeItem(TYPE_LABEL[node.folder], C.Expanded);
        it.description = String(node.count);
        it.iconPath = new vscode.ThemeIcon(TYPE_ICON[node.folder]);
        it.contextValue = "type";
        it.id = `${node.root}#${node.day}/${node.folder}`;
        return it;
      }
      case "entry": {
        const entry = await readJournalEntry(node.file);
        const it = new vscode.TreeItem(entry.title, C.None);
        const hhmm = `${node.file.hhmm.slice(0, 2)}:${node.file.hhmm.slice(2)}`;
        it.description = entry.agentId ? `${hhmm} · ${entry.agentId}` : hhmm;
        it.tooltip = new vscode.MarkdownString(
          `**${entry.title}**\n\n${node.file.rel}\n\n${entry.status}${entry.agentVersion ? ` · ${entry.agentVersion}` : ""}`,
        );
        it.resourceUri = vscode.Uri.file(node.file.absPath);
        it.iconPath = new vscode.ThemeIcon("notebook");
        it.contextValue = "entry";
        it.id = node.file.absPath;
        it.command = { command: "ocul-pm.journal.open", title: "일지 열기", arguments: [node] };
        return it;
      }
    }
  }
}

function formatDay(d: string): string {
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
}
