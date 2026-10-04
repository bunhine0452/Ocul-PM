"""codex app-server 최소 클라이언트 — 스파이크.

A 단계: thread/start → 셸 명령이 필요한 turn → 승인 요청이 오면 **응답하지 않고**
        프로세스를 죽인다 (앱이 승인 대기 중에 꺼진 상황).
B 단계: 새 app-server → thread/resume → 같은 스레드에 "승인됨, 계속" turn →
        이번 승인 요청엔 accept → turn/completed 까지 → 파일 생성 확인.
"""
import asyncio, json, os, subprocess, sys, tempfile, time

# 작업 폴더·로그는 임시 폴더에 — 저장소를 더럽히지 않는다. SPIKE_WORK 로 지정 가능.
WORK = os.environ.get("SPIKE_WORK") or tempfile.mkdtemp(prefix="codex-spike-")
ROOT = WORK
subprocess.run(["git", "init", "-q"], cwd=WORK, check=False)
LOG = open(os.path.join(ROOT, "events.log"), "a")
T0 = time.time()


def log(tag, obj):
    line = f"[{time.time()-T0:7.2f}] {tag} {json.dumps(obj, ensure_ascii=False)[:600]}"
    LOG.write(line + "\n"); LOG.flush()
    print(line, flush=True)


class Client:
    def __init__(self):
        self.next_id = 1
        self.pending = {}
        self.server_requests = asyncio.Queue()
        self.notes = asyncio.Queue()

    async def start(self):
        self.proc = await asyncio.create_subprocess_exec(
            "codex", "app-server", cwd=WORK,
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=open(os.path.join(ROOT, "stderr.log"), "a"),
            limit=16 * 1024 * 1024,
        )
        self.reader = asyncio.create_task(self._read())

    async def _read(self):
        while True:
            raw = await self.proc.stdout.readline()
            if not raw:
                return
            msg = json.loads(raw)
            if "id" in msg and "method" in msg:          # 서버 → 클라이언트 요청
                await self.server_requests.put(msg)
            elif "id" in msg:                             # 내 요청의 응답
                fut = self.pending.pop(msg["id"], None)
                if fut: fut.set_result(msg)
            else:                                         # 알림
                await self.notes.put(msg)

    def _send(self, obj):
        self.proc.stdin.write((json.dumps(obj) + "\n").encode())

    async def request(self, method, params):
        rid = self.next_id; self.next_id += 1
        fut = asyncio.get_running_loop().create_future()
        self.pending[rid] = fut
        self._send({"jsonrpc": "2.0", "id": rid, "method": method, "params": params})
        await self.proc.stdin.drain()
        msg = await asyncio.wait_for(fut, 60)
        if "error" in msg:
            raise RuntimeError(f"{method}: {msg['error']}")
        return msg["result"]

    async def notify(self, method, params=None):
        self._send({"jsonrpc": "2.0", "method": method, **({"params": params} if params is not None else {})})
        await self.proc.stdin.drain()

    async def respond(self, rid, result):
        self._send({"jsonrpc": "2.0", "id": rid, "result": result})
        await self.proc.stdin.drain()

    async def init(self):
        r = await self.request("initialize", {
            "clientInfo": {"name": "ocul_pm_spike", "title": "Ocul-PM spike", "version": "0.0.1"},
            "capabilities": {"experimentalApi": True},
        })
        log("initialize.result", r)
        await self.notify("initialized")

    async def kill(self):
        self.proc.kill()
        await self.proc.wait()


async def pump_until(c, *, on_request, done_methods, timeout):
    """알림·서버 요청을 받아 로그. done_methods 중 하나가 오면 그 메시지 반환."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        get_n = asyncio.create_task(c.notes.get())
        get_r = asyncio.create_task(c.server_requests.get())
        done, rest = await asyncio.wait({get_n, get_r}, timeout=deadline - time.time(),
                                        return_when=asyncio.FIRST_COMPLETED)
        for t in rest: t.cancel()
        for t in done:
            msg = t.result()
            if t is get_r:
                log("SERVER_REQUEST", msg)
                stop = await on_request(msg)
                if stop:
                    return ("request", msg)
            else:
                m = msg["method"]
                if m not in ("item/agentMessage/delta", "item/reasoning/textDelta",
                             "item/reasoning/summaryTextDelta", "item/commandExecution/outputDelta"):
                    log("note", msg)
                if m in done_methods:
                    return ("note", msg)
    raise TimeoutError("pump timeout")


async def phase_a():
    c = Client(); await c.start(); await c.init()
    th = await c.request("thread/start", {"cwd": WORK, "approvalPolicy": "untrusted", "sandbox": "read-only"})
    thread_id = th["thread"]["id"]
    log("thread/start.result", {"threadId": thread_id, "keys": list(th.keys())})
    await c.request("turn/start", {"threadId": thread_id, "input": [{"type": "text", "text":
        "Run exactly this shell command in the current directory: touch spike_ok.txt . Then reply with the single word DONE."}]})

    async def on_req(msg):
        # 승인 요청이 오면 답하지 않고 멈춘다 — 앱이 이 상태로 꺼진다고 가정.
        return msg["method"].endswith("requestApproval") or msg["method"] in ("execCommandApproval", "applyPatchApproval")

    kind, msg = await pump_until(c, on_request=on_req, done_methods={"turn/completed"}, timeout=180)
    log("PHASE_A_STOP", {"kind": kind, "method": msg["method"]})
    await c.kill()
    log("PHASE_A_KILLED", {"threadId": thread_id})
    return thread_id


async def phase_b(thread_id):
    c = Client(); await c.start(); await c.init()
    r = await c.request("thread/resume", {"threadId": thread_id, "cwd": WORK,
                                         "approvalPolicy": "untrusted", "sandbox": "read-only"})
    t = r.get("thread", {})
    log("thread/resume.result", {"id": t.get("id"), "status": t.get("status"),
                                  "turns": [(x.get("id"), x.get("status")) for x in (t.get("turns") or [])]})

    async def on_req(msg):
        m = msg["method"]
        if m == "item/commandExecution/requestApproval":
            await c.respond(msg["id"], {"decision": "accept"})
            log("APPROVED", {"command": msg["params"].get("command")})
        elif m == "item/fileChange/requestApproval":
            await c.respond(msg["id"], {"decision": "accept"})
        else:
            c._send({"jsonrpc": "2.0", "id": msg["id"], "error": {"code": -32601, "message": "spike: unsupported"}})
        return False

    await c.request("turn/start", {"threadId": thread_id, "input": [{"type": "text", "text":
        "The user approved the command you asked about earlier. Go ahead and run it now, then reply DONE."}]})
    kind, msg = await pump_until(c, on_request=on_req, done_methods={"turn/completed"}, timeout=240)
    log("PHASE_B_DONE", {"turn": msg["params"].get("turn", {}).get("status")})
    await c.kill()
    log("FILE_EXISTS", {"spike_ok.txt": os.path.exists(os.path.join(WORK, "spike_ok.txt"))})


async def main():
    tid = await phase_a()
    await asyncio.sleep(1)
    await phase_b(tid)

asyncio.run(main())
