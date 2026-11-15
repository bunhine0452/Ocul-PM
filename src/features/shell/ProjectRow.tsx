/**
 * 프로젝트 한 줄 (11-15) — ⌘O 목록 · ⌥Tab 창 전환기 · 시작 창 · ⌘K 가 같은 줄을 쓴다.
 *
 * 네 곳이 다 달랐다. 같은 기다림이 ⌘O 는 앰버 「기다림 n」, 시작 창은 회색 「내 차례」, ⌘K 는 표시 없음이었고,
 * 경로 표기도 넷이라 끝을 잘라 폴더 이름이 먼저 사라졌다. 이제 줄은 하나다:
 *
 *   점 · 이름 · 어디(이름이 겹칠 때만) · 상태 칩 하나 · 끝 메타
 *
 * - 어디는 기계 글씨(영수증 규칙 2)이고 **앞을 접는다** — 가까운 폴더가 끝까지 남는다. 이름이 하나뿐이면
 *   경로는 줄에 서지 않는다(툴팁 · 설명으로만). 줄마다 같은 경로가 반복되면 이름이 묻힌다.
 * - 상태 칩은 규칙 4 의 넷 중 하나다: 기다림 n(warn) · 확인 실패(danger) · 터미널 소식(중립) · 열림(hairline).
 *   여럿이면 급한 것 하나만 — 줄 순서(`byAttention`)와 같은 순위다.
 * 줄을 감싸는 상호작용(단추 · 옵션 · cmdk 항목)은 부르는 쪽이 갖는다. 이 줄은 내용만 그린다.
 */
import type { ReactNode } from "react";

import type { ProjectTerms } from "@/features/terminal/status";
import { useT, type I18nKey, type TVars } from "@/i18n";
import type { Project } from "@/lib/bindings";
import { tildePath } from "@/lib/osPath";
import { projectColorOf } from "./projectColor";
import "./projectRow.css";

type Tr = (key: I18nKey, vars?: TVars) => string;

/** 「어디」 — 폴더 이름이 프로젝트 이름과 같으면(대소문자는 접는다) 되풀이하지 않고 그 위 폴더만(`~/Desktop/git`). */
export function whereOf(name: string, root: string): string {
  const path = tildePath(root).replace(/[\\/]+$/, "");
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (cut <= 0 || path.slice(cut + 1).toLowerCase() !== name.toLowerCase()) return path;
  return path.slice(0, cut);
}

/** 이름이 겹치는 프로젝트만 「어디」 — 대소문자 · 앞뒤 공백은 접어서 센다. 나머지는 줄에 경로가 없다. */
export function distinctWhere(projects: readonly Pick<Project, "id" | "name" | "root_path">[]): Map<number, string> {
  const fold = (name: string) => name.trim().toLowerCase();
  const seen = new Map<string, number>();
  for (const p of projects) seen.set(fold(p.name), (seen.get(fold(p.name)) ?? 0) + 1);
  const out = new Map<number, string>();
  for (const p of projects) {
    if ((seen.get(fold(p.name)) ?? 0) > 1) out.set(p.id, whereOf(p.name, p.root_path));
  }
  return out;
}

/** 줄이 아는 신호 — 없으면 그 칩은 서지 않는다. */
export interface RowSignals {
  /** 창 감시기의 기다림 · 실패 (`windowApi.attention`). */
  attention?: { waiting: number; failing: boolean };
  /** 앱 안 터미널 (`useTermOverview`). */
  terms?: ProjectTerms;
  /** 다른 창에 열려 있다(⌘O). */
  open?: boolean;
  /** 시작 창 — 오늘 일지 없는 파일 수. `null` 은 모름, `undefined` 는 이 자리에 없는 값. */
  toCheck?: number | null;
}

export type ChipTone = "warn" | "danger" | "neutral" | "hairline" | "unknown";

export interface RowChip {
  tone: ChipTone;
  label: string;
  title?: string;
  /** 읽지 않은 터미널 소식의 점. */
  dot?: boolean;
}

