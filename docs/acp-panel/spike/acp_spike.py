#!/usr/bin/env python3
"""ACP 스파이크 2 — 한 턴 스트리밍(session/update 청크) 실측.

안전장치: cwd 는 스크래치패드, 프롬프트는 순수 산술(도구 불필요),
session/request_permission 이 오면 무조건 거절한다.
"""
import json
import os
import subprocess
import threading
import time

CWD = os.path.dirname(os.path.abspath(__file__))

proc = subprocess.Popen(
    ["npx", "-y", "@agentclientprotocol/claude-agent-acp"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    text=True, bufsize=1, cwd=CWD,
)

lock = threading.Lock()
done = threading.Event()
state = {"sid": None}
kinds = []


def send(obj):
    with lock:
        proc.stdin.write(json.dumps(obj) + "\n")
        proc.stdin.flush()


def on_line(line):
    if not line:
        return
    try:
        msg = json.loads(line)
    except json.JSONDecodeError:
        print(f"[RAW] {line[:300]}", flush=True)
        return

    if "method" in msg and "id" in msg:  # 에이전트 → 클라이언트 요청
        print(f"[REQ<-] {msg['method']}  {json.dumps(msg.get('params'))[:400]}", flush=True)
        send({"jsonrpc": "2.0", "id": msg["id"], "result": {"outcome": {"outcome": "cancelled"}}})
        return

    if msg.get("method") == "session/update":
        u = msg["params"]["update"]
        kind = u.get("sessionUpdate")
        kinds.append(kind)
        if kind != "available_commands_update":
            print(f"[UPD] {kind}: {json.dumps(u)[:260]}", flush=True)
        return

    if "id" in msg:
        res = msg.get("result")
        print(f"[RES] id={msg['id']} {json.dumps(res or msg.get('error'))[:200]}", flush=True)
        if msg["id"] == 2 and res:
            state["sid"] = res["sessionId"]
        if msg["id"] == 3:
            done.set()


threading.Thread(target=lambda: [on_line(l.strip()) for l in proc.stdout], daemon=True).start()
threading.Thread(target=lambda: [print(f"[ERR] {l.rstrip()[:300]}", flush=True) for l in proc.stderr], daemon=True).start()

send({"jsonrpc": "2.0", "id": 1, "method": "initialize",
      "params": {"protocolVersion": 1, "clientCapabilities": {"fs": {}}}})
send({"jsonrpc": "2.0", "id": 2, "method": "session/new", "params": {"cwd": CWD, "mcpServers": []}})

for _ in range(60):
    if state["sid"]:
        break
    time.sleep(0.5)

if not state["sid"]:
    print("[!!] session/new 실패", flush=True)
else:
    print(f"[..] prompt 전송 sid={state['sid']}", flush=True)
    send({"jsonrpc": "2.0", "id": 3, "method": "session/prompt",
          "params": {"sessionId": state["sid"],
                     "prompt": [{"type": "text", "text": "2 + 2 는? 숫자만 답해."}]}})
    done.wait(timeout=120)

proc.terminate()
try:
    proc.wait(timeout=5)
except subprocess.TimeoutExpired:
    proc.kill()

seen = []
for k in kinds:
    if k not in seen:
        seen.append(k)
print(f"\n=== 관측된 sessionUpdate 종류: {seen} (총 {len(kinds)}건) ===", flush=True)
