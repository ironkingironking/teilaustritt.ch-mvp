// teilaustritt.ch – Kirchgemeinde-Suche und Briefgenerator.
// Läuft komplett im Browser. Nur die optionale Strassensuche fragt geo.admin.ch an.
// Sprache der Oberfläche aus <html lang>, Sprache des Briefs separat (Amtssprache am Wohnort).

import { UI, LETTER, CANTON_NAMES } from "./i18n.js?v=20261028b";

const $ = (id) => document.getElementById(id);
const LANG = (document.documentElement.lang || "de").slice(0, 2);
const T = UI[LANG] || UI.de;
const t = (key, ...args) => { const v = T[key] ?? UI.de[key]; return typeof v === "function" ? v(...args) : v; };
// Seitenwurzel, damit /fr/, /it/ und /en/ dieselben Daten und Skripte laden
const BASE = new URL("../../", import.meta.url).href;
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
  letterLang: null,    // null = automatisch nach Wohnort
  streetMsg: "",
  streetHit: "",
};

// ---------- Hilfsfunktionen ----------

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : null);
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, " ").trim();
const fmtDate = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); return m ? `${m[3]}.${m[2]}.${m[1]}` : iso || ""; };
// Text aus den Daten in der Sprache der Seite (feld_fr, feld_it, feld_en), sonst deutsch
const loc = (obj, key) => (LANG !== "de" && obj?.[`${key}_${LANG}`]) || obj?.[key];
const cname = (kt) => CANTON_NAMES[LANG]?.[kt] || state.kantone?.[kt]?.name || kt;

async function fetchJSON(path) {
  const res = await fetch(new URL(path, BASE), { cache: "no-cache" });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

function setStatus(msg, kind = "") {
  const el = $("status");
  el.textContent = msg || "";
  el.className = "status" + (kind ? " " + kind : "");
}

function loadScript(path) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = new URL(path, BASE).href;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`${path} nicht geladen`));
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
  hits.sort((a, b) => a.s - b.s || a.p.ort.length - b.p.ort.length || a.p.ort.localeCompare(b.p.ort, LANG) || a.p.plz.localeCompare(b.p.plz));
  return hits.slice(0, 10).map((h) => h.p);
}

// ---------- Combobox ----------

const combo = { items: [], active: -1 };

