/**
 * 테마 편집기 (Phase 4 `#theme-editor`).
 *
 * **별도 미리보기 캔버스를 만들지 않는다 — 앱이 곧 미리보기다.** 입력이 바뀌면
 * 부모가 초안을 스토어에 밀고, `SettingsContext` 가 그 초안으로 `<html>` 을
 * 다시 칠한다. 그래서 지금 보고 있는 화면이 저장 후의 화면이다.
 *
 * 토큰마다 「가족 기본값으로 되돌리기」가 있다 — 부분 지정을 되돌릴 유일한
 * 방법이고, 없으면 한 번 적은 값을 지울 방법이 없다 (빈 문자열은 색이 아니라
 * 저장에서 거부된다).
 */
import { Palette, RotateCcw } from "@/components/Icons";
import { useT } from "@/i18n";
import type { ThemeFile } from "@/lib/bindings";

import { TOKEN_GROUPS, themeTokens, type ThemeFamily } from "./schema";

/** hex 여야 `<input type="color">` 가 값을 보여 준다 (rgba 는 못 받는다). */
function hexOrNull(value: string | undefined): string | null {
  if (!value) return null;
  const raw = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : null;
}

export interface ThemeEditorProps {
  value: ThemeFile;
  onChange: (next: ThemeFile) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
  /** macOS 시스템 강조색. `null` 이면 「시스템 강조색 따르기」를 잠근다. */
  systemAccent: string | null;
}

export function ThemeEditor({
  value,
  onChange,
  onSave,
  onCancel,
  busy,
  systemAccent,
}: ThemeEditorProps) {
  const { t } = useT();
  const tokens = themeTokens(value);

  const setToken = (token: string, next: string | null) => {
    const nextTokens = { ...tokens };
    if (next === null) delete nextTokens[token];
    else nextTokens[token] = next;
    onChange({ ...value, tokens: nextTokens });
  };

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-muted-foreground">{t("theme.editor.hint")}</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="space-y-1.5">
          <span className="block text-[11px] uppercase text-muted-foreground tracking-wider">
            {t("theme.editor.name")}
          </span>
          <input
            value={value.metadata.name}
            onChange={(e) =>
              onChange({ ...value, metadata: { ...value.metadata, name: e.currentTarget.value } })
            }
            className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm text-foreground"
          />
        </label>

        <div className="space-y-1.5">
          <span className="block text-[11px] uppercase text-muted-foreground tracking-wider">
            {t("theme.editor.family")}
          </span>
          <div className="grid grid-cols-2 gap-2">
            {(["light", "dark"] as ThemeFamily[]).map((fam) => (
              <button
                key={fam}
                type="button"
                aria-pressed={value.family === fam}
                onClick={() => onChange({ ...value, family: fam })}
                className={`px-2 py-2 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                  value.family === fam
                    ? "bg-primary/10 border-primary text-primary"
                    : "bg-background border-border text-muted-foreground hover:border-primary/45"
                }`}
              >
                {fam === "light" ? t("theme.editor.familyLight") : t("theme.editor.familyDark")}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground/80">{t("theme.editor.familyHint")}</p>
        </div>
      </div>

      <label className="flex items-start gap-3 p-3 rounded-xl border border-border cursor-pointer">
        <input
          type="checkbox"
          checked={!!value.follows_system_accent}
          disabled={!systemAccent}
          onChange={(e) => onChange({ ...value, follows_system_accent: e.currentTarget.checked })}
          className="mt-0.5"
        />
        <span className="min-w-0">
          <span className="block text-xs font-semibold text-foreground">
            {t("theme.editor.systemAccent")}
          </span>
          <span className="block text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
            {systemAccent
              ? t("theme.editor.systemAccentHint")
              : t("theme.editor.systemAccentOff")}
          </span>
        </span>
      </label>

      {TOKEN_GROUPS.map((group) => (
        <div key={group.id} className="space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] uppercase text-muted-foreground tracking-wider">
            <Palette size={12} />
            {t(group.titleKey)}
          </div>
          <ul className="space-y-1.5">
            {group.tokens.map((token) => {
              const current = tokens[token];
              const hex = hexOrNull(current);
              return (
                <li key={token} className="flex items-center gap-2">
                  <code className="text-[11px] font-mono text-muted-foreground w-40 flex-none truncate">
                    {token}
                  </code>
                  <input
                    type="color"
                    aria-label={t("theme.editor.tokenPick", { token })}
                    value={hex ?? "#888888"}
                    onChange={(e) => setToken(token, e.currentTarget.value)}
                    className="h-7 w-9 flex-none rounded border border-border bg-background cursor-pointer"
                  />
                  <input
                    aria-label={t("theme.editor.tokenValue", { token })}
                    value={current ?? ""}
                    placeholder={t("theme.editor.inherited")}
                    onChange={(e) => {
                      const next = e.currentTarget.value;
                      setToken(token, next.trim() === "" ? null : next);
                    }}
                    className="flex-1 min-w-0 px-2 py-1 rounded-lg border border-border bg-background text-xs font-mono text-foreground"
                  />
                  <button
                    type="button"
                    className="iconbtn"
                    title={t("theme.action.revert")}
                    aria-label={t("theme.action.revert")}
                    disabled={current == null}
                    onClick={() => setToken(token, null)}
                  >
                    <RotateCcw size={13} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <div className="flex justify-end gap-2">
        <button type="button" className="btn ghost sm" onClick={onCancel}>
          {t("common.cancel")}
        </button>
        <button
          type="button"
          className="btn sm"
          disabled={busy || !value.metadata.name.trim()}
          onClick={onSave}
        >
          {t("theme.editor.save")}
        </button>
      </div>
    </div>
  );
}
