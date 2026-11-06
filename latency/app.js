/* Sentinel-2 catalog latency map.
 * Reads data/latency.json (static file on GitHub Pages, generated live by app.py under Flask).
 */
(function () {
    "use strict";

    const BINS = [
        { max: 8, label: "< 8 h", v: "--seq-1" },
        { max: 12, label: "8–12 h", v: "--seq-2" },
        { max: 24, label: "12–24 h", v: "--seq-3" },
        { max: 48, label: "1–2 d", v: "--seq-4" },
        { max: Infinity, label: "≥ 2 d", v: "--seq-5" },
    ];

    const $ = (id) => document.getElementById(id);
    const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const binOf = (h) => BINS.find((b) => h < b.max);
    const median = (a) => {
        const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
        return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
    const fmtH = (h) => (h == null ? "–" : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} d`);
    const fmtTs = (s) => s.replace("T", " ").replace(/:\d\dZ$/, "");
    // published timestamp: time only when on the acquisition day, else MM-DD HH:MM
    const fmtPub = (s) => {
        const t = fmtTs(s.created);
        return t.slice(0, 10) === s.acquired.slice(0, 10) ? t.slice(11) : t.slice(5);
    };
    const esc =(s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

    const state = { mode: "date", date: null, start: null, end: null, cell: null };
    let D, cellIds, dates, map, layer, tip;

    // ---------------------------------------------------------------- data
    async function load() {
        const r = await fetch("data/latency.json", { cache: "no-cache" });
        if (!r.ok) throw new Error(`data/latency.json: HTTP ${r.status}`);
        D = await r.json();
        cellIds = D.cells.map((c) => c[0]);
        dates = D.dates.map((d) => d.date);
    }

    /** {cellIndex: {h, obs}} for one date */
    function valuesForDate(day) {
        const out = new Map();
        for (const [i, h, obs] of D.values[day] || []) out.set(i, { h, obs, n: 1 });
        return out;
    }

    /** {cellIndex: {h: median, n: #dates}} over a date range */
    function valuesForPeriod(start, end) {
        const acc = new Map();
        for (const day of dates) {
            if (day < start || day > end) continue;
            for (const [i, h] of D.values[day] || []) {
                if (!acc.has(i)) acc.set(i, []);
                acc.get(i).push(h);
            }
        }
        const out = new Map();
        acc.forEach((a, i) => out.set(i, { h: median(a), n: a.length }));
        return out;
    }

    function seriesForCell(idx) {
        const pts = [];
        for (const day of dates) {
            const hit = (D.values[day] || []).find((v) => v[0] === idx);
            if (hit) pts.push({ day, h: hit[1], obs: hit[2] });
        }
        return pts;
    }

    function currentScenes() {
        return D.scenes.filter((s) =>
            state.mode === "date" ? s.date === state.date : s.date >= state.start && s.date <= state.end);
    }

    // ---------------------------------------------------------------- map
    function initMap() {
        map = L.map("map", { zoomSnap: 0.25 }).fitBounds([[45.75, 5.9], [47.85, 10.55]]);
        L.tileLayer("https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/{z}/{x}/{y}.jpeg", {
            maxZoom: 18,
            attribution: '&copy; <a href="https://www.swisstopo.admin.ch/" target="_blank" rel="noopener">swisstopo</a> | Contains modified Copernicus Sentinel data',
        }).addTo(map);
        layer = L.layerGroup().addTo(map);
    }

    function render() {
        const vals = state.mode === "date" ? valuesForDate(state.date) : valuesForPeriod(state.start, state.end);
        const stroke = css("--surface-1");
        layer.clearLayers();
        vals.forEach((v, i) => {
            const id = cellIds[i];
            const sel = id === state.cell;
            const poly = L.polygon(D.cells[i][1], {
                color: sel ? css("--text-primary") : stroke,
                weight: sel ? 3 : 1,
                fillColor: css(binOf(v.h).v),
                fillOpacity: 0.78,
            });
            poly.on("mousemove", (e) => showTip(e.originalEvent, tipHtml(id, v)));
            poly.on("mouseout", hideTip);
            poly.on("click", () => { state.cell = id; render(); });
            poly.addTo(layer);
            if (sel) poly.bringToFront();
        });
        renderTiles(vals);
        renderScenes();
        renderChart();
        writeHash();
    }

    function tipHtml(id, v) {
        const extra = state.mode === "date"
            ? `${v.obs} of ${D.meta.samples_per_cell} sample cells covered`
            : `median of ${v.n} acquisition date${v.n === 1 ? "" : "s"}`;
        return `<b>${fmtH(v.h)}</b> median latency<br>${extra}<br><span style="opacity:.7">${id}</span>`;
    }

    // ---------------------------------------------------------------- side panel
    function renderTiles(vals) {
        const scenes = currentScenes().filter((s) => !s.excluded);
        const excluded = currentScenes().length - scenes.length;
        const hs = scenes.map((s) => s.latency_hours);
        const tiles = [
            [scenes.length ? fmtH(median(hs)) : "–", "median scene latency"],
            [scenes.length ? fmtH(Math.max(...hs)) : "–", "slowest scene"],
            [String(scenes.length), `scene${scenes.length === 1 ? "" : "s"}${excluded ? ` (+${excluded} reprocessed)` : ""}`],
        ];
        $("tiles").innerHTML = tiles.map(([v, l]) => `<div class="tile"><div class="v">${v}</div><div class="l">${l}</div></div>`).join("");
        if (!vals.size) $("tiles").insertAdjacentHTML("beforeend", '<p class="muted" style="grid-column:1/-1;margin:0">No acquisitions in this selection.</p>');
    }

    function renderScenes() {
        const rows = currentScenes().slice().reverse();
        $("scene-scope").textContent = state.mode === "date" ? state.date : `${state.start} – ${state.end}`;
        $("scenes").querySelector("tbody").innerHTML = rows.length
            ? rows.map((s) => `<tr><td>${fmtTs(s.acquired)}</td><td>${fmtPub(s)}</td>` +
                `<td class="num">${fmtH(s.latency_hours)}${s.excluded ? '<span class="tag">reprocessed</span>' : ""}</td></tr>`).join("")
            : '<tr><td colspan="3" class="muted">No scenes</td></tr>';
    }

    function renderChart() {
        const box = $("chart");
        const idx = state.cell ? cellIds.indexOf(state.cell) : -1;
        if (idx < 0) {
            box.innerHTML = "";
            $("cell-title").textContent = "Hexagon history";
            $("cell-hint").hidden = false;
            return;
        }
        const pts = seriesForCell(idx);
        $("cell-title").textContent = `Hexagon ${state.cell}`;
        $("cell-hint").hidden = true;

        const W = 356, H = 190, m = { l: 38, r: 8, t: 10, b: 24 };
        const iw = W - m.l - m.r, ih = H - m.t - m.b;
        const t = (d) => Date.parse(d + "T00:00:00Z");
        const t0 = t(dates[0]), t1 = Math.max(t(dates[dates.length - 1]), t0 + 864e5);
        const yMax = Math.max(24, ...pts.map((p) => p.h)) * 1.08;
        const x = (d) => m.l + ((t(d) - t0) / (t1 - t0)) * iw;
        const y = (h) => m.t + ih - (h / yMax) * ih;

        const step = yMax > 120 ? 48 : yMax > 60 ? 24 : yMax > 30 ? 12 : 6;
        let grid = "";
        for (let v = 0; v <= yMax; v += step) {
            grid += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>` +
                `<text x="${m.l - 6}" y="${y(v) + 3.5}" text-anchor="end">${v}h</text>`;
        }
        const months = [];
        const dd = new Date(t0); dd.setUTCDate(1); dd.setUTCMonth(dd.getUTCMonth() + 1);
        for (; dd.getTime() <= t1; dd.setUTCMonth(dd.getUTCMonth() + 1)) {
            const iso = dd.toISOString().slice(0, 10);
            months.push(`<text x="${x(iso)}" y="${H - 6}" text-anchor="middle">${dd.toLocaleString("en", { month: "short", timeZone: "UTC" })}</text>`);
        }
        const path = pts.map((p, i) => `${i ? "L" : "M"}${x(p.day).toFixed(1)},${y(p.h).toFixed(1)}`).join("");
        const dots = pts.map((p, i) => `<circle class="dot${p.day === state.date && state.mode === "date" ? " cur" : ""}" data-i="${i}" cx="${x(p.day)}" cy="${y(p.h)}" r="4"/>`).join("");

        box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Latency per acquisition date for hexagon ${esc(state.cell)}">
            <g class="axis grid">${grid}</g><g class="axis">${months.join("")}</g>
            <line class="cross" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" visibility="hidden"/>
            <path class="series" d="${path}"/>${dots}
            <rect x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent"/></svg>
            <p class="muted" style="margin:4px 0 0">${pts.length} acquisition date${pts.length === 1 ? "" : "s"}, median ${pts.length ? fmtH(median(pts.map((p) => p.h))) : "–"}. Click a point to show that date.</p>`;

        const svg = box.querySelector("svg"), cross = svg.querySelector(".cross");
        const nearest = (ev) => {
            const r = svg.getBoundingClientRect();
            const px = ((ev.clientX - r.left) / r.width) * W;
            let best = null, bd = Infinity;
            pts.forEach((p, i) => { const d = Math.abs(x(p.day) - px); if (d < bd) { bd = d; best = i; } });
            return best;
        };
        svg.addEventListener("mousemove", (ev) => {
            const i = nearest(ev);
            if (i == null) return;
            const p = pts[i];
            cross.setAttribute("x1", x(p.day)); cross.setAttribute("x2", x(p.day)); cross.setAttribute("visibility", "visible");
            showTip(ev, `<b>${fmtH(p.h)}</b> on ${p.day}<br>${p.obs} of ${D.meta.samples_per_cell} sample cells`);
        });
        svg.addEventListener("mouseleave", () => { cross.setAttribute("visibility", "hidden"); hideTip(); });
        svg.addEventListener("click", (ev) => {
            const i = nearest(ev);
            if (i == null) return;
            setMode("date");
            state.date = pts[i].day;
            $("date").value = state.date;
            render();
        });
    }

    // ---------------------------------------------------------------- tooltip
    function showTip(ev, html) {
        tip.innerHTML = html;
        tip.hidden = false;
        const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
        let left = ev.clientX + pad, top = ev.clientY + pad;
        if (left + w > window.innerWidth - 8) left = ev.clientX - w - pad;
        if (top + h > window.innerHeight - 8) top = ev.clientY - h - pad;
        tip.style.left = `${left}px`;
        tip.style.top = `${top}px`;
    }
    function hideTip() { tip.hidden = true; }

    // ---------------------------------------------------------------- controls
    function setMode(mode) {
        state.mode = mode;
        $("mode-date").classList.toggle("on", mode === "date");
        $("mode-period").classList.toggle("on", mode === "period");
        $("mode-date").setAttribute("aria-pressed", mode === "date");
        $("mode-period").setAttribute("aria-pressed", mode === "period");
        $("ctl-date").hidden = mode !== "date";
        $("ctl-period").hidden = mode !== "period";
    }

    function setRange(days) {
        const last = dates[dates.length - 1];
        state.end = last;
        if (!days) state.start = dates[0];
        else {
            const s = new Date(Date.parse(last + "T00:00:00Z") - (days - 1) * 864e5).toISOString().slice(0, 10);
            state.start = s < dates[0] ? dates[0] : s;
        }
        $("start").value = state.start;
        $("end").value = state.end;
    }

    function writeHash() {
        const p = new URLSearchParams();
        if (state.mode === "date") p.set("date", state.date);
        else { p.set("start", state.start); p.set("end", state.end); }
        if (state.cell) p.set("cell", state.cell);
        history.replaceState(null, "", `#${p}`);
    }

    function readHash() {
        const p = new URLSearchParams(location.hash.slice(1));
        if (p.get("cell") && cellIds.includes(p.get("cell"))) state.cell = p.get("cell");
        if (p.get("start") && p.get("end")) {
            setMode("period");
            state.start = p.get("start"); state.end = p.get("end");
            $("start").value = state.start; $("end").value = state.end;
        } else if (p.get("date") && dates.includes(p.get("date"))) {
            state.date = p.get("date");
        }
    }

    function initControls() {
        $("date").innerHTML = dates.slice().reverse().map((d) => {
            const info = D.dates.find((x) => x.date === d);
            return `<option value="${d}">${d} · ${info.scenes} scene${info.scenes === 1 ? "" : "s"}</option>`;
        }).join("");
        state.date = dates[dates.length - 1];
        setRange(30);
        readHash();
        $("date").value = state.date;

        const shift = (k) => {
            const i = dates.indexOf(state.date) + k;
            if (i >= 0 && i < dates.length) { state.date = dates[i]; $("date").value = state.date; render(); }
        };
        $("prev").onclick = () => shift(-1);
        $("next").onclick = () => shift(1);
        $("date").onchange = (e) => { state.date = e.target.value; render(); };
        $("mode-date").onclick = () => { setMode("date"); render(); };
        $("mode-period").onclick = () => { setMode("period"); render(); };
        $("start").onchange = (e) => { if (e.target.value) { state.start = e.target.value; render(); } };
        $("end").onchange = (e) => { if (e.target.value) { state.end = e.target.value; render(); } };
        document.querySelectorAll("[data-days]").forEach((b) => {
            b.onclick = () => { setRange(Number(b.dataset.days)); render(); };
        });
        document.addEventListener("keydown", (e) => {
            if (state.mode !== "date" || /INPUT|SELECT/.test(document.activeElement.tagName)) return;
            if (e.key === "ArrowLeft") shift(-1);
            if (e.key === "ArrowRight") shift(1);
        });

        $("legend").innerHTML = '<span class="title">Median latency</span>' +
            BINS.map((b) => `<span class="sw"><i style="background:var(${b.v})"></i>${b.label}</span>`).join("");

        const m = D.meta;
        document.querySelectorAll(".m-sres").forEach((e) => (e.textContent = m.sample_resolution));
        document.querySelectorAll(".m-ores").forEach((e) => (e.textContent = m.output_resolution));
        document.querySelectorAll(".m-max").forEach((e) => (e.textContent = m.max_latency_hours));
        $("generated").textContent = `Collection ${m.collection}, data generated ${fmtTs(m.generated_at)} UTC.`;
    }

    // ---------------------------------------------------------------- boot
    document.addEventListener("DOMContentLoaded", async () => {
        tip = $("tip");
        initMap();
        try {
            await load();
        } catch (err) {
            $("tiles").innerHTML = `<p class="muted">Could not load latency data (${esc(err.message)}). Run latency/latency_loader.py first.</p>`;
            return;
        }
        if (!dates.length) {
            $("tiles").innerHTML = '<p class="muted">No acquisitions loaded yet.</p>';
            return;
        }
        initControls();
        render();
        matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);
    });
})();
