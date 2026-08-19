#!/usr/bin/env python3
"""ACP 스파이크 3 — 파일 변경 감사(`agentFileChangeReport`) 실측 (어댑터 0.70.0+).

0.70.0 이 추가한 확장이다. 턴이 끝나기 직전 어댑터의 Stop 훅이 숨은
continuation 을 넣어 "이번 턴에 바꾼 워크스페이스 파일을 전부 신고하라"를
시키고, 그 결과가 `session_info_update` 의 `_meta` 로 온다.

이 스파이크가 확인하는 계약 3가지:
  1. initialize 에서 `_meta.jetbrains.air.capabilities` 에 능력을 광고해야 켜진다
  2. 프롬프트마다 `_meta.jetbrains.air.agentFileChangeReportRequest` 로 requestId 를 준다
  3. 결과가 `session_info_update._meta.jetbrains.air.agentFileChangeReport` 로 온다

안전장치: cwd 는 매번 새로 만드는 임시 디렉터리(끝나면 삭제), 프롬프트는 그
안에 파일 하나 만들기, 권한 요청은 **그 임시 디렉터리 안의 쓰기만** 허용한다.
"""
import json
import os
import shutil
import subprocess
import tempfile
import threading
import time

CWD = tempfile.mkdtemp(prefix="acp-fca-spike-")

proc = subprocess.Popen(
    ["npx", "-y", "@agentclientprotocol/claude-agent-acp@0.70.0"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    text=True, bufsize=1, cwd=CWD,
)

lock = threading.Lock()
done = threading.Event()
state = {"sid": None}
reports = []
kinds = []

REQUEST_ID = "spike-fca-1"


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
        return

    # 에이전트 → 클라이언트 요청. 권한은 첫 번째 allow 계열을 고른다
    # (cwd 가 임시 디렉터리라 파괴 범위가 없다).
    if "method" in msg and "id" in msg:
        params = msg.get("params") or {}
        options = params.get("options") or []
        allow = next(
            (o for o in options if "allow" in str(o.get("kind", "")).lower()
             or "allow" in str(o.get("optionId", "")).lower()),
            None,
        )
        if allow:
            print(f"[REQ<-] {msg['method']} → allow({allow.get('optionId')})", flush=True)
            send({"jsonrpc": "2.0", "id": msg["id"],
                  "result": {"outcome": {"outcome": "selected", "optionId": allow["optionId"]}}})
        else:
            print(f"[REQ<-] {msg['method']} → cancelled", flush=True)
            send({"jsonrpc": "2.0", "id": msg["id"],
                  "result": {"outcome": {"outcome": "cancelled"}}})
        return

    if msg.get("method") == "session/update":
        u = msg["params"]["update"]
        kind = u.get("sessionUpdate")
        kinds.append(kind)
        air = (((u.get("_meta") or {}).get("jetbrains") or {}).get("air") or {})
        report = air.get("agentFileChangeReport")
        if report is not None:
            reports.append(report)
            print(f"[REPORT] {json.dumps(report, ensure_ascii=False)}", flush=True)
        return

    if "id" in msg:
        res = msg.get("result")
        if msg["id"] == 2 and res:
            state["sid"] = res["sessionId"]
        if msg["id"] == 3:
            print(f"[RES] prompt 완료 {json.dumps(res or msg.get('error'))[:160]}", flush=True)
            done.set()


threading.Thread(target=lambda: [on_line(l.strip()) for l in proc.stdout], daemon=True).start()
threading.Thread(target=lambda: [None for _ in proc.stderr], daemon=True).start()

# 1) 능력 광고 — 이게 없으면 어댑터는 감사 자체를 켜지 않는다.
send({"jsonrpc": "2.0", "id": 1, "method": "initialize",
      "params": {"protocolVersion": 1,
                 "clientCapabilities": {
                     "fs": {},
                     "_meta": {"jetbrains": {"air": {
                         "version": 1,
                         "capabilities": ["agentFileChangeReport"],
                     }}},
                 }}})
send({"jsonrpc": "2.0", "id": 2, "method": "session/new",
      "params": {"cwd": CWD, "mcpServers": []}})

for _ in range(60):
    if state["sid"]:
        break
    time.sleep(0.5)

if not state["sid"]:
    print("[!!] session/new 실패", flush=True)
else:
    # 2) 프롬프트에 requestId 를 싣는다 (키는 정확히 version·requestId 둘뿐이어야 한다).
    send({"jsonrpc": "2.0", "id": 3, "method": "session/prompt",
          "params": {"sessionId": state["sid"],
                     "prompt": [{"type": "text",
                                 "text": "이 폴더에 spike.txt 파일을 만들고 hello 라고만 써. 설명하지 마."}],
                     "_meta": {"jetbrains": {"air": {
                         "agentFileChangeReportRequest": {"version": 1, "requestId": REQUEST_ID},
                     }}}}})
    done.wait(timeout=180)
    # 보고는 프롬프트 응답 직전/직후에 올 수 있어 잠깐 더 기다린다.
    for _ in range(20):
        if reports:
            break
        time.sleep(0.5)

proc.terminate()
try:
    proc.wait(timeout=5)
except subprocess.TimeoutExpired:
    proc.kill()

created = sorted(os.listdir(CWD))
shutil.rmtree(CWD, ignore_errors=True)

seen = []
for k in kinds:
    if k not in seen:
        seen.append(k)

print("\n=== 결과 ===")
print(f"실제로 만들어진 파일: {created}")
print(f"관측된 sessionUpdate 종류: {seen}")
print(f"파일 변경 보고 {len(reports)}건:")
for r in reports:
    print(f"  {json.dumps(r, ensure_ascii=False)}")
ok = any(r.get("requestId") == REQUEST_ID for r in reports)
print(f"\n계약 확인: requestId 일치 보고 {'있음 ✓' if ok else '없음 ✗'}")
