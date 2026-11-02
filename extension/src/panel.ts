// 사이드바 「Ocul」 패널 (0.3.0) — VS Code 기본 트리 목록. 줄의 차례 · 뜻은 `model/panel.ts` 가 정하고,
// 여기서는 아이콘 · 글 · 누르면 할 일만 붙인다. 「지금 볼 것」 목록 팝업(0.2.0~0.3.0)을 이 패널이 대신한다.
//   누르기        — 일지 · 계획은 마크다운 미리보기, 파일은 편집기, Claude 의 기다림은 앱의 오늘 화면
//   줄 끝 단추    — ↗ Ocul 에서 열기 · ▶ 터미널에서 이어서 (다음 할 일)

import * as vscode from "vscode";
import { COMMAND } from "./model/evidence";
import { ago } from "./model/time";
import { attentionCount, panelSections, type Row, type Section, type SectionKey } from "./model/panel";
import type { Project } from "./project";
import { kindText, openInApp } from "./bridge";
import { agoText, whenLabel } from "./text";

const t = vscode.l10n.t;
export const BADGE = "○";

type Node = { section: Section } | { row: Row; key: SectionKey };

export const preview = (uri: vscode.Uri) => vscode.commands.executeCommand("markdown.showPreview", uri);

export class Panel implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  readonly view: vscode.TreeView<Node>;

  constructor(private readonly project: () => Project | undefined) {
    this.view = vscode.window.createTreeView("ocul.overview", { treeDataProvider: this, showCollapseAll: false });
  }

  refresh(): void {
    const p = this.project();
    this.view.description = p?.store.name;
    const n = p ? attentionCount({ overview: p.overview(), waiting: p.store.waiting, questions: p.store.questions }) : 0;
    this.view.badge = n > 0 ? { value: n, tooltip: t("{0} things need you", n) } : undefined;
    this.emitter.fire(undefined);
  }

  /** 상태 표시줄을 누르면 — 패널을 연다. */
  reveal(): Thenable<unknown> {
    return vscode.commands.executeCommand("ocul.overview.focus");
  }

  getChildren(node?: Node): Node[] {
    const p = this.project();
    if (!p) return [];
    if (!node) {
      return panelSections({
        overview: p.overview(),
        waiting: p.store.waiting,
        questions: p.store.questions,
        plans: p.store.plans,
        journals: p.store.journals,
      }).map((section) => ({ section }));
    }
    return "section" in node ? node.section.rows.map((row) => ({ row, key: node.section.key })) : [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if ("section" in node) return sectionItem(node.section);
    const p = this.project();
    return p ? rowItem(p, node.row) : new vscode.TreeItem("");
  }

  dispose(): void {
    this.view.dispose();
    this.emitter.dispose();
  }
}

const SECTION_LABEL: Record<SectionKey, () => string> = {
  claude: () => t("Claude is waiting"),
  eyes: () => t("Needs your eyes"),
  next: () => t("Next up"),
  recent: () => t("Recent journal entries"),
};

function sectionItem(s: Section): vscode.TreeItem {
  const item = new vscode.TreeItem(SECTION_LABEL[s.key](), vscode.TreeItemCollapsibleState.Expanded);
  item.id = `section:${s.key}`;
  item.contextValue = `section.${s.key}`;
  const real = s.rows.filter((r) => r.kind !== "allClear").length;
  if (real > 0 && s.key !== "recent") item.description = String(real);
  return item;
}

const icon = (id: string, color?: string) => new vscode.ThemeIcon(id, color ? new vscode.ThemeColor(color) : undefined);

