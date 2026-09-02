import { useConfirm } from "@/hooks/useConfirm";
// 데이터 탭 — 내보내기·Notion 연동·초기화.
//
// SettingsPanel.tsx 에서 갈라 나온 조각이다 — 순수 이동이며 동작 변경은 없다.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { commands, type NotionStatus } from "@/lib/bindings";
import { Trash2, Copy, RefreshCw, Loader2 } from "@/components/Icons";
import { useSettings } from "@/contexts/SettingsContext";
import { toast } from "@/lib/toast";
import { useT, type I18nKey } from "@/i18n";
import { Section } from "./ui";
import { DeclarativeConfigSection } from "../config/DeclarativeConfigSection";
import { ConversationImportSection } from "../import/ConversationImportSection";

/**
 * PR-CI7 (docs/claude-integration/00-master-plan.md D6) — Notion 내보내기 설정.
 * internal integration token 은 검증(users/me) 성공 후에만 기존 secret_set 으로
 * OS 키체인에 저장한다 (DB/localStorage 금지 규율 유지). 부모 페이지는 URL 을
 * 붙여넣으면 백엔드가 id 로 정규화해 SQLite settings 에 둔다. 내보내기 버튼
 * 자체는 회고 화면에 있고, 토큰이 없으면 그 버튼이 아예 노출되지 않는다.
 *
 * (export 는 테스트 전용 — notion_export_v2.test.tsx 가 SettingsContext 부트
 * 스트랩 없이 이 섹션만 단독 렌더한다.)
 */
export function NotionSection({ onError }: { onError: (msg: string | null) => void }) {
  const { t } = useT();
  const { confirm, confirmDialog } = useConfirm();
  const [status, setStatus] = useState<NotionStatus | null>(null);
  const [token, setToken] = useState("");
  const [parent, setParent] = useState("");
  const [botName, setBotName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    void commands.notionStatus().then((res) => {
      if (res.status === "ok") {
        setStatus(res.data);
        setParent(res.data.parent_page_id ?? "");
      }
    });
  };
  useEffect(refresh, []);

  const saveToken = async () => {
    // `t` 는 번역 함수 이름이라 지역 변수로 쓰지 않는다 (섀도잉).
    const trimmed = token.trim();
    if (busy || !trimmed) return;
    setBusy(true);
    try {
      const v = await commands.notionVerifyToken(trimmed);
      if (v.status === "error") {
        onError(t("settings.notion.tokenFailed", { error: v.error }));
        return;
      }
      const s = await commands.secretSet("notion_api_key", trimmed);
      if (s.status === "error") {
        onError(s.error);
        return;
      }
      setBotName(v.data);
      setToken("");
      onError(null);
      toast.info(t("settings.notion.linked", { name: v.data }));
      refresh();
    } finally {
      setBusy(false);
    }
  };

  // #notion-oauth — "계정으로 연결": 브라우저 승인 → 서버리스 교환 → 루프백
  // 수신 → 키체인 저장까지 백엔드 한 커맨드. 최대 3분 대기.
  const connectOauth = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await commands.notionOauthStart();
      if (res.status === "ok") {
        setBotName(res.data);
        onError(null);
        toast.info(t("settings.notion.linked", { name: res.data }));
        refresh();
      } else {
        onError(t("settings.notion.linkFailed", { error: res.error }));
      }
    } finally {
      setBusy(false);
    }
  };

  const removeToken = async () => {
    if (busy) return;
    if (!(await confirm({ title: t("settings.notion.disconnectConfirm"), danger: true }))) return;
    setBusy(true);
    const res = await commands.secretDelete("notion_api_key");
    setBusy(false);
    if (res.status === "error") {
      onError(res.error);
    } else {
      setBotName(null);
      toast.info(t("settings.notion.unlinked"));
      refresh();
    }
  };

  const saveParent = async () => {
    if (busy) return;
    setBusy(true);
    const res = await commands.notionSetParent(parent);
    setBusy(false);
    if (res.status === "error") {
      onError(res.error);
    } else {
      setParent(res.data ?? "");
      onError(null);
      toast.info(res.data ? t("settings.notion.parentSet") : t("settings.notion.parentCleared"));
      refresh();
    }
  };

  return (
    <>
    {confirmDialog}
    <Section
      title={t("settings.notion.title")}
      description={t("settings.notion.desc")}
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={busy} onClick={() => void connectOauth()}>
            {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            {t("settings.notion.connect")}
          </Button>
          <span className="text-[11px] text-muted-foreground">
            {t("settings.notion.connectHint")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">{t("settings.notion.status")}</Label>
          {status?.has_token ? (
            <span className="rounded-full border border-(--ok)/40 bg-(--ok-soft) px-2 py-0.5 text-[10px] text-(--ok-text)">
              {t("settings.notion.connected")}{botName ? ` · ${botName}` : ""}
            </span>
          ) : (
            <span className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground">
              {t("settings.notion.disconnected")}
            </span>
          )}
          {status?.has_token && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void removeToken()}>
              {t("settings.notion.disconnect")}
            </Button>
          )}
        </div>

        {!status?.has_token && (
          <div className="flex gap-2">
            <Input
              type="password"
              placeholder="ntn_… (Notion internal integration token)"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
            />
            <Button size="sm" disabled={busy || !token.trim()} onClick={() => void saveToken()}>
              {busy ? t("settings.notion.verifying") : t("settings.notion.verifySave")}
            </Button>
          </div>
        )}

        <div>
          <Label className="mb-1 block text-xs text-muted-foreground">
            {t("settings.notion.parent")}
          </Label>
          <div className="flex gap-2">
            <Input
              placeholder="https://www.notion.so/…"
              value={parent}
              onChange={(e) => setParent(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void saveParent()}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      </div>
    </Section>
    </>
  );
}