function renderList() {
  const input = $("ort"), list = $("ort-list");
  list.innerHTML = "";
  if (!input.value.trim()) { closeList(); return; }
  if (combo.items.length === 0) {
    list.innerHTML = `<li class="empty" role="option" aria-disabled="true">${esc(t("noPlace"))}</li>`;
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
  input.addEventListener("focus", () => loadPlaces().catch(() => setStatus(t("loadPlacesErr"), "err")));
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
    setStatus(t("loadKgErr"), "err");
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
  state.streetMsg = t("streetSearching");
  render();
  try {
    // Mit sr=2056 liefert geo.admin.ch attrs.y = Ost, attrs.x = Nord (LV95) und zusätzlich lat/lon (WGS84).
    const url = new URL("https://api3.geo.admin.ch/rest/services/ech/SearchServer");
    url.search = new URLSearchParams({ type: "locations", origins: "address", limit: "5", sr: "2056",
      searchText: `${street} ${place.plz} ${place.ort}` }).toString();
    const res = await fetch(url);
    if (!res.ok) throw new Error("search");
    const results = (await res.json()).results || [];
    // Treffer mit genau dieser Strasse und Nummer vor allen anderen; die Suche rankt sonst unscharf
    const plain = (r) => norm(String(r.attrs?.label || "").replace(/<[^>]+>/g, ""));
    const want = norm(street);
    const hit = results.find((r) => plain(r).startsWith(want + " ") && plain(r).includes(place.plz))
      || results.find((r) => String(r.attrs?.label || "").includes(place.plz)) || results[0];
    if (!hit) { state.streetMsg = t("streetNotFound"); render(); return; }
    const geo = await fetchJSON(split.geo);
    const pt = geo.crs === "EPSG:4326" ? [Number(hit.attrs.lon), Number(hit.attrs.lat)] : [Number(hit.attrs.y), Number(hit.attrs.x)];
    const feature = geo.features.find((f) => pointInGeometry(pt, f.geometry));
    const label = String(hit.attrs.label || "").replace(/<[^>]+>/g, "");
    if (feature && state.split.ids.includes(feature.properties.kg)) {
      setKg(kt, feature.properties.kg);
      state.streetHit = label;
      state.streetMsg = "";
      if (!$("strasse").value.trim()) $("strasse").value = street.trim();
      setStatus(t("streetOk", label), "ok");
    } else {
      state.streetMsg = t("streetNoKg", label);
    }
  } catch (e) {
    console.warn("Strassensuche:", e);
    state.streetMsg = t("streetDown");
  }
  render();
}

function splitBlock(gname, kt) {
  const { ids, split } = state.split;
  const reg = state.registries[kt];
  const finder = safeUrl(split.finder) || safeUrl(reg?.finder);
  const options = ids.map((id) => `<option value="${esc(id)}" ${state.kg?.id === id ? "selected" : ""}>${esc(reg.kg[id].n)}</option>`).join("");
  // Die Gebietsbeschreibungen gibt es nur auf Deutsch
  let how = "";
  if (split.how && LANG === "de") {
    how = split.how.length > 240
      ? `<details class="edit"><summary>${esc(t("whichAreas"))}</summary><p class="small">${esc(split.how)}</p></details>`
      : `<p>${esc(split.how)}</p>`;
  } else if (split.how) {
    how = `<p>${esc(t("howGeneric"))}</p><details class="edit"><summary>${esc(t("detailsDe"))}</summary><p class="small" lang="de">${esc(split.how)}</p></details>`;
  }
  return `${how}
    ${split.geo ? `<form id="street-form" style="margin-top:8px">
        <label for="street-q">${esc(t("streetLabel"))}</label>
        <div style="display:flex; gap:8px"><input id="street-q" autocomplete="street-address" value="${esc($("strasse").value)}">
        <button class="btn small" type="submit">${esc(t("streetBtn"))}</button></div>
        <p class="help">${esc(t("streetPrivacy"))}</p>
        ${state.streetMsg ? `<p class="small">${esc(state.streetMsg)}</p>` : ""}
      </form>` : ""}
    <label for="kg-select">${esc(state.kg ? t("otherKg") : t("chooseKg"))}</label>
    <select id="kg-select">${state.kg ? "" : `<option value="">${esc(t("pleaseChoose"))}</option>`}${options}</select>
    ${finder ? `<p class="small">${esc(t("officialSearch"))} <a href="${esc(finder)}" target="_blank" rel="noopener">${esc(new URL(finder).hostname)}</a></p>` : ""}`;
}

// ---------- Kirchensteuer (ESTV) ----------

function taxText(canton) {
  const st = canton?.steuer;
  if (!st) return "";
  return [T.taxEnd[st.ende], loc(st, "tipp")].filter(Boolean).join(" ");
}

function taxLine(canton) {
  const text = taxText(canton);
  return text ? `<p class="small"><strong>${esc(t("taxLabel"))}</strong> ${esc(text)} <a href="#kirchensteuer">${esc(t("more"))}</a></p>` : "";
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
    groups[g].push([kt, cname(kt)]);
  }
  for (const [g, list] of Object.entries(groups)) {
    const ul = document.querySelector(`.chips[data-ende="${g}"]`);
    if (!ul) continue;
    ul.innerHTML = list.sort((a, b) => a[1].localeCompare(b[1], LANG))
      .map(([kt, name]) => `<li class="${kt === mine ? "mine" : ""}">${esc(name)}${kantone[kt].steuer.ende === "monat" ? esc(t("fromNextMonth")) : ""}</li>`).join("");
  }
  const el = $("tax-mine");
  const text = mine ? taxText(kantone[mine]) : "";
  el.hidden = !text;
  if (text) el.innerHTML = `<strong>${esc(t("forYou", cname(mine)))}</strong> ${esc(text)}`;
}

async function initTaxSection() {
  try {
    if (!state.kantone) state.kantone = await fetchJSON("data/kantone.json");
    renderTaxSection();
  } catch (e) { /* Abschnitt bleibt als Text lesbar */ }
}

// ---------- Darstellung Schritt 1 ----------

function shareText(share) {
  const s = t("share");
  return share >= 90 ? s[0] : share >= 50 ? s[1] : share >= 10 ? s[2] : s[3];
}

