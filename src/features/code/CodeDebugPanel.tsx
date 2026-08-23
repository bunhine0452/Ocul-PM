// 디버그 패널 — 참조 패널과 같은 자리(편집 영역 아래 전체 폭)에 앉는다.
//
// 왼쪽에 실행 제어 + 호출 스택, 오른쪽에 변수 트리, 아래에 콘솔. 멈춰 있지
// 않으면 스택도 변수도 없으므로 그 사실을 빈 목록이 아니라 **문장으로** 말한다
// — 빈 표는 "없다" 와 "아직 못 물었다" 를 구별해 주지 않는다.
import { memo, useCallback, useEffect, useState } from "react";

import { X, Play, Square, ArrowDown, ArrowRight, ArrowUp, ChevronRight } from "@/components/Icons";
import { t, useT } from "@/i18n";
import type { DapFrame, DapOutput, DapSessionInfo, DapVariable } from "@/lib/bindings";

interface CodeDebugPanelProps {
  session: DapSessionInfo | null;
  frames: DapFrame[];
  selectedFrameId: number | null;
  scopeRoots: { name: string; reference: number; expensive: boolean }[];
  output: DapOutput[];
  onSelectFrame: (id: number) => void;
  onControl: (action: "continue" | "next" | "step_in" | "step_out" | "pause") => void;
  onStop: () => void;
  onClose: () => void;
  onClearOutput: () => void;
  /** 프로젝트 안 프레임으로 점프 (1-based 줄). */
  onOpenFrame: (path: string, line: number) => void;
  loadVariables: (reference: number) => Promise<DapVariable[]>;
}

