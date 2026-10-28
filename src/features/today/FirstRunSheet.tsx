import { useCallback, useEffect, useState } from "react";

import { claudeInstallApi } from "@/api/claudeSurface";
import { Check, Copy } from "@/components/Icons";
import { useT } from "@/i18n";
import { PLUGIN_INSTALL_COMMANDS } from "@/features/skills/pluginDocs";
import { toast } from "@/lib/toast";

/**
 * 첫 실행 — 빈 대시보드 대신 세 단계 한 장 (UI 밀도 라운드 3, 시안 E).
 *
 * ① 프로젝트를 추가했어요 (여기 서 있다는 것이 곧 증거) → ② 터미널의 Claude Code 에
 * 플러그인 두 줄 (설치되면 이 칸이 스스로 초록 — 확인 버튼이 없다) → ③ 평소처럼 한 가지
 * 시키고 기다리기. 첫 일지가 서는 순간 부르는 쪽이 이 시트를 내리고 오늘 화면이 열린다.
 * 전문가는 「이미 알아요 — 건너뛰기」 한 번 — 그 선택은 SQLite 설정에 남는다.
 *
 * 2단계 판정은 `claude_plugin_status` 탐침 그대로다 — 놓칠 수는 있어도 오탐은 없다.
 * 탐침이 실패하면 「모름」이고, 모르는 것을 초록으로 칠하지 않는다.
 */
export function FirstRunSheet({
  projectName,
  onSkip,
}: {
  projectName: string | null;
  /** 「이미 알아요 — 건너뛰기」 — 다시 뜨지 않는다. */
  onSkip: () => void;
}) {
  const { t } = useT();
  const [installed, setInstalled] = useState<boolean | null>(null);

  const probe = useCallback(async () => {
    try {
      const status = await claudeInstallApi.pluginStatus();
      setInstalled(status?.installed ?? null);
    } catch {
      setInstalled(null);
    }
  }, []);
  // 설치는 터미널에서 일어난다 — 30초마다 다시 본다. 시트는 첫 일지까지만 산다.
  useEffect(() => {
    void probe();
    const timer = window.setInterval(() => void probe(), 30_000);
    return () => window.clearInterval(timer);
  }, [probe]);

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => toast.info(t("plugin.copyToast")));
  };

  return (
    <section className="frs" aria-label={t("frs.aria")} data-plugin={installed === true ? "on" : installed === false ? "off" : "unknown"}>
      <div className="frs-sheet">
        <header className="frs-head">
          <span className="frs-eyebrow">{t("frs.eyebrow", { project: projectName ?? "—" })}</span>
          <h2>{t("frs.title")}</h2>
          <p>{t("frs.lead")}</p>
        </header>
        <ol className="frs-steps">
          <li className="frs-step is-done">
            <span className="frs-num" aria-hidden="true"><Check size={11} /></span>
            <div>
              <b>{t("frs.step1")}</b>
              <span>{t("frs.step1Sub")}</span>
            </div>
          </li>
          <li className={"frs-step" + (installed ? " is-done" : " is-current")}>
            <span className="frs-num" aria-hidden="true">{installed ? <Check size={11} /> : "2"}</span>
            <div>
              <b>{t("frs.step2")}</b>
              {installed ? null : (
                <div className="frs-cmds">
                  {PLUGIN_INSTALL_COMMANDS.map((c) => (
                    <div key={c} className="frs-cmd">
                      <code>{c}</code>
                      <button type="button" className="frs-copy" onClick={() => copy(c)}>
                        <Copy size={11} /> {t("plugin.copy")}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <span>{installed ? t("frs.step2Done") : t("frs.step2Sub")}</span>
            </div>
          </li>
          <li className={"frs-step" + (installed ? " is-current" : "")}>
            <span className="frs-num" aria-hidden="true">3</span>
            <div>
              <b>{t("frs.step3")}</b>
              <span>{t("frs.step3Sub")}</span>
            </div>
          </li>
        </ol>
        <footer className="frs-foot">
          <span>{t("frs.others")}</span>
          <button type="button" className="btn ghost sm" onClick={onSkip}>
            {t("frs.skip")}
          </button>
        </footer>
      </div>
    </section>
  );
}
