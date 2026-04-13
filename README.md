# clash_integration

Cloudflare Worker 多订阅整合脚本。  
采用 GitHub Actions 自动部署，`SUB_URLS` 与 `TOKEN` 通过 GitHub Secrets 注入，避免在仓库明文保存。

## 部署步骤

1. 修改 `worker.js` 或 `wrangler.toml` 后 push 到 `main`。
2. GitHub Actions 读取 Secrets，动态写入 `wrangler.toml` 的 `[vars]` 后部署。
3. Cloudflare Worker 使用 `TG_BOT_TOKEN`、`TG_CHAT_ID` 发送更新通知。

## 必要配置

### GitHub Repository Secrets（Actions 用）

- `CF_API_TOKEN`：Cloudflare API Token（用于部署）
- `CF_ACCOUNT_ID`：Cloudflare Account ID
- `SUB_URLS`：多条订阅链接（支持多行）
- `TOKEN`：访问鉴权 token（可选，不填时默认 `25698`）

### Cloudflare Worker Secrets（运行时用）

- `TG_BOT_TOKEN`
- `TG_CHAT_ID`
- `TG_SILENT`（可选，静默通知）

## 重要安全说明

- 不要在 `wrangler.toml` 提交真实 `SUB_URLS` 或 token。
- 如果历史提交中出现过真实订阅链接，请重写 Git 历史后再继续使用。
# clash_integration

Cloudflare Worker 多订阅整合脚本，按请求实时生成 Clash 配置，支持 Telegram 成功/失败通知。

## 一、项目结构

- `worker.js`：核心逻辑（抓取订阅、解析节点、生成 YAML、发送 TG 通知）
- `wrangler.toml`：Worker 基础配置与非敏感变量（如 `SUB_URLS`、`TOKEN`）
- `.github/workflows/deploy.yml`：推送到 `main` 后自动部署到 Cloudflare Workers

## 二、首次部署（推荐：Git 自动部署）

### 1) Fork 或克隆仓库后，修改配置文件

编辑 `wrangler.toml`：

- 设置 `name`（Worker 名称）
- 在 `[vars]` 中维护：
  - `TOKEN`（访问鉴权用）
  - `SUB_URLS`（多条订阅链接，按行写）

> `SUB_URLS` 支持多行，脚本会自动解析。

### 2) 在 GitHub 仓库设置 Actions Secrets（部署必需）

进入：`Repository -> Settings -> Secrets and variables -> Actions -> Repository secrets`

添加：

- `CF_API_TOKEN`
- `CF_ACCOUNT_ID`

> 这两个只用于 GitHub Actions 部署，不写入代码。

### 3) 在 Cloudflare Worker 设置 Secrets（通知必需）

进入：`Cloudflare Dashboard -> Workers & Pages -> 你的 Worker -> Settings -> Variables and Secrets`

添加：

- `TG_BOT_TOKEN`
- `TG_CHAT_ID`

可选：

- `TG_SILENT`（静默通知开关）

### 4) 推送到 `main` 触发自动部署

```bash
git add .
git commit -m "update worker config"
git push origin main
```

部署成功后，访问你的 Worker 地址并带上 `token` 参数即可使用。

## 三、后续重新部署怎么做

以后只要按下面流程：

1. 修改 `worker.js` 或 `wrangler.toml`
2. 提交并推送到 `main`
3. 等待 GitHub Actions 完成部署

```bash
git add .
git commit -m "your change"
git push origin main
```

> 本项目当前以 `wrangler.toml` 为订阅配置单一来源。  
> 需要增减订阅地址时，只改 `wrangler.toml` 的 `SUB_URLS`。

## 四、变量放置规则（重要）

### 放在 `wrangler.toml`（可跟随代码）

- `SUB_URLS`
- `TOKEN`

### 放在 Cloudflare Secrets（敏感信息）

- `TG_BOT_TOKEN`
- `TG_CHAT_ID`
- `TG_SILENT`（可选）

### 放在 GitHub Secrets（仅部署）

- `CF_API_TOKEN`
- `CF_ACCOUNT_ID`

## 五、部署前信息清单（含获取方式）

以下信息建议先准备完，再开始部署。

### 1) `CF_API_TOKEN`（GitHub Secret）

用途：GitHub Actions 调用 Cloudflare API 完成部署。  
获取方式：

