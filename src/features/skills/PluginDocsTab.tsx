import { useEffect, useState } from "react";
import { Toolbar } from "@/components/Toolbar";
import { toast } from "@/lib/toast";
import { useT } from "@/i18n";
import { commands, type ClaudePluginStatus } from "@/lib/bindings";
import {
  PLUGIN_COMMANDS,
  PLUGIN_CONTRACT_URL,
  PLUGIN_DOCS_URL,
  PLUGIN_FLOW,
  PLUGIN_HOOK_FEATURES,
  PLUGIN_INSTALL_COMMANDS,
  PLUGIN_TOOLS,
} from "./pluginDocs";

// 플러그인 탭 — oculpm.com/plugin 문서의 인앱 거울. 데이터는 pluginDocs.ts
// (plugin/oculpm/ 과의 동기는 plugin_docs_sync.test.ts 가 강제). 스킬·규칙·훅
// 옆에 두는 이유: 이 화면이 Claude Code 표면의 집이다.

function CopyChip({ text, label }: { text: string; label?: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn sm"
      title={t("plugin.copyTitle", { text })}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          toast.info(t("plugin.copyToast"));
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? t("plugin.copied") : (label ?? t("plugin.copy"))}
    </button>
  );
}

export function PluginDocsTab({
  tabs,
  embedded = false,
}: {
  tabs?: React.ReactNode;
  /** AD-3 — 3존 화면의 모달 안에서 렌더 (자기 Toolbar 없이). */
  embedded?: boolean;
}) {
  const { t } = useT();
  const [status, setStatus] = useState<ClaudePluginStatus | null>(null);
  useEffect(() => {
    // 직접 값 반환 커맨드 (Result 봉투 아님) — 실패는 미설치와 동일 취급.
    commands
      .claudePluginStatus()
      .then(setStatus)
      .catch(() => setStatus({ installed: false, path: null }));
  }, []);

  return (
    <>
      {embedded ? null : (
        <Toolbar title={t("plugin.toolbarTitle")} sub={t("plugin.toolbarSub")}>
          {tabs}
        </Toolbar>
      )}
      <div className={embedded ? "sk-shop-embed" : "scroll"}>
        <div className="page fade-in flex max-w-3xl flex-col gap-5">
          {/* 설치 상태 + 설치 명령 */}
          <section className="rounded-lg border border-border/60 bg-card p-5">
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-sm font-semibold">{t("plugin.name")}</h3>
              {status?.installed ? (
                <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                  {t("plugin.installed")}
                </span>
              ) : status ? (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {t("plugin.notInstalled")}
                </span>
              ) : null}
            </div>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {t("plugin.blurb")}
              {status?.installed
                ? t("plugin.blurbInstalled")
                : t("plugin.blurbNotInstalled")}
            </p>
            {!status?.installed && (
              <div className="mt-3 flex flex-col gap-1.5">
                {PLUGIN_INSTALL_COMMANDS.map((c) => (
                  <div
                    key={c}
                    className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5"
                  >
                    <code className="flex-1 truncate font-mono text-[12px]">{c}</code>
                    <CopyChip text={c} />
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 권장 흐름 */}
          <section className="rounded-lg border border-border/60 bg-card p-5">
            <h3 className="mb-2 text-sm font-semibold">{t("plugin.flowTitle")}</h3>
            <div className="flex flex-wrap items-center gap-1.5 font-mono text-[12px]">
              {PLUGIN_FLOW.map((step, i) => (
                <span key={step} className="flex items-center gap-1.5">
                  {i > 0 && <span className="text-muted-foreground">→</span>}
                  <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 font-semibold text-primary">
                    {step}
                  </span>
                </span>
              ))}
              <span className="text-[11px] text-muted-foreground">{t("plugin.flowRepeat")}</span>
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              {t("plugin.flowNote")}
            </p>
          </section>

          {/* 커맨드 4종 */}
          <section className="rounded-lg border border-border/60 bg-card p-5">
            <h3 className="mb-3 text-sm font-semibold">{t("plugin.commandsTitle")}</h3>
            <div className="flex flex-col gap-3">
              {PLUGIN_COMMANDS.map((c) => (
                <div key={c.slug} className="rounded-md border border-border/60 bg-background/60 p-3">
                  <div className="flex items-center gap-2">
                    <code className="font-mono text-[13px] font-semibold text-primary">{c.cmd}</code>
                    <span className="flex-1" />
                    <CopyChip text={c.example} />
                  </div>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
                    {c.detail}
                  </p>
                  {c.example !== c.cmd && (
                    <p className="mt-1 font-mono text-[11.5px] text-muted-foreground/70">
                      {t("plugin.example", { example: c.example })}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* MCP 도구 + 훅 */}
          <section className="rounded-lg border border-border/60 bg-card p-5">
            <h3 className="mb-2 text-sm font-semibold">{t("plugin.toolsTitle")}</h3>
            <p className="mb-3 text-[12px] leading-relaxed text-muted-foreground">
              {t("plugin.toolsNotePrefix")}
              <code className="font-mono">.oculpm</code>
              {t("plugin.toolsNoteSuffix")}
            </p>
            <div className="flex flex-col gap-1">
              {PLUGIN_TOOLS.map((tool) => (
                <div key={tool.name} className="flex items-baseline gap-2 text-[12.5px]">
                  <code className="w-32 shrink-0 font-mono text-[12px] text-primary">
                    {tool.name}
                  </code>
                  <span className="text-muted-foreground">{tool.desc}</span>
                </div>
              ))}
            </div>
            <h3 className="mb-2 mt-4 text-sm font-semibold">{t("plugin.hooksTitle")}</h3>
            <div className="flex flex-col gap-1.5">
              {PLUGIN_HOOK_FEATURES.map((h) => (
                <div key={h.name} className="text-[12.5px] leading-relaxed">
                  <span className="font-medium text-foreground">{h.name}</span>
                  <span className="text-muted-foreground"> — {h.desc}</span>
                </div>
              ))}
            </div>
          </section>

          {/* 외부 링크 */}
          <div className="flex items-center gap-2 pb-6">
            <button
              type="button"
              className="btn sm"
              onClick={() => void commands.openUrl(PLUGIN_DOCS_URL)}
              title={PLUGIN_DOCS_URL}
            >
              {t("plugin.fullDocs")}
            </button>
            <button
              type="button"
              className="btn sm"
              onClick={() => void commands.openUrl(PLUGIN_CONTRACT_URL)}
              title={t("plugin.contractTitle")}
            >
              {t("plugin.contractDocs")}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
