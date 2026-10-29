#!/usr/bin/env node
// Statische Seiten für Suchmaschinen und KI-Suchen: je Kanton und Sprache eine Seite mit den Regeln und allen
// Kirchgemeinden, eine Übersicht je Sprache, sitemap.xml und llms.txt. Quelle sind data/ und die Texte in
// assets/js/i18n.js. Nach jeder Datenänderung neu ausführen: node tools/build-seo.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { UI, CANTON_NAMES } from "../assets/js/i18n.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SITE = "https://www.teilaustritt.ch";
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const kantone = read("data/kantone.json");
const CANTONS = Object.keys(kantone).filter((k) => /^[A-Z]{2}$/.test(k)).sort();
const today = new Date().toISOString().slice(0, 10);
const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const brandSvg = indexHtml.match(/<svg class="brand-mark"[\s\S]*?<\/svg>/)[0];
const cssVersion = indexHtml.match(/site\.css\?v=([\w]+)/)[1];

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slug = (s) => s.toLowerCase().normalize("NFD").replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")
  .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// Umlaute vor dem Zerlegen ersetzen (Zürich → zuerich, nicht zurich)
const slugDe = (s) => slug(s.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue"));
const loc = (o, key, lang) => (lang !== "de" && o?.[`${key}_${lang}`]) || o?.[key] || "";

// Sprachen: Pfad-Präfix, Ordner der Kantonsseiten, Kantonsname mit Präposition
const FR_IN = { VS: "du Valais", TI: "du Tessin", JU: "du Jura", GR: "des Grisons", AG: "d'Argovie", UR: "d'Uri", OW: "d'Obwald",
  AR: "d'Appenzell Rhodes-Extérieures", AI: "d'Appenzell Rhodes-Intérieures" };
const IT_IN = { TI: "Ticino", GR: "dei Grigioni", VS: "del Vallese", JU: "del Giura", AG: "d'Argovia" };
const L = {
  de: { prefix: "", dir: "kanton", locale: "de-CH", name: (kt) => kantone[kt].name,
    inCanton: (kt) => `im Kanton ${kantone[kt].name}`, ofCanton: (kt) => `Kanton ${kantone[kt].name}` },
  fr: { prefix: "fr/", dir: "canton", locale: "fr-CH", name: (kt) => CANTON_NAMES.fr[kt],
    inCanton: (kt) => `dans le canton ${FR_IN[kt] || `de ${CANTON_NAMES.fr[kt]}`}`, ofCanton: (kt) => `canton ${FR_IN[kt] || `de ${CANTON_NAMES.fr[kt]}`}` },
  it: { prefix: "it/", dir: "cantone", locale: "it-CH", name: (kt) => CANTON_NAMES.it[kt],
    inCanton: (kt) => `nel Cantone ${IT_IN[kt] || `di ${CANTON_NAMES.it[kt]}`}`, ofCanton: (kt) => `Cantone ${IT_IN[kt] || `di ${CANTON_NAMES.it[kt]}`}` },
  en: { prefix: "en/", dir: "canton", locale: "en-GB", name: (kt) => CANTON_NAMES.en[kt],
    inCanton: (kt) => `in the canton of ${CANTON_NAMES.en[kt]}`, ofCanton: (kt) => `canton of ${CANTON_NAMES.en[kt]}` },
};
const LANGS = Object.keys(L);
const pageUrl = (lang, kt) => `${SITE}/${L[lang].prefix}${L[lang].dir}/${kt ? slugDe(L[lang].name(kt)) + "/" : ""}`;
const homeUrl = (lang) => `${SITE}/${L[lang].prefix}`;

const T = {
  de: {
    title: (c) => `Kirchenaustritt ${c} – Kirchgemeinde finden, Austrittsschreiben erstellen | teilaustritt.ch`,
    h1: (c) => `Kirchenaustritt ${c}`,
    desc: (c, n) => n ? `Austritt aus Kirchgemeinde und Landeskirche ${c}: Regeln, Ende der Kirchensteuer und alle ${n} römisch-katholischen Kirchgemeinden mit Postadresse. Austrittsschreiben kostenlos erstellen.`
      : `Kirchenaustritt ${c}: Kirchensteuer, zuständige Stellen und was du tun musst. Austrittsschreiben kostenlos erstellen.`,
    intro: (c, central) => `${c[0].toUpperCase() + c.slice(1)} erklärst du den Austritt aus der römisch-katholischen Landeskirche und Kirchgemeinde (Teilaustritt) schriftlich ${central ? "bei der kantonalen Stelle" : "bei der Kirchgemeinde an deinem Wohnort"}. teilaustritt.ch findet die zuständige Stelle für deinen Wohnort und erstellt das Austrittsschreiben kostenlos, als PDF oder Word.`,
    cta: "Austrittsschreiben erstellen", rules: (c) => `Das gilt ${c}`,
    form: "Schriftlich und von Hand unterschrieben, am besten per Einschreiben oder A-Post Plus.",
    noCert: "Eine amtliche Beglaubigung der Unterschrift ist nicht nötig.",
    body: "Kantonale Körperschaft", church: "Kirche im Kanton", kgHead: (n, c) => `Die ${n} römisch-katholischen Kirchgemeinden ${c}`,
    kgNote: (d) => `Postadressen für das Austrittsschreiben, Stand ${d}. Welche Kirchgemeinde für deinen Wohnort zuständig ist, zeigt der Generator; manche Gemeinden haben mehrere Kirchgemeinden.`,
    tiHead: "Pfarreien mit Kultussteuer (imposta di culto)", website: "Website", from: "ab", until: "bis",
    others: "Kirchenaustritt in den anderen Kantonen", indexTitle: "Kirchenaustritt nach Kanton – alle 26 Kantone | teilaustritt.ch",
    indexH1: "Kirchenaustritt nach Kanton", indexDesc: "Regeln für den Austritt aus Kirchgemeinde und Landeskirche in allen 26 Kantonen, mit den zuständigen römisch-katholischen Kirchgemeinden und Postadressen.",
    indexIntro: "Wie der Austritt aus Kirchgemeinde und Landeskirche funktioniert, regelt jeder Kanton selbst. Wähle deinen Kanton:",
    home: "Startseite", kgCount: (n) => `${n} Kirchgemeinden`, noReg: "anderes System", disclaimer: "Keine Rechtsberatung. Die Angaben stammen aus Gesetzen und den Verzeichnissen der Landeskirchen und Kirchgemeinden.",
  },
  fr: {
    title: (c) => `Sortie d'Église ${c} – trouver la commune ecclésiastique, rédiger la lettre | teilaustritt.ch`,
    h1: (c) => `Sortie d'Église ${c}`,
    desc: (c, n) => n ? `Sortie de la commune ecclésiastique et de l'Église cantonale ${c} : règles, fin de l'impôt ecclésiastique et les ${n} communes ecclésiastiques catholiques romaines avec adresse. Lettre de sortie gratuite.`
      : `Sortie d'Église ${c} : impôt ecclésiastique, instances compétentes et démarches. Lettre de sortie gratuite.`,
    intro: (c, central) => `${c[0].toUpperCase() + c.slice(1)}, vous déclarez par écrit votre sortie de l'Église cantonale catholique romaine et de la commune ecclésiastique (sortie partielle) ${central ? "auprès de l'instance cantonale" : "auprès de la commune ecclésiastique de votre domicile"}. teilaustritt.ch trouve l'instance compétente et rédige gratuitement la lettre, en PDF ou Word.`,
    cta: "Rédiger la lettre de sortie", rules: (c) => `Ce qui s'applique ${c}`,
    form: "Par écrit et signée à la main, de préférence en recommandé ou en Courrier A Plus.",
    noCert: "Une légalisation de la signature n'est pas nécessaire.",
    body: "Corporation cantonale", church: "Église dans le canton", kgHead: (n, c) => `Les ${n} communes ecclésiastiques catholiques romaines ${c}`,
    kgNote: (d) => `Adresses postales pour la lettre de sortie, état au ${d}. Le générateur indique la commune ecclésiastique compétente pour votre domicile ; certaines communes en comptent plusieurs.`,
    tiHead: "Paroisses prélevant un impôt de culte (imposta di culto)", website: "Site web", from: "dès le", until: "jusqu'au",
    others: "Sortie d'Église dans les autres cantons", indexTitle: "Sortie d'Église par canton – les 26 cantons | teilaustritt.ch",
    indexH1: "Sortie d'Église par canton", indexDesc: "Règles de sortie de la commune ecclésiastique et de l'Église cantonale dans les 26 cantons, avec les communes ecclésiastiques catholiques romaines et leurs adresses.",
    indexIntro: "Chaque canton règle lui-même la sortie de la commune ecclésiastique et de l'Église cantonale. Choisissez votre canton :",
    home: "Accueil", kgCount: (n) => `${n} communes ecclésiastiques`, noReg: "autre système", disclaimer: "Pas de conseil juridique. Les indications proviennent des lois et des annuaires des Églises cantonales et des communes ecclésiastiques.",
  },
  it: {
    title: (c) => `Uscita dalla Chiesa ${c} – trovare il comune parrocchiale, preparare la lettera | teilaustritt.ch`,
    h1: (c) => `Uscita dalla Chiesa ${c}`,
    desc: (c, n) => n ? `Uscita dal comune parrocchiale e dalla Chiesa cantonale ${c}: regole, fine dell'imposta ecclesiastica e tutti i ${n} comuni parrocchiali cattolici romani con indirizzo. Lettera di uscita gratuita.`
      : `Uscita dalla Chiesa ${c}: imposta ecclesiastica, uffici competenti e cosa fare. Lettera di uscita gratuita.`,
    intro: (c, central) => `${c[0].toUpperCase() + c.slice(1)} dichiari per iscritto l'uscita dalla Chiesa cantonale cattolica romana e dal comune parrocchiale (uscita parziale) ${central ? "presso l'ufficio cantonale" : "presso il comune parrocchiale del tuo domicilio"}. teilaustritt.ch trova l'ufficio competente e prepara gratuitamente la lettera, in PDF o Word.`,
    cta: "Preparare la lettera di uscita", rules: (c) => `Cosa vale ${c}`,
    form: "Per iscritto e firmata a mano, preferibilmente per raccomandata o Posta A Plus.",
    noCert: "Non serve l'autenticazione della firma.",
    body: "Corporazione cantonale", church: "Chiesa nel Cantone", kgHead: (n, c) => `I ${n} comuni parrocchiali cattolici romani ${c}`,
    kgNote: (d) => `Indirizzi postali per la lettera di uscita, stato al ${d}. Il generatore indica il comune parrocchiale competente per il tuo domicilio; alcuni comuni ne hanno più d'uno.`,
    tiHead: "Parrocchie che prelevano l'imposta di culto", website: "Sito web", from: "dal", until: "fino al",
    others: "Uscita dalla Chiesa negli altri Cantoni", indexTitle: "Uscita dalla Chiesa per Cantone – tutti i 26 Cantoni | teilaustritt.ch",
    indexH1: "Uscita dalla Chiesa per Cantone", indexDesc: "Regole per l'uscita dal comune parrocchiale e dalla Chiesa cantonale in tutti i 26 Cantoni, con i comuni parrocchiali cattolici romani e i loro indirizzi.",
    indexIntro: "Ogni Cantone regola autonomamente l'uscita dal comune parrocchiale e dalla Chiesa cantonale. Scegli il tuo Cantone:",
    home: "Pagina iniziale", kgCount: (n) => `${n} comuni parrocchiali`, noReg: "altro sistema", disclaimer: "Nessuna consulenza legale. Le indicazioni provengono dalle leggi e dagli elenchi delle Chiese cantonali e dei comuni parrocchiali.",
  },
  en: {
    title: (c) => `Leaving the church ${c} – find your church municipality, create the letter | teilaustritt.ch`,
    h1: (c) => `Leaving the church ${c}`,
    desc: (c, n) => n ? `Leaving the church municipality and cantonal church ${c}: rules, end of church tax and all ${n} Roman Catholic church municipalities with postal address. Create your letter for free.`
      : `Leaving the church ${c}: church tax, responsible offices and what to do. Create your letter for free.`,
    intro: (c, central) => `${c[0].toUpperCase() + c.slice(1)}, you declare in writing that you are leaving the Roman Catholic cantonal church and church municipality (partial withdrawal) ${central ? "to the cantonal office" : "to the church municipality where you live"}. teilaustritt.ch finds the responsible office and creates the letter for free, as PDF or Word.`,
    cta: "Create your letter", rules: (c) => `What applies ${c}`,
    form: "In writing and signed by hand, preferably by registered mail or A-Post Plus.",
    noCert: "Your signature does not need to be officially certified.",
    body: "Cantonal church body", church: "Church in the canton", kgHead: (n, c) => `The ${n} Roman Catholic church municipalities ${c}`,
    kgNote: (d) => `Postal addresses for your letter, as of ${d}. The generator shows which church municipality is responsible for your address; some municipalities have several.`,
    tiHead: "Parishes levying a worship tax (imposta di culto)", website: "Website", from: "from", until: "until",
    others: "Leaving the church in the other cantons", indexTitle: "Leaving the church by canton – all 26 cantons | teilaustritt.ch",
    indexH1: "Leaving the church by canton", indexDesc: "Rules for leaving the church municipality and cantonal church in all 26 cantons, with the Roman Catholic church municipalities and their postal addresses.",
    indexIntro: "Each canton sets its own rules for leaving the church municipality and cantonal church. Choose your canton:",
    home: "Home", kgCount: (n) => `${n} church municipalities`, noReg: "different system", disclaimer: "Not legal advice. The information comes from laws and the directories of the cantonal churches and church municipalities.",
  },
};

const fmtDate = (iso, lang) => new Intl.DateTimeFormat(L[lang].locale, { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));

function currentKgs(kt) {
  if (!kantone[kt].register) return [];
  const reg = read(`data/kg/${kt}.json`);
  return Object.entries(reg.kg).map(([id, k]) => ({ id, ...k })).sort((a, b) => a.n.localeCompare(b.n, "de"));
}

function page({ lang, title, desc, url, alternates, h1, body, breadcrumb }) {
  const p = L[lang];
  const rel = "../".repeat(url.replace(SITE + "/", "").split("/").filter(Boolean).length);
  const langLinks = LANGS.map((l) => `<a href="${esc(alternates[l])}" lang="${l}"${l === lang ? ' aria-current="page"' : ` hreflang="${l}"`}>${l.toUpperCase()}</a>`).join("\n        ");
  const ld = { "@context": "https://schema.org", "@graph": [
    { "@type": "WebPage", name: title, description: desc, url, inLanguage: p.locale, isPartOf: { "@type": "WebSite", name: "teilaustritt.ch", url: SITE + "/" },
      publisher: { "@type": "Organization", name: "Verein Vera Fides", url: "https://verafides.ch/" }, dateModified: today },
    { "@type": "BreadcrumbList", itemListElement: breadcrumb.map(([name, item], i) => ({ "@type": "ListItem", position: i + 1, name, item })) },
  ] };
  return `<!DOCTYPE html>
<html lang="${p.locale}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">
  <link rel="canonical" href="${esc(url)}">
${LANGS.map((l) => `  <link rel="alternate" hreflang="${l}" href="${esc(alternates[l])}">`).join("\n")}
  <link rel="alternate" hreflang="x-default" href="${esc(alternates.de)}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${esc(url)}">
  <meta property="og:image" content="${SITE}/assets/img/og-${lang}.png">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="${rel}assets/img/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="${rel}assets/img/favicon-32.png" sizes="32x32" type="image/png">
  <link rel="apple-touch-icon" href="${rel}assets/img/apple-touch-icon.png">
  <link rel="stylesheet" href="${rel}assets/css/site.css?v=${cssVersion}">
  <script type="application/ld+json">${JSON.stringify(ld)}</script>
</head>
<body>
  <header class="site-head">
    <div class="wrap">
      <a class="brand" href="${esc(homeUrl(lang))}">
        ${brandSvg}
        <span><strong><em class="brand-teil">teil</em>austritt.ch</strong></span>
      </a>
      <div class="head-right">
      <nav class="langs" aria-label="Sprache / Langue / Lingua / Language">
        ${langLinks}
      </nav>
      </div>
    </div>
  </header>
  <main id="main" class="wrap seo-page">
    <nav class="crumbs small" aria-label="Breadcrumb">${breadcrumb.map(([name, item], i) => i < breadcrumb.length - 1 ? `<a href="${esc(item)}">${esc(name)}</a> › ` : esc(name)).join("")}</nav>
    <h1>${esc(h1)}</h1>
${body}
  </main>
  <footer class="site-foot">
    <div class="wrap">teilaustritt.ch · Verein Vera Fides · ${esc(T[lang].disclaimer)}</div>
  </footer>
</body>
</html>
`;
}

function cantonPage(lang, kt) {
  const t = T[lang], c = kantone[kt], p = L[lang];
  const kgs = currentKgs(kt);
  const central = c.austritt?.recipient_level === "kanton";
  const inC = p.inCanton(kt);
  const tax = c.steuer || {};
  const facts = [];
  if (c.register) {
    facts.push(t.form);
    facts.push(c.austritt?.beglaubigung ? UI[lang].certified : t.noCert);
  }
  // Ende der Steuerpflicht nur dort, wo es eine Kirchensteuer gibt (sonst widerspricht es der Beschreibung)
  if (tax.system === "pflicht" && UI[lang].taxEnd?.[tax.ende]) facts.push(UI[lang].taxEnd[tax.ende]);
  if (loc(tax, "tipp", lang)) facts.push(loc(tax, "tipp", lang));
  if (loc(c.austritt, "public_hinweis", lang)) facts.push(loc(c.austritt, "public_hinweis", lang));
  const summary = !c.register ? loc(c, "summary", lang) : "";
  // Kurzname statt des langen Namens (der enthält teils Recherche-Klammern)
  const bodyName = c.body?.short || (c.body?.name || "").replace(/\s*\(.*\)\s*$/, "");
  const bodyLine = bodyName ? `<p class="small">${esc(c.register ? t.body : t.church)}: ${c.body.website ? `<a href="${esc(c.body.website)}" rel="noopener">${esc(bodyName)}</a>` : esc(bodyName)}${c.body.postal ? `, ${esc(c.body.postal.slice(1).join(", "))}` : ""}</p>` : "";
  const dated = (k) => k.ab ? ` <span class="small">(${esc(t.from)} ${esc(fmtDate(k.ab, lang))})</span>` : k.bis ? ` <span class="small">(${esc(t.until)} ${esc(fmtDate(k.bis, lang))})</span>` : "";
  const kgList = kgs.length ? `
    <section class="section">
      <h2>${esc(t.kgHead(kgs.length, inC))}</h2>
      <p class="small">${esc(t.kgNote(fmtDate(read(`data/kg/${kt}.json`).stand, lang)))}</p>
      <ul class="kg-list">
${kgs.map((k) => `        <li><strong>${esc(k.n)}</strong>${dated(k)}<br>${(k.p[0] === k.n ? k.p.slice(1) : k.p).map(esc).join("<br>")}${k.w ? `<br><a href="${esc(k.w)}" rel="noopener">${esc(t.website)}</a>` : ""}</li>`).join("\n")}
      </ul>
    </section>` : "";
  let tiList = "";
  if (kt === "TI" && fs.existsSync(path.join(ROOT, "data/ti-imposta.json"))) {
    const ti = read("data/ti-imposta.json");
    const seen = new Set(), rows = [];
    for (const list of Object.values(ti.bfs)) for (const e of list) if (!seen.has(e.n)) { seen.add(e.n); rows.push(e); }
    rows.sort((a, b) => a.n.localeCompare(b.n, "it"));
    tiList = `
    <section class="section">
      <h2>${esc(t.tiHead)}</h2>
      <ul class="kg-list">
${rows.map((e) => `        <li><strong>${esc(e.n)}</strong>${e.z ? ` <span class="small">· ${esc(e.z)}</span>` : ""}<br>${e.p.slice(1).map(esc).join("<br>")}</li>`).join("\n")}
      </ul>
    </section>`;
  }
  const others = CANTONS.filter((x) => x !== kt).map((x) => `<a href="${esc(pageUrl(lang, x))}">${esc(p.name(x))}</a>`).join(" · ");
  const body = `    <p class="lead">${esc(c.register ? t.intro(inC, central) : summary)}</p>
    <p><a class="btn" href="${esc(homeUrl(lang))}#tool">${esc(t.cta)}</a></p>
    <section class="section">
      <h2>${esc(t.rules(inC))}</h2>
      <ul class="seo-facts">
${facts.map((f) => `        <li>${esc(f)}</li>`).join("\n")}
      </ul>
      ${bodyLine}
    </section>${kgList}${tiList}
    <section class="section">
      <h2>${esc(t.others)}</h2>
      <p class="small">${others}</p>
    </section>`;
  const alternates = Object.fromEntries(LANGS.map((l) => [l, pageUrl(l, kt)]));
  return page({ lang, title: t.title(inC), desc: t.desc(inC, kgs.length), url: pageUrl(lang, kt), alternates, h1: t.h1(inC), body,
    breadcrumb: [[t.home, homeUrl(lang)], [t.indexH1, pageUrl(lang)], [p.name(kt), pageUrl(lang, kt)]] });
}

function indexPage(lang) {
  const t = T[lang], p = L[lang];
  const items = CANTONS.map((kt) => [p.name(kt), kt]).sort((a, b) => a[0].localeCompare(b[0], lang))
    .map(([name, kt]) => `        <li><a href="${esc(pageUrl(lang, kt))}">${esc(name)}</a> <span class="small">${esc(kantone[kt].register ? t.kgCount(currentKgs(kt).length) : t.noReg)}</span></li>`).join("\n");
  const body = `    <p class="lead">${esc(t.indexIntro)}</p>
    <ul class="canton-list">
${items}
    </ul>
    <p><a class="btn" href="${esc(homeUrl(lang))}#tool">${esc(t.cta)}</a></p>`;
  const alternates = Object.fromEntries(LANGS.map((l) => [l, pageUrl(l)]));
  return page({ lang, title: t.indexTitle, desc: t.indexDesc, url: pageUrl(lang), alternates, h1: t.indexH1, body,
    breadcrumb: [[t.home, homeUrl(lang)], [t.indexH1, pageUrl(lang)]] });
}

// Seiten schreiben (alte Kantonsordner vorher leeren, damit umbenannte Seiten nicht liegen bleiben)
const urls = [];
for (const lang of LANGS) {
  const dir = path.join(ROOT, L[lang].prefix, L[lang].dir);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), indexPage(lang));
  for (const kt of CANTONS) {
    const d = path.join(dir, slugDe(L[lang].name(kt)));
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "index.html"), cantonPage(lang, kt));
  }
}

