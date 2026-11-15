(() => {
  "use strict";

  // Paths tried in order on each app's own address when no "icon" is set.
  // These are the usual places a site keeps the icon shown in the browser tab.
  const ICON_PATHS = [
    "/apple-touch-icon.png",
    "/favicon.svg",
    "/favicon.png",
    "/favicon.ico",
  ];

  const LETTER_COLORS = ["#e07a8b", "#7fb58f", "#e9a65a", "#7a9be0", "#b28be0", "#5fb3b3"];

  const $ = (sel) => document.querySelector(sel);
  const appsEl = $("#apps");
  const emptyEl = $("#empty");
  const searchEl = $("#search");

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
    const tile = document.createElement("span");
    tile.className = "tile";
    tile.setAttribute("aria-hidden", "true");

    const showLetter = () => {
      tile.textContent = "";
      tile.classList.add("letter");
      tile.style.background = letterColor(app.name);
      tile.textContent = app.name.trim().charAt(0).toUpperCase();
    };

    const candidates = iconCandidates(app);
    if (!candidates.length) {
      showLetter();
      return tile;
    }

    const img = document.createElement("img");
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

  function makeCard(app, newTab) {
    const a = document.createElement("a");
    a.className = "card";
    a.href = app.url;
    if (newTab) {
      a.target = "_blank";
      a.rel = "noopener";
    }
    a.dataset.search = [app.name, app.description || "", (app.keywords || []).join(" ")]
      .join(" ")
      .toLowerCase();

    const text = document.createElement("span");
    text.className = "card-text";

    const name = document.createElement("p");
    name.className = "card-name";
    name.textContent = app.name;
    text.append(name);

    if (app.description) {
      const desc = document.createElement("p");
      desc.className = "card-desc";
      desc.textContent = app.description;
      text.append(desc);
    }

    a.append(makeTile(app), text);
    return a;
  }

  function render(config) {
    if (config.title) {
      $("#title").textContent = config.title;
      document.title = config.title;
    }
    $("#subtitle").textContent = config.subtitle || "";

    appsEl.textContent = "";
    for (const cat of config.categories || []) {
      const section = document.createElement("section");
      section.className = "category";

      if (cat.name) {
        const h2 = document.createElement("h2");
        h2.textContent = cat.name;
        section.append(h2);
      }

      const grid = document.createElement("div");
      grid.className = "grid";
      for (const app of cat.apps || []) {
        if (app && app.name && app.url) grid.append(makeCard(app, !!config.openInNewTab));
      }
      section.append(grid);
      appsEl.append(section);
    }
    filter();
  }

  function filter() {
    const q = searchEl.value.trim().toLowerCase();
    let first = null;
    let any = false;

    for (const section of appsEl.querySelectorAll(".category")) {
      let shown = 0;
      for (const card of section.querySelectorAll(".card")) {
        const match = !q || card.dataset.search.includes(q);
        card.hidden = !match;
        card.classList.remove("is-first");
        if (match) {
          shown += 1;
          if (!first) first = card;
        }
      }
      section.hidden = shown === 0;
      any = any || shown > 0;
    }

    if (q && first) first.classList.add("is-first");
    emptyEl.hidden = any || !q;
    return first;
  }

  searchEl.addEventListener("input", filter);
  searchEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const first = filter();
      if (first && searchEl.value.trim()) first.click();
    } else if (e.key === "Escape") {
      searchEl.value = "";
      filter();
      searchEl.blur();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== searchEl) {
      e.preventDefault();
      searchEl.focus();
    }
  });

  const now = new Date();
  $("#greeting").textContent = greeting(now.getHours());
  $("#today").textContent = now.toLocaleDateString("nb-NO", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  fetch("apps.json", { cache: "no-store" })
    .then((r) => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    })
    .then(render)
    .catch(() => {
      emptyEl.textContent = "Fant ikke apps.json. Sjekk at filen finnes og er gyldig JSON.";
      emptyEl.hidden = false;
    });
})();
