# Hjemme hos oss

En liten, koselig startside for appene vi hoster hjemme (Immich, matplan, økonomi,
brettspill osv.).

## Redigere apper og kategorier

Nede i høyre hjørne er det en nesten gjennomsiktig blyant. Trykk på den for å gå i
redigeringsmodus:

- **Trykk på et kort** for å endre navn, adresse, beskrivelse, kategori eller ikon,
  eller for å slette appen.
- **‹ ›** på kortene flytter appen. **↑ ↓** ved kategorinavnet flytter kategorien,
  og **✎** gir den nytt navn eller sletter den.
- **+ Legg til app** finnes nederst i hver kategori. **+ Ny kategori** og
  **Endre overskrift** ligger i linjen nederst.
- **Ferdig** (eller Esc) går tilbake til vanlig visning.

Hver endring lagres med en gang på serveren, så hele familien ser den.

Er `EDIT_PIN` satt, må man skrive PIN-koden før man kan redigere. Nettleseren husker
den til fanen lukkes.

### Ikoner

Uten eget ikon henter siden ikonet appen selv viser i nettleserfanen, direkte fra
appens egen adresse. Den prøver `/apple-touch-icon.png`, `/favicon.svg`, `/favicon.png`
og `/favicon.ico` i den rekkefølgen. Finner den ingen av dem, leser serveren appens
forside og bruker ikonet den oppgir i `<link rel="icon">`. Fungerer ikke det heller,
vises en farget forbokstav.
Blir et ikon feil eller uskarpt, kan du lime inn adressen til et annet bilde i feltet
«Eget ikon».

## Hvordan det henger sammen

- `site/`: selve siden (HTML, CSS, JS).
- `server.py`: en liten Python-server (kun standardbiblioteket). Den serverer siden,
  leser app-listen fra `/data/apps.json` og lagrer endringer dit.
- `default-apps.json`: startlisten som kopieres til `/data/apps.json` første gang.
  Senere endringer gjøres på siden, ikke i denne filen.

Kjøre lokalt:

```bash
DATA_DIR=./data PORT=8000 python3 server.py
```

## Deployment

Portainer stack from this repository, compose path `docker-compose.yml`.
Optional stack environment variable: `EDIT_PIN` (PIN code required to edit the page;
leave unset for no PIN).

The container `homepage` has no host port. It joins the external Docker network `proxy`
and serves plain HTTP on port 8080. Point Traefik at `http://homepage:8080`; Traefik
terminates HTTPS.

The app list is stored in `/opt/homepage/apps.json` on the host, so edits survive
redeploys. Back up that file if you want to keep the list.

To update, use **Pull and redeploy** on the stack.
