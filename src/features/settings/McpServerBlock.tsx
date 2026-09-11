import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2 } from "@/components/Icons";
import { useT } from "@/i18n";
import { blocked } from "@/lib/blocked";
import { tError } from "@/i18n/errors";
import { oculpmApi } from "@/api/oculpm";
import { toAppError } from "@/api/invoke";
import type { DesktopRegistrationStatus, McpRegistrationStatus } from "@/lib/bindings";
import { toast } from "@/lib/toast";

function ScopeChip({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-fs-1 text-muted-foreground">
      {label}
    </span>
  );
}

/**
 * PR-CI2 (docs/claude-integration/00-master-plan.md D3) — oculpm-mcp 서버 등록
 * 블록. 프로젝트 `.mcp.json` 에 stdio 서버(journal_write/plan_status/
 * plan_update)를 등록해 Claude Code 가 파일 규격을 흉내 내는 대신 구조화
 * 도구로 기록하게 한다. Claude Desktop 은 원클릭으로
 * `claude_desktop_config.json` 에 같은 서버를 기입한다 (스니펫 복사는 폴백).
 * 둘 다 **프로젝트별** — 프로젝트를 바꾸면 각각 다시 등록해야 한다 (Desktop
 * 은 설정 파일이 머신에 하나지만 키가 `oculpm-<폴더명>` 이라 등록 행위는
 * 프로젝트 단위다).
 *
 * `OculpmSettings` 에서 떼어낸 파일이다 (2026-09-08) — 형제인
 * `CodexMcpServerBlock` 과 같은 자리, 같은 모양.
 */
