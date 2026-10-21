/* Australian Marine Resources Atlas — application logic (vanilla JS, Leaflet, Chart.js). */
(() => {
  "use strict";
  const CATS = ["fossil", "renewable", "mineral", "agri", "other"];
  const CAT_VAR = { fossil: "--c-fossil", renewable: "--c-renew", mineral: "--c-mineral", agri: "--c-agri", other: "--c-other" };
  const STAGES = ["Operational", "Under construction", "Approved / FID", "Planning", "Exploration / appraisal", "Suspended", "Decommissioning", "Decommissioned", "Cancelled"];
  const STAGE_VAR = { "Operational": "--st-op", "Under construction": "--st-uc", "Approved / FID": "--st-fid", "Planning": "--st-plan", "Exploration / appraisal": "--st-exp",
    "Suspended": "--st-susp", "Decommissioning": "--st-decg", "Decommissioned": "--st-dec", "Cancelled": "--st-can" };
  const DEFAULT_OFF_STAGES = ["Cancelled"];
  const JUR_ORDER = ["FED", "WA", "NT", "QLD", "NSW", "VIC", "TAS", "SA"];
  const STATES = ["WA", "NT", "QLD", "NSW", "VIC", "TAS", "SA", "EXT"];
  const WATERS = ["Commonwealth", "Coastal (state/NT)", "Both", "Onshore (marine-linked)"];

  const D = {};
  let lang = "zh";
  try { lang = localStorage.getItem("amr_lang") || "zh"; } catch (e) { /* storage blocked */ }
  const charts = {};
  let map, projLayer, zoneLayer, geoLayers = {}, geoCache = {}, colorMode = "category";
  let sortState = { key: "stage", asc: true };
  let resCat = "fossil";
  let polJur = "FED", polCat = "", polStage = "";
  const NEWS_PAGE = 60;
  let newsShown = NEWS_PAGE, newsAllTime = false;

  // ---------- helpers
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const t = (k) => (I18N[lang][k] ?? I18N.en[k] ?? k);
  const L2 = (o, f) => (o ? (o[`${f}_${lang}`] || o[`${f}_en`] || o[`${f}_zh`] || "") : "");
  const cssVar = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const catColor = (c) => cssVar(CAT_VAR[c] || "--muted");
  const stageColor = (s) => cssVar(STAGE_VAR[s] || "--muted");
  const fmt = (n, d = 0) => (n == null || isNaN(n) ? "—" : Number(n).toLocaleString(lang === "zh" ? "zh-CN" : "en-AU", { maximumFractionDigits: d }));
  const fmtA = (n) => fmt(n, Math.abs(n) < 10 ? 2 : Math.abs(n) < 100 ? 1 : 0);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const isUrl = (s) => /^https?:\/\//.test(String(s || ""));
  const host = (u) => String(u).replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
  const linkList = (arr) => (arr || []).map((u) => isUrl(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(host(u))}</a>` : esc(u)).join(" · ");
  const srcHtml = (s, url) => {
    const parts = String(s || "").split(/\s*;\s*/).filter(Boolean);
    const txt = parts.map((p) => isUrl(p) ? `<a href="${esc(p)}" target="_blank" rel="noopener">${esc(host(p))}</a>` : esc(p)).join("; ");
    return txt + (url && !String(s || "").includes(url) ? ` · <a href="${esc(url)}" target="_blank" rel="noopener">${esc(host(url))}</a>` : "");
  };
  const rich = (str) => {
    const lines = String(str || "").split("\n").map((x) => x.trim()).filter(Boolean);
    if (!lines.length) return "";
    const lead = [], items = [];
    for (const l of lines) {
      if (l.startsWith("- ") || l.startsWith("• ")) items.push(l.slice(2));
      else if (items.length) items[items.length - 1] += " " + l;
      else lead.push(l);
    }
    return (lead.length ? `<p>${esc(lead.join(" "))}</p>` : "") + (items.length ? `<ul class="dots">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : "");
  };
  const hexA = (hex, a) => {
    const h = String(hex).replace("#", "");
    if (h.length < 6) return hex;
    const n = parseInt(h.slice(0, 6), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };
  const stageBadge = (s) => `<span class="stage-badge" style="background:${stageColor(s)}">${esc(t("stage_" + s))}</span>`;
  const catChip = (c) => `<span class="chip cat" style="--cc:${catColor(c)}">${esc(t("cat_" + c))}</span>`;
  const pName = (p) => (lang === "zh" ? p.name_zh || p.name : p.name);
  const pAlt = (p) => (lang === "zh" ? (p.name_zh && p.name_zh !== p.name ? p.name : "") : (p.name_zh && p.name_zh !== p.name ? p.name_zh : ""));
  const subName = (cat, sub) => { const c = D.catById[cat]; const s = c && c.subcategories.find((x) => x.subcategory === sub); return s ? L2(s, "name") : (sub || "—"); };
  const opName = (o) => (lang === "zh" && o.name_zh ? o.name_zh : o.name);
  const capStr = (p) => (p.capacity != null ? `${fmt(p.capacity, 2)} ${esc(p.capacity_unit || "")}` : `<span class="muted">${t("not_disclosed")}</span>`);
  const isDark = () => document.documentElement.dataset.theme === "dark" || (document.documentElement.dataset.theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  const stageIdx = (s) => { const i = STAGES.indexOf(s); return i < 0 ? 99 : i; };
  const short = (s, n) => { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

  async function loadJSON(name, optional = false) {
    try {
      const r = await fetch(`data/${name}?v=${Date.now() >> 16}`);
      if (!r.ok) throw new Error(r.status);
      return await r.json();
    } catch (e) {
      if (optional) return null;
      throw new Error(`Failed to load data/${name}: ${e.message}`);
    }
  }

  // ---------- charts
  function mkChart(id, cfg) {
    if (charts[id]) charts[id].destroy();
    const ctx = document.getElementById(id);
    if (!ctx) return;
    cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: false }, cfg.options || {});
    cfg.options.plugins = Object.assign({ legend: { labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true } }, tooltip: { mode: "nearest", intersect: true } }, cfg.options.plugins || {});
    charts[id] = new Chart(ctx, cfg);
  }
  const grid = () => ({ color: cssVar("--border"), drawTicks: false });
  const barOpts = (horizontal, extra = {}) => Object.assign({
    indexAxis: horizontal ? "y" : "x",
    scales: {
      x: { grid: horizontal ? grid() : { display: false }, border: { display: false }, ticks: { precision: 0 }, stacked: !!extra.stacked },
      y: { grid: horizontal ? { display: false } : grid(), border: { display: false }, stacked: !!extra.stacked },
    },
    datasets: { bar: { borderRadius: 3, borderSkipped: "start", barPercentage: 0.75, categoryPercentage: 0.8, borderWidth: 0 } },
  }, extra.options || {});
  const S = (id) => D.seriesById[id];
  const pts = (id) => Object.fromEntries(((S(id) || {}).points || []).map((p) => [p.period, p.value]));
  const isFc = (id, per) => { const f = (S(id) || {}).forecast_from; return f ? per >= f : false; };
  const setSrc = (elId, ...ids) => {
    const el = document.getElementById(elId); if (!el) return;
    const seen = new Set();
    el.innerHTML = (lang === "zh" ? "来源：" : "Source: ") + ids.map((id) => D.seriesById[id] || D.bdById[id]).filter(Boolean)
      .filter((s) => { const k = s.source_short || s.source; if (seen.has(k)) return false; seen.add(k); return true; })
      .map((s) => (s.source_short ? `<span title="${esc(s.source)}">${esc(s.source_short)}</span>${s.source_url ? ` · <a href="${esc(s.source_url)}" target="_blank" rel="noopener">${esc(host(s.source_url))}</a>` : ""}` : srcHtml(s.source, s.source_url))).join(" | ");
  };

  // ---------- language
  function applyLang() {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    $$(".lang-toggle button").forEach((b) => b.classList.toggle("active", b.dataset.lang === lang));
    $$("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    $$("[data-i18n-html]").forEach((el) => { el.innerHTML = rich(t(el.dataset.i18nHtml)); });
    $$("[data-i18n-ph]").forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
    $("#siteTitle").textContent = L2(D.meta, "site_title") || "Australian Marine Resources Atlas";
    document.title = $("#siteTitle").textContent;
    $("#siteSubtitle").textContent = L2(D.meta, "site_subtitle");
    $("#nationalSummary").innerHTML = rich(L2(D.meta, "national_summary"));
    $("#footerOrg").textContent = `${D.meta.organisation || ""} · ${new Date().getFullYear()}`;
    $("#disclaimer").textContent = L2(D.meta, "disclaimer");
    $("#dataAsOf").textContent = D.meta.data_as_of || "—";
    Chart.defaults.color = cssVar("--text-2");
    Chart.defaults.borderColor = cssVar("--border");
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    renderOverview(); renderResources(); renderValue(); renderPolicy(); renderOperators(); renderNews(); renderData();
    populateFilters(); renderLayerToggles(); renderMapLegend(); applyFilters();
    const sel = $("#detailPanel").dataset.pid;
    if (sel) showDetail(D.projById[sel]);
  }

  // ---------- overview
  function renderOverview() {
    const tiles = D.kpis.filter((k) => k.kpi).sort((a, b) => (a.kpi_order ?? 99) - (b.kpi_order ?? 99)).slice(0, 8);
    $("#kpiRow").innerHTML = tiles.map((k) => {
      const src = k.source_short || String(k.source || "").split(/\s*;\s*/)[0];
      return `<div class="kpi"><div class="v">${fmtA(k.value)}<small>${esc(k.unit)}</small></div><div class="l">${esc(L2(k, "label"))}</div>
        <div class="s">${esc(k.as_of || "")}${src ? " · " + (isUrl(src) ? `<a href="${esc(src)}" target="_blank" rel="noopener">${esc(host(src))}</a>` : esc(short(src, 70))) : ""}</div></div>`;
    }).join("");
    const st = D.stats.by_stage;
    $("#countStrip").innerHTML = `<span>${t("tracked_projects")} <b>${D.projects.length}</b></span><span class="sep">|</span>` +
      STAGES.filter((s) => st[s]).map((s) => `<span><i class="sw" style="background:${stageColor(s)}"></i> ${esc(t("stage_" + s))} <b>${st[s]}</b></span>`).join("") +
      `<span class="sep">|</span><span>${t("tab_operators")} <b>${D.ops.length}</b></span><span>${t("tab_policy")} <b>${D.pol.instruments.length}</b></span>`;

    $("#catCards").innerHTML = CATS.map((c) => {
      const cs = D.stats.by_category_stage[c]; const n = Object.values(cs).reduce((a, b) => a + b, 0);
      const subs = D.catById[c].subcategories.map((s) => L2(s, "name")).join(" · ");
      return `<div class="cat-card" data-cat="${c}" style="--cc:${catColor(c)}" tabindex="0" role="button"><h4>${esc(L2(D.catById[c], "name"))}</h4>
        <div class="n">${n}<small>${t("projects")}</small></div>
        <div class="stagebar">${STAGES.filter((s) => cs[s]).map((s) => `<i style="width:${100 * cs[s] / n}%;background:${stageColor(s)}" title="${esc(t("stage_" + s))} ${cs[s]}"></i>`).join("")}</div>
        <div class="subs">${esc(subs)}</div></div>`;
    }).join("");

    mkChart("chCatStage", {
      type: "bar",
      data: { labels: CATS.map((c) => t("cat_" + c)), datasets: STAGES.map((s) => ({ label: t("stage_" + s), data: CATS.map((c) => D.stats.by_category_stage[c][s]), backgroundColor: stageColor(s) })).filter((d) => d.data.some(Boolean)) },
      options: barOpts(true, { stacked: true }),
    });

    // value trend: LNG + oil export earnings and fisheries GVP (A$bn)
    const lngP = pts("lng_export_value"), oilP = pts("oil_export_value"), fishP = pts("fish_gvp_total");
    const labels = [...new Set([...Object.keys(lngP), ...Object.keys(oilP), ...Object.keys(fishP)])].filter((p) => p >= "2014-15" && p <= "2026-27").sort();
    const line = (id, p, label, color, scale = 1) => ({
      label, data: labels.map((l) => (p[l] != null ? p[l] * scale : null)), borderColor: color, backgroundColor: color, pointRadius: 2.5, borderWidth: 2, spanGaps: true, tension: 0.15,
      segment: { borderDash: (ctx) => (isFc(id, labels[ctx.p1DataIndex]) ? [5, 4] : undefined) },
    });
    mkChart("chValueTrend", {
      type: "line",
      data: { labels, datasets: [line("lng_export_value", lngP, t("lng"), catColor("fossil")), line("oil_export_value", oilP, t("oil"), cssVar("--s7")), line("fish_gvp_total", fishP, t("fisheries"), catColor("agri"), 0.001)] },
      options: { scales: { y: { grid: grid(), border: { display: false }, title: { display: true, text: "A$bn" } }, x: { grid: { display: false } } },
        plugins: { tooltip: { mode: "index", intersect: false, callbacks: { label: (c) => `${c.dataset.label}: ${fmtA(c.raw)} A$bn` } } } },
    });
    $("#valueTrendSub").textContent = t("value_trend_sub");
    setSrc("valueTrendSrc", "lng_export_value", "oil_export_value", "fish_gvp_total");

    mkChart("chStateCat", {
      type: "bar",
      data: { labels: STATES, datasets: CATS.map((c) => ({ label: t("cat_" + c), data: STATES.map((s) => D.stats.by_state_category[s][c]), backgroundColor: catColor(c) })) },
      options: barOpts(false, { stacked: true }),
    });

    $("#latestUpdates").innerHTML = D.stats.latest_updates.slice(0, 14).map((u) => {
      const p = D.projById[u.project_id]; if (!p) return "";
      const txt = L2(p, "latest_update").replace(/^\d{4}-\d{2}(-\d{2})?:\s*/, "").replace(/^\d{4}年\d{1,2}月(\d{1,2}日)?[：:]\s*/, "");
      return `<li><span class="d">${esc(u.date)}</span><span><a href="#" data-proj="${esc(p.project_id)}" class="op">${esc(pName(p))}</a> ${esc(short(txt, 150))}</span></li>`;
    }).join("");
  }

  // ---------- resources
  function renderResources() {
    $("#resCatPills").innerHTML = CATS.map((c) => {
      const n = D.projects.filter((p) => p.category === c).length;
      return `<button data-rescat="${c}" class="${c === resCat ? "active" : ""}" style="--cc:${catColor(c)}"><i class="sw" style="background:${catColor(c)}"></i>${esc(L2(D.catById[c], "name"))} <small class="muted">${n}</small></button>`;
    }).join("");
    const cat = D.catById[resCat];
    const ps = D.projects.filter((p) => p.category === resCat);
    const cs = D.stats.by_category_stage[resCat];
    const subs = cat.subcategories;
    let html = `<div class="res-head">
      <div class="card"><h2><i class="sw" style="background:${catColor(resCat)}"></i>${esc(L2(cat, "name"))}</h2>
        <div class="stage-chips">${STAGES.filter((s) => cs[s]).map((s) => `${stageBadge(s)} <b>${cs[s]}</b>`).join(" ")}</div>
        <div class="prose">${rich(L2(cat, "overview"))}</div></div>
      <figure class="card"><figcaption><span>${t("res_capacity")}</span><small>${lang === "zh" ? "各子类项目数（按阶段）及同口径规模" : "Projects per sub-category by stage, and like-for-like capacity"}</small></figcaption>
        <div class="chart-box"><canvas id="chResSub"></canvas></div><div class="small" id="resCapNote"></div></figure></div>`;
    for (const s of subs) {
      const list = ps.filter((p) => p.subcategory === s.subcategory).sort((a, b) => stageIdx(a.stage) - stageIdx(b.stage) || (b.capacity || 0) - (a.capacity || 0));
      html += `<div class="card sub-block"><div class="sub-head"><h3>${esc(L2(s, "name"))}</h3><small class="muted">${t("res_projects_n").replace("{n}", list.length)}</small></div>
        <p class="sub-desc">${esc(L2(s, "overview"))}</p>
        ${list.length ? `<div class="table-scroll"><table><thead><tr><th>${t("name")}</th><th>${t("stage")}</th><th>${t("operator")}</th><th>${t("state")}</th><th class="num">${t("capacity")}</th><th class="num">${t("start")}</th><th class="num">${t("end")}</th><th>${t("latest")}</th><th></th></tr></thead><tbody>
          ${list.map((p) => `<tr class="clickable" data-proj="${esc(p.project_id)}"><td class="nm">${esc(pName(p))}${pAlt(p) ? `<small>${esc(pAlt(p))}</small>` : ""}</td><td>${stageBadge(p.stage)}</td>
            <td>${esc(p.operator || "—")}</td><td>${esc(p.state || "")}</td><td class="num">${capStr(p)}</td><td class="num">${esc(p.start_year ?? "—")}</td><td class="num">${esc(p.end_year ?? "—")}</td>
            <td><div class="upd">${esc(short(L2(p, "latest_update"), 140))}</div></td><td><button class="btn small" data-mapproj="${esc(p.project_id)}">${t("show_on_map")}</button></td></tr>`).join("")}
          </tbody></table></div>` : `<p class="empty">${t("res_none")}</p>`}</div>`;
    }
    $("#resBody").innerHTML = html;
    const subKeys = subs.map((s) => s.subcategory);
    mkChart("chResSub", {
      type: "bar",
      data: { labels: subs.map((s) => L2(s, "name")), datasets: STAGES.map((st) => ({ label: t("stage_" + st), data: subKeys.map((k) => ps.filter((p) => p.subcategory === k && p.stage === st).length), backgroundColor: stageColor(st) })).filter((d) => d.data.some(Boolean)) },
      options: barOpts(true, { stacked: true }),
    });
    const caps = D.stats.capacity_by_stage.filter((c) => c.category === resCat);
    $("#resCapNote").innerHTML = caps.map((c) => `<div><b>${esc(subName(c.category, c.subcategory))}</b> (${esc(c.unit)}): ${STAGES.filter((s) => c.by_stage[s]).map((s) => `${esc(t("stage_" + s))} ${fmt(c.by_stage[s], 1)}`).join(" · ")}</div>`).join("");
  }

  // ---------- project drawer
  function openProject(id) {
    const p = D.projById[id]; if (!p) return;
    const op = D.ops.find((o) => o.name === p.operator);
    $("#drawerBody").innerHTML = `
      <h2>${esc(pName(p))}${pAlt(p) ? ` <small>${esc(pAlt(p))}</small>` : ""}</h2>
      <p>${catChip(p.category)} <span class="chip">${esc(subName(p.category, p.subcategory))}</span> ${stageBadge(p.stage)} <span class="chip">${esc(p.state || "")}</span> <span class="chip">${esc(t("waters_" + p.waters))}</span></p>
      <p class="small muted">${esc(L2(p, "nature"))}</p>
      <div class="prose">${rich(L2(p, "description"))}</div>
      <dl class="kv">
        <dt>${t("operator")}</dt><dd>${op ? `<a href="#" data-op="${esc(op.operator_id)}">${esc(opName(op))}</a>` : esc(p.operator || "—")}</dd>
        <dt>${t("owners")}</dt><dd>${esc(p.owners || "—")}</dd>
        <dt>${t("basin")}</dt><dd>${esc(p.basin_region || "—")}</dd>
        <dt>${t("capacity")}</dt><dd>${capStr(p)}${p.capacity_note ? `<br><small class="muted">${esc(p.capacity_note)}</small>` : ""}</dd>
        ${p.annual_output != null ? `<dt>${t("output")}</dt><dd>${fmt(p.annual_output, 2)} ${esc(p.annual_output_unit || "")} ${p.output_year ? `(${esc(p.output_year)})` : ""}</dd>` : ""}
        ${p.annual_value_aud_m != null ? `<dt>${t("value_aud")}</dt><dd>A$${fmt(p.annual_value_aud_m)} m</dd>` : ""}
        ${p.capex_aud_bn != null ? `<dt>${t("capex")}</dt><dd>A$${fmt(p.capex_aud_bn, 2)} bn</dd>` : ""}
        <dt>${t("years")}</dt><dd>${esc(p.start_year ?? "—")} / ${esc(p.end_year ?? "—")}</dd>
        <dt>${t("location")}</dt><dd>${p.lat != null ? `${fmt(p.lat, 2)}, ${fmt(p.lng, 2)}` : "—"}${p.location_note ? ` <small class="muted">${esc(p.location_note)}</small>` : ""}</dd>
        <dt>${t("latest")}</dt><dd>${esc(L2(p, "latest_update") || "—")}</dd>
        <dt>${t("sources_lbl")}</dt><dd>${linkList(p.sources)}<br><small class="muted">${t("verified")} ${esc(p.last_verified || "—")}</small></dd>
      </dl>
      <p><button class="btn" data-mapproj="${esc(p.project_id)}">${t("show_on_map")}</button></p>`;
    $("#drawer").hidden = false;
  }

  // ---------- value
  function renderValue() {
    const fy = (ids) => [...new Set(ids.flatMap((id) => Object.keys(pts(id))))].sort();
    // hydrocarbon exports
    const labs = fy(["lng_export_value", "oil_export_value"]).filter((p) => p <= "2026-27");
    const barSet = (id, label, color) => ({ label, data: labs.map((l) => pts(id)[l] ?? null), backgroundColor: labs.map((l) => (isFc(id, l) ? hexA(color, 0.4) : color)) });
    mkChart("chHcExports", { type: "bar", data: { labels: labs, datasets: [barSet("lng_export_value", t("lng"), catColor("fossil")), barSet("oil_export_value", t("oil"), cssVar("--s7"))] },
      options: barOpts(false, { options: { plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmtA(c.raw)} A$bn${isFc(c.datasetIndex ? "oil_export_value" : "lng_export_value", c.label) ? " (" + t("forecast") + ")" : ""}` } } } } }) });
    setSrc("srcHcExports", "lng_export_value", "oil_export_value");

    const cy = [...new Set([...Object.keys(pts("gas_production_offshore")), ...Object.keys(pts("gas_production_onshore"))])].sort();
    mkChart("chGasSplit", {
      data: { labels: cy, datasets: [
        { type: "bar", label: t("offshore"), data: cy.map((y) => pts("gas_production_offshore")[y] ?? null), backgroundColor: cssVar("--accent"), stack: "g", yAxisID: "y" },
        { type: "bar", label: t("onshore"), data: cy.map((y) => pts("gas_production_onshore")[y] ?? null), backgroundColor: cssVar("--muted"), stack: "g", yAxisID: "y" },
        { type: "line", label: t("offshore_share"), data: cy.map((y) => pts("gas_offshore_share")[y] ?? null), borderColor: catColor("fossil"), backgroundColor: catColor("fossil"), yAxisID: "y1", pointRadius: 3, borderWidth: 2 }] },
      options: { scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, grid: grid(), border: { display: false }, title: { display: true, text: "PJ" } },
        y1: { position: "right", min: 50, max: 100, grid: { display: false }, ticks: { callback: (v) => v + "%" } } },
        datasets: { bar: { borderRadius: 3, borderWidth: 0 } }, plugins: { tooltip: { mode: "index", intersect: false } } },
    });
    setSrc("srcGasSplit", "gas_production_offshore", "gas_offshore_share");

    const bdBar = (cid, bid, colorFn, unit) => {
      const b = D.bdById[bid]; if (!b) return;
      const items = [...b.items].sort((x, y) => y.value - x.value);
      const lab = (i) => (lang === "zh" && i.label_zh ? i.label_zh : i.key);
      mkChart(cid, { type: "bar", data: { labels: items.map(lab), datasets: [{ label: b.unit, data: items.map((i) => i.value), backgroundColor: items.map(colorFn) }] },
        options: barOpts(true, { options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${fmt(c.raw, 1)} ${unit || b.unit}` } } } } }) });
    };
    bdBar("chGasBasin", "gas_production_by_basin", (i) => (/offshore/i.test(i.key) ? cssVar("--accent") : cssVar("--muted")), "PJ");
    setSrc("srcGasBasin", "gas_production_by_basin");

    const vl = fy(["lng_export_volume_pj", "oil_export_volume_pj"]);
    const ln = (id, label, color) => ({ label, data: vl.map((l) => pts(id)[l] ?? null), borderColor: color, backgroundColor: color, pointRadius: 2.5, borderWidth: 2, spanGaps: true, tension: 0.15 });
    mkChart("chVolumes", { type: "line", data: { labels: vl, datasets: [ln("lng_export_volume_pj", t("lng"), catColor("fossil")), ln("oil_export_volume_pj", t("oil"), cssVar("--s7"))] },
      options: { scales: { y: { grid: grid(), border: { display: false }, title: { display: true, text: "PJ" } }, x: { grid: { display: false } } }, plugins: { tooltip: { mode: "index", intersect: false } } } });
    setSrc("srcVolumes", "lng_export_volume_pj", "oil_export_volume_pj");

    const pl = fy(["prrt_receipts"]);
    mkChart("chPrrt", { type: "bar", data: { labels: pl, datasets: [{ label: "A$bn", data: pl.map((l) => pts("prrt_receipts")[l]), backgroundColor: pl.map((l) => (isFc("prrt_receipts", l) ? hexA(catColor("fossil"), 0.4) : catColor("fossil"))) }] },
      options: barOpts(false, { options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${fmtA(c.raw)} A$bn${isFc("prrt_receipts", c.label) ? " (" + t("forecast") + ")" : ""}` } } } } }) });
    setSrc("srcPrrt", "prrt_receipts");

    bdBar("chDecom", "decommissioning_liability_by_basin", () => cssVar("--st-decg"), "%");
    setSrc("srcDecom", "decommissioning_liability_by_basin");

    const fl = fy(["fish_gvp_total", "fish_gvp_wild", "fish_gvp_aquaculture"]);
    mkChart("chFish", {
      data: { labels: fl, datasets: [
        { type: "bar", label: t("wild"), data: fl.map((l) => pts("fish_gvp_wild")[l] ?? null), backgroundColor: fl.map((l) => (isFc("fish_gvp_wild", l) ? hexA(cssVar("--s1"), 0.4) : cssVar("--s1"))) },
        { type: "bar", label: t("aquaculture"), data: fl.map((l) => pts("fish_gvp_aquaculture")[l] ?? null), backgroundColor: fl.map((l) => (isFc("fish_gvp_aquaculture", l) ? hexA(catColor("renewable"), 0.4) : catColor("renewable"))) },
        { type: "line", label: t("total"), data: fl.map((l) => pts("fish_gvp_total")[l] ?? null), borderColor: cssVar("--text-2"), backgroundColor: cssVar("--text-2"), pointRadius: 3, borderWidth: 1.5, spanGaps: true,
          segment: { borderDash: (ctx) => (isFc("fish_gvp_total", fl[ctx.p1DataIndex]) ? [5, 4] : undefined) } }] },
      options: { scales: { y: { grid: grid(), border: { display: false }, title: { display: true, text: "A$m" } }, x: { grid: { display: false } } },
        datasets: { bar: { borderRadius: 3, borderWidth: 0 } }, plugins: { tooltip: { mode: "index", intersect: false } } },
    });
    setSrc("srcFish", "fish_gvp_total", "fish_gvp_wild", "fish_gvp_aquaculture");

    const sp = D.bdById.fish_gvp_by_species_2023_24 || D.breakdowns.find((b) => /species/.test(b.breakdown_id));
    if (sp) { bdBar("chFishSpecies", sp.breakdown_id, () => catColor("agri"), "A$m"); $("#fishSpeciesSub").textContent = `A$m · ${sp.year || ""} · ${L2(sp, "label")}`; setSrc("srcFishSpecies", sp.breakdown_id); }
    const fj = D.bdById.fish_gvp_by_jurisdiction;
    if (fj) { bdBar("chFishJur", "fish_gvp_by_jurisdiction", () => catColor("agri"), "A$m"); $("#fishJurSub").textContent = `A$m · ${fj.year || ""}`; setSrc("srcFishJur", "fish_gvp_by_jurisdiction"); }

    const zs = [...D.zones].sort((a, b) => (b.fl_capacity_gw || 0) - (a.fl_capacity_gw || 0));
    mkChart("chWindZone", {
      data: { labels: zs.map((z) => L2(z, "name")), datasets: [
        { type: "bar", label: t("gw_active"), data: zs.map((z) => z.fl_capacity_gw || 0), backgroundColor: catColor("renewable"), yAxisID: "y" },
        { type: "bar", label: t("licences_granted"), data: zs.map((z) => z.fl_granted || 0), backgroundColor: hexA(catColor("renewable"), 0.35), yAxisID: "y1" },
        { type: "bar", label: t("licences_active"), data: zs.map((z) => z.fl_active || 0), backgroundColor: cssVar("--muted"), yAxisID: "y1" }] },
      options: { scales: { x: { grid: { display: false }, ticks: { autoSkip: false, maxRotation: 30 } }, y: { grid: grid(), border: { display: false }, title: { display: true, text: "GW" } },
        y1: { position: "right", grid: { display: false }, ticks: { precision: 0 }, title: { display: true, text: lang === "zh" ? "张" : "licences" } } },
        datasets: { bar: { borderRadius: 3, borderWidth: 0 } }, plugins: { tooltip: { mode: "index", intersect: false } } },
    });
    $("#srcWindZone").innerHTML = (lang === "zh" ? "来源：" : "Source: ") + [...new Set(D.zones.flatMap((z) => z.sources))].slice(0, 4).map((u) => srcHtml(u)).join(" · ");

    // capacity by stage, one mini chart per sub-category
    $("#capStageGrid").innerHTML = D.stats.capacity_by_stage.map((c, i) => `<figure class="card"><figcaption><span>${esc(subName(c.category, c.subcategory))}</span>
      <small>${esc(c.unit)} · ${c.n} ${t("projects")}${c.excluded ? ` · ${lang === "zh" ? "另有" : "plus"} ${c.excluded} ${lang === "zh" ? "个项目口径不同未计入" : "with another unit excluded"}` : ""}</small></figcaption>
      <div class="chart-box"><canvas id="chCap${i}"></canvas></div></figure>`).join("");
    D.stats.capacity_by_stage.forEach((c, i) => {
      const st = STAGES.filter((s) => c.by_stage[s]);
      mkChart("chCap" + i, { type: "bar", data: { labels: st.map((s) => t("stage_" + s)), datasets: [{ label: c.unit, data: st.map((s) => c.by_stage[s]), backgroundColor: st.map(stageColor) }] },
        options: barOpts(true, { options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (x) => `${fmt(x.raw, 2)} ${c.unit}` } } } } }) });
    });

    const cx = D.stats.capex_by_category_stage;
    const nCapex = Object.values(D.stats.capex_counts || {}).reduce((a, b) => a + b, 0);
    $("#capexSub").textContent = t("capex_sub").replace("{n}", nCapex);
    mkChart("chCapexStage", { type: "bar", data: { labels: CATS.map((c) => t("cat_" + c)), datasets: STAGES.map((s) => ({ label: t("stage_" + s), data: CATS.map((c) => cx[c][s]), backgroundColor: stageColor(s) })).filter((d) => d.data.some(Boolean)) },
      options: barOpts(true, { stacked: true, options: { plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: A$${fmtA(c.raw)} bn` } } } } }) });

    $("#kpiTable").innerHTML = `<thead><tr><th>${lang === "zh" ? "指标" : "Metric"}</th><th class="num">${lang === "zh" ? "数值" : "Value"}</th><th>${lang === "zh" ? "时点" : "As of"}</th><th>${t("sources_lbl")}</th></tr></thead><tbody>` +
      D.kpis.map((k) => `<tr><td>${k.category ? catChip(k.category) : ""} ${esc(L2(k, "label"))}</td><td class="num">${fmtA(k.value)} ${esc(k.unit)}</td><td>${esc(k.as_of || "")}</td><td class="small" title="${esc(k.source)}">${srcHtml(short(k.source, 120), k.source_url)}</td></tr>`).join("") + "</tbody>";
  }

  // ---------- policy
  function renderPolicy() {
    $("#zoneDiagram").innerHTML = `<div class="zd-bands">
        <div class="zd-land"><b>${t("zd_land")}</b><span>${t("zd_land_s")}</span></div>
        <div class="zd-state"><b>${t("zd_state")}</b><span>${t("zd_state_s")}</span></div>
        <div class="zd-ts"><b>${t("zd_ts")}</b><span>${t("zd_ts_s")}</span></div>
        <div class="zd-eez"><b>${t("zd_eez")}</b><span>${t("zd_eez_s")}</span></div>
        <div class="zd-cs"><b>${t("zd_cs")}</b><span>${t("zd_cs_s")}</span></div></div>
      <div class="zd-scale"><span>${lang === "zh" ? "基线" : "baseline"}</span><span>3 nm</span><span>12 nm</span><span>200 nm</span><span>${lang === "zh" ? "大陆架外缘" : "outer shelf"}</span></div>
      <div class="zd-who"><div class="w-state">${t("zd_who_land")}</div><div class="w-state">${t("zd_who_state")}</div><div class="w-cth">${t("zd_who_cth")}</div></div>
      <p class="zd-note">${t("zd_note")}</p>`;
    $("#frameworkNotes").innerHTML = rich(L2(D.meta, "framework_notes"));

    const I = D.pol.instruments;
    const jurName = (id) => { const j = D.pol.jurisdictions.find((x) => x.jurisdiction_id === id); return j ? (id === "FED" ? t("fed") : (lang === "zh" ? j.name_zh : id)) : id; };
    const maxJ = Math.max(1, ...JUR_ORDER.flatMap((j) => CATS.map((c) => I.filter((i) => i.jurisdiction_id === j && i.categories.includes(c)).length)));
    $("#jurMatrix").innerHTML = `<thead><tr><th></th>${CATS.map((c) => `<th class="c">${esc(t("cat_" + c))}</th>`).join("")}<th class="c">${t("total")}</th></tr></thead><tbody>` +
      JUR_ORDER.map((j) => `<tr><th>${esc(jurName(j))}</th>${CATS.map((c) => { const n = I.filter((i) => i.jurisdiction_id === j && i.categories.includes(c)).length;
        return `<td class="c ${n ? "" : "zero"}" data-j="${j}" data-c="${c}"><span style="background:${n ? `color-mix(in srgb, ${catColor(c)} ${Math.round(12 + 60 * n / maxJ)}%, transparent)` : "transparent"}">${n || "·"}</span></td>`; }).join("")}
        <td class="c" data-j="${j}" data-c=""><span>${I.filter((i) => i.jurisdiction_id === j).length}</span></td></tr>`).join("") + "</tbody>";

    $("#jurTabs").innerHTML = JUR_ORDER.map((j) => `<button data-jur="${j}" class="${j === polJur ? "active" : ""}">${esc(jurName(j))}</button>`).join("") +
      `<button data-jur="ALL" class="${polJur === "ALL" ? "active" : ""}">${t("jurisdiction_all")}</button>`;
    $("#polCatPills").innerHTML = `<button data-pcat="" class="${!polCat ? "active" : ""}">${t("all_categories")}</button>` +
      CATS.map((c) => `<button data-pcat="${c}" class="${c === polCat ? "active" : ""}" style="--cc:${catColor(c)}"><i class="sw" style="background:${catColor(c)}"></i>${esc(t("cat_" + c))}</button>`).join("");

    const inJ = I.filter((i) => polJur === "ALL" || i.jurisdiction_id === polJur);
    const maxC = Math.max(1, ...D.pol.stages.flatMap((s) => CATS.map((c) => inJ.filter((i) => i.stages.includes(s.stage_id) && i.categories.includes(c)).length)));
    $("#chainSub").textContent = t("chain_sub").replace("{n}", inJ.length);
    $("#chainMatrix").innerHTML = `<thead><tr><th></th>${CATS.map((c) => `<th class="c">${esc(t("cat_" + c))}</th>`).join("")}</tr></thead><tbody>` +
      D.pol.stages.map((s) => `<tr><th title="${esc(L2(s, "desc"))}">${esc(L2(s, "name"))}</th>${CATS.map((c) => {
        const n = inJ.filter((i) => i.stages.includes(s.stage_id) && i.categories.includes(c)).length;
        const sel = polStage === s.stage_id && polCat === c;
        return `<td class="c ${n ? "" : "zero"} ${sel ? "sel" : ""}" data-s="${s.stage_id}" data-c="${c}"><span style="background:${n ? `color-mix(in srgb, ${catColor(c)} ${Math.round(10 + 62 * n / maxC)}%, transparent)` : "transparent"}">${n || "·"}</span></td>`;
      }).join("")}</tr>`).join("") + "</tbody>";

    const list = inJ.filter((i) => (!polCat || i.categories.includes(polCat)) && (!polStage || i.stages.includes(polStage)));
    const groups = D.pol.stages.filter((s) => !polStage || s.stage_id === polStage).map((s) => ({ s, items: list.filter((i) => (polStage ? true : i.stages[0] === s.stage_id || (!D.pol.stages.some((x) => x.stage_id === i.stages[0]) && s.stage_id === "cross"))) }));
    // without a stage filter each instrument is listed once, under its first (primary) stage
    const filterNote = (polStage || polCat) ? `<p class="small"><button class="btn small" id="polClear">${t("clear_filter")}</button> ${polStage ? esc(L2(D.pol.stages.find((x) => x.stage_id === polStage), "name")) : ""} ${polCat ? esc(t("cat_" + polCat)) : ""} · ${list.length} ${t("instruments")}</p>` : "";
    $("#polList").innerHTML = filterNote + (list.length ? groups.filter((g) => g.items.length).map((g) => `<div class="card pol-group"><h3>${esc(L2(g.s, "name"))} <small class="muted">${g.items.length} ${t("instruments")}</small></h3>
      ${g.items.map((i) => `<div class="pol-item"><h4>${esc(lang === "zh" ? i.title_zh || i.title : i.title)}${lang === "zh" && i.title_zh ? `<small>${esc(i.title)}</small>` : ""}</h4>
        <div class="meta"><span class="chip">${esc(i.jurisdiction_id === "FED" ? t("fed") : i.jurisdiction_id)}</span><span class="chip">${esc(lang === "zh" ? ({ Act: "法案", Regulation: "条例", Policy: "政策", Plan: "规划", Program: "计划", Agreement: "协议", Guideline: "指引" }[i.type] || i.type || "") : i.type || "")}</span><span class="chip">${esc(i.status || "")}</span>${i.year ? `<span class="chip">${i.year}</span>` : ""}
          ${i.categories.map(catChip).join("")}${i.regulator ? `<span>${t("regulator")}: <b>${esc(i.regulator)}</b></span>` : ""}</div>
        <div class="prose step-detail">${rich(L2(i, "summary"))}</div>
        ${L2(i, "recent_change") ? `<div class="chg"><b>${t("recent_change")}:</b> ${esc(L2(i, "recent_change"))}</div>` : ""}
        ${i.url ? `<p class="small"><a href="${esc(i.url)}" target="_blank" rel="noopener">${t("open_text")} · ${esc(host(i.url))}</a></p>` : ""}</div>`).join("")}</div>`).join("")
      : `<div class="card"><p class="empty">${t("no_instruments")}</p></div>`);

    const j = D.pol.jurisdictions.find((x) => x.jurisdiction_id === polJur);
    $("#jurCard").innerHTML = j ? `<h3>${esc(L2(j, "name"))}</h3><dl class="kv"><dt>${t("marine_scope")}</dt><dd>${esc(L2(j, "marine_scope"))}</dd><dt>${t("regulators")}</dt><dd>${esc(j.key_regulators || "")}</dd></dl><div class="prose small">${rich(L2(j, "overview"))}</div>`
      : `<h3>${t("jurisdiction_all")}</h3><p class="small muted">${I.length} ${t("instruments")}</p>`;
    const ch = D.pol.changes.filter((c) => (polJur === "ALL" || c.jurisdiction_id === polJur) && (!polCat || c.categories.includes(polCat)));
    $("#polChanges").innerHTML = ch.length ? ch.map((c) => `<li><span class="d">${esc(c.date)}</span>${polJur === "ALL" ? `<span class="chip">${esc(c.jurisdiction_id)}</span>` : ""}${c.source ? `<a href="${esc(c.source)}" target="_blank" rel="noopener">${esc(L2(c, "summary"))}</a>` : esc(L2(c, "summary"))}</li>`).join("") : `<li class="empty">—</li>`;
  }

  // ---------- operators
  function renderOperators() {
    const ops = D.ops.filter((o) => o.project_ids.length).sort((a, b) => b.project_ids.length - a.project_ids.length).slice(0, 15);
    mkChart("chOpProjects", { type: "bar", data: { labels: ops.map(opName), datasets: STAGES.map((s) => ({ label: t("stage_" + s), data: ops.map((o) => o.by_stage[s] || 0), backgroundColor: stageColor(s) })).filter((d) => d.data.some(Boolean)) },
      options: barOpts(true, { stacked: true }) });
    const lngCap = {};
    D.projects.filter((p) => p.capacity_unit === "Mtpa LNG" && ["Operational", "Under construction"].includes(p.stage)).forEach((p) => {
      const k = p.operator || "—"; lngCap[k] = lngCap[k] || { op: 0, uc: 0 }; lngCap[k][p.stage === "Operational" ? "op" : "uc"] += p.capacity || 0; });
    const lk = Object.keys(lngCap).sort((a, b) => (lngCap[b].op + lngCap[b].uc) - (lngCap[a].op + lngCap[a].uc));
    const nm = (n) => { const o = D.ops.find((x) => x.name === n); return o ? opName(o) : n; };
    mkChart("chOpLng", { type: "bar", data: { labels: lk.map(nm), datasets: [
      { label: t("stage_Operational"), data: lk.map((k) => +lngCap[k].op.toFixed(2)), backgroundColor: stageColor("Operational") },
      { label: t("stage_Under construction"), data: lk.map((k) => +lngCap[k].uc.toFixed(2)), backgroundColor: stageColor("Under construction") }] },
      options: barOpts(true, { stacked: true, options: { plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.raw, 2)} Mtpa` } } } } }) });
    const sel = $("#opCategory"), cur = sel.value;
    sel.innerHTML = `<option value="">${t("all_categories")}</option>` + CATS.map((c) => `<option value="${c}" ${c === cur ? "selected" : ""}>${esc(t("cat_" + c))}</option>`).join("");
    const q = ($("#opSearch").value || "").trim().toLowerCase();
    const list = [...D.ops].filter((o) => (!sel.value || o.categories.includes(sel.value) || o.by_category[sel.value]) && (!q || [o.name, o.name_zh, o.ownership, o.hq].join(" ").toLowerCase().includes(q)))
      .sort((a, b) => b.project_ids.length - a.project_ids.length || a.name.localeCompare(b.name));
    $("#opGrid").innerHTML = list.map((o) => {
      const live = o.by_stage.Operational || 0, pipe = (o.by_stage["Under construction"] || 0) + (o.by_stage["Approved / FID"] || 0) + (o.by_stage.Planning || 0);
      const cats = [...new Set([...Object.keys(o.by_category), ...o.categories])].filter((c) => CATS.includes(c));
      return `<div class="op-card" data-op="${esc(o.operator_id)}" tabindex="0" role="button"><h4>${esc(opName(o))}</h4><div class="cat">${esc(o.ownership || "")}${o.hq ? " · " + esc(o.hq) : ""}</div>
        <div class="cats">${cats.map(catChip).join("")}</div>
        <div class="figs"><span><b>${o.project_ids.length}</b>${t("tracked")}</span><span><b>${live}</b>${t("stage_Operational")}</span><span><b>${pipe}</b>${lang === "zh" ? "在建及规划" : "pipeline"}</span></div></div>`;
    }).join("");
  }
  function openOperator(id) {
    const o = D.ops.find((x) => x.operator_id === id); if (!o) return;
    const ps = o.project_ids.map((p) => D.projById[p]).filter(Boolean).sort((a, b) => stageIdx(a.stage) - stageIdx(b.stage));
    $("#drawerBody").innerHTML = `<h2>${esc(opName(o))}${lang === "zh" && o.name_zh && o.name_zh !== o.name ? ` <small>${esc(o.name)}</small>` : ""}</h2>
      <p class="muted small">${esc(o.ownership || "")}${o.hq ? " · " + esc(o.hq) : ""}</p>
      <div class="prose">${rich(L2(o, "background"))}</div>
      <dl class="kv"><dt>${t("ownership")}</dt><dd>${esc(o.ownership || "—")}</dd><dt>${t("hq")}</dt><dd>${esc(o.hq || "—")}</dd>
        <dt>${t("website")}</dt><dd>${o.website ? `<a href="${esc(o.website)}" target="_blank" rel="noopener">${esc(host(o.website))}</a>` : "—"}</dd>
        <dt>${t("sources_lbl")}</dt><dd>${linkList(o.sources) || "—"}</dd></dl>
      <h3>${t("tracked")} (${ps.length})</h3>
      <ul class="facs">${ps.map((p) => `<li>${stageBadge(p.stage)} <a href="#" data-proj="${esc(p.project_id)}">${esc(pName(p))}</a> <small class="muted">${esc(p.state || "")} · ${capStr(p)}</small></li>`).join("") || "<li>—</li>"}</ul>`;
    $("#drawer").hidden = false;
  }

  // ---------- news
  function renderNews() {
    const n = D.news || { items: [] };
    const all = n.items || [];
    const cut30 = new Date(Date.now() - 30 * 86400000).toISOString();
    const recent = all.filter((i) => (i.published || "") >= cut30);
    mkChart("chNewsCat", { type: "bar", data: { labels: CATS.map((c) => t("cat_" + c)).concat([t("untagged")]),
      datasets: [{ label: t("count"), data: CATS.map((c) => recent.filter((i) => (i.categories || []).includes(c)).length).concat([recent.filter((i) => !(i.categories || []).length).length]),
        backgroundColor: CATS.map(catColor).concat([cssVar("--muted")]) }] }, options: barOpts(true, { options: { plugins: { legend: { display: false } } } }) });
    $("#newsAbout").innerHTML = rich(t("news_about"));
    const cSel = $("#nCat"), sSel = $("#nSub"), stSel = $("#nState");
    const cc = cSel.value, cs = sSel.value, cst = stSel.value;
    cSel.innerHTML = `<option value="">${t("all_categories")}</option>` + CATS.map((c) => `<option value="${c}" ${c === cc ? "selected" : ""}>${esc(t("cat_" + c))}</option>`).join("");
    const subs = cc ? D.catById[cc].subcategories : CATS.flatMap((c) => D.catById[c].subcategories);
    sSel.innerHTML = `<option value="">${t("all_subs")}</option>` + subs.map((s) => `<option value="${esc(s.subcategory)}" ${s.subcategory === cs ? "selected" : ""}>${esc(L2(s, "name"))}</option>`).join("");
    stSel.innerHTML = `<option value="">${t("all_states")}</option>` + STATES.filter((s) => s !== "EXT").map((s) => `<option ${s === cst ? "selected" : ""}>${s}</option>`).join("");
    const windowDays = Number(D.meta.news_days_to_keep) || 90;
    const cutoff = new Date(Date.now() - windowDays * 86400000).toISOString();
    const q = $("#nSearch").value.trim().toLowerCase(), lg = $("#nLang").value;
    const filtered = all.filter((i) => (newsAllTime || (i.published || "") >= cutoff) && (!cSel.value || (i.categories || []).includes(cSel.value)) &&
      (!sSel.value || (i.subcategories || []).includes(sSel.value)) && (!stSel.value || (i.states || []).includes(stSel.value)) && (!lg || i.language === lg) &&
      (!q || (i.title + " " + (i.summary || "")).toLowerCase().includes(q)));
    const items = filtered.slice(0, newsShown);
    const since = n.earliest ? ` · ${t("archive_since").replace("{date}", n.earliest)}` : "";
    $("#newsMeta").textContent = n.fetched_at ? `${fmt(filtered.length)} / ${fmt(all.length)} ${t("items")}${since} · ${t("news_fetched")} ${n.fetched_at.slice(0, 16).replace("T", " ")} UTC` : "";
    const subLabel = (s) => { for (const c of CATS) { const x = D.catById[c].subcategories.find((y) => y.subcategory === s); if (x) return L2(x, "name"); } return s; };
    $("#newsList").innerHTML = items.length ? items.map((i) => `<li><span class="d">${esc((i.published || "").slice(0, 10))}</span><div>${(i.categories || []).map((c) => `<i class="cat-dot" style="background:${catColor(c)}" title="${esc(t("cat_" + c))}"></i>`).join("")}<a href="${esc(i.link)}" target="_blank" rel="noopener">${esc(i.title)}</a>${i.publisher ? `<span class="pub">${esc(i.publisher)}</span>` : ""}
      <div class="tags">${(i.subcategories || []).map((s) => `<span class="chip">${esc(subLabel(s))}</span>`).join("")}${(i.states || []).map((s) => `<span class="chip">${s}</span>`).join("")}${(i.operators || []).map((o) => `<span class="chip">${esc(o)}</span>`).join("")}</div></div></li>`).join("")
      : `<li><span></span><span class="muted">${t("news_empty")}</span></li>`;
    const more = filtered.length > items.length, older = !newsAllTime && all.length > filtered.length;
    $("#newsMore").innerHTML = (more ? `<button class="btn" id="btnMoreNews">${t("show_more").replace("{n}", fmt(Math.min(NEWS_PAGE, filtered.length - items.length)))}</button>` : "") +
      (older ? `<button class="btn" id="btnAllNews">${t("show_archive").replace("{n}", fmt(all.length))}</button>` : "");
    const bm = $("#btnMoreNews"), ba = $("#btnAllNews");
    if (bm) bm.onclick = () => { newsShown += NEWS_PAGE; renderNews(); };
    if (ba) ba.onclick = () => { newsAllTime = true; newsShown = NEWS_PAGE; renderNews(); };
  }

  // ---------- data tab
  function renderData() {
    const b = D.build || {};
    $("#buildInfo").innerHTML = `<dt>Workbook</dt><dd>${esc(b.workbook || "—")}</dd><dt>Built (UTC)</dt><dd>${esc(b.built_at_utc || "—")}</dd>` +
      Object.entries(b.counts || {}).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("") +
      (D.news && D.news.fetched_at ? `<dt>news.json</dt><dd>${fmt(D.news.total_items)} · ${esc(D.news.fetched_at)}</dd>` : "");
    if (b.workbook) $("#wbLink").href = `data/workbook/${b.workbook}`;
    const gapsZh = ["LNG及原油出口收入：2014-15至2016-17财年、原油2024-25财年未录入（《资源与能源季报》历史表待核对）",
      "渔业及水产养殖：2017-18至2019-20财年及2022-23财年总产值缺失；2023-24年为ABARES预测口径",
      "AIMS海洋产业指数（全口径海洋经济）未录入", "海水盐：无全国产量及出口额时间序列，仅有项目级数据",
      "项目投资额：多数油气项目仅以美元披露或未披露，投资额图表为下限", "海上风电海域边界、海底电缆：由 GitHub Action 首次运行时下载"];
    const gapsEn = ["LNG and oil export earnings for 2014-15 to 2016-17, and oil for 2024-25, are missing (check REQ historical tables)",
      "Fisheries GVP totals for 2017-18 to 2019-20 and 2022-23 are missing; 2023-24 is an ABARES forecast",
      "AIMS Index of Marine Industry (whole marine economy) not loaded", "Sea salt: no national production or export series, project-level only",
      "Project capex: most oil and gas projects disclose capex in US$ or not at all; the capex chart is a floor",
      "Offshore wind area polygons and submarine cables download on the first GitHub Action run"];
    $("#gapsList").innerHTML = `<ul>${(lang === "zh" ? gapsZh : gapsEn).map((g) => `<li>${esc(g)}</li>`).join("")}${(b.warnings || []).map((w) => `<li class="muted">${esc(w)}</li>`).join("")}</ul>`;
    $("#methodology").innerHTML = lang === "zh" ? `<ul>
      <li><b>收录范围：</b>依托澳洲海域（含州沿海水域、联邦海域及帝汶海条约区）开发的资源与基础设施；Curtis Island LNG厂以陆上煤层气供气，作为海上出口终端列入“其他资源”。</li>
      <li><b>阶段：</b>运营中 = 在产/在运（含部分投运）；建设中 = 已FID且已开工；已获批/已FID = 已作出FID或取得主要审批但未开工；规划中 = 已公布并处于审批或可研（持有海上风电可行性许可证的项目归入此类）；勘探评价 = 有许可或钻探但未确定开发方案；暂停/搁置 = 开发方暂停；退役中 = 已停产且正在封井/拆除；已退役 = 拆除完成；已取消 = 开发方退出或许可交还。</li>
      <li><b>规模口径：</b>各项目沿用来源口径（Mtpa LNG、MW、GL/yr、TAC吨等）；跨项目加总仅在同一子类、同一单位内进行。</li>
      <li><b>产值口径：</b>LNG及原油为出口收入（财年，名义值）；渔业为总产值GVP（ABARES）；未录入数值留空，不作插值。</li>
      <li><b>坐标：</b>海上油气田为近似油田位置；渔业以主要港口或渔区中心为代表点；海上风电项目为许可区域近似中心。</li>
      <li><b>政策：</b>依据2026年10月公开法规整理；每项工具按其主要环节归组，矩阵按全部涉及环节计数。</li></ul>` : `<ul>
      <li><b>Scope:</b> resources and infrastructure developed on Australian marine space (state coastal waters, Commonwealth waters and Timor Sea treaty areas). The Curtis Island LNG plants are fed by onshore coal seam gas and are listed under Other resources as marine export terminals.</li>
      <li><b>Stages:</b> Operational = producing or operating (including partly); Under construction = FID taken and works started; Approved / FID = FID or key approvals, works not started; Planning = announced and in approvals or feasibility (offshore wind feasibility-licence holders sit here); Exploration / appraisal = permits or drilling without a development concept; Suspended = paused by the proponent; Decommissioning = production ceased, plugging or removal under way; Decommissioned = removal complete; Cancelled = proponent withdrew or licence surrendered.</li>
      <li><b>Capacity:</b> each project keeps its source unit (Mtpa LNG, MW, GL/yr, t TAC…); totals are only summed within one sub-category and one unit.</li>
      <li><b>Value:</b> LNG and oil are export earnings (FY, nominal); fisheries are gross value of production (ABARES). Missing values are left blank, never interpolated.</li>
      <li><b>Coordinates:</b> offshore fields are approximate field locations; fisheries use a main port or fishery centroid; offshore wind projects use the approximate centre of the licence area.</li>
      <li><b>Policy:</b> compiled from public legislation as at October 2026. Each instrument is listed under its primary stage; the matrix counts every stage it touches.</li></ul>`;
    $("#sourcesList").innerHTML = `<ul>
      <li>${lang === "zh" ? "项目及运营商：公司公告及年报、NOPTA/NOPSEMA、各州规划及环境登记、DCCEEW、海上基础设施监管机构、AFMA及各州渔业部门；每行来源见主数据表 sources 列。" : "Projects and operators: company announcements and annual reports, NOPTA / NOPSEMA, state planning and environmental registers, DCCEEW, the Offshore Infrastructure Regulator, AFMA and state fisheries agencies; per-row URLs are in the workbook's sources columns."}</li>
      <li>${lang === "zh" ? "产值序列：工业、科学与资源部《资源与能源季报》（经Geoscience Australia AECR等转引）、Geoscience Australia《澳大利亚能源商品资源》、ABARES渔业统计与展望、联邦预算文件（PRRT）、NERA/CODA弃置研究（Advisian）。" : "Value series: DISR Resources and Energy Quarterly (via Geoscience Australia AECR and others), Geoscience Australia Australia's Energy Commodity Resources, ABARES fisheries statistics and outlook, Commonwealth Budget papers (PRRT), NERA/CODA decommissioning study (Advisian)."}</li>
      <li>${lang === "zh" ? "政策：legislation.gov.au 及各州法规网站、监管机构网页；每项工具附原文链接。" : "Policy: legislation.gov.au, state legislation sites and regulator pages; each instrument links to its text."}</li>
      <li>${lang === "zh" ? "地图：底图 Esri World Gray Canvas（备用 OpenStreetMap）；专属经济区外界由 Natural Earth / geo-maps 海域数据简化；3海里线为海岸线缓冲示意，法律界线以 AMB2020 为准；海上风电海域来自 Geoscience Australia；海底电缆来自 TeleGeography（仅供展示）。" : "Map: basemap Esri World Gray Canvas (OpenStreetMap fallback); EEZ outline simplified from Natural Earth / geo-maps maritime data; the 3 nm line is an indicative coastline buffer, AMB2020 is the legal reference; offshore wind areas from Geoscience Australia; submarine cables from TeleGeography (display only)."}</li></ul>`;
  }

  // ---------- map
  const ESRI = (variant, layer) => `https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${variant}_Gray_${layer}/MapServer/tile/{z}/{y}/{x}`;
  const ESRI_ATTR = 'Tiles &copy; <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a>, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
  const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
  let baseLayers = [], usingFallback = false;
  function clearBase() { baseLayers.forEach((l) => map.removeLayer(l)); baseLayers = []; }
  function osmBasemap() { usingFallback = true; clearBase(); const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: OSM_ATTR }); baseLayers = [osm]; osm.addTo(map); }
  function setBasemap(dark) {
    if ((D.meta.basemap_provider || "").toLowerCase() === "osm" || usingFallback) return osmBasemap();
    clearBase();
    const v = dark ? "Dark" : "Light";
    const opts = { maxZoom: 19, maxNativeZoom: 16 };
    const base = L.tileLayer(ESRI(v, "Base"), { ...opts, attribution: ESRI_ATTR });
    const labels = L.tileLayer(ESRI(v, "Reference"), { ...opts, pane: "labels" });
    let errors = 0;
    base.on("tileerror", () => { if (++errors === 6) osmBasemap(); });
    baseLayers = [base, labels];
    baseLayers.forEach((l) => l.addTo(map));
  }
  function initMap() {
    map = L.map("map", { zoomSnap: 0.25, worldCopyJump: false }).setView([D.meta.map_center_lat || -27.5, D.meta.map_center_lng || 133.5], D.meta.map_zoom || 4);
    map.fitBounds([[-44.5, 111.5], [-9.5, 155.5]], { padding: [10, 10] });
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
    map.createPane("labels").style.zIndex = 300;
    map.getPane("labels").style.pointerEvents = "none";
    map.createPane("areas").style.zIndex = 380;
    map.createPane("projects").style.zIndex = 650;
    setBasemap(isDark());
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => { setBasemap(e.matches); applyFilters(); });
    projLayer = L.layerGroup().addTo(map);
    L.control.scale({ imperial: false }).addTo(map);
  }
  function markerStyle(p) {
    const cc = catColor(p.category), grey = stageColor("Decommissioned");
    if (colorMode === "stage") return { color: "#fff", weight: 1.2, fillColor: stageColor(p.stage), fillOpacity: 0.9 };
    switch (p.stage) {
      case "Operational": return { color: "#fff", weight: 1.2, fillColor: cc, fillOpacity: 0.92 };
      case "Under construction": case "Approved / FID": return { color: cc, weight: 2, fillColor: cc, fillOpacity: 0.45 };
      case "Planning": case "Exploration / appraisal": return { color: cc, weight: 2, fillColor: cc, fillOpacity: 0.06 };
      case "Decommissioning": case "Decommissioned": return { color: cc, weight: 2, fillColor: grey, fillOpacity: 0.85 };
      default: return { color: grey, weight: 1.5, fillColor: grey, fillOpacity: 0.2, dashArray: "3 3" };
    }
  }
  const radiusFor = (p) => (p.capex_aud_bn >= 5 || (p.capacity_unit === "Mtpa LNG" && p.capacity >= 5) || (p.capacity_unit === "MW" && p.capacity >= 1500) || p.annual_value_aud_m >= 300 ? 8 : 6);
  function popupHtml(p) {
    return `<b>${esc(pName(p))}</b><br>${stageBadge(p.stage)} <span class="muted">${esc(subName(p.category, p.subcategory))}</span><br>${t("operator")}: <b>${esc(p.operator || "—")}</b><br>${t("capacity")}: ${capStr(p)}`;
  }
  function projMarker(p) {
    const m = L.circleMarker([p.lat, p.lng], Object.assign({ pane: "projects", radius: radiusFor(p), proj: p }, markerStyle(p)));
    m.bindPopup(popupHtml(p));
    m.on("click", () => showDetail(p));
    return m;
  }
  function showDetail(p) {
    if (!p) return;
    const el = $("#detailPanel"); el.dataset.pid = p.project_id;
    el.innerHTML = `<h3>${esc(pName(p))}</h3>${pAlt(p) ? `<p class="small muted">${esc(pAlt(p))}</p>` : ""}${stageBadge(p.stage)} ${catChip(p.category)} <span class="chip">${esc(p.state || "")}</span>
      <p class="small">${esc(L2(p, "nature"))}</p>
      <dl><dt>${t("operator")}</dt><dd>${esc(p.operator || "—")}</dd><dt>${t("capacity")}</dt><dd>${capStr(p)}</dd>
        <dt>${t("basin")}</dt><dd>${esc(p.basin_region || "—")}</dd><dt>${t("years")}</dt><dd>${esc(p.start_year ?? "—")} / ${esc(p.end_year ?? "—")}</dd>
        <dt>${t("latest")}</dt><dd>${esc(L2(p, "latest_update") || "—")}</dd></dl>
      <button class="btn small" data-proj="${esc(p.project_id)}">${t("open_detail")}</button>`;
  }
  function populateFilters() {
    const keep = (sel, vals, allLabel, labelFn = (v) => v) => { const cur = sel.value; sel.innerHTML = `<option value="">${allLabel}</option>` + vals.map((v) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(labelFn(v))}</option>`).join(""); };
    const activeCats = $$("#catToggles input").filter((c) => c.checked).map((c) => c.dataset.cat);
    const cats = activeCats.length ? activeCats : CATS;
    keep($("#fSub"), cats.flatMap((c) => D.catById[c].subcategories.map((s) => `${c}|${s.subcategory}`)), t("all"), (v) => { const [c, s] = v.split("|"); return subName(c, s); });
    keep($("#fState"), STATES.filter((s) => D.projects.some((p) => p.state === s)), t("all"));
    keep($("#fOperator"), [...new Set(D.projects.map((p) => p.operator).filter(Boolean))].sort(), t("all"));
    keep($("#fWaters"), WATERS, t("all"), (w) => t("waters_" + w));
    const ct = $("#catToggles");
    if (!ct.children.length) ct.innerHTML = CATS.map((c) => `<label><input type="checkbox" data-cat="${c}" checked><span class="sw" data-catsw="${c}"></span><span data-cat-label="${c}"></span></label>`).join("");
    $$("[data-catsw]", ct).forEach((el) => { el.style.background = catColor(el.dataset.catsw); });
    $$("[data-cat-label]", ct).forEach((el) => { const c = el.dataset.catLabel; el.textContent = `${t("cat_" + c)} (${D.projects.filter((p) => p.category === c).length})`; });
    const st = $("#stageToggles");
    if (!st.children.length) st.innerHTML = STAGES.map((s) => `<label><input type="checkbox" data-stage="${s}" ${DEFAULT_OFF_STAGES.includes(s) ? "" : "checked"}><span class="sw" data-stsw="${s}"></span><span data-stage-label="${s}"></span></label>`).join("");
    $$("[data-stsw]", st).forEach((el) => { el.style.background = stageColor(el.dataset.stsw); });
    $$("[data-stage-label]", st).forEach((el) => { el.textContent = `${t("stage_" + el.dataset.stageLabel)} (${D.stats.by_stage[el.dataset.stageLabel] || 0})`; });
  }
  function currentProjects() {
    const q = $("#fSearch").value.trim().toLowerCase(), sub = $("#fSub").value, st = $("#fState").value, op = $("#fOperator").value, wa = $("#fWaters").value;
    const cats = $$("#catToggles input").filter((c) => c.checked).map((c) => c.dataset.cat);
    const stages = $$("#stageToggles input").filter((c) => c.checked).map((c) => c.dataset.stage);
    return D.projects.filter((p) => cats.includes(p.category) && stages.includes(p.stage) && (!sub || `${p.category}|${p.subcategory}` === sub) && (!st || p.state === st) &&
      (!op || p.operator === op) && (!wa || p.waters === wa) &&
      (!q || [p.name, p.name_zh, p.operator, p.owners, p.basin_region, p.nature_en, p.nature_zh].join(" ").toLowerCase().includes(q)));
  }
  function applyFilters() {
    if (!projLayer) return;
    const list = currentProjects();
    projLayer.clearLayers();
    list.filter((p) => p.lat != null && p.lng != null).forEach((p) => projLayer.addLayer(projMarker(p)));
    renderTable(list);
    renderMapLegend();
  }
  const COLS = [["name", "name"], ["category", "categories"], ["subcategory", "subcategory"], ["stage", "stage"], ["operator", "operator"], ["state", "state"], ["capacity", "capacity", "num"], ["start_year", "start", "num"], ["end_year", "end", "num"]];
  function renderTable(list) {
    const { key, asc } = sortState;
    const val = (p) => (key === "stage" ? stageIdx(p.stage) : key === "category" ? CATS.indexOf(p.category) : key === "name" ? pName(p) : p[key]);
    const sorted = [...list].sort((a, b) => { const x = val(a), y = val(b); if (x == null) return 1; if (y == null) return -1; return (typeof x === "number" ? x - y : String(x).localeCompare(String(y))) * (asc ? 1 : -1); });
    $("#tableCount").textContent = `${sorted.length} / ${D.projects.length}`;
    $("#projTable thead").innerHTML = "<tr>" + COLS.map(([k, l, n]) => `<th data-key="${k}" class="${n || ""} ${k === key ? "sorted" : ""} ${k === key && asc ? "asc" : ""}">${t(l)}</th>`).join("") + "</tr>";
    $("#projTable tbody").innerHTML = sorted.map((p) => `<tr class="clickable" data-focus="${esc(p.project_id)}"><td class="nm">${esc(pName(p))}</td><td>${catChip(p.category)}</td><td>${esc(subName(p.category, p.subcategory))}</td><td>${stageBadge(p.stage)}</td>
      <td>${esc(p.operator || "—")}</td><td>${esc(p.state || "")}</td><td class="num">${capStr(p)}</td><td class="num">${esc(p.start_year ?? "—")}</td><td class="num">${esc(p.end_year ?? "—")}</td></tr>`).join("");
  }
  function exportCsv() {
    const list = currentProjects();
    const keys = ["project_id", "name", "name_zh", "category", "subcategory", "stage", "state", "waters", "basin_region", "operator", "owners", "capacity", "capacity_unit", "start_year", "end_year", "lat", "lng", "latest_update_en", "latest_update_zh"];
    const rows = [keys.join(",")].concat(list.map((p) => keys.map((k) => `"${String(p[k] ?? "").replace(/"/g, '""')}"`).join(",")));
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + rows.join("\n")], { type: "text/csv" })); a.download = "au_marine_projects.csv"; a.click();
  }
  function renderMapLegend() {
    const el = $("#mapLegend"); if (!el) return;
    const sw = (style) => `<span class="mk" style="background:${style.fillOpacity < 0.1 ? "transparent" : hexA(style.fillColor, style.fillOpacity)};border:${Math.max(1, style.weight)}px ${style.dashArray ? "dashed" : "solid"} ${style.color === "#fff" ? style.fillColor : style.color}"></span>`;
    if (colorMode === "stage") {
      el.innerHTML = STAGES.map((s) => `<div class="row"><span class="mk" style="background:${stageColor(s)}"></span>${esc(t("stage_" + s))}</div>`).join("");
    } else {
      const demo = (stage) => markerStyle({ category: "agri", stage });
      el.innerHTML = CATS.map((c) => `<div class="row"><span class="mk" style="background:${catColor(c)}"></span>${esc(t("cat_" + c))}</div>`).join("") +
        `<div class="row legend-sec">${t("legend_fill")}</div>` +
        [["Operational", "legend_solid"], ["Under construction", "legend_half"], ["Planning", "legend_hollow"], ["Decommissioning", "legend_grey"]].map(([s, k]) => `<div class="row">${sw(demo(s))}${t(k)}</div>`).join("");
    }
  }
  function renderLayerToggles() {
    const box = $("#layerToggles");
    const state = Object.fromEntries($$("input", box).map((i) => [i.dataset.layer, i.checked]));
    const layers = (D.geo || []).filter((g) => g.enabled).map((g) => ({ key: g.layer_id, label: L2(g, "name"), color: g.color_token, on: g.default_on, shape: g.layer_id === "owind_areas" ? "sq" : "line" }));
    layers.splice(layers.findIndex((l) => l.key === "owind_areas") + 1, 0, { key: "__zones", label: t("lyr_zones"), color: "--c-renew", on: true, shape: "dot" });
    box.innerHTML = layers.map((l) => `<label><input type="checkbox" data-layer="${esc(l.key)}" ${(state[l.key] ?? l.on) ? "checked" : ""}><span class="sw ${l.shape}" style="background:${cssVar(l.color)}"></span>${esc(l.label)}</label>`).join("");
    $("#geoHint").textContent = D.geoAvailable.owind_areas ? "" : t("geo_missing");
    layers.forEach((l) => toggleLayer(l.key, state[l.key] ?? l.on));
  }
  async function toggleLayer(key, on) {
    if (geoLayers[key]) { map.removeLayer(geoLayers[key]); delete geoLayers[key]; }
    if (!on) return;
    let g;
    if (key === "__zones") {
      const cc = catColor("renewable");
      g = L.layerGroup(D.zones.filter((z) => z.centroid_lat != null).map((z) => L.circleMarker([z.centroid_lat, z.centroid_lng], { pane: "areas", radius: 14, color: cc, weight: 1.5, dashArray: "4 3", fillColor: cc, fillOpacity: 0.08 })
        .bindTooltip(L2(z, "name").split(/[（(]/)[0].trim(), { permanent: true, direction: "right", className: "zone-label", offset: [12, 0] })
        .bindPopup(`<b>${esc(L2(z, "name"))}</b><br>${esc(z.status || "")} · ${esc(z.declared_date || "")}<br>${z.area_km2 ? fmt(z.area_km2) + " km² · " : ""}${t("licences_active")}: ${z.fl_active ?? "—"} / ${z.fl_granted ?? "—"} · ${z.fl_capacity_gw ?? 0} GW<br><small>${esc(short(L2(z, "notes"), 260))}</small>`)));
    } else {
      const spec = (D.geo || []).find((x) => x.layer_id === key); if (!spec) return;
      if (!(key in geoCache)) geoCache[key] = await loadJSON(`geo/${spec.out_name}`, true);
      const gj = geoCache[key]; if (!gj) return;
      const color = cssVar(spec.color_token || "--muted");
      const styles = {
        eez: { color, weight: 1.4, opacity: 0.8, dashArray: "6 4", fill: false },
        coastal3nm: { color, weight: 1, opacity: 0.8, dashArray: "2 3", fill: false },
        owind_areas: { color, weight: 1.2, opacity: 0.9, fillColor: color, fillOpacity: 0.16 },
        cables: { color, weight: 1.3, opacity: 0.65, dashArray: "4 4" },
      };
      g = L.geoJSON(gj, {
        pane: "areas",
        style: () => styles[key] || { color, weight: 1.2 },
        pointToLayer: (f, ll) => L.circleMarker(ll, { pane: "areas", radius: 3.5, color, weight: 1, fillColor: color, fillOpacity: 0.8 }),
        onEachFeature: (f, layer) => { const p = f.properties || {}; const nm = p.name_zh && lang === "zh" ? p.name_zh : (p.name_en || p.name || p.NAME || p.Name || p.title || ""); const extra = Object.entries(p).filter(([k, v]) => v != null && v !== "" && !/^(name|name_en|name_zh|shape|objectid|fid|globalid)/i.test(k)).slice(0, 6).map(([k, v]) => `${esc(k)}: ${esc(short(v, 60))}`).join("<br>"); layer.bindPopup(`<b>${esc(nm)}</b>${extra ? "<br><small>" + extra + "</small>" : ""}`); },
      });
    }
    geoLayers[key] = g.addTo(map);
  }

  // ---------- events
  function showTab(name) {
    const b = $(`.tabs button[data-tab="${name}"]`); if (!b) return;
    $$(".tabs button").forEach((x) => x.classList.toggle("active", x === b));
    $$(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + name));
    if (name === "map") setTimeout(() => { map.invalidateSize(); if (!map._fitted) { map.fitBounds([[-44.5, 111.5], [-9.5, 155.5]], { padding: [10, 10] }); map._fitted = true; } }, 60);
    Object.values(charts).forEach((c) => c.resize());
    try { history.replaceState(null, "", "#" + name); } catch (e) { location.hash = name; }
  }
  function focusProject(id) {
    const p = D.projById[id]; if (!p) return;
    $("#drawer").hidden = true;
    const ci = $(`#catToggles input[data-cat="${p.category}"]`); if (ci && !ci.checked) { ci.checked = true; }
    const si = $(`#stageToggles input[data-stage="${p.stage}"]`); if (si && !si.checked) { si.checked = true; }
    applyFilters();
    showTab("map");
    showDetail(p);
    if (p.lat != null) { setTimeout(() => { map.setView([p.lat, p.lng], Math.max(map.getZoom(), 7)); projLayer.eachLayer((m) => { if (m.options.proj?.project_id === id) m.openPopup(); }); }, 80); }
  }
  function bind() {
    $$(".tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
    $$(".lang-toggle button").forEach((b) => b.addEventListener("click", () => { lang = b.dataset.lang; try { localStorage.setItem("amr_lang", lang); } catch (e) { /* ignore */ } applyLang(); }));
    ["#fSearch", "#fSub", "#fState", "#fOperator", "#fWaters"].forEach((s) => $(s).addEventListener("input", applyFilters));
    $("#catToggles").addEventListener("change", () => { populateFilters(); applyFilters(); });
    $("#stageToggles").addEventListener("change", applyFilters);
    $("#colorBy").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; colorMode = b.dataset.mode; $$("#colorBy button").forEach((x) => x.classList.toggle("active", x === b)); applyFilters(); });
    $("#layerToggles").addEventListener("change", (e) => { if (e.target.dataset.layer) toggleLayer(e.target.dataset.layer, e.target.checked); });
    $("#btnCsv").addEventListener("click", exportCsv);
    $("#projTable").addEventListener("click", (e) => {
      const th = e.target.closest("th"); if (th) { sortState = { key: th.dataset.key, asc: sortState.key === th.dataset.key ? !sortState.asc : true }; renderTable(currentProjects()); return; }
      const tr = e.target.closest("tr[data-focus]"); if (tr) focusProject(tr.dataset.focus);
    });
    $("#resCatPills").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { resCat = b.dataset.rescat; renderResources(); } });
    $("#catCards").addEventListener("click", (e) => { const c = e.target.closest(".cat-card"); if (c) { resCat = c.dataset.cat; renderResources(); showTab("resources"); } });
    $("#catCards").addEventListener("keydown", (e) => { if (e.key === "Enter") { const c = e.target.closest(".cat-card"); if (c) c.click(); } });
    $("#jurTabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { polJur = b.dataset.jur; polStage = ""; renderPolicy(); } });
    $("#polCatPills").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { polCat = b.dataset.pcat; polStage = ""; renderPolicy(); } });
    $("#jurMatrix").addEventListener("click", (e) => { const td = e.target.closest("td.c"); if (td && !td.classList.contains("zero")) { polJur = td.dataset.j; polCat = td.dataset.c; polStage = ""; renderPolicy(); $("#jurTabs").scrollIntoView({ behavior: "smooth", block: "start" }); } });
    $("#chainMatrix").addEventListener("click", (e) => { const td = e.target.closest("td.c"); if (td && !td.classList.contains("zero")) { const same = polStage === td.dataset.s && polCat === td.dataset.c; polStage = same ? "" : td.dataset.s; polCat = same ? "" : td.dataset.c; renderPolicy(); } });
    $("#polList").addEventListener("click", (e) => { if (e.target.id === "polClear") { polStage = ""; polCat = ""; renderPolicy(); } });
    $("#opCategory").addEventListener("change", renderOperators);
    $("#opSearch").addEventListener("input", renderOperators);
    $("#opGrid").addEventListener("click", (e) => { const c = e.target.closest(".op-card"); if (c) openOperator(c.dataset.op); });
    document.addEventListener("click", (e) => {
      const a = e.target.closest("[data-op]:not(.op-card)"); if (a) { e.preventDefault(); openOperator(a.dataset.op); return; }
      const m = e.target.closest("[data-mapproj]"); if (m) { e.preventDefault(); e.stopPropagation(); focusProject(m.dataset.mapproj); return; }
      const p = e.target.closest("[data-proj]"); if (p) { e.preventDefault(); openProject(p.dataset.proj); }
    });
    $("#drawerClose").addEventListener("click", () => { $("#drawer").hidden = true; });
    $("#drawer").addEventListener("click", (e) => { if (e.target.id === "drawer") $("#drawer").hidden = true; });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#drawer").hidden = true; });
    ["#nSearch", "#nSub", "#nState", "#nLang"].forEach((s) => $(s).addEventListener("input", () => { newsShown = NEWS_PAGE; renderNews(); }));
    $("#nCat").addEventListener("input", () => { $("#nSub").value = ""; newsShown = NEWS_PAGE; renderNews(); });
    if (location.hash) showTab(location.hash.slice(1));
  }

  // ---------- boot
  async function boot() {
    const [meta, cats, projects, ops, zones, kpis, series, breakdowns, pol, stats, build, news, geo] = await Promise.all([
      loadJSON("meta.json"), loadJSON("categories.json"), loadJSON("projects.json"), loadJSON("operators.json"), loadJSON("zones.json"), loadJSON("kpis.json"),
      loadJSON("series.json"), loadJSON("breakdowns.json"), loadJSON("policy.json"), loadJSON("stats.json"), loadJSON("build_info.json", true),
      loadJSON("news.json", true), loadJSON("geo_sources.json", true)]);
    Object.assign(D, { meta, cats, projects, ops, zones, kpis, series, breakdowns, pol, stats, build, news, geo: geo || [] });
    D.catById = Object.fromEntries(cats.map((c) => [c.category_id, c]));
    D.projById = Object.fromEntries(projects.map((p) => [p.project_id, p]));
    D.seriesById = Object.fromEntries(series.map((s) => [s.series_id, s]));
    D.bdById = Object.fromEntries(breakdowns.map((b) => [b.breakdown_id, b]));
    D.geoAvailable = {};
    await Promise.all(D.geo.map(async (g) => { try { const r = await fetch(`data/geo/${g.out_name}`, { method: "HEAD" }); D.geoAvailable[g.layer_id] = r.ok; } catch (e) { D.geoAvailable[g.layer_id] = false; } }));
    initMap(); bind(); applyLang();
  }
  boot().catch((e) => { document.querySelector("main").innerHTML = `<div class="card"><h3>Could not load data</h3><p>${esc(e.message)}</p><p class="small">If you opened index.html directly from disk, serve it instead: <code>python -m http.server -d site 8000</code> then open http://localhost:8000</p></div>`; console.error(e); });
})();
