#!/usr/bin/env bash
# 打包 Chrome 扩展：自动升版本号（patch +1），输出到 dist/
# 用法：
#   ./build.sh              自动升 patch 版本并打包
#   ./build.sh 2.5.0        指定版本（仍会检查能否直接上传）
#   ./build.sh --no-bump    不升版本，用当前 manifest.json 的版本重新打包
set -euo pipefail

cd "$(dirname "$0")"

files=(manifest.json export.js xlsx.full.min.js modal.css options.html options.js
       icon16.png icon32.png icon48.png icon128.png)

# ---- 1. 版本号 ----
old=$(node -p "require('./manifest.json').version")
if [[ "${1:-}" == "--no-bump" ]]; then
    new="$old"
elif [[ -n "${1:-}" ]]; then
    new="$1"
    if ! [[ "$new" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo "版本号格式应为 x.y.z，收到：$new" >&2
        exit 1
    fi
else
    new=$(node -e '
        const v = require("./manifest.json").version.split(".").map(Number);
        while (v.length < 3) v.push(0);
        v[2] += 1;
        console.log(v.join("."));
    ')
fi

if [[ "$new" != "$old" ]]; then
    node -e '
        const fs = require("fs");
        const m = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
        m.version = process.argv[1];
        fs.writeFileSync("manifest.json", JSON.stringify(m, null, 2) + "\n");
    ' "$new"
    echo "版本：$old -> $new"
else
    echo "版本：$new（未变更）"
fi

# ---- 2. 打包 ----
mkdir -p dist
out="dist/douban-book-export-${new}.zip"
rm -f "$out"

if command -v zip >/dev/null 2>&1; then
    zip -q -X -r "$out" "${files[@]}"
elif command -v python >/dev/null 2>&1; then
    python -I - "$out" "${files[@]}" <<'PY'
import sys, zipfile, os
out, files = sys.argv[1], sys.argv[2:]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for f in files:
        z.write(f, f)
PY
else
    echo "需要 zip 或 python 其中之一来打包" >&2
    exit 1
fi

size=$(du -k "$out" | cut -f1)
echo "已生成 $out（${size} KB）"

# ---- 3. 一致性检查 ----
node -e '
    const fs = require("fs");
    const pkg = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
    if (pkg.version !== process.argv[1]) { console.error("manifest 版本不一致"); process.exit(1); }
    for (const f of Object.values(pkg.icons)) if (!fs.existsSync(f)) { console.error("缺少图标 " + f); process.exit(1); }
    console.log("清单检查通过：version " + pkg.version);
' "$new"
