# GitHub 使用与两台电脑同步指南

> 面向不熟悉 Git 的人写的，照着做即可。所有命令都在 **Git Bash** 里执行（开始菜单搜 "Git Bash" 打开；VS Code 里的终端也行，命令完全一样）。
> 相关文档：`docs/新电脑开发交接文档.md`（新电脑环境搭建）、`docs/维护与素材接入手册.md`（线上服务器更新）。

## 0. 先弄懂四个词，同步就全明白了

| 词 | 意思 | 类比 |
| --- | --- | --- |
| 仓库（repository） | 一个文件夹 + 它的全部修改历史 | 一台带时间机器的文件夹 |
| 提交（commit） | 把当前的修改打包成一次记录，先存在自己电脑上 | 游戏存档（还在本机） |
| 推送（push） | 把本地的存档上传到 GitHub | 存档同步到云 |
| 拉取（pull） | 把 GitHub 上的新存档下载到本地 | 从云同步回本机 |

**核心一句话：改动只有 commit + push 之后才会到 GitHub；另一台电脑只有 pull 之后才能看到。两台电脑之间从不直接传文件，全靠 GitHub 中转。** 记住这个，后面的流程都是它的具体操作。

## 1. 新电脑第一次要做三件事

### 1.1 装 Git

1. 打开 <https://git-scm.com/download/win> 下载并安装（一路默认"下一步"即可）；
2. 装完打开 Git Bash，输入 `git --version`，能显示版本号（例如 `git version 2.53.0.windows.2`）就成功。

> 注意：Git Bash 里的路径写作 `/c/Users/...`，对应 Windows 的 `C:\Users\...`，两种写法不要混。

### 1.2 设置身份（不设的话提交会被拒绝）

在 Git Bash 里执行（名字和邮箱必须和旧电脑一致，否则提交记录里的作者会变）：

```bash
git config --global user.name "sixlights741"
git config --global user.email "2504337134@qq.com"
```

这两个只是"提交记录里署谁的名"，跟登录 GitHub 没关系，随便填也能用，但保持两台机器一致比较好。

### 1.3 打通 GitHub 认证（二选一，推荐方式 B）

GitHub 现在不接受直接用密码，本地要有一把"钥匙"证明你是 `sixlights741`。有两条路：

**方式 A：把旧电脑的密钥拷过去（最快，一分钟）**

密钥就是两个文件，在旧电脑的 `C:\Users\Administrator\.ssh\` 里：

| 文件 | 是什么 | 用途 |
| --- | --- | --- |
| `id_ed25519` | 私钥 | 千万别外传，只在自己的电脑之间拷 |
| `id_ed25519.pub` | 公钥 | 可以公开，GitHub 上登记的就是它 |

把这两个文件拷到新电脑的 `C:\Users\<新电脑的用户名>\.ssh\`（这个文件夹可能不存在，没有就自己新建，注意前面的点）。

**方式 B：在新电脑重新生成一对密钥（更稳妥，推荐）**

```bash
# 第 1 步：生成密钥（邮箱填你的 GitHub 邮箱，后面一路回车用默认值即可）
ssh-keygen -t ed25519 -C "2504337134@qq.com"

# 第 2 步：显示公钥，把输出的整段复制（含开头的 ssh-ed25519 和结尾的邮箱）
cat ~/.ssh/id_ed25519.pub
```

然后去 GitHub 网页登记这把公钥：

1. 右上角头像 → **Settings**
2. 左侧 **SSH and GPG keys** → **New SSH key**
3. Title 随便填（如"新电脑"），Key 里粘贴刚才复制的整行 → **Add SSH key**

**最后一步验证（两种方式都一样）**，在 Git Bash 里：

```bash
ssh -T git@github.com
```

看到 `Hi sixlights741! You've successfully authenticated, but GitHub does not provide shell access.` 就是通了（后半句是正常的，不用管）。第一次连接会问 `Are you sure you want to continue connecting?`，输入 `yes` 回车。

**方式 C：不想配 SSH 就用 HTTPS + 令牌**（备选，国内网络下更容易断，不推荐）

- 克隆时用 `https://github.com/sixlights741/jindaishi.git`；
- 推送时要求输入密码，密码处填 **Personal Access Token**：GitHub 网页 → Settings → Developer settings → Personal access tokens → **Tokens (classic)** → Generate new token (classic) → 勾选 `repo` → 生成后立刻复制（只显示一次）→ 以后弹密码就粘贴它。

## 2. 第一次把项目放到新电脑上

**如果你是按"直接拷整个文件夹"带过去的**（推荐，因为连 `node_modules` 和账号数据都一起走了），那么不用克隆，直接做下面的验证就行。

**如果你选择从 GitHub 克隆**：

```bash
cd /c/Users/你的用户名/Desktop
git clone git@github.com:sixlights741/jindaishi.git
```

**两种方式都做一遍这个验证**（在新电脑上打开 Git Bash）：

```bash
cd /c/Users/你的用户名/Desktop/xiaoshiditu    # 进项目目录，路径按实际改
git remote -v      # 应显示 git@github.com:sixlights741/jindaishi.git（说明远程地址是 SSH 的）
git status         # 应显示 nothing to commit, working tree clean（说明没有未提交的改动）
git pull           # 从 GitHub 拉一次，确保和线上一致
```

