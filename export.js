/*
 * 豆瓣读书导出助手 Plus
 * 在豆瓣读书个人页（在读 / 读过 / 想读）加一个按钮，一键把三个书单全部抓下来，
 * 连同 标记日期、我的评分、短评、标签 一起写进一个 Excel 文件。
 *
 * 关于「想读 → 读完」时长：
 *   豆瓣一本书只保留“当前状态 + 当前日期”，标成读过后想读日期就看不到了。
 *   所以本插件每次导出时把每本书各状态的日期记到 chrome.storage.local，
 *   下次导出时用记录里的想读/在读日期 和 当前读完日期 算出天数。
 */
(function () {
    'use strict';

    if (window.__dbxLoaded) return;
    window.__dbxLoaded = true;

    var LISTS = [
        {key: 'do', name: '在读'},
        {key: 'collect', name: '已读'},
        {key: 'wish', name: '想读'}
    ];
    var STATUS_NAME = {do: '在读', collect: '已读', wish: '想读'};
    var HISTORY_KEY = 'dbxHistory';

    var uidMatch = location.pathname.match(/\/people\/([^\/]+)/);
    var uid = uidMatch ? uidMatch[1] : null;
    if (!uid) return;

    // ---------- UI ----------
    document.body.insertAdjacentHTML('beforeend',
        '<div class="dbx-modal">' +
        '  <div class="dbx-modal-content">' +
        '    <span class="dbx-close">×</span>' +
        '    <h1 class="dbx-title">正在导出...</h1>' +
        '    <ul class="dbx-progress">' +
        '      <li data-key="do">在读：等待中</li>' +
        '      <li data-key="collect">已读：等待中</li>' +
        '      <li data-key="wish">想读：等待中</li>' +
        '    </ul>' +
        '    <div class="dbx-error dbx-hidden"></div>' +
        '    <a class="dbx-download dbx-hidden" download="douban.xlsx">下载 Excel</a>' +
        '    <div class="dbx-tip">关闭此窗口会中止导出。请求过快可能被豆瓣限制，可在扩展设置里调大请求间隔。</div>' +
        '  </div>' +
        '</div>');

    var modal = document.querySelector('.dbx-modal');
    var titleEl = modal.querySelector('.dbx-title');
    var errorEl = modal.querySelector('.dbx-error');
    var downloadEl = modal.querySelector('.dbx-download');
    var runId = 0;

    modal.querySelector('.dbx-close').addEventListener('click', function () {
        runId++;
        modal.classList.remove('dbx-show');
    });

    function setProgress(key, text) {
        var li = modal.querySelector('.dbx-progress li[data-key="' + key + '"]');
        if (li) li.textContent = STATUS_NAME[key] + '：' + text;
    }

    function insertButton() {
        var h1 = document.querySelector('#db-usr-profile .info h1');
        if (!h1 || h1.querySelector('.dbx-export-btn')) return;
        var btn = document.createElement('button');
        btn.className = 'dbx-export-btn';
        btn.textContent = '一键导出三个书单 (Excel)';
        btn.addEventListener('click', startExport);
        h1.appendChild(btn);
    }
    insertButton();

    // ---------- 工具 ----------
    var parser = new DOMParser();

    function sleep(ms) {
        return new Promise(function (r) { setTimeout(r, ms); });
    }

    function getSettings() {
        return new Promise(function (resolve) {
            chrome.storage.sync.get({delay: '1'}, function (items) {
                var d = Number.parseFloat(items.delay);
                resolve({delay: isNaN(d) ? 1 : d});
            });
        });
    }

    function loadHistory() {
        return new Promise(function (resolve) {
            chrome.storage.local.get({}, function (items) {
                var h = items[HISTORY_KEY];
                resolve(h && typeof h === 'object' ? h : {});
            });
        });
    }

    function saveHistory(history) {
        return new Promise(function (resolve) {
            var obj = {};
            obj[HISTORY_KEY] = history;
            chrome.storage.local.set(obj, resolve);
        });
    }

    function fetchDoc(url) {
        return fetch(url, {credentials: 'same-origin'}).then(function (res) {
            if (/accounts\.douban\.com/.test(res.url)) {
                throw new Error('需要先登录豆瓣');
            }
            if (!res.ok) {
                throw new Error('HTTP ' + res.status + (res.status === 403 ? '（可能被豆瓣限制，请稍后再试或调大请求间隔）' : ''));
            }
            return res.text();
        }).then(function (html) {
            return parser.parseFromString(html, 'text/html');
        });
    }

    function text(el) {
        return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
    }

    function todayStr() {
        var d = new Date();
        var m = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        return d.getFullYear() + '-' + m + '-' + day;
    }

    function diffDays(from, to) {
        if (!from || !to) return '';
        var a = new Date(from + 'T00:00:00');
        var b = new Date(to + 'T00:00:00');
        if (isNaN(a) || isNaN(b)) return '';
        return Math.round((b - a) / 86400000);
    }

    // ---------- 解析 ----------
    function totalPages(doc) {
        var thisPage = doc.querySelector('.paginator .thispage');
        if (thisPage && thisPage.getAttribute('data-total-page')) {
            var n = Number.parseInt(thisPage.getAttribute('data-total-page'), 10);
            if (n > 0) return n;
        }
        var paginator = doc.querySelector('.paginator');
        if (!paginator) return 1;
        var max = 1;
        paginator.querySelectorAll('a, .thispage').forEach(function (el) {
            var v = Number.parseInt(el.textContent.trim(), 10);
            if (!isNaN(v) && v > max) max = v;
        });
        return max;
    }

    function totalCount(doc) {
        var h1 = doc.querySelector('#db-usr-profile .info h1');
        var m = text(h1).match(/\((\d+)\)\s*$/);
        return m ? Number.parseInt(m[1], 10) : null;
    }

    // "作者 / 译者 / 出版社 / 2019-5 / 59.00元" -> 拆成几列
    function parsePub(pub) {
        var parts = pub.split('/').map(function (s) { return s.trim(); }).filter(Boolean);
        var result = {author: '', publisher: '', year: '', price: ''};
        if (!parts.length) return result;
        var isYear = function (s) {
            return /^\d{4}(\s*[年.\-\/]\s*\d{1,2}\s*月?)?(\s*[.\-\/]?\s*\d{1,2}\s*日?)?$/.test(s);
        };
        var isPrice = function (s) {
            return /(元|¥|￥|\$|USD|NTD|HKD|JPY|EUR|GBP|RMB|CNY|£|€)/i.test(s) || /^\d+\.\d{1,2}$/.test(s);
        };
        var last = parts[parts.length - 1];
        if (!isYear(last) && isPrice(last)) {
            result.price = parts.pop();
        }
        if (parts.length && /\d{4}/.test(parts[parts.length - 1]) && parts[parts.length - 1].length <= 12) {
            result.year = parts.pop();
        }
        if (parts.length > 1) {
            result.publisher = parts.pop();
        }
        result.author = parts.join(' / ');
        return result;
    }

    function parseItem(li, status) {
        var info = li.querySelector('.info') || li;
        var a = info.querySelector('h2 a') || info.querySelector('a');
        var title = a ? (a.getAttribute('title') || text(a)) : '';
        title = title.replace(/\s+/g, ' ').trim();
        var href = a ? a.href : '';
        var idMatch = href.match(/\/subject\/(\d+)/);
        var pub = text(info.querySelector('.pub'));
        var pubParts = parsePub(pub);

        var note = li.querySelector('.short-note') || info;
        var rating = '';
        var ratingEl = note.querySelector('span[class*="rating"]');
        if (ratingEl) {
            var rm = ratingEl.className.match(/rating(\d)/);
            if (rm) rating = Number.parseInt(rm[1], 10);
        }
        var dateText = text(note.querySelector('.date'));
        var dm = dateText.match(/\d{4}-\d{2}-\d{2}/);
        var tags = text(note.querySelector('.tags')).replace(/^标签\s*[:：]\s*/, '');
        var comment = text(note.querySelector('.comment'));
        var img = li.querySelector('.pic img') || li.querySelector('img');

        return {
            id: idMatch ? idMatch[1] : href,
            status: status,
            title: title,
            author: pubParts.author,
            publisher: pubParts.publisher,
            year: pubParts.year,
            price: pubParts.price,
            pub: pub,
            rating: rating,
            comment: comment,
            tags: tags,
            date: dm ? dm[0] : '',
            url: href,
            cover: img ? img.src : ''
        };
    }

    function parseListPage(doc, status) {
        var items = doc.querySelectorAll('.interest-list .subject-item');
        if (!items.length) {
            items = doc.querySelectorAll('.interest-list > li');
        }
        return Array.prototype.map.call(items, function (li) { return parseItem(li, status); });
    }

    // ---------- 抓取 ----------
    function listUrl(key, start) {
        return '/people/' + uid + '/' + key + '?start=' + start + '&sort=time&rating=all&filter=all&mode=grid';
    }

    async function fetchList(key, settings, myRun) {
        var books = [];
        setProgress(key, '正在获取第 1 页...');
        var firstDoc = await fetchDoc(listUrl(key, 0));
        if (myRun !== runId) throw new Error('aborted');

        var pages = totalPages(firstDoc);
        var total = totalCount(firstDoc);
        var firstPage = parseListPage(firstDoc, key);
        books = books.concat(firstPage);
        var perPage = firstPage.length || 15;

        var describe = function (p) {
            return '第 ' + p + '/' + pages + ' 页，已获取 ' + books.length + (total !== null ? '/' + total : '') + ' 本';
        };
        setProgress(key, describe(1));

        for (var p = 2; p <= pages; p++) {
            await sleep(settings.delay * 1000);
            if (myRun !== runId) throw new Error('aborted');
            var doc = await fetchDoc(listUrl(key, (p - 1) * perPage));
            if (myRun !== runId) throw new Error('aborted');
            books = books.concat(parseListPage(doc, key));
            setProgress(key, describe(p));
        }
        setProgress(key, '完成，共 ' + books.length + ' 本');
        return books;
    }

    // ---------- 历史记录：补齐 想读/在读/读完 日期 ----------
    function mergeHistory(history, books) {
        books.forEach(function (b) {
            if (!b.id || !b.date) return;
            var h = history[b.id] || {};
            if (b.status === 'collect') {
                // 读完日期以豆瓣当前显示为准
                h.collect = b.date;
            } else {
                // 想读 / 在读 保留最早记录到的日期
                if (!h[b.status] || b.date < h[b.status]) h[b.status] = b.date;
            }
            h.title = b.title;
            history[b.id] = h;
        });
        return history;
    }

    function enrich(books, history) {
        var today = todayStr();
        books.forEach(function (b) {
            var h = history[b.id] || {};
            b.wishDate = h.wish || (b.status === 'wish' ? b.date : '');
            b.doDate = h.do || (b.status === 'do' ? b.date : '');
            b.collectDate = b.status === 'collect' ? b.date : '';
            b.wishToCollect = diffDays(b.wishDate, b.collectDate);
            b.doToCollect = diffDays(b.doDate, b.collectDate);
            b.doToNow = b.status === 'do' ? diffDays(b.doDate, today) : '';
        });
    }

    // ---------- Excel ----------
    var HEADERS = [
        '状态', '书名', '作者', '出版社', '出版年', '定价', '出版信息(原文)',
        '我的评分(1-5)', '短评', '标签', '标记日期',
        '想读日期', '开始在读日期', '读完日期',
        '想读→读完(天)', '在读→读完(天)', '在读至今(天)',
        '豆瓣链接', '封面'
    ];
    var COL_WIDTHS = [6, 36, 24, 18, 10, 10, 50, 12, 60, 24, 12, 12, 12, 12, 13, 13, 12, 40, 50];

    function toRow(b) {
        return [
            STATUS_NAME[b.status], b.title, b.author, b.publisher, b.year, b.price, b.pub,
            b.rating, b.comment, b.tags, b.date,
            b.wishDate, b.doDate, b.collectDate,
            b.wishToCollect, b.doToCollect, b.doToNow,
            b.url, b.cover
        ];
    }

    function makeSheet(books) {
        var rows = [HEADERS].concat(books.map(toRow));
        var ws = XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = COL_WIDTHS.map(function (w) { return {wch: w}; });
        var linkCol = HEADERS.indexOf('豆瓣链接');
        books.forEach(function (b, i) {
            if (!b.url) return;
            var ref = XLSX.utils.encode_cell({r: i + 1, c: linkCol});
            if (ws[ref]) ws[ref].l = {Target: b.url};
        });
        return ws;
    }

    function buildWorkbook(all, counts) {
        var wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, makeSheet(all), '全部');
        LISTS.forEach(function (l) {
            XLSX.utils.book_append_sheet(wb, makeSheet(all.filter(function (b) { return b.status === l.key; })), l.name);
        });

        var now = new Date();
        var notes = [
            ['豆瓣读书导出助手 Plus'],
            ['导出时间', now.toLocaleString()],
            ['豆瓣用户', uid],
            ['在读', counts.do], ['已读', counts.collect], ['想读', counts.wish],
            [],
            ['字段说明'],
            ['标记日期', '你在豆瓣上标记 在读/读过/想读 的日期，也就是评价时间。'],
            ['我的评分', '你打的星级，1-5 星；空表示未评分。'],
            ['想读日期 / 开始在读日期', '豆瓣只保留当前状态的日期。插件每次导出时会把每本书各状态的日期记在本地，之后导出就能回填。'],
            ['想读→读完(天)', '读完日期 - 想读日期。只有当这本书以前在「想读」时导出过一次，读完后再导出，才能算出来。'],
            ['在读→读完(天)', '读完日期 - 开始在读日期，同上。'],
            ['在读至今(天)', '今天 - 开始在读日期，只对在读的书计算。'],
            [],
            ['建议', '标记想读/在读后记得隔段时间导出一次，这样读完时就能算出完整的阅读时长。']
        ];
        var ws = XLSX.utils.aoa_to_sheet(notes);
        ws['!cols'] = [{wch: 24}, {wch: 90}];
        XLSX.utils.book_append_sheet(wb, ws, '说明');
        return wb;
    }

    function fileName() {
        return '豆瓣读书_' + uid + '_' + todayStr().replace(/-/g, '') + '.xlsx';
    }

    // ---------- 主流程 ----------
    async function startExport() {
        var myRun = ++runId;
        titleEl.textContent = '正在导出...';
        errorEl.classList.add('dbx-hidden');
        errorEl.textContent = '';
        downloadEl.classList.add('dbx-hidden');
        if (downloadEl.href && downloadEl.href.indexOf('blob:') === 0) {
            URL.revokeObjectURL(downloadEl.href);
        }
        LISTS.forEach(function (l) { setProgress(l.key, '等待中'); });
        modal.classList.add('dbx-show');

        try {
            if (typeof XLSX === 'undefined') {
                throw new Error('Excel 组件 (xlsx.full.min.js) 未加载，请重新加载扩展');
            }
            var settings = await getSettings();
            var history = await loadHistory();
            var all = [];
            var counts = {};

            for (var i = 0; i < LISTS.length; i++) {
                var key = LISTS[i].key;
                var books = await fetchList(key, settings, myRun);
                counts[key] = books.length;
                all = all.concat(books);
                if (i < LISTS.length - 1) await sleep(settings.delay * 1000);
            }
            if (myRun !== runId) return;

            mergeHistory(history, all);
            await saveHistory(history);
            enrich(all, history);

            var wb = buildWorkbook(all, counts);
            var out = XLSX.write(wb, {bookType: 'xlsx', type: 'array'});
            var blob = new Blob([out], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
            downloadEl.href = URL.createObjectURL(blob);
            downloadEl.download = fileName();
            downloadEl.classList.remove('dbx-hidden');
            titleEl.textContent = '导出完成，共 ' + all.length + ' 本';
        } catch (e) {
            if (e && e.message === 'aborted') return;
            console.error('[豆瓣导出]', e);
            titleEl.textContent = '导出失败';
            errorEl.textContent = (e && e.message) ? e.message : String(e);
            errorEl.classList.remove('dbx-hidden');
        }
    }

    // 暴露给测试页使用
    window.__dbx = {parsePub: parsePub, parseItem: parseItem, parseListPage: parseListPage, totalPages: totalPages, startExport: startExport};
})();
