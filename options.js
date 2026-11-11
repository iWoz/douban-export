(function () {
    var delay = document.getElementById('delay');
    var saved = document.getElementById('saved');
    var historyInfo = document.getElementById('historyInfo');
    var clearBtn = document.getElementById('clearHistory');
    var HISTORY_KEY = 'dbxHistory';

    chrome.storage.sync.get({delay: '1'}, function (items) {
        delay.value = String(items.delay);
        if (delay.value !== String(items.delay)) delay.value = '1';
    });

    delay.addEventListener('change', function () {
        chrome.storage.sync.set({delay: delay.value}, function () {
            saved.textContent = '已保存';
            setTimeout(function () { saved.textContent = ''; }, 1500);
        });
    });

    function refreshHistory() {
        chrome.storage.local.get({}, function (items) {
            var h = items[HISTORY_KEY] || {};
            var ids = Object.keys(h);
            var wish = 0, doing = 0, collect = 0;
            ids.forEach(function (id) {
                if (h[id].wish) wish++;
                if (h[id].do) doing++;
                if (h[id].collect) collect++;
            });
            historyInfo.textContent = '已记录 ' + ids.length + ' 本书的日期（想读 ' + wish + '，在读 ' + doing + '，读过 ' + collect + '）';
        });
    }

    clearBtn.addEventListener('click', function () {
        if (!confirm('确定清空所有已记录的 想读/在读/读过 日期吗？此操作不可恢复。')) return;
        chrome.storage.local.remove(HISTORY_KEY, refreshHistory);
    });

    refreshHistory();
})();