function kgLinks(kg) {
  const parts = [];
  if (safeUrl(kg.w)) parts.push(`<a href="${esc(kg.w)}" target="_blank" rel="noopener">${esc(t("website"))}</a>`);
  if (safeUrl(kg.s)) parts.push(`<a href="${esc(kg.s)}" target="_blank" rel="noopener">${esc(t("source"))}</a>`);
  if (kg.stand) parts.push(`<span>${esc(t("asOf"))} ${esc(fmtDate(kg.stand))}</span>`);
  return parts.join("");
}

function reportLink(subjectExtra) {
  const subject = encodeURIComponent(`Korrektur teilaustritt.ch: ${subjectExtra}`);
  return `<a href="mailto:${REPORT_MAIL}?subject=${subject}">${esc(t("report"))}</a>`;
}

// Kirchgemeinde ohne Strasse oder Postfach in der Postadresse (ns wird beim Build gesetzt)
const needsStreet = (kg) => Boolean(kg?.ns) || kg?.t === "praesidium";

function addressNotice(kg) {
  if (state.manualRecipient) return "";
  if (needsStreet(kg)) {
    return `<div class="notice"><strong>${esc(t("streetMissingTitle"))}</strong>${esc(t("streetMissingText"))}</div>`;
  }
  const parts = [];
  if (kg.t === "pfarramt") parts.push(t("pfarramtText"));
  if (kg.c !== "high") {
    parts.push(kg.note || (kg.t === "sekretariat" ? t("sekretariatText") : kg.t === "pfarramt" ? "" : t("unsureText")));
  } else if (kg.note) {
    parts.push(kg.note);
  }
  const text = parts.filter(Boolean);
  if (!text.length) return "";
  return `<div class="notice"><strong>${esc(kg.c !== "high" ? t("checkTitle") : t("hintTitle"))}</strong>${text.map(esc).join(" ")}</div>`;
}

