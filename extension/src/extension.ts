// Ocul — 에이전트가 한 일의 영수증을 코드 옆에.
//
// 앱 없이 동작한다. `.oculpm/` 마크다운을 읽기만 하고(쓰기 0), git 은 VS Code 내장 git 확장의 API 로만
// 본다(자식 프로세스 0), 네트워크에 닿지 않는다(`src/guard.spec.ts` 가 지킨다). 보여 주는 것은 예외뿐이다:
//   상태 표시줄 왼쪽  — 마지막 확인 명령 결과(✓/✗) · 어느 일지에도 없는 변경 수 · Claude 기다림
//   상태 표시줄 오른쪽 — 지금 연 파일의 영수증(이 파일을 건드린 일지 · 돌린 명령)
//   탐색기 배지       — 어느 일지에도 없는 변경 파일
// 앱과는 `bridge.ts` 로 잇는다 — 「Ocul 에서 열기」(앱 딥링크) · 「터미널에서 이어서」(사용자가 누를 때만).

import * as vscode from "vscode";
import { branchChanges, gitApi } from "./git";
import { COMMAND } from "./model/evidence";
import type { Journal } from "./model/journal";
import { livePlans, type Overview } from "./model/overview";
import { receiptMarkdown } from "./model/receipt";
import { ago } from "./model/time";
import { Project } from "./project";
import { trackedFolders } from "./store";
import { agoText, receiptText, whenLabel } from "./text";
import { continueInTerminal, pickInApp, plansWithNext, renderClaude, showClaude } from "./bridge";

const t = vscode.l10n.t;
const BADGE = "○";

let projects: Project[] = [];
let gitSub: vscode.Disposable | undefined;

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  const summary = vscode.window.createStatusBarItem("ocul.summary", vscode.StatusBarAlignment.Left, 50);
  summary.name = "Ocul";
  summary.command = "ocul.showExceptions";
  const file = vscode.window.createStatusBarItem("ocul.file", vscode.StatusBarAlignment.Right, 100);
  file.name = t("Ocul — this file's receipt");
  file.command = "ocul.fileHistory";
  const claude = vscode.window.createStatusBarItem("ocul.claude", vscode.StatusBarAlignment.Left, 49);
  claude.name = t("Ocul — Claude waiting");
  claude.command = "ocul.showClaude";
  const decorations = new UnrecordedDecorations();
  ctx.subscriptions.push(summary, file, claude, decorations, vscode.window.registerFileDecorationProvider(decorations));

  const render = () => {
    renderSummary(summary);
    renderClaude(claude, current());
    renderFile(file);
    decorations.refresh();
  };

  const rebuild = async () => {
    for (const p of projects) p.dispose();
    projects = (await trackedFolders()).map((root) => new Project(root));
    const git = await gitApi();
    for (const p of projects) {
      p.onDidChange(render);
      p.attach(git?.getRepository(p.root) ?? null);
      await p.store.load();
    }
    gitSub?.dispose();
    gitSub = git?.onDidOpenRepository(() => projects.forEach((p) => p.attach(git.getRepository(p.root))));
    render();
  };

  ctx.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(render),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void rebuild()),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration("ocul") && render()),
    vscode.commands.registerCommand("ocul.showExceptions", showExceptions),
    vscode.commands.registerCommand("ocul.fileHistory", fileHistory),
    vscode.commands.registerCommand("ocul.copyReceipt", copyReceipt),
    vscode.commands.registerCommand("ocul.refresh", () => rebuild()),
    vscode.commands.registerCommand("ocul.showClaude", () => showClaude(current())),
    vscode.commands.registerCommand("ocul.openInApp", (arg?: vscode.Uri) => {
      const uri = arg instanceof vscode.Uri ? arg : vscode.window.activeTextEditor?.document.uri;
      const p = current(uri);
      return pickInApp(p, p && uri ? p.rel(uri) : null);
    }),
    vscode.commands.registerCommand("ocul.continueInTerminal", (planId?: string) =>
      continueInTerminal(current(), typeof planId === "string" ? planId : undefined),
    ),
    { dispose: () => (projects.forEach((p) => p.dispose()), gitSub?.dispose()) },
  );
  // 「방금 전」 이 「12분 전」 이 되도록 — 1분마다 글만 다시 쓴다.
  // 기다림은 30분이 지나면 빠진다 — 같은 1분에 다시 잰다.
  const tick = setInterval(() => (renderSummary(summary), renderClaude(claude, current())), 60_000);
  ctx.subscriptions.push({ dispose: () => clearInterval(tick) });
  await rebuild();
}

export function deactivate(): void {
  for (const p of projects) p.dispose();
  projects = [];
}

/** 지금 연 파일의 프로젝트, 없으면 첫 프로젝트. */
function current(uri = vscode.window.activeTextEditor?.document.uri): Project | undefined {
  return (uri && projects.find((p) => p.rel(uri) !== null)) || projects[0];
}

