(function () {
    var delay = document.getElementById('delay');
    var saved = document.getElementById('saved');
    var historyInfo = document.getElementById('historyInfo');
    var clearBtn = document.getElementById('clearHistory');
    var LEGACY_HISTORY_KEY = 'dbxHistory';
    var HISTORY_PREFIX = /^dbxHistory:(book|movie|music):.+$/;
    var MEDIA = {
        book: {name: '读书', unit: '本', statuses: ['想读', '在读', '已读']},
        movie: {name: '电影', unit: '部', statuses: ['想看', '在看', '已看']},
        music: {name: '音乐', unit: '张', statuses: ['想听', '在听', '已听']}
    };

    chrome.storage.local.get({delay: '1'}, function (items) {
        delay.value = String(items.delay);
        if (delay.value !== String(items.delay)) delay.value = '1';
    });

    delay.addEventListener('change', function () {
        chrome.storage.local.set({delay: delay.value}, function () {
            saved.textContent = '已保存';
            setTimeout(function () { saved.textContent = ''; }, 1500);
        });
    });

    function refreshHistory() {
        chrome.storage.local.get({}, function (items) {
            var totals = {};
            Object.keys(MEDIA).forEach(function (media) {
                totals[media] = {count: 0, wish: 0, do: 0, collect: 0};
            });
            Object.keys(items).forEach(function (key) {
                var match = key.match(HISTORY_PREFIX);
                if (!match) return;
                addRecords(totals[match[1]], items[key]);
            });
            var lines = Object.keys(MEDIA).map(function (media) {
                var labels = MEDIA[media];
                var total = totals[media];
                return labels.name + '：' + total.count + ' ' + labels.unit + '（' +
                    ['wish', 'do', 'collect'].map(function (status, i) {
                        return labels.statuses[i] + ' ' + total[status];
                    }).join('，') + '）';
            });
            var legacy = {count: 0, wish: 0, do: 0, collect: 0};
            addRecords(legacy, items[LEGACY_HISTORY_KEY]);
            if (legacy.count) lines.push('旧版书籍记录：' + legacy.count + ' 本（未归属账号，保留但不参与新导出）');
            historyInfo.textContent = lines.join('\n');
        });
    }

    function addRecords(total, history) {
        if (!history || typeof history !== 'object' || Array.isArray(history)) return;
        Object.keys(history).forEach(function (id) {
            var record = history[id];
            if (!record || typeof record !== 'object' || Array.isArray(record)) return;
            total.count++;
            ['wish', 'do', 'collect'].forEach(function (status) {
                if (record[status]) total[status]++;
            });
        });
    }

    clearBtn.addEventListener('click', function () {
        if (!confirm('确定清空所有账号的读书、电影、音乐状态日期及旧版书籍记录吗？此操作不可恢复。')) return;
        chrome.storage.local.get({}, function (items) {
            var keys = Object.keys(items).filter(function (key) {
                return key === LEGACY_HISTORY_KEY || HISTORY_PREFIX.test(key);
            });
            chrome.storage.local.remove(keys, refreshHistory);
        });
    });

    refreshHistory();
})();
