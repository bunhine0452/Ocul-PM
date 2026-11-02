// Ocul — 에이전트가 한 일의 영수증을 코드 옆에.
//
// 앱 없이 동작한다. `.oculpm/` 마크다운을 읽기만 하고(쓰기 0), git 은 VS Code 내장 git 확장의 API 로만
// 본다(자식 프로세스 0), 네트워크에 닿지 않는다(`src/guard.spec.ts` 가 지킨다). 보여 주는 것은 예외뿐이다:
//   사이드바 패널     — Claude 기다림 · 지금 볼 것 · 다음 할 일 · 최근 일지 (`panel.ts`)
//   상태 표시줄 왼쪽  — 한 칸: Claude 기다림 · 마지막 확인 명령 결과(✓/✗) · 어느 일지에도 없는 변경 수
//   상태 표시줄 오른쪽 — 지금 연 파일의 영수증(이 파일을 건드린 일지 · 돌린 명령)
//   탐색기 배지       — 어느 일지에도 없는 변경 파일
//   알림              — Claude 가 새로 기다리기 시작할 때 한 번
// 앱과는 `bridge.ts` 로 잇는다 — 「Ocul 에서 열기」(앱 딥링크) · 「터미널에서 이어서」(사용자가 누를 때만).

import * as vscode from "vscode";
import { branchChanges, gitApi } from "./git";
import { COMMAND } from "./model/evidence";
import type { Journal } from "./model/journal";
import { livePlans, type Overview } from "./model/overview";
import { arrivals } from "./model/panel";
import { receiptMarkdown } from "./model/receipt";
import { ago } from "./model/time";
import { Project } from "./project";
import { trackedFolders } from "./store";
import { agoText, receiptText, whenLabel } from "./text";
import { continueInTerminal, kindText, notifyArrival, pickInApp, plansWithNext } from "./bridge";
import { BADGE, openNodeInApp, Panel, planIdOf, preview } from "./panel";

const t = vscode.l10n.t;

let projects: Project[] = [];
let gitSub: vscode.Disposable | undefined;
/** 프로젝트마다 이미 알린 기다림 — 처음 읽을 때는 비어 있지 않아도 울리지 않는다(`arrivals`). */
const seen = new Map<Project, Set<string>>();

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  const summary = vscode.window.createStatusBarItem("ocul.summary", vscode.StatusBarAlignment.Left, 50);
  summary.name = "Ocul";
  summary.command = "ocul.showPanel";
  const file = vscode.window.createStatusBarItem("ocul.file", vscode.StatusBarAlignment.Right, 100);
  file.name = t("Ocul — this file's receipt");
  file.command = "ocul.fileHistory";
  const decorations = new UnrecordedDecorations();
  const panel = new Panel(() => current());
  ctx.subscriptions.push(summary, file, decorations, panel, vscode.window.registerFileDecorationProvider(decorations));
  const reveal = () => panel.reveal();

  const render = () => {
    renderSummary(summary);
    renderFile(file);
    decorations.refresh();
    panel.refresh();
    ring(reveal);
  };

  const rebuild = async () => {
    for (const p of projects) p.dispose();
    seen.clear();
    projects = (await trackedFolders()).map((root) => new Project(root));
    await vscode.commands.executeCommand("setContext", "ocul.tracked", projects.length > 0);
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
    vscode.commands.registerCommand("ocul.showPanel", reveal),
    vscode.commands.registerCommand("ocul.panel.openInApp", (node) => openNodeInApp(current(), node)),
    vscode.commands.registerCommand("ocul.panel.continue", (node) => continueInTerminal(current(), planIdOf(node))),
    vscode.commands.registerCommand("ocul.panel.openToday", () => {
      const p = current();
      return p && openNodeInApp(p, undefined);
    }),
    vscode.commands.registerCommand("ocul.fileHistory", fileHistory),
    vscode.commands.registerCommand("ocul.copyReceipt", copyReceipt),
    vscode.commands.registerCommand("ocul.refresh", () => rebuild()),
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
  const tick = setInterval(() => (renderSummary(summary), panel.refresh()), 60_000);
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

/** Claude 가 새로 기다리면 알린다 — 지금 연 프로젝트가 아니어도(창 하나에 폴더 여럿). */
function ring(reveal: () => Thenable<unknown>): void {
  const on = vscode.workspace.getConfiguration("ocul").get<boolean>("notifyWhenClaudeWaits", true);
  for (const p of projects) {
    const r = arrivals(seen.get(p) ?? null, p.store.waiting, p.store.questions);
    seen.set(p, r.seen);
    if (on && r.fresh.length > 0) void notifyArrival(p, r.fresh[r.fresh.length - 1], reveal);
  }
}

/**
 * 상태 표시줄 한 칸 — 급한 것이 앞에 선다: Claude 기다림 · 확인 명령 결과 · 기록 없는 변경 수.
 * 색은 손대야 할 때만: 실패면 빨강, Claude 가 기다리면 노랑, 그 밖에는 바탕 그대로.
 */
function renderSummary(item: vscode.StatusBarItem): void {
  const p = current();
  if (!p) return item.hide();
  const o = p.overview();
  const waiting = p.store.waiting.length + p.store.questions.length;
  const parts: string[] = [];
  if (waiting > 0) parts.push(`$(bell) ${t("Claude waiting {0}", waiting)}`);
  if (o.failing.length > 0) {
    parts.push(`$(error) ${clip(o.failing[0].summary || o.failing[0].plan.title, waiting > 0 ? 24 : 36)}`);
  } else if (o.latest) {
    parts.push(`$(pass) ${t("passed {0}", agoText(ago(o.latest.ts, Date.now())))}`);
  } else if (waiting === 0) {
    parts.push("$(eye) Ocul");
  }
  if (o.unrecorded.length > 0) parts.push(`${BADGE} ${o.unrecorded.length}`);
  item.text = parts.join("  ");
  item.backgroundColor =
    o.failing.length > 0
      ? new vscode.ThemeColor("statusBarItem.errorBackground")
      : waiting > 0
        ? new vscode.ThemeColor("statusBarItem.warningBackground")
        : undefined;
  item.tooltip = summaryTooltip(p, o);
  item.show();
}

function summaryTooltip(p: Project, o: Overview): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  // 아래 명령 링크만 누를 수 있게 — 다른 명령은 막힌다.
  md.isTrusted = { enabledCommands: ["ocul.openInApp", "ocul.continueInTerminal", "ocul.showPanel"] };
  md.appendMarkdown(`**Ocul · ${escape(p.store.name)}**\n\n`);
  for (const q of p.store.questions) md.appendMarkdown(`$(comment-discussion) ${escape(q.question)} · ${whenLabel(q.askedAt)}\n\n`);
  for (const w of p.store.waiting) md.appendMarkdown(`$(bell) ${escape(w.message ?? kindText(w.kind))} · ${whenLabel(w.since)}\n\n`);
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
  md.appendMarkdown(`[$(eye) ${t("Open the Ocul panel")}](command:ocul.showPanel)`);
  md.appendMarkdown(` · [$(link-external) ${t("Open in Ocul")}](command:ocul.openInApp)`);
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
