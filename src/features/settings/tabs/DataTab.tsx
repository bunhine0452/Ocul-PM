import { useConfirm } from "@/hooks/useConfirm";
// 데이터 탭 — 내보내기·초기화.
//
// SettingsPanel.tsx 에서 갈라 나온 조각이다 — 순수 이동이며 동작 변경은 없다.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { commands } from "@/lib/bindings";
import { Trash2, Copy, RefreshCw, Loader2 } from "@/components/Icons";
import { useSettings } from "@/contexts/SettingsContext";
import { useT, type I18nKey } from "@/i18n";
import { Section } from "./ui";
import { DeclarativeConfigSection } from "../config/DeclarativeConfigSection";
import { ConversationImportSection } from "../import/ConversationImportSection";

export function DataTab({ onError }: { onError: (msg: string | null) => void }) {
  const { t } = useT();
  const { confirm, confirmDialog } = useConfirm();
  const { resetAll } = useSettings();
  const [info, setInfo] = useState<{ db_path: string; app_data_dir: string; secrets_store: string; version: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    // 버전·경로 표시용 조회 하나. 못 받으면 그 줄이 비어 있을 뿐이라 버린다.
    void commands.appInfo().then((res) => {
      if (res.status === "ok") setInfo(res.data);
    });
  }, []);

  const copy = async (s: string, label: string) => {
    // 다른 복사 버튼과 같은 모양 — 실패(권한·비활성 창)를 "복사됨" 으로 보이면 안 된다.
    try {
      await navigator.clipboard.writeText(s);
    } catch {
      return;
    }
    setCopied(label);
    setTimeout(() => setCopied(null), 1200);
  };

  // 앱에서 가장 파괴적인 동작이다 — 인라인 2단계 버튼이 아니라 모달로 묻는다
  // (2026-09-09). 목록 행의 「버리기」 같은 가벼운 것과 같은 무게로 보이면 안 된다.
  const handleClear = async () => {
    if (busy) return;
    const ok = await confirm({
      title: t("settings.danger.confirm"),
      message: t("settings.danger.confirmBody"),
      confirmLabel: t("settings.danger.yes"),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    const res = await commands.clearAllData();
    setBusy(false);
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
                  <div className="text-fs-1 uppercase tracking-wider text-muted-foreground">
                    {t(k)}
                  </div>
                  <div className="truncate text-foreground" title={v}>
                    {v}
                  </div>
                </div>
                <button
                  onClick={() => void copy(v, k)}
                  className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 cursor-pointer"
                  title={copied === k ? t("common.copied") : t("common.copy")}
                >
                  <Copy size={15} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">{t("common.loading")}</span>
        )}
      </Section>

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
          <RefreshCw  className="mr-2" size={15} />
          {t("settings.reset.action")}
        </Button>
      </Section>

      <Section
        title={t("settings.danger.title")}
        description={t("settings.danger.desc")}
        tone="danger"
      >
        <Button
          variant="outline"
          onClick={() => void handleClear()}
          disabled={busy}
          className="w-full border-destructive/40 text-destructive hover:bg-destructive/10"
        >
          {busy ? <Loader2 className="mr-2 animate-spin" size={15} /> : <Trash2 className="mr-2" size={15} />}
          {busy ? t("settings.danger.deleting") : t("settings.danger.wipe")}
        </Button>
      </Section>
      {confirmDialog}
    </>
  );
}
