# 考研英语阅读 · 生词难句标注

在浏览器里阅读考研英语阅读真题，用鼠标选中生词和难句做标记，再导出成 Markdown。

## 云端部署（推荐 Render）

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2Fliwang614%2Fkaoyan-reading)

1. 登录 Render，连接自己的 GitHub，并允许 Render 访问私有仓库 `liwang614/kaoyan-reading`。
2. 点击上方按钮；如未直接识别私有仓库，在 Render 选择 **New → Blueprint**，选中该仓库和 `main` 分支。配置文件为根目录的 `render.yaml`。
3. 填写 `BASIC_AUTH_PASSWORD`，确认页面上的服务和数据盘费用，再创建部署。默认用户名为 `admin`。
4. 部署成功后打开 Render 提供的 HTTPS 地址，输入用户名和密码即可使用；原来的文章地址对应 `https://你的域名/#/2023/2`。

配置包含单个 Python 服务、新加坡区域和 1 GB 持久数据盘。标注、进度和做题记录写入 `/var/data`，重启和更新后保留；推送到 GitHub 的 `main` 分支后自动部署更新。持久盘需要付费服务，本配置并非免费方案，以 Render 创建页面显示的费用为准。

本项目需要 Python 后端及可写磁盘，不能直接作为 GitHub Pages 静态站点部署。Render 官方说明：[部署按钮](https://render.com/docs/deploy-to-render)、[持久磁盘](https://render.com/docs/disks)。

## Docker 部署（本机 / 自有服务器）

安装 Docker 后，在项目目录执行：

```bash
cp .env.example .env
# 编辑 .env，填写 BASIC_AUTH_PASSWORD
docker compose up -d --build
```

默认访问 `http://127.0.0.1:8765`，用户名 `admin`，密码使用 `.env` 中填写的值。若本地原服务已占用 8765，在 `.env` 设置 `APP_PORT=8766`。数据放在 Docker 的 `reading-data` 命名卷中，更新时执行 `git pull` 和 `docker compose up -d --build` 即可。

在自有服务器上通过 HTTPS 反向代理访问，并原样传递 `Host` 请求头；需要直连容器端口时，在 `.env` 设置 `BIND_ADDRESS=0.0.0.0`。Basic 认证应配合 HTTPS 使用。

## 本地数据与迁移

GitHub 仓库仅提交程序、阅读文章和词频语料。`data/`、旧备份、`.env` 和本机工具设置不上传；本地已有记录仍在原处，新部署初次打开时记录为空。阅读标注和做题记录是同一位使用者共享的一套数据，并非多用户系统。

迁移到 Render：先在服务的 **Connect → SSH** 按平台提示配置 SSH，取得服务的连接地址；暂停本地编辑后，将以下命令中的 `服务SSH地址` 替换为该地址：

```bash
scp -r data/. 服务SSH地址:/var/data/
```

迁移到 Docker：建议先在一个全新的数据卷上启动一次，再停止服务、复制和恢复启动：

```bash
docker compose stop reading
docker compose cp data/. reading:/data/
docker compose run --rm --no-deps --user root reading chown -R 10001:10001 /data
docker compose start reading
```

复制到已有部署时，同名文件会被覆盖，请先备份目标数据。迁移后刷新网页确认标注和做题记录。完整备份应包含 `data/marks/`、`data/progress.json` 和 `data/records.json`；浏览器配色、侧栏折叠和未提交的临时修改保存在各浏览器中。

部署变量：`HOST` 为监听地址（默认仅本机），`PORT` 为端口，`KAOYAN_DATA_DIR` 为数据目录，`BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` 为访问凭据。对外监听时必须设置访问密码；`/healthz` 为不含学习数据的公开健康检查接口。

## 启动

双击 `start.command`，或者在终端运行：

```bash
python3 server.py
```

浏览器会自动打开 http://127.0.0.1:8765 。只需要 Python 3，不用装任何依赖。

## 使用

1. **首页**：按年份正序（2010 → 2026）列出 Text 1–4，点进要读的那篇；阅读页的「上一篇 / 下一篇」也按这个顺序走。每篇有三种进度状态：
   - **未做**：还没有标注（白色卡片）。
   - **进行中**：标了第一个词或句子后自动变成进行中（琥珀色）。
   - **已完成**：在阅读页顶部点「✓ 已完成」（绿色）。阅读页顶部也可以随时手动改回未做或进行中。
   - 顶部有总进度条和「全部 / 未做 / 进行中 / 已完成」筛选，「继续上次」直接回到最近打开的那篇；年份下的小圆点是这一年四篇的进度。
2. **阅读页**：用鼠标选中单词或句子，在弹出的菜单里点「生词」或「难句」（快捷键 `D` / `F`）。
   - 标生词时会自动补全成完整单词，并去掉两端的标点。
   - 点击已经标过的内容可以删除；右侧列表点击可定位，点 ✕ 删除。
   - 右侧「生词」「难句」面板点标题可以折叠；点「收起」把整个侧栏收到右边缘，正文变宽，点右侧把手再展开。折叠状态会记住。
   - 每次改动都会自动保存到 `data/marks/`。
   - 每个生词后面显示「历年 N」：它在 2010–2026 全部真题文本（阅读原文、阅读题目、完形、新题型、翻译、写作）里出现的次数，点开看每年出现在哪部分、有哪些词形。
     - 按原形合并统计（contend / contends / contended 算同一个词，短语也认变形）。以 -ing / -ed 结尾的独立名词或形容词（如 parenting、contented）会被并到原形上，所以同时显示「本词形 N 次」供你判断。
3. **导出**：
   - 阅读页的「下载本篇 MD」：只导出当前这篇。
   - 首页点「选择导出」进入选择模式：
     - 点卡片选中 / 取消；点年份整年选中；按住 Shift 点击可连续选一段；底栏还有全选、仅已标注、反选、清空。
     - 导出方式：**每篇一个 md**（多篇打包成 zip）或 **合并为一个 md**（末尾附去重后的生词总表）。
     - 导出内容可多选：生词、难句、做题结果、历年统计（生词表的「历年出现 / 分布」两列，需同时选生词）。阅读页的「下载本篇 MD」也会弹出同样的选项，两处共用并记住选择。
     - 选择会记在浏览器里，下次打开还在。

## 做题记录（原「英语真题记录」，已并入）

顶栏左侧切换「阅读标注 / 做题记录」。

- 记录每年 45 道客观题（完形 1–20、阅读 21–40、新题型 41–45）的对错和错选项，以及用时、做题顺序，可下载 Markdown / JSON（与原项目相同）。
- 键盘：`1` 未做、`2` 对、`3` 错（再输入 A–D / A–G 回车）；方向键切题，`Delete` 清除。
- 和阅读联动：阅读 Text n 对应 21+5(n−1) 起的 5 题。
  - 首页阅读卡片右上角显示「✓ 对几道 / 已做几道」。
  - 导出 md 时可选择带上每篇的「做题结果」。
- 数据在 `data/records.json`；`data/backup/` 里有合并时从原项目复制的备份。原项目目录未改动，已停用。

## 配色

顶栏的圆形色块按钮打开配色面板：16 个预设色调、色相滑块、色彩浓度、背景光晕、明暗（跟随系统 / 浅色 / 深色）。整个界面随色相一起变化，设置保存在浏览器里。

## 放入文章

```
articles/
  2015/
    text1.txt
    text2.txt
  2016/
    text1.txt
```

- 纯文本，UTF-8 编码。
- 段落之间空一行；同一段内的换行会自动合并成空格。

## 目录结构

| 路径 | 内容 |
|------|------|
| `server.py` | 本地服务器（只用 Python 标准库） |
| `static/` | 前端页面 |
| `articles/` | 阅读原文 |
| `data/marks/` | 标注记录（JSON） |
| `data/progress.json` | 每篇的进度状态和最近打开时间 |
| `data/records.json` | 做题记录（对错、错选项、用时、做题顺序） |
| `corpus/` | 历年完形、阅读题目、新题型、翻译、写作的文本，用于统计生词出现次数 |