export function McpServerBlock({
  projectId,
  pluginInstalled = false,
}: {
  projectId: number;
  /** 머신 전역 플러그인이 같은 MCP 서버를 이미 제공한다 (Desktop 은 제외). */
  pluginInstalled?: boolean;
}) {
  const { t } = useT();
  const [mcp, setMcp] = useState<McpRegistrationStatus | null>(null);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [desk, setDesk] = useState<DesktopRegistrationStatus | null>(null);
  const [deskError, setDeskError] = useState<string | null>(null);
  const [deskChecked, setDeskChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(() => {
    void oculpmApi
      .mcpStatus(projectId)
      .then((data) => {
        setMcp(data);
        setMcpError(null);
      })
      .catch((cause: unknown) => setMcpError(tError(toAppError(cause))));
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Claude Desktop 상태 조회는 **마운트에 붙이지 않는다** (2026-09-08). 이
  // 조회만이 우리 코드에서 유일하게 남의 앱 데이터 디렉터리를 건드린다 —
  // `~/Library/Application Support/Claude` 는 macOS 가 "다른 앱의 데이터"
  // (kTCCServiceSystemPolicyAppData) 로 보호하고, `desktop_status_at` 은 파일을
  // 읽기 전에 부모 폴더를 `Path::exists` 로 확인하므로 **stat 하나만으로도**
  // 권한 프롬프트가 뜬다. 연동 탭을 열었을 뿐인 사용자에게 앱이 스스로
  // 프롬프트를 띄우면 맥락이 없어 "왜 이 앱이 남의 데이터를?" 로 읽힌다.
  // 버튼 뒤로 미뤄 사용자가 의도한 순간에만 묻는다. 스니펫 복사는 `mcpStatus`
  // 산출물이라 이 조회 없이도 되므로 폴백 경로는 그대로 열려 있다.
  const checkDesktop = useCallback(() => {
    setDeskChecked(true);
    void oculpmApi
      .mcpDesktopStatus(projectId)
      .then((data) => {
        setDesk(data);
        setDeskError(null);
      })
      .catch((cause: unknown) => setDeskError(tError(toAppError(cause))));
  }, [projectId]);

  // 프로젝트가 바뀌면 앞 프로젝트의 조회 결과는 무효다 (등록 키가 폴더명
  // 기반이라 등록 여부 판정이 프로젝트마다 다르다). 다시 물어보게 되돌린다.
  useEffect(() => {
    setDeskChecked(false);
    setDesk(null);
    setDeskError(null);
  }, [projectId]);

  const mutate = async (action: "register" | "unregister") => {
    setBusy(true);
    try {
      const data =
        action === "register"
          ? await oculpmApi.mcpRegister(projectId)
          : await oculpmApi.mcpUnregister(projectId);
      setMcp(data);
      setMcpError(null);
      // Claude Code 는 .mcp.json 을 세션 시작 시에만 읽는다 — 재시작 없이는
      // 등록/해제가 반영되지 않아 "해제했는데 도구가 계속 보이는" 혼란이 생긴다.
      toast.info(
        action === "register" ? t("op.mcp.registered") : t("op.mcp.unregistered"),
      );
    } catch (cause) {
      const msg = tError(toAppError(cause));
      setMcpError(msg);
      toast.destructive(t("op.mcp.failed", { error: msg }));
    } finally {
      setBusy(false);
    }
  };

  const mutateDesktop = async (action: "register" | "unregister") => {
    setBusy(true);
    try {
      const data =
        action === "register"
          ? await oculpmApi.mcpDesktopRegister(projectId)
          : await oculpmApi.mcpDesktopUnregister(projectId);
      setDesk(data);
      setDeskError(null);
      toast.info(
        action === "register" ? t("op.desk.registered") : t("op.desk.unregistered"),
      );
    } catch (cause) {
      const msg = tError(toAppError(cause));
      setDeskError(msg);
      toast.destructive(t("op.desk.failed", { error: msg }));
    } finally {
      setBusy(false);
    }
  };

  const copySnippet = async () => {
    if (!mcp) return;
    try {
      await navigator.clipboard.writeText(mcp.desktop_snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.warning(t("op.copyFailedSnippet"));
    }
  };

  const badge = mcpError
    ? { label: t("op.st.configError"), cls: "border-(--danger)/40 bg-(--danger-soft) text-(--danger-text)" }
    : !mcp
      ? { label: t("op.st.checking"), cls: "border-border bg-muted/30 text-muted-foreground" }
      : mcp.registered
        ? { label: t("op.st.registered"), cls: "border-(--ok)/40 bg-(--ok-soft) text-(--ok-text)" }
        : !mcp.binary_found
          ? { label: t("op.st.noBinary"), cls: "border-(--warn)/40 bg-(--warn-soft) text-(--warn-text)" }
          : { label: t("op.st.unregistered"), cls: "border-border bg-muted/30 text-muted-foreground" };

  const deskBadge = deskError
    ? { label: t("op.st.configError"), cls: "border-(--danger)/40 bg-(--danger-soft) text-(--danger-text)" }
    : !deskChecked
    ? { label: t("op.st.notChecked"), cls: "border-border bg-muted/30 text-muted-foreground" }
    : !desk
      ? { label: t("op.st.checking"), cls: "border-border bg-muted/30 text-muted-foreground" }
      : desk.registered
        ? { label: t("op.st.registered"), cls: "border-(--ok)/40 bg-(--ok-soft) text-(--ok-text)" }
        : !desk.installed
          ? { label: t("op.st.noDesktop"), cls: "border-(--warn)/40 bg-(--warn-soft) text-(--warn-text)" }
          : { label: t("op.st.unregistered"), cls: "border-border bg-muted/30 text-muted-foreground" };

  return (
    <div className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-fs-2 uppercase tracking-wider text-muted-foreground">
          {t("op.mcp.title")}
        </Label>
        <ScopeChip label={t("op.scope.project")} />
        <span className={`rounded-full border px-2 py-0.5 text-fs-1 ${badge.cls}`}>
          {badge.label}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {mcp?.registered ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void mutate("unregister")}>
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              {t("op.unregister")}
            </Button>
          ) : (
            <Button
              size="sm"
              {...blocked(
                mcpError ??
                  (mcp == null ? t("op.blockedStatusUnknown") : !mcp.binary_found ? t("op.blockedNoBinary") : null),
              )}
              disabled={busy}
              onClick={() => void mutate("register")}
            >
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              {t("op.register")}
            </Button>
          )}
        </div>
      </div>
      <p className="text-fs-2 leading-relaxed text-muted-foreground">
        {t("op.mcp.desc1")} <code className="text-fs-1">.mcp.json</code>{t("op.mcp.desc2")}
      </p>
      {mcp && !mcp.binary_found && (
        <p className="text-fs-2 text-(--warn-text)">
          {t("op.mcp.noBinary1")}{" "}
              <code className="text-fs-1">cargo build --bin oculpm-mcp</code> {t("op.mcp.noBinary2")}
        </p>
      )}
      {pluginInstalled && (
        <p
          className={`text-fs-2 leading-relaxed ${
            mcp?.registered ? "text-(--warn-text)" : "text-muted-foreground"
          }`}
        >
          {mcp?.registered ? t("op.mcp.pluginConflict") : t("op.mcp.pluginCovers")}
        </p>
      )}
      {mcp?.registered && (
        <p className="text-fs-2 text-muted-foreground">
          {t("op.mcp.commitWarn1")} <code className="text-fs-1">.mcp.json</code>{" "}
              {t("op.mcp.commitWarn2")}
        </p>
      )}
      {mcpError && <p className="text-fs-2 text-(--danger-text)">{mcpError}</p>}

      <div className="flex flex-wrap items-center gap-2 border-t border-border/50 pt-2">
        <Label className="text-fs-2 uppercase tracking-wider text-muted-foreground">
          Claude Desktop
        </Label>
        <ScopeChip label={t("op.scope.projectKey")} />
        <span className={`rounded-full border px-2 py-0.5 text-fs-1 ${deskBadge.cls}`}>
          {deskBadge.label}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" {...blocked(mcp ? null : t("op.blockedStatusUnknown"))} disabled={busy} onClick={() => void copySnippet()}>
            {copied ? t("common.copied") : t("op.desk.copy")}
          </Button>
          {!deskChecked ? (
            <Button size="sm" variant="outline" onClick={checkDesktop}>
              {t("op.desk.check")}
            </Button>
          ) : desk?.registered ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void mutateDesktop("unregister")}>
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              {t("op.desk.unregister")}
            </Button>
          ) : (
            <Button
              size="sm"
              {...blocked(
                deskError ??
                  (!desk?.installed
                    ? t("op.desk.blockedNotInstalled")
                    : !mcp?.binary_found
                      ? t("op.blockedNoBinary")
                      : null),
              )}
              disabled={busy}
              onClick={() => void mutateDesktop("register")}
            >
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              {t("op.desk.register")}
            </Button>
          )}
        </div>
      </div>
      <p className="text-fs-2 leading-relaxed text-muted-foreground">
        {t("op.desk.desc1")} <code className="text-fs-1">claude_desktop_config.json</code>{" "}
            {t("op.desk.desc2")} (<code className="text-fs-1">{desk?.server_key ?? "oculpm-…"}</code>){" "}
            {t("op.desk.desc3")}
      </p>
      {pluginInstalled && (
        // 플러그인은 Claude Code 만 구성한다 — Desktop 은 설정 파일도 등록
        // 경로도 다르다. 위 두 블록의 "플러그인이 이미 한다" 를 여기까지
        // 확대 적용하면 Desktop 을 영영 등록하지 않게 된다.
        <p className="text-fs-2 text-muted-foreground">{t("op.desk.pluginNote")}</p>
      )}
      {!deskChecked && (
        <p className="text-fs-2 leading-relaxed text-muted-foreground">
          {t("op.desk.checkNote")}
        </p>
      )}
      {desk && !desk.installed && (
        <p className="text-fs-2 text-(--warn-text)">
          {t("op.desk.notFound")}
        </p>
      )}
      {deskError && <p className="text-fs-2 text-(--danger-text)">{deskError}</p>}
    </div>
  );
}
