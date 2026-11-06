/* swissEO Sentinel-2 availability calendar.
 *
 * Sources (all fetched by the browser, CORS enabled):
 *   - STAC items of ch.swisstopo.swisseo_s2-sr_v200   -> available scenes, thumbnails, catalog latency
 *   - dates_with_no_imagery.csv of the same collection -> cloudy / no candidate scene / upload incomplete
 *   - acquisitionplan.csv of this repository          -> planned acquisitions (ESA KML, Switzerland AOI)
 *
 * URL options: ?lang=en|de  ?embed=1 (no header/side panel, for iframes)  #YYYY-MM or #YYYY-MM-DD
 */
(function () {
    "use strict";

    const COLLECTION = "ch.swisstopo.swisseo_s2-sr_v200";
    const CONFIG = {
        collection: COLLECTION,
        itemPrefix: "swisseo_s2-sr_v200",
        stacItems: `https://data.geo.admin.ch/api/stac/v1/collections/${COLLECTION}/items`,
        noImageryCSV: `https://data.geo.admin.ch/${COLLECTION}/dates_with_no_imagery.csv`,
        planCSV: ["acquisitionplan.csv",
            "https://raw.githubusercontent.com/davidoesch/Sentinel-2-Acquisition-Plan-Harvesting/refs/heads/main/acquisitionplan.csv"],
        orbitImg: (orbit) => `assets/${orbit}.png`,
        browser: (id) => `https://data.geo.admin.ch/browser/index.html#/collections/${COLLECTION}/items/${id}`,
        mapViewer: (id) => `https://map.geo.admin.ch/index.html?layers=WMS||${CONFIG.itemPrefix}_${id}||https://wms.geo.admin.ch/?item=${id}||${COLLECTION}`,
        timeZone: "Europe/Zurich",
        recentDays: 30, // window for the "typical latency" used for planned acquisitions
    };

    const I18N = {
        de: {
            title: "swissEO Sentinel-2 Datenverfügbarkeit",
            subtitle: `Szenen der Kollektion <a href="https://data.geo.admin.ch/browser/index.html#/collections/${COLLECTION}" target="_blank" rel="noopener">swissEO S2-SR v200</a>, Tage ohne Bilddaten und geplante Aufnahmen über der Schweiz.`,
            navCalendar: "Kalender", navLatency: "Latenzkarte",
            prev: "Vorheriger Monat", next: "Nächster Monat", today: "Heute",
            lgScene: "Szene verfügbar", lgPlan: "Geplant", lgCloud: "Bewölkt", lgNone: "Keine Szene", lgWarn: "Unvollständig", lgLat: "Latenz",
            scenes: "Szenen", sceneDays: "Tage mit Szene", cloudyDays: "bewölkte Tage", noneDays: "ohne Szene",
            medLatency: "Median-Latenz im Monat", nextPlan: "Nächste geplante Aufnahme",
            cloudy: "bewölkt", none: "keine Szene", incomplete: "Upload unvollständig", pending: "ausstehend", planned: "geplant",
            acquired: "Aufnahme", published: "Publiziert", latency: "Latenz", item: "Item",
            satellite: "Satellit", orbit: "Relativer Orbit", expected: "Erwartete Publikation",
            expectedTxt: (h, n) => `typisch ~${h} nach Aufnahme (Median der letzten ${n} Szenen)`,
            openMap: "Auf map.geo.admin", openStac: "STAC Browser", metadata: "Metadaten",
            pickDay: "Tag anklicken für Details.",
            noData: "Für diesen Tag liegen keine Informationen vor.",
            reasonCloudy: "Szene aufgenommen, aber zu bewölkt für ein Mosaik.",
            reasonNone: "Kein passender Sentinel-2-Überflug.",
            reasonIncomplete: "Verarbeitung lief, aber der Upload ist unvollständig.",
            pendingTxt: "Aufnahme war geplant; noch keine Szene im Katalog.",
            plannedTxt: "Geplanter Sentinel-2-Überflug über der Schweiz (ESA-Akquisitionsplan).",
            loadErr: "Daten konnten nicht geladen werden",
            inDays: (n) => (n === 0 ? "heute" : n === 1 ? "morgen" : `in ${n} Tagen`),
            noThumb: "kein Vorschaubild",
            locale: "de-CH",
        },
        en: {
            title: "swissEO Sentinel-2 data availability",
            subtitle: `Scenes of the <a href="https://data.geo.admin.ch/browser/index.html#/collections/${COLLECTION}" target="_blank" rel="noopener">swissEO S2-SR v200</a> collection, days without imagery and planned acquisitions over Switzerland.`,
            navCalendar: "Calendar", navLatency: "Latency map",
            prev: "Previous month", next: "Next month", today: "Today",
            lgScene: "Scene available", lgPlan: "Planned", lgCloud: "Cloudy", lgNone: "No scene", lgWarn: "Incomplete", lgLat: "Latency",
            scenes: "scenes", sceneDays: "days with a scene", cloudyDays: "cloudy days", noneDays: "without scene",
            medLatency: "Median latency this month", nextPlan: "Next planned acquisition",
            cloudy: "cloudy", none: "no scene", incomplete: "upload incomplete", pending: "pending", planned: "planned",
            acquired: "Acquired", published: "Published", latency: "Latency", item: "Item",
            satellite: "Satellite", orbit: "Relative orbit", expected: "Expected publication",
            expectedTxt: (h, n) => `typically ~${h} after acquisition (median of the last ${n} scenes)`,
            openMap: "Open on map.geo.admin", openStac: "STAC Browser", metadata: "Metadata",
            pickDay: "Click a day for details.",
            noData: "No information for this day.",
            reasonCloudy: "Scene acquired, but too cloudy for a mosaic.",
            reasonNone: "No suitable Sentinel-2 overpass.",
            reasonIncomplete: "Processing ran, but the upload is incomplete.",
            pendingTxt: "An acquisition was planned; no scene in the catalog yet.",
            plannedTxt: "Planned Sentinel-2 overpass over Switzerland (ESA acquisition plan).",
            loadErr: "Could not load data",
            inDays: (n) => (n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`),
            noThumb: "no preview",
            locale: "en-GB",
        },
    };

    const params = new URLSearchParams(location.search);
    const LANG = params.get("lang") === "en" ? "en" : params.get("lang") === "de" ? "de" : "de";
    const T = I18N[LANG];

    const BINS = [
        { max: 8, v: "--seq-1" }, { max: 12, v: "--seq-2" }, { max: 24, v: "--seq-3" },
        { max: 48, v: "--seq-4" }, { max: Infinity, v: "--seq-5" },
    ];

    const ICON = {
        cloud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18h10.5a4 4 0 0 0 .4-7.98A6 6 0 0 0 6.2 11.1 3.5 3.5 0 0 0 7 18z"/></svg>',
        none: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M8 12h8"/></svg>',
        warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2v.1"/></svg>',
        map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/></svg>',
        ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
    };

    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const median = (a) => {
        if (!a.length) return null;
        const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
        return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
    const fmtH = (h) => (h == null ? "–" : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} d`);
    const binColor = (h) => `var(${BINS.find((b) => h < b.max).v})`;

    // ---- dates (all ISO yyyy-mm-dd, UTC arithmetic) ----
    const iso = (d) => d.toISOString().slice(0, 10);
    const parseDay = (s) => new Date(s + "T00:00:00Z");
    const addDays = (s, n) => iso(new Date(parseDay(s).getTime() + n * 864e5));
    const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: CONFIG.timeZone }).format(new Date());
    const fmtTime = (ts) => new Intl.DateTimeFormat(T.locale, { timeZone: CONFIG.timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(ts));
    const fmtDateTime = (ts) => new Intl.DateTimeFormat(T.locale, { timeZone: CONFIG.timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(ts));
    const fmtLong = (s) => new Intl.DateTimeFormat(T.locale, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(parseDay(s));
    const fmtShort = (s) => new Intl.DateTimeFormat(T.locale, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(parseDay(s));
    const fmtMonth = (y, m) => new Intl.DateTimeFormat(T.locale, { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(Date.UTC(y, m, 1)));

    // ---- state ----
    const today = todayIso();
    const state = { y: +today.slice(0, 4), m: +today.slice(5, 7) - 1, sel: today };
    const stacCache = new Map(); // "start/end" -> Promise<scenes[]>
    let noImagery = new Map();   // date -> remark
    let plan = new Map();        // date -> [{orbit, platform}]
    let recentLatency = { h: null, n: 0 };
    let renderToken = 0;

    // ---------------------------------------------------------------- loading
    async function fetchText(urls) {
        let lastErr;
        for (const url of [].concat(urls)) {
            try {
                const r = await fetch(url, { cache: "no-cache" });
                if (r.ok) return await r.text();
                lastErr = new Error(`${url}: HTTP ${r.status}`);
            } catch (e) { lastErr = e; }
        }
        throw lastErr;
    }

    function csvRows(text) {
        return text.trim().split(/\r?\n/).slice(1).filter(Boolean).map((l) => l.split(","));
    }

    async function loadNoImagery() {
        const map = new Map();
        for (const [, date, ...rest] of csvRows(await fetchText(CONFIG.noImageryCSV))) {
            if (date) map.set(date.trim(), rest.join(",").trim());
        }
        return map;
    }

    async function loadPlan() {
        const map = new Map();
        for (const [acq, , orbit, platform] of csvRows(await fetchText(CONFIG.planCSV))) {
            if (!acq) continue;
            if (!map.has(acq)) map.set(acq, []);
            map.get(acq).push({ orbit: orbit.trim(), platform: platform.trim() });
        }
        return map;
    }

    /** STAC scenes acquired in [start, end] (inclusive dates). */
    function loadScenes(start, end) {
        const key = `${start}/${end}`;
        if (!stacCache.has(key)) {
            stacCache.set(key, (async () => {
                const out = [];
                let url = `${CONFIG.stacItems}?datetime=${start}T00:00:00Z/${end}T23:59:59Z&limit=100`;
                while (url) {
                    const r = await fetch(url);
                    if (!r.ok) throw new Error(`STAC HTTP ${r.status}`);
                    const d = await r.json();
                    for (const f of d.features || []) {
                        if (!/^\d{4}-\d{2}-\d{2}t\d{6}$/.test(f.id || "")) continue; // skip collection-level items
                        const p = f.properties || {};
                        const thumb = Object.entries(f.assets || {}).find(([k]) => /^thumbnail\./.test(k));
                        const meta = Object.entries(f.assets || {}).find(([k]) => /metadata\.json$/.test(k));
                        const lat = p.created ? (Date.parse(p.created) - Date.parse(p.datetime)) / 36e5 : null;
                        out.push({
                            id: f.id,
                            date: p.datetime.slice(0, 10),
                            acquired: p.datetime,
                            created: p.created || null,
                            latency: lat != null && lat >= 0 ? lat : null,
                            thumb: thumb ? thumb[1].href : null,
                            metadata: meta ? meta[1].href : null,
                        });
                    }
                    const next = (d.links || []).find((l) => l.rel === "next");
                    url = next ? next.href : null;
                }
                return out.sort((a, b) => a.acquired.localeCompare(b.acquired));
            })().catch((e) => { stacCache.delete(key); throw e; }));
        }
        return stacCache.get(key);
    }

    // ---------------------------------------------------------------- grid
    function gridRange(y, m) {
        const first = iso(new Date(Date.UTC(y, m, 1)));
        const last = iso(new Date(Date.UTC(y, m + 1, 0)));
        const dow = (parseDay(first).getUTCDay() + 6) % 7; // Monday = 0
        const start = addDays(first, -dow);
        const lastDow = (parseDay(last).getUTCDay() + 6) % 7;
        const end = addDays(last, 6 - lastDow);
        return { first, last, start, end };
    }

    function classify(day, scenesByDate) {
        const scenes = scenesByDate.get(day) || [];
        const remark = noImagery.get(day) || null;
        const planned = plan.get(day) || [];
        if (scenes.length) return { kind: "scene", scenes, remark, planned };
        // The no-imagery CSV is written early in the morning, before the overpass:
        // a "No candidate scene" for today/future with a planned overpass is premature.
        const premature = remark && planned.length && day >= today && /no candidate/i.test(remark);
        if (remark && !premature) {
            const r = remark.toLowerCase();
            const kind = r.includes("cloud") ? "cloudy" : r.includes("incomplete") ? "incomplete" : "none";
            return { kind, remark, planned };
        }
        if (planned.length) return { kind: day >= today ? "planned" : "pending", planned };
        return { kind: "blank" };
    }

    function dayHtml(day, info, inMonth) {
        const cls = ["day", inMonth ? "" : "out", day === today ? "today" : "", day === state.sel ? "sel" : "",
            info.kind === "blank" ? "blank" : ""].filter(Boolean).join(" ");
        const num = `<div class="dnum"><span class="n">${+day.slice(8)}</span><span class="long">${esc(fmtShort(day))}</span></div>`;
        let body = "";
        if (info.kind === "scene") {
            body = `<div class="thumbs">${info.scenes.map((s) => `<div class="th">${s.thumb
                ? `<img src="${esc(s.thumb)}" alt="" loading="lazy" onerror="this.remove()">`
                : `<span class="noimg">${T.noThumb}</span>`}</div>`).join("")}</div>
                <div class="meta"><span>${info.scenes.map((s) => fmtTime(s.acquired)).join(" · ")}</span>${info.scenes[0].latency != null
                ? `<span class="lat"><i style="background:${binColor(info.scenes[0].latency)}"></i>${fmtH(info.scenes[0].latency)}</span>` : ""}</div>`;
        } else if (info.kind === "planned" || info.kind === "pending") {
            body = info.planned.map((p) => `<div class="plan${info.kind === "pending" ? " past" : ""}">
                <img src="${esc(CONFIG.orbitImg(p.orbit))}" alt="" loading="lazy" onerror="this.remove()">
                <span class="pl">${esc(p.platform)} · ${info.kind === "pending" ? T.pending : `R${esc(p.orbit)}`}</span></div>`).join("");
        } else if (info.kind === "cloudy") {
            body = `<div class="empty-reason">${ICON.cloud}<span>${T.cloudy}</span></div>`;
        } else if (info.kind === "incomplete") {
            body = `<div class="empty-reason warn">${ICON.warn}<span>${T.incomplete}</span></div>`;
        } else if (info.kind === "none") {
            body = `<div class="empty-reason">${ICON.none}<span>${T.none}</span></div>`;
        }
        const label = `${fmtLong(day)}: ${{ scene: T.lgScene, planned: T.planned, pending: T.pending, cloudy: T.cloudy, incomplete: T.incomplete, none: T.none, blank: "" }[info.kind]}`;
        return `<button type="button" role="gridcell" class="${cls}" data-day="${day}" aria-label="${esc(label)}" aria-selected="${day === state.sel}">${num}<div class="body">${body}</div></button>`;
    }

    async function render() {
        const token = ++renderToken;
        const { y, m } = state;
        const { first, last, start, end } = gridRange(y, m);
        $("month-label").textContent = fmtMonth(y, m);
        writeHash();

        const days = [];
        for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);

        // draw immediately with what we have (plan + no-imagery), then fill in scenes
        const draw = (scenes) => {
            const byDate = new Map();
            for (const s of scenes || []) {
                if (!byDate.has(s.date)) byDate.set(s.date, []);
                byDate.get(s.date).push(s);
            }
            $("cal-grid").innerHTML = days.map((d) => dayHtml(d, classify(d, byDate), d >= first && d <= last)).join("");
            return byDate;
        };

        $("cal").classList.add("loading");
        draw(null);
        $("status").textContent = "";
        try {
            const scenes = await loadScenes(start, end);
            if (token !== renderToken) return;
            const byDate = draw(scenes);
            renderStats(scenes.filter((s) => s.date >= first && s.date <= last), first, last, byDate);
            renderDetail(byDate);
            prefetch(y, m);
        } catch (err) {
            if (token !== renderToken) return;
            $("status").textContent = `${T.loadErr}: ${err.message}`;
        } finally {
            if (token === renderToken) $("cal").classList.remove("loading");
        }
    }

    function prefetch(y, m) {
        [-1, 1].forEach((k) => {
            const d = new Date(Date.UTC(y, m + k, 1));
            const r = gridRange(d.getUTCFullYear(), d.getUTCMonth());
            if (r.start <= today) loadScenes(r.start, r.end).catch(() => {});
        });
    }

    // ---------------------------------------------------------------- stats + detail
    function renderStats(monthScenes, first, last, byDate) {
        let cloudy = 0, none = 0;
        for (let d = first; d <= last; d = addDays(d, 1)) {
            const k = classify(d, byDate).kind;
            if (k === "cloudy") cloudy++;
            if (k === "none") none++;
        }
        const sceneDays = new Set(monthScenes.map((s) => s.date)).size;
        const lat = median(monthScenes.map((s) => s.latency).filter((h) => h != null));
        const next = [...plan.keys()].filter((d) => d >= today).sort()[0];
        const nextTxt = next
            ? `${esc(fmtShort(next))} <small>${T.inDays(Math.round((parseDay(next) - parseDay(today)) / 864e5))} · ${plan.get(next).map((p) => esc(p.platform)).join(", ")}</small>`
            : "–";
        const tiles = [
            [`${monthScenes.length} <small>${T.scenes}</small>`, `${sceneDays} ${T.sceneDays}`],
            [`${cloudy}`, `${T.cloudyDays} · ${none} ${T.noneDays}`],
            [lat == null ? "–" : `<span class="lat"><i style="background:${binColor(lat)}"></i>${fmtH(lat)}</span>`, T.medLatency],
            [nextTxt, T.nextPlan],
        ];
        $("stats").innerHTML = tiles.map(([v, l]) => `<div class="tile"><div class="v">${v}</div><div class="l">${l}</div></div>`).join("");
    }

    function renderDetail(byDate) {
        const day = state.sel;
        const box = $("detail");
        if (!day) { box.innerHTML = `<p class="hint">${T.pickDay}</p>`; return; }
        const info = classify(day, byDate || new Map());
        let html = `<h3>${esc(fmtLong(day))}</h3>`;

        if (info.kind === "scene") {
            html += info.scenes.map((s) => `<div class="scene">
                <div class="big">${s.thumb ? `<img src="${esc(s.thumb)}" alt="Sentinel-2 ${esc(s.id)}" onerror="this.remove()">` : `<span class="noimg">${T.noThumb}</span>`}</div>
                <dl>
                  <dt>${T.acquired}</dt><dd>${fmtTime(s.acquired)}</dd>
                  <dt>${T.published}</dt><dd>${s.created ? fmtDateTime(s.created) : "–"}</dd>
                  <dt>${T.latency}</dt><dd>${s.latency != null ? `<span class="lat"><i style="background:${binColor(s.latency)}"></i>${fmtH(s.latency)}</span>` : "–"}</dd>
                  <dt>${T.item}</dt><dd>${esc(s.id)}</dd>
                </dl>
                <div class="links">
                  <a class="primary" href="${esc(CONFIG.mapViewer(s.id))}" target="_blank" rel="noopener">${ICON.map}${T.openMap}</a>
                  <a href="${esc(CONFIG.browser(s.id))}" target="_blank" rel="noopener">${ICON.ext}${T.openStac}</a>
                  ${s.metadata ? `<a href="${esc(s.metadata)}" target="_blank" rel="noopener">${ICON.ext}${T.metadata}</a>` : ""}
                </div></div>`).join("");
            if (info.remark) html += `<p class="hint">${esc(info.remark)}</p>`;
        } else if (info.kind === "planned" || info.kind === "pending") {
            html += `<p class="hint">${info.kind === "pending" ? T.pendingTxt : T.plannedTxt}</p>`;
            html += info.planned.map((p) => `<div class="scene">
                <div class="big plan-img"><img src="${esc(CONFIG.orbitImg(p.orbit))}" alt="Orbit ${esc(p.orbit)}" onerror="this.remove()"></div>
                <dl>
                  <dt>${T.satellite}</dt><dd>Sentinel-${esc(p.platform.slice(1))}</dd>
                  <dt>${T.orbit}</dt><dd>${esc(p.orbit)}</dd>
                  ${recentLatency.h != null ? `<dt>${T.expected}</dt><dd>${T.expectedTxt(fmtH(recentLatency.h), recentLatency.n)}</dd>` : ""}
                </dl></div>`).join("");
        } else if (info.kind === "blank") {
            html += `<p class="hint">${T.noData}</p>`;
        } else {
            const [icon, txt] = info.kind === "cloudy" ? [ICON.cloud, T.reasonCloudy]
                : info.kind === "incomplete" ? [ICON.warn, T.reasonIncomplete] : [ICON.none, T.reasonNone];
            html += `<div class="reason">${icon}<div>${txt}<br><span class="muted">${esc(info.remark)}</span></div></div>`;
        }
        box.innerHTML = html;
    }

    // ---------------------------------------------------------------- controls
    function shiftMonth(k) {
        const d = new Date(Date.UTC(state.y, state.m + k, 1));
        state.y = d.getUTCFullYear();
        state.m = d.getUTCMonth();
        render();
    }

    function writeHash() {
        const sel = state.sel && state.sel.slice(0, 7) === `${state.y}-${String(state.m + 1).padStart(2, "0")}` ? state.sel : null;
        history.replaceState(null, "", `${location.search}#${sel || `${state.y}-${String(state.m + 1).padStart(2, "0")}`}`);
    }

    function readHash() {
        const h = location.hash.slice(1);
        if (/^\d{4}-\d{2}(-\d{2})?$/.test(h)) {
            state.y = +h.slice(0, 4);
            state.m = +h.slice(5, 7) - 1;
            state.sel = h.length === 10 ? h : null;
        }
    }

    function initStatic() {
        if (params.get("embed") === "1") document.body.classList.add("embed");
        document.documentElement.lang = LANG;
        document.querySelectorAll("[data-i18n]").forEach((e) => (e.textContent = T[e.dataset.i18n]));
        document.querySelectorAll("[data-i18n-html]").forEach((e) => (e.innerHTML = T[e.dataset.i18nHtml]));
        document.querySelectorAll("[data-i18n-aria]").forEach((e) => e.setAttribute("aria-label", T[e.dataset.i18nAria]));
        if (LANG !== "de") document.querySelector('.nav a[href="calendar.html"]').href = `calendar.html?lang=${LANG}`;

        const weekdays = [...Array(7)].map((_, i) => new Intl.DateTimeFormat(T.locale, { timeZone: "UTC", weekday: "short" })
            .format(new Date(Date.UTC(2024, 0, 1 + i)))); // 2024-01-01 is a Monday
        $("cal-head").innerHTML = weekdays.map((w) => `<div role="columnheader">${esc(w)}</div>`).join("");

        $("legend").innerHTML = [
            `<span><i class="k scene"></i>${T.lgScene}</span>`,
            `<span><i class="k kplan"></i>${T.lgPlan}</span>`,
            `<span><i class="k cloud">${ICON.cloud}</i>${T.lgCloud}</span>`,
            `<span><i class="k none">${ICON.none}</i>${T.lgNone}</span>`,
            `<span><i class="k warn">${ICON.warn}</i>${T.lgWarn}</span>`,
            `<span>${T.lgLat} ${BINS.map((b, i) => `<i class="dot" title="${["< 8 h", "8–12 h", "12–24 h", "1–2 d", "≥ 2 d"][i]}" style="background:var(${b.v})"></i>`).join("")}<span class="muted">&lt; 8 h … ≥ 2 d</span></span>`,
        ].join("");

        $("prev").onclick = () => shiftMonth(-1);
        $("next").onclick = () => shiftMonth(1);
        $("today").onclick = () => {
            state.y = +today.slice(0, 4); state.m = +today.slice(5, 7) - 1; state.sel = today;
            render();
        };
        $("cal-grid").addEventListener("click", (e) => {
            const el = e.target.closest(".day");
            if (!el) return;
            const day = el.dataset.day;
            state.sel = day;
            if (el.classList.contains("out")) {
                state.y = +day.slice(0, 4); state.m = +day.slice(5, 7) - 1;
            }
            render();
            if (matchMedia("(max-width: 1100px)").matches) $("detail").scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
        document.addEventListener("keydown", (e) => {
            if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
            if (e.key === "PageUp" || (e.key === "ArrowLeft" && e.altKey)) shiftMonth(-1);
            if (e.key === "PageDown" || (e.key === "ArrowRight" && e.altKey)) shiftMonth(1);
        });
    }

    // ---------------------------------------------------------------- boot
    document.addEventListener("DOMContentLoaded", async () => {
        initStatic();
        readHash();
        const recentStart = addDays(today, -CONFIG.recentDays);
        const [ni, pl] = await Promise.allSettled([loadNoImagery(), loadPlan()]);
        if (ni.status === "fulfilled") noImagery = ni.value;
        if (pl.status === "fulfilled") plan = pl.value;
        const errs = [ni, pl].filter((r) => r.status === "rejected").map((r) => r.reason.message);
        render().then(() => { if (errs.length) $("status").textContent = `${T.loadErr}: ${errs.join("; ")}`; });
        loadScenes(recentStart, today).then((sc) => {
            const lat = sc.map((s) => s.latency).filter((h) => h != null);
            recentLatency = { h: median(lat), n: lat.length };
            render(); // planned days show the expected publication time
        }).catch(() => {});
    });
})();
