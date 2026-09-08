(function (global, $) {
    'use strict';

    function parseWatchTime(value) {
        if (!value) return null;
        var time = new Date(value).getTime();
        return isNaN(time) ? null : time;
    }

    function findLatestWatchedEpisode(episodes) {
        var latest = null;
        (episodes || []).forEach(function (episode) {
            var localTime = parseWatchTime(episode.LastWatched);
            var cloudTime = parseWatchTime(episode.LastWatchedCloud);
            var time = Math.max(localTime || 0, cloudTime || 0);
            if (time && (!latest || time > latest.time)) {
                latest = {
                    episode: episode,
                    time: time,
                    watchValue: cloudTime > (localTime || 0) ? episode.LastWatchedCloud : episode.LastWatched
                };
            }
        });
        return latest;
    }

    function getEpisodeNumber(episode, bangumi) {
        var direct = Number(episode && episode.EpisodeNumber);
        if (isFinite(direct) && direct > 0) return Math.floor(direct);

        var title = String((episode && episode.EpisodeTitle) || '');
        var titleMatch = title.match(/(?:第\s*)?(\d+(?:\.\d+)?)\s*(?:话|話|集)|(?:ep(?:isode)?\.?\s*)(\d+(?:\.\d+)?)/i);
        if (titleMatch) return Math.floor(Number(titleMatch[1] || titleMatch[2]));

        var episodeId = String((episode && episode.EpisodeId) || '');
        var animeId = String((bangumi && bangumi.AnimeId) || '');
        if (animeId && episodeId.indexOf(animeId) === 0) {
            var suffix = Number(episodeId.slice(animeId.length));
            if (isFinite(suffix) && suffix > 0 && suffix < 1000) return Math.floor(suffix);
        }
        return null;
    }

    function applyDetails(bangumi, response) {
        if (!bangumi) return false;
        if (global.MediaAvailability && response) {
            bangumi.__availabilitySummary = global.MediaAvailability.summarize(bangumi, response);
        }
        var latest = findLatestWatchedEpisode(response && response.Episodes);
        if (!latest) return false;
        var episodeNumber = getEpisodeNumber(latest.episode, bangumi);
        if (episodeNumber) bangumi.EpisodeWatched = episodeNumber;
        if (latest.episode.EpisodeTitle) bangumi.LastEpisodeTitle = latest.episode.EpisodeTitle;
        if (latest.watchValue) bangumi.LastWatched = latest.watchValue;
        if (latest.episode.AirDate || latest.episode.EpisodeAirDate) {
            bangumi.EpisodeAirDate = latest.episode.AirDate || latest.episode.EpisodeAirDate;
        }
        if (!Number(bangumi.EpisodeTotal) && response && Array.isArray(response.Episodes)) {
            bangumi.EpisodeTotal = response.Episodes.length;
        }
        bangumi.__recentPlayAt = latest.time;
        return true;
    }

    function sort(items) {
        return (items || []).map(function (item, index) {
            return { item: item, index: index };
        }).sort(function (a, b) {
            var aTime = Number(a.item.__recentPlayAt || 0);
            var bTime = Number(b.item.__recentPlayAt || 0);
            if (aTime !== bTime) return bTime - aTime;
            return a.index - b.index;
        }).map(function (entry) {
            return entry.item;
        });
    }

    function requestDetails(template, animeId, timeout) {
        if (global.MediaAvailability) {
            return global.MediaAvailability.requestDetails(template, animeId, { timeout: timeout });
        }
        return new Promise(function (resolve) {
            $.ajax({
                url: template.replace('{id}', animeId),
                method: 'GET',
                timeout: timeout,
                success: function (response) { resolve(response); },
                error: function () { resolve(null); }
            });
        });
    }

    function hydrate(items, detailsApiTemplate, options) {
        options = options || {};
        if (!detailsApiTemplate || !items || !items.length) return Promise.resolve(items || []);

        var limit = Math.min(items.length, Number(options.limit || 16));
        var concurrency = Math.max(1, Math.min(6, Number(options.concurrency || 4)));
        var timeout = Number(options.timeout || 3500);
        var cursor = 0;

        function worker() {
            var index = cursor++;
            if (index >= limit) return Promise.resolve();
            var bangumi = items[index];
            return requestDetails(detailsApiTemplate, bangumi.AnimeId, timeout)
                .then(function (response) {
                    if (response) applyDetails(bangumi, response);
                })
                .then(worker);
        }

        var workers = [];
        for (var i = 0; i < Math.min(concurrency, limit); i++) workers.push(worker());
        return Promise.all(workers).then(function () { return sort(items); });
    }

    global.RecentPlayRefresh = {
        applyDetails: applyDetails,
        hydrate: hydrate,
        sort: sort
    };
})(window, window.jQuery);
