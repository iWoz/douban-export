const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const XLSX = require('../xlsx.full.min.js');

const source = fs.readFileSync(path.join(__dirname, '../export.js'), 'utf8');
const xlsxSource = fs.readFileSync(path.join(__dirname, '../xlsx.full.min.js'), 'utf8');
const names = {
    book: {home: '读书主页', button: '导出书单 (Excel)', title: '书名', meta: '出版信息(原文)', file: '豆瓣读书', statuses: ['在读', '已读', '想读']},
    movie: {home: '电影主页', button: '导出片单 (Excel)', title: '片名', meta: '影片信息(原文)', file: '豆瓣电影', statuses: ['在看', '已看', '想看']},
    music: {home: '音乐主页', button: '导出音乐 (Excel)', title: '专辑名', meta: '音乐信息(原文)', file: '豆瓣音乐', statuses: ['在听', '已听', '想听']}
};
const clone = value => JSON.parse(JSON.stringify(value));

function profile(media, uid = 'alice', {nav = true, title = ''} = {}) {
    return `<div id="db-usr-profile">${media === 'music' ? '' : `<div class="pic"><a href="/people/${uid}/">头像</a></div>`}<div class="info">
        <h1>${title || `Alice的${names[media].home}`}</h1>
        ${nav ? `<ul class="nav-list"><li class="user-profile-nav-activated">${media === 'book' ? names[media].home : `<a href="https://${media}.douban.com/people/${uid}/">${names[media].home}</a>`}</li><li><a href="/people/${uid}/collect">收藏</a></li></ul>` : ''}
    </div></div>`;
}

function item(media, id, {date = '2026-10-20', rating = 4, comment = '值得再读 / 看 / 听', tags = '收藏 经典'} = {}) {
    const details = media === 'book' ? '作者 / 译者 / 测试出版社 / 2024-5 / 59.00元' : media === 'movie' ? '2024-05-01(中国大陆) / 演员甲 / 演员乙 / 中国大陆 / 剧情' : '歌手甲 / 2024-05-01 / 专辑 / CD / 流行';
    const marks = `<span class="rating${rating}-t"></span><span class="date">${date}</span><span class="tags">标签: ${tags}</span>`;
    if (media === 'book') {
        return `<li class="subject-item"><div class="pic"><a href="https://book.douban.com/subject/${id}/"><img src="https://img.example.test/${id}.jpg"></a></div><div class="info"><h2><a href="https://book.douban.com/subject/${id}/" title="作品 ${id}">作品 ${id}</a></h2><div class="pub">${details}</div></div><div class="short-note">${marks}<p class="comment">${comment}</p></div></li>`;
    }
    return `<div class="item comment-item"><div class="pic"><img src="https://img.example.test/${id}.jpg"></div><div class="info"><ul><li class="title"><a href="https://${media}.douban.com/subject/${id}/"><em>作品 ${id}</em> / Alternate title</a></li><li class="intro">${details}</li><li>${marks}</li><li>${media === 'music' ? comment : `<span class="comment">${comment}</span>`}</li><li class="clearfix opt-ln"><a href="#">修改</a> <a href="#">删除</a></li></ul></div></div>`;
}

function listPage(media, ids, {total = ids.length, pages = 1, page = 1} = {}) {
    const container = media === 'book' ? `<ul class="interest-list">${ids.map(id => item(media, id)).join('')}</ul>` : `<div class="grid-view">${ids.map(id => item(media, id)).join('')}</div>`;
    return `<html><body>${profile(media, 'alice', {title: `Alice的收藏 (${total})`})}${container}
        ${pages > 1 ? `<div class="paginator"><span class="thispage" data-total-page="${pages}">${page}</span><a href="?start=15">2</a>${page === 1 ? '<span class="next"><a href="?start=15">后页 &gt;</a></span>' : ''}</div>` : ''}</body></html>`;
}

function harness(media, {pathname = '/mine?icn=index-nav', html = profile(media), stored = {}, responder} = {}) {
    const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
        url: `https://${media}.douban.com${pathname}`, runScripts: 'outside-only'
    });
    const {window} = dom;
    const data = {delay: '0', ...clone(stored)};
    const requests = [];
    const writes = [];
    const blobs = [];
    window.console.error = () => {};
    window.chrome = {runtime: {}, storage: {local: {
        get(keys, callback) {
            let result;
            if (keys === null || (typeof keys === 'object' && !Array.isArray(keys) && !Object.keys(keys).length)) result = data;
            else if (typeof keys === 'string') result = {[keys]: data[keys]};
            else if (Array.isArray(keys)) result = Object.fromEntries(keys.filter(k => k in data).map(k => [k, data[k]]));
            else result = Object.fromEntries(Object.keys(keys).map(k => [k, k in data ? data[k] : keys[k]]));
            queueMicrotask(() => callback(clone(result)));
        },
        set(values, callback) {
            Object.assign(data, clone(values));
            writes.push(clone(values));
            queueMicrotask(() => callback?.());
        }
    }}};
    window.Blob = Blob;
    window.URL.createObjectURL = blob => { blobs.push(blob); return `blob:export-${blobs.length}`; };
    window.URL.revokeObjectURL = () => {};
    window.fetch = async (url, options) => {
        const absolute = new URL(url, window.location.href);
        requests.push({url: absolute, options});
        const response = responder ? await responder(absolute, options) : {html: listPage(media, [])};
        return {ok: true, status: 200, url: absolute.href, text: async () => response.html, ...response};
    };
    window.eval(xlsxSource);
    window.eval(source);
    return {dom, window, data, requests, writes, blobs, api: window.__dbx};
}

