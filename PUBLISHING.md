# 上架 Chrome 网上应用店：逐项处理清单

> 对应开发者后台的 5 条待办。标 ✅ 的是我已经在仓库里处理好的，标 👉 的需要你在后台操作（我无法代你操作账号）。

| # | 后台提示 | 谁来处理 | 怎么处理 |
|---|---|---|---|
| 1 | 必须提供需使用**主机权限**的理由 | ✅ 文本已备好 | 复制 [第 2 节](#2-主机权限理由) 到「隐私权规范」标签页 |
| 2 | 必须提供需使用 **storage 权限**的理由 | ✅ 文本已备好 | 复制 [第 3 节](#3-storage-权限理由) |
| 3 | 必须先提供发布方**联系邮箱** | 👉 你 | 「设置」页面填入邮箱（建议 `wuageek@163.com`） |
| 4 | 必须先**验证**发布方联系邮箱 | 👉 你 | 「设置」页面点验证，去邮箱点确认链接（有时会进垃圾箱） |
| 5 | 必须**确认数据使用符合开发者计划政策** | 👉 你 | 「修改」页 →「隐私权规范」→ 勾选确认项，答案见 [第 5 节](#5-数据使用声明怎么勾) |

另外两项后台会一起问，答案也在下面：

- **单一用途说明**（Single purpose）→ [第 4 节](#4-单一用途说明)
- **是否使用远程代码**（Remote code）→ **否**。SheetJS 已打包进扩展（`xlsx.full.min.js`），不加载任何远程脚本。
- **隐私政策网址**（Privacy policy URL）→ 需要你把 [privacy.html](privacy.html) 传到公网，见 [第 6 节](#6-隐私政策网址怎么填)。

---

## 1. 代码层面的准备（已完成）

为了让审查顺利，这次改动了一处实现：

- 「请求间隔」设置从 `chrome.storage.sync` 改为 `chrome.storage.local`。
  原因：`sync` 会把数据同步到 Google 账号云端，审查时属于“数据传输”，需要额外解释；
  换成 `local` 后可以明确写“所有数据只存在用户本机，不上传任何服务器”，隐私政策和后台勾选都更干净。

扩展实际用到的权限只有两项：

```
permissions: ["storage"]
content_scripts.matches: ["https://book.douban.com/people/*", "https://book.douban.com/mine*"]
```

没有 `tabs`、没有 `<all_urls>`、没有 `scripting`、没有后台 service worker、没有网络请求到第三方域名。

---

## 2. 主机权限理由

> 后台「隐私权规范」→ Host permission → 填下面这段（中文）。如果后台是英文界面，填英文版。

**中文：**

```
本扩展只在用户自己的豆瓣读书个人页面（book.douban.com/people/*，以及会跳转到该地址的
book.douban.com/mine*）上运行，用途是在用户名旁插入一个“一键导出书单”按钮，并读取用户当前
已经能看到的那几页书单内容，生成 Excel 文件。

为什么需要这个权限：
1. 扩展的全部功能就是读取用户自己豆瓣账号里的「在读 / 读过 / 想读」书单并整理导出，没有这个
   站点访问权限就无法插入按钮、无法读取列表内容，扩展没有任何可用功能。
2. 用户点击导出时，扩展会请求同一站点下自己书单的后续分页（例如 /people/<用户ID>/collect?start=15），
   效果等同于用户手动翻页，用于把多页书单拼成一个完整文件。请求使用用户已登录的浏览器会话，
   不经过任何中间服务器。
3. 选择 book.douban.com 而非 <all_urls>：扩展对其他任何网站都无用，也不需要访问。同时限制了
   路径为个人页面（/people/* 和 /mine*），而不是整个 book.douban.com。

扩展不读取、不修改豆瓣页面上除书单条目以外的内容，不上传任何数据，不在后台运行。
```

**英文（如果后台显示英文）：**

```
This extension only runs on the user's own Douban Books profile pages
(book.douban.com/people/* and book.douban.com/mine*, which redirects to that path). Its sole purpose is
to add an "Export" button next to the user name and read the book lists that are already visible to the
user, in order to generate an Excel file.

Why this permission is required:
1. The entire functionality of the extension is exporting the user's own "reading / read / wish to read"
   lists from their own Douban account. Without site access it cannot inject the button or read the list
   content, and the extension would have no functionality at all.
2. When the user clicks export, the extension requests the remaining pages of the user's own lists on the
   same site (e.g. /people/<userid>/collect?start=15), which is equivalent to the user paging manually,
   so that multi-page lists can be combined into one file. Requests use the user's existing browser
   session and do not pass through any intermediate server.
3. We request book.douban.com only, not <all_urls>, because the extension is useless on any other site.
   We further restrict the match to profile paths (/people/* and /mine*) rather than all of
   book.douban.com.

The extension does not read or modify page content other than the book list entries, uploads no data, and
does not run in the background.
```

---

## 3. storage 权限理由

**中文：**

```
扩展使用 chrome.storage.local 保存两类配置，均为本地存储，不同步、不上传：

1. 请求间隔（0 至 10 秒）：用户设置每个分页请求之间等待多久。豆瓣对短时间大量请求会返回 403，
   书多的用户需要调大间隔，所以该设置需要持久化保存在两次打开设置页之间。
2. 阅读时长记录：豆瓣每本书只保留“当前状态 + 当前日期”，用户把书标成“读过”后，原来的“想读”
   日期就看不到了。扩展在每次导出时把每本书各状态的日期记下来，下次导出时相减，得出
   “想读→读完”的天数。这是用户明确要求的功能，数据只保存在用户本机。

未使用 chrome.storage.sync，以避免数据被同步到云端。用户可在设置页一键清空这些记录，卸载扩展即全部删除。
```

**英文：**

```
The extension uses chrome.storage.local for two local-only settings. Nothing is synced or uploaded:

1. Request interval (0–10 s): how long to wait between paginated requests. Douban returns HTTP 403 to
   bursty requests, so users with many books need to increase this value; it must persist between visits
   to the options page.
2. Reading-duration records: Douban only keeps the current status date for each book, so once a book is
   marked "read", its original "wish to read" date is no longer visible. On each export the extension
   records the dates of each status per book, and subtracts them on a later export to produce the number
   of days from "wish to read" to "finished". This is a feature the user explicitly requested, and the
   data stays on the user's machine.

We deliberately do not use chrome.storage.sync, so that no data is synced to the cloud. Users can clear
these records from the options page; uninstalling the extension deletes them.
```

---

## 4. 单一用途说明

**中文：**

```
把用户在豆瓣读书账号中的「在读 / 读过 / 想读」三个书单导出为一个 Excel 文件，包含书名、作者、
出版信息、用户自己的评分、短评、标签、标记日期和阅读时长。
```

**英文：**

```
Export the user's "reading / read / wish to read" book lists from their Douban Books account into a
single Excel file, including title, author, publication info, the user's own rating, short review, tags,
marked date and reading duration.
```

---

## 5. 数据使用声明怎么勾

后台「修改」页 →「隐私权规范」→ 数据使用（Data usage）。

**数据类型：**

- ☑ **网站内容（Website content）** —— 扩展会读取你豆瓣书单页面的条目内容用于本地生成文件。
  即使数据不离机，勾上它能如实反映扩展访问了什么，避免因“隐瞒访问内容”被驳回。
- 其余全部**不勾**：不涉及个人身份信息、健康、财务支付、认证信息、个人通信、位置、网页浏览历史、用户活动。
  扩展不读取 Cookies、密码、登录凭据，也不记录你访问过哪些网站。

**三个问题，都选「否」/「不会」：**

- 是否将用户数据出售给第三方？→ **否**
- 是否将用户数据用于与扩展单一用途无关的目的？→ **否**
- 是否将用户数据用于判定信用度或用于借贷？→ **否**

**需要勾选的承诺项：**

- ☑ 我确认本扩展对用户数据的使用符合 Chrome 网上应用店用户数据政策
- ☑ 我确认本扩展不会使用或传输用户数据，除非为提供/改进扩展的单一用途所必需
- ☑（如出现）我确认我未违反相关政策，且我的扩展已发布/将发布准确的隐私政策链接

如果后台额外问“是否将数据用于广告”，同样选**否**。扩展没有广告、没有分析统计。

---

## 6. 隐私政策网址怎么填

后台要求一个 **公开可访问的 HTTPS 网址**，不能用 `chrome-extension://` 或本地文件。仓库里的
[privacy.html](privacy.html) 是单文件、无外链资源（样式内联、不加载字体和脚本），可以直接托管。任选一种：

**GitHub Pages（推荐，和代码放一起）**

1. 仓库 Settings → Pages → Source 选 `Deploy from a branch`
2. Branch 选 `master`，目录选 `/ (root)`，保存
3. 等 1–2 分钟，隐私政策地址就是：
   `https://iwoz.github.io/douban-export/privacy.html`

**其他静态托管**：Vercel / Netlify / Cloudflare Pages 拖入 `privacy.html` 即可，地址形式类似
`https://xxx.vercel.app/privacy.html`。

填之前先在无痕窗口打开一次，确认能正常显示（尤其是深色模式下文字不要看不见）。

---

## 7. 提交前自检

- [ ] 打包：运行 `./build.sh`，自动升版本号并生成 `dist/douban-book-export-<版本>.zip`，直接上传这个文件
- [ ] 后台“隐私权规范”四项理由已填（主机权限、storage、单一用途、远程代码=否）
- [ ] 联系邮箱已填且已验证
- [ ] 数据使用勾选已保存
- [ ] 隐私政策 URL 可公开访问
- [ ] 商店详情页写明：**不收集用户数据 / 与豆瓣无关联**（可选但能减少误判）

打包命令（在仓库根目录执行）：

```bash
cd "C:/Users/admin/Documents/douban-book-export" && ./build.sh
```

脚本会依次做三件事：

1. 把 `manifest.json` 的版本号 patch +1（`2.1.1` → `2.1.2`，也可 `./build.sh 3.0.0` 指定版本，`./build.sh --no-bump` 表示不升版本）
2. 只把扩展运行需要的 10 个文件打成 `dist/douban-book-export-<版本>.zip`（不含 README、隐私政策、`.git`）
3. 校验清单版本与图标文件，失败会直接报错退出

打好的 zip 也提交在仓库的 `dist/` 目录里，方便回滚和对照。
