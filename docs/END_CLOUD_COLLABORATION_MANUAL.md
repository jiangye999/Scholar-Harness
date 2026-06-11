# Scholar Harness 端云协同操作手册

本文档用于维护 Scholar Harness 桌面端、本地服务、官网、云端账号服务以及与 ReferenceHarness 共用账号体系的协同关系。所有涉及密钥的示例均使用占位符，禁止把真实密钥提交到仓库。

## 1. 系统分层

Scholar Harness 当前由四个主要部分组成：

| 层级 | 位置 | 作用 |
| --- | --- | --- |
| 桌面端 Electron | `electron/` | 启动本地 Express 服务，打开桌面窗口，管理启动日志和打包资源 |
| 本地业务服务 | `src/server/local-server.ts` | 提供本地聊天、文献库、项目管理、PDF Wiki、本机文件读写等能力 |
| 官网前端 | 本地 `scholarharness-website/`，线上 `/root/website` | 注册、登录、订阅、用户中心、API key 管理等网页入口 |
| 云端 API | 本地 `cloud/`，线上 `/root/cloud` | 账号、邮箱验证码、腾讯验证码、订阅、支付、用量、分布式 API key 等服务 |
| ReferenceHarness 共享账号服务 | 线上 `/var/www/referenceharness/cloud-server` | ReferenceHarness 的独立 API，同时与 ScholarHarness 共用部分账号体系 |

线上 nginx 当前按路径转发：

| URL 路径 | 代理目标 | 说明 |
| --- | --- | --- |
| `https://scholarharness.com/` | `/root/website/out` | 官网静态页面 |
| `https://scholarharness.com/api/` | `http://127.0.0.1:3001` | ScholarHarness 云 API |
| `https://scholarharness.com/referenceharness/api/` | `http://127.0.0.1:3000/api/` | ReferenceHarness 云 API |

nginx 配置文件：

```bash
/etc/nginx/conf.d/mywebsite.conf
```

## 2. 本地开发

### 2.1 环境要求

- Node.js 22+
- npm 10+
- Windows PowerShell
- Electron 相关依赖已安装

### 2.2 常用命令

项目根目录：

```bash
npm run dev
npm run build
npm test
npm run electron:dev
npm run electron:build
```

官网前端：

```bash
cd scholarharness-website
npm run dev
npm run build
```

云端 API 本地构建：

```bash
cd cloud
npm run build
npm start
```

注意：本地 `cloud/` 目录可能与线上 `/root/cloud` 存在差异。涉及线上云服务修复时，以线上源码和构建结果为准，修改前必须先备份。

## 3. 桌面端运行机制

Electron 主进程固定启动本地服务器端口：

```text
http://localhost:18789
```

用户数据目录：

```text
%APPDATA%\scholar-harness\data
```

常见日志：

```text
%APPDATA%\scholar-harness\data\startup.log
```

本地端主要保存：

- 用户上传文献和解析结果
- 项目隔离目录
- 聊天记录
- PDF Wiki 数据
- TextIn/Qwen-Long 等 PDF 处理配置
- embedding 和检索缓存

打包时需要关注：

- `electron/icon.ico`
- `dist/`
- `configs/`
- `sci_writing_skills/`
- `openclaw/`
- `node_modules/`

## 4. 云端连接

SSH 模板：

```bash
ssh -i C:\Users\Administrator\.ssh\tencent_key -o StrictHostKeyChecking=accept-new ubuntu@119.91.116.90
```

线上关键目录：

| 目录 | 说明 |
| --- | --- |
| `/root/website` | ScholarHarness 官网源码和静态导出 |
| `/root/website/out` | nginx 实际服务的官网静态目录 |
| `/root/cloud` | ScholarHarness 云 API |
| `/var/www/referenceharness/cloud-server` | ReferenceHarness 云 API |
| `/var/www/referenceharness/backend/public` | ReferenceHarness 静态页面 |
| `/var/www/referenceharness/backups` | 线上变更备份目录 |

