# Australian Marine Resources Atlas — research spec (shared by all research agents)

Date context: today is 21 October 2026. Status must be current as at Oct 2026 — verify with web search; your training data may be stale for 2025–26 events (FIDs, withdrawals, cessation of production, licence awards, auctions).

Output: write ONE UTF-8 JSON file to the path named in your task. Valid JSON (check with `python3 -c "import json;json.load(open(PATH))"`). No comments in the JSON.

## Project record schema
```json
{
  "project_id": "FOS-001",
  "name": "North West Shelf Project",
  "name_zh": "西北大陆架项目",
  "category": "fossil | renewable | mineral | agri | other",
  "subcategory": "(one value from the vocabulary below)",
  "nature_en": "LNG export: offshore gas fields + Karratha Gas Plant",
  "nature_zh": "LNG出口：海上气田＋Karratha天然气处理厂",
  "state": "WA | NT | QLD | NSW | VIC | TAS | SA | EXT (external territory / JPDA / Timor Sea) ",
  "waters": "Commonwealth | Coastal (state/NT) | Both | Onshore (marine-linked)",
  "basin_region": "Northern Carnarvon Basin",
  "lat": -19.59, "lng": 116.14,
  "location_note": "field centroid | facility | representative point for a fishery",
  "operator": "Woodside Energy",
  "owners": "Woodside 33.33% (operator), BHP→Woodside..., Chevron 16.67%, ...",
  "stage": "Operational | Under construction | Approved / FID | Planning | Exploration / appraisal | Suspended | Decommissioning | Decommissioned | Cancelled",
  "capacity": 16.9, "capacity_unit": "Mtpa LNG",
  "capacity_note": "nameplate; 5 trains, Train 1 & 2 retired 2020/2024",
  "annual_output": 13.5, "annual_output_unit": "Mt LNG", "output_year": "FY2025",
  "annual_value_aud_m": null,
  "capex_aud_bn": null,
  "start_year": 1984, "end_year": 2070,
  "description_en": "One lead sentence.\n- dot point\n- dot point\n- dot point",
  "description_zh": "一句话定位。\n- 要点\n- 要点\n- 要点",
  "latest_update_en": "2025-05: Federal approval of NWS extension to 2070 (final conditions 2025-09).",
  "latest_update_zh": "2025年5月：联邦政府批准西北大陆架延期至2070年（2025年9月最终附加条件）。",
  "sources": ["https://...", "https://..."],
  "last_verified": "2026-10"
}
```
Rules
- Numbers: only use figures you found in a source. Unknown → null. Never estimate silently. If a figure is an estimate by a credible third party, say so in capacity_note / description.
- Coordinates: decimal degrees, 2–3 decimals. Offshore field = approximate field location; point to the offshore asset, not the head office. For fisheries use a representative point (main port or fishery centroid) and say so in location_note.
- description: 3–5 dot points, each with a concrete fact (number, date, owner, technology). EN and ZH carry the same facts.
- latest_update: the most recent dated development you can verify (2025–2026 preferred).
- sources: 1–3 URLs, primary (company / regulator / government) first.
- stage definitions: Operational = producing / operating (including partly). Under construction = FID taken & works started. Approved / FID = FID or all key approvals but works not started. Planning = announced, in approvals / feasibility (offshore wind feasibility licence holders = Planning). Exploration / appraisal = permits / drilling, no development concept selected. Suspended = shelved / paused by proponent. Decommissioning = production ceased, removal/plugging under way. Decommissioned = removal complete. Cancelled = proponent withdrew / licence surrendered.

## Subcategory vocabulary (use exactly)
- fossil: "LNG", "Oil & condensate", "Domestic gas", "Exploration & appraisal"
- renewable: "Offshore wind", "Wave & tidal", "Other marine renewables"
- mineral: "Sea salt & potash", "Seabed minerals", "Marine sand"
- agri: "Finfish aquaculture", "Shellfish & pearl aquaculture", "Seaweed aquaculture", "Wild-catch fishery"
- other: "CCS & gas storage", "Desalination", "Subsea cables & interconnectors", "Ports & LNG terminals"

## Operator record schema (for the main operators you cite)
```json
{"operator_id":"woodside","name":"Woodside Energy","name_zh":"伍德赛德能源","ownership":"Listed (ASX/NYSE: WDS)","hq":"Perth","categories":["fossil","other"],
 "background_en":"Lead.\n- point\n- point","background_zh":"一句话。\n- 要点\n- 要点","website":"https://...","sources":["..."]}
```
Use lowercase slug operator_id; the project's "operator" string must match the operator record's "name" exactly.

## Chinese writing standard (strict — the reader is a professional Chinese investor)
- Written like a sell-side / buy-side research note: short declarative sentences, high information density, numbers with units, dates and the basis of the figure.
- Banned words / patterns: 值得注意的是、需要指出、总的来说、综上所述、总而言之、不仅……而且、赋能、助力、打造、彰显、深耕、扮演……角色、具有重要意义、一站式、全方位、持续发力、蓬勃发展、日益、不断、进一步（泛用）、旨在、致力于、标志着、里程碑、引领、破折号“——”、感叹号、比喻、排比、空泛形容词（显著/巨大/重要）without a number.
- Use industry terms: 运营商、权益、FID（最终投资决定）、铭牌产能、2P储量、在产、停产、退役、弃置、可行性许可证、商业许可证、海域、联邦海域、州沿海水域、配额、养殖海域租约。
- Company names: Chinese name if a standard one exists (伍德赛德 Woodside、桑托斯 Santos、雪佛龙 Chevron、壳牌 Shell、埃克森美孚 ExxonMobil、英国石油 bp、道达尔能源 TotalEnergies、国际石油开发帝石 INPEX、三井、三菱), otherwise keep English.
- Units: 百万吨/年 (Mtpa)、千兆瓦/吉瓦 GW、兆瓦 MW、亿澳元 (convert A$bn ×10), 千桶/日, 拍焦 PJ.
- English: plain, factual, no marketing language.
