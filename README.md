# Hjemme hos oss

En liten, koselig startside for appene vi hoster hjemme (Immich, matplan, økonomi,
brettspill osv.). Ren HTML/CSS/JS servert av nginx, uten byggesteg.

## Legge til eller endre apper

Alt står i [`site/apps.json`](site/apps.json):

```json
{
  "title": "Hjemme hos oss",
  "subtitle": "Alt vi har på serveren hjemme, samlet på ett sted.",
  "openInNewTab": false,
  "categories": [
    {
      "name": "Minner",
      "apps": [
        { "name": "Immich", "description": "Bilder og videoer", "url": "https://immich.example.lan" }
      ]
    }
  ]
}
```

Bytt ut `example.lan`-adressene med de ekte adressene deres.

| Felt | Betydning |
| --- | --- |
| `name` | Navnet på kortet (påkrevd) |
| `url` | Adressen appen åpnes på (påkrevd) |
| `description` | Kort tekst under navnet |
| `icon` | Valgfritt eget ikon, f.eks. `icons/immich.png` eller en full URL |
| `keywords` | Valgfrie ekstra søkeord, f.eks. `["bilder", "foto"]` |

### Ikoner

Uten `icon` henter siden ikonet appen selv viser i nettleserfanen, direkte fra appens
egen adresse. Den prøver `/apple-touch-icon.png`, `/favicon.svg`, `/favicon.png` og
`/favicon.ico` i den rekkefølgen, og viser en farget forbokstav hvis ingen finnes.

Hvis en app har ikonet sitt et annet sted (eller ikonet blir uskarpt), legg en bildefil i
`site/icons/` og pek på den med `"icon": "icons/navn.png"`.

## Bruk

- Skriv for å søke, og trykk **Enter** for å åpne første treff.
- Trykk **/** hvor som helst for å hoppe til søkefeltet, **Esc** for å tømme.
- Lyst og mørkt tema følger enheten.

## Kjøre lokalt

```bash
cd site && python3 -m http.server 8000
```

## Deployment

Portainer stack from this repository, compose path `docker-compose.yml`.
No stack environment variables are needed.

The container `homepage` has no host port. It joins the external Docker network `proxy`
and serves plain HTTP on port 8080. Point Traefik at `http://homepage:8080`; Traefik
terminates HTTPS.

To update, use **Pull and redeploy** on the stack.

Vil dere endre app-listen uten å redeploye, kan dere fjerne kommentaren foran
`volumes:` i `docker-compose.yml` og legge `apps.json` (og eventuelt `icons/`) i
`/opt/homepage/` på serveren.
