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

/**
 * Codex 의 `~/.codex/config.toml` 만 만지는 MCP 등록 카드.
 *
 * **머신 스코프다.** 그 파일은 모든 Codex 세션에 실리므로 프로젝트별 항목을
 * 두면 안 된다 — 루트를 박은 항목 하나가 다른 프로젝트의 기록까지 그리로
 * 보낸다(2026-09-04 실제 사고). 우리는 인자 없는 서버 하나만 두고, 어느
 * 프로젝트인지는 세션의 작업 폴더가 정한다.
 */
export function CodexMcpServerBlock() {
  const { t } = useT();
  const [codex, setCodex] = useState<CodexRegistrationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void oculpmApi
      .codexMcpStatus()
      .then((status) => {
        setCodex(status);
        setError(null);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const mutate = async (action: "register" | "unregister") => {
    setBusy(true);
    try {
      const status =
        action === "register" ? await oculpmApi.codexMcpRegister() : await oculpmApi.codexMcpUnregister();
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

  const pinned = codex?.pinned_root ?? null;

  const badge = error
    ? { label: t("op.st.configError"), cls: "border-(--danger)/40 bg-(--danger-soft) text-(--danger-text)" }
    : !codex
      ? { label: t("op.st.checking"), cls: "border-border bg-muted/30 text-muted-foreground" }
      : pinned
        ? { label: t("op.codexMcp.pinnedBadge"), cls: "border-(--warn)/40 bg-(--warn-soft) text-(--warn-text)" }
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
        <ScopeChip label={t("op.scope.machine")} />
        <span className={`rounded-full border px-2 py-0.5 text-[10px] ${badge.cls}`}>{badge.label}</span>
        <div className="ml-auto flex items-center gap-2">
          {/* 루트가 박힌 항목은 「해제」가 아니라 「다시 등록」이 답이다 —
              지우고 끝내면 기록 도구가 사라지고, 다시 등록하면 바로 고쳐진다. */}
          {codex?.registered && !pinned ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void mutate("unregister")}>
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              {t("op.unregister")}
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={busy || !!error || !codex?.installed || !codex?.binary_found}
              onClick={() => void mutate("register")}
            >
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              {pinned ? t("op.codexMcp.reregister") : t("op.register")}
            </Button>
          )}
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {t("op.codexMcp.desc1")} <code className="text-[10px]">{codex?.config_path ?? "~/.codex/config.toml"}</code>
        {t("op.codexMcp.desc2")}
      </p>
      {pinned && (
        <p className="text-[11px] text-(--warn-text)">{t("op.codexMcp.pinnedWarn", { path: pinned })}</p>
      )}
      {!codex?.installed && !error && <p className="text-[11px] text-(--warn-text)">{t("op.codexMcp.notFound")}</p>}
      {codex && !codex.binary_found && (
        <p className="text-[11px] text-(--warn-text)">
          {t("op.mcp.noBinary1")} <code className="text-[10px]">cargo build --bin oculpm-mcp</code> {t("op.mcp.noBinary2")}
        </p>
      )}
      {codex?.registered && !pinned && (
        <p className="text-[11px] text-muted-foreground">{t("op.codexMcp.restartNote")}</p>
      )}
      {error && <p className="text-[11px] text-(--danger-text)">{error}</p>}
    </div>
  );
}