async function exportedWorkbook(h) {
    assert.equal(h.blobs.length, 1, 'exactly one downloadable workbook is created');
    return XLSX.read(Buffer.from(await h.blobs[0].arrayBuffer()), {type: 'buffer'});
}

for (const media of Object.keys(names)) {
    test(`${media}: /mine resolves the profile account and inserts one button next to the home tab`, t => {
        const h = harness(media);
        t.after(() => h.dom.window.close());
        assert.equal(h.api?.uid, 'alice');
        const button = h.window.document.querySelector('.dbx-export-btn');
        assert.equal(button?.textContent, names[media].button);
        assert.equal(button.closest('li').previousElementSibling.textContent, names[media].home);
        h.api.insertButton();
        assert.equal(h.window.document.querySelectorAll('.dbx-export-btn').length, 1);
    });

    test(`${media}: list parsing preserves personal marks and source metadata`, t => {
        const h = harness(media, {pathname: '/people/alice/collect'});
        t.after(() => h.dom.window.close());
        const doc = new h.window.DOMParser().parseFromString(listPage(media, [101]), 'text/html');
        const result = h.api.parseListPage(doc, 'collect');
        assert.equal(result.length, 1);
        const entry = result[0];
        assert.equal(entry.id, '101');
        assert.match(entry.title, /作品 101/);
        assert.equal(entry.status, 'collect');
        assert.equal(entry.rating, 4);
        assert.equal(entry.date, '2026-10-20');
        assert.equal(entry.comment, '值得再读 / 看 / 听');
        assert.equal(entry.tags, '收藏 经典');
        assert.equal(entry.url, `https://${media}.douban.com/subject/101/`);
        assert.equal(entry.cover, 'https://img.example.test/101.jpg');
        assert.match(entry.pub, media === 'book' ? /测试出版社/ : media === 'movie' ? /演员甲/ : /歌手甲/);
        if (media === 'book') {
            assert.equal(entry.author, '作者 / 译者');
            assert.equal(entry.publisher, '测试出版社');
            assert.equal(entry.year, '2024-5');
            assert.equal(entry.price, '59.00元');
        }
    });

    test(`${media}: exports all pages and states to a readable workbook with isolated date history`, async t => {
        const otherMedia = media === 'book' ? 'movie' : 'book';
        const stored = {
            dbxHistory: {'201': {wish: '2000-01-01'}},
            [`dbxHistory:${otherMedia}:alice`]: {'201': {wish: '2001-01-01'}},
            [`dbxHistory:${media}:bob`]: {'201': {wish: '2002-01-01'}},
            [`dbxHistory:${media}:alice`]: {'202': {wish: '2026-10-01', do: '2026-10-10'}}
        };
        const h = harness(media, {stored, responder(url) {
            const status = url.pathname.split('/').pop();
            const start = Number(url.searchParams.get('start'));
            if (status === 'do') return {html: listPage(media, start === 0 ? Array.from({length: 15}, (_, i) => i + 101) : [116], {total: 16, pages: 2, page: start === 0 ? 1 : 2})};
            return {html: listPage(media, status === 'collect' ? [201, 202] : [301])};
        }});
        t.after(() => h.dom.window.close());
        await h.api.startExport();
        assert.equal(h.window.document.querySelector('.dbx-error').textContent, '');
        assert.deepEqual(h.requests.map(r => [r.url.pathname.split('/').pop(), r.url.searchParams.get('start')]), [['do', '0'], ['do', '15'], ['collect', '0'], ['wish', '0']]);
        assert.ok(h.requests.every(r => r.options.credentials === 'same-origin'));
        const workbook = await exportedWorkbook(h);
        assert.deepEqual(workbook.SheetNames, ['全部', ...names[media].statuses, '说明']);
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets['全部'], {defval: ''});
        assert.equal(rows.length, 19);
        assert.equal(rows[0]['状态'], names[media].statuses[0]);
        assert.match(rows[0][names[media].title], /作品 101/);
        assert.ok(rows[0][names[media].meta]);
        const collected = rows.filter(row => row['状态'] === names[media].statuses[1]);
        const wishDate = media === 'book' ? '想读日期' : media === 'movie' ? '想看日期' : '想听日期';
        assert.equal(collected[0][wishDate], '', 'legacy, other-media and other-account history cannot leak into this export');
        assert.equal(collected[1][wishDate], '2026-10-01');
        const durationColumn = Object.keys(collected[1]).find(key => key.startsWith(wishDate.slice(0, 2) + '→'));
        assert.equal(collected[1][durationColumn], 19);
        assert.deepEqual(h.data.dbxHistory, stored.dbxHistory);
        assert.deepEqual(h.data[`dbxHistory:${media}:bob`], stored[`dbxHistory:${media}:bob`]);
        assert.deepEqual(h.data[`dbxHistory:${otherMedia}:alice`], stored[`dbxHistory:${otherMedia}:alice`]);
        assert.equal(h.data[`dbxHistory:${media}:alice`]['201'].collect, '2026-10-20');
        assert.ok(h.writes.every(write => Object.keys(write).every(key => key === `dbxHistory:${media}:alice`)));
        const download = h.window.document.querySelector('.dbx-download');
        assert.match(download.download, new RegExp(`^${names[media].file}_alice_\\d{8}\\.xlsx$`));
        assert.equal(download.classList.contains('dbx-hidden'), false);
        const sheet = workbook.Sheets['全部'];
        const table = XLSX.utils.sheet_to_json(sheet, {header: 1});
        const linkCell = XLSX.utils.encode_cell({r: 1, c: table[0].indexOf('豆瓣链接')});
        assert.equal(sheet[linkCell].l.Target, `https://${media}.douban.com/subject/101/`);
    });

    test(`${media}: valid empty lists still generate all five sheets`, async t => {
        const h = harness(media);
        t.after(() => h.dom.window.close());
        await h.api.startExport();
        const workbook = await exportedWorkbook(h);
        assert.deepEqual(workbook.SheetNames, ['全部', ...names[media].statuses, '说明']);
        assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets['全部']).length, 0);
    });
}

