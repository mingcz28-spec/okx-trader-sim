# OKX Trader Sim

前后端分离的 OKX 合约模拟与策略回测控制台。

## 技术栈

- 前端：Vite + React + TypeScript
- 后端：ASP.NET Core Web API
- 数据库：MongoDB
- 本地数据库：Docker Compose
- Railway 部署：单 Web Service，后端托管前端静态文件

## 功能范围

- 真实盘口：账户连接、资产、持仓、订单历史
- 策略回测：策略参数、风控参数、参数排行、K线图、交易记录、资金曲线
- 实时策略：执行控制台骨架，不自动交易、不真实下单

## 本地开发

### 1. 启动 MongoDB

```bash
docker compose up -d mongo
```

或使用根脚本：

```bash
npm run mongo:up
```

### 2. 启动后端

需要安装 .NET 8 SDK。

```bash
dotnet restore backend/OkxTraderSim.Api.csproj
dotnet run --project backend/OkxTraderSim.Api.csproj
```

默认地址：

- API: `http://localhost:5088`
- Swagger: `http://localhost:5088/swagger`

也可以使用：

```bash
npm run dev:backend
```

### 3. 启动前端

```bash
npm --prefix frontend install
npm --prefix frontend run dev
```

默认地址：

- Frontend: `http://localhost:5173`

也可以使用：

```bash
npm run dev:frontend
```

## 本地环境变量

复制 `.env.example` 作为本地参考。ASP.NET Core 支持用环境变量覆盖 `backend/appsettings.json`。

常用变量：

- `Mongo__ConnectionString=mongodb://localhost:27017`
- `Mongo__DatabaseName=okx_trader_sim`
- `Security__OkxSecretEncryptionKey=replace-with-a-long-stable-local-development-secret`
- `Cors__AllowedOrigins__0=http://localhost:5173`
- `VITE_API_BASE_URL=http://localhost:5088`（通常不需要设置）

本地 Vite 开发时，建议不设置 `VITE_API_BASE_URL`。前端请求同源 `/api/...`，由 Vite 代理转发到 `http://localhost:5088`。生产单服务部署也保持不设置，让前端直接请求同域名下的 `/api/...`。

## Railway 部署

Railway 使用单服务部署：

- 一个 Web Service 跑 ASP.NET Core
- 构建时先生成 `frontend/dist`
- 后端发布到 `out`
- `frontend/dist` 会复制到 `out/wwwroot`
- 生产环境由 ASP.NET Core 同时服务前端页面和 `/api/*`

### Railway 服务

1. 在 Railway 创建 MongoDB 服务。
2. 创建 Web Service 并连接本 repo。
3. 保留根目录的 `Dockerfile`、`.dockerignore`、`railway.json`。
4. Railway 使用 Dockerfile 构建并启动应用。

### Railway 环境变量

在 Web Service 中配置：

- `ASPNETCORE_ENVIRONMENT=Production`
- `Mongo__ConnectionString=<Railway MongoDB connection string>`
- `Mongo__DatabaseName=okx_trader_sim`
- `Security__OkxSecretEncryptionKey=<stable production encryption secret>`

可选：

- `Cors__AllowedOrigins__0=<custom frontend origin>`

单服务部署默认同源访问，不需要设置 `VITE_API_BASE_URL`。不要在 Railway 生产构建中设置 `VITE_API_BASE_URL`，这样前端会直接请求同域名下的 `/api/...`。

### Railway 验证

部署完成后检查：

- 根路径显示前端页面
- `/api/state` 返回 JSON
- 页面刷新不会 404
- OKX 配置保存后不会返回明文 Secret Key 或 Passphrase
- MongoDB 重启或应用重启后，配置和最近回测可以恢复

详细部署步骤见 `DEPLOYMENT.md`。

## 打包与部署

### 交付给本地部署

直接交付整个仓库，包含：

- `.env.example`
- `docker-compose.yml`
- `DEPLOYMENT.md`

本地部署时按 `DEPLOYMENT.md` 执行即可。

### 交付给 Railway 部署

直接连接该仓库到 Railway，保留以下文件：

- `railway.json`
- `nixpacks.toml`
- `scripts/copy-frontend-dist.mjs`
- `DEPLOYMENT.md`

Railway 会按仓库内定义自动构建并启动。

## 构建命令

前端构建：

```bash
npm run build:frontend
```

后端发布：

```bash
npm run build:backend
```

模拟 Railway 构建：

```bash
docker build -t okx-trader-sim .
```

## API 摘要

- `GET /api/state`
- `POST /api/config/okx`
- `POST /api/okx/test-connection`
- `POST /api/okx/sync`
- `GET /api/risk-config`
- `PUT /api/risk-config`
- `GET /api/strategy-config`
- `PUT /api/strategy-config`
- `POST /api/trades/simulated`
- `DELETE /api/trades/simulated`
- `POST /api/backtests`
- `POST /api/backtests/detail`
- `GET /api/backtests/latest`
- `GET /api/realtime/console`

## 安全边界

- 不实现真实 OKX 下单。
- 不实现自动交易。
- OKX API Secret 和 Passphrase 加密后保存到 MongoDB。
- API 响应不会返回明文 Secret 或 Passphrase。
- 不要提交真实 `.env` 或生产密钥。
