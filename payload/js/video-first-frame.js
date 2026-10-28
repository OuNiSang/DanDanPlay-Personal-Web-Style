(function (global) {
    'use strict';

    var bindings = new WeakMap();

    function bindPlayer(player, notice) {
        if (!player || !player.video || !notice) return { destroy: function () {} };
        if (bindings.has(player)) return bindings.get(player);
        var video = player.video;
        var document = global.document;
        var title = notice.querySelector('[data-playback-title]');
        var detail = notice.querySelector('[data-playback-detail]');
        var retry = notice.querySelector('[data-playback-retry]');
        var source = notice.querySelector('[data-playback-source]');
        var destroyed = false;
        var ready = false;
        var failed = false;
        var started = false;
        var recovery = false;
        var resumeOnly = false;
        var elapsed = 0;
        var playingAt = null;
        var initialTime = Number(video.currentTime) || 0;
        var lastClock = now();
        var running = false;
        var timer = 0;
        var frameRequest = null;
        var generation = 0;
        var resumeAt = null;
        var awaitingRetryEmpty = false;
        var loadedData = video.readyState >= 2;
        var frameCallbacks = typeof video.requestVideoFrameCallback === 'function';

        function now() {
            return global.performance && global.performance.now ? global.performance.now() : Date.now();
        }

        function clearTimer() {
            global.clearTimeout(timer);
            timer = 0;
        }

        function cancelFrame() {
            if (frameRequest !== null && typeof video.cancelVideoFrameCallback === 'function') {
                try { video.cancelVideoFrameCallback(frameRequest); } catch (error) {}
            }
            frameRequest = null;
        }

        function syncClock() {
            var current = now();
            if (running) elapsed += Math.max(0, current - lastClock);
            lastClock = current;
            running = started && !ready && !failed && !destroyed && !video.paused && !video.seeking && !(document && document.hidden);
        }

        function show(state, heading, explanation, canRetry, canResume) {
            if (destroyed) return;
            if (title) title.textContent = heading;
            if (detail) detail.textContent = explanation;
            recovery = recovery || canRetry;
            resumeOnly = Boolean(canResume);
            if (retry) {
                retry.hidden = !recovery;
                retry.textContent = resumeOnly ? '继续播放' : '重试播放';
            }
            notice.setAttribute('data-playback-state', state);
            notice.hidden = false;
        }

        function markReady() {
            if (destroyed || video.error) return;
            ready = true;
            failed = false;
            running = false;
            clearTimer();
            cancelFrame();
            notice.hidden = true;
        }

        function probeFrame() {
            if (destroyed || video.error) return false;
            var counted = false;
            if (typeof video.getVideoPlaybackQuality === 'function') {
                counted = true;
                try {
                    var quality = video.getVideoPlaybackQuality();
                    if (quality && Number(quality.totalVideoFrames) - Number(quality.droppedVideoFrames || 0) > 0) {
                        markReady();
                        return true;
                    }
                } catch (error) {}
            }
            if (typeof video.webkitDecodedFrameCount === 'number') {
                counted = true;
                if (video.webkitDecodedFrameCount > 0) { markReady(); return true; }
            }
            // Dimensions are only a conservative fallback on older engines.
            // Metadata/canplay and a moving audio clock never prove a frame.
            if (!frameCallbacks && !counted && loadedData && video.videoWidth > 0 && video.videoHeight > 0) {
                markReady();
                return true;
            }
            return false;
        }

        function armFrame() {
            if (!frameCallbacks || destroyed || ready || frameRequest !== null) return;
            var attempt = generation;
            try {
                frameRequest = video.requestVideoFrameCallback(function () {
                    if (destroyed || attempt !== generation) return;
                    frameRequest = null;
                    markReady();
                });
            } catch (error) {
                frameCallbacks = false;
                frameRequest = null;
            }
        }

        function fail(state, heading, explanation) {
            if (destroyed || ready) return;
            syncClock();
            failed = true;
            running = false;
            clearTimer();
            show(state, heading, explanation, true);
        }

        function tick() {
            clearTimer();
            syncClock();
            if (ready || destroyed || probeFrame() || !running) return;
            var deadline = playingAt === null ? 12000 : Math.min(12000, playingAt + 8000);
            if (elapsed >= deadline) {
                if (Number(video.currentTime) > initialTime + 0.1) {
                    fail('frame', '暂时没有视频画面', '播放进度已开始，但尚未取得视频画面。可以重试或打开原始媒体。');
                } else {
                    fail('waiting', '视频仍在等待画面', '尚未取得视频画面。可以继续等待、重试或打开原始媒体。');
                }
                return;
            }
            timer = global.setTimeout(tick, Math.min(250, deadline - elapsed));
        }

        function restoreTime() {
            if (resumeAt === null || video.readyState < 1) return;
            var target = resumeAt;
            if (Number.isFinite(video.duration) && video.duration > 0) target = Math.min(target, video.duration);
            try { video.currentTime = target; resumeAt = null; } catch (error) {}
        }

        function start(event) {
            if (destroyed || ready || failed) return;
            syncClock();
            started = true;
            if (event.type === 'playing' && playingAt === null) playingAt = elapsed;
            if ((event.type === 'waiting' || event.type === 'stalled') && !probeFrame()) {
                if (video.paused) showPaused();
                else show('buffering', '正在缓冲视频', '正在等待视频画面；仍未出现画面时可以重试或打开原始视频。', false);
            }
            armFrame();
            tick();
        }

        function showPaused() {
            show('paused', '播放尚未开始', '播放器当前已暂停。点击继续播放会保留已读取的数据和播放位置。', true, true);
        }

        function paused() {
            if (!destroyed && !ready && !failed && !video.error && (started || !notice.hidden) && !probeFrame()) showPaused();
            tick();
        }

        function inspect(event) {
            if (destroyed) return;
            if (event.type === 'loadedmetadata') awaitingRetryEmpty = false;
            if (event.type === 'loadeddata') loadedData = true;
            restoreTime();
            probeFrame();
            tick();
        }

        function resetAttempt(savedTime) {
            generation += 1;
            clearTimer();
            cancelFrame();
            ready = failed = started = running = recovery = resumeOnly = false;
            elapsed = 0;
            playingAt = null;
            lastClock = now();
            initialTime = savedTime || 0;
            resumeAt = savedTime > 0 ? savedTime : null;
            awaitingRetryEmpty = false;
            loadedData = false;
            notice.hidden = true;
        }

        function emptied() {
            if (awaitingRetryEmpty) {
                awaitingRetryEmpty = false;
                loadedData = false;
                cancelFrame();
                armFrame();
                return;
            }
            resetAttempt(resumeAt);
            armFrame();
        }

        function seeking() {
            if (destroyed || ready) return;
            var recoveryVisible = !notice.hidden;
            var resumeWithoutReload = resumeOnly;
            resetAttempt(null);
            if (recoveryVisible) show('retry', '等待定位后的画面', '正在定位播放位置。若播放未开始，请点击播放器；仍无画面时可以重试或打开原始媒体。', true, resumeWithoutReload);
            initialTime = Number(video.currentTime) || 0;
            loadedData = video.readyState >= 2;
            started = true;
            armFrame();
            tick();
        }

        function seeked() {
            if (destroyed || ready) return;
            if (!video.paused) start({ type: 'playing' });
            else inspect({ type: 'seeked' });
        }

        function mediaError() {
            cancelFrame();
            ready = false;
            var code = video.error && video.error.code;
            if (code === 2) fail('network', '视频网络连接失败', '视频数据未能完整读取，请检查网络后重试或打开原始媒体。');
            else if (code === 3) fail('decode', '当前浏览器无法解码视频', '视频已读取，但解码失败。可以重试或用支持此格式的播放器打开原始媒体。');
            else if (code === 4) fail('unsupported', '当前浏览器不支持此视频', '视频格式或来源无法在当前浏览器播放，可以重试或打开原始媒体。');
            else fail('error', '视频播放已中止', '请重新点击播放，或重试、打开原始媒体。');
        }

        function requestPlay() {
            var attempt = generation;
            try {
                var result = player.play();
                if (result && typeof result.catch === 'function') result.catch(function () {
                    if (!destroyed && attempt === generation) fail('play', '播放尚未开始', '浏览器未能开始播放，请再次点击播放或打开原始媒体。');
                });
            } catch (error) {
                fail('play', '播放尚未开始', '浏览器未能开始播放，请再次点击播放或打开原始媒体。');
            }
        }

        function reloadMedia(shouldPlay) {
            if (destroyed) return;
            resetAttempt(Number(video.currentTime) || resumeAt || 0);
            awaitingRetryEmpty = true;
            // Recovery actions survive waiting/stalled and swallowed play rejections.
            show('retry', '等待播放画面', shouldPlay
                ? '正在重新读取视频。仍无画面时可以再次重试或打开原始媒体。'
                : '正在重新读取视频。读取完成后可以继续播放，或打开原始媒体。', true, !shouldPlay);
            try {
                video.load();
                armFrame();
                if (shouldPlay) requestPlay();
            } catch (error) {
                awaitingRetryEmpty = false;
                fail('play', '播放尚未开始', '浏览器未能读取视频，请重试或打开原始媒体。');
            }
        }

        function retryPlayback() {
            if (destroyed) return;
            if (resumeOnly) {
                failed = false;
                show('retry', '等待播放画面', '正在尝试继续播放。仍无画面时可以重试或打开原始媒体。', true);
                requestPlay();
            } else reloadMedia(true);
        }

        function pauseForSource() {
            try { if (typeof player.pause === 'function') player.pause(); } catch (error) {}
        }

        var videoEvents = {
            play: start, playing: start, waiting: start, stalled: start,
            pause: paused, ended: tick, loadedmetadata: inspect, loadeddata: inspect,
            canplay: inspect, durationchange: inspect, timeupdate: inspect,
            seeking: seeking, seeked: seeked, emptied: emptied, error: mediaError
        };
        function destroy() {
            if (destroyed) return;
            destroyed = true;
            generation += 1;
            clearTimer();
            cancelFrame();
            Object.keys(videoEvents).forEach(function (name) { video.removeEventListener(name, videoEvents[name]); });
            if (document) document.removeEventListener('visibilitychange', tick);
            global.removeEventListener('pagehide', destroy);
            if (retry) retry.removeEventListener('click', retryPlayback);
            if (source) source.removeEventListener('click', pauseForSource);
            bindings.delete(player);
        }
        var controller = { destroy: destroy, retryLoad: function () { reloadMedia(false); } };
        bindings.set(player, controller);
        Object.keys(videoEvents).forEach(function (name) { video.addEventListener(name, videoEvents[name]); });
        if (document) document.addEventListener('visibilitychange', tick);
        global.addEventListener('pagehide', destroy);
        if (retry) retry.addEventListener('click', retryPlayback);
        if (source) source.addEventListener('click', pauseForSource);
        if (typeof player.on === 'function') player.on('destroy', destroy);
        armFrame();
        if (video.error) mediaError();
        else if (!probeFrame() && !video.paused) start({ type: 'playing' });
        return controller;
    }

    var api = { bindPlayer: bindPlayer };
    global.DandanVideoFirstFrame = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
