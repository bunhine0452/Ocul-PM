// 이 화면이 **바깥에 알리는 것들** — 사이드바 배지·업데이트 문지기, 그리고
// 대화 안에 남기는 구분선(모델 교체·제목).
//
// `AcpConversation.tsx` 에서 갈라 나온 조각이다 (v3-surface {#acp-split}).
// 순수 이동이며 동작 변경은 없다.

import { useEffect, useRef } from "react";

import { registerBusy } from "@/lib/busyGuard";
import { useT } from "@/i18n";
import type { AcpSession } from "@/lib/bindings";
import { acpWorkingKey, setAcpAttention, setAcpWorking } from "../acpBusyBus";
import { resolveTitle } from "../acpTitle";
import { insertNotice, type AcpTurn } from "../acpTurns";

export interface AcpSignalsArgs {
  projectId: number;
  provider: "claude" | "codex";
  /** 아직 안 만든 새 대화의 자리 표시. */
  slate: string;
  session: AcpSession | null;
  busySessions: ReadonlySet<string>;
  /** 승인 대기 중인 대화들 (키가 곧 대화 id). */
  permissions: Readonly<Record<string, unknown>>;
  editTurns: (id: string, update: (prev: AcpTurn[]) => AcpTurn[]) => void;
  renameTab: (id: string | null, title: string | null) => void;
  promptsOf: (id: string) => string[];
}

export function useAcpSignals({
  projectId,
  provider,
  slate,
  session,
  busySessions,
  permissions,
  editTurns,
  renameTab,
  promptsOf,
}: AcpSignalsArgs) {
  const { t } = useT();

  /**
   * 승인 대기를 사이드바에 알린다 — 작업 중과 **다른 신호**다. 작업 중은
   * 기다리면 되지만 승인 대기는 사용자가 눌러야 풀린다. 이 표시가 없으면
   * 다른 화면에서 "아직 도는 중"으로 믿고 기다리다 몇 분을 잃는다.
   */
  useEffect(() => {
    const keys = Object.keys(permissions).map((id) =>
      acpWorkingKey(projectId, id === slate ? null : id, provider),
    );
    keys.forEach((key) => setAcpAttention(key, true));
    return () => keys.forEach((key) => setAcpAttention(key, false));
  }, [permissions, projectId, provider, slate]);

  /**
   * 사이드바에 "몇 개가 돌고 있는지"를 알린다.
   *
   * 이 화면을 떠나도 턴은 계속 돈다 — 그런데 떠난 순간부터 **아무 표시도 없다**.
   * 다 됐는지 보려고 되돌아오는 일이 반복됐다. 언마운트(창을 닫거나 프로젝트
   * 탭을 접을 때)에도 반드시 지운다: 안 지우면 끝나지 않는 유령이 남는다.
   */
  useEffect(() => {
    const keys = [...busySessions].map((id) =>
      acpWorkingKey(projectId, id === slate ? null : id, provider),
    );
    keys.forEach((key) => setAcpWorking(key, true));
    return () => keys.forEach((key) => setAcpWorking(key, false));
  }, [busySessions, projectId, provider, slate]);

  /**
   * 답변이 도는 동안은 **업데이트 재시작을 막는다.**
   *
   * 재시작은 우리가 띄운 어댑터를 같이 죽이고, 그때 흐르던 답변은 아직 디스크에
   * 없어 그대로 사라진다. 새 번들을 까는 것까지는 언제든 해도 된다 — 기다리는
   * 것은 마지막 한 걸음뿐이다.
   */
  useEffect(
    // 보고 있는 대화가 아니어도 잡는다 — 뒤에서 도는 턴도 재시작이면 함께 죽는다.
    () => registerBusy(() => (busySessions.size ? t("acp.busyReason") : null)),
    [busySessions, t],
  );

  /**
   * 모델이 바뀌면 대화에 **구분선 한 줄**을 남긴다.
   *
   * 안 남기면 나중에 스크롤을 올렸을 때 어디까지가 어느 모델의 답인지 알 수 없다 —
   * 특히 답의 결이 달라졌을 때 "왜 갑자기 이러지"의 답이 여기 있다.
   *
   * **대화별로** 마지막 값을 기억한다: 다른 대화를 열면 그쪽 모델로 갈아끼워지는데,
   * 세션 구분 없이 보면 그것까지 "바꿨다"로 잘못 읽는다. 처음 본 값도 조용히
   * 기록만 한다 — 시작 모델은 바뀐 것이 아니다.
   */
  const modelSeenRef = useRef<{ session: string; model: string } | null>(null);
  useEffect(() => {
    const id = session?.session_id;
    const model = session?.options.find((o) => o.id === "model")?.current;
    if (!id || !model) return;

    const seen = modelSeenRef.current;
    modelSeenRef.current = { session: id, model };
    if (!seen || seen.session !== id || seen.model === model) return;

    const label = session?.options
      .find((o) => o.id === "model")
      ?.choices.find((choice) => choice.value === model)?.name;
    editTurns(id, (prev) => insertNotice(prev, t("acp.switchedTo", { model: label || model })));
  }, [session?.session_id, session?.options, editTurns, t]);

  // 제목이 붙으면 열려 있는 탭에 반영한다 (없는 탭은 만들지 않는다).
  // **받은 그대로 쓰지 않는다** — 지시문의 메아리를 걸러 낸다 (acpTitle.ts).
  useEffect(() => {
    const id = session?.session_id;
    if (!id) return;
    renameTab(id, resolveTitle(session?.title ?? null, promptsOf(id)));
  }, [session?.session_id, session?.title, renameTab, promptsOf]);
}