## 5. 线上服务管理

### 5.1 ScholarHarness 云 API

服务名：

```bash
scholarharness-cloud
```

常用命令：

```bash
sudo systemctl status scholarharness-cloud --no-pager
sudo systemctl restart scholarharness-cloud
sudo systemctl is-active scholarharness-cloud
```

日志：

```bash
sudo tail -n 200 /var/log/scholarharness-cloud.log
sudo tail -n 200 /var/log/scholarharness-cloud-error.log
```

健康检查：

```bash
curl -s http://127.0.0.1:3001/health
curl -s https://scholarharness.com/api/v1/health
```

### 5.2 官网静态站

部署流程：

```bash
cd /root/website
sudo npm run build
```

构建成功后，Next 静态导出会生成：

```bash
/root/website/out
```

如果修改了关键前端 chunk，建议先备份并移走旧构建产物，再重新构建：

```bash
backup=/var/www/referenceharness/backups/scholar-website-YYYYMMDD_HHMMSS
sudo mkdir -p "$backup"
sudo cp -a /root/website/src/app/register/page.tsx "$backup/register-page.tsx"
sudo mv /root/website/out "$backup/out"
sudo mv /root/website/.next "$backup/.next"
cd /root/website
sudo npm run build
```

### 5.3 ReferenceHarness 云 API

服务名：

```bash
referenceharness-api
```

常用命令：

```bash
pm2 list --no-color
pm2 show referenceharness-api --no-color
pm2 restart referenceharness-api
pm2 logs referenceharness-api --lines 100 --nostream
```

日志：

```bash
tail -n 200 ~/.pm2/logs/referenceharness-api-out.log
tail -n 200 ~/.pm2/logs/referenceharness-api-error.log
```

## 6. 配置文件

### 6.1 本地 `.env`

本地桌面端使用项目根目录 `.env` 或应用内配置保存用户自己的模型 API。

不要在仓库中提交真实值。示例：

```bash
API_URL=https://api.example.com/v1
API_KEY=your-api-key
PORT=18789
DEBUG=1
```

### 6.2 云端 `/root/cloud/.env`

常见字段：

```bash
PORT=3001
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=scholar_harness
DB_USER=...
DB_PASSWORD=...

JWT_SECRET=...
JWT_REFRESH_SECRET=...

EMAIL_HOST=smtp.qcloudmail.com
EMAIL_PORT=465
EMAIL_SECURE=true
EMAIL_USER=...
EMAIL_PASSWORD=...
EMAIL_FROM_EMAIL=...

CAPTCHA_ENABLED=true
CAPTCHA_APP_ID=...
CAPTCHA_APP_SECRET_KEY=...
TENCENT_SECRET_ID=...
TENCENT_SECRET_KEY=...
```

说明：

- `CAPTCHA_APP_ID` 是前端弹出腾讯验证码使用的应用 ID。
- `CAPTCHA_APP_SECRET_KEY` 是同一个验证码应用的应用密钥。
- `TENCENT_SECRET_ID` 和 `TENCENT_SECRET_KEY` 是腾讯云 CAM API 密钥，用于后端调用腾讯云接口。
- `ticket` 不是配置项，是用户每次完成人机验证后前端 SDK 返回的一次性凭证。

### 6.3 官网环境变量

官网构建时会读取：

```bash
NEXT_PUBLIC_API_URL=https://scholarharness.com/api/v1
NEXT_PUBLIC_TENCENT_CAPTCHA_APP_ID=...
NEXT_PUBLIC_CAPTCHA_ENABLED=true
```

注意：`NEXT_PUBLIC_*` 会进入前端构建产物，只能放公开值，不能放密钥。

## 7. 腾讯验证码流程

注册页发送邮箱验证码时的流程：

