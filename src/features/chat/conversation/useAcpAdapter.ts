// 어댑터 붙이기 — 자동 시작·재시도·설치, 그리고 "죽었다"의 판정.
//
// `AcpConversation.tsx` 에서 갈라 나온 조각이다 (v3-surface {#acp-split}).
// 순수 이동이며 동작 변경은 없다.

import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";

import { commands, type AcpSession, type AppError } from "@/lib/bindings";
import { tError } from "@/i18n/errors";

export interface AcpAdapterArgs {
  projectId: number;
  provider: "claude" | "codex";
  setSession: React.Dispatch<React.SetStateAction<AcpSession | null>>;
  setError: (message: string | null) => void;
}

export function useAcpAdapter({ projectId, provider, setSession, setError }: AcpAdapterArgs) {
  const [starting, setStarting] = useState(false);
  /**
   * 어댑터가 아직 안 깔려 시작하지 못했다 — 화면이 설치 버튼을 띄운다.
   *
   * 오류 문구만으로는 사용자가 할 수 있는 일이 "다시 시도" 뿐이었다(눌러도
   * 같은 곳에서 같은 이유로 막힌다). 코드로 갈라 안내를 바꾼다.
   */
  const [needsInstall, setNeedsInstall] = useState(false);
  /** 어댑터 프로세스가 죽은 것을 감지했다 — 배너와 다시 연결 버튼의 근거. */
  const [agentGone, setAgentGone] = useState(false);
  /** 살아 있는 것을 한 번이라도 봤는가 — "죽었다"는 살아 있던 것만 말할 수 있다. */
  const aliveRef = useRef(false);

  const failStart = useCallback(
    (err: AppError) => {
      setNeedsInstall(err.code === "acp_codex_adapter_missing");
      setError(tError(err));
    },
    [setError],
  );

  // 사용자가 "시작"을 누르게 하지 않는다 — 화면에 들어오면 붙는다.
  // `acp_start` 는 멱등이라(이미 떠 있으면 그대로) 재진입 비용이 거의 없다.
  useEffect(() => {
    let cancelled = false;
    setSession(null);
    setError(null);
    setNeedsInstall(false);
    setStarting(true);
    void commands
      .acpStart(projectId, provider)
      .then((res) => {
        if (cancelled) return;
        if (res.status === "ok") setSession(res.data);
        else failStart(res.error);
      })
      .finally(() => {
        if (!cancelled) setStarting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, provider, failStart, setSession, setError]);

  const retry = useCallback(async () => {
    setStarting(true);
    setError(null);
    setNeedsInstall(false);
    try {
      const res = await commands.acpStart(projectId, provider);
      if (res.status === "ok") setSession(res.data);
      else failStart(res.error);
    } finally {
      setStarting(false);
    }
  }, [projectId, provider, failStart, setSession, setError]);

  /**
   * 어댑터를 **누르면** 깐다.
   *
   * Claude 는 없으면 말없이 깔아 준다 — 그것 말고 선택지가 없기 때문이다.
   * Codex 는 다르다: 어댑터에 딸려 오는 `@openai/codex` 의 플랫폼 바이너리까지
   * 받으므로, 사이드바를 잘못 눌러 들어온 사람에게 수백 MB 를 말없이 내려받게
   * 할 수는 없다. 백엔드가 `acp_codex_adapter_missing` 으로 돌려보내고 여기서
   * 묻는다.
   */
  const installAdapter = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await commands.acpInstallAdapter(provider);
      if (res.status !== "ok") {
        setError(tError(res.error));
        return;
      }
      setNeedsInstall(false);
    } finally {
      setStarting(false);
    }
    await retry();
  }, [provider, retry, setError]);

  /** 모델·Effort·권한 모드를 바꾼다. 실패하면 화면이 옛 값을 그대로 든다. */
  const setOption = useCallback(
    async (configId: string, value: string) => {
      const res = await commands.acpSetConfigOption(projectId, provider, configId, value);
      if (res.status === "ok") {
        setSession((prev) => (prev ? { ...prev, options: res.data } : prev));
      } else {
        setError(tError(res.error));
      }
    },
    [projectId, provider, setSession, setError],
  );

  return {
    starting,
    setStarting,
    needsInstall,
    agentGone,
    setAgentGone,
    aliveRef,
    retry,
    installAdapter,
    setOption,
  };
}
