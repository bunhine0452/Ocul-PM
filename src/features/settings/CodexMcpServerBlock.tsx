import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2 } from "@/components/Icons";
import { oculpmApi } from "@/api/oculpm";
import { useT } from "@/i18n";
import type { CodexRegistrationStatus } from "@/lib/bindings";
import { toast } from "@/lib/toast";

function ScopeChip({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] text-muted-foreground">
      {label}
    </span>
  );
}

/** Codex config.toml만 관리하는 프로젝트별 MCP 등록 카드. */
export function CodexMcpServerBlock({ projectId }: { projectId: number }) {
  const { t } = useT();
  const [codex, setCodex] = useState<CodexRegistrationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void oculpmApi
      .codexMcpStatus(projectId)
      .then((status) => {
        setCodex(status);
        setError(null);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const mutate = async (action: "register" | "unregister") => {
    setBusy(true);
    try {
      const status =
        action === "register"
          ? await oculpmApi.codexMcpRegister(projectId)
          : await oculpmApi.codexMcpUnregister(projectId);
      setCodex(status);
      setError(null);
      toast.info(action === "register" ? t("op.codexMcp.registered") : t("op.codexMcp.unregistered"));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      toast.destructive(t("op.codexMcp.failed", { error: message }));
    } finally {
      setBusy(false);
    }
  };

  const badge = error
    ? { label: t("op.st.configError"), cls: "border-(--danger)/40 bg-(--danger-soft) text-(--danger-text)" }
    : !codex
      ? { label: t("op.st.checking"), cls: "border-border bg-muted/30 text-muted-foreground" }
      : codex.registered
        ? { label: t("op.st.registered"), cls: "border-(--ok)/40 bg-(--ok-soft) text-(--ok-text)" }
        : !codex.installed
          ? { label: t("op.st.noCodex"), cls: "border-(--warn)/40 bg-(--warn-soft) text-(--warn-text)" }
          : !codex.binary_found
            ? { label: t("op.st.noBinary"), cls: "border-(--warn)/40 bg-(--warn-soft) text-(--warn-text)" }
            : { label: t("op.st.unregistered"), cls: "border-border bg-muted/30 text-muted-foreground" };

  return (
    <div className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {t("op.codexMcp.title")}
        </Label>
        <ScopeChip label={t("op.scope.projectKey")} />
        <span className={`rounded-full border px-2 py-0.5 text-[10px] ${badge.cls}`}>{badge.label}</span>
        <div className="ml-auto flex items-center gap-2">
          {codex?.registered ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void mutate("unregister")}>
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              {t("op.unregister")}
            </Button>
          ) : (
            <Button size="sm" disabled={busy || !!error || !codex?.installed || !codex?.binary_found} onClick={() => void mutate("register")}>
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              {t("op.register")}
            </Button>
          )}
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {t("op.codexMcp.desc1")} <code className="text-[10px]">{codex?.config_path ?? "~/.codex/config.toml"}</code>
        {t("op.codexMcp.desc2")}
      </p>
      {!codex?.installed && !error && <p className="text-[11px] text-(--warn-text)">{t("op.codexMcp.notFound")}</p>}
      {codex && !codex.binary_found && (
        <p className="text-[11px] text-(--warn-text)">
          {t("op.mcp.noBinary1")} <code className="text-[10px]">cargo build --bin oculpm-mcp</code> {t("op.mcp.noBinary2")}
        </p>
      )}
      {codex?.registered && (
        <>
          <p className="text-[11px] text-muted-foreground">
            {t("op.codexMcp.serverKey")} <code className="text-[10px]">{codex.server_key}</code>
          </p>
          <p className="text-[11px] text-muted-foreground">{t("op.codexMcp.restartNote")}</p>
        </>
      )}
      {error && <p className="text-[11px] text-(--danger-text)">{error}</p>}
    </div>
  );
}
