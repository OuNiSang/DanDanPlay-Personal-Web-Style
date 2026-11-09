(function (global) {
    'use strict';

    // Offset-bearing timestamps are instants. Bare dates are calendar dates,
    // so do not let Date's UTC date-only parsing move them to the previous day.
    function parse(value) {
        if (value === null || value === undefined || value === '') return null;
        var normalized = typeof value === 'string' ? value.trim().replace(' ', 'T') : value;
        if (typeof normalized === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(normalized)) normalized += 'T00:00:00';
        var date = new Date(normalized);
        return Number.isFinite(date.getTime()) && date.getFullYear() > 1900 ? date : null;
    }

    function parts(value) {
        var date = parse(value);
        return date ? { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() } : null;
    }

    // A UTC stamp encodes local calendar components for day arithmetic only;
    // elapsed midnight hours vary at daylight-saving boundaries.
    function dayStamp(value) {
        var date = parts(value);
        return date ? Date.UTC(date.year, date.month - 1, date.day) : null;
    }

    // Classify once against a local calendar day, never elapsed 24-hour windows.
    // In particular, future timestamps must not be collapsed into today's slot.
    function relativeDay(value, now) {
        var stamp = dayStamp(value);
        var today = dayStamp(now === undefined ? new Date() : now);
        return stamp === null || today === null ? null : Math.round((today - stamp) / 86400000);
    }

    function msUntilNextLocalDay(value) {
        var now = parse(value === undefined ? new Date() : value);
        if (!now) return null;
        var next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        return next.getTime() - now.getTime();
    }

    function formatDate(value) {
        var date = parse(value);
        return date ? date.toLocaleDateString() : 'N/A';
    }

    function formatDateTime(value) {
        var date = parse(value);
        return date ? date.toLocaleString() : 'N/A';
    }

    // Recent updates is an airing calendar. File inclusion and local coverage
    // belong to availability badges, never to this date key.
    function airingAt(item, now) {
        if (!item) return null;
        if (!Array.isArray(item.__airingDates)) return parse(item.LastUpdate);
        var current = parse(now === undefined ? new Date() : now);
        if (!current) return null;
        for (var i = item.__airingDates.length - 1; i >= 0; i--) {
            if (item.__airingDates[i] <= current.getTime()) return parse(item.__airingDates[i]);
        }
        return null;
    }

    // Recent-update source adapter. The upstream floating AirDate is a calendar
    // value with no country/zone or broadcast clock. 'china-calendar' is the
    // user's explicit UTC+8 calendar-boundary convention, not a claim that an
    // episode really aired at midnight. True offset-bearing instants stay intact.
    function parseAiringDate(value, convention) {
        if (typeof value !== 'string') return value instanceof Date || typeof value === 'number' ? parse(value) : null;
        var normalized = value.trim().replace(' ', 'T');
        if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)) return parse(normalized);
        if (convention !== 'china-calendar') return null;
        if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) normalized += 'T00:00:00';
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,7})?)?$/.test(normalized)) return null;
        return parse(normalized + '+08:00');
    }

    function withAiringDates(item, response, convention) {
        var result = Object.assign({}, item);
        var matches = response && (response.AnimeId == null || String(response.AnimeId) === String(item.AnimeId));
        var episodes = matches && Array.isArray(response.Episodes) ? response.Episodes : [];
        result.__airingDates = episodes.filter(function (episode) {
            return /^\d+(?:\.\d+)?$/.test(String(episode.EpisodeNumber || '')) && Number(episode.EpisodeNumber) > 0;
        }).map(function (episode) {
            var date = parseAiringDate(episode.AirDate, convention);
            return date ? date.getTime() : null;
        }).filter(function (time) { return time !== null; }).sort(function (a, b) { return a - b; });
        result.__airingState = matches && Array.isArray(response.Episodes) ? 'details' : 'unavailable';
        return result;
    }

    function needsAiringDetails(item, now) {
        var age = relativeDay(item && item.LastUpdate, now);
        // One extra day covers cross-zone boundary values at the seven-day edge.
        // Future aggregate dates also need details: the latest aired episode may
        // already be in the week while LastUpdate points at a planned episode.
        return age !== null && age < 8;
    }

    function nextAiringAt(item, now) {
        var current = parse(now === undefined ? new Date() : now);
        if (!current || !item || !Array.isArray(item.__airingDates)) return null;
        for (var i = 0; i < item.__airingDates.length; i++) {
            if (item.__airingDates[i] > current.getTime()) return parse(item.__airingDates[i]);
        }
        return null;
    }

    function msUntilNextAiringChange(items, now) {
        var current = parse(now === undefined ? new Date() : now);
        if (!current) return null;
        var delay = msUntilNextLocalDay(current);
        (items || []).forEach(function (item) {
            var next = nextAiringAt(item, current);
            if (next) delay = Math.min(delay, next.getTime() - current.getTime());
        });
        return delay;
    }

    // The API also supplies date labels formatted in the server's zone.
    // Rebuild only temporal view labels; retain the original timestamps used
    // for ordering and network-update reconciliation, and all other groupings.
    function localizeList(items, nav) {
        (items || []).forEach(function (item) {
            var value = nav === 'lastupdate' ? item.LastUpdate :
                (nav === 'lastadd' ? item.Created :
                    (nav === 'lastplay' ? (item.__recentPlayAt || item.LastPlay) : null));
            var date = parts(value);
            if (!date) return;
            var month = date.year + '年' + String(date.month).padStart(2, '0') + '月';
            // Older records use yearly archives; timezone conversion must not
            // silently split those archives into a different monthly layout.
            if (/^\d{4}年$/.test(item.GroupName || '')) item.GroupName = date.year + '年';
            else if (/^\d{4}年\d{1,2}月$/.test(item.GroupName || '')) item.GroupName = month;
            item.Details = month + String(date.day).padStart(2, '0') + '日';
        });
        return items || [];
    }

    // The timeline and the complete recent-update list share one selected airing
    // instant. Clone before rebuilding its local labels: LastUpdate still owns
    // network reconciliation, and other library views keep their own date keys.
    // Known future-only works have not updated yet; unavailable metadata is a
    // separate unknown state, never an invented date or a file-inclusion date.
    function localizeAiringList(items, now) {
        var current = parse(now === undefined ? new Date() : now);
        return (items || []).map(function (item, index) {
            var date = airingAt(item, current);
            if (current && ((date && date > current) || (!date && nextAiringAt(item, current)))) return null;
            var result = Object.assign({}, item);
            if (date) {
                var local = parts(date);
                var month = local.year + '年' + String(local.month).padStart(2, '0') + '月';
                result.GroupName = /^\d{4}年$/.test(item.GroupName || '') ? local.year + '年' : month;
                result.Details = month + String(local.day).padStart(2, '0') + '日';
            } else {
                result.GroupName = /^(?:未知|日期未注明)$/.test(item.GroupName || '') ? item.GroupName : '日期未注明';
                // Keep a useful existing unknown-state message, but discard a
                // server-formatted aggregate date when details are unresolved.
                result.Details = item.Details && !/^\d{4}年\d{1,2}月\d{1,2}日$/.test(item.Details) ? item.Details : '日期未注明';
            }
            return { item: result, at: date ? date.getTime() : null, index: index };
        }).filter(function (entry) { return entry !== null; }).sort(function (a, b) {
            if (a.at === b.at) return a.index - b.index;
            if (a.at === null) return 1;
            if (b.at === null) return -1;
            return b.at - a.at;
        }).map(function (entry) { return entry.item; });
    }

    var api = { parse: parse, parts: parts, dayStamp: dayStamp, relativeDay: relativeDay, msUntilNextLocalDay: msUntilNextLocalDay, formatDate: formatDate, formatDateTime: formatDateTime, airingAt: airingAt, localizeList: localizeList, localizeAiringList: localizeAiringList, parseAiringDate: parseAiringDate, withAiringDates: withAiringDates, needsAiringDetails: needsAiringDetails, nextAiringAt: nextAiringAt, msUntilNextAiringChange: msUntilNextAiringChange };
    global.MediaCalendar = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
