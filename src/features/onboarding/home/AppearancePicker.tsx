/**
 * 아이콘·색 선택기 — 프로젝트 편집 다이얼로그 안에서만 쓴다.
 *
 * 라디오 그룹 두 개다. 체크박스가 아니라 라디오인 이유: 각 축에서 정확히
 * 하나만 고를 수 있고, 화살표로 옮겨 다니는 것이 표준 동작이다 (roving
 * tabindex — 그룹 전체의 탭 스톱은 1개).
 */
import { useT } from "@/i18n";
import { PROJECT_COLORS, PROJECT_ICONS, type ProjectColorId } from "./projectAppearance";

interface Props {
  icon: string;
  color: ProjectColorId;
  onIcon: (id: string) => void;
  onColor: (id: ProjectColorId) => void;
}

export function AppearancePicker({ icon, color, onIcon, onColor }: Props) {
  const { t } = useT();

  /** ←→ 로 이웃 항목을 고른다 (라디오 그룹 표준). 끝에서 감싼다. */
  const arrows =
    <T,>(items: readonly T[], current: number, pick: (v: T) => void) =>
    (e: React.KeyboardEvent) => {
      const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (step === 0) return;
      e.preventDefault();
      pick(items[(current + step + items.length) % items.length]);
    };

  const iconIndex = Math.max(
    0,
    PROJECT_ICONS.findIndex((i) => i.id === icon),
  );
  const colorIndex = Math.max(0, PROJECT_COLORS.indexOf(color));

  return (
    <div className="ap-wrap">
      <div>
        <p className="ap-label" id="ap-icon-label">
          {t("project.edit.icon")}
        </p>
        <div className="ap-row" role="radiogroup" aria-labelledby="ap-icon-label">
          {PROJECT_ICONS.map((spec) => {
            const on = spec.id === icon;
            return (
              <button
                key={spec.id}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={t(`project.icon.${spec.id}` as never)}
                title={t(`project.icon.${spec.id}` as never)}
                tabIndex={on ? 0 : -1}
                className={"ap-icon" + (on ? " on" : "")}
                data-pc={color}
                onClick={() => onIcon(spec.id)}
                onKeyDown={arrows(PROJECT_ICONS, iconIndex, (s) => onIcon(s.id))}
              >
                <spec.Icon strokeWidth={1.9} />
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="ap-label" id="ap-color-label">
          {t("project.edit.color")}
        </p>
        <div className="ap-row" role="radiogroup" aria-labelledby="ap-color-label">
          {PROJECT_COLORS.map((c) => {
            const on = c === color;
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={t(`project.color.${c}` as never)}
                title={t(`project.color.${c}` as never)}
                tabIndex={on ? 0 : -1}
                className={"ap-color" + (on ? " on" : "")}
                data-pc={c}
                onClick={() => onColor(c)}
                onKeyDown={arrows(PROJECT_COLORS, colorIndex, onColor)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
