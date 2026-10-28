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

    function basis(item) {
        return [item.AnimeId, item.EpisodeTotal, item.LastUpdate, item.VideoFileCount].join('|');
    }

    function summarize(item, response, now) {
        item = item || {};
        var files = count(item.VideoFileCount);
        var catalog = count(item.EpisodeTotal);
        var result = {
            state: files === 0 ? 'empty' : 'unknown',
            local: files === null ? '' : (files ? '本地 ' + files + ' 文件' : '本地暂无'),
            online: catalog ? '条目 ' + catalog + ' 话' : '',
            latest: null, latestLocal: null, note: '', detail: '',
            checkedAt: now == null ? Date.now() : now, basis: basis(item)
        };
        if (!response || !Array.isArray(response.Episodes) || !response.Episodes.length) return result;
        // Credits and specials cannot determine the latest regular episode.
        var regular = response.Episodes.filter(function (episode) {
            return /^\d+(?:\.\d+)?$/.test(String(episode.EpisodeNumber || '')) && Number(episode.EpisodeNumber) > 0;
        });
        if (!regular.length) return result;
        var seen = {};
        var conflicts = [];
        var episodes = regular.filter(function (episode, index) {
            var key = String(episode.EpisodeId || (String(episode.SeasonId) + ':' + (episode.EpisodeNumber || index)));
            if (seen[key]) {
                var previous = seen[key];
                if (Number(previous.EpisodeNumber) !== Number(episode.EpisodeNumber) ||
                    String(previous.SeasonId || '') !== String(episode.SeasonId || '') ||
                    day(previous.AirDate) !== day(episode.AirDate) || local(previous) !== local(episode)) {
                    conflicts.push(previous, episode);
                }
                return false;
            }
            seen[key] = episode;
            return true;
        });
        function local(episode) {
            var matches = episode.LocalMatchedFiles;
            if (Array.isArray(matches)) {
                if (matches.some(function (file) { return file.EpisodeId != null && String(file.EpisodeId) !== String(episode.EpisodeId); })) return null;
                if (episode.LocalMatchedExists === false && matches.length) return null;
                if (episode.LocalMatchedExists === true && !matches.length) return null;
                return matches.length > 0;
            }
            return typeof episode.LocalMatchedExists === 'boolean' ? episode.LocalMatchedExists : null;
        }
        var localCount = episodes.filter(function (episode) { return local(episode) === true; }).length;
        if (episodes.every(function (episode) { return local(episode) !== null; })) {
            result.local = localCount ? '本地 ' + localCount + ' 话' : '本地暂无';
        }
        var currentDay = today(now);
        var dated = episodes.filter(function (episode) { return Boolean(day(episode.AirDate)); });
        var aired = dated.filter(function (episode) {
            var airedDay = localDay(episode.AirDate);
            return airedDay && airedDay <= currentDay;
        });
        var updateDay = day(item.LastUpdate);
        var hasListUpdate = catalog !== null && catalog > 0 && Boolean(updateDay);
        var listed = updateDay ? dated.filter(function (episode) { return day(episode.AirDate) <= updateDay; }) : [];
        // A count alone is not a boundary: 1,2,4,5 cannot stand in for 1..4.
        // Require identified, unambiguous consecutive rows from one season.
        function completePrefix(rows) {
            if (!rows.length) return false;
            var sorted = rows.slice().sort(function (a, b) { return Number(a.EpisodeNumber) - Number(b.EpisodeNumber); });
            var season = String(sorted[0].SeasonId || '');
            return sorted.every(function (episode, index) {
                return episode.EpisodeId && Number(episode.EpisodeNumber) === index + 1 &&
                    String(episode.SeasonId || '') === season &&
                    episodes.filter(function (row) { return Number(row.EpisodeNumber) === index + 1; }).length === 1;
            });
        }
        var tomorrow = new Date(now == null ? Date.now() : now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        // A one-day calendar difference can come from the list/browser zones;
        // remote future plans cannot be promoted into an already released update.
        var listVerified = hasListUpdate && updateDay <= today(tomorrow.getTime()) && listed.length === catalog && completePrefix(listed) &&
            listed.some(function (episode) { return day(episode.AirDate) === updateDay; });
        // Only undated rows strictly beyond the verified range may be ignored.
        var networkKnown = hasListUpdate ? listVerified : catalog === episodes.length &&
            dated.length === episodes.length && completePrefix(episodes) && completePrefix(aired);
        var network = listVerified ? listed : aired;
        if (networkKnown && (conflicts.some(function (episode) { return Number(episode.EpisodeNumber) <= network.length; }) ||
            episodes.some(function (episode) { return Number(episode.EpisodeNumber) <= network.length && !day(episode.AirDate); }))) networkKnown = false;
        if (!networkKnown) return result;
        var latest = network.reduce(function (a, b) { return Number(a.EpisodeNumber) > Number(b.EpisodeNumber) ? a : b; });
        result.latest = String(latest.EpisodeNumber);
        result.latestLocal = local(latest);
        result.online = '最新第 ' + result.latest + ' 话';
        if (result.latestLocal === null) return result;
        // This badge answers whether the latest episode is local, not whether
        // every older episode has been downloaded or watched.
        result.state = result.latestLocal ? 'available' : (files === 0 ? 'empty' : 'behind');
        result.note = result.latestLocal ? '' : '最新话未入库';
        result.detail = result.online + (result.latestLocal ? '已有对应本地文件。' : '尚无对应本地文件。') +
            (listVerified ? '按列表更新日期和正片编号确认；' : '按设备本地日期确认；') +
            '特典、多版本文件和未来未排期条目不计为当前更新。';
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
        var saved = item.__availabilitySummary;
        var fresh = saved && saved.basis === basis(item) && Date.now() - saved.checkedAt >= 0 && Date.now() - saved.checkedAt < 20000;
        var info = response !== undefined ? summarize(item, response) : (fresh ? saved : summarize(item));
        var known = info.latest !== null && info.latestLocal !== null;
        var visible = known || info.state === 'empty';
        badge.dataset.state = info.state;
        badge.textContent = known ? info.latest : '';
        if (visible) {
            var description = [known ? info.online + (info.latestLocal ? '，本地已有' : '，本地未入库') : '暂无本地文件', info.local, info.detail].filter(Boolean).join('；');
            badge.removeAttribute('aria-hidden');
            badge.setAttribute('aria-label', description);
            badge.setAttribute('title', description);
        } else {
            badge.setAttribute('aria-hidden', 'true');
            badge.removeAttribute('aria-label');
            badge.removeAttribute('title');
        }
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