function renderSummary(item: vscode.StatusBarItem): void {
  const p = current();
  if (!p) return item.hide();
  const o = p.overview();
  const parts: string[] = [];
  item.backgroundColor = undefined;
  if (o.failing.length > 0) {
    parts.push(`$(error) ${clip(o.failing[0].summary || o.failing[0].plan.title, 36)}`);
    item.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
  } else if (o.latest) {
    parts.push(`$(pass) ${t("passed {0}", agoText(ago(o.latest.ts, Date.now())))}`);
  } else {
    parts.push("$(circle-large-outline) Ocul");
  }
  if (o.unrecorded.length > 0) parts.push(`${BADGE} ${o.unrecorded.length}`);
  item.text = parts.join("  ");
  item.tooltip = summaryTooltip(p, o);
  item.show();
}

function summaryTooltip(p: Project, o: Overview): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  // 아래 명령 링크만 누를 수 있게 — 다른 명령은 막힌다.
  md.isTrusted = { enabledCommands: ["ocul.openInApp", "ocul.continueInTerminal", "ocul.showExceptions"] };
  md.appendMarkdown(`**Ocul · ${escape(p.store.name)}**\n\n`);
  if (o.latest) {
    const v = o.latest;
    md.appendMarkdown(
      `${v.passed ? "✓" : "✗"} ${escape(v.plan.title)} — ${code(v.summary || t("no result line"))} · ${whenLabel(v.ts)}\n\n`,
    );
  } else {
    md.appendMarkdown(t("No check command has been run in a live plan yet.") + "\n\n");
  }
  if (o.failing.length > 1) md.appendMarkdown(t("{0} plans failing", o.failing.length) + "\n\n");
  if (o.unrecorded.length > 0) md.appendMarkdown(`${BADGE} ` + t("{0} changes in no journal entry", o.unrecorded.length) + "\n\n");
  if (o.unproven.length > 0) md.appendMarkdown(t("{0} journal entries today without a command run", o.unproven.length) + "\n\n");
  const next = plansWithNext(p)[0];
  if (next?.next) md.appendMarkdown(`${t("Next: {0}", escape(next.next.title))} · ${escape(next.title)}\n\n`);
  md.appendMarkdown(t("Click for what needs your eyes."));
  md.appendMarkdown(`\n\n[$(link-external) ${t("Open in Ocul")}](command:ocul.openInApp)`);
  if (next) md.appendMarkdown(` · [$(terminal) ${t("Continue in terminal")}](command:ocul.continueInTerminal)`);
  return md;
}

function renderFile(item: vscode.StatusBarItem): void {
  const uri = vscode.window.activeTextEditor?.document.uri;
  const p = uri && current(uri);
  const rel = p && uri ? p.rel(uri) : null;
  if (!p || !rel || rel.startsWith(".oculpm/")) return item.hide();
  const js = p.journalsFor(rel);
  if (js.length === 0) {
    if (!p.overview().unrecorded.includes(rel)) return item.hide();
    item.text = `${BADGE} ${t("no record")}`;
    item.tooltip = t("This change is in no journal entry. Ask the agent to record it, or note why.");
    return item.show();
  }
  const last = js[0];
  item.text = `$(history) ${last.evidence >= COMMAND ? "✓" : "·"} ${js.length}`;
  const md = new vscode.MarkdownString(undefined, true);
  md.appendMarkdown(`**${t("Receipt · {0}", escape(rel))}**\n\n`);
  for (const j of js.slice(0, 4)) md.appendMarkdown(journalLine(j) + "\n\n");
  if (js.length > 4) md.appendMarkdown(t("{0} more", js.length - 4) + "\n\n");
  item.tooltip = md;
  item.show();
}

function journalLine(j: Journal): string {
  const proof = j.evidence >= COMMAND && j.proof ? code(j.proof) : `_${t("no command run in verification")}_`;
  return `${j.evidence >= COMMAND ? "✓" : "·"} **${escape(j.title || j.path)}** · ${whenLabel(j.createdAt)}  \n${proof}`;
}