function rowItem(p: Project, row: Row): vscode.TreeItem {
  switch (row.kind) {
    case "question": {
      const item = new vscode.TreeItem(row.q.question);
      item.id = `q:${row.q.id}`;
      item.iconPath = icon("comment-discussion", "list.warningForeground");
      item.description = whenLabel(row.q.askedAt);
      item.tooltip = tip([row.q.question, row.q.options.join(" · "), t("Answer in Ocul")]);
      item.command = cmd(t("Answer in Ocul"), "ocul.panel.openToday");
      item.contextValue = "claude";
      return item;
    }
    case "waiting": {
      const item = new vscode.TreeItem(row.w.message ?? kindText(row.w.kind));
      item.id = `w:${row.w.sessionId}`;
      item.iconPath = icon(row.w.kind === "permission" ? "shield" : "bell", "list.warningForeground");
      item.description = whenLabel(row.w.since);
      item.tooltip = tip([kindText(row.w.kind), t("Answer in the terminal where claude runs, or in Ocul.")]);
      item.command = cmd(t("Open Ocul's Today"), "ocul.panel.openToday");
      item.contextValue = "claude";
      return item;
    }
    case "failing": {
      const item = new vscode.TreeItem(row.v.plan.title);
      item.id = `fail:${row.v.plan.id}`;
      item.iconPath = icon("error", "testing.iconFailed");
      item.description = row.v.summary || t("no result line");
      item.tooltip = tip([`✗ ${row.v.summary || t("no result line")}`, row.v.plan.check ?? "", whenLabel(row.v.ts)]);
      item.command = cmd(t("Open plan"), "markdown.showPreview", p.store.planUri(row.v.plan.file));
      item.contextValue = "plan";
      return item;
    }
    case "unproven": {
      const item = new vscode.TreeItem(row.j.title || row.j.path);
      item.id = `unproven:${row.j.path}`;
      item.iconPath = icon("circle-outline", "list.warningForeground");
      item.description = t("no command run");
      item.tooltip = tip([row.j.title, t("This entry ran no command in verification."), whenLabel(row.j.createdAt)]);
      item.command = cmd(t("Open entry"), "markdown.showPreview", p.store.journalUri(row.j.path));
      item.contextValue = "journal";
      return item;
    }
    case "unrecorded": {
      const uri = vscode.Uri.joinPath(p.root, ...row.path.split("/"));
      const item = new vscode.TreeItem(uri);
      item.id = `unrecorded:${row.path}`;
      const dir = row.path.includes("/") ? row.path.slice(0, row.path.lastIndexOf("/")) : "";
      item.description = dir ? `${dir} · ${t("no record")}` : t("no record");
      item.tooltip = t("This change is in no journal entry. Ask the agent to record it, or note why.");
      item.command = cmd(t("Open file"), "vscode.open", uri);
      return item;
    }
    case "allClear": {
      const item = new vscode.TreeItem(t("Nothing needs your eyes"));
      item.id = "all-clear";
      item.iconPath = icon("pass", "testing.iconPassed");
      if (row.latest) item.description = t("check passed {0}", agoText(ago(row.latest.ts, Date.now())));
      return item;
    }
    case "next": {
      const pl = row.plan;
      const item = new vscode.TreeItem(pl.next?.title ?? "");
      item.id = `next:${pl.id}`;
      item.iconPath = icon("arrow-right");
      item.description = pl.title;
      item.tooltip = tip([pl.next?.title ?? "", pl.title, pl.check ? t("Check: {0}", pl.check) : "", t("▶ types claude \"/oculpm:next {0}\" in a terminal", pl.id)]);
      item.command = cmd(t("Open plan"), "markdown.showPreview", p.store.planUri(pl.file));
      item.contextValue = "next";
      return item;
    }
    case "journal": {
      const j = row.j;
      const item = new vscode.TreeItem(j.title || j.path);
      item.id = `journal:${j.path}`;
      const proven = j.evidence >= COMMAND;
      item.iconPath = proven ? icon("pass", "testing.iconPassed") : icon("circle-outline");
      item.description = whenLabel(j.createdAt);
      item.tooltip = tip([j.title, proven && j.proof ? `✓ ${j.proof}` : t("no command run in verification"), j.files.slice(0, 5).join("\n")]);
      item.command = cmd(t("Open entry"), "markdown.showPreview", p.store.journalUri(j.path));
      item.contextValue = "journal";
      return item;
    }
  }
}

function cmd(title: string, command: string, ...args: unknown[]): vscode.Command {
  return { title, command, arguments: args };
}

function tip(lines: string[]): string {
  return lines.filter((l) => l.trim() !== "").join("\n");
}

/** 줄 끝 단추 — 줄이 가리키는 것을 앱에서. */
export function openNodeInApp(p: Project | undefined, node: Node | undefined): Thenable<unknown> | undefined {
  if (!p || !node || "section" in node) return p ? openInApp(p, { kind: "view", view: "today" }) : undefined;
  const r = node.row;
  if (r.kind === "failing") return openInApp(p, { kind: "plan", id: r.v.plan.id });
  if (r.kind === "next") return openInApp(p, { kind: "plan", id: r.plan.id });
  if (r.kind === "journal" || r.kind === "unproven") return openInApp(p, { kind: "journal", path: r.j.path });
  return openInApp(p, { kind: "view", view: "today" });
}

/** ▶ 다음 할 일 줄의 계획 id. */
export function planIdOf(node: Node | undefined): string | undefined {
  return node && "row" in node && node.row.kind === "next" ? node.row.plan.id : undefined;
}
