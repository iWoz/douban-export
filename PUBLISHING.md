# Chrome 网上应用店发布材料

以下文本与仓库中的扩展功能对应，供填写商店用途、站点访问和存储权限说明时使用。后台字段名称及要求以实际开发者后台为准。

## 1. 扩展范围

- 名称：豆瓣导出助手 Plus。
- 用途：将豆瓣读书、电影或音乐个人页面上的三个状态列表导出为 Excel。
- 入口：在读书、电影、音乐个人主页及状态列表页的页面标题后添加醒目的实心导出按钮。
- 每次导出当前站点，生成「全部 + 三个状态 + 说明」五个工作表。
- 仅在点击导出后请求列表分页；关闭进度窗口会中止导出。
- SheetJS 随扩展打包，不加载远程脚本。

清单中的访问范围：

```json
{
  "permissions": ["storage"],
  "content_scripts.matches": [
    "https://book.douban.com/people/*",
    "https://book.douban.com/mine*",
    "https://movie.douban.com/people/*",
    "https://movie.douban.com/mine*",
    "https://music.douban.com/people/*",
    "https://music.douban.com/mine*"
  ]
}
```

没有 `tabs`、`<all_urls>`、`scripting` 权限，也没有后台 service worker。

## 2. 站点访问权限理由

**中文：**

```text
本扩展在豆瓣读书、电影和音乐个人页面运行：book.douban.com、movie.douban.com、music.douban.com 的 /people/* 和 /mine* 路径。

用途是在个人主页及状态列表页的页面标题后添加导出按钮，并在用户点击后读取当前站点的三个状态列表，生成 Excel 文件。读书导出在读、读过、想读；电影导出在看、看过、想看；音乐导出在听、听过、想听。

为什么需要这些访问范围：
1. 扩展需要在这三个站点的个人页面插入按钮并读取列表条目，否则无法完成导出。
2. 用户点击导出后，扩展请求同一站点、同一用户列表的后续分页（例如 /people/<用户ID>/collect?start=15），相当于用户手动翻页。请求使用当前浏览器会话，不经过中间服务器。
3. 访问范围仅限这三个域名的个人页面路径，没有请求所有网站权限。

扩展不会上传导出内容，不在后台抓取，不读取密码、Cookies 或登录凭据。
```

**英文：**

```text
This extension runs on Douban Books, Movies and Music profile pages: /people/* and /mine* paths on book.douban.com, movie.douban.com and music.douban.com.

It adds a prominent, solid-color export button after the page title on profile home pages and status list pages. Only after the user clicks export does it read the three status lists on the current site and generate an Excel file: reading/read/wish to read, watching/watched/wish to watch, or listening/listened/wish to listen.

Why this access is needed:
1. The extension must insert the button and read list entries on these profile pages to perform its export function.
2. After an export is requested, it fetches subsequent pages of the same profile's lists on the same site, equivalent to manual paging. Requests use the current browser session and do not pass through an intermediary server.
3. Access is limited to profile paths on these three domains. No access to all websites is requested.

The extension uploads no exported content, performs no background crawling, and does not read passwords, Cookies or authentication credentials.
```

## 3. storage 权限理由

**中文：**

```text
扩展使用 chrome.storage.local 保存以下数据，均仅保存在本机，不同步、不上传：

1. 请求间隔（0 至 10 秒）：控制列表分页请求速度，供用户在多次使用间保留设置。
2. 状态日期记录：豆瓣列表显示条目的当前状态日期，状态改变后可能无法读取旧日期。扩展在每次导出时记录各状态日期，供以后导出时计算从想读/想看/想听或在读/在看/在听到完成的天数。记录按内容类型和豆瓣用户 ID 隔离，避免不同站点或账号的日期混用。

旧版没有账号归属的书籍记录会保留并单独显示，但不会自动用于新导出。用户可在设置页查看记录数量并清空所有新旧记录；清空记录保留请求间隔设置。卸载扩展会删除全部扩展本地存储。
```

**英文：**

```text
The extension uses chrome.storage.local for local-only data. Nothing is synced or uploaded:

1. Request interval (0–10 seconds): preserves the user's chosen delay between paginated requests.
2. Status dates: Douban lists show an item's current status date, while previous dates may no longer be available after a status change. On export, the extension records status dates so later exports can calculate the number of days from wishing or starting to completing a book, movie or album. Records are separated by media type and Douban user ID.

Legacy book records without an account association are retained and displayed separately, but are not automatically reused in new exports. Users can inspect record counts and clear all new and legacy records from the options page; clearing records preserves the request interval. Uninstalling the extension removes all of its local storage.
```

## 4. 单一用途说明

**中文：**

```text
把用户在豆瓣读书、电影或音乐个人页中标记的三个状态列表导出为一个 Excel 文件，包含条目信息、用户评分、短评、标签、标记日期、可从本地记录计算的时长、豆瓣链接和封面地址。一次导出当前站点的全部状态列表。
```

**英文：**

```text
Export the three status lists on the current Douban Books, Movies or Music profile into a single Excel file, including item details, user ratings, short reviews, tags, marked dates, durations calculated from available local records, Douban links and cover URLs.
```

## 5. 数据使用说明

本扩展会访问网站内容，包括列表条目、评分、短评、标签和状态日期。页面中的豆瓣用户 ID 用于构造分页地址、区分本地记录和生成文件名。

- 数据处理在用户浏览器本地进行，导出内容不发送给开发者或第三方。
- 没有广告、分析统计、跟踪代码或接收数据的后端服务。
- 不出售数据，不将数据用于导出以外的目的，不用于信用评估或借贷。
- 不读取密码、Cookies、登录凭据、私信或支付信息；使用浏览器现有登录会话请求豆瓣分页。
- 不使用远程代码，SheetJS 已随扩展打包。

填写后台数据类型和相关承诺时，应依据以上实际行为及后台对各字段的定义填写。隐私政策与扩展访问范围应保持一致。

## 6. 隐私政策地址

仓库的 [privacy.html](privacy.html) 是单文件页面，不依赖外部字体或脚本，可托管到 GitHub Pages。配置 Pages 发布 `master` 分支根目录后，预期地址为：

<https://iwoz.github.io/douban-export/privacy.html>

填入商店之前，确认该地址已经部署并可公开访问，且内容包含读书、电影和音乐三个站点。发布方联系邮箱使用已验证的开发者邮箱，仓库现有联系邮箱为 `wuageek@163.com`。

## 7. 打包与提交前检查

在仓库根目录执行：

```bash
./build.sh 2.2.1
```

后续可运行 `./build.sh` 自动提升 patch 版本，或运行 `./build.sh --no-bump` 使用当前版本重新打包。

脚本仅打包扩展运行所需的 10 个文件，输出仍采用已有命名规则：`dist/douban-book-export-<版本>.zip`。包内不含 README、隐私政策、测试和 `.git`。

- [ ] 核对清单版本与上传包版本。
- [ ] 验证读书、电影、音乐主页入口和三个状态列表导出。
- [ ] 确认站点访问、storage、单一用途和远程代码说明与当前版本一致。
- [ ] 确认公开隐私政策包含三站点及按类型、账号分开的本地记录。
- [ ] 确认发布方联系邮箱已经验证。
- [ ] 按实际行为完成后台的数据使用声明及承诺。

新版本增加了电影和音乐的站点范围，更新时浏览器可能提示用户确认新增访问权限。仓库内的 zip 包同时纳入版本管理，便于回滚和对照。
