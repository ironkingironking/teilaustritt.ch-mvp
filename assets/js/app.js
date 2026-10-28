// teilaustritt.ch – Kirchgemeinde-Suche und Briefgenerator.
// Läuft komplett im Browser. Nur die optionale Strassensuche fragt geo.admin.ch an.

const $ = (id) => document.getElementById(id);
const PH_OPEN = "", PH_CLOSE = "";
const ph = (label) => `${PH_OPEN}${label}${PH_CLOSE}`;
const REPORT_MAIL = "redaktion@verafides.ch";

const state = {
  places: null,        // [{plz, ort, munis:[{bfs, share}], key, gkey, lang}]
  gemeinden: null,     // {bfs: [name, kt]}
  kantone: null,       // data/kantone.json
  registries: {},      // kt -> data/kg/<kt>.json
  place: null,         // gewählte Ortschaft
  bfs: null,
  kg: null,            // aufgelöste Kirchgemeinde {id, n, p, ...}
  split: null,         // geteilte Gemeinde: {ids, split}
  manualRecipient: null,
  editingRecipient: false,
  autoFill: { plz: "", wohnort: "" },
  bodyEdited: false,
  streetMsg: "",
};

// ---------- Hilfsfunktionen ----------

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : null);
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, " ").trim();
const fmtDate = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); return m ? `${m[3]}.${m[2]}.${m[1]}` : iso || ""; };

