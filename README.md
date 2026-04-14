# 东北大学校史地图网站

一个简单可运行的网站模板：
- 登录后可浏览校史地图
- 点击地图地点进入详情介绍页
- 无注册功能，账号来自学号列表
- 首次登录初始密码为学号，支持后续修改密码

## 1. 功能说明

- 登录认证（无注册）
- 地图点位展示（Leaflet + OpenStreetMap）
- 点位详情页展示图文内容
- 用户密码修改
- 管理员后台（地点增删改、手绘图批量录入）
- 管理员可配置“地点预设问答”，前台一键点击触发

## 2. 本地运行

### 环境要求
- Node.js 18+

### 安装与启动

```powershell
cd c:\Users\Administrator\Desktop\xiaoshiditu
npm install
npm run start
```

浏览器打开：`http://localhost:3000`

## 3. 账号初始化逻辑

### 学号来源
- 文件：`data/student_ids.json`
- 把你们组所有学号填入这个 JSON 数组即可

### 初始密码规则
- 初始密码 = 学号
- 用户首次登录后建议立即到“修改密码”页面更新

### 用户数据文件
- `data/users.json`
- 第一次启动服务时，会根据 `data/student_ids.json` 自动生成

### 管理员账号设置
- 文件：`data/admin_ids.json`
- 填入拥有管理员权限的学号，例如：`["20230001"]`
- 管理员登录后首页会看到“管理员后台”按钮

## 4. 内容编辑

### 地图地点数据
- 文件：`data/places.json`
- 每个地点包含：`id`、`name`、`lat`、`lng`、`period`、`summary`、`content`、`image`、`drawings`

你可以把你同组同学提供的建筑图纸地址或图片 URL 放进 `image` 字段。

### 背景图与手绘图接入文档（新增）
- 详细操作手册：`docs/维护与素材接入手册.md`
- 图片目录说明：`public/images/README.md`

### 管理员后台入口
- 路径：`/admin`
- 功能：新增地点、编辑地点、删除地点
- 录入手绘图：在“手绘图列表”文本框中按行填写 `图片路径 | 说明`
- 录入预设问答：在“预设问答”文本框中按行填写 `问题 | 回答`

## 5. 部署到服务器（1年）

下面给你一套最省事的上线流程（国内常见）：

1. 购买云服务器（1年）
   - 推荐：阿里云轻量应用服务器 / 腾讯云轻量应用服务器
   - 配置建议：2核2G、40G系统盘、Ubuntu 22.04
2. 购买域名（1年）
   - 在阿里云/腾讯云/华为云购买 `.cn` 或 `.com`
3. 域名解析
   - 在域名控制台添加 `A` 记录到服务器公网 IP
4. 部署 Node.js 项目
   - 服务器安装 Node.js
   - 拉取项目后执行 `npm install`
   - 使用 `pm2` 常驻运行
5. 配置 Nginx 反向代理
   - 80/443 转发到 Node.js 端口（如 3000）
6. 配置 HTTPS
   - 使用 Let's Encrypt 证书（`certbot`）

## 6. Linux 服务器示例命令

```bash
# 安装 Node.js（Ubuntu）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs nginx

# 项目部署
git clone <你的仓库地址> neu-history-map
cd neu-history-map
npm install

# 使用 pm2 守护
sudo npm i -g pm2
pm2 start src/server.js --name neu-history-map
pm2 save
pm2 startup
```

## 7. 可选增强建议

- 管理员后台（上传建筑图纸与文字）
- 地点分类筛选（年代/学院/主题）
- 搜索功能（按建筑名或关键词）
- 时间轴联动地图动画

## 8. AI 讲解小助手（基础版）

项目已内置地点详情页的“AI 讲解小助手”：

- 默认无需任何 API Key，可使用本地规则讲解（免费）
- 配置云端模型后会自动切换为更自然的回答

### 本地规则模式（默认）

不设置环境变量即可使用。适合课程展示与基础问答。

### 云端模型模式（可选）

设置以下环境变量后，后端会调用兼容 OpenAI Chat Completions 的接口：

- `OPENAI_API_KEY`（或 `AI_API_KEY`）
- `AI_MODEL`（可选，默认 `gpt-4o-mini`）
- `OPENAI_BASE_URL`（可选，默认 `https://api.openai.com/v1`）
- `AI_API_URL`（可选，若你有自定义完整接口地址可直接填）

说明：若云端调用失败，系统会自动降级回本地规则模式，不影响页面使用。

## 9. 真 AI 接入实操手册（可长期留档）

本节用于你后续“把本地规则升级为云端真 AI”，步骤按顺序执行即可。

### 9.1 你当前项目已具备的能力

当前代码已实现：

- 前端：地点详情页可发问
- 后端：`POST /api/assistant`
- 兜底：云端失败时自动回退本地规则

也就是说，你后续主要是做“平台开通 + 环境变量配置 + 重启验证”。

