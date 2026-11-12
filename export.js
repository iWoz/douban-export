/*
 * 豆瓣导出助手 Plus：书籍 / 电影 / 音乐三个状态列表导出为 Excel。
 * 状态日期按类别和账号保存在本地，用于之后导出时计算时长。
 */
(function () {
    'use strict';

    var MEDIA = {
        book: {name: '读书', list: '书单', unit: '本', verb: '读', done: '读完', title: '书名', metadata: '出版信息(原文)'},
        movie: {name: '电影', list: '片单', unit: '部', verb: '看', done: '看完', title: '片名', metadata: '影片信息(原文)'},
        music: {name: '音乐', list: '音乐', unit: '张', verb: '听', done: '听完', title: '专辑名', metadata: '音乐信息(原文)'}
    };
    var media = location.hostname.split('.')[0];
    var config = MEDIA[media];
    if (!config || location.hostname !== media + '.douban.com' || window.__dbxLoaded) return;
    var uid = findUid();
    if (!uid) return;
    window.__dbxLoaded = true;

    var STATUS_NAME = {do: '在' + config.verb, collect: '已' + config.verb, wish: '想' + config.verb};
    var LISTS = ['do', 'collect', 'wish'].map(function (key) { return {key: key, name: STATUS_NAME[key]}; });
    var HISTORY_KEY = 'dbxHistory:' + media + ':' + uid;

    function findUid() {
        var match = location.pathname.match(/^\/people\/([^/]+)/);
        if (match) return match[1];
        if (!/^\/mine\/?$/.test(location.pathname)) return null;
        // /mine 保持原 URL，从当前用户的主页导航识别账号，不能取页面里的其他用户。
        var links = document.querySelectorAll('#db-usr-profile a[href]');
        for (var i = 0; i < links.length; i++) {
            var url = new URL(links[i].getAttribute('href'), location.origin);
            var profile = url.pathname.match(/^\/people\/([^/]+)\/?$/);
            if (url.origin === location.origin && profile) return profile[1];
        }
        return null;
    }

    // ---------- UI ----------
    document.body.insertAdjacentHTML('beforeend',
        '<div class="dbx-modal">' +
        '  <div class="dbx-modal-content">' +
        '    <button type="button" class="dbx-close" aria-label="关闭导出">×</button>' +
        '    <h1 class="dbx-title">正在导出...</h1>' +
        '    <ul class="dbx-progress">' +
        LISTS.map(function (l) { return '<li data-key="' + l.key + '">' + l.name + '：等待中</li>'; }).join('') +
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
    var controller = null;

    modal.querySelector('.dbx-close').addEventListener('click', function () {
        runId++;
        if (controller) controller.abort();
        modal.classList.remove('dbx-show');
    });

    function setProgress(key, text) {
        var li = modal.querySelector('.dbx-progress li[data-key="' + key + '"]');
        if (li) li.textContent = STATUS_NAME[key] + '：' + text;
    }

    function insertButton() {
        var profile = document.querySelector('#db-usr-profile');
        if (!profile || profile.querySelector('.dbx-export-btn')) return;
        var h1 = profile.querySelector('h1');
        if (!h1) return;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dbx-export-btn';
        btn.textContent = '导出' + config.list + ' (Excel)';
        btn.title = '一键导出' + LISTS.map(function (l) { return l.name; }).join(' / ');
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
            chrome.storage.local.get({delay: '1'}, function (items) {
                var d = Number.parseFloat(items.delay);
                resolve({delay: isNaN(d) ? 1 : Math.max(0, Math.min(10, d))});
            });
        });
    }

    function loadHistory() {
        return new Promise(function (resolve, reject) {
            chrome.storage.local.get(HISTORY_KEY, function (items) {
                if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
                var h = items[HISTORY_KEY];
                resolve(h && typeof h === 'object' ? h : {});
            });
        });
    }

    function saveHistory(history) {
        return new Promise(function (resolve, reject) {
            var obj = {};
            obj[HISTORY_KEY] = history;
            chrome.storage.local.set(obj, function () {
                if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
                resolve();
            });
        });
    }

    function fetchDoc(url, signal) {
        return fetch(url, {credentials: 'same-origin', signal: signal}).then(function (res) {
            if (/accounts\.douban\.com/.test(res.url)) {
                throw new Error('需要先登录豆瓣');
            }
            if (!res.ok) {
                throw new Error('HTTP ' + res.status + (res.status === 403 ? '（可能被豆瓣限制，请稍后再试或调大请求间隔）' : ''));
            }
            if (res.url && new URL(res.url, location.origin).origin !== location.origin) {
                throw new Error('豆瓣返回了验证页面，请在网页中完成验证后重试');
            }
            return res.text();
        }).then(function (html) {
            var doc = parser.parseFromString(html, 'text/html');
            if (!doc.querySelector('#db-usr-profile')) {
                throw new Error('未能读取豆瓣列表，请确认已登录、页面可访问且无需验证后重试');
            }
            return doc;
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
        var m = text(h1).match(/[（(]([\d,]+)[)）]\s*$/);
        if (!m) m = text(doc.querySelector('.subject-num')).match(/\/\s*([\d,]+)/);
        return m ? Number.parseInt(m[1].replace(/,/g, ''), 10) : null;
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
        var a = info.querySelector('h2 a[href*="/subject/"]') || info.querySelector('.title a[href*="/subject/"]') || info.querySelector('a[href*="/subject/"]');
        var title = a ? (a.getAttribute('title') || text(a)) : '';
        title = title.replace(/\s+/g, ' ').trim();
        var href = a ? new URL(a.getAttribute('href'), location.origin).href : '';
        var idMatch = href.match(/\/subject\/(\d+)/);
        var pub = text(info.querySelector('.pub') || info.querySelector('.intro'));
        var pubParts = media === 'book' ? parsePub(pub) : {};

        var note = li.querySelector('.short-note') || info;
        var rating = '';
        var ratingEl = note.querySelector('span[class*="rating"]');
        if (ratingEl) {
            var rm = ratingEl.className.match(/(?:^|\s)rating([1-5])(?:-t|\s|$)/);
            if (rm) rating = Number.parseInt(rm[1], 10);
        }
        var dateText = text(note.querySelector('.date'));
        var dm = dateText.match(/\d{4}-\d{2}-\d{2}/);
        var tags = text(note.querySelector('.tags')).replace(/^标签\s*[:：]\s*/, '');
        var comment = text(note.querySelector('.comment'));
        // 音乐页的短评可能只是日期行之后 li 内的文本，没有 .comment。
        if (media === 'music' && !comment) {
            var dateEl = note.querySelector('.date');
            var dateLine = dateEl && dateEl.closest('li');
            var commentLine = dateLine && dateLine.nextElementSibling;
            if (commentLine && !commentLine.matches('.opt-ln') && !commentLine.querySelector('.date, .title, .intro')) {
                comment = text(commentLine);
            }
        }
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
            cover: img && img.getAttribute('src') ? new URL(img.getAttribute('src'), location.origin).href : ''
        };
    }

    function parseListPage(doc, status) {
        var items = doc.querySelectorAll(media === 'book' ? '.interest-list .subject-item' : '.grid-view .item');
        if (!items.length) {
            items = doc.querySelectorAll('.interest-list > li');
        }
        return Array.prototype.map.call(items, function (li) { return parseItem(li, status); }).filter(function (item) {
            return item.title && /\/subject\/\d+/.test(item.url);
        });
    }

    // ---------- 抓取 ----------
    function listUrl(key, start) {
        return '/people/' + uid + '/' + key + '?start=' + start + '&sort=time&' +
            (media === 'movie' ? 'type' : 'rating') + '=all&filter=all&mode=grid';
    }

    async function fetchList(key, settings, myRun, signal) {
        var books = [];
        if (myRun !== runId) throw new Error('aborted');
        setProgress(key, '正在获取第 1 页...');
        var firstDoc = await fetchDoc(listUrl(key, 0), signal);
        if (myRun !== runId) throw new Error('aborted');

        var pages = totalPages(firstDoc);
        var total = totalCount(firstDoc);
        var firstPage = parseListPage(firstDoc, key);
        books = books.concat(firstPage);
        // 从分页链接取偏移量，不能用解析成功的条目数计算后续 start。
        var offsets = Array.from(firstDoc.querySelectorAll('.paginator a[href]')).map(function (a) {
            return Number(new URL(a.getAttribute('href'), location.origin).searchParams.get('start'));
        }).filter(function (n) { return Number.isInteger(n) && n > 0; });
        var perPage = offsets.length ? Math.min.apply(null, offsets) : 15;
        if (total !== null) pages = Math.max(pages, Math.ceil(total / perPage));
        if (!firstPage.length && (total !== 0 || pages > 1)) {
            throw new Error(STATUS_NAME[key] + '列表未能解析，请确认页面可访问后重试');
        }

        var describe = function (p) {
            return '第 ' + p + '/' + pages + ' 页，已获取 ' + books.length + (total !== null ? '/' + total : '') + ' ' + config.unit;
        };
        setProgress(key, describe(1));

        for (var p = 2; p <= pages; p++) {
            await sleep(settings.delay * 1000);
            if (myRun !== runId) throw new Error('aborted');
            var doc = await fetchDoc(listUrl(key, (p - 1) * perPage), signal);
            if (myRun !== runId) throw new Error('aborted');
            var pageItems = parseListPage(doc, key);
            if (!pageItems.length) throw new Error(STATUS_NAME[key] + '第 ' + p + ' 页未能解析，请稍后重试');
            books = books.concat(pageItems);
            setProgress(key, describe(p));
        }
        var ids = new Set(books.map(function (b) { return b.id; }));
        if (ids.size !== books.length || (total !== null && books.length !== total)) {
            throw new Error(STATUS_NAME[key] + '列表数量不一致，可能在导出期间发生了变化，请刷新页面后重试');
        }
        setProgress(key, '完成，共 ' + books.length + ' ' + config.unit);
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
    var DETAIL_HEADERS = media === 'book' ? ['书名', '作者', '出版社', '出版年', '定价', config.metadata] : [config.title, config.metadata];
    var HEADERS = ['状态'].concat(DETAIL_HEADERS, [
        '我的评分(1-5)', '短评', '标签', '标记日期',
        STATUS_NAME.wish + '日期', '开始' + STATUS_NAME.do + '日期', config.done + '日期',
        STATUS_NAME.wish + '→' + config.done + '(天)', STATUS_NAME.do + '→' + config.done + '(天)', STATUS_NAME.do + '至今(天)',
        '豆瓣链接', '封面'
    ]);
    var COL_WIDTHS = [6].concat(media === 'book' ? [36, 24, 18, 10, 10, 50] : [40, 80], [12, 60, 24, 12, 12, 12, 12, 13, 13, 12, 40, 50]);

    function toRow(b) {
        var details = media === 'book' ? [b.title, b.author, b.publisher, b.year, b.price, b.pub] : [b.title, b.pub];
        return [STATUS_NAME[b.status]].concat(details, [
            b.rating, b.comment, b.tags, b.date,
            b.wishDate, b.doDate, b.collectDate,
            b.wishToCollect, b.doToCollect, b.doToNow,
            b.url, b.cover
        ]);
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
            ['豆瓣导出助手 Plus — ' + config.name],
            ['导出时间', now.toLocaleString()],
            ['豆瓣用户', uid],
            [STATUS_NAME.do, counts.do], [STATUS_NAME.collect, counts.collect], [STATUS_NAME.wish, counts.wish],
            [],
            ['字段说明'],
            ['标记日期', '你在豆瓣上标记 ' + LISTS.map(function (l) { return l.name; }).join(' / ') + ' 的日期，也就是评价时间。'],
            ['我的评分', '你打的星级，1-5 星；空表示未评分。'],
            ['状态日期', '豆瓣只保留当前状态的日期。插件每次导出时按类别和账号在本地记录各条目的日期，之后导出就能回填；旧版未归属账号的书籍记录不自动混入。'],
            [STATUS_NAME.wish + '→' + config.done + '(天)', config.done + '日期 - ' + STATUS_NAME.wish + '日期。需要曾在「' + STATUS_NAME.wish + '」状态导出过一次。'],
            [STATUS_NAME.do + '→' + config.done + '(天)', config.done + '日期 - 开始' + STATUS_NAME.do + '日期，同上。'],
            [STATUS_NAME.do + '至今(天)', '今天 - 开始' + STATUS_NAME.do + '日期，只对「' + STATUS_NAME.do + '」条目计算。'],
            [],
            ['建议', '隔段时间导出一次，以积累状态日期。时长按标记日期相减，不能代表实际阅读、观看或收听耗时。']
        ];
        var ws = XLSX.utils.aoa_to_sheet(notes);
        ws['!cols'] = [{wch: 24}, {wch: 90}];
        XLSX.utils.book_append_sheet(wb, ws, '说明');
        return wb;
    }

    function fileName() {
        return '豆瓣' + config.name + '_' + uid + '_' + todayStr().replace(/-/g, '') + '.xlsx';
    }

    // ---------- 主流程 ----------
    async function startExport() {
        if (controller) controller.abort();
        controller = new AbortController();
        var signal = controller.signal;
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
                var books = await fetchList(key, settings, myRun, signal);
                counts[key] = books.length;
                all = all.concat(books);
                if (i < LISTS.length - 1) await sleep(settings.delay * 1000);
            }
            if (myRun !== runId) return;

            mergeHistory(history, all);
            await saveHistory(history);
            if (myRun !== runId) return;
            enrich(all, history);

            var wb = buildWorkbook(all, counts);
            var out = XLSX.write(wb, {bookType: 'xlsx', type: 'array'});
            var blob = new Blob([out], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
            downloadEl.href = URL.createObjectURL(blob);
            downloadEl.download = fileName();
            downloadEl.classList.remove('dbx-hidden');
            titleEl.textContent = '导出完成，共 ' + all.length + ' ' + config.unit;
        } catch (e) {
            if (myRun !== runId || (e && (e.message === 'aborted' || e.name === 'AbortError'))) return;
            console.error('[豆瓣导出]', e);
            titleEl.textContent = '导出失败';
            errorEl.textContent = (e && e.message) ? e.message : String(e);
            errorEl.classList.remove('dbx-hidden');
        }
    }

    // 暴露给测试页使用
    window.__dbx = {parsePub: parsePub, parseItem: parseItem, parseListPage: parseListPage, totalPages: totalPages,
        startExport: startExport, buildWorkbook: buildWorkbook, mergeHistory: mergeHistory, enrich: enrich,
        insertButton: insertButton, media: media, uid: uid};
})();
