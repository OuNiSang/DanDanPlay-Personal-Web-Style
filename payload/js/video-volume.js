(function (global) {
    'use strict';
    var bindings = new WeakMap();

    function bindPlayer(player) {
        if (!player || !player.video || !player.container || typeof player.volume !== 'function') return { destroy: function () {} };
        if (bindings.has(player)) return bindings.get(player);
        var button = player.container.querySelector('.dplayer-volume-icon');
        if (!button) return { destroy: function () {} };
        var video = player.video;
        var lastPositive = video.volume > 0 ? video.volume : 0.5;
        var oldLabel = button.getAttribute('aria-label');
        var destroyed = false;

        function sync() {
            if (destroyed) return;
            if (Number.isFinite(video.volume) && video.volume > 0) lastPositive = video.volume;
            button.setAttribute('aria-label', video.muted || video.volume === 0 ? '恢复声音' : '静音');
        }

        function restoreZeroVolume(event) {
            if (destroyed || video.volume !== 0) return;
            // A user activation at zero volume means restore sound, not toggle
            // the separate muted flag while leaving the output level at zero.
            event.preventDefault();
            event.stopImmediatePropagation();
            player.volume(lastPositive);
            sync();
            if (player.controller && typeof player.controller.setAutoHide === 'function') player.controller.setAutoHide();
        }

        function onKeydown(event) {
            // Keep native button activation. DPlayer's global Space shortcut
            // otherwise toggles playback and prevents that native click.
            if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
        }

        function onPageHide(event) {
            // These UI-only listeners may stay with a cached document.
            if (!event.persisted) destroy();
        }

        function destroy() {
            if (destroyed) return;
            destroyed = true;
            button.removeEventListener('click', restoreZeroVolume, true);
            button.removeEventListener('keydown', onKeydown);
            video.removeEventListener('volumechange', sync);
            global.removeEventListener('pagehide', onPageHide);
            if (oldLabel === null) button.removeAttribute('aria-label');
            else button.setAttribute('aria-label', oldLabel);
            bindings.delete(player);
        }

        var controller = { destroy: destroy };
        bindings.set(player, controller);
        button.addEventListener('click', restoreZeroVolume, true);
        button.addEventListener('keydown', onKeydown);
        video.addEventListener('volumechange', sync);
        global.addEventListener('pagehide', onPageHide);
        if (typeof player.on === 'function') player.on('destroy', destroy);
        sync();
        return controller;
    }

    var api = { bindPlayer: bindPlayer };
    global.DandanVideoVolume = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