function recipientEditor() {
  const lines = (state.manualRecipient || state.kg?.p || []).join("\n");
  return `<label for="recipient-edit">${esc(t("recipient"))} <span class="opt-tag">${esc(t("recipientHint"))}</span></label>
    <textarea id="recipient-edit" rows="4" style="font-family:inherit; min-height:0">${esc(lines)}</textarea>
    <p class="help">${esc(t("recipientHelp"))}</p>`;
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
      return `<option value="${m.bfs}" ${m.bfs === bfs ? "selected" : ""}>${esc(n)} (${esc(k)}, ${esc(shareText(m.share))})</option>`;
    }).join("");
    const select = `<label for="muni-select" class="sr-only">${esc(t("muniLabel"))}</label><select id="muni-select" style="margin-top:8px">${opts}</select>`;
    if (place.munis[0].share >= 95 && !state.showMuniSelect) {
      html += `<p class="small" style="margin:0 0 10px">${esc(t("muniOne", gname))} ·
        <button type="button" class="linkbtn" data-action="show-munis">${esc(t("otherMuni"))}</button></p>`;
    } else {
      html += `<div class="notice info" style="margin:0 0 12px"><strong>${esc(t("multiMuni", `${place.plz} ${place.ort}`))}</strong>
        ${esc(t("multiMuniHelp"))}${select}</div>`;
    }
  }

  const otherSystem = canton && canton.register !== true && (canton.register === false || canton.steuer?.system !== "pflicht");
  if (otherSystem) {
    html += `<div class="kg warn"><p class="kg-kicker">${esc(t("cantonOf", gname, cname(kt)))}</p>
      <h3>${esc(t("otherSystem"))}</h3>
      <p>${esc(loc(canton, "summary") || taxText(canton) || t("noData"))}</p>
      <p class="small"><a href="#kirchensteuer">${esc(t("moreTax"))}</a></p>
      ${safeUrl(canton.body?.website) ? `<p><a href="${esc(canton.body.website)}" target="_blank" rel="noopener">${esc(canton.body.short || canton.body.name)}</a></p>` : ""}
      <p><button type="button" class="linkbtn" data-action="edit-recipient">${esc(t("enterRecipient"))}</button></p>
      ${state.editingRecipient ? recipientEditor() : ""}</div>`;
  } else if (state.kg) {
    const kg = state.kg;
    const lines = state.manualRecipient || kg.p;
    const central = canton?.austritt?.recipient_level === "kanton";
    const rules = rulesCanton();
    const hint = loc(rules?.austritt, "public_hinweis");
    html += `<div class="kg ok"><p class="kg-kicker">${esc(t("responsibleFor", gname))}</p>
      <h3>${esc(kg.n)}</h3>
      <address>${lines.map(esc).join("<br>")}</address>
      <div class="kg-meta">${kgLinks(kg)}</div>
      ${central ? `<p>${esc(t("central", cname(kt)))}</p>` : ""}
      ${kg.home && state.kantone?.[kg.home] ? `<p class="small">${esc(t("homeCanton", cname(kg.home)))}</p>` : ""}
      ${rules?.austritt?.beglaubigung ? `<p class="small"><strong>${esc(t("certified"))}</strong> ${esc(t("seeStep3"))}</p>` : ""}
      ${hint ? `<div class="notice"><strong>${esc(t("goodToKnow"))}</strong>${esc(hint)}</div>` : ""}
      ${taxLine(rules)}
      ${addressNotice(kg)}
      <p class="small"><button type="button" class="linkbtn" data-action="edit-recipient">${esc(t("editAddress"))}</button> · ${reportLink(kg.n)}</p>
      ${state.editingRecipient ? recipientEditor() : ""}
      ${state.split ? `<div class="notice info"><strong>${esc(t("splitTitle", gname, state.split.ids.length))}</strong>${esc(state.streetHit
        ? t("splitExact", state.streetHit)
        : t("splitLikely", `${place.plz} ${place.ort}`))}${splitBlock(gname, kt)}</div>` : ""}</div>`;
  } else if (state.split) {
    html += `<div class="kg warn"><p class="kg-kicker">${esc(t("splitTitle", gname, state.split.ids.length))}</p>
      <h3>${esc(t("splitDepends"))}</h3>
      ${splitBlock(gname, kt)}</div>`;
  } else {
    const body = canton?.body;
    const finder = safeUrl(canton?.finder) || safeUrl(body?.website);
    html += `<div class="kg warn"><p class="kg-kicker">${esc(canton ? t("cantonOf", gname, cname(kt)) : gname)}</p>
      <h3>${esc(t("missingTitle"))}</h3>
      ${finder ? `<p>${esc(t("findAt", body?.short || body?.name || t("landeskirche")))} <a href="${esc(finder)}" target="_blank" rel="noopener">${esc(t("openDir"))}</a></p>` : ""}
      <p><button type="button" class="linkbtn" data-action="edit-recipient">${esc(t("enterRecipient"))}</button> · ${reportLink(gname)}</p>
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

// Briefsprache: gewählt, sonst die Amtssprache der Ortschaft (Ortschaftenverzeichnis), sonst die Seitensprache
function letterLang() {
  if (state.letterLang) return state.letterLang;
  const byPlace = { f: "fr", i: "it" }[state.place?.lang];
  return byPlace || (LETTER[LANG] ? LANG : "de");
}

// Nur die Kirchgemeinde wird namentlich genannt. Die kantonale Ebene ist nicht überall eine
// Körperschaft mit eigener Mitgliedschaft (z. B. Zug: Vereinigung der Kirchgemeinden).
function bodyNames() {
  return state.kg?.n && !state.manualRecipient ? [state.kg.n] : [];
}

function buildBody(L) {
  const name = [val("vorname"), val("nachname")].filter(Boolean).join(" ");
  const dob = val("geburtsdatum");
  const addr = [val("strasse"), [val("plz"), val("wohnort")].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const per = document.querySelector('input[name="per"]:checked')?.value;
  const datum = fmtDate($("per-datum").value);
  const zusatz = val("zusatz");
  return [
    L.salutation,
    "",
    L.declare(bodyNames()),
    "",
    L.personal,
    `${L.name}${L.sep}${name || ph(L.ph.name)}`,
    ...(dob ? [`${L.dob}${L.sep}${dob}`] : []),
    `${L.address}${L.sep}${addr || ph(L.ph.addr)}`,
    "",
    per === "datum" ? L.effectDate(datum || ph(L.ph.date)) : L.effectSoon,
    "",
    L.confirm,
    ...(zusatz ? ["", zusatz] : []),
  ].join("\n");
}

function letterModel() {
  const L = LETTER[letterLang()];
  const name = [val("vorname"), val("nachname")].filter(Boolean).join(" ");
  const plzOrt = [val("plz"), val("wohnort")].filter(Boolean).join(" ");
  const sender = [name || ph(L.ph.name), val("strasse") || ph(L.ph.street), plzOrt || ph(L.ph.plzOrt)];
  if (val("email")) sender.push(val("email"));
  const recipient = state.manualRecipient || state.kg?.p || [ph(L.ph.kg), ph(L.ph.kgAddr)];
  const date = new Intl.DateTimeFormat(L.locale, { day: "numeric", month: "long", year: "numeric" }).format(new Date());
  return {
    L,
    sender,
    recipient,
    placeDate: L.placeDate(val("wohnort") || ph(L.ph.ort), date),
    subject: L.subject,
    body: state.bodyEdited ? $("body-edit").value : buildBody(L),
    closing: L.closing,
    name: name || ph(L.ph.name),
  };
}

const toHtml = (s) => esc(s).replace(new RegExp(`${PH_OPEN}(.*?)${PH_CLOSE}`, "g"), '<span class="ph">$1</span>');
const toPlain = (s) => String(s).replace(new RegExp(`${PH_OPEN}(.*?)${PH_CLOSE}`, "g"), "[$1]");

function renderLetter() {
  const m = letterModel();
  const lang = letterLang();
  $("paper").lang = lang;
  if ($("letter-lang")) $("letter-lang").value = lang;
  $("l-registered").textContent = m.L.registered;
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
  const kt = state.kg?.home || state.gemeinden?.[state.bfs]?.[1];
  const a = canton?.austritt;
  const to = state.manualRecipient?.[0] || state.kg?.n || t("toDefault");
  const items = [
    `<li>${esc(t("c1"))}<small>${esc(t("c1s"))}</small></li>`,
    `<li>${esc(t("c2"))}</li>`,
  ];
  if (a?.beglaubigung) {
    const note = LANG === "de" && a.beglaubigung_note ? a.beglaubigung_note : t("c3note", cname(kt));
    items.push(`<li class="hl">${esc(t("c3"))}<small>${esc(note)}</small></li>`);
  }
  items.push(`<li>${esc(t("c4"))}<small>${esc(t("c4s", to))}</small></li>`);
  items.push(`<li>${esc(t("c5"))}<small>${esc(t("c5s"))}</small></li>`);
  $("checklist").innerHTML = items.join("");
}

function missingFields() {
  const missing = [];
  for (const [id, label] of Object.entries(t("fields"))) {
    const empty = !val(id);
    $(id).setAttribute("aria-invalid", String(empty));
    if (empty) missing.push({ id, label });
  }
  if (!state.manualRecipient && !state.kg) missing.unshift({ id: "ort", label: t("needRecipient") });
  else if (!state.manualRecipient && needsStreet(state.kg)) missing.unshift({ id: "recipient-edit", label: t("needKgStreet") });
  if (document.querySelector('input[name="per"]:checked')?.value === "datum" && !$("per-datum").value) missing.push({ id: "per-datum", label: t("needDate") });
  return missing;
}

function checkReady() {
  const missing = missingFields();
  if (!missing.length) return true;
  setStatus(t("missing", missing.map((m) => m.label).join(", ")), "err");
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
  doc.text(m.L.registered, 118, 48);
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
  const lines = [...bodyLines(m), "", ...doc.splitTextToSize(m.closing, width), "", "", "", toPlain(m.name)];
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
    p(m.L.registered, { size: 16, bold: true, indent: 93 }),
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
  $("letter-lang")?.addEventListener("change", (ev) => {
    state.letterLang = ev.target.value;
    renderLetter();
  });
  $("body-edit").addEventListener("input", () => {
    state.bodyEdited = true;
    $("body-reset").hidden = false;
    $("edit-help").firstChild.textContent = t("bodyEdited");
    renderLetter();
  });
  $("body-reset").addEventListener("click", () => {
    state.bodyEdited = false;
    $("body-reset").hidden = true;
    $("edit-help").firstChild.textContent = t("bodyDefault");
    renderLetter();
  });
  const run = (btn, label, fn) => $(btn).addEventListener("click", async () => {
    if (!checkReady()) return;
    const el = $(btn);
    el.disabled = true;
    setStatus(t("creating", label));
    try { await fn(); setStatus(t("created", label), "ok"); }
    catch (e) { setStatus(t("failed", label), "err"); }
    finally { el.disabled = false; }
  });
  run("btn-pdf", "PDF", downloadPdf);
  run("btn-docx", t("wordFile"), downloadDocx);
  $("btn-print").addEventListener("click", () => { if (checkReady()) window.print(); });
}

// ---------- Start ----------

wireCombo();
wireResult();
wireLetter();
renderLetter();
initTaxSection();
