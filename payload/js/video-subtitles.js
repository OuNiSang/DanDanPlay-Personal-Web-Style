(function () {
    'use strict';

    function languageRank(name) {
        if (/简体|簡體|简中|簡中|[简簡](?:日|英|繁|双语|雙語)|[中日英][简簡]|[【\[]\s*[简簡]\s*[】\]]|\b(?:simplified|chs|gb2312|zh[-_. ](?:hans|cn|sg))\b/i.test(name)) return 0;
        if (/繁体|繁體|繁中|繁(?:日|英|简|簡|双语|雙語)|[中日英]繁|[【\[]\s*繁\s*[】\]]|\b(?:traditional|cht|big5|zh[-_. ](?:hant|tw|hk|mo))\b/i.test(name)) return 1;
        if (/中文|汉语|漢語|\b(?:chinese|zh|zho|chi)\b/i.test(name)) return 2;
        return null;
    }

    function preferredPage(href, links) {
        var page = new URL(href);
        if (page.searchParams.has('subtitle')) return null;
        var best, bestScore = Infinity;
        for (var link of links) {
            var target = new URL(link.href, page);
            var key = target.searchParams.get('subtitle');
            if (!key || target.origin !== page.origin || target.pathname !== page.pathname ||
                target.searchParams.get('id') !== page.searchParams.get('id')) continue;
            var name = link.textContent.trim().replace(/_/g, ' ');
            var rank = languageRank(name);
            if (rank === null) continue;
            // Prefer full dialogue to a signs-only or commentary track. Break
            // language ties with the server's current track, then the original file.
            var partial = /\b(?:forced|signs(?:\s+and\s+songs)?|commentary)\b|仅招牌|僅招牌|仅标识|僅標識|仅特效|僅特效/i.test(name);
            var score = (partial ? 20 : 0) + rank * 4 + (link.classList.contains('active') ? 0 : 2) +
                (/\(\d+\)\.[^.]+$/.test(name) ? 1 : 0);
            if (score < bestScore) { best = link; bestScore = score; }
        }
        if (!best || best.classList.contains('active')) return null;
        // The server resolves its own subtitle key and font. Replace the initial
        // history entry once, before creating any media or progress controller.
        page.searchParams.set('subtitle', new URL(best.href, page).searchParams.get('subtitle'));
        return page.href;
    }

    function bind(player, url, font) {
        var video = player.video;
        var links = document.querySelectorAll('#subtitlePanel a[href]');
        var mode = new URL(location.href).searchParams.get('decoder');
        var renderer, canvas, observer, events, frame = 0, lastTime = NaN;
        var notified = false;

        function warn() {
            clear();
            if (!notified && window.DandanApp) DandanApp.toast('字幕加载失败，视频仍可继续播放。', 'warning');
            notified = true;
        }

        function clear() {
            if (events) events.abort();
            if (observer) observer.disconnect();
            cancelAnimationFrame(frame);
            frame = 0;
            lastTime = NaN;
            if (renderer) renderer.dispose();
            if (canvas) canvas.remove();
            canvas = renderer = observer = events = null;
        }

        function size() {
            var surface = canvas.parentElement;
            if (!video.videoWidth || !video.videoHeight) return;
            var scale = Math.min(surface.clientWidth / video.videoWidth, surface.clientHeight / video.videoHeight);
            if (!scale) return;
            var w = Math.max(1, Math.round(video.videoWidth * scale));
            var h = Math.max(1, Math.round(video.videoHeight * scale));
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';
            var density = Math.min(window.devicePixelRatio || 1, 1080 / h);
            var width = Math.max(1, Math.round(w * density));
            var height = Math.max(1, Math.round(h * density));
            if (canvas.width !== width || canvas.height !== height) {
                renderer.resize(width, height);
                lastTime = NaN;
            }
        }

        // Leave the worker's independent clock paused. Render only new media
        // timestamps so a stalled decoder, pause or seek cannot accumulate drift.
        function sync() {
            if (!renderer || !canvas) return;
            canvas.hidden = video.seeking || video.readyState < 2 || !!video.error;
            if (canvas.hidden) return;
            var time = video.currentTime;
            if (Number.isFinite(time) && (Math.abs(time - lastTime) >= 1 / 24 || !Number.isFinite(lastTime) || video.paused && time !== lastTime)) {
                renderer.setCurrentTime(time);
                lastTime = time;
            }
            if (!frame && !video.paused && !video.ended && !document.hidden) {
                frame = requestAnimationFrame(function () { frame = 0; sync(); });
            }
        }

        function mount(event) {
            clear();
            notified = false;
            var software = video.ddpSoftwareDecoder && video.ddpSoftwareDecoder.isActive();
            if (event || software) mode = software ? 'software' : 'native';
            if (mode === 'software' || mode === 'native') links.forEach(function (link) {
                var target = new URL(link.href);
                target.searchParams.set('decoder', mode);
                link.href = target.href;
            });
            if (!url) return;
            var options = {
                subUrl: url, fonts: font ? [font] : [],
                workerUrl: 'js/subtitles-octopus-worker.js',
                legacyWorkerUrl: 'js/subtitles-octopus-worker-legacy.js', onError: warn
            };
            try {
                if (!software) {
                    options.video = video;
                    renderer = new SubtitlesOctopus(options);
                    return;
                }
                canvas = document.createElement('canvas');
                canvas.className = 'ddp-software-subtitles';
                canvas.hidden = true;
                canvas.setAttribute('aria-hidden', 'true');
                video.before(canvas);
                options.canvas = canvas;
                options.onReady = function () { size(); lastTime = NaN; sync(); };
                renderer = new SubtitlesOctopus(options);
                events = new AbortController();
                var listener = { signal: events.signal };
                ['loadedmetadata', 'loadeddata'].forEach(function (name) {
                    video.addEventListener(name, function () { size(); sync(); }, listener);
                });
                ['playing', 'pause', 'seeked', 'seeking', 'ended', 'error', 'emptied', 'timeupdate'].forEach(function (name) {
                    video.addEventListener(name, sync, listener);
                });
                document.addEventListener('visibilitychange', sync, listener);
                observer = new ResizeObserver(function () { if (canvas) { size(); sync(); } });
                observer.observe(canvas.parentElement);
                size();
                sync();
            } catch (error) { warn(); }
        }

        mount();
        video.addEventListener('ddpdecoderchange', mount);
        function destroy() {
            video.removeEventListener('ddpdecoderchange', mount);
            clear();
        }
        player.on('destroy', destroy);
        return destroy;
    }
    window.DandanVideoSubtitles = { bind: bind, preferredPage: preferredPage };
})();
