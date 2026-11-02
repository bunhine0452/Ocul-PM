// 화면 글 — 원문은 영어, 한국어는 `l10n/bundle.l10n.ko.json` (VS Code 표시 언어를 따른다).

import * as vscode from "vscode";
import type { Ago } from "./model/time";
import type { ReceiptText } from "./model/receipt";

const t = vscode.l10n.t;

export function agoText(a: Ago | null): string {
  if (!a) return "";
  switch (a.unit) {
    case "now":
      return t("just now");
    case "min":
      return t("{0}m ago", a.n);
    case "hour":
      return t("{0}h ago", a.n);
    case "day":
      return t("{0}d ago", a.n);
  }
}

/** 앱 `whenLabel` 과 같은 모양 — 오늘이면 시각, 어제면 「어제 HH:MM」, 그 전은 날짜와 시각. */
export function whenLabel(iso: string, now = new Date()): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const at = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  const time = `${p(at.getHours())}:${p(at.getMinutes())}`;
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(at, now)) return time;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (same(at, yesterday)) return t("yesterday {0}", time);
  const date = new Intl.DateTimeFormat(vscode.env.language, { month: "short", day: "numeric" }).format(at);
  return `${date} ${time}`;
}

/** 부를 때 만든다 — 모듈을 읽는 순간에는 표시 언어 묶음이 아직 없을 수 있다. */
export const receiptText = (): ReceiptText => ({
  title: t("Ocul receipt"),
  meta: (c, f) => t("{0} commits · {1} files changed", c, f),
  plans: t("Plan check commands"),
  plan: (title) => t("“{0}”", title),
  noRun: t("never run yet"),
  noSummary: t("no result line"),
  journals: (n, m) => t("{0} journal entries ({1} with a command run)", n, m),
  noJournals: t("No journal entries on this branch"),
  noProof: t("no command run in verification"),
  unrecorded: (n) => t("{0} changes in no journal entry", n),
  more: (n) => t("{0} more", n),
  footer: t("Built by Ocul from this repository's .oculpm/ records, without an LLM"),
  when: (iso) => whenLabel(iso),
});
