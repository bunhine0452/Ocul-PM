import { Bug, SparklesIcon, GitBranch, TriangleAlert, Wrench } from "@/components/Icons";
import type { EntryType } from "@/lib/bindings";
import { t, type I18nKey } from "@/i18n";

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
  labelKey: I18nKey;
  /** primitives.css class — note bug → t-bugfix. */
  cls: string;
  /** tokens.css trigger var suffix — `var(--t-${cssVar})`. */
  cssVar: string;
}

export const TRIGGER_META: Record<EntryType, TriggerMeta> = {
  bug: { icon: Bug, labelKey: "trigger.bug", cls: "t-bugfix", cssVar: "bug" },
  feature: { icon: SparklesIcon, labelKey: "trigger.feature", cls: "t-feature", cssVar: "feature" },
  refactor: { icon: GitBranch, labelKey: "trigger.refactor", cls: "t-refactor", cssVar: "refactor" },
  error: { icon: TriangleAlert, labelKey: "trigger.error", cls: "t-error", cssVar: "error" },
  chore: { icon: Wrench, labelKey: "trigger.chore", cls: "t-chore", cssVar: "chore" },
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
      {withLabel ? t(m.labelKey) : null}
    </span>
  );
}
