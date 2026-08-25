// 업데이트 탭 — 버전 확인·설치와 과거 패치노트.
//
// SettingsPanel.tsx 에서 갈라 나온 조각이다 — 순수 이동이며 동작 변경은 없다.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { commands } from "@/lib/bindings";
import { RefreshCw, Download } from "@/components/Icons";
import { useT } from "@/i18n";
import { useUpdater, releaseHighlights } from "@/lib/updater";
import { Markdown } from "@/components/Markdown";
import { Section } from "./ui";

// Repo behind the updater endpoint (tauri.conf.json) — used to fetch live patch
// notes (the latest release body == the installed version when up to date).
// All recent releases (newest first), so the patch-notes section can show past
// versions too — not just the latest.
export const RELEASES_API = "https://api.github.com/repos/bunhine0452/Ocul-PM/releases?per_page=20";

export interface ReleaseNote {
  tag: string;
  date: string;
  highlights: string;
}

export function UpdateTab() {
  const { t } = useT();
  const { status: updater, check: checkUpdate, install: installUpdate } = useUpdater();
  const [version, setVersion] = useState<string | null>(null);
  const [releases, setReleases] = useState<ReleaseNote[] | null>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [notesLoading, setNotesLoading] = useState(true);

  const toggleRelease = (tag: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });

  useEffect(() => {
    commands.appInfo().then((res) => {
      if (res.status === "ok") setVersion(res.data.version);
    });
    // Auto-check on open so the update state isn't hidden behind a manual click.
    void checkUpdate();
    // Live patch notes from GitHub releases (public repo, CORS-enabled; offline /
    // rate-limited just falls back to the empty-state message). Newest first.
    fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: unknown) => {
        const list: ReleaseNote[] = (Array.isArray(data) ? data : [])
          .filter((r) => r && !r.draft)
          .map((r) => ({
            tag: String(r.tag_name || r.name || ""),
            date: typeof r.published_at === "string" ? r.published_at.slice(0, 10) : "",
            highlights: r.body ? releaseHighlights(r.body) : "",
          }))
          .filter((r) => r.tag);
        setReleases(list);
        // Expand the newest release by default.
        setOpen(new Set(list.slice(0, 1).map((r) => r.tag)));
      })
      .catch(() => setReleases(null))
      .finally(() => setNotesLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Section
        title={t("settings.update.title")}
        description={t("settings.update.desc")}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            {t("settings.update.current")}{" "}
            <span className="font-mono text-foreground">v{version ?? "—"}</span>
          </div>
          {updater.kind === "available" ? (
            <Button
              onClick={() => void installUpdate()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Download className="w-3.5 h-3.5 mr-2" />
              {t("settings.update.installRestart", { version: updater.version ?? "" })}
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => void checkUpdate()}
              disabled={updater.kind === "checking" || updater.kind === "installing"}
            >
              <RefreshCw
                className={`w-3.5 h-3.5 mr-2 ${updater.kind === "checking" ? "animate-spin" : ""}`}
              />
              {t("settings.update.check")}
            </Button>
          )}
        </div>
        {updater.kind === "checking" && (
          <p className="text-[11px] text-muted-foreground">{t("settings.update.checking")}</p>
        )}
        {updater.kind === "uptodate" && (
          <p className="text-[11px] text-primary">{t("settings.update.upToDate")}</p>
        )}
        {updater.kind === "available" && (
          <p className="text-[11px] text-muted-foreground">
            {t("settings.update.availPrefix")} <span className="font-mono">v{updater.version}</span> {t("settings.update.availSuffix")}
          </p>
        )}
        {updater.kind === "installing" && (
          <p className="text-[11px] text-muted-foreground">
            {t("settings.update.installing")}
          </p>
        )}
        {updater.kind === "error" && (
          <p className="text-[11px] text-destructive">
            {t("settings.update.checkFailed", { message: updater.message ?? "" })}
          </p>
        )}
      </Section>

      <Section title={t("settings.changelog.title")} description={t("settings.changelog.desc")}>
        {notesLoading ? (
          <span className="text-xs text-muted-foreground">{t("settings.changelog.loading")}</span>
        ) : releases && releases.length > 0 ? (
          <div className="space-y-1.5 max-h-[440px] overflow-y-auto scrollbar-thin pr-1">
            {releases.map((rel) => {
              const isOpen = open.has(rel.tag);
              return (
                <div key={rel.tag} className="rounded-md border border-border bg-muted/20">
                  <button
                    type="button"
                    onClick={() => toggleRelease(rel.tag)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left cursor-pointer"
                    aria-expanded={isOpen}
                  >
                    <span className="font-mono text-xs font-semibold text-foreground">{rel.tag}</span>
                    {rel.date ? (
                      <span className="text-[11px] text-muted-foreground">{rel.date}</span>
                    ) : null}
                    <span className="ml-auto text-[10px] text-muted-foreground">{isOpen ? "▾" : "▸"}</span>
                  </button>
                  {isOpen ? (
                    <div className="border-t border-border px-3 py-2 text-xs leading-relaxed [&_h3]:text-xs [&_h3]:font-semibold [&_ul]:my-1 [&_li]:my-0.5">
                      {rel.highlights ? (
                        <Markdown>{rel.highlights}</Markdown>
                      ) : (
                        <span className="text-muted-foreground">{t("settings.changelog.empty")}</span>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">
            {t("settings.changelog.failed")}
          </span>
        )}
      </Section>
    </>
  );
}
