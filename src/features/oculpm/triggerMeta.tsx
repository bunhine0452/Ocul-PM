import { Bug, SparklesIcon, GitBranch, TriangleAlert, Wrench } from "@/components/Icons";
import type { EntryType } from "@/lib/bindings";

// Final UI Update (ui_v2) — trigger (작업 일지 카테고리) metadata, shared by the
// Today highlights and the Journal timeline. Mirrors Ocul-PM1.0/src/icons.jsx
// TRIGGER_META. The backend EntryType is "bug" (not "bugfix"); the mockup CSS
// class for bug is `.t-bugfix`, so we map type → class explicitly here.

type IconComp = React.ComponentType<{
  size?: number | string;
  strokeWidth?: number | string;
  color?: string;
}>;

interface TriggerMeta {
  icon: IconComp;
  label: string;
  /** primitives.css class — note bug → t-bugfix. */
  cls: string;
  /** tokens.css trigger var suffix — `var(--t-${cssVar})`. */
  cssVar: string;
}

export const TRIGGER_META: Record<EntryType, TriggerMeta> = {
  bug: { icon: Bug, label: "버그 수정", cls: "t-bugfix", cssVar: "bug" },
  feature: { icon: SparklesIcon, label: "기능 추가", cls: "t-feature", cssVar: "feature" },
  refactor: { icon: GitBranch, label: "리팩토링", cls: "t-refactor", cssVar: "refactor" },
  error: { icon: TriangleAlert, label: "에러 사이클", cls: "t-error", cssVar: "error" },
  chore: { icon: Wrench, label: "잡일", cls: "t-chore", cssVar: "chore" },
};

export function TriggerBadge({
  type,
  withLabel = true,
}: {
  type: EntryType;
  withLabel?: boolean;
}) {
  const m = TRIGGER_META[type] ?? TRIGGER_META.chore;
  const Icon = m.icon;
  return (
    <span className={"tbadge " + m.cls}>
      <Icon size={12} strokeWidth={2.1} />
      {withLabel ? m.label : null}
    </span>
  );
}
