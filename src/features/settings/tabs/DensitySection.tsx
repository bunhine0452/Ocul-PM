import { ChevronRight } from "@/components/Icons";
import { useSettings } from "@/contexts/SettingsContext";
import { useDensity } from "@/hooks/useDensity";
import { useT } from "@/i18n";
import { kbd } from "@/lib/kbd";
import { parseHiddenViews, toggleHiddenView, type HoldSwitchView, type UiDensity } from "@/lib/density";
import { reportRejection } from "@/lib/reportFailure";
import { Section, Toggle } from "./ui";

/**
 * 설정 「표시」 — 밀도 하나, 베타 화면 스위치 다섯, 그 밖에 둘 (UI 밀도 라운드 3, 시안 F).
 *
 * 밀도는 두 선택지 각각에 "누구를 위한 것인가" 한 줄. 베타 스위치는 사이드바의 베타 단
 * 행을 **접는** 것이다 — 화면·단축키·⌘K 는 그대로라 숨김이 아니다. 끈 화면이 열려 있으면
 * 행이 저절로 돌아온다 (Sidebar).
 */
const BETA_ROWS: Array<{ id: HoldSwitchView; labelKey: "settings.beta.terminal" | "settings.beta.code" | "settings.beta.claudecode" | "settings.beta.codex" | "settings.beta.ai"; shortcut: string | null }> = [
  { id: "terminal", labelKey: "settings.beta.terminal", shortcut: kbd("⌘J") },
  { id: "code", labelKey: "settings.beta.code", shortcut: null },
  { id: "claudecode", labelKey: "settings.beta.claudecode", shortcut: null },
  { id: "codex", labelKey: "settings.beta.codex", shortcut: null },
  { id: "ai", labelKey: "settings.beta.ai", shortcut: kbd("⌘\\") },
];

export function DensitySection() {
  const { density, set } = useDensity();
  const { settings, set: save } = useSettings();
  const { t } = useT();
  const hidden = parseHiddenViews(settings.hiddenHoldViews);
  const options: Array<{ id: UiDensity; label: string; hint: string; tag?: string }> = [
    { id: "simple", label: t("density.simple"), hint: t("settings.density.simpleHint"), tag: t("settings.density.defaultTag") },
    { id: "pro", label: t("density.pro"), hint: t("settings.density.proHint") },
  ];
  const subOf = (row: (typeof BETA_ROWS)[number]) => {
    const key = row.id === "terminal" ? "settings.beta.terminalSub" : row.id === "code" ? "settings.beta.codeSub" : row.id === "ai" ? "settings.beta.aiSub" : "settings.beta.acpSub";
    const k = row.shortcut;
    return k ? t(key, { kbd: k }) : t(key, { kbd: "" }).replace(/\s*·\s*$/, "");
  };
  return (
    <>
      <Section title={t("settings.density.title")} description={t("settings.density.desc", { kbd: kbd("⌘.") })}>
        <div className="cfg-density" role="radiogroup" aria-label={t("settings.density.title")}>
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={density === o.id}
              className={"cfg-density-opt" + (density === o.id ? " on" : "")}
              onClick={() => set(o.id)}
            >
              <span className="cfg-density-dot" aria-hidden="true" />
              <span className="cfg-density-text">
                <b>
                  {o.label}
                  {o.tag ? <i>{o.tag}</i> : null}
                </b>
                <span>{o.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </Section>

      <Section title={t("settings.beta.title")} description={t("settings.beta.desc")}>
        <div className="cfg-beta-list">
          {BETA_ROWS.map((row) => (
            <label key={row.id} className="cfg-beta-row">
              <span className="cfg-beta-text">
                <span>{t(row.labelKey)}</span>
                <small>{subOf(row)}</small>
              </span>
              <input
                type="checkbox"
                checked={!hidden.has(row.id)}
                onChange={() => reportRejection(save("hiddenHoldViews", toggleHiddenView(settings.hiddenHoldViews, row.id)), "settings.saveFailed")}
                aria-label={t(row.labelKey)}
              />
            </label>
          ))}
        </div>
        <p className="cfg-field-hint">{t("settings.beta.note", { kbd: kbd("⌘K") })}</p>
      </Section>

      <Section title={t("settings.misc.title")}>
        <Toggle
          checked={settings.kbdHints}
          onChange={(v) => reportRejection(save("kbdHints", v), "settings.saveFailed")}
          label={t("settings.misc.kbdHints")}
          hint={t("settings.misc.kbdHintsHint")}
        />
        <button
          type="button"
          className="cfg-toggle cfg-jump"
          onClick={() => document.getElementById("cfg-theme")?.scrollIntoView({ block: "start", behavior: "smooth" })}
        >
          <span className="cfg-toggle-text">
            {t("settings.misc.theme")}
            <p className="cfg-field-hint">{t("settings.misc.themeHint")}</p>
          </span>
          <ChevronRight size={13} aria-hidden="true" />
        </button>
      </Section>
    </>
  );
}
