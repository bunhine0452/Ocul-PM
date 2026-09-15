// 디버그 실행 구성 다이얼로그 — "이번에 무엇을 띄울지" 만 묻는다 (구성 파일은 Phase 3 밖).
// 폼 값은 화면이 소유한다 (툴바의 ▶ 가 지금 파일로 기본값을 채워야 해서).
// `CodeScreenV2` 에서 그대로 들어냈다 (optimization-round-2 {#split-codescreen}) — 동작 불변.
import { useState } from "react";

import { AppDialog } from "@/components/ui/AppDialog";
import { t } from "@/i18n";
import { tError } from "@/i18n/errors";
import { blocked } from "@/lib/blocked";
import { toast } from "@/lib/toast";

import { toLaunchRequest } from "../debugConfig";
import type { UseDebugResult } from "../useDebug";

/** 실행 구성 — 영속하지 않는다. 다음 실행에는 다시 그럴듯한 기본값을 채워 준다. */
export interface LaunchForm {
  language: string;
  program: string;
  args: string;
  stopOnEntry: boolean;
}

const LABEL: React.CSSProperties = {
  display: "block",
  fontSize: "var(--fs-4)",
  fontWeight: "var(--fw-strong)",
  marginBottom: 6,
};
const HINT: React.CSSProperties = {
  margin: "6px 0 12px",
  fontSize: "var(--fs-3)",
  color: "var(--text-3)",
  lineHeight: 1.6,
};

interface DebugLaunchDialogProps {
  open: boolean;
  onClose: () => void;
  form: LaunchForm;
  setForm: React.Dispatch<React.SetStateAction<LaunchForm>>;
  start: UseDebugResult["start"];
  /** 세션이 붙었다 — 화면이 다이얼로그를 닫고 디버그 패널을 연다. */
  onStarted: () => void;
}

export function DebugLaunchDialog({
  open,
  onClose,
  form: launchForm,
  setForm: setLaunchForm,
  start,
  onStarted,
}: DebugLaunchDialogProps) {
  const [starting, setStarting] = useState(false);

  return (
    <AppDialog open={open} onClose={onClose} label={t("code.debug.startTitle")} width={460}>
      <form
        style={{ padding: "18px 20px 16px" }}
        onSubmit={(e) => {
          e.preventDefault();
          if (starting || !launchForm.program.trim()) return;
          setStarting(true);
          void start(toLaunchRequest(launchForm)).then((error) => {
            setStarting(false);
            if (error) {
              toast.destructive(t("code.debug.startFailed", { error: tError(error) }));
              return;
            }
            onStarted();
          });
        }}
      >
        <h2 style={{ margin: "0 0 12px", fontSize: "var(--fs-5)", fontWeight: "var(--fw-bold)" }}>
          {t("code.debug.startTitle")}
        </h2>
        <label style={LABEL} htmlFor="dap-language">{t("code.debug.language")}</label>
        <select
          id="dap-language"
          className="input"
          value={launchForm.language}
          onChange={(e) => setLaunchForm((p) => ({ ...p, language: e.target.value }))}
          style={{ width: "100%", marginBottom: 12 }}
        >
          <option value="rust">rust</option>
          <option value="python">python</option>
          <option value="go">go</option>
        </select>

        <label style={LABEL} htmlFor="dap-program">{t("code.debug.program")}</label>
        <input
          id="dap-program"
          className="input"
          value={launchForm.program}
          onChange={(e) => setLaunchForm((p) => ({ ...p, program: e.target.value }))}
          spellCheck={false}
          autoComplete="off"
          style={{ width: "100%", fontFamily: "var(--mono)" }}
        />
        <p style={HINT}>{t("code.debug.programHint")}</p>

        <label style={LABEL} htmlFor="dap-args">{t("code.debug.args")}</label>
        <input
          id="dap-args"
          className="input"
          value={launchForm.args}
          onChange={(e) => setLaunchForm((p) => ({ ...p, args: e.target.value }))}
          spellCheck={false}
          autoComplete="off"
          style={{ width: "100%", fontFamily: "var(--mono)", marginBottom: 12 }}
        />

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--fs-4)" }}>
          <input
            type="checkbox"
            checked={launchForm.stopOnEntry}
            onChange={(e) => setLaunchForm((p) => ({ ...p, stopOnEntry: e.target.checked }))}
          />
          {t("code.debug.stopOnEntry")}
        </label>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" className="btn sm" onClick={onClose} disabled={starting}>{t("common.cancel")}</button>
          <button type="submit" className="btn sm primary" {...blocked(launchForm.program.trim() ? null : t("code.debug.blockedNoProgram"))} disabled={starting}>
            {t("code.debug.start")}
          </button>
        </div>
      </form>
    </AppDialog>
  );
}
