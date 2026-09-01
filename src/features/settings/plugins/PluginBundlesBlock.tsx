/**
 * 플러그인 번들 — 들여오기·목록·제거 (Osaurus 라운드 Phase 6 #plugin-import).
 *
 * ocul-pm 은 **Claude Code 를 구동하는 앱**이라 번들을 자기 형식으로 번역할
 * 이유가 없다. 스킬은 `.claude/skills/`, 커맨드는 `.claude/commands/`,
 * 에이전트는 `.claude/agents/` — Claude Code 가 읽는 자리에 그대로 놓는다.
 *
 * 두 규약이 화면에 그대로 보인다:
 *
 * - **미리 본 뒤 설치한다.** 「미리보기」는 같은 커맨드를 `dry` 로 부른 것이라
 *   미리 본 판정과 실제 판정이 같다.
 * - **남의 파일은 건드리지 않는다.** 마커 없는 파일이 이미 있으면 conflict 로
 *   보고하고 그 파일은 그대로 둔다 — 목록에 그 수가 뜬다.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Download, Loader2, Trash2 } from "@/components/Icons";
import { pluginsApi } from "@/api/plugins";
import { toAppError } from "@/api/invoke";
import { useConfirm } from "@/hooks/useConfirm";
import { useT, type I18nKey } from "@/i18n";
import { tError } from "@/i18n/errors";
import { toast } from "@/lib/toast";
import type { BundleImportResult, InstalledBundle } from "@/lib/bindings";
import { Section } from "../tabs/ui";
import { NotHonoredNotice } from "./NotHonoredNotice";

export function PluginBundlesBlock({ projectId }: { projectId: number }) {
  const { t } = useT();
  const { confirm, confirmDialog } = useConfirm();
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<BundleImportResult | null>(null);
  const [installed, setInstalled] = useState<InstalledBundle[]>([]);

  const reload = useCallback(async () => {
    try {
      setInstalled(await pluginsApi.list(projectId));
    } catch (e) {
      toast.destructive(tError(toAppError(e)));
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.destructive(tError(toAppError(e)));
    } finally {
      setBusy(false);
    }
  };

  const previewGithub = () =>
    run(async () => {
      const trimmed = slug.trim();
      if (!trimmed) return;
      setPreview(await pluginsApi.import(projectId, "github", trimmed, true, false));
    });

  const previewFile = () =>
    run(async () => {
      const path = await pluginsApi.pickBundle();
      if (!path) return;
      setSlug(path);
      setPreview(await pluginsApi.import(projectId, "file", path, true, false));
    });

  const install = () =>
    run(async () => {
      if (!preview) return;
      const kind = slug.trim().endsWith(".zip") ? "file" : "github";
      let result = await pluginsApi.import(projectId, kind, slug.trim(), false, false);
      // 이미 설치돼 있으면 아무것도 쓰지 않고 돌아온다 — 여기서 명시적으로 묻는다.
      if (result.already_installed) {
        const ok = await confirm({
          title: t("plugins.replace.confirm", { name: result.already_installed.name }),
        });
        if (!ok) return;
        result = await pluginsApi.import(projectId, kind, slug.trim(), false, true);
      }
      setPreview(result);
      await reload();
      toast.info(
        t("plugins.installed", {
          name: result.manifest.name,
          count: String(result.report.wrote),
        }),
      );
    });

  const remove = (bundle: InstalledBundle) =>
    run(async () => {
      const ok = await confirm({ title: t("plugins.remove.confirm", { name: bundle.name }), danger: true });
      if (!ok) return;
      const report = await pluginsApi.remove(projectId, bundle.id);
      setPreview(null);
      await reload();
      toast.info(
        report.kept.length > 0
          ? t("plugins.removed.kept", {
              count: String(report.removed),
              kept: String(report.kept.length),
            })
          : t("plugins.removed", { count: String(report.removed) }),
      );
    });

  return (
    <Section title={t("plugins.title")} description={t("plugins.desc")}>
      <div className="flex gap-2">
        <Input
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="owner/repo"
          aria-label={t("plugins.source.aria")}
          className="flex-1"
        />
        <Button variant="outline" onClick={previewGithub} disabled={busy || !slug.trim()}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t("plugins.preview")}
        </Button>
        <Button variant="outline" onClick={previewFile} disabled={busy}>
          <Download className="w-3.5 h-3.5 mr-2" />
          {t("plugins.fromFile")}
        </Button>
      </div>

      {preview && <BundleDetail result={preview} onInstall={install} busy={busy} />}

      {installed.length > 0 && (
        <ul className="space-y-1.5">
          {installed.map((bundle) => (
            <li
              key={bundle.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2"
            >
              <div className="min-w-0">
                <div className="text-sm text-foreground truncate">
                  {bundle.name}
                  {bundle.version && (
                    <span className="ml-1.5 text-xs text-muted-foreground">{bundle.version}</span>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground truncate" title={bundle.source}>
                  {t("plugins.itemCount", { count: String(bundle.items.length) })} · {bundle.source}
                </div>
              </div>
              <button
                onClick={() => remove(bundle)}
                disabled={busy}
                className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-destructive transition-colors flex-shrink-0 cursor-pointer"
                title={t("plugins.remove")}
                aria-label={t("plugins.remove")}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {confirmDialog}
    </Section>
  );
}

/** 번들 상세 — 놓을 것, 충돌, 그리고 **이행하지 않는 것**. */
function BundleDetail({
  result,
  onInstall,
  busy,
}: {
  result: BundleImportResult;
  onInstall: () => void;
  busy: boolean;
}) {
  const { t } = useT();
  const { manifest, report, mcp } = result;
  return (
    <div className="rounded-lg border border-border bg-background p-3 space-y-3">
      <div>
        <p className="text-sm font-medium text-foreground">
          {manifest.name}
          {manifest.version && (
            <span className="ml-1.5 text-xs text-muted-foreground">{manifest.version}</span>
          )}
        </p>
        {manifest.description && (
          <p className="text-xs text-muted-foreground mt-0.5">{manifest.description}</p>
        )}
        {manifest.manifest_missing && (
          <p className="text-xs text-muted-foreground mt-0.5">{t("plugins.noManifest")}</p>
        )}
      </div>

      <ul className="space-y-1">
        {[...manifest.artifacts]
          .filter((a) => a.kind !== "not_honored")
          .map((a) => (
            <li key={`${a.kind}:${a.source}`} className="text-xs font-mono text-foreground">
              <span className="text-muted-foreground">{t(`plugins.kind.${a.kind}` as I18nKey)}</span>{" "}
              {a.name}
              {a.dest && <span className="text-muted-foreground"> → {a.dest}</span>}
            </li>
          ))}
      </ul>

      <p className="text-xs text-muted-foreground">
        {t("plugins.summary", {
          wrote: String(report.wrote),
          unchanged: String(report.unchanged),
          conflicts: String(report.conflicts),
        })}
      </p>

      {report.conflicts > 0 && (
        <p className="text-xs text-destructive">{t("plugins.conflictNote")}</p>
      )}
      {mcp.conflicts.length > 0 && (
        <p className="text-xs text-destructive">
          {t("plugins.mcpConflict", { keys: mcp.conflicts.join(", ") })}
        </p>
      )}
      {mcp.unreadable && <p className="text-xs text-destructive">{t("plugins.mcpUnreadable")}</p>}

      {report.skipped.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t("plugins.skipped", { count: String(report.skipped.length) })}
        </p>
      )}

      <NotHonoredNotice
        items={report.not_honored.map((a) => ({ name: a.name, reason: a.reason }))}
        titleKey="plugins.notHonored.title"
      />

      {report.dry && (
        <Button onClick={onInstall} disabled={busy} className="w-full">
          {t("plugins.install")}
        </Button>
      )}
    </div>
  );
}
