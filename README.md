# Australian Marine Resources Atlas / 澳洲海洋资源图谱

双语（中文 / EN）网页看板：澳洲海洋资源五大类（化石能源、可再生能源、矿产资源、渔业与水产养殖、其他资源）的项目库、地图、产值与趋势、联邦及各州政策框架、每日新闻。结构与「澳洲数据中心图谱」相同。由 GabeHYZ 维护。

**网站：** `https://<用户名>.github.io/au-marine-dashboard/`（按 `DEPLOY_GUIDE_WEB.md` 部署后生效）

## 工作原理 / How it works

```
 主数据表 data/source/AMR_Master_<日期>.xlsx            ← 唯一数据源，日常只改这个
        │  python scripts/build_data.py
        ▼
 site/data/*.json ──┬── site/index.html + assets/app.js（Leaflet 地图、Chart.js 图表、中英文切换）
                    ├── scripts/fetch_news.py → news.json（每日，NewsSources 工作表中的订阅源，NewsRules 自动分类）
                    └── scripts/fetch_geo.py  → geo/*.geojson（每周，GeoSources 工作表中的地图图层）
        │  GitHub Actions：每次提交 + 每天 07:00 AEST
        ▼
 GitHub Pages
```

- **更新数据**：另存新日期的主数据表 → 上传到 `data/source/`（见 `DATA_UPDATE_GUIDE.md`）
- **部署**：`DEPLOY_GUIDE_WEB.md`，全程浏览器操作
- **自动任务**：`AUTOMATION.md`
- **无构建工具**：静态 HTML/CSS/JS，Leaflet 1.9.4 与 Chart.js 4.4.1 已内置于 `site/assets/vendor/`；数据脚本仅依赖 Python 3 + `openpyxl`

## 初始数据（2026年10月21日）

| 数据集 | 条数 | 说明 |
|---|---|---|
| 项目 Projects | 189 | 化石能源55、可再生能源25、矿产15、渔业与水产养殖32、其他62；阶段、运营商、股东、规模、投产/结束年份、坐标、中英文描述、最新进展、来源 |
| 运营商 Operators | 98 | 所有制、总部、中英文背景 |
| 海上风电海域 Zones | 6 | 宣布日期、面积、可行性许可证发放/存续、装机 |
| 时间序列 Series | 17 | LNG/原油出口收入及出口量、分盆地天然气产量、渔业产值、PRRT |
| 分项 Breakdowns | 6 | 分盆地产量、分品种及分辖区渔业产值、分盆地弃置负债 |
| 政策工具 Policy | 115 项 + 30 条近期变化 | 联邦及7个州/领地，按资源类别 × 产业链环节（9个环节）归类 |
| 新闻源 News | 19 | 谷歌新闻中英文检索 16 条 + Offshore Energy、offshoreWIND.biz、RenewEconomy |

研究底稿与已知数据缺口见 `docs/`。

## 许可与署名
代码 MIT。数据汇编自公开来源，仅供研究。海上风电海域 © Commonwealth of Australia (Geoscience Australia) CC BY 4.0；海缆几何 © TeleGeography（仅展示）；200海里/12海里/3海里界线由 Natural Earth 与 geo-maps 数据推算，仅为示意，法律界线以 AMB2020 为准；底图 © Esri / OpenStreetMap。
