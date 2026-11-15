"""Small web server for the family homepage.

Serves the static files in ./site, serves the app list from DATA_DIR/apps.json,
and saves edits made on the page (PUT /api/apps). Standard library only.
"""

import base64
import json
import os
import shutil
import ssl
import tempfile
import time
import urllib.parse
import urllib.request
from html.parser import HTMLParser
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
            icon = _text(app.get("icon"), "Ikon", 20000)
            if icon:
                low = icon.lower()
                is_link = low.startswith(("http://", "https://", "data:image/")) or icon.startswith("icons/")
                is_emoji = len(icon) <= 8 and not any(c in icon for c in "<>:/\\\"'")
                if not (is_link or is_emoji):
                    raise InvalidConfig("Ikon må være en emoji, en bildeadresse eller en data:image-adresse")
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


class _IconLinks(HTMLParser):
    """Collect <link rel="...icon..."> tags from a page's HTML."""

    def __init__(self):
        super().__init__()
        self.found = []

    def handle_starttag(self, tag, attrs):
        if tag != "link":
            return
        a = {k.lower(): (v or "") for k, v in attrs}
        rels = a.get("rel", "").lower().split()
        if "icon" in rels or "apple-touch-icon" in rels:
            if a.get("href"):
                self.found.append((rels, a.get("sizes", ""), a.get("type", ""), a["href"]))


def _icon_score(rels, sizes, mime, href):
    if "apple-touch-icon" in rels:
        return 3000
    if "svg" in mime or href.lower().split("?")[0].endswith(".svg"):
        return 2000
    best = 0
    for part in sizes.lower().split():
        w = part.split("x")[0]
        if w.isdigit():
            best = max(best, int(w))
    return 1000 + best


def _fetch(url, limit):
    req = urllib.request.Request(url, headers={"User-Agent": "homepage-icon-finder"})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.geturl(), r.read(limit)
    except urllib.error.URLError as e:
        # Home servers often use self-signed certificates. We only read the
        # page to find where its icon is, so retry without verification.
        if not isinstance(getattr(e, "reason", None), ssl.SSLError):
            raise
        ctx = ssl._create_unverified_context()
        with urllib.request.urlopen(req, timeout=5, context=ctx) as r:
            return r.geturl(), r.read(limit)


_icon_cache = {}
ICON_CACHE_SECONDS = 6 * 3600


def find_icon(page_url):
    """Return the absolute URL of the icon a page declares, or None."""
    hit = _icon_cache.get(page_url)
    if hit and hit[0] > time.time():
        return hit[1]
    icon = None
    try:
        final_url, body = _fetch(page_url, 512 * 1024)
        parser = _IconLinks()
        parser.feed(body.decode("utf-8", "replace"))
        if parser.found:
            best = max(parser.found, key=lambda f: _icon_score(*f))
            icon = urllib.parse.urljoin(final_url, best[3].strip())
        else:
            print(f"Icon lookup: no <link rel=icon> on {final_url}", flush=True)
    except Exception as e:
        print(f"Icon lookup: could not read {page_url}: {e}", flush=True)
        icon = None
    _icon_cache[page_url] = (time.time() + (ICON_CACHE_SECONDS if icon else 300), icon)
    return icon


def known_app_urls():
    try:
        data = json.loads(APPS_FILE.read_text(encoding="utf-8"))
        return {a.get("url") for c in data.get("categories", []) for a in c.get("apps", [])}
    except (OSError, ValueError, AttributeError):
        return set()


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
        elif path == "/api/icon":
            self._icon()
        elif path == "/api/settings":
            self._json(200, {"pinRequired": bool(EDIT_PIN)})
        elif path.endswith("/") and path != "/":
            self.send_error(404)
        else:
            super().do_GET()

    def _icon(self):
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        page_url = (query.get("url") or [""])[0]
        # Only look up apps that are on the page, so this can't fetch arbitrary URLs.
        if not page_url or page_url not in known_app_urls():
            return self.send_error(404)
        icon = find_icon(page_url)
        if not icon:
            return self.send_error(404)
        if icon.startswith("data:"):
            header, _, payload = icon.partition(",")
            mime = header[5:].split(";")[0] or "image/png"
            if not mime.startswith("image/"):
                return self.send_error(404)
            try:
                raw = base64.b64decode(payload) if ";base64" in header else urllib.parse.unquote_to_bytes(payload)
            except ValueError:
                return self.send_error(404)
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "max-age=3600")
            self.end_headers()
            self.wfile.write(raw)
            return
        if not icon.lower().startswith(("http://", "https://")):
            return self.send_error(404)
        self.send_response(302)
        self.send_header("Location", icon)
        self.send_header("Cache-Control", "max-age=3600")
        self.send_header("Content-Length", "0")
        self.end_headers()

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