export const CodeDebugPanel = memo(function CodeDebugPanel({
  session,
  frames,
  selectedFrameId,
  scopeRoots,
  output,
  onSelectFrame,
  onControl,
  onStop,
  onClose,
  onClearOutput,
  onOpenFrame,
  loadVariables,
}: CodeDebugPanelProps) {
  useT();
  const stopped = session?.state === "stopped";
  const live = session != null && session.state !== "ended" && session.state !== "idle";

  return (
    <div className="code-debug" role="region" aria-label={t("code.debug.title")}>
      <div className="code-debug-head">
        <strong className="code-debug-title">{t("code.debug.title")}</strong>
        <StateChip session={session} />
        <div className="code-debug-controls">
          <CtlButton
            label={t("code.debug.continue")}
            disabled={!stopped}
            onClick={() => onControl("continue")}
          >
            <Play size={13} />
          </CtlButton>
          <CtlButton
            label={t("code.debug.stepOver")}
            disabled={!stopped}
            onClick={() => onControl("next")}
          >
            <ArrowRight size={13} />
          </CtlButton>
          <CtlButton
            label={t("code.debug.stepIn")}
            disabled={!stopped}
            onClick={() => onControl("step_in")}
          >
            <ArrowDown size={13} />
          </CtlButton>
          <CtlButton
            label={t("code.debug.stepOut")}
            disabled={!stopped}
            onClick={() => onControl("step_out")}
          >
            <ArrowUp size={13} />
          </CtlButton>
          <CtlButton label={t("code.debug.stop")} disabled={!live} onClick={onStop} danger>
            <Square size={12} />
          </CtlButton>
        </div>
        <button
          type="button"
          className="code-refs-close"
          onClick={onClose}
          aria-label={t("common.close")}
          title={t("common.close")}
        >
          <X size={13} strokeWidth={2.5} />
        </button>
      </div>

      {session?.detail ? <div className="code-debug-detail">{session.detail}</div> : null}

      <div className="code-debug-body">
        <div className="code-debug-col">
          <div className="code-debug-colhead">{t("code.debug.stack")}</div>
          <div className="code-debug-scroll">
            {!stopped ? (
              <p className="code-debug-hint">
                {live ? t("code.debug.runningHint") : t("code.debug.idleHint")}
              </p>
            ) : frames.length === 0 ? (
              <p className="code-debug-hint">{t("code.debug.noStack")}</p>
            ) : (
              frames.map((f) => (
                <button
                  key={f.id ?? 0}
                  type="button"
                  // 프로젝트 밖(표준 라이브러리·런타임) 프레임은 지우지 않고
                  // 흐리게 — 스택의 깊이 자체가 정보다.
                  className={
                    "code-debug-frame" +
                    (f.id === selectedFrameId ? " on" : "") +
                    (f.path == null ? " outside" : "")
                  }
                  onClick={() => {
                    onSelectFrame(f.id ?? 0);
                    if (f.path) onOpenFrame(f.path, f.line);
                  }}
                  title={f.path ?? f.display_source ?? f.name}
                >
                  <span className="code-debug-frame-name">{f.name}</span>
                  <span className="code-debug-frame-loc">
                    {f.display_source ? `${f.display_source}:${f.line}` : t("code.debug.noSource")}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="code-debug-col wide">
          <div className="code-debug-colhead">{t("code.debug.variables")}</div>
          <div className="code-debug-scroll">
            {!stopped ? (
              <p className="code-debug-hint">{t("code.debug.varsNeedStop")}</p>
            ) : (
              scopeRoots.map((scope) => (
                <VarNode
                  key={scope.reference}
                  name={scope.name}
                  value=""
                  typeName={null}
                  reference={scope.reference}
                  depth={0}
                  // 비싸다고 표시된 스코프(Registers 등)는 자동으로 안 펼친다.
                  defaultOpen={!scope.expensive && scope.name.toLowerCase().includes("local")}
                  loadVariables={loadVariables}
                />
              ))
            )}
          </div>
        </div>

        <div className="code-debug-col wide">
          <div className="code-debug-colhead">
            {t("code.debug.console")}
            {output.length > 0 ? (
              <button type="button" className="code-debug-clear" onClick={onClearOutput}>
                {t("code.debug.clear")}
              </button>
            ) : null}
          </div>
          <div className="code-debug-scroll code-debug-console">
            {output.length === 0 ? (
              <p className="code-debug-hint">{t("code.debug.noOutput")}</p>
            ) : (
              output.map((o, i) => (
                <div key={i} className={"code-debug-out " + o.category}>
                  {o.text}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

/** 변수 트리 한 칸 — **펼칠 때** 자식을 읽는다 (코드 트리와 같은 원칙). */
function VarNode({
  name,
  value,
  typeName,
  reference,
  depth,
  defaultOpen,
  loadVariables,
}: {
  name: string;
  value: string;
  typeName: string | null;
  reference: number;
  depth: number;
  defaultOpen?: boolean;
  loadVariables: (reference: number) => Promise<DapVariable[]>;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [children, setChildren] = useState<DapVariable[] | null>(null);
  const expandable = reference !== 0;

  useEffect(() => {
    if (!open || !expandable || children != null) return;
    let cancelled = false;
    void loadVariables(reference).then((vars) => {
      if (!cancelled) setChildren(vars);
    });
    return () => {
      cancelled = true;
    };
  }, [open, expandable, children, reference, loadVariables]);

  const toggle = useCallback(() => setOpen((v) => !v), []);

  return (
    <>
      <div className="code-debug-var" style={{ paddingLeft: 8 + depth * 13 }}>
        {expandable ? (
          <button type="button" className="code-debug-var-caret" onClick={toggle} aria-expanded={open}>
            <ChevronRight size={11} className={"code-tree-caret" + (open ? " open" : "")} />
          </button>
        ) : (
          <span className="code-debug-var-caret" />
        )}
        <span className="code-debug-var-name">{name}</span>
        {value ? <span className="code-debug-var-value">{value}</span> : null}
        {typeName ? <span className="code-debug-var-type">{typeName}</span> : null}
      </div>
      {open && children != null
        ? children.map((c, i) => (
            <VarNode
              key={`${c.name}:${i}`}
              name={c.name}
              value={c.value}
              typeName={c.type_name}
              reference={c.variables_reference ?? 0}
              depth={depth + 1}
              loadVariables={loadVariables}
            />
          ))
        : null}
      {open && children == null ? (
        <div className="code-debug-hint" style={{ paddingLeft: 8 + (depth + 1) * 13 }}>
          {t("code.tree.loading")}
        </div>
      ) : null}
    </>
  );
}

function StateChip({ session }: { session: DapSessionInfo | null }) {
  useT();
  const label = (() => {
    switch (session?.state) {
      case "starting":
        return t("code.debug.state.starting");
      case "configuring":
        return t("code.debug.state.configuring");
      case "running":
        return t("code.debug.state.running");
      case "stopped":
        return session.stopped_reason
          ? t("code.debug.state.stoppedAt", { reason: session.stopped_reason })
          : t("code.debug.state.stopped");
      case "ended":
        return t("code.debug.state.ended");
      default:
        return t("code.debug.state.idle");
    }
  })();
  return <span className={"code-debug-chip " + (session?.state ?? "idle")}>{label}</span>;
}

function CtlButton({
  label,
  disabled,
  danger,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={"code-debug-ctl" + (danger ? " danger" : "")}
      disabled={disabled}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}
