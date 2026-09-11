import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { useT } from "@/i18n";
import { vscodeExtApi, type VscodeExtensionStatus } from "@/api/vscodeExt";

function ScopeChip({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-fs-1 text-muted-foreground">
      {label}
    </span>
  );
}

/**
 * VS Code 확장 `oculpm.ocul-pm` (플랜 `vscode-extension-round` {#app-settings}).
 *
 * **머신 전역** 블록 — 확장은 `~/.vscode/extensions` 에 깔려 모든 창에 적용된다.
 * 판정은 백엔드 `vscode_extension_status`(확장 폴더만 읽음; `code` CLI 는 .app 이
 * PATH 를 안 물려받아 못 쓴다). 마켓 링크 두 개는 사용자 클릭에만 밖으로 나가고
 * (`externalLinks` 가드 → `open_url`), 이 블록 자체는 아웃바운드 0.
 */
export function VscodeExtensionBlock({ status: given }: { status?: VscodeExtensionStatus | null }) {
  const { t } = useT();
  const [fetched, setFetched] = useState<VscodeExtensionStatus | null>(null);
  useEffect(() => {
    if (given !== undefined) return;
    let cancelled = false;
    void vscodeExtApi.status().then((s) => {
      if (!cancelled) setFetched(s);
    });
    return () => {
      cancelled = true;
    };
  }, [given]);
  const status = given !== undefined ? given : fetched;

  return (
    <div className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-fs-2 uppercase tracking-wider text-muted-foreground">
          {t("op.vscode.title")}
        </Label>
        <ScopeChip label={t("op.scope.machine")} />
        <span
          className={`rounded-full border px-2 py-0.5 text-fs-1 ${
            status?.installed
              ? "border-(--ok)/40 bg-(--ok-soft) text-(--ok-text)"
              : "border-border bg-muted/30 text-muted-foreground"
          }`}
        >
          {status == null
            ? t("op.st.checking")
            : status.installed
              ? status.editor === "vscode-insiders"
                ? t("op.vscode.installedInsiders")
                : t("op.plugin.installed")
              : t("op.plugin.notInstalled")}
        </span>
      </div>
      <p className="text-fs-2 leading-relaxed text-muted-foreground">{t("op.vscode.desc")}</p>
      {status ? (
        <p className="flex flex-wrap gap-3 text-fs-2">
          <a href={status.marketplace_url} className="underline underline-offset-2">
            {t("op.vscode.marketplace")}
          </a>
          <a href={status.open_vsx_url} className="underline underline-offset-2">
            {t("op.vscode.openVsx")}
          </a>
        </p>
      ) : null}
      {status?.installed ? (
        <p className="text-fs-2 text-muted-foreground">{t("op.vscode.installedHint")}</p>
      ) : null}
    </div>
  );
}