### 9.2 中国大陆常见可用/可购买路线（建议）

> 注意：不同平台的可用模型、价格、免费额度、发票政策会变化，请以各平台官网当期说明为准。

#### 路线 A：国内云厂商模型平台（最稳，适合课程/比赛）

可重点关注：

- 阿里云百炼（Model Studio）
- 百度智能云千帆
- 火山引擎方舟（Volcengine Ark）
- 腾讯云大模型相关平台（如混元生态能力）

优点：

- 大陆网络稳定性通常更好
- 企业认证、账单、发票流程相对成熟

#### 路线 B：模型聚合/中转平台（上手快）

可关注支持 OpenAI 兼容接口的平台（例如部分聚合服务）。

优点：

- 接口统一，切模型方便
- 适合低代码快速验证

风险点：

- 平台稳定性、风控、价格波动差异大
- 一定要看服务条款与数据合规说明

#### 路线 C：海外官方接口（需自行评估网络与合规）

优点：模型生态完整；
挑战：网络、支付、地区可用性需你自行评估。

### 9.3 选型建议（你这个项目）

你当前是“校园展示 + 基础问答”，优先建议：

1. 先选一个支持按量计费、带试用额度的平台；
2. 先用轻量模型（mini / lite / flash 档）；
3. 答案长度先控制短（降低延迟和成本）。

### 9.4 开通到接通：最短步骤

#### 第 1 步：开通并拿到参数

你需要拿到：

- `API Key`
- `Base URL`（若平台提供 OpenAI 兼容地址）
- `Model 名称`（例如某个 `*-mini`）

#### 第 2 步：在服务器/本机配置环境变量

本项目支持以下变量：

- `OPENAI_API_KEY`（或 `AI_API_KEY`）
- `AI_MODEL`
- `OPENAI_BASE_URL`
- `AI_API_URL`（可选，完整 URL 优先级更高）

如果你使用阿里百炼，建议至少配置这 3 个值：

- `OPENAI_API_KEY=你的百炼Key`
- `OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1`
- `AI_MODEL=你要用的模型名`（例如 `qwen3.5-flash`）

#### 2.1 Conda 环境长期生效配置（推荐）

你如果在 `neu-web` 环境里运行项目，推荐用下面方式配置，这样不需要每次手动 `set`：

```cmd
conda activate neu-web
conda env config vars set OPENAI_API_KEY=你的百炼Key OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1 AI_MODEL=qwen3.5-flash
conda deactivate
conda activate neu-web
```

#### 2.2 查看当前已配置值

```cmd
conda activate neu-web
conda env config vars list
```

#### 2.3 修改某个值（例如切换模型）

```cmd
conda activate neu-web
conda env config vars set AI_MODEL=qwen-plus
conda deactivate
conda activate neu-web
```

#### 2.4 删除某个值

```cmd
conda activate neu-web
conda env config vars unset AI_MODEL
conda deactivate
conda activate neu-web
```

#### 2.5 修改后如何验证是否真的生效

```cmd
conda activate neu-web
node -e "console.log('AI_MODEL=', process.env.AI_MODEL); console.log('HAS_KEY=', !!(process.env.OPENAI_API_KEY || process.env.AI_API_KEY)); console.log('BASE_URL=', process.env.OPENAI_BASE_URL)"
```

如果输出里 `HAS_KEY=true`，并且模型/地址是你设置的值，说明配置已生效。

项目根目录已提供模板：`/.env.example`

- 用于留档和统一配置项，不要提交真实密钥
- 建议复制后在你的部署环境中注入同名变量
- 配合仓库里的 `.gitignore`，可避免误提交 `.env`

Windows CMD 示例：

```cmd
conda activate neu-web
cd /d c:\Users\Administrator\Desktop\xiaoshiditu
set OPENAI_API_KEY=你的密钥
set AI_MODEL=你的模型名
set OPENAI_BASE_URL=你的兼容网关地址
npm start
```

Windows PowerShell 示例：

```powershell
$env:OPENAI_API_KEY="你的密钥"
$env:AI_MODEL="你的模型名"
$env:OPENAI_BASE_URL="你的兼容网关地址"
npm start
```

Linux/macOS 示例：

```bash
export OPENAI_API_KEY="你的密钥"
export AI_MODEL="你的模型名"
export OPENAI_BASE_URL="你的兼容网关地址"
npm start
```

#### 第 3 步：重启服务

你使用的是 `npm start`，改环境变量后必须重启进程，配置才会生效。

#### 第 4 步：前端验证

进入任意地点详情页提问，观察回答来源：

- 显示“回答来源：云端模型” => 接通成功
- 显示“回答来源：本地规则” => 云端未生效或调用失败

### 9.5 成本控制（推荐默认）

建议先控制在低成本模式：

- 轻量模型优先
- 保持问题长度限制（当前已限制 300 字）
- 控制回答长度（后续可在请求参数加 token 上限）
- 给平台设置月预算/余额预警

