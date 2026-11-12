const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');

test('settings summarize each media and clear only export history after confirmation', t => {
    const dom = new JSDOM(fs.readFileSync(path.join(__dirname, '../options.html'), 'utf8'), {runScripts: 'outside-only'});
    t.after(() => dom.window.close());
    const {window} = dom;
    const data = {
        delay: '3', unrelated: {enabled: true},
        dbxHistory: {'42': {wish: '2020-01-01'}},
        'dbxHistory:book:alice': {'42': {do: '2026-10-01'}},
        'dbxHistory:book:bob': {'42': {collect: '2026-10-02'}},
        'dbxHistory:movie:alice': {'42': {wish: '2026-10-03'}},
        'dbxHistory:music:alice': {'42': {do: '2026-10-04', collect: '2026-10-05'}}
    };
    window.chrome = {storage: {local: {
        get(defaults, callback) { callback({...defaults, ...data}); },
        set(values, callback) { Object.assign(data, values); callback?.(); },
        remove(keys, callback) { keys.forEach(key => delete data[key]); callback?.(); }
    }}};
    window.confirm = () => false;
    window.eval(fs.readFileSync(path.join(__dirname, '../options.js'), 'utf8'));
    const summary = window.document.querySelector('#historyInfo').textContent;
    assert.match(summary, /读书：2 本/);
    assert.match(summary, /电影：1 部/);
    assert.match(summary, /音乐：1 张/);
    assert.match(summary, /旧版书籍记录：1 本/);
    assert.equal(window.document.querySelector('#delay').value, '3');
    window.document.querySelector('#clearHistory').click();
    assert.ok(data.dbxHistory, 'cancelled confirmation preserves records');
    window.confirm = () => true;
    window.document.querySelector('#clearHistory').click();
    assert.deepEqual(data, {delay: '3', unrelated: {enabled: true}});
    assert.match(window.document.querySelector('#historyInfo').textContent, /读书：0 本/);
    assert.match(window.document.querySelector('#historyInfo').textContent, /电影：0 部/);
    assert.match(window.document.querySelector('#historyInfo').textContent, /音乐：0 张/);
});