// sitemap.xml: Startseiten, Übersichten, Kantonsseiten, je mit Sprachverknüpfungen
const groups = [Object.fromEntries(LANGS.map((l) => [l, homeUrl(l)])), Object.fromEntries(LANGS.map((l) => [l, pageUrl(l)])),
  ...CANTONS.map((kt) => Object.fromEntries(LANGS.map((l) => [l, pageUrl(l, kt)])))];
let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n';
for (const g of groups) {
  const alts = LANGS.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${g[l]}"/>\n`).join("") + `    <xhtml:link rel="alternate" hreflang="x-default" href="${g.de}"/>\n`;
  for (const l of LANGS) { xml += `  <url>\n    <loc>${g[l]}</loc>\n    <lastmod>${today}</lastmod>\n${alts}  </url>\n`; urls.push(g[l]); }
}
fs.writeFileSync(path.join(ROOT, "sitemap.xml"), xml + "</urlset>\n");

// llms.txt: kurze Beschreibung für KI-Suchen (Format nach llmstxt.org)
const llms = `# teilaustritt.ch

> Kostenloser, neutraler Formular-Generator des Vereins Vera Fides: Er findet zu jeder Schweizer Postleitzahl die zuständige römisch-katholische Kirchgemeinde mit Postadresse und erstellt das Schreiben für den Austritt aus Kirchgemeinde und Landeskirche (Teilaustritt, staatskirchenrechtliche Körperschaft, Kirchensteuer). Deutsch, Französisch, Italienisch, Englisch.

Wichtig:
- Ein Teilaustritt ist der Austritt aus der öffentlich-rechtlichen Körperschaft (Kirchgemeinde und Landeskirche), die die Kirchensteuer erhebt; er bedeutet nicht zwingend einen Bruch mit der römisch-katholischen Kirche als Glaubensgemeinschaft.
- Zuständig ist die Kirchgemeinde am Wohnsitz (FR: Pfarreirat, TI: Consiglio parrocchiale); die Erklärung muss schriftlich und von Hand unterschrieben sein. In Appenzell Ausserrhoden und St. Gallen muss die Unterschrift amtlich beglaubigt werden.
- Die Kirchensteuerpflicht endet je nach Kanton sofort mit dem Eingang der Erklärung, ab dem Folgemonat oder für das ganze Austrittsjahr. In Waadt, Neuenburg, Genf, Wallis und Tessin gilt ein anderes System.
- Die Seite enthält einen Kirchensteuer-Schätzer je Gemeinde (Werte aus dem Steuerrechner der ESTV) und prüft Adressen gegen das amtliche Gebäudeadressverzeichnis. Die Angaben verlassen den Browser nicht. Keine Rechtsberatung.

## Generator
- [teilaustritt.ch (Deutsch)](${SITE}/): Kirchgemeinde per PLZ finden, Austrittsschreiben als PDF oder Word
- [Français](${SITE}/fr/) · [Italiano](${SITE}/it/) · [English](${SITE}/en/)

## Kirchenaustritt nach Kanton
${CANTONS.map((kt) => `- [Kirchenaustritt ${L.de.inCanton(kt)}](${pageUrl("de", kt)}): ${kantone[kt].register ? `${currentKgs(kt).length} Kirchgemeinden mit Adresse, Regeln, Ende der Kirchensteuer` : "anderes System, Kirchensteuer und zuständige Stellen"}`).join("\n")}

## Betreiber
- [Verein Vera Fides](https://verafides.ch/): Herausgeber, Kontakt redaktion@verafides.ch
`;
fs.writeFileSync(path.join(ROOT, "llms.txt"), llms);
console.log(`${LANGS.length * (CANTONS.length + 1)} Seiten, ${urls.length} URLs in sitemap.xml, llms.txt geschrieben`);
