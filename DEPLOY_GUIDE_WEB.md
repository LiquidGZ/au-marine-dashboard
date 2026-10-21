# 网页端部署指南（无需安装 Git）/ Deploy from the GitHub website

全部操作在浏览器中完成，首次约15分钟。流程与「澳洲数据中心图谱」(au-dc-dashboard) 相同；如已部署过该项目，可直接按下列步骤再做一遍。

---

## 准备

把 `au-marine-dashboard.zip` 解压到桌面。第3步要从解压后的 **au-marine-dashboard** 文件夹中拖拽文件。

## 1. 新建仓库

1. 登录 GitHub，打开 https://github.com/new
2. **Repository name** 填 `au-marine-dashboard`
3. 选 **Public**（免费账户的 GitHub Pages 只支持公开仓库，见文末说明）
4. 勾选 **Add a README file**（会生成 `main` 分支，后续才能上传）
5. 点 **Create repository**

## 2. 开启 Pages 和写入权限（必须在首次构建前完成）

1. **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**（选中即生效）
2. **Settings → Actions → General** → 页面下方 **Workflow permissions** → 选 **Read and write permissions** → **Save**
   （每日任务需要把抓取到的新闻写回仓库）

## 3. 上传文件：一次只传一个文件夹

> 最容易出错的一步：同时选中多个文件夹，浏览器往往只上传散文件、丢掉文件夹。请 **每个文件夹单独提交一次**。

依次对 `site`、`scripts`、`data`、`docs` 四个文件夹各做一次：

1. 仓库 **Code** 页 → **Add file ▾ → Upload files**
2. 从解压目录拖入 **一个** 文件夹（先传 `site`）
3. 等页面文件列表不再增加（`site` 约30个文件），点 **Commit changes**
4. 回到 **Code** 页确认该文件夹已出现，再传下一个

然后把根目录的散文件一次性拖入上传：`README.md`、`DEPLOY_GUIDE_WEB.md`、`DATA_UPDATE_GUIDE.md`、`AUTOMATION.md`。

`.github` 是隐藏文件夹，拖拽会被拦截，下一步手动创建。

**文件夹仍传不上去时：** 在仓库页面按键盘 **`.`** 键，打开网页版 VS Code（github.dev），把文件夹拖进左侧资源管理器，再点左侧 **Source Control** 图标 → 输入说明 → **Commit & Push**。

## 4. 创建工作流文件（提交后自动开始首次构建）

需要建两个文件，方法相同：

1. **Add file ▾ → Create new file**
2. 文件名框输入（输入 `/` 时 GitHub 会自动变成文件夹）：

   ```
   .github/workflows/build-deploy.yml
   ```

3. 用记事本打开解压目录中的 `.github/workflows/build-deploy.yml`（Windows 下若看不到 `.github`，在资源管理器“查看”中勾选“隐藏的项目”），全选复制，粘贴到编辑框
4. **Commit changes**

再用同样方法创建 `.github/workflows/monthly-review.yml`（每月1日生成复核清单，可选）。

## 5. 查看构建并打开网站

1. 打开 **Actions** 页，可以看到 *Build data & deploy to GitHub Pages* 正在运行
2. 包含 `build` 和 `deploy` 两个任务，约3–5分钟，均变绿即成功
3. 网址显示在 `deploy` 任务及 **Settings → Pages** 中：

   `https://<你的用户名>.github.io/au-marine-dashboard/`

首次运行还会：抓取当日新闻；从 Geoscience Australia 下载海上风电海域边界；从 TeleGeography 下载在澳登陆的海底电缆。

---

## 之后更新数据（全部在浏览器完成）

1. 本地打开当前的 `data/source/AMR_Master_20261021.xlsx`，**另存为** 新日期文件名，例如 `AMR_Master_20261130.xlsx`，在新文件中修改
2. 仓库中进入 **data → source** 文件夹
3. **Add file ▾ → Upload files** → 拖入新文件 → **Commit changes**
4. 工作流自动运行：旧版本移入 `data/archive/`，重新生成数据，刷新新闻，重新发布。约3分钟后网站更新

构建程序始终使用文件名日期最新的 `AMR_Master_<YYYYMMDD>.xlsx`，文件名格式不要改。

**只改界面文字**：点开 `site/assets/i18n.js` → 右上角铅笔图标 → 修改 → Commit。不要手工修改 `site/data/` 下的文件，每次构建都会被主数据表覆盖。

**手动触发更新**：**Actions → Build data & deploy to GitHub Pages → Run workflow ▾**；勾选 *Force re-download of map layers* 可强制重新下载地图图层。

---

## 注意事项

- **60天无活动会暂停定时任务。** 新闻停止更新时，到 Actions 页点 **Enable workflow**，或随便提交一次修改
- **私有仓库发布 Pages 需要 GitHub Pro / Team / Enterprise。** 免费账户须设为公开仓库。如需内部使用，可升级账户，或改用 Cloudflare Pages / Netlify 加密码保护（构建命令 `pip install openpyxl && python scripts/build_data.py && python scripts/fetch_news.py`，输出目录 `site`）
- 网页上传单文件上限25 MB，本仓库最大文件约150 KB

## 常见问题

| 现象 | 处理 |
|---|---|
| Actions 在 *Locate project root* 失败 | 文件夹未上传成功。回到第3步，`site`、`scripts`、`data`、`docs` 每个文件夹单独提交 |
| *Build JSON* 报 `No AMR_Master_*.xlsx` | 主数据表没有上传到 `data/source/` |
| 报 `Workbook is missing sheets` | Excel 中工作表被改名，恢复原名称（见主数据表 README 页） |
| 提交步骤报权限错误 | Settings → Actions → General → Workflow permissions → **Read and write** → Save，然后重新运行 |
| `deploy` 任务报 Pages 错误 | Settings → Pages → Source 必须是 **GitHub Actions** |
| 地图底图空白 | 所在网络屏蔽了 Esri 瓦片服务，网站会自动切换到 OpenStreetMap；标记和图层不受影响 |
| 海上风电海域只显示中心点 | Actions → Run workflow，勾选 *Force re-download of map layers* |
| 中文新闻条数为0 | 谷歌新闻中文检索当日无结果属正常；可在 NewsSources 工作表调整检索词 |

---

## English summary

1. Create a public repo `au-marine-dashboard` with a README. 2. Settings → Pages → Source: **GitHub Actions**; Settings → Actions → General → **Read and write permissions**. 3. Upload `site`, `scripts`, `data`, `docs` one folder per commit, then the root `.md` files. 4. Create `.github/workflows/build-deploy.yml` (and `monthly-review.yml`) with **Add file → Create new file** and paste the contents. 5. Watch the Actions tab; the site appears at `https://<user>.github.io/au-marine-dashboard/`. To update data, upload a new `data/source/AMR_Master_<YYYYMMDD>.xlsx`.
