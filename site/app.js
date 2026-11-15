(() => {
  "use strict";

  // Paths tried in order on each app's own address when no "icon" is set.
  // These are the usual places a site keeps the icon shown in the browser tab.
  const ICON_PATHS = ["/apple-touch-icon.png", "/favicon.svg", "/favicon.png", "/favicon.ico"];
  const LETTER_COLORS = ["#e07a8b", "#7fb58f", "#e9a65a", "#7a9be0", "#b28be0", "#5fb3b3"];
  const PIN_KEY = "homepage-edit-pin";

  const $ = (sel) => document.querySelector(sel);
  const appsEl = $("#apps");
  const noticeEl = $("#notice");
  const editBar = $("#edit-bar");
  const editToggle = $("#edit-toggle");

  let config = { title: "", subtitle: "", openInNewTab: false, categories: [] };
  let editing = false;
  let pinRequired = false;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const storage = {
    get(k) { try { return sessionStorage.getItem(k) || ""; } catch { return ""; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } },
  };

  /* ---------- View ---------- */

  function greeting(hour) {
    if (hour >= 5 && hour < 10) return "God morgen!";
    if (hour >= 10 && hour < 17) return "Hei, hei!";
    if (hour >= 17 && hour < 23) return "God kveld!";
    return "God natt!";
  }

  function iconCandidates(app) {
    if (app.icon) return [app.icon];
    try {
      const origin = new URL(app.url).origin;
      return ICON_PATHS.map((p) => origin + p);
    } catch {
      return [];
    }
  }

  function letterColor(name) {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return LETTER_COLORS[h % LETTER_COLORS.length];
  }

  function makeTile(app) {
    const tile = el("span", "tile");
    tile.setAttribute("aria-hidden", "true");
    const showLetter = () => {
      tile.textContent = app.name.trim().charAt(0).toUpperCase();
      tile.classList.add("letter");
      tile.style.background = letterColor(app.name);
    };
    const candidates = iconCandidates(app);
    if (!candidates.length) {
      showLetter();
      return tile;
    }
    const img = el("img");
    img.alt = "";
    img.decoding = "async";
    let i = 0;
    img.addEventListener("error", () => {
      i += 1;
      if (i < candidates.length) img.src = candidates[i];
      else showLetter();
    });
    img.src = candidates[0];
    tile.append(img);
    return tile;
  }

  function makeCard(app, ci, ai, count) {
    const card = editing ? el("button", "card is-editing") : el("a", "card");
    if (editing) {
      card.type = "button";
      card.setAttribute("aria-label", `Rediger ${app.name}`);
      card.addEventListener("click", () => openAppForm(ci, ai));
    } else {
      card.href = app.url;
      if (config.openInNewTab) {
        card.target = "_blank";
        card.rel = "noopener";
      }
    }

    const text = el("span", "card-text");
    text.append(el("span", "card-name", app.name));
    if (app.description) text.append(el("span", "card-desc", app.description));
    card.append(makeTile(app), text);

    if (!editing) return card;

    const wrap = el("div", "card-wrap");
    const tools = el("div", "card-tools");
    tools.append(
      iconButton("‹", `Flytt ${app.name} til venstre`, ai === 0, () => moveApp(ci, ai, -1)),
      iconButton("›", `Flytt ${app.name} til høyre`, ai === count - 1, () => moveApp(ci, ai, 1)),
    );
    wrap.append(card, tools);
    return wrap;
  }

  function iconButton(label, aria, disabled, onClick) {
    const b = el("button", "mini", label);
    b.type = "button";
    b.setAttribute("aria-label", aria);
    b.title = aria;
    b.disabled = disabled;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  function render() {
    const title = config.title || "Hjemme hos oss";
    $("#title").textContent = title;
    document.title = title;
    $("#subtitle").textContent = config.subtitle || "";
    document.body.classList.toggle("editing", editing);
    editBar.hidden = !editing;
    editToggle.hidden = editing;

    appsEl.textContent = "";
    const cats = config.categories;
    cats.forEach((cat, ci) => {
      if (!editing && !cat.apps.length) return;
      const section = el("section", "category");
      const head = el("div", "category-head");
      head.append(el("h2", null, cat.name));
      if (editing) {
        const tools = el("div", "category-tools");
        tools.append(
          iconButton("↑", `Flytt ${cat.name} opp`, ci === 0, () => moveCategory(ci, -1)),
          iconButton("↓", `Flytt ${cat.name} ned`, ci === cats.length - 1, () => moveCategory(ci, 1)),
          iconButton("✎", `Gi ${cat.name} nytt navn`, false, () => openCategoryForm(ci)),
        );
        head.append(tools);
      }
      section.append(head);

      const grid = el("div", "grid");
      cat.apps.forEach((app, ai) => grid.append(makeCard(app, ci, ai, cat.apps.length)));
      if (editing) {
        const add = el("button", "card add-card");
        add.type = "button";
        add.append(el("span", "tile add-tile", "+"), el("span", "card-name", "Legg til app"));
        add.addEventListener("click", () => openAppForm(ci, -1));
        grid.append(add);
      }
      section.append(grid);
      appsEl.append(section);
    });

    const hasApps = cats.some((c) => c.apps.length);
    if (!editing && !hasApps) {
      showNotice("Ingen apper ennå. Trykk på blyanten nede i hjørnet for å legge til den første.");
    } else {
      noticeEl.hidden = true;
    }
  }

  function showNotice(text) {
    noticeEl.textContent = text;
    noticeEl.hidden = false;
  }

  /* ---------- Saving ---------- */

  let toastTimer;
  function toast(text, isError) {
    const t = $("#toast");
    t.textContent = text;
    t.classList.toggle("is-error", !!isError);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 5000 : 1800);
  }

  async function save(next) {
    const res = await fetch("api/apps", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Edit-Pin": storage.get(PIN_KEY) },
      body: JSON.stringify(next),
    }).catch(() => null);
    if (!res) throw new Error("Fikk ikke kontakt med serveren. Prøv igjen.");
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) {
      storage.set(PIN_KEY, "");
      throw new Error("PIN-koden stemmer ikke lenger. Trykk Ferdig og lås opp på nytt.");
    }
    if (!res.ok) throw new Error(body.error || `Kunne ikke lagre (${res.status}).`);
    config = body;
    render();
    toast("Lagret");
  }

  // Apply a change to a copy of the config and save it. The page only updates
  // once the server has accepted the change, so it never shows unsaved state.
  async function change(mutate) {
    const next = structuredClone(config);
    mutate(next);
    try {
      await save(next);
      return true;
    } catch (err) {
      toast(err.message, true);
      return false;
    }
  }

  const swap = (arr, i, j) => { [arr[i], arr[j]] = [arr[j], arr[i]]; };
  const moveApp = (ci, ai, d) => change((c) => swap(c.categories[ci].apps, ai, ai + d));
  const moveCategory = (ci, d) => change((c) => swap(c.categories, ci, ci + d));

  /* ---------- Dialog ---------- */

  const dialog = $("#dialog");
  const form = $("#dialog-form");
  const fieldsEl = $("#dialog-fields");
  const errorEl = $("#dialog-error");
  const deleteBtn = $("#dialog-delete");
  let current = null;

  function openForm(opts) {
    current = opts;
    $("#dialog-title").textContent = opts.title;
    $("#dialog-save").textContent = opts.saveLabel || "Lagre";
    fieldsEl.textContent = "";
    errorEl.hidden = true;

    for (const f of opts.fields) {
      const id = `field-${f.id}`;
      const row = el("div", f.type === "checkbox" ? "field field-check" : "field");
      const label = el("label", null, f.label);
      label.htmlFor = id;
      let input;
      if (f.type === "select") {
        input = el("select");
        f.options.forEach((o, i) => {
          const opt = el("option", null, o);
          opt.value = String(i);
          input.append(opt);
        });
        input.value = String(f.value);
      } else {
        input = el("input");
        input.type = f.type || "text";
        if (f.type === "checkbox") input.checked = !!f.value;
        else input.value = f.value || "";
        if (f.placeholder) input.placeholder = f.placeholder;
        if (f.autocomplete) input.autocomplete = f.autocomplete;
      }
      input.id = id;
      input.name = f.id;
      if (f.type === "checkbox") row.append(input, label);
      else row.append(label, input);
      if (f.help) row.append(el("small", "help", f.help));
      fieldsEl.append(row);
    }

    deleteBtn.hidden = !opts.onDelete;
    deleteBtn.textContent = opts.deleteLabel || "Slett";
    deleteBtn.classList.remove("is-confirming");
    dialog.showModal();
    const first = fieldsEl.querySelector("input, select");
    if (first) first.focus();
  }

  function formValues() {
    const out = {};
    for (const f of current.fields) {
      const input = form.elements[f.id];
      out[f.id] = f.type === "checkbox" ? input.checked : input.value.trim();
    }
    return out;
  }

  function formError(text) {
    errorEl.textContent = text;
    errorEl.hidden = false;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const values = formValues();
    const problem = current.validate ? current.validate(values) : null;
    if (problem) return formError(problem);
    const saveBtn = $("#dialog-save");
    saveBtn.disabled = true;
    const ok = await current.onSave(values);
    saveBtn.disabled = false;
    if (ok !== false) dialog.close();
  });

  $("#dialog-cancel").addEventListener("click", () => dialog.close());

  // Two-step delete: the first click asks, the second deletes.
  deleteBtn.addEventListener("click", async () => {
    if (!deleteBtn.classList.contains("is-confirming")) {
      deleteBtn.classList.add("is-confirming");
      deleteBtn.textContent = current.confirmLabel || "Ja, slett";
      return;
    }
    const ok = await current.onDelete();
    if (ok !== false) dialog.close();
  });

  const urlProblem = (v) => (/^https?:\/\/\S+$/i.test(v) ? null : "Adressen må starte med http:// eller https://");

  function openAppForm(ci, ai) {
    const isNew = ai < 0;
    const app = isNew ? {} : config.categories[ci].apps[ai];
    openForm({
      title: isNew ? "Ny app" : `Rediger ${app.name}`,
      fields: [
        { id: "name", label: "Navn", value: app.name, placeholder: "Immich" },
        { id: "url", label: "Adresse", type: "url", value: app.url, placeholder: "https://immich.hjemme.lan" },
        { id: "description", label: "Beskrivelse", value: app.description, placeholder: "Bilder og videoer fra familien" },
        { id: "category", label: "Kategori", type: "select", value: ci, options: config.categories.map((c) => c.name) },
        {
          id: "icon", label: "Eget ikon (valgfritt)", value: app.icon, placeholder: "https://…/logo.png",
          help: "La stå tomt for å bruke ikonet fra nettleserfanen til appen.",
        },
      ],
      validate: (v) => (!v.name ? "Appen trenger et navn." : urlProblem(v.url)),
      onSave: (v) => change((c) => {
        const item = { name: v.name, url: v.url };
        if (v.description) item.description = v.description;
        if (v.icon) item.icon = v.icon;
        const target = Number(v.category);
        if (!isNew && target === ci) {
          c.categories[ci].apps[ai] = item;
          return;
        }
        if (!isNew) c.categories[ci].apps.splice(ai, 1);
        c.categories[target].apps.push(item);
      }),
      onDelete: isNew ? null : () => change((c) => c.categories[ci].apps.splice(ai, 1)),
      confirmLabel: `Ja, slett ${app.name || ""}`.trim(),
    });
  }

  function openCategoryForm(ci) {
    const isNew = ci < 0;
    const cat = isNew ? { name: "", apps: [] } : config.categories[ci];
    const n = cat.apps.length;
    openForm({
      title: isNew ? "Ny kategori" : "Endre kategori",
      fields: [{ id: "name", label: "Navn", value: cat.name, placeholder: "Underholdning" }],
      validate: (v) => (v.name ? null : "Kategorien trenger et navn."),
      onSave: (v) => change((c) => {
        if (isNew) c.categories.push({ name: v.name, apps: [] });
        else c.categories[ci].name = v.name;
      }),
      onDelete: isNew ? null : () => change((c) => c.categories.splice(ci, 1)),
      deleteLabel: "Slett kategori",
      confirmLabel: n ? `Ja, slett med ${n} ${n === 1 ? "app" : "apper"}` : "Ja, slett",
    });
  }

  function openHeadingForm() {
    openForm({
      title: "Overskrift",
      fields: [
        { id: "title", label: "Tittel", value: config.title, placeholder: "Hjemme hos oss" },
        { id: "subtitle", label: "Undertittel", value: config.subtitle },
        { id: "openInNewTab", label: "Åpne apper i ny fane", type: "checkbox", value: config.openInNewTab },
      ],
      onSave: (v) => change((c) => {
        c.title = v.title;
        c.subtitle = v.subtitle;
        c.openInNewTab = v.openInNewTab;
      }),
    });
  }

  /* ---------- Edit mode ---------- */

  function setEditing(on) {
    editing = on;
    render();
    if (on && !config.categories.length) openCategoryForm(-1);
  }

  editToggle.addEventListener("click", () => {
    if (!pinRequired || storage.get(PIN_KEY)) return setEditing(true);
    openForm({
      title: "Skriv inn PIN-kode",
      saveLabel: "Lås opp",
      fields: [{ id: "pin", label: "PIN-kode", type: "password", autocomplete: "off" }],
      onSave: async (v) => {
        const res = await fetch("api/unlock", { method: "POST", headers: { "X-Edit-Pin": v.pin } }).catch(() => null);
        if (!res || !res.ok) {
          formError(res && res.status === 401 ? "Feil PIN-kode." : "Fikk ikke kontakt med serveren.");
          return false;
        }
        storage.set(PIN_KEY, v.pin);
        setTimeout(() => setEditing(true));
      },
    });
  });

  $("#edit-done").addEventListener("click", () => setEditing(false));
  $("#add-category").addEventListener("click", () => openCategoryForm(-1));
  $("#edit-heading").addEventListener("click", openHeadingForm);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && editing && !dialog.open) setEditing(false);
  });

  /* ---------- Start ---------- */

  const now = new Date();
  $("#greeting").textContent = greeting(now.getHours());
  $("#today").textContent = now.toLocaleDateString("nb-NO", { weekday: "long", day: "numeric", month: "long" });

  fetch("api/settings", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : {}))
    .then((s) => { pinRequired = !!s.pinRequired; })
    .catch(() => {});

  fetch("apps.json", { cache: "no-store" })
    .then((r) => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    })
    .then((data) => {
      config = {
        title: data.title || "",
        subtitle: data.subtitle || "",
        openInNewTab: !!data.openInNewTab,
        categories: (data.categories || []).map((c) => ({ name: c.name || "", apps: c.apps || [] })),
      };
      render();
    })
    .catch(() => showNotice("Fikk ikke hentet app-listen fra serveren."));
})();
