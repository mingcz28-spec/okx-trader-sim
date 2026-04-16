# 部署说明

## 一、本地部署

### 1. 环境要求
- Node.js 20+
- npm 10+
- .NET 8 SDK
- Docker Desktop（用于 MongoDB）

### 2. 启动 MongoDB
```bash
docker compose up -d mongo
```
或：
```bash
npm run mongo:up
```

### 3. 启动后端
```bash
dotnet restore backend/OkxTraderSim.Api.csproj
dotnet run --project backend/OkxTraderSim.Api.csproj
```
默认：
- API: http://localhost:5088
- Swagger: http://localhost:5088/swagger

### 4. 启动前端
```bash
npm --prefix frontend install
npm --prefix frontend run dev
```
默认：
- Frontend: http://localhost:5173

### 5. 本地环境变量
参考 `.env.example`：
- `Mongo__ConnectionString=mongodb://localhost:27017`
- `Mongo__DatabaseName=okx_trader_sim`
- `Security__OkxSecretEncryptionKey=replace-with-a-long-stable-local-development-secret`
- `Cors__AllowedOrigins__0=http://localhost:5173`
- `VITE_API_BASE_URL=http://localhost:5088`

## 二、本地打包发布

### 1. 构建前端
```bash
npm --prefix frontend ci
npm --prefix frontend run build
```

### 2. 发布后端
```bash
dotnet publish backend/OkxTraderSim.Api.csproj -c Release -o out
```

### 3. 复制前端静态文件到后端
```bash
node scripts/copy-frontend-dist.mjs
```

### 4. 运行发布包
```bash
dotnet out/OkxTraderSim.Api.dll
```

运行后：
- 根路径 `/` 提供前端页面
- `/api/*` 提供后端接口

## 三、Railway 部署

### 1. 部署结构
本项目使用单服务部署：
- 一个 Railway MongoDB 服务
- 一个 Railway Web Service
- Web Service 用 ASP.NET Core 托管前端静态资源和 API

### 2. 需要保留的文件
仓库根目录应保留：
- `railway.json`
- `nixpacks.toml`
- `scripts/copy-frontend-dist.mjs`

### 3. Railway 构建流程
Nixpacks 会执行：
```bash
npm --prefix frontend ci
npm --prefix frontend run build
dotnet publish backend/OkxTraderSim.Api.csproj -c Release -o out
node scripts/copy-frontend-dist.mjs
```

启动命令：
```bash
dotnet out/OkxTraderSim.Api.dll
```

### 4. Railway 环境变量
在 Railway Web Service 中配置：
- `ASPNETCORE_ENVIRONMENT=Production`
- `Mongo__ConnectionString=<Railway MongoDB connection string>`
- `Mongo__DatabaseName=okx_trader_sim`
- `Security__OkxSecretEncryptionKey=<stable production encryption secret>`

可选：
- `Cors__AllowedOrigins__0=<custom frontend origin>`

注意：
- Railway 单服务部署时，不要设置 `VITE_API_BASE_URL`
- 前端应直接走同源 `/api/*`

### 5. Railway 验证清单
部署后检查：
- `/` 能打开前端页面
- `/api/state` 返回 JSON
- 刷新前端路由不会 404
- 保存 OKX 配置后不会返回明文 Secret / Passphrase
- 重启后 MongoDB 中的数据仍可恢复

## 四、推荐交付方式
如果你要把它“打包给别人部署”，推荐直接交付整个仓库，并附上：
- `.env.example`
- `docker-compose.yml`
- `railway.json`
- `nixpacks.toml`
- `DEPLOYMENT.md`

这样既能本地部署，也能直接上 Railway。