test('profile list pages without navigation keep a title-level export entry', t => {
    const h = harness('book', {pathname: '/people/alice/collect', html: profile('book', 'alice', {nav: false})});
    t.after(() => h.dom.window.close());
    assert.ok(h.window.document.querySelector('#db-usr-profile h1 .dbx-export-btn'));
});

test('a number in the nickname does not override the trailing list count', async t => {
    const h = harness('movie', {responder(url) {
        if (!url.pathname.endsWith('/collect')) return {html: listPage('movie', [])};
        const firstPage = Number(url.searchParams.get('start')) === 0;
        const html = listPage('movie', firstPage ? Array.from({length: 15}, (_, i) => 101 + i) : [116], {
            total: 16, pages: 2, page: firstPage ? 1 : 2
        }).replace('Alice的收藏 (16)', 'Alice(1990)看过的影视(16)');
        return {html};
    }});
    t.after(() => h.dom.window.close());
    await h.api.startExport();
    assert.equal(h.window.document.querySelector('.dbx-error').textContent, '');
    const workbook = await exportedWorkbook(h);
    assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets['已看']).length, 16);
    assert.equal(h.requests.length, 4);
});

for (const [label, response] of [
    ['HTTP 403', {ok: false, status: 403, html: ''}],
    ['login redirect', {url: 'https://accounts.douban.com/passport/login', html: '<h1>登录豆瓣</h1>'}],
    ['HTTP 200 verification page', {html: '<html><title>安全验证</title><body><h1>安全验证</h1><form action="/misc/sorry"><input name="captcha-solution"></form></body></html>'}],
    ['nonempty count without parseable entries', {html: listPage('movie', [], {total: 5})}]
]) {
    test(`${label} fails visibly instead of offering an empty successful export`, async t => {
        const h = harness('movie', {responder: () => response});
        t.after(() => h.dom.window.close());
        await h.api.startExport();
        assert.equal(h.blobs.length, 0);
        assert.equal(h.writes.length, 0);
        assert.equal(h.window.document.querySelector('.dbx-download').classList.contains('dbx-hidden'), true);
        assert.equal(h.window.document.querySelector('.dbx-error').classList.contains('dbx-hidden'), false);
        assert.ok(h.window.document.querySelector('.dbx-error').textContent.trim());
    });
}

test('closing a pending export stops further requests and workbook creation', async t => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const h = harness('music', {responder: () => pending});
    t.after(() => h.dom.window.close());
    const exportRun = h.api.startExport();
    while (!h.requests.length) await new Promise(resolve => setImmediate(resolve));
    h.window.document.querySelector('.dbx-close').click();
    release({html: listPage('music', [101])});
    await exportRun;
    assert.equal(h.requests.length, 1);
    assert.equal(h.blobs.length, 0);
    assert.equal(h.writes.length, 0);
    assert.equal(h.window.document.querySelector('.dbx-modal').classList.contains('dbx-show'), false);
});

test('an unidentified /mine page cannot export an unrelated account', t => {
    const h = harness('book', {html: '<h1>登录豆瓣</h1><a href="/people/someone/">推荐用户</a>'});
    t.after(() => h.dom.window.close());
    assert.equal(h.window.document.querySelector('.dbx-export-btn'), null);
});