1. 用户输入邮箱并点击“发送验证码”。
2. 前端加载腾讯验证码 SDK。
3. 用户完成人机验证。
4. 腾讯前端 SDK 返回 `ticket` 和 `randstr`。
5. 前端调用 `/api/v1/verification/send-email-code`，提交邮箱、类型、`ticket`、`randstr`。
6. 后端调用腾讯云 `DescribeCaptchaResult` 二次校验。
7. 校验通过后，后端生成邮箱验证码并通过 SMTP 发送。
8. 前端按钮进入 60 秒倒计时。

当前前端应使用腾讯验证码 2.0 SDK：

```text
https://turing.captcha.qcloud.com/TJCaptcha.js
```

不要退回旧地址：

```text
https://ssl.captcha.qq.com/TCaptcha.js
```

常见错误：

| 错误 | 含义 | 处理 |
| --- | --- | --- |
| `请先完成图片验证` | 前端没有提交 `ticket/randstr` | 检查前端是否弹出验证码并传参 |
| `无有效套餐包/账户已欠费` | 腾讯验证码套餐或账号余额问题 | 在腾讯云充值或购买验证码套餐 |
| `appid-secretkey-ticket mismatch` | 前端 AppID、后端 AppSecretKey、ticket 不属于同一个验证码应用 | 核对 `NEXT_PUBLIC_TENCENT_CAPTCHA_APP_ID`、`CAPTCHA_APP_ID`、`CAPTCHA_APP_SECRET_KEY`，并强刷浏览器 |
| `AuthFailure` | 腾讯云 CAM SecretId/SecretKey 错误 | 检查 `/root/cloud/.env` 中的 CAM 密钥 |
| `UnauthorizedOperation` | CAM 权限或套餐状态异常 | 检查腾讯云权限、套餐、账号余额 |

验证线上前端是否已经使用新 SDK：

```bash
sudo grep -R "turing.captcha.qcloud.com/TJCaptcha.js" -n /root/website/out/_next/static | head
sudo grep -R "ssl.captcha.qq.com/TCaptcha.js" -n /root/website/out/_next/static | head
```

## 8. 邮箱验证码流程

后端路由：

```text
POST /api/v1/verification/send-email-code
```

请求体：

```json
{
  "email": "user@example.com",
  "type": "register",
  "captchaTicket": "frontend-ticket",
  "captchaRandstr": "frontend-randstr"
}
```

成功后：

- `verification_codes` 表写入验证码。
- SMTP 发送邮件。
- 前端显示成功消息并进入倒计时。

排查命令：

```bash
sudo tail -n 200 /var/log/scholarharness-cloud.log
sudo tail -n 200 /var/log/scholarharness-cloud-error.log
```

## 9. 标准发布流程

### 9.1 本地检查

修改桌面端：

```bash
npm run build
npm test
npm run electron:build
```

修改官网：

```bash
cd scholarharness-website
npm run build
```

修改云 API：

```bash
cd cloud
npm run build
```

如果本地 `cloud` 构建因为本地目录缺文件失败，但线上 `/root/cloud` 能构建，通过线上构建结果判断部署是否可行。

### 9.2 线上备份

所有线上修改前必须备份：

```bash
backup=/var/www/referenceharness/backups/change-name-YYYYMMDD_HHMMSS
sudo mkdir -p "$backup"
sudo cp /root/cloud/services/captcha-service.ts "$backup/captcha-service.ts"
sudo cp /root/cloud/.env "$backup/cloud.env"
sudo cp /root/website/src/app/register/page.tsx "$backup/register-page.tsx"
```

### 9.3 部署云 API

```bash
cd /root/cloud
sudo npm run build
sudo systemctl restart scholarharness-cloud
sudo systemctl is-active scholarharness-cloud
```

### 9.4 部署官网

```bash
cd /root/website
sudo npm run build
```

### 9.5 nginx 检查

修改 nginx 配置后：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 10. 回滚流程

回滚云 API 单文件：

```bash
sudo cp /var/www/referenceharness/backups/<backup-name>/captcha-service.ts /root/cloud/services/captcha-service.ts
cd /root/cloud
sudo npm run build
sudo systemctl restart scholarharness-cloud
```

