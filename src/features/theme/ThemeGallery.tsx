/**
 * 테마 갤러리 (Phase 4) — 설정 → 모양 안에 산다.
 *
 * 내장 5종은 읽기 전용이고 「복제해서 편집」만 준다. 사용자 테마는 편집·
 * 내보내기·삭제가 열린다. 가져오기는 이름이 겹치면 **조용히 덮어쓰지 않고**
 * 되묻는다 (설계 §3).
 *
 * 카드를 누르면 그 테마가 곧바로 적용된다 — 갤러리에서 "고르기" 와 "미리보기"
 * 를 나누지 않는다. 되돌리는 비용이 클릭 한 번이라 나눌 이유가 없다.
 */
import { useState } from "react";
import { Copy, Download, MoreHorizontal, Palette, Pencil, Plus, Trash2, Upload } from "@/components/Icons";
import { AppDialog } from "@/components/ui/AppDialog";
import { themesApi } from "@/api/themes";
import { toAppError } from "@/api/invoke";
import { useSettings } from "@/contexts/SettingsContext";
import { useConfirm } from "@/hooks/useConfirm";
import { useT } from "@/i18n";
import { tError } from "@/i18n/errors";
import { toast } from "@/lib/toast";
import type { ThemeFile } from "@/lib/bindings";

import { BUILTIN_THEMES } from "./builtins";
import { CUSTOM_PREFIX } from "./apply";
import { blankTheme, duplicateTheme, themeTokens } from "./schema";
import { refreshThemes, setThemeDraft, useThemeState } from "./store";
import { ThemeEditor } from "./ThemeEditor";

/** 카드의 미니 미리보기 — 테마가 실제로 지정한 값만 쓰고, 없으면 상속을 흉내낸다. */
function swatchColors(theme: ThemeFile): { bg: string; fg: string; accent: string } {
  const tokens = themeTokens(theme);
  const dark = theme.family === "dark";
  return {
    bg: tokens["--bg-window"] ?? (dark ? "#191d1b" : "#fdfcf9"),
    fg: tokens["--text"] ?? (dark ? "#f1f4f1" : "#211e18"),
    accent: tokens["--accent"] ?? (dark ? "#34d095" : "#0e8a60"),
  };
}

interface Conflict {
  name: string;
  sourcePath: string;
}

