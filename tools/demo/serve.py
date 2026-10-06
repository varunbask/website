"""Serves the demo build without caching, so every reload shows the latest files.

    python3 tools/demo/serve.py [port] [dir]
"""
import functools
import http.server
import sys

port = int(sys.argv[1]) if len(sys.argv) > 1 else 4180
folder = sys.argv[2] if len(sys.argv) > 2 else '.demo'


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, *args):
        pass


handler = functools.partial(NoCache, directory=folder)
print(f'demo on http://localhost:{port}/ (portal: /portal/staff.html?as=admin)')
http.server.ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever()