### 9.6 常见问题排查

#### Q1：页面提示“登录已失效”

- 原因：会话过期或未登录
- 处理：重新登录后再提问

#### Q2：页面提示“接口不存在（404）”

- 原因：常见于服务未重启，运行的是旧进程
- 处理：重启 `npm start` 后刷新页面

#### Q3：始终是“本地规则”，切不到云端

排查顺序：

1. 环境变量是否真的生效（同一个终端里启动服务）
2. `API Key` 是否正确
3. `Base URL` 是否是平台给的兼容地址
4. `Model` 名称是否拼写正确
5. 平台是否余额不足/配额耗尽

#### Q4：偶发“网络请求失败，请稍后重试”

- 先看服务器日志有没有超时/429/5xx
- 可能是平台瞬时抖动，稍后重试

### 9.7 安全与上线注意事项（必须）

1. **绝对不要**把 API Key 写到前端 JS
2. 不要把密钥写进 Git 仓库
3. 推荐使用服务器环境变量或密钥管理服务
4. 给 `/api/assistant` 加调用频率限制（可后续加）
5. 记录错误日志但不要打印完整密钥

### 9.8 推荐你的迭代顺序

1. 本地规则稳定跑通（已完成）
2. 接一个低价云模型并验证来源切换
3. 上线前做预算与限流
4. 再逐步加“多轮记忆/角色设定/讲解风格”

## 10. 换电脑迁移完整手册（含 AI）

这一节用于你把项目从 A 电脑迁移到 B 电脑时直接照做。

### 10.1 先回答一个关键问题：为什么有时写 `-c conda-forge`，有时不写？

- `-c conda-forge` 的作用：指定从 `conda-forge` 频道安装包。
- 不写时：conda 会按你当前配置的默认频道解析。

什么时候建议写：

1. 你想确保 `nodejs` 版本更全、更稳定可用；
2. 默认频道里安装 `nodejs` 遇到冲突或版本不匹配；
3. 你希望组内环境尽量统一（都用 conda-forge）。

什么时候可以不写：

1. 你本机默认频道已经能正常安装 `nodejs`；
2. 你追求命令更短、并且当前安装验证通过。

一句话：`-c conda-forge` 不是必须，但在“创建含 Node 的 conda 环境”场景里通常更稳。

### 10.2 迁移时建议拷贝什么？

建议拷贝整个项目目录（含 `data/`、`src/`、`public/`、`README.md` 等），但**不依赖旧机器的 `node_modules`**。

原因：

- `node_modules` 体积大、可重建；
- 换电脑后可能出现兼容性差异；
- 以 `package.json + package-lock.json` 重装最稳。

### 10.3 新电脑一键创建环境（推荐含 Node）

```cmd
conda create -n neu-web python=3.11 nodejs=20 -c conda-forge -y
conda activate neu-web
node -v
npm -v
```

如果你不想指定频道，也可省略 `-c conda-forge`，但若失败建议加回来。

### 10.4 进入项目并安装依赖

```cmd
conda activate neu-web
cd /d 你的项目路径\xiaoshiditu
npm install
```

`npm install` 不是只建文件夹，它会按 `package.json`/`package-lock.json` 下载并解析完整依赖树。

### 10.5 配置 AI（阿里百炼示例）

#### 方式 A：当前终端临时生效

```cmd
set OPENAI_API_KEY=你的百炼Key
set OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
set AI_MODEL=qwen3.5-flash
```

#### 方式 B：Conda 环境长期生效（推荐）

```cmd
conda activate neu-web
conda env config vars set OPENAI_API_KEY=你的百炼Key OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1 AI_MODEL=qwen3.5-flash
conda deactivate
conda activate neu-web
```

### 10.6 启动与验证

```cmd
conda activate neu-web
cd /d 你的项目路径\xiaoshiditu
npm start
```

浏览器打开：`http://localhost:3000`

AI 配置验证：

```cmd
conda activate neu-web
conda env config vars list
node -e "console.log('AI_MODEL=', process.env.AI_MODEL); console.log('HAS_KEY=', !!(process.env.OPENAI_API_KEY || process.env.AI_API_KEY)); console.log('BASE_URL=', process.env.OPENAI_BASE_URL)"
```

### 10.7 后续怎么改模型/删变量？

修改模型：

```cmd
conda activate neu-web
conda env config vars set AI_MODEL=qwen-plus
conda deactivate
conda activate neu-web
```

删除变量：

```cmd
conda activate neu-web
conda env config vars unset AI_MODEL
conda deactivate
conda activate neu-web
```

### 10.8 迁移后常见问题

1. `npm` 命令不可用：说明环境里没有 node，重新激活环境或重装 `nodejs`。
2. 地图空白：先强刷页面（`Ctrl + F5`），再看网络请求是否被拦。
3. 小助手回退到本地/固定兜底：检查 key、模型名、base URL 是否生效。

---

---

