(function (global) {
    'use strict';

    function count(value) {
        if (value === null || value === undefined || value === '') return null;
        var number = Number(value);
        return isFinite(number) && number >= 0 ? Math.floor(number) : null;
    }

    function day(value) {
        var match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
        return match && match[1] > '1900-01-01' ? match[1] : '';
    }

    function today(now) {
        var date = new Date(now == null ? Date.now() : now);
        return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
    }

    function localDay(value) {
        var raw = String(value || '');
        if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) return day(raw);
        var time = new Date(raw).getTime();
        return Number.isFinite(time) ? today(time) : '';
    }

    function summarize(item, response, now) {
        item = item || {};
        var files = count(item.VideoFileCount);
        var catalog = count(item.EpisodeTotal);
        var result = {
            state: files === 0 ? 'empty' : 'unknown',
            local: files === null ? '本地待核对' : (files ? '本地 ' + files + ' 文件' : '本地暂无'),
            online: catalog ? '条目 ' + catalog + ' 话' : '网络待核对',
            note: '',
            detail: '网络条目信息不代表文件已下载；本地按媒体库匹配记录核对。'
        };
        if (!response || !Array.isArray(response.Episodes) || !response.Episodes.length) return result;
        // Numeric episode numbers exclude OP/ED/credits. Distinct episode IDs
        // count once even when multiple encodes/files match the same episode.
        var regular = response.Episodes.filter(function (episode) {
            return /^\d+(?:\.\d+)?$/.test(String(episode.EpisodeNumber || '')) && Number(episode.EpisodeNumber) > 0;
        });
        if (!regular.length) return result;
        var seen = {};
        var episodes = regular.filter(function (episode, index) {
            var key = String(episode.EpisodeId || (String(episode.SeasonId) + ':' + (episode.EpisodeNumber || index)));
            if (seen[key]) return false;
            seen[key] = true;
            return true;
        });
        function local(episode) {
            if (episode.LocalMatchedExists === false) return false;
            if (Array.isArray(episode.LocalMatchedFiles)) return episode.LocalMatchedFiles.length > 0;
            return episode.LocalMatchedExists === true ? true : null;
        }
        var allLocalKnown = episodes.every(function (episode) { return local(episode) !== null; });
        var localCount = episodes.filter(function (episode) { return local(episode) === true; }).length;
        var currentDay = today(now);
        var dated = episodes.filter(function (episode) { return Boolean(day(episode.AirDate)); });
        var aired = dated.filter(function (episode) {
            var airedDay = localDay(episode.AirDate);
            return airedDay && airedDay <= currentDay;
        });
        // The list can already report the next update while its calendar date
        // is still ahead of the browser. Match BOTH its count and date to the
        // detail rows; scheduled episodes beyond that boundary remain excluded.
        var updateDay = day(item.LastUpdate);
        var hasListUpdate = catalog !== null && catalog > 0 && Boolean(updateDay);
        var listed = updateDay ? dated.filter(function (episode) { return day(episode.AirDate) <= updateDay; }) : [];
        var listVerified = hasListUpdate && listed.length === catalog;
        var network = listVerified ? listed : aired;
        var networkKnown = dated.length === episodes.length && (!hasListUpdate || listVerified);
        if (allLocalKnown) result.local = localCount ? '本地 ' + localCount + ' 话' : '本地暂无';
        if (hasListUpdate) result.online = '网络 ' + catalog + ' 话';
        else if (networkKnown) result.online = network.length ? '网络 ' + network.length + ' 话' : '网络未开播';
        // AirStatus is a watch-state enum, not evidence of broadcast or a file.
        // Known missing files remain actionable even if other rows are partial.
        var missing = network.filter(function (episode) { return local(episode) === false; });
        var synced = networkKnown && network.length > 0 && network.every(function (episode) { return local(episode) === true; });
        if (missing.length || synced) {
            result.state = missing.length ? 'behind' : 'available';
            result.note = missing.length ? '待入库 ' + missing.length + ' 话' : '';
            result.detail = '本地已匹配 ' + localCount + ' 话；网络已更新 ' + network.length + ' 话' +
                (missing.length ? '，其中 ' + missing.length + ' 话尚无本地文件。' : '。') +
                (listVerified ? '按列表更新日期与正片话数核对；' : '按设备本地日期核对放送记录；') +
                '特典和多版本文件不重复计入正片话数。';
        }
        return result;
    }

    var cache = new Map();
    var queue = [];
    var active = 0;
    var epoch = 0;
    var watched = new Map();
    var observer = null;

    function pump() {
        if (!global.document || global.document.hidden) return;
        while (active < 3 && queue.length) {
            var job = queue.shift();
            if (job.epoch !== epoch) { job.resolve(null); continue; }
            active += 1;
            job.run();
        }
    }

    function requestDetails(template, id, options) {
        options = options || {};
        if (!template || !id || !global.fetch) return Promise.resolve(null);
        var key = template.replace('{id}', encodeURIComponent(String(id)));
        var existing = cache.get(key);
        if (existing && (!existing.done || Date.now() - existing.at < 20000)) return existing.promise;
        var record = { done: false, at: Date.now(), controller: null };
        var requestEpoch = epoch;
        record.promise = new Promise(function (resolve) {
            queue.push({ epoch: requestEpoch, resolve: resolve, run: function () {
                var controller = new AbortController();
                record.controller = controller;
                var timer = global.setTimeout(function () { controller.abort(); }, options.timeout || 4500);
                global.fetch(key, { signal: controller.signal, credentials: 'same-origin' })
                    .then(function (response) { return response.ok ? response.json() : null; })
                    .catch(function () { return null; })
                    .then(function (response) {
                        global.clearTimeout(timer);
                        record.done = true;
                        record.at = Date.now();
                        record.controller = null;
                        if (!response && cache.get(key) === record) cache.delete(key);
                        resolve(requestEpoch === epoch ? response : null);
                    }).finally(function () { active -= 1; pump(); });
            }});
        });
        cache.set(key, record);
        pump();
        return record.promise;
    }

    function paint(badge, item, response) {
        var info = response !== undefined ? summarize(item, response) : (item.__availabilitySummary || summarize(item));
        var status = { available: '本地已同步', behind: '网络已更新，本地待同步', empty: '暂无本地文件', unknown: '本地同步状态待核对' }[info.state];
        badge.dataset.state = info.state;
        badge.setAttribute('aria-label', [status, info.local, info.online, info.note, info.detail].filter(Boolean).join('；'));
    }

    function attach(owner, item, template) {
        if (!owner || !global.document) return;
        var existingBadge = owner.querySelector(':scope > .media-availability');
        if (existingBadge) { paint(existingBadge, item); return existingBadge; }
        owner.classList.add('has-media-availability');
        var badge = global.document.createElement('span');
        badge.className = 'media-availability';
        badge.setAttribute('role', 'img');
        paint(badge, item);
        owner.appendChild(badge);
        if (!template) return badge;
        function hydrate() {
            requestDetails(template, item.AnimeId).then(function (response) {
                if (badge.isConnected) paint(badge, item, response);
            });
        }
        if (!global.IntersectionObserver) hydrate();
        else {
            if (!observer) observer = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    if (!entry.isIntersecting) return;
                    var action = watched.get(entry.target);
                    observer.unobserve(entry.target);
                    watched.delete(entry.target);
                    if (action) action();
                });
            }, { rootMargin: '80px' });
            watched.set(badge, hydrate);
            observer.observe(badge);
        }
        return badge;
    }

    function prune() {
        watched.forEach(function (_, node) {
            if (!node.isConnected) { observer.unobserve(node); watched.delete(node); }
        });
    }

    function reset() {
        epoch += 1;
        cache.forEach(function (record) { if (record.controller) record.controller.abort(); });
        cache.clear();
        queue.splice(0).forEach(function (job) { job.resolve(null); });
        prune();
    }

    var api = { summarize: summarize, requestDetails: requestDetails, attach: attach, prune: prune, reset: reset };
    global.MediaAvailability = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global.document) {
        global.document.addEventListener('visibilitychange', pump);
        global.addEventListener('pagehide', reset);
        global.addEventListener('pageshow', function (event) { if (event.persisted) pump(); });
    }
})(typeof window !== 'undefined' ? window : globalThis);