然后按交接文档的第 1 节装依赖、启动（`npm install`、`npm start`）。

## 3. 日常同步流程：开工先 pull，收工就 push

这是每天/每次换机器唯一要记的规矩。

**开始干活前（在准备用的那台电脑上）：**

```bash
cd /c/Users/你的用户名/Desktop/xiaoshiditu
git pull
```

**干完活、准备收工时：**

```bash
git status                          # 看一眼改了哪些文件（红色=改了但还没暂存）
git add -A                          # 把本次所有改动加入提交
git commit -m "一句话说明这次改了什么"   # 例如：修复登录页在手机上的排版
git push                            # 推到 GitHub
```

**换到另一台电脑继续：**

```bash
git pull
```

就这三步循环。判断有没有漏操作：

| 命令输出 | 含义 | 该做什么 |
| --- | --- | --- |
| `Your branch is ahead of 'origin/main' by N commits` | 本地有 N 个提交还没推到 GitHub | `git push` |
| `Your branch is behind 'origin/main' by N commits` | GitHub 上有 N 个提交你还没拉 | `git pull` |
| `nothing to commit, working tree clean` | 没有未提交的改动，干净 | 无事 |

## 4. 常见报错怎么处理

| 报错关键词 | 原因 | 解决办法 |
| --- | --- | --- |
| `Permission denied (publickey)` | 新电脑还没配好密钥 | 回到 1.3 做，先让 `ssh -T git@github.com` 显示 `Hi sixlights741!` |
| `Please tell me who you are` | 没设 git 身份 | 执行 1.2 的两条命令 |
| `Updates were rejected because the tip of your current branch is behind` | GitHub 上有你本地没有的提交（多半是另一台电脑推过） | 先 `git pull`，再 `git push` |
| `fatal: unable to access ... GnuTLS recv error (-110)` | 国内网络连 GitHub 被掐断 | 重试几次；换手机热点；实在推不上去先别改代码，等网络好 |
| `CONFLICT (content): Merge conflict in 某文件` | 两台电脑改了同一个文件的同一段 | 打开那个文件，会看到 `<<<<<<<`、`=======`、`>>>>>>>` 三种标记，手动保留你想要的，删掉标记，然后 `git add -A` + `git commit` |
| `Your local changes would be overwritten by merge` | 本地有没提交的改动，同时想 pull | `git stash` → `git pull` → `git stash pop` |
| 弹窗要用户名密码 | 用了 HTTPS 地址 | 用户名填 `sixlights741`，密码填 Personal Access Token（见 1.3 方式 C） |

**避免踩坑的三条纪律**：① 别在两台电脑上同时改同一个文件再各自 push；② 收工必 push，开工必 pull；③ 看不懂报错就先 `git status` 看一眼状态再动手，必要时把报错整段发出来问。

## 5. 哪些会同步、哪些不会（重要）

**会同步**（在 git 里，两边一致）：`src/`、`public/`（含历史上传的图片）、`data/places.json`、`data/admin_ids.json`、`docs/`、`scripts/`、`README.md`、`package.json`

**不会同步**（被 `.gitignore` 排除，两边各管各的）：

| 文件 | 是什么 |
| --- | --- |
| `data/student_ids.json` | 学号白名单 |
| `data/users.json` | 账号 + 密码哈希 |
| `data/ai_config.json` | 后台配的 AI Key |
| `data/visit-counter.json` | 累计访问次数 |
| `node_modules/` | 依赖（每台机器自己 `npm install`） |
| `.env` | 环境变量 |

原因：这些含学号、密钥等敏感信息，**不能传到 GitHub**。所以两台电脑上"登录账号做过的测试数据"不是同一份，别拿它当依据。

## 6. 别忘了线上服务器

本地 push 只让"两台开发机"同步；网站要更新，还得在服务器上跑一次手册里那条一键更新命令：

```bash
cd /var/www/xiaoshiditu/jindaishi && git fetch --depth=1 origin main && git show origin/main:scripts/update-server.sh > /tmp/xsdt-update.sh && sudo bash /tmp/xsdt-update.sh
```

脚本会保护服务器上的 `data/` 和 `public/uploads/`（线上数据永远以服务器为准），并在最后自动重启。如果哪天手动 `git pull` 了，记住补一句 `sudo pm2 restart all`——不然会出现"页面是新的、路由是旧的"这种 404。

## 7. 一张图记住整套流程

```
        push ↑   ↓ pull                     push ↑   ↓ pull
   旧电脑 ─────────────────▶  GitHub 仓库  ◀───────────────── 新电脑
                                  │
                                  │  服务器用一键脚本从这里拉代码
                                  ▼
                          线上网站 neu-xsdt.top
```

- 两台开发机之间**不直接传文件**，全部经过 GitHub；
- 服务器**只从 GitHub 拉**（不是从你的电脑传），所以本地必须先 `push` 上去它才拉得到。

## 8. 速查清单（可以只记这一段）

```bash
# 开工（在要用的那台电脑上）
cd /c/Users/你的用户名/Desktop/xiaoshiditu && git pull

# 收工（换机器前必做）
git status && git add -A && git commit -m "改了什么" && git push

# 认证出问题时自测
ssh -T git@github.com        # 要显示 Hi sixlights741!
```
