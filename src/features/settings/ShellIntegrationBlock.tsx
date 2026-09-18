// 셸 통합(OSC 133/7 rc 한 줄) 켜기/끄기 블록 — `OculpmSettings` 에서 떼어 냈다
// (파일 크기 래칫). `ScopeChip` 은 이웃 블록 파일들과 같은 지역 사본이다.

import { useEffect, useState } from "react";
import { toAppError } from "@/api/invoke";
import { shellIntegrationApi } from "@/api/shellIntegration";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2 } from "@/components/Icons";
import { useT } from "@/i18n";
import { tError } from "@/i18n/errors";
import { blocked } from "@/lib/blocked";
import type { ShellIntegrationStatus } from "@/lib/bindings";
import { toast } from "@/lib/toast";

function ScopeChip({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-fs-1 text-muted-foreground">
      {label}
    </span>
  );
}

/**
 * 터미널 셸 통합 (OSC 133/7) — 2026-07-30.
 *
 * 내장 터미널이 명령의 시작·끝·종료코드·작업 디렉터리를 알게 한다. 켜려면
 * 사용자 rc(`~/.zshrc` / `~/.bashrc`)에 **비활성 한 줄**을 심어야 하므로
 * 반드시 사용자가 직접 눌러야 한다 — 남의 dotfile 을 묻지 않고 고치지 않는다.
 *
 * 프로젝트가 아니라 머신 단위 설정이라 `projectId` 를 받지 않는다.
 */
export function ShellIntegrationBlock() {
  const { t } = useT();
  const [status, setStatus] = useState<ShellIntegrationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    shellIntegrationApi
      .status()
      .then((st) => {
        if (cancelled) return;
        setStatus(st);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(tError(toAppError(e)));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const mutate = async (action: "install" | "uninstall") => {
    setBusy(true);
    try {
      const st =
        action === "install"
          ? await shellIntegrationApi.install()
          : await shellIntegrationApi.uninstall();
      setStatus(st);
      setError(null);
      toast.info(action === "install" ? t("op.shell.on") : t("op.shell.off"));
    } catch (e) {
      const msg = tError(toAppError(e));
      setError(msg);
      toast.destructive(t("op.shell.failed", { error: msg }));
    } finally {
      setBusy(false);
    }
  };

  const unsupported = status?.shell === "unsupported";
  const badge = error
    ? { label: t("op.st.error"), cls: "border-(--danger)/40 bg-(--danger-soft) text-(--danger-text)" }
    : !status
      ? { label: t("op.st.checking"), cls: "border-border bg-muted/30 text-muted-foreground" }
      : unsupported
        ? { label: t("op.st.unsupportedShell"), cls: "border-border bg-muted/30 text-muted-foreground" }
        : status.block_broken
          ? { label: t("op.st.rcBroken"), cls: "border-(--warn)/40 bg-(--warn-soft) text-(--warn-text)" }
          : status.installed
            ? { label: t("op.st.on"), cls: "border-(--ok)/40 bg-(--ok-soft) text-(--ok-text)" }
            : { label: t("op.st.off"), cls: "border-border bg-muted/30 text-muted-foreground" };

  return (
    <div className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-fs-3 uppercase tracking-wider text-muted-foreground">
          {t("op.shell.title")}
        </Label>
        <ScopeChip label={t("op.scope.machine")} />
        <span className={`rounded-full border px-2 py-0.5 text-fs-1 ${badge.cls}`}>
          {badge.label}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {status && !unsupported ? (
            status.installed ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void mutate("uninstall")}>
                {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                {t("op.turnOff")}
              </Button>
            ) : (
              <Button size="sm" {...blocked(status.block_broken ? t("op.st.rcBroken") : null)} disabled={busy} onClick={() => void mutate("install")}>
                {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                {t("op.turnOn")}
              </Button>
            )
          ) : null}
        </div>
      </div>
      <p className="text-fs-3 leading-relaxed text-muted-foreground">
        {t("op.shell.desc1")}
        {status?.rc_path ? (
          <>
            {" "}
            <code className="text-fs-1">{status.rc_path}</code> {t("op.shell.desc2")}
          </>
        ) : null}
      </p>
      {unsupported && (
        <p className="text-fs-3 text-muted-foreground">
          {t("op.shell.unsupported")}
        </p>
      )}
      {status?.block_broken && (
        <p className="text-fs-3 text-(--warn-text)">
          <code className="text-fs-1">oculpm:begin</code> /{" "}
          <code className="text-fs-1">oculpm:end</code> {t("op.shell.rcBrokenDesc")}
        </p>
      )}
      {error && <p className="text-fs-3 text-(--danger-text)">{error}</p>}
    </div>
  );
}