export function ThemeGallery() {
  const { t } = useT();
  const { settings, set } = useSettings();
  const { customThemes, systemAccent, loaded } = useThemeState();
  const { confirm, confirmDialog } = useConfirm();

  const [draft, setDraft] = useState<ThemeFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);

  /** 초안을 바꾸면 앱 전체가 즉시 그 색으로 바뀐다 (라이브 프리뷰). */
  const editDraft = (next: ThemeFile | null) => {
    setDraft(next);
    setThemeDraft(next);
  };

  const fail = (e: unknown) => toast.destructive(tError(toAppError(e)));

  const apply = (theme: ThemeFile) => {
    const id = theme.metadata.id ?? "";
    const value = theme.is_built_in ? id : `${CUSTOM_PREFIX}${id}`;
    void set("theme", value as never);
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const saved = await themesApi.save(draft);
      await refreshThemes();
      editDraft(null);
      apply(saved);
      toast.info(t("theme.editor.saved"));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (theme: ThemeFile) => {
    const ok = await confirm({
      title: t("theme.delete.title"),
      message: t("theme.delete.body", { name: theme.metadata.name }),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await themesApi.remove(theme.metadata.id ?? "");
      await refreshThemes();
      // 지운 테마를 쓰고 있었다면 전역 기본으로 되돌린다 — 폴백은 적용
      // 경로에도 있지만, 설정에 죽은 id 를 남겨 두지 않는다.
      if (settings.theme === `${CUSTOM_PREFIX}${theme.metadata.id ?? ""}`) {
        void set("theme", "system");
      }
      toast.info(t("theme.deleted"));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const exportTheme = async (theme: ThemeFile) => {
    try {
      const path = await themesApi.export(theme);
      if (path) toast.info(t("theme.exported", { path }));
    } catch (e) {
      fail(e);
    }
  };

  const runImport = async (path: string | null, mode: "overwrite" | "copy" | null) => {
    setBusy(true);
    try {
      const outcome = await themesApi.import(path, mode);
      if (outcome.status === "conflict" && outcome.source_path) {
        setConflict({ name: outcome.conflict_name ?? "", sourcePath: outcome.source_path });
        return;
      }
      if (outcome.status === "imported" && outcome.theme) {
        await refreshThemes();
        setConflict(null);
        toast.info(t("theme.imported", { name: outcome.theme.metadata.name }));
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const cards: ThemeFile[] = [...BUILTIN_THEMES, ...customThemes];
  const activeValue = settings.theme;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase text-muted-foreground tracking-wider">
          {t("theme.gallery.title")}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn ghost sm"
            disabled={busy}
            onClick={() => editDraft(blankTheme(t("theme.new.name"), "dark"))}
          >
            <Plus size={12} /> {t("theme.action.new")}
          </button>
          <button
            type="button"
            className="btn ghost sm"
            disabled={busy}
            onClick={() => void runImport(null, null)}
          >
            <Upload size={12} /> {t("theme.action.import")}
          </button>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">{t("theme.gallery.desc")}</p>

      <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3 list-none p-0 m-0">
        {cards.map((theme) => {
          const id = theme.metadata.id ?? "";
          const value = theme.is_built_in ? id : `${CUSTOM_PREFIX}${id}`;
          const isActive = activeValue === value;
          const colors = swatchColors(theme);
          return (
            <li key={value} className="min-w-0">
              <div
                className={`flex flex-col items-stretch gap-2 p-2.5 rounded-xl border transition-all ${
                  isActive
                    ? "border-primary ring-2 ring-primary/30 bg-primary/5"
                    : "border-border bg-background"
                }`}
              >
                <button
                  type="button"
                  aria-pressed={isActive}
                  aria-label={t("theme.action.apply", { name: theme.metadata.name })}
                  onClick={() => apply(theme)}
                  className="flex items-center gap-1.5 h-9 px-2 rounded-md border cursor-pointer"
                  style={{ background: colors.bg, borderColor: "rgba(127,127,127,0.25)" }}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-none"
                    style={{ background: colors.accent }}
                  />
                  <span
                    className="flex-1 h-1.5 rounded-full"
                    style={{ background: colors.fg, opacity: 0.4 }}
                  />
                </button>
                <div className="flex items-center gap-1 min-w-0">
                  <span
                    className={`text-xs font-semibold truncate ${
                      isActive ? "text-primary" : "text-muted-foreground"
                    }`}
                  >
                    {theme.metadata.name}
                  </span>
                  {theme.is_built_in && <span className="chip">{t("theme.builtinChip")}</span>}
                  <button
                    type="button"
                    className="iconbtn right"
                    aria-label={t("theme.action.more", { name: theme.metadata.name })}
                    onClick={() => setMenuFor(menuFor === value ? null : value)}
                  >
                    <MoreHorizontal size={13} />
                  </button>
                </div>
                {menuFor === value && (
                  <div className="flex flex-wrap gap-1.5">
                    {!theme.is_built_in && (
                      <button
                        type="button"
                        className="btn ghost sm"
                        onClick={() => editDraft({ ...theme, tokens: { ...themeTokens(theme) } })}
                      >
                        <Pencil size={12} /> {t("theme.action.edit")}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() =>
                        editDraft(
                          duplicateTheme(theme, t("theme.copy.name", { name: theme.metadata.name })),
                        )
                      }
                    >
                      <Copy size={12} /> {t("theme.action.duplicate")}
                    </button>
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() => void exportTheme(theme)}
                    >
                      <Download size={12} /> {t("theme.action.export")}
                    </button>
                    {!theme.is_built_in && (
                      <button
                        type="button"
                        className="btn ghost sm danger"
                        disabled={busy}
                        onClick={() => void remove(theme)}
                      >
                        <Trash2 size={12} /> {t("theme.action.delete")}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {loaded && customThemes.length === 0 && (
        <p className="text-[11px] text-muted-foreground/80 flex items-center gap-1.5">
          <Palette size={12} /> {t("theme.gallery.empty")}
        </p>
      )}

      {draft && (
        <div className="rounded-xl border border-border p-3">
          <div className="text-sm font-semibold text-foreground mb-2">
            {t("theme.editor.title")}
          </div>
          <ThemeEditor
            value={draft}
            onChange={editDraft}
            onSave={() => void save()}
            onCancel={() => editDraft(null)}
            busy={busy}
            systemAccent={systemAccent}
          />
        </div>
      )}

      {/* 이름 충돌 — 조용한 덮어쓰기를 만들지 않는다. 세 갈래라 `useConfirm`
          (예/아니오)이 아니라 전용 대화상자다. */}
      <AppDialog
        open={conflict != null}
        onClose={() => setConflict(null)}
        label={t("theme.conflict.title")}
        width={420}
      >
        {conflict && (
          <>
            <div className="sk-modal-head">{t("theme.conflict.title")}</div>
            <div className="sk-modal-warn">
              {t("theme.conflict.body", { name: conflict.name })}
            </div>
            <div className="sk-modal-foot">
              <button type="button" className="btn ghost sm" onClick={() => setConflict(null)}>
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="btn ghost sm"
                disabled={busy}
                onClick={() => void runImport(conflict.sourcePath, "copy")}
              >
                {t("theme.conflict.copy")}
              </button>
              <button
                type="button"
                className="btn sm"
                disabled={busy}
                onClick={() => void runImport(conflict.sourcePath, "overwrite")}
              >
                {t("theme.conflict.overwrite")}
              </button>
            </div>
          </>
        )}
      </AppDialog>

      {confirmDialog}
    </div>
  );
}