async function fetchJSON(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

function setStatus(msg, kind = "") {
  const el = $("status");
  el.textContent = msg || "";
  el.className = "status" + (kind ? " " + kind : "");
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Konnte ${src} nicht laden`));
    document.head.appendChild(s);
  });
}

// ---------- Ortsdaten ----------

async function loadPlaces() {
  if (state.places) return;
  const data = await fetchJSON("data/orte.json");
  state.gemeinden = data.gemeinden;
  const byKey = new Map();
  for (const [plz, ort, bfs, share, lang] of data.orte) {
    const k = plz + "|" + ort;
    if (!byKey.has(k)) byKey.set(k, { plz, ort, lang, munis: [], key: norm(ort) });
    byKey.get(k).munis.push({ bfs, share });
  }
  state.places = [...byKey.values()].map((p) => {
    p.munis.sort((a, b) => b.share - a.share);
    p.gkey = norm(data.gemeinden[p.munis[0].bfs]?.[0]);
    return p;
  });
}

function searchPlaces(q) {
  const nq = norm(q);
  if (!nq || !state.places) return [];
  const m = /^(\d{1,4})\s*(.*)$/.exec(nq);
  let hits;
  if (m) {
    const [, prefix, rest] = m;
    hits = state.places.filter((p) => p.plz.startsWith(prefix) && (!rest || p.key.startsWith(rest) || p.key.includes(" " + rest)))
      .map((p) => ({ p, s: p.plz === prefix ? 0 : 1 }));
  } else {
    hits = [];
    for (const p of state.places) {
      let s = -1;
      if (p.key === nq) s = 0;
      else if (p.key.startsWith(nq)) s = 1;
      else if (p.key.split(" ").some((w) => w.startsWith(nq))) s = 2;
      else if (p.gkey.startsWith(nq)) s = 3;
      if (s >= 0) hits.push({ p, s });
    }
  }
  hits.sort((a, b) => a.s - b.s || a.p.ort.length - b.p.ort.length || a.p.ort.localeCompare(b.p.ort, "de") || a.p.plz.localeCompare(b.p.plz));
  return hits.slice(0, 10).map((h) => h.p);
}

// ---------- Combobox ----------

const combo = { items: [], active: -1 };

function renderList() {
  const input = $("ort"), list = $("ort-list");
  list.innerHTML = "";
  if (!input.value.trim()) { closeList(); return; }
  if (combo.items.length === 0) {
    list.innerHTML = `<li class="empty" role="option" aria-disabled="true">Kein Ort gefunden. Versuche es mit der PLZ.</li>`;
  }
  combo.items.forEach((p, i) => {
    const [gname, kt] = state.gemeinden[p.munis[0].bfs] || ["", ""];
    const li = document.createElement("li");
    li.id = `ort-opt-${i}`;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(i === combo.active));
    li.innerHTML = `<span>${esc(p.plz)} ${esc(p.ort)}</span><small>${gname && norm(gname) !== p.key ? esc(gname) + ", " : ""}${esc(kt)}</small>`;
    li.addEventListener("mousedown", (ev) => { ev.preventDefault(); choosePlace(p); });
    list.appendChild(li);
  });
  list.hidden = false;
  input.setAttribute("aria-expanded", "true");
  input.setAttribute("aria-activedescendant", combo.active >= 0 ? `ort-opt-${combo.active}` : "");
}

function closeList() {
  $("ort-list").hidden = true;
  $("ort").setAttribute("aria-expanded", "false");
  $("ort").removeAttribute("aria-activedescendant");
  combo.active = -1;
}

function wireCombo() {
  const input = $("ort");
  input.addEventListener("focus", () => loadPlaces().catch(() => setStatus("Ortsdaten konnten nicht geladen werden. Bitte Seite neu laden.", "err")));
  input.addEventListener("input", async () => {
    await loadPlaces().catch(() => {});
    combo.items = searchPlaces(input.value);
    combo.active = combo.items.length ? 0 : -1;
    renderList();
  });
  input.addEventListener("keydown", (ev) => {
    const open = !$("ort-list").hidden;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      if (!open) { combo.items = searchPlaces(input.value); renderList(); }
      if (!combo.items.length) return;
      ev.preventDefault();
      const d = ev.key === "ArrowDown" ? 1 : -1;
      combo.active = (combo.active + d + combo.items.length) % combo.items.length;
      renderList();
      $(`ort-opt-${combo.active}`)?.scrollIntoView({ block: "nearest" });
    } else if (ev.key === "Enter") {
      if (open && combo.active >= 0) { ev.preventDefault(); choosePlace(combo.items[combo.active]); }
    } else if (ev.key === "Escape") {
      closeList();
    }
  });
  input.addEventListener("blur", () => setTimeout(closeList, 100));
}

// ---------- Auflösung Gemeinde -> Kirchgemeinde ----------

async function choosePlace(place) {
  closeList();
  $("ort").value = `${place.plz} ${place.ort}`;
  state.place = place;
  // Absender-PLZ/Ort vorbelegen, solange die Person sie nicht selbst geändert hat
  for (const [id, val] of [["plz", place.plz], ["wohnort", place.ort]]) {
    const el = $(id);
    if (!el.value.trim() || el.value === state.autoFill[id]) { el.value = val; state.autoFill[id] = val; el.removeAttribute("aria-invalid"); }
  }
  await resolveMunicipality(place.munis[0].bfs);
}

async function resolveMunicipality(bfs) {
  state.bfs = bfs;
  state.kg = null;
  state.split = null;
  state.manualRecipient = null;
  state.editingRecipient = false;
  state.streetMsg = "";
  state.streetHit = "";
  state.showMuniSelect = state.place?.munis.some((m) => m.bfs === bfs) && bfs !== state.place.munis[0].bfs;
  const kt = state.gemeinden[bfs]?.[1];
  try {
    if (!state.kantone) state.kantone = await fetchJSON("data/kantone.json");
    const canton = state.kantone[kt];
    if (canton?.register && !state.registries[kt]) state.registries[kt] = await fetchJSON(`data/kg/${kt}.json`);
  } catch (e) {
    setStatus("Die Kirchgemeinde-Daten konnten nicht geladen werden. Du kannst die Adresse selbst eintragen.", "err");
  }
  const reg = state.registries[kt];
  const ids = reg?.gemeinden?.[bfs] || [];
  if (ids.length === 1) {
    setKg(kt, ids[0]);
  } else if (ids.length > 1) {
    // Geteilte Gemeinde: wahrscheinliche Kirchgemeinde über PLZ, Ortschaft oder «übriges Gebiet»
    const split = reg.split?.[bfs] || {};
    const p = state.place;
    const guess = (p && (split.plz?.[p.plz] || split.ort?.[p.ort])) || split.default;
    state.split = { ids, split };
    if (guess && ids.includes(guess)) setKg(kt, guess);
  }
  render();
}

function setKg(kt, id) {
  const reg = state.registries[kt];
  const kg = reg?.kg?.[id];
  state.kg = kg ? { ...kg, id, kt, stand: reg.stand } : null;
  // Ohne Strasse direkt den Editor öffnen, damit die Adresse vervollständigt wird
  if (state.kg && needsStreet(state.kg)) state.editingRecipient = true;
}

// ---------- Strassensuche (nur geteilte Gemeinden) ----------

function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const pointInPolygon = (pt, rings) => pointInRing(pt, rings[0]) && !rings.slice(1).some((r) => pointInRing(pt, r));
const pointInGeometry = (pt, g) =>
  g?.type === "Polygon" ? pointInPolygon(pt, g.coordinates)
  : g?.type === "MultiPolygon" ? g.coordinates.some((p) => pointInPolygon(pt, p)) : false;

async function streetLookup(street) {
  const { place, bfs } = state;
  const kt = state.gemeinden[bfs][1];
  const split = state.split?.split;
  if (!split?.geo || !street.trim()) return;
  state.streetMsg = "Suche Adresse …";
  render();
  try {
    // Mit sr=2056 liefert geo.admin.ch attrs.y = Ost, attrs.x = Nord (LV95) und zusätzlich lat/lon (WGS84).
    const url = new URL("https://api3.geo.admin.ch/rest/services/ech/SearchServer");
    url.search = new URLSearchParams({ type: "locations", origins: "address", limit: "5", sr: "2056",
      searchText: `${street} ${place.plz} ${place.ort}` }).toString();
    const res = await fetch(url);
    if (!res.ok) throw new Error("search");
    const results = (await res.json()).results || [];
    const hit = results.find((r) => String(r.attrs?.label || "").includes(place.plz)) || results[0];
    if (!hit) { state.streetMsg = "Adresse nicht gefunden. Prüfe die Schreibweise oder wähle selbst."; render(); return; }
    const geo = await fetchJSON(split.geo);
    const pt = geo.crs === "EPSG:4326" ? [Number(hit.attrs.lon), Number(hit.attrs.lat)] : [Number(hit.attrs.y), Number(hit.attrs.x)];
    const feature = geo.features.find((f) => pointInGeometry(pt, f.geometry));
    const label = String(hit.attrs.label || "").replace(/<[^>]+>/g, "");
    if (feature && state.split.ids.includes(feature.properties.kg)) {
      setKg(kt, feature.properties.kg);
      state.streetHit = label;
      state.streetMsg = "";
      if (!$("strasse").value.trim()) $("strasse").value = street.trim();
      setStatus(`Kirchgemeinde für ${label} bestimmt.`, "ok");
    } else {
      state.streetMsg = `Für «${label}» konnten wir keine Kirchgemeinde bestimmen. Bitte wähle selbst.`;
    }
  } catch (e) {
    state.streetMsg = "Die Strassensuche ist gerade nicht erreichbar. Bitte wähle selbst.";
  }
  render();
}

function splitBlock(gname, kt) {
  const { ids, split } = state.split;
  const reg = state.registries[kt];
  const finder = safeUrl(split.finder) || safeUrl(reg?.finder);
  const options = ids.map((id) => `<option value="${esc(id)}" ${state.kg?.id === id ? "selected" : ""}>${esc(reg.kg[id].n)}</option>`).join("");
  const how = !split.how ? "" : split.how.length > 240
    ? `<details class="edit"><summary>Welche Gebiete gehören wohin?</summary><p class="small">${esc(split.how)}</p></details>`
    : `<p>${esc(split.how)}</p>`;
  return `${how}
    ${split.geo ? `<form id="street-form" style="margin-top:8px">
        <label for="street-q">Genau bestimmen mit Strasse und Hausnummer</label>
        <div style="display:flex; gap:8px"><input id="street-q" autocomplete="street-address" value="${esc($("strasse").value)}">
        <button class="btn small" type="submit">Bestimmen</button></div>
        <p class="help">Dafür geht die Adresse an den Geodienst geo.admin.ch (swisstopo).</p>
        ${state.streetMsg ? `<p class="small">${esc(state.streetMsg)}</p>` : ""}
      </form>` : ""}
    <label for="kg-select">${state.kg ? "Andere Kirchgemeinde wählen" : "Kirchgemeinde wählen"}</label>
    <select id="kg-select">${state.kg ? "" : `<option value="">Bitte wählen …</option>`}${options}</select>
    ${finder ? `<p class="small">Offizielle Suche: <a href="${esc(finder)}" target="_blank" rel="noopener">${esc(new URL(finder).hostname)}</a></p>` : ""}`;
}

// ---------- Kirchensteuer (ESTV) ----------

const TAX_END = {
  sofort: "Die Kirchensteuerpflicht endet mit dem Eingang deiner Austrittserklärung.",
  monat: "Die Kirchensteuerpflicht endet ab dem Monat nach dem Eingang deiner Austrittserklärung.",
  jahr: "Trittst du im Lauf des Jahres aus, entfällt die Kirchensteuer bereits für das ganze Austrittsjahr.",
  tessin: "Im ersten Jahr endet die Pflicht sofort; später wirkt eine Erklärung auf das folgende Jahr.",
  keine: "",
};

function taxText(canton) {
  const st = canton?.steuer;
  if (!st) return "";
  return [TAX_END[st.ende], st.tipp].filter(Boolean).join(" ");
}

function taxLine(canton) {
  const text = taxText(canton);
  return text ? `<p class="small"><strong>Kirchensteuer:</strong> ${esc(text)} <a href="#kirchensteuer">Mehr dazu</a></p>` : "";
}

// Übersicht «Ab wann keine Kirchensteuer mehr?», eigener Kanton hervorgehoben
function renderTaxSection() {
  const kantone = state.kantone;
  if (!kantone) return;
  const mine = state.gemeinden?.[state.bfs]?.[1];
  const groups = { sofort: [], jahr: [], anders: [] };
  for (const [kt, c] of Object.entries(kantone)) {
    if (!c.steuer) continue;
    const g = c.steuer.system !== "pflicht" ? "anders" : c.steuer.ende === "jahr" ? "jahr" : "sofort";
    groups[g].push([kt, c.name]);
  }
  for (const [g, list] of Object.entries(groups)) {
    const ul = document.querySelector(`.chips[data-ende="${g}"]`);
    if (!ul) continue;
    ul.innerHTML = list.sort((a, b) => a[1].localeCompare(b[1], "de"))
      .map(([kt, name]) => `<li class="${kt === mine ? "mine" : ""}">${esc(name)}${kantone[kt].steuer.ende === "monat" ? " (ab Folgemonat)" : ""}</li>`).join("");
  }
  const el = $("tax-mine");
  const text = mine ? taxText(kantone[mine]) : "";
  el.hidden = !text;
  if (text) el.innerHTML = `<strong>Für dich (Kanton ${esc(kantone[mine].name)}):</strong> ${esc(text)}`;
}

async function initTaxSection() {
  try {
    if (!state.kantone) state.kantone = await fetchJSON("data/kantone.json");
    renderTaxSection();
  } catch (e) { /* Abschnitt bleibt als Text lesbar */ }
}

// ---------- Darstellung Schritt 1 ----------

function shareText(share) {
  if (share >= 90) return "fast alle Adressen";
  if (share >= 50) return "die meisten Adressen";
  if (share >= 10) return "ein Teil der Adressen";
  return "wenige Adressen";
}

function kgLinks(kg) {
  const parts = [];
  if (safeUrl(kg.w)) parts.push(`<a href="${esc(kg.w)}" target="_blank" rel="noopener">Website</a>`);
  if (safeUrl(kg.s)) parts.push(`<a href="${esc(kg.s)}" target="_blank" rel="noopener">Quelle</a>`);
  if (kg.stand) parts.push(`<span>Stand ${esc(fmtDate(kg.stand))}</span>`);
  return parts.join("");
}

function reportLink(subjectExtra) {
  const subject = encodeURIComponent(`Korrektur teilaustritt.ch: ${subjectExtra}`);
  return `<a href="mailto:${REPORT_MAIL}?subject=${subject}">Fehler melden</a>`;
}

// Kirchgemeinde ohne vollständige eigene Postadresse: nur Name und PLZ/Ort
const needsStreet = (kg) => kg.t === "praesidium" || kg.p.length < 3;

function addressNotice(kg) {
  if (state.manualRecipient) return "";
  if (needsStreet(kg)) {
    return `<div class="notice"><strong>Strasse fehlt noch.</strong>Diese Kirchgemeinde publiziert keine eigene Postadresse, nur die Privatadresse ihres Präsidiums. Übernimm die Adresse von der Website der Kirchgemeinde.</div>`;
  }
  const parts = [];
  if (kg.t === "pfarramt") parts.push("Diese Kirchgemeinde hat keine eigene Postadresse. Post an den Kirchenrat läuft über das Pfarramt. Die Pfarrei sieht den Brief also.");
  if (kg.c !== "high") {
    parts.push(kg.note || (kg.t === "sekretariat"
      ? "Die Kirchgemeinde nennt keine eigene Adresse ihrer Behörde. Angegeben ist das Sekretariat, das die Post weiterleitet."
      : kg.t === "pfarramt" ? "" : "Die Angabe ist nicht vollständig gesichert. Prüfe sie auf der Website der Kirchgemeinde."));
  } else if (kg.note) {
    parts.push(kg.note);
  }
  if (!parts.length) return "";
  return `<div class="notice"><strong>${kg.c !== "high" ? "Bitte Adresse vor dem Versand prüfen." : "Hinweis zur Adresse"}</strong>${parts.map(esc).join(" ")}</div>`;
}

function recipientEditor() {
  const lines = (state.manualRecipient || state.kg?.p || []).join("\n");
  return `<label for="recipient-edit">Empfänger <span class="opt-tag">(eine Adresszeile pro Zeile)</span></label>
    <textarea id="recipient-edit" rows="4" style="font-family:inherit; min-height:0">${esc(lines)}</textarea>
    <p class="help">Wird direkt in den Brief übernommen.</p>`;
}

function render() {
  const out = $("kg-result");
  const { place, bfs } = state;
  if (!place || !bfs) { out.innerHTML = ""; renderLetter(); return; }
  const [gname, kt] = state.gemeinden[bfs] || ["", ""];
  const canton = state.kantone?.[kt];
  let html = "";

  // Ortschaft liegt in mehreren Gemeinden: deutlich nur, wenn es nicht fast alle Adressen betrifft
  if (place.munis.length > 1) {
    const opts = place.munis.map((m) => {
      const [n, k] = state.gemeinden[m.bfs] || [];
      return `<option value="${m.bfs}" ${m.bfs === bfs ? "selected" : ""}>${esc(n)} (${esc(k)}, ${shareText(m.share)})</option>`;
    }).join("");
    const select = `<label for="muni-select" class="sr-only">Gemeinde</label><select id="muni-select" style="margin-top:8px">${opts}</select>`;
    if (place.munis[0].share >= 95 && !state.showMuniSelect) {
      html += `<p class="small" style="margin:0 0 10px">Gemeinde ${esc(gname)} ·
        <button type="button" class="linkbtn" data-action="show-munis">andere Gemeinde wählen</button></p>`;
    } else {
      html += `<div class="notice info" style="margin:0 0 12px"><strong>${esc(place.plz)} ${esc(place.ort)} gehört zu mehreren Gemeinden.</strong>
        Massgebend ist die Gemeinde, in der du angemeldet bist.${select}</div>`;
    }
  }

  const otherSystem = canton && canton.register !== true && (canton.register === false || canton.steuer?.system !== "pflicht");
  if (otherSystem) {
    html += `<div class="kg warn"><p class="kg-kicker">${esc(gname)}, Kanton ${esc(canton.name)}</p>
      <h3>Hier gilt ein anderes System</h3>
      <p>${esc(canton.summary || taxText(canton) || "Für diesen Kanton haben wir keine Kirchgemeinde-Daten.")}</p>
      <p class="small"><a href="#kirchensteuer">Mehr zur Kirchensteuer</a></p>
      ${safeUrl(canton.body?.website) ? `<p><a href="${esc(canton.body.website)}" target="_blank" rel="noopener">${esc(canton.body.short || canton.body.name)}</a></p>` : ""}
      <p><button type="button" class="linkbtn" data-action="edit-recipient">Empfänger selbst eintragen</button></p>
      ${state.editingRecipient ? recipientEditor() : ""}</div>`;
  } else if (state.kg) {
    const kg = state.kg;
    const lines = state.manualRecipient || kg.p;
    const central = canton?.austritt?.recipient_level === "kanton";
    html += `<div class="kg ok"><p class="kg-kicker">Zuständig für ${esc(gname)}</p>
      <h3>${esc(kg.n)}</h3>
      <address>${lines.map(esc).join("<br>")}</address>
      <div class="kg-meta">${kgLinks(kg)}</div>
      ${central ? `<p>Im Kanton ${esc(canton.name)} geht der Austritt an diese zentrale Stelle.</p>` : ""}
      ${kg.home && state.kantone?.[kg.home] ? `<p class="small">Diese Kirchgemeinde gehört zum Kanton ${esc(state.kantone[kg.home].name)}. Für den Austritt gelten dessen Regeln.</p>` : ""}
      ${rulesCanton()?.austritt?.beglaubigung ? `<p class="small"><strong>Beglaubigte Unterschrift nötig.</strong> Siehe Schritt 3.</p>` : ""}
      ${taxLine(rulesCanton())}
      ${addressNotice(kg)}
      <p class="small"><button type="button" class="linkbtn" data-action="edit-recipient">Adresse anpassen</button> · ${reportLink(kg.n)}</p>
      ${state.editingRecipient ? recipientEditor() : ""}
      ${state.split ? `<div class="notice info"><strong>${esc(gname)} hat ${state.split.ids.length} Kirchgemeinden.</strong>${state.streetHit
        ? `Genau bestimmt für ${esc(state.streetHit)}.`
        : `Die Zuordnung oben ist die wahrscheinlichste für ${esc(place.plz)} ${esc(place.ort)}.`}${splitBlock(gname, kt)}</div>` : ""}</div>`;
  } else if (state.split) {
    html += `<div class="kg warn"><p class="kg-kicker">${esc(gname)} hat ${state.split.ids.length} Kirchgemeinden</p>
      <h3>Welche zuständig ist, hängt von deiner Adresse ab</h3>
      ${splitBlock(gname, kt)}</div>`;
  } else {
    const body = canton?.body;
    const finder = safeUrl(canton?.finder) || safeUrl(body?.website);
    html += `<div class="kg warn"><p class="kg-kicker">${esc(gname)}${canton ? `, Kanton ${esc(canton.name)}` : ""}</p>
      <h3>Für diese Gemeinde fehlt uns noch eine geprüfte Adresse</h3>
      ${finder ? `<p>Die Kirchgemeinden findest du bei der ${esc(body?.short || body?.name || "Landeskirche")}: <a href="${esc(finder)}" target="_blank" rel="noopener">Verzeichnis öffnen</a>.</p>` : ""}
      <p><button type="button" class="linkbtn" data-action="edit-recipient">Empfänger selbst eintragen</button> · ${reportLink(gname)}</p>
      ${state.editingRecipient ? recipientEditor() : ""}</div>`;
  }

  out.innerHTML = html;
  $("step-ort").classList.toggle("done", Boolean(state.kg || state.manualRecipient));
  renderTaxSection();
  renderLetter();
}

function wireResult() {
  const out = $("kg-result");
  out.addEventListener("change", (ev) => {
    if (ev.target.id === "muni-select") resolveMunicipality(Number(ev.target.value));
    if (ev.target.id === "kg-select" && ev.target.value) {
      setKg(state.gemeinden[state.bfs][1], ev.target.value);
      state.manualRecipient = null;
      state.streetMsg = "";
      state.streetHit = "";
      render();
      $("kg-select")?.focus();
    }
  });
  out.addEventListener("input", (ev) => {
    if (ev.target.id === "recipient-edit") {
      const lines = ev.target.value.split("\n").map((l) => l.trim()).filter(Boolean);
      state.manualRecipient = lines.length ? lines : null;
      $("step-ort").classList.toggle("done", Boolean(state.kg || state.manualRecipient));
      renderLetter();
    }
  });
  out.addEventListener("click", (ev) => {
    if (ev.target.dataset.action === "show-munis") {
      state.showMuniSelect = true;
      render();
      $("muni-select")?.focus();
    }
    if (ev.target.dataset.action === "edit-recipient") {
      state.editingRecipient = !state.editingRecipient;
      render();
      if (state.editingRecipient) $("recipient-edit")?.focus();
    }
  });
  out.addEventListener("submit", (ev) => {
    if (ev.target.id === "street-form") { ev.preventDefault(); streetLookup($("street-q").value); }
  });
}

// ---------- Brief ----------

const val = (id) => $(id).value.trim();

// Nur die Kirchgemeinde wird namentlich genannt. Die kantonale Ebene ist nicht überall eine
// Körperschaft mit eigener Mitgliedschaft (z. B. Zug: Vereinigung der Kirchgemeinden).
function bodyNames() {
  return state.kg?.n && !state.manualRecipient ? [state.kg.n] : [];
}

function buildBody() {
  const name = [val("vorname"), val("nachname")].filter(Boolean).join(" ");
  const dob = val("geburtsdatum");
  const addr = [val("strasse"), [val("plz"), val("wohnort")].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const per = document.querySelector('input[name="per"]:checked')?.value;
  const datum = fmtDate($("per-datum").value);
  const names = bodyNames();
  const zusatz = val("zusatz");
  return [
    "Sehr geehrte Damen und Herren",
    "",
    "Hiermit erkläre ich – soweit nach kantonalem Recht vorgesehen – meinen Austritt aus der öffentlich-rechtlichen Körperschaft der Landeskirche und Kirchgemeinde an meinem Wohnort" +
      (names.length ? ` (${names.join(" und ")}).` : "."),
    "",
    "Angaben zu meiner Person:",
    `Name: ${name || ph("Vorname Nachname")}`,
    ...(dob ? [`Geburtsdatum: ${dob}`] : []),
    `Adresse: ${addr || ph("Strasse Nr., PLZ Ort")}`,
    "",
    per === "datum"
      ? `Ich ersuche um Wirksamkeit per ${datum || ph("Datum")}.`
      : "Ich ersuche um Wirksamkeit per nächstmöglichem Zeitpunkt nach kantonalem Recht.",
    "",
    "Ich bitte um schriftliche Bestätigung des Austritts (inkl. Datum der Wirksamkeit). Ferner bitte ich Sie, dieses Schreiben vertraulich zu behandeln und den Inhalt nicht an Dritte, inkl. Pfarrei und Bistum, zu kommunizieren.",
    ...(zusatz ? ["", zusatz] : []),
  ].join("\n");
}

function letterModel() {
  const name = [val("vorname"), val("nachname")].filter(Boolean).join(" ");
  const plzOrt = [val("plz"), val("wohnort")].filter(Boolean).join(" ");
  const sender = [name || ph("Vorname Nachname"), val("strasse") || ph("Strasse Nr."), plzOrt || ph("PLZ Ort")];
  if (val("email")) sender.push(val("email"));
  const recipient = state.manualRecipient || state.kg?.p || [ph("Zuständige Kirchgemeinde"), ph("Adresse")];
  const date = new Intl.DateTimeFormat("de-CH", { day: "numeric", month: "long", year: "numeric" }).format(new Date());
  return {
    sender,
    recipient,
    placeDate: `${val("wohnort") || ph("Ort")}, ${date}`,
    subject: "Austrittserklärung aus der staatskirchenrechtlichen Körperschaft (Kirchensteuer)",
    body: state.bodyEdited ? $("body-edit").value : buildBody(),
    closing: "Freundliche Grüsse",
    name: name || ph("Vorname Nachname"),
  };
}

const toHtml = (s) => esc(s).replace(new RegExp(`${PH_OPEN}(.*?)${PH_CLOSE}`, "g"), '<span class="ph">$1</span>');
const toPlain = (s) => String(s).replace(new RegExp(`${PH_OPEN}(.*?)${PH_CLOSE}`, "g"), "[$1]");

function renderLetter() {
  const m = letterModel();
  $("l-sender").innerHTML = m.sender.map(toHtml).join("\n");
  $("l-recipient").innerHTML = m.recipient.map(toHtml).join("\n");
  $("l-date").innerHTML = toHtml(m.placeDate);
  $("l-subject").textContent = m.subject;
  $("l-body").innerHTML = toHtml(m.body);
  $("l-sign").innerHTML = `${esc(m.closing)}\n\n\n${toHtml(m.name)}`;
  if (!state.bodyEdited) $("body-edit").value = toPlain(m.body);
  renderChecklist();
  const personDone = ["vorname", "nachname", "strasse", "plz", "wohnort"].every((id) => val(id));
  $("step-person").classList.toggle("done", personDone);
}

// Massgebend sind die Regeln des Kantons der Kirchgemeinde (z. B. KG Wil SG für Rickenbach TG)
function rulesCanton() {
  const kt = state.kg?.home || state.gemeinden?.[state.bfs]?.[1];
  return state.kantone?.[kt];
}

function renderChecklist() {
  const canton = rulesCanton();
  const a = canton?.austritt;
  const to = state.manualRecipient?.[0] || state.kg?.n || "die zuständige Kirchgemeinde";
  const items = [
    `<li>Schreiben prüfen und ausdrucken.<small>Mit «PDF herunterladen» oder «Drucken».</small></li>`,
    `<li>Von Hand unterschreiben.</li>`,
  ];
  if (a?.beglaubigung) {
    items.push(`<li class="hl">Unterschrift amtlich beglaubigen lassen.<small>${esc(a.beglaubigung_note || `Im Kanton ${canton.name} vorgeschrieben.`)}</small></li>`);
  }
  items.push(`<li>Per Einschreiben oder A-Post Plus senden.<small>An ${esc(to)}.</small></li>`);
  items.push(`<li>Kopie und Postquittung aufbewahren.<small>Für den Austritt genügt die nachweisliche Zustellung an die richtige Stelle. Die Bestätigung hält Wirksamkeit und Ende der Steuerpflicht fest.</small></li>`);
  $("checklist").innerHTML = items.join("");
}

function missingFields() {
  const required = [["vorname", "Vorname"], ["nachname", "Nachname"], ["strasse", "Strasse"], ["plz", "PLZ"], ["wohnort", "Ort"]];
  const missing = [];
  for (const [id, label] of required) {
    const empty = !val(id);
    $(id).setAttribute("aria-invalid", String(empty));
    if (empty) missing.push({ id, label });
  }
  if (!state.manualRecipient && !state.kg) missing.unshift({ id: "ort", label: "Empfänger (Schritt 1)" });
  else if (!state.manualRecipient && needsStreet(state.kg)) missing.unshift({ id: "recipient-edit", label: "Strasse der Kirchgemeinde (Schritt 1)" });
  if (document.querySelector('input[name="per"]:checked')?.value === "datum" && !$("per-datum").value) missing.push({ id: "per-datum", label: "Austrittsdatum" });
  return missing;
}

function checkReady() {
  const missing = missingFields();
  if (!missing.length) return true;
  setStatus(`Es fehlt noch: ${missing.map((m) => m.label).join(", ")}.`, "err");
  ($(missing[0].id) || $("ort")).focus();
  return false;
}

function fileName(ext) {
  const n = norm(val("nachname")).replace(/ /g, "-") || "schreiben";
  return `austritt-kirchgemeinde-${n}.${ext}`;
}

function bodyLines(m) {
  return toPlain(m.body).split("\n");
}

async function downloadPdf() {
  if (!window.jspdf) await loadScript("assets/vendor/jspdf-2.5.1.umd.min.js");
  const m = letterModel();
  const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
  const left = 25, width = 160, bottom = 277;
  doc.setFont("helvetica", "normal");
  // Absender
  doc.setFontSize(9.5);
  m.sender.map(toPlain).flatMap((l) => doc.splitTextToSize(l, 85)).forEach((l, i) => doc.text(l, left, 20 + i * 4.4));
  // Empfänger im rechten Fenster (C5/C6 rechts)
  doc.setFont("helvetica", "bold"); doc.setFontSize(8);
  doc.text("EINSCHREIBEN", 118, 48);
  doc.setFont("helvetica", "normal"); doc.setFontSize(11);
  // Fensterbreite rechts: 118 mm bis 190 mm
  m.recipient.map(toPlain).flatMap((l) => doc.splitTextToSize(l, 72)).forEach((l, i) => doc.text(l, 118, 54 + i * 5));
  let y = 98;
  doc.text(toPlain(m.placeDate), left, y);
  y += 12;
  doc.setFont("helvetica", "bold");
  for (const l of doc.splitTextToSize(m.subject, width)) { doc.text(l, left, y); y += 5.2; }
  doc.setFont("helvetica", "normal");
  y += 5;
  const lines = [...bodyLines(m), "", m.closing, "", "", "", toPlain(m.name)];
  for (const para of lines) {
    const wrapped = para.trim() ? doc.splitTextToSize(para, width) : [""];
    for (const l of wrapped) {
      if (y > bottom) { doc.addPage(); y = 25; }
      doc.text(l, left, y);
      y += 5.2;
    }
  }
  doc.save(fileName("pdf"));
}

async function downloadDocx() {
  if (!window.docx) await loadScript("assets/vendor/docx-8.5.0.umd.js");
  const { Document, Packer, Paragraph, TextRun } = window.docx;
  const m = letterModel();
  const mm = (v) => Math.round(v * 56.7);
  const p = (text, opts = {}) => new Paragraph({ children: [new TextRun({ text, size: opts.size || 22, bold: opts.bold, font: "Arial" })],
    indent: opts.indent ? { left: mm(opts.indent) } : undefined, spacing: { after: opts.after ?? 0 } });
  const children = [
    ...m.sender.map((l) => p(toPlain(l), { size: 19 })),
    p(""), p(""),
    p("EINSCHREIBEN", { size: 16, bold: true, indent: 93 }),
    ...m.recipient.map((l) => p(toPlain(l), { indent: 93 })),
    p(""), p(""), p(""),
    p(toPlain(m.placeDate), { after: 240 }),
    p(m.subject, { bold: true, after: 240 }),
    ...bodyLines(m).map((l) => p(l)),
    p(""),
    p(m.closing),
    p(""), p(""), p(""),
    p(toPlain(m.name)),
  ];
  const doc = new Document({ sections: [{ properties: { page: { margin: { top: mm(20), left: mm(25), right: mm(20), bottom: mm(20) } } }, children }] });
  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = fileName("docx");
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function wireLetter() {
  $("person").addEventListener("input", (ev) => {
    if (ev.target.value.trim()) ev.target.removeAttribute("aria-invalid");
    renderLetter();
  });
  $("person").addEventListener("change", (ev) => {
    if (ev.target.name === "per") $("per-datum-wrap").hidden = ev.target.value !== "datum";
    renderLetter();
  });
  $("body-edit").addEventListener("input", () => {
    state.bodyEdited = true;
    $("body-reset").hidden = false;
    $("edit-help").firstChild.textContent = "Du hast den Text angepasst. Änderungen an deinen Angaben übernimmt er nicht mehr automatisch. ";
    renderLetter();
  });
  $("body-reset").addEventListener("click", () => {
    state.bodyEdited = false;
    $("body-reset").hidden = true;
    $("edit-help").firstChild.textContent = "Absender, Empfänger und Datum füllen sich weiter automatisch aus. ";
    renderLetter();
  });
  const run = (btn, label, fn) => $(btn).addEventListener("click", async () => {
    if (!checkReady()) return;
    const el = $(btn);
    el.disabled = true;
    setStatus(`Erstelle ${label} …`);
    try { await fn(); setStatus(`${label} erstellt. Jetzt ausdrucken und von Hand unterschreiben.`, "ok"); }
    catch (e) { setStatus(`${label} konnte nicht erstellt werden. Versuche «Drucken».`, "err"); }
    finally { el.disabled = false; }
  });
  run("btn-pdf", "PDF", downloadPdf);
  run("btn-docx", "Word-Datei", downloadDocx);
  $("btn-print").addEventListener("click", () => { if (checkReady()) window.print(); });
}

// ---------- Start ----------

wireCombo();
wireResult();
wireLetter();
renderLetter();
initTaxSection();
