#!/usr/bin/env python3
"""ACP 스파이크 4 — **한 연결에서 두 세션 동시 프롬프트** 실측.

물음: 어댑터(0.70.0)가 하나의 stdio 연결 위에서 세션 두 개의 턴을 **동시에**
굴리는가, 아니면 안에서 직렬화하는가?

이 답이 "동시"여야 프로젝트당 대화를 여러 개 나란히 돌릴 수 있다. 직렬화한다면
프런트에서 아무리 세션별로 갈라도 두 번째 턴은 첫 번째가 끝날 때까지 멎는다.

읽는 법: 두 세션의 첫 청크 시각과 **교차 여부**(A·B 청크가 번갈아 오는가).
직렬이면 B 의 첫 청크가 A 의 응답(id=10) 뒤에 온다.

안전장치: cwd 는 스크래치패드, 프롬프트는 도구가 필요 없는 세기,
session/request_permission 이 오면 무조건 거절한다.
"""
import json
import os
import subprocess
import threading
import time

CWD = os.path.dirname(os.path.abspath(__file__))
APP_DATA = os.path.expanduser(
    "~/Library/Application Support/com.kimhyunbin.ocul-pm"
)
ENTRY = os.path.join(
    APP_DATA, "acp", "node_modules",
    "@agentclientprotocol", "claude-agent-acp", "dist", "index.js",
)

proc = subprocess.Popen(
    ["node", ENTRY],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    text=True, bufsize=1, cwd=CWD,
)

lock = threading.Lock()
t0 = time.time()
sids = {}            # id -> sessionId
done = {}            # prompt id -> 끝난 시각
timeline = []        # (경과초, 세션라벨, 종류)
new_ready = threading.Event()
both_done = threading.Event()


def send(obj):
    with lock:
        proc.stdin.write(json.dumps(obj) + "\n")
        proc.stdin.flush()


def label(sid):
    for k, v in sids.items():
        if v == sid:
            return "A" if k == 2 else "B"
    return "?"


def on_line(line):
    if not line:
        return
    try:
        msg = json.loads(line)
    except json.JSONDecodeError:
        return

    # 에이전트 → 클라이언트 요청은 전부 거절 (도구를 쓸 일이 없어야 정상)
    if "method" in msg and "id" in msg:
        print(f"[REQ<-] {msg['method']}", flush=True)
        send({"jsonrpc": "2.0", "id": msg["id"],
              "result": {"outcome": {"outcome": "cancelled"}}})
        return

    if msg.get("method") == "session/update":
        params = msg["params"]
        u = params["update"]
        kind = u.get("sessionUpdate")
        if kind != "agent_message_chunk":
            return
        who = label(params.get("sessionId"))
        text = u.get("content", {}).get("text", "").replace("\n", "⏎")[:20]
        elapsed = time.time() - t0
        timeline.append((elapsed, who, text))
        print(f"[{elapsed:6.2f}s] {who}: {text}", flush=True)
        return

    if "id" in msg:
        mid = msg["id"]
        res = msg.get("result")
        if mid in (2, 3) and res:
            sids[mid] = res["sessionId"]
            if len(sids) == 2:
                new_ready.set()
        if mid in (10, 11):
            done[mid] = time.time() - t0
            print(f"[{done[mid]:6.2f}s] === {'A' if mid == 10 else 'B'} 턴 종료: "
                  f"{json.dumps(res or msg.get('error'))[:120]} ===", flush=True)
            if len(done) == 2:
                both_done.set()


threading.Thread(target=lambda: [on_line(l.strip()) for l in proc.stdout],
                 daemon=True).start()
threading.Thread(
    target=lambda: [print(f"[ERR] {l.rstrip()[:200]}", flush=True)
                    for l in proc.stderr],
    daemon=True).start()

send({"jsonrpc": "2.0", "id": 1, "method": "initialize",
      "params": {"protocolVersion": 1, "clientCapabilities": {"fs": {}}}})
send({"jsonrpc": "2.0", "id": 2, "method": "session/new",
      "params": {"cwd": CWD, "mcpServers": []}})
send({"jsonrpc": "2.0", "id": 3, "method": "session/new",
      "params": {"cwd": CWD, "mcpServers": []}})

if not new_ready.wait(timeout=90):
    print(f"[!!] session/new 실패 (받은 것: {sids})", flush=True)
else:
    print(f"[..] 두 세션 준비됨: A={sids[2][:12]}… B={sids[3][:12]}…", flush=True)
    t0 = time.time()
    # 거의 동시에 두 턴을 던진다 — 도구가 필요 없고 충분히 길게 흐르는 프롬프트.
    send({"jsonrpc": "2.0", "id": 10, "method": "session/prompt",
          "params": {"sessionId": sids[2],
                     "prompt": [{"type": "text",
                                 "text": "1부터 40까지 한 줄에 하나씩 세어 줘. 다른 말은 하지 마."}]}})
    send({"jsonrpc": "2.0", "id": 11, "method": "session/prompt",
          "params": {"sessionId": sids[3],
                     "prompt": [{"type": "text",
                                 "text": "A부터 Z까지 한 줄에 하나씩 적어 줘. 다른 말은 하지 마."}]}})
    both_done.wait(timeout=180)

proc.terminate()
try:
    proc.wait(timeout=5)
except subprocess.TimeoutExpired:
    proc.kill()

print("\n=== 판정 ===", flush=True)
first = {}
for elapsed, who, _ in timeline:
    first.setdefault(who, elapsed)
print(f"첫 청크: A={first.get('A')} B={first.get('B')}")
print(f"턴 종료: A={done.get(10)} B={done.get(11)}")

# 교차 = A 와 B 가 번갈아 나타난 횟수
order = [who for _, who, _ in timeline if who in ("A", "B")]
switches = sum(1 for i in range(1, len(order)) if order[i] != order[i - 1])
print(f"청크 {len(order)}건, A↔B 전환 {switches}회")
if switches >= 2:
    print("→ 동시 실행됨 (스트림이 교차한다)")
elif done.get(10) and first.get("B") and first["B"] > done[10]:
    print("→ 직렬화됨 (B 는 A 가 끝난 뒤에야 흐른다)")
else:
    print("→ 판단 불가 — 위 타임라인을 직접 보라")