/** 상태 칩 하나 — 급한 순: 기다림 · 확인 실패 · 일지 없는 파일 · 터미널 소식 · 열림 · 모름. */
export function rowChip(s: RowSignals, t: Tr): RowChip | null {
  const waiting = Math.max(s.attention?.waiting ?? 0, s.terms?.waiting ?? 0);
  if (waiting > 0) return { tone: "warn", label: t("sidebar.waiting", { n: waiting }), title: t("sidebar.waitingTitle") };
  if (s.attention?.failing) return { tone: "danger", label: t("sidebar.failing"), title: t("sidebar.failingTitle") };
  if (s.toCheck != null && s.toCheck > 0) {
    return { tone: "warn", label: t("start.toCheck", { n: s.toCheck }), title: t("start.toCheckTitle") };
  }
  if (s.terms?.unseen) return { tone: "neutral", label: t("terminal.sum.unseen"), title: t("terminal.sum.unseenTitle"), dot: true };
  if (s.terms && s.terms.alive > 0) {
    return { tone: "neutral", label: t("terminal.sum.running", { n: s.terms.alive }), title: t("terminal.sum.title", { n: s.terms.alive }) };
  }
  if (s.open) return { tone: "hairline", label: t("sidebar.openProject") };
  if (s.toCheck === null) return { tone: "unknown", label: "—", title: t("start.toCheckUnknown") };
  return null;
}

const TONE_CLASS: Record<ChipTone, string> = {
  warn: "chip sm warn",
  danger: "chip sm danger",
  neutral: "chip sm",
  hairline: "chip sm hairline",
  unknown: "prow-unknown",
};

/**
 * 「지금 창」 — 이 창의 프로젝트 줄 끝(⌘O 목록 · ⌥Tab 창 전환기가 같은 모양, 11-15 검수). 현재 상태는 회색 ✓ 다
 * (영수증 규칙 1 · 4, `.chip.ok`) — ⌘O 는 강조색 ✓ 아이콘, ⌥Tab 은 회색 글자로 같은 것을 다르게 말했다.
 */
export function HereMark() {
  const { t } = useT();
  return <span className="chip sm ok">{t("switcher.here")}</span>;
}

export function RowChipView({ chip, id }: { chip: RowChip; id?: string }) {
  return (
    <span className={"prow-chip " + TONE_CLASS[chip.tone]} title={chip.title} id={id}>
      {chip.dot ? <span className="terms-unseen" aria-hidden="true" /> : null}
      {chip.label}
    </span>
  );
}

interface ProjectRowProps {
  project: Pick<Project, "name" | "root_path" | "color">;
  /** 이름이 겹칠 때만 — `distinctWhere`. 없으면 줄에 경로가 서지 않는다. */
  where?: string | null;
  signals?: RowSignals;
  /** 줄 끝 — 번호 키 · 날짜 · 「지금 창」. */
  meta?: ReactNode;
  /**
   * 칸 id 의 머리 — 주면 경로 · 칩 · 끝 메타에 id 를 달아 부르는 쪽이 `aria-describedby` 로 잇는다
   * (`describedBy`). 경로가 줄에 안 서도 설명에는 남는다.
   */
  idPrefix?: string;
}

/** `idPrefix` 로 그린 줄의 설명 id 들 — 줄을 감싼 단추의 `aria-describedby` 에 그대로 넣는다. */
export function describedBy(idPrefix: string): string {
  return `${idPrefix}-where ${idPrefix}-chip ${idPrefix}-meta`;
}

export function ProjectRow({ project, where, signals, meta, idPrefix }: ProjectRowProps) {
  const { t } = useT();
  const chip = signals ? rowChip(signals, t) : null;
  const path = tildePath(project.root_path);
  const id = (part: string) => (idPrefix ? `${idPrefix}-${part}` : undefined);
  return (
    <>
      <span className="proj-dot" data-pc={projectColorOf(project.color)} aria-hidden="true" />
      <span className="prow-name">{project.name}</span>
      {where ? (
        <span className="prow-where" title={path} id={id("where")}>
          <bdi>{where}</bdi>
        </span>
      ) : idPrefix ? (
        <span className="sr-only" id={id("where")}>
          {path}
        </span>
      ) : null}
      {/* 칩이 없어도 id 자리는 남긴다 — 설명(`describedBy`)이 없는 id 를 가리키지 않게. */}
      {chip ? <RowChipView chip={chip} id={id("chip")} /> : idPrefix ? <span id={id("chip")} hidden /> : null}
      {meta != null ? (
        <span className="prow-meta" id={id("meta")}>
          {meta}
        </span>
      ) : idPrefix ? (
        <span id={id("meta")} hidden />
      ) : null}
    </>
  );
}
