/**
 * 「Claude 에게 보내기」 대화상자 — 프로젝트 창마다 하나. 맥락 · 할 말 · 받는 곳(지금 도는 claude
 * 세션 또는 새 세션)을 고르고 ⌘↩ 로 보낸다. 넣는 일은 `sendToClaude.ts`.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { toAppError } from "@/api/invoke";
import { terminalApi, type TermInfo } from "@/api/terminal";
import { AppDialog } from "@/components/ui/AppDialog";
import { useT } from "@/i18n";
import { blocked } from "@/lib/blocked";
import { tError } from "@/i18n/errors";
import { kbd } from "@/lib/kbd";
import { NAV_BUS } from "@/lib/navRegistry";
import { toast } from "@/lib/toast";
import { requestTermFocus } from "./focusRequest";
import { runPromptInTerminal } from "./runPrompt";
import {
  composeMessage,
  defaultReceiver,
  flushQueue,
  onSendToClaude,
  queuedStore,
  readinessOf,
  receiversOf,
  sendOrQueue,
  toastQueued,
  type SendContext,
} from "./sendToClaude";
import { sessionWord } from "./status";
import "./send.css";

const NEW = "new";

export function SendToClaudeHost({ projectId }: { projectId: number }) {
  const { t } = useT();
  const [ctx, setCtx] = useState<SendContext | null>(null);
  const [text, setText] = useState("");
  const [sessions, setSessions] = useState<TermInfo[]>([]);
  const [target, setTarget] = useState<string>(NEW);
  const [busy, setBusy] = useState(false);
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(
    () =>
      onSendToClaude((next) => {
        setCtx(next);
        setText(next.prefill ?? "");
        setSessions([]);
        setTarget(NEW);
        void terminalApi
          .list()
          .then((all) => {
            const list = receiversOf(Array.isArray(all) ? all : []);
            setSessions(list);
            const first = defaultReceiver(list);
            setTarget(first ? String(first.id) : NEW);
          })
          .catch(() => {});
      }),
    [],
  );

  useSendQueueFlusher();

  const close = () => setCtx(null);
  const order = (id: number) => sessions.findIndex((s) => s.id === id) + 1;
  const picked = target === NEW ? null : sessions.find((s) => String(s.id) === target);
  const readiness = picked ? readinessOf(picked.status) : "ready";

  const send = async (now = false) => {
    if (!ctx || busy || !text.trim()) return;
    const message = composeMessage(t, ctx, text);
    setBusy(true);
    try {
      if (target === NEW) {
        await runPromptInTerminal(projectId, message);
        ctx.onSent?.();
      } else {
        const id = Number(target);
        const n = order(id);
        const res = await sendOrQueue(id, message, { now, onDelivered: ctx.onSent });
        if (res.outcome === "sent") {
          toast.info(t("send.sent", { n }), { actions: [viewAction(t("send.view"), id)] });
        } else {
          toastQueued(t, n, res.key);
        }
      }
      close();
    } catch (e) {
      toast.destructive(t("send.failed", { error: tError(toAppError(e)) }));
    } finally {
      setBusy(false);
    }
  };

  // ⌘↩ 보내기(쉬지 않으면 줄 세우기) · ⇧⌘↩ 지금 끼워 넣기(일하는 중일 때만 — 묻는 중엔 여전히 줄로).
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(e.shiftKey);
    }
  };

  const kindWord = ctx ? t(`send.kind.${ctx.kind}` as const) : "";
  return (
    <AppDialog open={ctx != null} onClose={close} label={t("send.title")} width={480} initialFocusRef={textRef}>
      {ctx ? (
        <div className="send">
          <div className="send-head">
            <b>{t("send.title")}</b>
            <kbd className="kbd">{kbd("⌘↩")}</kbd>
          </div>
          <p className="send-ctx">
            <span className="send-ctx-k">{t("send.context")}</span> {kindWord} 「{ctx.label}」
            {ctx.note ? ` · ${ctx.note}` : ""}
          </p>
          <textarea
            ref={textRef}
            className="send-text"
            rows={4}
            value={text}
            placeholder={t("send.placeholder")}
            aria-label={t("send.placeholder")}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {readiness !== "ready" ? (
            <p className="send-hint" role="status">
              {t(readiness === "working" ? "send.hint.working" : "send.hint.blocked")}
            </p>
          ) : null}
          <div className="send-foot">
            <label className="send-target">
              <span>{t("send.target")}</span>
              <span className="select-wrap inline sm">
                <select value={target} onChange={(e) => setTarget(e.target.value)}>
                  {sessions.map((s, i) => (
                    <option key={s.id} value={String(s.id)}>
                      {t("send.session", { n: i + 1, label: s.label, word: sessionWord(t, s) })}
                    </option>
                  ))}
                  <option value={NEW}>{t("send.newSession")}</option>
                </select>
              </span>
            </label>
            <span className="send-sp" />
            <button type="button" className="btn sm" onClick={close}>
              {t("common.cancel")}
            </button>
            {readiness === "working" ? (
              <button
                type="button"
                className="btn sm"
                title={t("send.nowTitle")}
                {...blocked(text.trim() ? null : t("send.needsText"))}
                disabled={busy}
                onClick={() => void send(true)}
              >
                {t("send.now")}
              </button>
            ) : null}
            <button
              type="button"
              className="btn primary sm"
              {...blocked(text.trim() ? null : t("send.needsText"))}
              disabled={busy}
              onClick={() => void send()}
            >
              {t(readiness === "ready" ? "send.submit" : "send.submitQueue")}
            </button>
          </div>
        </div>
      ) : null}
    </AppDialog>
  );
}

function viewAction(label: string, id: number) {
  return {
    label,
    onClick: () => {
      requestTermFocus(id);
      window.dispatchEvent(new CustomEvent(NAV_BUS.setView, { detail: "terminal" }));
    },
  };
}

/**
 * 줄을 비우는 쪽 — 줄에 무언가 있을 때만, 이 창의 세션이 바뀌거나 상태가 바뀔 때마다 목록을 읽어
 * 손을 놓은 세션에 넣는다. 창마다 하나(대화상자와 함께 산다).
 */
function useSendQueueFlusher() {
  const { t } = useT();
  const tRef = useRef(t);
  tRef.current = t;
  useEffect(() => {
    let alive = true;
    const run = async () => {
      if (queuedStore.get().length === 0) return;
      const all = await terminalApi.list().catch(() => []);
      const list = Array.isArray(all) ? all : [];
      const { delivered, dropped } = await flushQueue(list);
      if (!alive) return;
      const tr = tRef.current;
      const receivers = receiversOf(list);
      for (const id of new Set(delivered.map((q) => q.sessionId))) {
        const n = receivers.findIndex((s) => s.id === id) + 1;
        toast.info(tr("send.queueDelivered", { n }), { actions: [viewAction(tr("send.view"), id)] });
      }
      if (dropped.length > 0) toast.warning(tr("send.queueDropped", { n: dropped.length }));
    };
    const off = terminalApi.onSessionsChanged(() => void run());
    // 줄에 세우는 사이 세션이 이미 손을 놓았을 수 있다 — 그 뒤엔 사건이 없으니 세울 때도 한 번 본다.
    const offQueue = queuedStore.subscribe(() => void run());
    return () => {
      alive = false;
      offQueue();
      void off.then((fn) => fn());
    };
  }, []);
}
