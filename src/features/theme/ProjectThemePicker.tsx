/**
 * 프로젝트별 테마 선택 (Phase 4 `#project-theme`).
 *
 * Osaurus 는 "에이전트에 테마를 묶는다" — 코드 리뷰어와 얘기 중인지 테라피스트와
 * 얘기 중인지를 색으로 안다. 여기서는 **프로젝트 바인딩**으로 번역한다: 저장소를
 * 여럿 열어 두고 "지금 어디에 있는지" 를 헷갈리는 문제를 색이 해결한다.
 *
 * 값은 설정의 `theme` 와 같은 축이다 — 빈 문자열(= 바인딩 없음)이거나
 * `"light"`/`"dark"`/`"system"`/내장 id/`custom:<uuid>`.
 *
 * 사이드바의 프로젝트 색(`--pc`)과는 다른 축이다 — 테마는 전체 표면, 프로젝트
 * 색은 마크. 둘은 겹치지 않는다.
 */
import { useT } from "@/i18n";

import { BUILTIN_THEMES } from "./builtins";
import { CUSTOM_PREFIX } from "./apply";
import { useThemeState } from "./store";

interface Props {
  /** `null` = 바인딩 없음(전역 설정). */
  value: string | null;
  onChange: (next: string | null) => void;
}

export function ProjectThemePicker({ value, onChange }: Props) {
  const { t } = useT();
  const { customThemes } = useThemeState();

  return (
    <div className="space-y-1.5">
      <label className="ap-label" htmlFor="project-theme-select">
        {t("theme.project.label")}
      </label>
      <select
        id="project-theme-select"
        value={value ?? ""}
        onChange={(e) => onChange(e.currentTarget.value || null)}
        className="w-full px-3 py-2 border border-border rounded-xl bg-background text-sm text-foreground"
      >
        <option value="">{t("theme.project.global")}</option>
        <option value="light">{t("theme.project.light")}</option>
        <option value="dark">{t("theme.project.dark")}</option>
        <option value="system">{t("theme.project.system")}</option>
        {BUILTIN_THEMES.map((theme) => (
          <option key={theme.metadata.id} value={theme.metadata.id}>
            {theme.metadata.name}
          </option>
        ))}
        {customThemes.map((theme) => (
          <option key={theme.metadata.id} value={`${CUSTOM_PREFIX}${theme.metadata.id ?? ""}`}>
            {theme.metadata.name}
          </option>
        ))}
      </select>
      <p className="text-[11px] text-muted-foreground/80">{t("theme.project.hint")}</p>
    </div>
  );
}
