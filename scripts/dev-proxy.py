#!/usr/bin/env python3
"""
Dev proxy — serves frontend static files and forwards /api/* to backend on port 3000.
Usage: python3 dev-proxy.py [port]
"""
import os, sys, shutil
from http.server import HTTPServer, SimpleHTTPRequestHandler
import urllib.request, urllib.error

BACKEND  = 'http://localhost:4827'
FRONTEND = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'frontend')


class DevHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=FRONTEND, **kwargs)

    def _proxy(self):
        url     = BACKEND + self.path
        length  = int(self.headers.get('Content-Length', 0))
        body    = self.rfile.read(length) if length else None
        headers = {k: v for k, v in self.headers.items()
                   if k.lower() not in ('host', 'content-length', 'transfer-encoding')}
        req = urllib.request.Request(url, data=body, headers=headers, method=self.command)
        try:
            with urllib.request.urlopen(req) as resp:
                self.send_response(resp.status)
                for k, v in resp.headers.items():
                    if k.lower() != 'transfer-encoding':
                        self.send_header(k, v)
                self.end_headers()
                shutil.copyfileobj(resp, self.wfile)
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            for k, v in e.headers.items():
                if k.lower() != 'transfer-encoding':
                    self.send_header(k, v)
            self.end_headers()
            shutil.copyfileobj(e, self.wfile)
        except Exception as ex:
            self.send_error(502, f'Backend unreachable: {ex}')

    def do_GET(self):
        if self.path.startswith('/api/'):
            self._proxy()
        else:
            super().do_GET()

    def do_POST(self):   self._proxy()
    def do_PUT(self):    self._proxy()
    def do_DELETE(self): self._proxy()

    def log_message(self, fmt, *args):
        print(f'  {self.command:6} {self.path}')


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    print(f'Dev proxy running on http://localhost:{port}')
    print(f'  Static: {FRONTEND}')
    print(f'  API:    {BACKEND}')
    HTTPServer(('', port), DevHandler).serve_forever()