1. 打开 Cloudflare Dashboard
2. 进入 `My Profile -> API Tokens`
3. 点击 `Create Token`
4. 选择 Workers 相关模板（或自定义最小权限：Workers 脚本写入 + Account 读取）
5. 生成后复制 Token，只在创建时可见
6. 到 GitHub 仓库 `Settings -> Secrets and variables -> Actions` 新建 `CF_API_TOKEN`

### 2) `CF_ACCOUNT_ID`（GitHub Secret）

用途：告诉部署动作目标是哪个 Cloudflare 账号。  
获取方式（任一方式）：

- Cloudflare Dashboard 主页右侧 Account 信息区域可见 `Account ID`
- 或进入 `Workers & Pages` 任意 Worker 页面查看账号信息

复制后写入 GitHub Actions Secret：`CF_ACCOUNT_ID`。

### 3) `TG_BOT_TOKEN`（Cloudflare Secret）

用途：Worker 调用 Telegram Bot API 发通知。  
获取方式：

1. 在 Telegram 搜索 `@BotFather`
2. 发送 `/newbot` 并按提示创建机器人
3. BotFather 返回一串 token（即 `TG_BOT_TOKEN`）
4. 到 Cloudflare Worker 的 `Variables and Secrets` 添加该 Secret

### 4) `TG_CHAT_ID`（Cloudflare Secret）

用途：指定消息发给哪个聊天（私聊/群组）。  
获取方式：

- **私聊场景**
  1. 先给你的 Bot 发 `/start`
  2. 浏览器访问：`https://api.telegram.org/bot<你的BotToken>/getUpdates`
  3. 在返回 JSON 中找到 `chat.id`（你的 `TG_CHAT_ID`）

- **群聊场景**
  1. 先把 Bot 拉进目标群
  2. 在群里发一条消息（可发 `/start`）
  3. 同样访问 `getUpdates` 查 `chat.id`（群一般是负数）

拿到后写入 Cloudflare Secret：`TG_CHAT_ID`。

### 5) `TOKEN`（wrangler.toml）

用途：保护订阅入口，防止未授权访问。  
设置方式：

- 在 `wrangler.toml` 的 `[vars]` 中填写 `TOKEN`
- 访问时必须带：`?token=你的TOKEN`

### 6) `SUB_URLS`（wrangler.toml）

用途：上游机场/订阅源列表。  
设置方式：

- 在 `wrangler.toml` 的 `[vars]` 中多行填写 `SUB_URLS`
- 每行一条订阅地址
- 以后增减地址时只改这里

### 7) Worker 访问地址（用于导入 Clash）

用途：Clash 订阅链接入口。  
获取方式：

1. 推送代码后，打开 GitHub Actions 部署记录
2. 在 deploy 日志中找到 workers.dev 地址
3. 拼接最终订阅链接：`https://你的worker域名/?token=你的TOKEN`

## 六、更新触发机制说明

- 手动更新：访问订阅链接（带 `token`）
- 软件自动更新：由 Clash 客户端按其订阅更新策略触发请求
- 当前项目不启用 Cloudflare Cron 定时任务（无 `scheduled` 自动触发）

## 七、Clash Verge 自动更新设置（客户端侧）

1. 打开 Clash Verge
2. 进入 `Profiles`（订阅管理）
3. 选中你的 Worker 订阅
4. 打开 `Auto Update`（自动更新）
5. 设置更新间隔（例如 6h/12h）
6. 保存后观察下次更新时间是否变化

> 手动更新与自动更新都会请求同一条订阅链接，走同一套 Worker 逻辑。

## 八、常见问题排查

- 返回 `Forbidden: Access Token Required.`
  - 检查链接中是否携带 `?token=...`
  - 检查 `TOKEN` 是否与链接一致

- 返回 `Error: SUB_URLS is empty.`
  - 检查 `wrangler.toml` 中 `SUB_URLS` 是否有有效链接
  - 确认改动已推送并部署成功

- 没有 Telegram 通知
  - 检查 Cloudflare Secrets 中 `TG_BOT_TOKEN`、`TG_CHAT_ID` 是否已设置
  - 确认 Bot 与目标 chat 已建立会话（私聊 `/start` 或已在群内）
  - 若为群聊，确认 Bot 仍在群中且有发言权限

## 九、安全建议

- 不要在仓库中提交任何真实密钥
- 敏感值统一放 Cloudflare/GitHub Secrets
- 定期轮换 `TOKEN` 与 Telegram Bot 凭据