export function DataTab({ onError }: { onError: (msg: string | null) => void }) {
  const { t } = useT();
  const { confirm, confirmDialog } = useConfirm();
  const { resetAll } = useSettings();
  const [info, setInfo] = useState<{ db_path: string; app_data_dir: string; secrets_store: string; version: string } | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    commands.appInfo().then((res) => {
      if (res.status === "ok") setInfo(res.data);
    });
  }, []);

  const copy = (s: string, label: string) => {
    navigator.clipboard.writeText(s);
    setCopied(label);
    setTimeout(() => setCopied(null), 1200);
  };

  const handleClear = async () => {
    if (busy) return;
    setBusy(true);
    const res = await commands.clearAllData();
    setBusy(false);
    setConfirmingClear(false);
    if (res.status === "error") onError(res.error);
    else onError(null);
  };

  const openDevtools = async () => {
    const res = await commands.openDevtools();
    if (res.status === "error") onError(res.error);
  };

  const resetSettings = async () => {
    // 모든 설정을 기본값으로 — 확인 없이 되돌아가던 것 (2026-08-30 감사).
    if (!(await confirm({ title: t("settings.reset.confirm"), danger: true }))) return;
    await resetAll();
  };

  return (
    <>
      <Section title={t("settings.storage.title")} description={t("settings.storage.desc")}>
        {info ? (
          <div className="space-y-2 text-xs font-mono">
            {(
              [
                ["settings.storage.db", info.db_path],
                ["settings.storage.appData", info.app_data_dir],
                ["settings.storage.secrets", info.secrets_store],
                ["settings.storage.version", info.version],
              ] as Array<[I18nKey, string]>
            ).map(([k, v]) => (
              <div
                key={k}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-background border border-border"
              >
                <div className="overflow-hidden">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {t(k)}
                  </div>
                  <div className="truncate text-foreground" title={v}>
                    {v}
                  </div>
                </div>
                <button
                  onClick={() => copy(v, k)}
                  className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 cursor-pointer"
                  title={copied === k ? t("settings.storage.copied") : t("common.copy")}
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">{t("common.loading")}</span>
        )}
      </Section>

      <NotionSection onError={onError} />

      {/* 선언적 설정 (Phase 6) — 설정을 YAML 한 장으로 내보내고 들여온다.
          내보내기·초기화와 같은 계열이라 데이터 탭에 산다. */}
      <DeclarativeConfigSection />

      <ConversationImportSection />

      <Section title={t("settings.diag.title")}>
        <Button variant="outline" onClick={openDevtools} className="w-full">
          {t("settings.diag.devtools")}
        </Button>
      </Section>

      <Section
        title={t("settings.reset.title")}
        description={t("settings.reset.desc")}
      >
        <Button variant="outline" onClick={resetSettings} className="w-full">
          <RefreshCw className="w-3.5 h-3.5 mr-2" />
          {t("settings.reset.action")}
        </Button>
      </Section>

      <Section
        title={t("settings.danger.title")}
        description={t("settings.danger.desc")}
      >
        {!confirmingClear ? (
          <Button
            variant="outline"
            onClick={() => setConfirmingClear(true)}
            className="w-full border-destructive/40 text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="w-3.5 h-3.5 mr-2" />
            {t("settings.danger.wipe")}
          </Button>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-destructive font-medium">
              {t("settings.danger.confirm")}
            </p>
            <div className="flex gap-2">
              <Button
                onClick={handleClear}
                disabled={busy}
                className="flex-1 bg-destructive text-white hover:bg-destructive/90"
              >
                {busy ? t("settings.danger.deleting") : t("settings.danger.yes")}
              </Button>
              <Button
                onClick={() => setConfirmingClear(false)}
                variant="outline"
                disabled={busy}
                className="flex-1"
              >
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        )}
      </Section>
      {confirmDialog}
    </>
  );
}
