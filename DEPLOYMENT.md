# 可选：服务器部署

通常直接双击 `打开即用.html` 就可以使用。只有需要多个设备共用一个服务器时，才需要以下配置。

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
