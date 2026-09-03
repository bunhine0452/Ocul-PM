import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { oculpmApi } from "@/api/oculpm";
import { useT } from "@/i18n";
import type { CodexPluginStatus } from "@/lib/bindings";
import { toast } from "@/lib/toast";

function ScopeChip({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] text-muted-foreground">
      {label}
    </span>
  );
}

const MARKETPLACE_CMD = "codex plugin marketplace add bunhine0452/Ocul-PM";
const INSTALL_CMD = "codex plugin add oculpm-codex@oculpm";

/**
 * Codex 플러그인 블록 — Claude 판(`ClaudePluginBlock`)과 같은 규약으로
 * **읽기만** 한다. 설치는 `codex plugin` CLI 가 마켓플레이스를 받아 캐시까지
 * 펼쳐야 완성되므로, 설정 파일만 우리가 흉내 내면 캐시 없는 반쪽 상태가 된다.
 *
 * 대신 한 가지를 더 말한다: **고아 항목**(플러그인 항목은 있는데 그 마켓
 * 플레이스가 설정에 없는 상태). Codex 의 첫 실행 임포트가 Claude 의 활성
 * 플러그인 목록만 옮겨 오면 이 꼴이 되고, 그때 Codex 는 조용히 그 플러그인을
 * 로드하지 못한다.
 */
export function CodexPluginBlock() {
  const { t } = useT();
  const [codex, setCodex] = useState<CodexPluginStatus | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(() => {
    void oculpmApi
      .codexPluginStatus()
      .then(setCodex)
      .catch(() => setCodex(null));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const copyInstall = async () => {
    try {
      await navigator.clipboard.writeText(`${MARKETPLACE_CMD}\n${INSTALL_CMD}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.warning(t("op.copyFailed"));
    }
  };

  const installed = !!codex?.enabled && !!codex.cached_version;
  const orphaned = !!codex?.enabled && !codex.marketplace_configured;

  const badge = !codex
    ? { label: t("op.st.checking"), cls: "border-border bg-muted/30 text-muted-foreground" }
    : !codex.codex_installed
      ? { label: t("op.st.noCodex"), cls: "border-(--warn)/40 bg-(--warn-soft) text-(--warn-text)" }
      : orphaned
        ? { label: t("op.codexPlugin.orphanBadge"), cls: "border-(--warn)/40 bg-(--warn-soft) text-(--warn-text)" }
        : installed
          ? { label: t("op.plugin.installed"), cls: "border-(--ok)/40 bg-(--ok-soft) text-(--ok-text)" }
          : { label: t("op.plugin.notInstalled"), cls: "border-border bg-muted/30 text-muted-foreground" };

  return (
    <div className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {t("op.codexPlugin.title")}
        </Label>
        <ScopeChip label={t("op.scope.machine")} />
        <span className={`rounded-full border px-2 py-0.5 text-[10px] ${badge.cls}`}>{badge.label}</span>
        <div className="ml-auto">
          <Button size="sm" variant="outline" onClick={() => void copyInstall()}>
            {copied ? t("common.copied") : t("op.codexPlugin.copy")}
          </Button>
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {t("op.codexPlugin.desc1")} <code className="text-[10px]">{MARKETPLACE_CMD}</code>{" "}
        {t("op.codexPlugin.desc2")} <code className="text-[10px]">{INSTALL_CMD}</code>{" "}
        {t("op.codexPlugin.desc3")}
      </p>
      {codex && !codex.codex_installed && (
        <p className="text-[11px] text-(--warn-text)">{t("op.codexMcp.notFound")}</p>
      )}
      {orphaned && <p className="text-[11px] text-(--warn-text)">{t("op.codexPlugin.orphan")}</p>}
      {installed && (
        <p className="text-[11px] text-muted-foreground">
          {t("op.codexPlugin.cached")} <code className="text-[10px]">{codex?.cached_version}</code>
          {codex?.marketplace ? ` · ${codex.marketplace}` : ""}
        </p>
      )}
    </div>
  );
}
