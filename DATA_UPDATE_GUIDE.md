# 数据更新指南 / Data update guide

网站全部内容来自 `data/source/` 中日期最新的 `AMR_Master_<YYYYMMDD>.xlsx`。更新只需三步：另存新日期 → 修改 → 上传到 `data/source/`。

## 各工作表用途

| 工作表 | 用途 | 常见操作 |
|---|---|---|
| Meta | 网站标题、概览摘要、免责声明、地图中心 | 每季度更新 `national_summary_zh/en` 和 `data_as_of` |
| Categories | 5个资源类别及子类的中英文介绍 | 类别概述数字随年度数据更新 |
| Projects | 每行一个项目/资产/渔业 | 新增项目；修改 `stage`、`latest_update_*`、`last_verified` |
| Operators | 运营商档案 | 新运营商须新增一行，`name` 与 Projects 的 `operator` 完全一致 |
| Zones | 海上风电海域 | 许可证发放/交还后更新 `fl_active`、`fl_capacity_gw` |
| KPIs | 关键指标；`kpi`=TRUE 的显示在总览顶部（按 `kpi_order` 排序，最多8个） | 新数据发布后改数值和 `as_of` |
| Series / SeriesData | 年度时间序列（长表：一行一个年份） | 新财年数据：在 SeriesData 加一行 `series_id, period, value` |
| Breakdowns / BreakdownItems | 单年分项 | 新年度可新建一个 breakdown_id |
| Policy_* | 政策框架：环节、辖区、工具、近期变化、总体说明 | 新法规加到 Policy_Instruments；动态加到 Policy_Changes |
| NewsSources | 每日抓取的 RSS 源 | `enabled` 设 FALSE 可暂停；`filter_keywords` 用于过滤宽口径来源 |
| NewsRules | 新闻自动分类关键词 | 发现误分类时增删关键词，下次运行对存档全部重新分类 |
| GeoSources | 地图图层 | 新增 ArcGIS 服务地址即可加图层（如海洋公园、油气权利区块） |
| Changelog | 版本记录 | 每次新版本加一行 |

## 填写规则

- **阶段（stage）只能用以下值：** Operational / Under construction / Approved / FID / Planning / Exploration / appraisal / Suspended / Decommissioning / Decommissioned / Cancelled
- **类别（category）：** fossil / renewable / mineral / agri / other；**子类（subcategory）** 必须与 Categories 表一致
- **多值单元格**（sources、categories、stages）用 ` | ` 分隔
- **未公开数值留空**，不要估算；数值的口径、年份写在 `capacity_note` 或描述中
- **描述字段**格式：首句为定位，后接以 `- ` 开头的要点，每行一个；网站会自动排成要点列表
- **中文写法**：研报书面语，短句，数字带单位、时点及口径；避免空泛形容词
- 不要修改工作表名称和表头；新增列放在最右侧

## 本地预览（可选）

```
pip install -r scripts/requirements.txt
python scripts/build_data.py
python -m http.server -d site 8000      # 浏览器打开 http://localhost:8000
```

## English
Edit the newest `AMR_Master_<YYYYMMDD>.xlsx` saved under a new date, upload it to `data/source/`, and the GitHub Action rebuilds the site. Keep sheet names and headers unchanged, leave undisclosed values blank, use ` | ` for multi-value cells, and keep `stage` / `category` / `subcategory` to the listed values. Build warnings (unknown stage, missing operator row, missing coordinates) are shown on the site's Data & sources tab.
