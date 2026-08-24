// 폰에 데스크톱 테마를 그대로 나른다 — "내 앱" 감각의 절반은 색이다.
//
// SettingsContext 와 같은 판정(data-theme family / data-preset / data-accent)을
// 맥의 설정(SQLite, settings_get)으로 수행한다. PRESET_FAMILY 를 임포트해
// 사본 드리프트를 막는다. 설정을 못 읽으면(구버전 서버 등) OS 다크모드만 따른다.

import { commands } from "@/lib/bindings";
import { PRESET_FAMILY } from "@/contexts/SettingsContext";

export async function applyDesktopTheme(): Promise<() => void> {
  let theme = "system";
  let accent = "green";
  const [t, a] = await Promise.all([
    commands.settingsGet("theme"),
    commands.settingsGet("color_theme"),
  ]);
  if (t.status === "ok" && t.data) theme = t.data;
  if (a.status === "ok" && a.data) accent = a.data;

  const root = document.documentElement;
  const preset = PRESET_FAMILY[theme] ? theme : null;

  const apply = () => {
    let family: "light" | "dark";
    if (preset) family = PRESET_FAMILY[preset];
    else if (theme === "dark") family = "dark";
    else if (theme === "light") family = "light";
    else family = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    root.setAttribute("data-theme", family);
    if (preset) root.setAttribute("data-preset", preset);
    else root.removeAttribute("data-preset");
    if (preset) root.removeAttribute("data-accent");
    else root.setAttribute("data-accent", accent);
  };
  apply();

  if (theme === "system") {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }
  return () => {};
}
