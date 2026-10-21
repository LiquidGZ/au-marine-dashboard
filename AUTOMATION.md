# 自动运行的任务 / What runs by itself

| 时间 | 工作流 | 内容 | 是否改动主数据 |
|---|---|---|---|
| 每天 21:00 UTC（澳东 07:00 AEST / 08:00 AEDT） | `build-deploy.yml` | 抓取当日新闻并追加到存档，按 NewsRules 分类，重建全部 JSON，重新发布 | 否，仅新闻 |
| 每周一（同一次运行） | `build-deploy.yml` | 重新下载海上风电海域边界、海底电缆 | 否 |
| 每月1日 22:00 UTC | `monthly-review.yml` | 读取上月新闻，列出涉及的项目、运营商、可能的政策变化及超过180天未核实的项目，开一个 GitHub Issue | 否，只生成清单 |
| 每次提交 | `build-deploy.yml` | 重建并发布 | 否 |

## 新闻存档只增不减
`scripts/fetch_news.py` 每次只追加新条目，按链接和标题去重。网站默认显示近90天（Meta 表 `news_days_to_keep`），可展开全部存档。

每条新闻自动标注：
- **资源类别及子类**：按 NewsRules 工作表关键词匹配（中英文）；无匹配时取订阅源的 `default_category`
- **州/领地**：地名关键词
- **运营商、项目**：按 Operators、Projects 表中的名称匹配（只用有辨识度的名称，如 Scarborough、Marinus Link）

修改 NewsRules 后，下次运行会对整个存档重新分类。

## 月度复核 Issue
每月1日生成 **"Monthly data review — 2026-11"**，以勾选框列出需要核对的事项，同时保存在 `review/YYYY-MM.md`。处理完毕后更新主数据表并关闭 Issue。它从不修改主数据表：阶段、规模、权益等数字需要人工判断。

## 注意
- 仓库60天无活动，GitHub 会暂停定时任务（会提前发邮件）。到 Actions 页点 **Enable workflow** 即可恢复
- 当天无新新闻时不会产生提交，属正常
- 公开仓库的 Actions 分钟数不限；每天约3–5分钟
- 不需要任何 API 密钥或付费服务
