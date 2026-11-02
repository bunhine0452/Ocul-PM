// 앱 · Claude 와 잇는 자리 (0.3.0) — 확장과 앱이 서로 넘겨주는 길.
//   상태 표시줄 「Claude 기다림 N」 — 플러그인 훅 인박스에서 읽은 기다림 · 앱에 뜬 질문(`ask_user`)
//   「Ocul 에서 열기」          — 앱의 딥링크 `oculpm://open` (앱은 열기 전에 묻는다). 링크는 여는 것뿐이다.
//   「터미널에서 이어서」        — VS Code 통합 터미널에 `claude "/oculpm:next <계획>"` 을 친다. 사용자가 누를 때만,
//                                 신뢰한 작업 영역에서만. 확장이 스스로 띄우는 프로세스는 없다.
// 확장은 `.oculpm/` 에 쓰지 않는다 — 질문의 답은 앱이나 그 claude 세션에서 한다(.claude/rules/vscode-extension.md).

import * as vscode from "vscode";
import { appLink, nextCommand, type AppTarget } from "./model/applink";
import { livePlans } from "./model/overview";
import type { Plan } from "./model/plan";
import type { Project } from "./project";
import { whenLabel } from "./text";

const t = vscode.l10n.t;

/** 앱 딥링크 주소 — `oculpm://` 만 만든다. 웹 주소는 열지 않는다(`guard.spec.ts`). */
function appUri(p: Project, target: AppTarget): vscode.Uri {
  return vscode.Uri.parse(appLink(p.root.fsPath, target), true);
}

export function openInApp(p: Project, target: AppTarget): Thenable<boolean> {
  return vscode.env.openExternal(appUri(p, target));
}

/** 「Claude 기다림 N」 — 기다림도 질문도 없으면 숨는다. */
export function renderClaude(item: vscode.StatusBarItem, p: Project | undefined): void {
  const waiting = p?.store.waiting ?? [];
  const questions = p?.store.questions ?? [];
  const n = waiting.length + questions.length;
  if (!p || n === 0) return item.hide();
  item.text = `$(bell) ${t("Claude waiting {0}", n)}`;
  item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
  const md = new vscode.MarkdownString(undefined, true);
  for (const q of questions) md.appendMarkdown(`$(question) ${escape(q.question)} · ${whenLabel(q.askedAt)}\n\n`);
  for (const w of waiting) md.appendMarkdown(`$(bell) ${escape(w.message ?? kindText(w.kind))} · ${whenLabel(w.since)}\n\n`);
  md.appendMarkdown(t("Click to see them, or open Ocul to answer."));
  item.tooltip = md;
  item.show();
}

function kindText(kind: string): string {
  return kind === "permission" ? t("Claude is asking for permission") : t("Claude is waiting for your input");
}

type Pick = vscode.QuickPickItem & { run?: () => Thenable<unknown> };

/** 기다림 · 질문 목록 — 질문은 앱에서 답한다(오늘 화면). */
export async function showClaude(p: Project | undefined): Promise<void> {
  if (!p) return void vscode.window.showInformationMessage(t("No .oculpm/ folder in this workspace."));
  const items: Pick[] = [];
  const today = () => openInApp(p, { kind: "view", view: "today" });
  if (p.store.questions.length > 0) {
    items.push({ label: t("Claude's questions"), kind: vscode.QuickPickItemKind.Separator });
    for (const q of p.store.questions)
      items.push({
        label: `$(question) ${q.question}`,
        description: whenLabel(q.askedAt),
        detail: q.options.length > 0 ? q.options.join(" · ") : t("Answer in Ocul"),
        run: today,
      });
  }
  if (p.store.waiting.length > 0) {
    items.push({ label: t("Claude is waiting"), kind: vscode.QuickPickItemKind.Separator });
    for (const w of p.store.waiting)
      items.push({ label: `$(bell) ${w.message ?? kindText(w.kind)}`, description: whenLabel(w.since), detail: kindText(w.kind), run: today });
  }
  if (items.length === 0) return void vscode.window.showInformationMessage(t("Claude is not waiting on you."));
  items.push({ label: "", kind: vscode.QuickPickItemKind.Separator }, { label: `$(link-external) ${t("Open Ocul's Today")}`, run: today });
  const pick = await vscode.window.showQuickPick(items, { placeHolder: t("Ocul · Claude in {0}", p.store.name), matchOnDetail: true });
  await pick?.run?.();
}

/** 「Ocul 에서 열기」 — 오늘 · 이 파일을 건드린 일지 · 살아 있는 계획 중에서. */
export async function pickInApp(p: Project | undefined, file?: string | null): Promise<void> {
  if (!p) return void vscode.window.showInformationMessage(t("No .oculpm/ folder in this workspace."));
  const items: Pick[] = [{ label: `$(home) ${t("Today")}`, run: () => openInApp(p, { kind: "view", view: "today" }) }];
  const js = file ? p.journalsFor(file).slice(0, 5) : [];
  if (js.length > 0) {
    items.push({ label: t("Journal entries that touched {0}", file ?? ""), kind: vscode.QuickPickItemKind.Separator });
    for (const j of js)
      items.push({ label: `$(book) ${j.title || j.path}`, description: whenLabel(j.createdAt), run: () => openInApp(p, { kind: "journal", path: j.path }) });
  }
  const plans = livePlans(p.store.plans);
  if (plans.length > 0) {
    items.push({ label: t("Plans"), kind: vscode.QuickPickItemKind.Separator });
    for (const pl of plans)
      items.push({ label: `$(checklist) ${pl.title}`, description: nextLabel(pl), run: () => openInApp(p, { kind: "plan", id: pl.id }) });
  }
  const pick = await vscode.window.showQuickPick(items, { placeHolder: t("Open in Ocul") });
  await pick?.run?.();
}

function nextLabel(pl: Plan): string {
  return pl.next ? t("next: {0}", pl.next.title) : "";
}

/** 살아 있는 계획 중 다음 항목이 있는 것. */
export function plansWithNext(p: Project): Plan[] {
  return livePlans(p.store.plans).filter((pl) => pl.next !== null);
}

/** VS Code 터미널에서 다음 항목을 claude 로 — 계획이 여럿이면 고른다. */
export async function continueInTerminal(p: Project | undefined, planId?: string): Promise<void> {
  if (!p) return void vscode.window.showInformationMessage(t("No .oculpm/ folder in this workspace."));
  if (!vscode.workspace.isTrusted)
    return void vscode.window.showWarningMessage(t("Trust this workspace first. Ocul only starts claude in a trusted folder."));
  const plans = plansWithNext(p);
  let plan = planId ? plans.find((pl) => pl.id === planId) : plans.length === 1 ? plans[0] : undefined;
  if (!plan && plans.length > 1) {
    const pick = await vscode.window.showQuickPick(
      plans.map((pl) => ({ label: pl.title, description: pl.id, detail: nextLabel(pl), pl })),
      { placeHolder: t("Which plan should claude continue?") },
    );
    if (!pick) return;
    plan = pick.pl;
  }
  if (!plan) return void vscode.window.showInformationMessage(t("No open item left in a live plan."));
  const term = vscode.window.createTerminal({ name: t("Ocul · claude"), cwd: p.root });
  term.show();
  term.sendText(nextCommand(plan.id));
}

function escape(s: string): string {
  return s.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, "\\$&");
}
