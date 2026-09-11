// '활성 플랜' 트리 — 플랜(status=active) → Phase → 항목(하위 1단계). 글리프는
// ThemeIcon 으로. 읽기만 한다 — 체크박스 토글은 `{#sb-toggle}` 이 oculpm-mcp 로 잇는다.
import * as path from "node:path";
import * as vscode from "vscode";
import type { ParsedPlan, PlanItem } from "../oculpm/planner";
import { listPlans, type PlanFile } from "../oculpm/store";
import { checkboxFor, progressOf, STATUS_ICON } from "./planModel";
import { trackedFolders } from "./workspace";

export type PlanNode =
  | { kind: "folder"; root: string; name: string }
  | { kind: "plan"; root: string; file: PlanFile }
  | { kind: "phase"; root: string; file: PlanFile; name: string }
  | { kind: "item"; root: string; file: PlanFile; item: PlanItem };

export class PlanTreeProvider implements vscode.TreeDataProvider<PlanNode> {
  private readonly changed = new vscode.EventEmitter<PlanNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  /** 읽기 전용이면 체크박스를 그리지 않는다 — 확장 상태에서 주입. */
  constructor(private readonly isReadOnly: () => boolean = () => true) {}

  refresh(): void {
    this.changed.fire(undefined);
  }

  async getChildren(node?: PlanNode): Promise<PlanNode[]> {
    if (!node) {
      const roots = await trackedFolders();
      if (roots.length === 1) {
        return this.plans(roots[0]);
      }
      return roots.map((root) => ({ kind: "folder", root, name: path.basename(root) }));
    }
    switch (node.kind) {
      case "folder":
        return this.plans(node.root);
      case "plan": {
        const plan = node.file.plan;
        const phases = plan.phases.map((p) => p.name);
        // Phase 밖(헤딩 앞) 항목이 있으면 이름 없는 phase 로 묶는다.
        if (plan.items.some((i) => i.phase === undefined)) {
          phases.unshift("");
        }
        return phases.map((name) => ({ kind: "phase", root: node.root, file: node.file, name }));
      }
      case "phase":
        return topLevel(node.file.plan, node.name).map((item) => ({ kind: "item", root: node.root, file: node.file, item }));
      case "item":
        return node.file.plan.items
          .filter((i) => i.parentItem === node.item.itemId)
          .map((item) => ({ kind: "item", root: node.root, file: node.file, item }));
    }
  }

  private async plans(root: string): Promise<PlanNode[]> {
    const files = await listPlans(root);
    return files.filter((f) => f.plan.status === "active").map((file) => ({ kind: "plan", root, file }));
  }

  getTreeItem(node: PlanNode): vscode.TreeItem {
    const C = vscode.TreeItemCollapsibleState;
    switch (node.kind) {
      case "folder": {
        const it = new vscode.TreeItem(node.name, C.Expanded);
        it.iconPath = vscode.ThemeIcon.Folder;
        it.contextValue = "folder";
        return it;
      }
      case "plan": {
        const { plan } = node.file;
        const p = progressOf(plan.items);
        const it = new vscode.TreeItem(plan.title, p.done === p.total ? C.Collapsed : C.Expanded);
        it.description = `${p.done}/${p.total}`;
        it.tooltip = `${plan.id} · ${plan.owner}${plan.updated ? ` · ${plan.updated}` : ""}`;
        it.iconPath = new vscode.ThemeIcon("list-tree");
        it.resourceUri = vscode.Uri.file(node.file.absPath);
        it.contextValue = "plan";
        return it;
      }
      case "phase": {
        const items = topLevel(node.file.plan, node.name === "" ? undefined : node.name);
        const all = node.file.plan.items.filter((i) => (node.name === "" ? i.phase === undefined : i.phase === node.name));
        const p = progressOf(all);
        const it = new vscode.TreeItem(node.name || "(phase 없음)", p.done === p.total && items.length > 0 ? C.Collapsed : C.Expanded);
        it.description = `${p.done}/${p.total}`;
        it.iconPath = new vscode.ThemeIcon("symbol-namespace");
        it.contextValue = "phase";
        return it;
      }
      case "item": {
        const { item } = node;
        const hasKids = node.file.plan.items.some((i) => i.parentItem === item.itemId);
        const it = new vscode.TreeItem(item.title, hasKids ? C.Expanded : C.None);
        const s = STATUS_ICON[item.status];
        it.iconPath = new vscode.ThemeIcon(s.icon, s.color ? new vscode.ThemeColor(s.color) : undefined);
        it.description = item.note ? `⟶ ${item.note}` : undefined;
        const box = checkboxFor(item, node.file.plan, this.isReadOnly());
        it.tooltip = `#${item.itemId} · ${s.label}${box.kind === "none" ? ` — ${box.reason}` : ""}`;
        if (box.kind === "checkbox") {
          it.checkboxState = box.checked ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked;
        }
        it.contextValue = hasKids ? "itemParent" : "item";
        it.id = `${node.file.absPath}#${item.itemId}`;
        return it;
      }
    }
  }
}

function topLevel(plan: ParsedPlan, phase: string | undefined): PlanItem[] {
  return plan.items.filter((i) => i.parentItem === undefined && (phase === undefined ? i.phase === undefined : i.phase === phase));
}
