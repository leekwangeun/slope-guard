"""Serve this folder over http and open index.html in the browser.

Opening index.html straight from the folder (file://) does not work, because the
browser refuses to load app/*.js from a file address. This small server fixes that.
Exports from the blueprint screen (GLB, STL, PNG) are saved into out/.

usage: python serve.py [port] [--no-browser] [--lan]
  --lan  also accept phones on the same network (Wi-Fi or Tailscale); saving stays local only
"""
import http.server
import os
import re
import socket
import sys
import threading
import urllib.parse
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "out")
NAME_OK = re.compile(r"[\w.-]{1,80}\.(glb|gltf|stl|obj|ply|png|jpg|json)")
MAX_BYTES = 200 * 1024 * 1024

args = [a for a in sys.argv[1:] if not a.startswith("--")]
PORT = int(args[0]) if args else 8765
OPEN_BROWSER = "--no-browser" not in sys.argv
LAN = "--lan" in sys.argv


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")  # always serve the latest edit
        super().end_headers()

    def log_message(self, fmt, *a):
        pass  # keep the window quiet, only errors and saves are printed

    def do_POST(self):
        url = urllib.parse.urlparse(self.path)
        if url.path != "/save":
            return self.send_error(404)
        if self.client_address[0] not in ("127.0.0.1", "::1"):
            return self.send_error(403, "saving works only on this computer")
        name = urllib.parse.parse_qs(url.query).get("name", [""])[0]
        if not NAME_OK.fullmatch(name):
            return self.send_error(400, "bad file name")
        size = int(self.headers.get("Content-Length", 0))
        if not 0 < size <= MAX_BYTES:
            return self.send_error(400, "bad size")
        os.makedirs(OUT, exist_ok=True)
        with open(os.path.join(OUT, name), "wb") as f:
            f.write(self.rfile.read(size))
        print(f"saved out/{name} ({size:,} bytes)", flush=True)
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write(b"ok")


class Server(http.server.ThreadingHTTPServer):
    # On Windows, address reuse would let two servers share one port, so a busy port must fail
    allow_reuse_address = False


def start(port):
    host = "0.0.0.0" if LAN else "127.0.0.1"
    for p in range(port, port + 20):
        try:
            return Server((host, p), Handler)
        except OSError:
            continue  # port taken (an earlier window may still be open), try the next one
    sys.exit(f"no free port between {port} and {port + 19}")


def lan_addresses():
    """This computer's addresses that a phone on the same network can reach."""
    found = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith(("127.", "169.254.")) and ip not in found:
                found.append(ip)
    except OSError:
        pass
    return found


server = start(PORT)
port = server.server_address[1]
url = f"http://127.0.0.1:{port}/"
print(f"Slope Guard: {url}", flush=True)
if LAN:
    for ip in lan_addresses():
        print(f"  on a phone: http://{ip}:{port}/", flush=True)
if OPEN_BROWSER:
    threading.Timer(0.5, webbrowser.open, [url]).start()
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
