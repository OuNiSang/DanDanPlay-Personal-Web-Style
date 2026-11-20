(function (global) {
    'use strict';

    var bindings = new WeakMap();
    var preferenceKey = 'dandanplay.auto-next.v1';
    var resumeKey = 'dandanplay.auto-next.resume.v1';
    var delay = 5000;

    function read(storage, key) {
        try { return global[storage].getItem(key); } catch (error) { return null; }
    }
    function write(storage, key, value) {
        try { global[storage].setItem(key, value); } catch (error) {}
    }

    function bindPlayer(player) {
        if (!player || !player.video || !player.container) return { destroy: function () {} };
        if (bindings.has(player)) return bindings.get(player);
        var document = global.document;
        var video = player.video;
        var container = player.container;
        var enabled = read('localStorage', preferenceKey) !== 'off';
        var state = 'idle';
        var timer = null;
        var deadline = 0;
        var destination = null;
        var destroyed = false;
        var removers = [];

        function element(tag, className, text) {
            var node = document.createElement(tag);
            node.className = className || '';
            if (text) node.textContent = text;
            return node;
        }
        function button(className, text) {
            var node = element('button', className, text);
            node.type = 'button';
            return node;
        }
        function listen(node, name, callback, options) {
            node.addEventListener(name, callback, options);
            removers.push(function () { node.removeEventListener(name, callback, options); });
        }

        var setting = button('dplayer-setting-item dplayer-auto-next-setting');
        setting.setAttribute('role', 'switch');
        setting.setAttribute('aria-label', '自动连播');
        setting.title = '播放结束后等待 5 秒，自动播放下一集';
        setting.appendChild(element('span', 'dplayer-label', '自动连播'));
        var settingValue = setting.appendChild(element('span', 'dplayer-auto-next-value'));
        settingValue.setAttribute('aria-hidden', 'true');
        var menu = container.querySelector('.dplayer-setting-origin-panel');
        if (menu) menu.appendChild(setting);

        var panel = element('section', 'dplayer-auto-next');
        panel.hidden = true;
        panel.setAttribute('aria-label', '自动连播提示');
        var countdown = panel.appendChild(element('strong'));
        countdown.setAttribute('data-auto-next-countdown', '');
        countdown.setAttribute('role', 'status');
        countdown.setAttribute('aria-live', 'polite');
        countdown.setAttribute('aria-atomic', 'true');
        var title = panel.appendChild(element('span', 'dplayer-auto-next-title'));
        var actions = panel.appendChild(element('div', 'dplayer-auto-next-actions'));
        var play = actions.appendChild(element('a', 'dplayer-auto-next-play', '立即播放'));
        var cancel = actions.appendChild(button('', '取消本次'));
        cancel.setAttribute('data-auto-next-cancel', '');
        var off = actions.appendChild(button('dplayer-auto-next-off', '关闭连播'));
        container.appendChild(panel);

        function clearTimer() {
            if (timer !== null) global.clearTimeout(timer);
            timer = null;
        }
        function stop(nextState) {
            clearTimer();
            panel.hidden = true;
            state = nextState;
        }
        function syncSetting() {
            setting.setAttribute('aria-checked', String(enabled));
            settingValue.textContent = enabled ? '开启' : '关闭';
        }
        function setEnabled(value) {
            enabled = value;
            write('localStorage', preferenceKey, enabled ? 'on' : 'off');
            syncSetting();
            if (!enabled && state === 'waiting') stop('cancelled');
        }
        function nextEpisode() {
            var controls = global.DandanVideoControls;
            var next = controls && controls.getAdjacentEpisodes().next;
            if (!next || !next.matches('a[href]') || next.getAttribute('aria-disabled') === 'true') return null;
            try {
                var url = new global.URL(next.href, global.location.href);
                var current = new global.URL(global.location.href);
                if (url.origin !== current.origin || !/\/video\.html$/i.test(url.pathname) ||
                    (url.pathname === current.pathname && url.search === current.search)) return null;
                return { link: next, url: url };
            } catch (error) { return null; }
        }
        function eligible() {
            return !destroyed && enabled && video.ended && !video.error &&
                video.readyState >= 1 && Number.isFinite(video.duration) && video.duration > 0 &&
                !video.loop && !(player.options && player.options.loop) && !(player.setting && player.setting.loop);
        }
        function sameDestination() {
            var next = nextEpisode();
            return next && destination && next.url.href === destination.href;
        }

        function navigate() {
            if (state !== 'waiting') return;
            if (!eligible() || !sameDestination()) { stop('cancelled'); return; }
            clearTimer();
            state = 'committing';
            countdown.textContent = '正在进入下一集';
            cancel.disabled = off.disabled = true;
            var context = {
                destination: destination.href, originElement: play, sourceKind: 'surface',
                artworkUrl: video.poster || '', backdropUrl: video.poster || '', title: title.textContent,
                onCancel: function () {
                    try { global.sessionStorage.removeItem(resumeKey); } catch (error) {}
                    if (!destroyed) stop('cancelled');
                }
            };
            function commit(result) {
                if (destroyed || state !== 'committing') return;
                if (result && result.cancelled) { stop('cancelled'); return; }
                // Store autoplay only after the shared exit gate accepts navigation.
                write('sessionStorage', resumeKey, JSON.stringify({ href: destination.href, expires: Date.now() + 120000 }));
                try { global.location.assign(destination.href); }
                catch (error) {
                    try { global.sessionStorage.removeItem(resumeKey); } catch (storageError) {}
                    stop('cancelled');
                }
            }
            try {
                var exit = global.DdpRouteMorph;
                if (exit) Promise.resolve(exit.exit(context)).then(commit, function () { commit(); });
                else commit();
            } catch (error) { commit(); }
        }
        function tick() {
            if (state !== 'waiting') return;
            if (!eligible() || !sameDestination()) { stop('cancelled'); return; }
            var remaining = Math.max(0, deadline - global.performance.now());
            if (!remaining) { navigate(); return; }
            countdown.textContent = Math.ceil(remaining / 1000) + ' 秒后播放下一集';
            timer = global.setTimeout(tick, Math.min(1000, remaining));
        }
        function ended() {
            if (state !== 'idle' || !eligible()) return;
            var next = nextEpisode();
            if (!next) return;
            destination = next.url;
            var name = next.link.querySelector('strong');
            title.textContent = name ? name.textContent.trim() : '下一集';
            title.title = title.textContent;
            play.href = destination.href;
            cancel.disabled = off.disabled = false;
            state = 'waiting';
            deadline = global.performance.now() + delay;
            panel.hidden = false;
            tick();
        }
        function replay() { if (state !== 'committing' && !video.ended) stop('idle'); }
        function sourceChanged() { if (state !== 'committing') stop('idle'); }
        function cancelWait(event) { event.stopPropagation(); if (state === 'waiting') stop('cancelled'); }
        function toggle(event) { event.stopPropagation(); setEnabled(!enabled); }
        function turnOff(event) { event.stopPropagation(); setEnabled(false); }
        function keydown(event) {
            if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
            if (event.key === 'Escape' && state === 'waiting') { event.stopPropagation(); stop('cancelled'); }
        }
        function playClick(event) {
            if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey ||
                (play.target && play.target !== '_self')) { stop('cancelled'); return; }
            event.preventDefault();
            event.stopPropagation();
            navigate();
        }
        function otherNavigation(event) {
            if (state !== 'waiting' || event.defaultPrevented) return;
            var target = event.target;
            var link = target && target.closest && target.closest('a[href]');
            if (link && link !== play && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey &&
                (!link.target || link.target === '_self') && !link.hasAttribute('download') &&
                link.getAttribute('aria-disabled') !== 'true') stop('cancelled');
        }
        function storageChanged(event) {
            if (event.key !== preferenceKey && event.key !== null) return;
            enabled = read('localStorage', preferenceKey) !== 'off';
            syncSetting();
            if (!enabled && state === 'waiting') stop('cancelled');
        }
        function destroy() {
            if (destroyed) return;
            destroyed = true;
            clearTimer();
            removers.forEach(function (remove) { remove(); });
            panel.remove(); setting.remove();
            bindings.delete(player);
        }

        var controller = { destroy: destroy };
        bindings.set(player, controller);
        listen(video, 'ended', ended);
        ['play', 'playing', 'seeking', 'seeked'].forEach(function (name) { listen(video, name, replay); });
        ['emptied', 'loadstart', 'error'].forEach(function (name) { listen(video, name, sourceChanged); });
        listen(setting, 'click', toggle);
        listen(setting, 'keydown', keydown);
        listen(cancel, 'click', cancelWait);
        listen(off, 'click', turnOff);
        listen(play, 'click', playClick);
        listen(play, 'auxclick', cancelWait);
        listen(panel, 'keydown', keydown);
        listen(panel, 'touchstart', function (event) { event.stopPropagation(); }, { passive: true });
        listen(document, 'click', otherNavigation, true);
        listen(global, 'storage', storageChanged);
        listen(global, 'pagehide', destroy);
        if (typeof player.on === 'function') player.on('destroy', destroy);
        syncSetting();

        var resume = read('sessionStorage', resumeKey);
        if (resume) {
            try {
                global.sessionStorage.removeItem(resumeKey);
                var request = JSON.parse(resume);
                var target = new global.URL(request.href);
                var current = new global.URL(global.location.href);
                if (enabled && request.expires > Date.now() && target.origin === current.origin &&
                    target.pathname === current.pathname && target.search === current.search) {
                    // DPlayer absorbs play() rejection; the media promise preserves it.
                    Promise.resolve(video.play()).catch(function () {
                        if (!destroyed && typeof player.notice === 'function') player.notice('自动播放未开始，请点击播放继续');
                    });
                }
            } catch (error) {}
        }
        return controller;
    }

    global.DandanVideoAutoNext = { bindPlayer: bindPlayer };
})(window);