class UnrecordedDecorations implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<undefined>();
  readonly onDidChangeFileDecorations = this.emitter.event;

  refresh(): void {
    this.emitter.fire(undefined);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (!vscode.workspace.getConfiguration("ocul").get<boolean>("explorerBadges", true)) return undefined;
    const p = projects.find((x) => x.rel(uri) !== null);
    const rel = p?.rel(uri);
    if (!p || !rel || !p.overview().unrecorded.includes(rel)) return undefined;
    return new vscode.FileDecoration(BADGE, t("Ocul: in no journal entry"));
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

type Pick = vscode.QuickPickItem & { open?: () => Thenable<unknown> };

const preview = (uri: vscode.Uri) => vscode.commands.executeCommand("markdown.showPreview", uri);
const openFile = (uri: vscode.Uri) => vscode.window.showTextDocument(uri);

async function showExceptions(): Promise<void> {
  const p = current();
  if (!p) return void vscode.window.showInformationMessage(t("No .oculpm/ folder in this workspace."));
  const o = p.overview();
  const items: Pick[] = [];
  if (o.failing.length > 0) {
    items.push({ label: t("Check command failed"), kind: vscode.QuickPickItemKind.Separator });
    for (const v of o.failing)
      items.push({
        label: `$(error) ${v.plan.title}`,
        description: whenLabel(v.ts),
        detail: v.summary || t("no result line"),
        open: () => openFile(p.store.planUri(v.plan.file)),
      });
  }
  if (o.unproven.length > 0) {
    items.push({ label: t("Today's journal entries without a command run"), kind: vscode.QuickPickItemKind.Separator });
    for (const j of o.unproven)
      items.push({ label: `· ${j.title || j.path}`, description: whenLabel(j.createdAt), open: () => preview(p.store.journalUri(j.path)) });
  }
  if (o.unrecorded.length > 0) {
    items.push({ label: t("Changes in no journal entry"), kind: vscode.QuickPickItemKind.Separator });
    for (const f of o.unrecorded)
      items.push({ label: `${BADGE} ${f}`, open: () => openFile(vscode.Uri.joinPath(p.root, ...f.split("/"))) });
  }
  const nexts = plansWithNext(p);
  if (nexts.length > 0) {
    items.push({ label: t("Next up"), kind: vscode.QuickPickItemKind.Separator });
    for (const pl of nexts)
      items.push({
        label: `$(arrow-right) ${pl.next?.title ?? ""}`,
        description: pl.title,
        detail: t("Continue with claude in the terminal"),
        open: () => continueInTerminal(p, pl.id),
      });
  }
  if (items.length === 0) {
    const ok = o.latest ? t("Nothing needs your eyes. Last check passed {0}.", agoText(ago(o.latest.ts, Date.now()))) : t("Nothing needs your eyes.");
    return void vscode.window.showInformationMessage(ok);
  }
  const pick = await vscode.window.showQuickPick(items, { placeHolder: t("Ocul · what needs your eyes in {0}", p.store.name), matchOnDetail: true });
  await pick?.open?.();
}

async function fileHistory(arg?: vscode.Uri): Promise<void> {
  const uri = arg instanceof vscode.Uri ? arg : vscode.window.activeTextEditor?.document.uri;
  const p = uri && current(uri);
  const rel = p && uri ? p.rel(uri) : null;
  if (!p || !rel) return void vscode.window.showInformationMessage(t("This file is not in a project Ocul tracks."));
  const js = p.journalsFor(rel);
  if (js.length === 0) return void vscode.window.showInformationMessage(t("No journal entry mentions {0}.", rel));
  const pick = await vscode.window.showQuickPick(
    js.map<Pick>((j) => ({
      label: `${j.evidence >= COMMAND ? "$(pass)" : "$(circle-outline)"} ${j.title || j.path}`,
      description: whenLabel(j.createdAt),
      detail: j.evidence >= COMMAND && j.proof ? j.proof : t("no command run in verification"),
      open: () => preview(p.store.journalUri(j.path)),
    })),
    { placeHolder: t("Journal entries that touched {0}", rel), matchOnDetail: true },
  );
  await pick?.open?.();
}

async function copyReceipt(): Promise<void> {
  const p = current();
  if (!p) return void vscode.window.showInformationMessage(t("No .oculpm/ folder in this workspace."));
  const repo = p.repository;
  if (!repo) return void vscode.window.showWarningMessage(t("Ocul needs the built-in Git extension to see this branch."));
  try {
    const b = await branchChanges(repo, p.root);
    const byPath = new Map(p.store.journals.map((j) => [j.path, j] as const));
    const journals = b.changed
      .filter((f) => f.startsWith(".oculpm/journal/") && f.endsWith(".md"))
      .map((f) => byPath.get(f.slice(".oculpm/journal/".length)))
      .filter((j): j is Journal => j !== undefined)
      .sort((a, c) => a.path.localeCompare(c.path));
    const recorded = new Set(journals.flatMap((j) => j.files));
    const work = b.changed.filter((f) => !f.startsWith(".oculpm/"));
    const md = receiptMarkdown(
      {
        branch: b.branch,
        baseLabel: b.baseLabel,
        commits: b.commits,
        files: work.length,
        journals,
        unrecorded: work.filter((f) => !recorded.has(f)),
        plans: livePlans(p.store.plans),
      },
      receiptText(),
    );
    await vscode.env.clipboard.writeText(md);
    vscode.window.showInformationMessage(t("Receipt copied. Paste it into the PR description."));
  } catch (e) {
    vscode.window.showErrorMessage(t("Couldn't build the receipt: {0}", e instanceof Error ? e.message : String(e)));
  }
}

function clip(s: string, n: number): string {
  const c = Array.from(s);
  return c.length > n ? c.slice(0, n - 1).join("") + "…" : s;
}

/** 코드 칸 — 안에서는 마크다운 이스케이프가 글자 그대로 보이므로 백틱만 바꾼다. */
function code(s: string): string {
  return "`" + s.replace(/`/g, "'") + "`";
}

function escape(s: string): string {
  return s.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, "\\$&");
}
