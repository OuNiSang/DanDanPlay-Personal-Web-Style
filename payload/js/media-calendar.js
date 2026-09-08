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

    function formatDate(value) {
        var date = parse(value);
        return date ? date.toLocaleDateString() : 'N/A';
    }

    function formatDateTime(value) {
        var date = parse(value);
        return date ? date.toLocaleString() : 'N/A';
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

    var api = { parse: parse, parts: parts, dayStamp: dayStamp, formatDate: formatDate, formatDateTime: formatDateTime, localizeList: localizeList };
    global.MediaCalendar = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
