# clash_integration

Cloudflare Worker 多订阅整合脚本，支持：

- 聚合多个上游订阅并实时生成 Clash 配置
- 手动更新/客户端自动更新触发
- Telegram 成功与失败通知

本项目采用 **GitHub Actions 自动部署**，敏感信息通过 Secrets 注入，不在仓库明文保存。

## 从头部署（完整步骤）

## 1) 准备代码仓库

1. 创建或使用你自己的 GitHub 仓库。
2. 把本项目代码放入仓库（保持包含 `worker.js`、`wrangler.toml`、`.github/workflows/deploy.yml`）。
3. 确认默认分支是 `main`（workflow 监听 `main` push）。

## 2) 修改基础配置文件（非敏感）

编辑 `wrangler.toml`：

- `name`：改成你的 Worker 名称（例如 `my-clash-worker`）
- `main`：保持 `worker.js`
- `compatibility_date`：可保持当前值
- `[vars]`：保持占位，不要填真实订阅和真实 token

> 注意：真实 `SUB_URLS` 和 `TOKEN` 不写在文件里，后面放 GitHub Secrets。

## 3) 配置 GitHub Actions 部署凭据

进入仓库页面：
`Settings -> Secrets and variables -> Actions -> Repository secrets`

需要添加 4 个 Secret：

### 3.1 `CF_API_TOKEN`

作用：让 GitHub Actions 有权限调用 Cloudflare 部署 Worker。  
获取方式：

1. 打开 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 点击右上角头像 -> `My Profile`
3. 进入 `API Tokens`
4. 点击 `Create Token`
5. 选择 Workers 相关模板（或自定义最小权限：Workers 写入 + Account 读取）
6. 创建后复制 token，写入 GitHub Secret `CF_API_TOKEN`

### 3.2 `CF_ACCOUNT_ID`

作用：指定部署到哪个 Cloudflare 账号。  
获取方式：

1. 打开 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入任意账号主页
3. 在账号信息区域找到 `Account ID`
4. 复制后写入 GitHub Secret `CF_ACCOUNT_ID`

### 3.3 `SUB_URLS`

作用：上游订阅源列表（核心数据）。  
设置方式：

1. 在 GitHub 新建 Secret：`SUB_URLS`
2. 值填写为多行，每行一个订阅链接
3. 不要加引号，不要带多余空格

示例格式（仅格式示意）：

```text
https://example-a.com/sub?token=xxx
https://example-b.com/sub?token=yyy
https://example-c.com/sub?token=zzz
```

### 3.4 `TOKEN`（建议配置）

作用：你的聚合订阅访问口令（`?token=...`）。  
设置方式：

1. 在 GitHub 新建 Secret：`TOKEN`
2. 设置一段你自己的口令（尽量复杂）

> 不配置时会回退默认值 `25698`，不建议长期使用默认值。

## 4) 配置 Cloudflare Worker 的 Telegram Secrets

进入：
`Cloudflare Dashboard -> Workers & Pages -> 你的 Worker -> Settings -> Variables and Secrets`

添加以下 Secrets：

### 4.1 `TG_BOT_TOKEN`

作用：Worker 调用 Telegram Bot API 发消息。  
获取方式：

1. 打开 Telegram，搜索 `@BotFather`
2. 发送 `/newbot`，按提示创建机器人
3. 创建成功后获得 bot token
4. 将该 token 填入 Cloudflare Secret `TG_BOT_TOKEN`

### 4.2 `TG_CHAT_ID`

作用：指定消息发到哪个聊天（私聊或群）。  
获取方式（私聊）：

1. 给你的 bot 发送 `/start`
2. 浏览器访问：
   `https://api.telegram.org/bot<你的TG_BOT_TOKEN>/getUpdates`
3. 在返回 JSON 中找到 `chat.id`
4. 把该值填入 Cloudflare Secret `TG_CHAT_ID`

获取方式（群聊）：

1. 把 bot 拉进群
2. 在群里发送任意消息
3. 访问同一个 `getUpdates` URL
4. 找到该群消息对应的 `chat.id`（通常为负数）
5. 填入 `TG_CHAT_ID`

### 4.3 `TG_SILENT`（可选）

作用：是否静默通知。  
设置方式：

- 设为 `true` / `1` / `yes`：静默推送
- 不设或其他值：普通推送

## 5) 首次触发自动部署

在本地仓库执行：

```bash
git add .
git commit -m "initial deploy setup"
git push origin main
```

然后到 GitHub：

1. 打开 `Actions`
2. 进入 `Deploy to Cloudflare Workers`
3. 确认任务成功（绿色）

## 6) 获取订阅链接并导入 Clash

获取 Worker 地址：

1. 在 Actions 的 deploy 日志里查看 workers.dev 地址  
   或在 Cloudflare Worker 页面查看域名
2. 拼接订阅 URL：
   `https://你的worker域名/?token=你的TOKEN`

导入 Clash Verge：

1. 打开 Clash Verge -> `Profiles`
2. 新增订阅，填入上面的 URL
3. 保存后点击一次手动更新

## 7) 验证是否部署成功

### 7.1 浏览器验证

打开：

- `https://你的worker域名/health`（应返回 `OK`）
- `https://你的worker域名/?token=你的TOKEN`（应返回 YAML 内容）

### 7.2 Telegram 验证

手动触发一次订阅更新后，TG 应收到：

- 成功消息（节点数、成功/失败源站、流量等）
- 若失败会收到错误通知

## 8) 后续日常更新流程

以后每次修改代码都一样：

```bash
git add .
git commit -m "your change"
git push origin main
```

然后看 Actions 部署结果。

需要改订阅源时：

- 只改 GitHub Secret `SUB_URLS`
- 改完后重新触发部署（重新运行 workflow 或再 push 一次）

## 9) 常见问题排查

- `Forbidden: Access Token Required.`
  - 检查订阅 URL 是否带 `?token=...`
  - 检查 `TOKEN` Secret 是否与你使用的一致

- `Error: SUB_URLS is empty.`
  - 检查 GitHub Secret `SUB_URLS` 是否已配置
  - 确认 Actions 部署是否成功

- 没有 TG 通知
  - 检查 Cloudflare Secrets：`TG_BOT_TOKEN`、`TG_CHAT_ID`
  - 私聊场景确认 bot 已 `/start`
  - 群聊场景确认 bot 仍在群内且有权限

## 10) 安全建议（重要）

- 不要把真实订阅链接写进仓库文件
- 不要在截图、日志、issue 中暴露 token
- 仓库即使设为私有，也建议坚持使用 Secrets
