#!/usr/bin/env python3
"""Optional local server for the ant farm: lets the colony follow your computer's load and keeps it across reloads.

    python3 server.py            # then open http://127.0.0.1:8978/
    python3 server.py --port 9000 --bind 0.0.0.0

The page works without it too (open it from any static web server: the colony is kept in the browser's
localStorage and the ants keep a gentle rhythm of their own). With it:

  GET  /            index.html
  GET  /load.json   {"t", "cpu": {"util"}, "gpus": [{"index", "name", "util", "power", "limit"}], "heat"}
  GET  /state       the saved colony (404 until the page first saves it)
  POST /state       the page saves its colony every 2 minutes (JSON, at most 2 MB) into ./state/

heat (0..1) = the busiest of: CPU use, and for each NVIDIA GPU (if nvidia-smi is installed) its use and its power
against its limit. The busier the machine, the more ants are awake and the faster they dig.
CPU use comes from /proc/stat on Linux; elsewhere from the load average divided by the number of cores.
Standard library only; Python 3.8+.
"""
import argparse
import http.server
import json
import os
import shutil
import socketserver
import subprocess
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
STATE_DIR = os.environ.get("ANT_FARM_STATE_DIR") or os.path.join(HERE, "state")
EVERY = 2.0
STATE = {"t": 0, "cpu": {}, "gpus": [], "heat": 0.0}
LOCK = threading.Lock()


def gpus():
    if not shutil.which("nvidia-smi"):
        return []
    q = "index,name,utilization.gpu,power.draw,power.limit"
    try:
        r = subprocess.run(["nvidia-smi", "--query-gpu=" + q, "--format=csv,noheader,nounits"],
                           capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return []
    out = []
    for line in r.stdout.strip().splitlines():
        f = [x.strip() for x in line.split(",")]
        if len(f) < 5:
            continue

        def num(x):
            try:
                return float(x)
            except ValueError:
                return 0.0
        out.append({"index": int(num(f[0])), "name": f[1], "util": num(f[2]), "power": num(f[3]), "limit": num(f[4])})
    return out


def cpu_times():
    try:
        with open("/proc/stat") as fh:
            v = [int(x) for x in fh.readline().split()[1:]]
        return sum(v), v[3] + v[4]
    except OSError:
        return None


def cpu_util(last):
    now = cpu_times()
    if now and last:
        dt, di = now[0] - last[0], now[1] - last[1]
        return (max(0.0, min(1.0, 1 - di / dt)) if dt > 0 else 0.0), now
    try:
        return max(0.0, min(1.0, os.getloadavg()[0] / (os.cpu_count() or 1))), now
    except (OSError, AttributeError):
        return 0.0, now


def loop():
    last = cpu_times()
    while True:
        time.sleep(EVERY)
        try:
            util, last = cpu_util(last)
            gs = gpus()
            heat = util
            for g in gs:
                heat = max(heat, g["util"] / 100.0, g["power"] / g["limit"] if g["limit"] else 0.0)
            with LOCK:
                STATE.update(t=round(time.time(), 1), cpu={"util": round(util, 3)}, gpus=gs, heat=round(min(1.0, heat), 3))
        except Exception as e:  # noqa: BLE001  keep serving the last reading
            print("sample failed: %s" % e, flush=True)


class Handler(http.server.BaseHTTPRequestHandler):
    def _send(self, code, body, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        path = self.path.partition("?")[0]
        if path in ("/", "/index.html"):
            with open(os.path.join(HERE, "index.html"), "rb") as f:
                self._send(200, f.read(), "text/html; charset=utf-8")
        elif path == "/load.json":
            with LOCK:
                body = json.dumps(STATE).encode()
            self._send(200, body, "application/json")
        elif path == "/state":
            try:
                with open(os.path.join(STATE_DIR, "ant-farm.json"), "rb") as f:
                    self._send(200, f.read(), "application/json")
            except OSError:
                self._send(404, b"no state yet", "text/plain")
        else:
            self._send(404, b"not found", "text/plain")

    def do_POST(self):  # noqa: N802
        if self.path.partition("?")[0] != "/state":
            return self._send(404, b"not found", "text/plain")
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > 2 * 1024 * 1024:
            return self._send(413, b"too large", "text/plain")
        body = self.rfile.read(n)
        try:
            if json.loads(body).get("v") != 1:
                raise ValueError("unknown version")
            os.makedirs(STATE_DIR, exist_ok=True)
            tmp = os.path.join(STATE_DIR, ".ant-farm.json.tmp")
            with open(tmp, "wb") as f:
                f.write(body)
            os.replace(tmp, os.path.join(STATE_DIR, "ant-farm.json"))
        except (ValueError, OSError, AttributeError):
            return self._send(400, b"bad state", "text/plain")
        self._send(204, b"", "text/plain")

    def log_message(self, format, *args):  # noqa: A002  quiet
        pass


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--port", type=int, default=8978)
    ap.add_argument("--bind", default="127.0.0.1")
    a = ap.parse_args()
    threading.Thread(target=loop, daemon=True).start()
    print("ant farm on http://%s:%d/" % (a.bind, a.port), flush=True)
    Server((a.bind, a.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
