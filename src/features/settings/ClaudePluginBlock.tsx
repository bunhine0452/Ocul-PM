import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useT } from "@/i18n";
import type { ClaudePluginStatus } from "@/lib/bindings";
import { toast } from "@/lib/toast";

function ScopeChip({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] text-muted-foreground">
      {label}
    </span>
  );
}

/**
 * A3 — Claude Code 플러그인 (훅 + MCP + 스킬) 설치 감지.
 *
 * **머신 전역** 블록이다 — 플러그인은 `~/.claude/plugins` 에 설치되어 모든
 * 프로젝트에 한 번에 적용되므로 `projectId` 를 받지 않는다 (실제 동작은
 * 훅 커맨드의 `.oculpm` 존재 가드와 MCP 의 `--root ${CLAUDE_PROJECT_DIR}` 가
 * 프로젝트별로 갈라준다). 프로젝트별인 훅 토글·MCP 등록과 한 카드에 섞여
 * 있으면 "설치됨" 배지가 어느 범위를 말하는지 알 수 없어, 스코프 섹션이
 * 생기면서 별도 블록으로 떼어냈다.
 */
export function ClaudePluginBlock({ plugin }: { plugin: ClaudePluginStatus | null }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);

  const copyInstall = async () => {
    try {
      await navigator.clipboard.writeText("/plugin marketplace add bunhine0452/Ocul-PM");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.warning(t("op.copyFailed"));
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {t("op.plugin.title")}
        </Label>
        <ScopeChip label={t("op.scope.machine")} />
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] ${
            plugin?.installed
              ? "border-(--ok)/40 bg-(--ok-soft) text-(--ok-text)"
              : "border-border bg-muted/30 text-muted-foreground"
          }`}
        >
          {plugin == null ? t("op.st.checking") : plugin.installed ? t("op.plugin.installed") : t("op.plugin.notInstalled")}
        </span>
        <div className="ml-auto">
          <Button size="sm" variant="outline" onClick={() => void copyInstall()}>
            {copied ? t("common.copied") : t("op.plugin.copy")}
          </Button>
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {t("op.plugin.desc1")} <code className="text-[10px]">/plugin marketplace add bunhine0452/Ocul-PM</code>{" "}
        {t("op.plugin.desc2")} <code className="text-[10px]">/plugin install oculpm@oculpm</code>{" "}
        {t("op.plugin.desc3")}
      </p>
      {plugin?.installed ? (
        <p className="text-[11px] text-(--warn-text)">{t("op.plugin.warn")}</p>
      ) : null}
    </div>
  );
}
