"""Small web server for the family homepage.

Serves the static files in ./site, serves the app list from DATA_DIR/apps.json,
and saves edits made on the page (PUT /api/apps). Standard library only.
"""

import json
import os
import shutil
import tempfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SITE_DIR = ROOT / "site"
DEFAULT_APPS = ROOT / "default-apps.json"
DATA_DIR = Path(os.environ.get("DATA_DIR", ROOT / "data"))
APPS_FILE = DATA_DIR / "apps.json"
EDIT_PIN = os.environ.get("EDIT_PIN", "").strip()
PORT = int(os.environ.get("PORT", "8080"))
MAX_BODY = 256 * 1024


class InvalidConfig(ValueError):
    pass


def _text(value, field, limit, required=False):
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise InvalidConfig(f"{field} må være tekst")
    value = value.strip()
    if required and not value:
        raise InvalidConfig(f"{field} mangler")
    if len(value) > limit:
        raise InvalidConfig(f"{field} er for lang")
    return value


def _link(value, field):
    value = _text(value, field, 2000, required=True)
    if not value.lower().startswith(("http://", "https://")):
        raise InvalidConfig(f"{field} må starte med http:// eller https://")
    return value


def clean_config(data):
    """Validate an edited config and return a tidy copy, or raise InvalidConfig."""
    if not isinstance(data, dict):
        raise InvalidConfig("Ugyldig format")
    cats = data.get("categories")
    if not isinstance(cats, list) or len(cats) > 50:
        raise InvalidConfig("Ugyldige kategorier")

    out = {
        "title": _text(data.get("title"), "Tittel", 120),
        "subtitle": _text(data.get("subtitle"), "Undertittel", 300),
        "openInNewTab": bool(data.get("openInNewTab")),
        "categories": [],
    }
    for cat in cats:
        if not isinstance(cat, dict) or not isinstance(cat.get("apps", []), list):
            raise InvalidConfig("Ugyldig kategori")
        apps = []
        for app in cat.get("apps", [])[:200]:
            if not isinstance(app, dict):
                raise InvalidConfig("Ugyldig app")
            item = {
                "name": _text(app.get("name"), "Navn", 80, required=True),
                "url": _link(app.get("url"), "Adresse"),
            }
            desc = _text(app.get("description"), "Beskrivelse", 200)
            if desc:
                item["description"] = desc
            icon = _text(app.get("icon"), "Ikon", 2000)
            if icon:
                if not (icon.lower().startswith(("http://", "https://")) or icon.startswith("icons/")):
                    raise InvalidConfig("Ikon må være en http(s)-adresse eller icons/filnavn")
                item["icon"] = icon
            apps.append(item)
        out["categories"].append(
            {"name": _text(cat.get("name"), "Kategorinavn", 60, required=True), "apps": apps}
        )
    return out


def ensure_data_file():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not APPS_FILE.exists():
        shutil.copyfile(DEFAULT_APPS, APPS_FILE)


def write_atomic(data):
    fd, tmp = tempfile.mkstemp(dir=DATA_DIR, prefix=".apps-", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, APPS_FILE)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(SITE_DIR), **kwargs)

    def log_message(self, fmt, *args):
        pass

    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/apps.json":
            body = APPS_FILE.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif path == "/api/settings":
            self._json(200, {"pinRequired": bool(EDIT_PIN)})
        elif path.endswith("/") and path != "/":
            self.send_error(404)
        else:
            super().do_GET()

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/api/unlock":
            return self._json(404, {"error": "Finnes ikke"})
        if EDIT_PIN and self.headers.get("X-Edit-Pin", "") != EDIT_PIN:
            return self._json(401, {"error": "Feil PIN-kode"})
        self._json(200, {"ok": True})

    def do_PUT(self):
        if self.path.split("?", 1)[0] != "/api/apps":
            return self._json(404, {"error": "Finnes ikke"})
        if EDIT_PIN and self.headers.get("X-Edit-Pin", "") != EDIT_PIN:
            return self._json(401, {"error": "Feil PIN-kode"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            return self._json(400, {"error": "Ugyldig størrelse"})
        try:
            data = clean_config(json.loads(self.rfile.read(length).decode("utf-8")))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return self._json(400, {"error": "Ugyldig JSON"})
        except InvalidConfig as e:
            return self._json(400, {"error": str(e)})
        write_atomic(data)
        self._json(200, data)


if __name__ == "__main__":
    ensure_data_file()
    print(f"Homepage on 0.0.0.0:{PORT}, data in {APPS_FILE}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
