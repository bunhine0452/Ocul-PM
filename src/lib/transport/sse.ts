// 모바일 브리지 SSE 클라이언트 (#mb2-shim ↔ 백엔드 #mb2-sse).
//
// EventSource 는 Authorization 헤더를 못 실으므로 fetch 스트리밍으로 읽는다.
// Last-Event-ID 를 들고 지수 백오프로 재접속 — 버퍼(서버 256) 밖까지 끊겼던
// 경우의 공백은 화면 재조회가 메운다 (데스크톱 워처 복구와 같은 정책).

import { authHeaders } from "./http";

export interface SseFrame {
  id?: string;
  event?: string;
  data: string;
}

/** text/event-stream 증분 파서 — 청크 경계와 무관하게 프레임을 복원한다. */
export class SseParser {
  private buf = "";

  push(chunk: string): SseFrame[] {
    this.buf += chunk;
    const frames: SseFrame[] = [];
    for (;;) {
      const cut = this.buf.indexOf("\n\n");
      if (cut === -1) break;
      const raw = this.buf.slice(0, cut);
      this.buf = this.buf.slice(cut + 2);
      const frame: SseFrame = { data: "" };
      const dataLines: string[] = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith(":")) continue; // keep-alive 주석
        if (line.startsWith("id:")) frame.id = line.slice(3).trim();
        else if (line.startsWith("event:")) frame.event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      }
      frame.data = dataLines.join("\n");
      if (frame.id !== undefined || frame.event !== undefined || frame.data !== "") {
        frames.push(frame);
      }
    }
    return frames;
  }
}

export interface BridgeEvent<T = unknown> {
  event: string;
  id: number;
  payload: T;
}

type Listener = (e: BridgeEvent) => void;

const listeners = new Map<string, Set<Listener>>();
let running = false;
let lastEventId: string | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function deliver(frame: SseFrame): void {
  if (frame.id !== undefined) lastEventId = frame.id;
  if (!frame.event) return;
  const set = listeners.get(frame.event);
  if (!set || set.size === 0) return;
  let payload: unknown = null;
  try {
    payload = frame.data === "" ? null : JSON.parse(frame.data);
  } catch {
    return; // 손상 프레임은 버린다 — 다음 재조회가 보정.
  }
  const event: BridgeEvent = { event: frame.event, id: Number(frame.id ?? 0), payload };
  for (const cb of set) cb(event);
}

async function pump(): Promise<void> {
  let backoff = 1_000;
  while (listeners.size > 0) {
    try {
      const res = await fetch("/api/events", {
        headers: {
          ...authHeaders(),
          ...(lastEventId !== null ? { "last-event-id": lastEventId } : {}),
        },
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      backoff = 1_000; // 연결 성공 — 백오프 리셋.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const parser = new SseParser();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
          deliver(frame);
        }
      }
    } catch {
      // 접속 실패/절단 — 아래 백오프 후 재시도.
    }
    if (listeners.size === 0) break;
    await sleep(backoff);
    backoff = Math.min(backoff * 2, 30_000);
  }
  running = false;
}

/** 이벤트 구독 — 첫 구독이 연결을 연다. 반환 함수로 해제. */
export function sseListen(event: string, cb: Listener): () => void {
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  set.add(cb);
  if (!running) {
    running = true;
    void pump();
  }
  return () => {
    const s = listeners.get(event);
    if (!s) return;
    s.delete(cb);
    if (s.size === 0) listeners.delete(event);
  };
}
