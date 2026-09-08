(function () {
    'use strict';

    if (!window.matchMedia('(min-width: 769px)').matches) return;
    if (window.Web1UiVersion && !window.Web1UiVersion.isV3Desktop()) return;

    var body = document.querySelector('.video-page');
    var status = document.getElementById('videoConsoleStatus');
    var statusTitle = status ? status.querySelector('[data-video-status-title]') : null;
    var statusDetail = status ? status.querySelector('[data-video-status-detail]') : null;
    var boundPlayer = null;
    var readyOnce = false;
    var destroyed = false;

    function revealV3Chrome() {
        document.querySelectorAll('[data-video-v3-only]').forEach(function (node) {
            node.hidden = false;
        });
    }

    function setState(state, title, detail) {
        if (!body || destroyed) return;
        body.setAttribute('data-video-state', state);
        if (statusTitle && title) statusTitle.textContent = title;
        if (statusDetail && detail) statusDetail.textContent = detail;
        if (status) {
            status.setAttribute('aria-live', state === 'error' ? 'assertive' : 'polite');
            status.setAttribute('aria-label', title || '播放器状态');
        }
    }

    function markReady() {
        readyOnce = true;
        setState('ready', '媒体已就绪', 'PLAYBACK READY');
    }

    function bindPlayer(player, videoUrl) {
        if (!player || boundPlayer === player || destroyed) return;
        boundPlayer = player;
        var source = String(videoUrl || '').trim();
        if (!source) {
            setState('empty', '没有可播放的媒体', 'EMPTY MEDIA SOURCE');
            return;
        }

        setState('loading', '正在装载媒体', 'READING LOCAL MEDIA');
        if (typeof player.on !== 'function') return;

        player.on('loadedmetadata', markReady);
        player.on('canplay', markReady);
        player.on('playing', markReady);
        player.on('waiting', function () {
            setState('buffering', readyOnce ? '缓冲中' : '正在装载媒体', readyOnce ? 'BUFFERING STREAM' : 'READING LOCAL MEDIA');
        });
        player.on('error', function () {
            setState('error', '无法打开媒体文件', 'CHECK FILE ACCESS OR FORMAT');
        });
    }

    function destroy() {
        destroyed = true;
        boundPlayer = null;
    }

    revealV3Chrome();
    if (body && !body.hasAttribute('data-video-state')) {
        setState('loading', '正在装载媒体', 'READING LOCAL MEDIA');
    }

    window.addEventListener('pagehide', destroy, { once: true });
    window.DandanVideoV3 = {
        bindPlayer: bindPlayer,
        setState: setState,
        destroy: destroy
    };
})();