回滚官网：

```bash
sudo rm -rf /root/website/out /root/website/.next
sudo cp -a /var/www/referenceharness/backups/<backup-name>/out /root/website/out
```

如果备份里包含源码而不是 `out`：

```bash
sudo cp /var/www/referenceharness/backups/<backup-name>/register-page.tsx /root/website/src/app/register/page.tsx
cd /root/website
sudo npm run build
```

## 11. 常见故障

### 11.1 桌面端提示本地服务器异常退出

现象：

```text
无法启动服务器: Error: 本地服务器异常退出(退出码:1)
```

排查：

```text
%APPDATA%\scholar-harness\data\startup.log
```

常见原因：

- 打包时缺少 `dist/` 文件。
- `node_modules` 未正确打包。
- 用户系统端口被占用。
- VPN 或代理影响 `localhost` 访问。

### 11.2 桌面端页面加载失败

现象：

```text
ERR_FAILED(-2) loading http://localhost:18789
```

排查：

- 关闭 VPN 后重试。
- 查看 `startup.log`。
- 确认本地服务是否启动。
- 确认 18789 端口未被占用。

### 11.3 官网按钮点击无效或用户不显示

常见原因：

- Next 构建失败。
- 静态站仍在使用旧 chunk。
- 浏览器缓存旧 JS。

处理：

```bash
cd /root/website
sudo rm -rf .next out
sudo npm run build
```

用户侧需要强制刷新或无痕窗口测试。

### 11.4 发送验证码不弹人机验证

排查：

- 前端是否加载 `TJCaptcha.js`。
- 浏览器控制台是否阻止第三方脚本。
- VPN 或广告拦截插件是否拦截腾讯验证码域名。
- `NEXT_PUBLIC_CAPTCHA_ENABLED` 是否为 `false`。

### 11.5 邮件能发但验证码校验失败

如果 `CAPTCHA_ENABLED=false`，后端会跳过图片验证码，邮件可以直接发。

如果 `CAPTCHA_ENABLED=true`，必须通过腾讯验证码二次校验。此时邮件是否能发，取决于：

- 腾讯验证码套餐是否有效。
- `CAPTCHA_APP_ID` 与 `CAPTCHA_APP_SECRET_KEY` 是否匹配。
- 前端 SDK 是否生成当前 AppID 的 ticket。
- CAM `TENCENT_SECRET_ID/TENCENT_SECRET_KEY` 是否可调用验证码接口。

## 12. 安全规则

- 不要把真实 API Key、SMTP 密码、腾讯云 Secret 写进仓库。
- 线上修改前必须备份。
- 日志或截图给别人看时必须遮盖密钥。
- 前端 `NEXT_PUBLIC_*` 只能放公开配置。
- `.env`、数据库备份、支付配置不得上传到公开仓库。
- 修改云端共享账号逻辑时，要同时考虑 ScholarHarness 和 ReferenceHarness。

## 13. 协同边界

ScholarHarness 与 ReferenceHarness 当前共用部分用户体系，但两者不是完全同一套前端或 API：

- ScholarHarness 官网主 API：`https://scholarharness.com/api/v1/...`
- ReferenceHarness API：`https://scholarharness.com/referenceharness/api/...`
- ReferenceHarness 本地部分页面可能直接调用 ScholarHarness 主 API。

涉及账号、验证码、订阅、支付时，先确认请求实际打到哪个路径，再改对应服务。

## 14. 推荐操作习惯

每次线上改动按这个顺序：

1. 确认请求路径和实际服务。
2. 备份源码、构建产物和关键 `.env`。
3. 小范围修改。
4. 构建。
5. 重启服务或重新生成静态站。
6. 查看日志。
7. 用 `curl` 做接口烟测。
8. 用无痕浏览器做页面烟测。
9. 记录备份路径和改动点。

不要在还不清楚请求落点时同时改 `/root/cloud`、`/root/website` 和 ReferenceHarness；先定位链路，再动代码。
