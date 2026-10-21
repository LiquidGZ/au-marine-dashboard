# Map layers / 地图图层说明

| 图层 | 文件 | 来源 | 说明 |
|---|---|---|---|
| 200海里界线（示意） | site/data/geo/eez.geojson | Natural Earth 10m 陆地，200海里缓冲，按等距线与邻国分割 | 示意用。法律界线以 Geoscience Australia AMB2020 及澳印尼、澳巴新、澳东帝汶条约为准 |
| 领海约12海里（示意） | territorial_sea_12nm.geojson | geo-maps countries-maritime 50m（OSM） | 简化处理 |
| 州沿海水域约3海里（示意） | coastal_waters_3nm.geojson | Natural Earth 10m 海岸线3海里缓冲 | 法律上自领海基线起算，海湾处差异较大 |
| 海上风电海域 | offshore_wind_areas.geojson | Geoscience Australia "Offshore Renewable Energy Infrastructure Regions" FeatureServer | GitHub Action 每周下载 |
| 海底电缆 | submarine_cables.geojson | TeleGeography 公开 API | 仅供展示 |

如需增加海洋公园（Australian Marine Parks）、油气权利区块（NOPTA）、管道等图层：在主数据表 GeoSources 工作表新增一行，type 填 `arcgis_featureserver`，url 填服务地址（FeatureServer 或 MapServer 根地址，或带图层编号），out_name 填文件名，下次运行自动下载。
