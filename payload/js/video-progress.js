(function (global) {
    'use strict';
    var document = global.document;
    var prefix = 'dandanplay.progress.v1:';
    var bindings = new WeakMap();
    var tab = String(Date.now()) + '-' + Math.random().toString(36).slice(2);
    var unavailable = false;
    function scope() {
        var user = document.querySelector('.app-nav__user');
        return encodeURIComponent(global.location.pathname.replace(/[^/]*$/, '') + '|' + (user ? user.textContent.trim() : 'anonymous')) + ':';
    }
    function key(id) { return prefix + scope() + encodeURIComponent(id); }
    function clean(record, id) {
        if (!record || record.version !== 1 || record.id !== String(id) || !Number.isFinite(record.position) ||
            !Number.isFinite(record.duration) || record.duration <= 0 || record.position < 0 ||
            record.position > record.duration || !Number.isFinite(record.updatedAt) || record.updatedAt <= 0) return null;
        return { version: 1, id: String(id), position: record.position, duration: record.duration,
            updatedAt: record.updatedAt, ended: record.ended === true, title: String(record.title || '视频').slice(0, 240), tab: String(record.tab || '') };
    }
    function read(id) {
        try { return clean(JSON.parse(global.localStorage.getItem(key(id))), id); }
        catch (error) { return null; }
    }
    function entries() {
        var result = [], start = prefix + scope();
        try {
            for (var i = 0; i < global.localStorage.length; i++) {
                var name = global.localStorage.key(i);
                if (!name || name.indexOf(start) !== 0) continue;
                try { var id = decodeURIComponent(name.slice(start.length)); var value = read(id); if (value) result.push(value); } catch (error) {}
            }
        } catch (error) { unavailable = true; }
        return result.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    }
    function write(record) {
        try {
            global.localStorage.setItem(key(record.id), JSON.stringify(record));
            unavailable = false;
            entries().slice(300).forEach(function (old) { global.localStorage.removeItem(key(old.id)); });
            return true;
        } catch (error) { unavailable = true; return false; }
    }
    function time(seconds) {
        seconds = Math.max(0, Math.floor(Number(seconds) || 0));
        var h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = seconds % 60;
        return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
    }
    function node(tag, className, text) {
        var el = document.createElement(tag); el.className = className || '';
        if (text) el.textContent = text; return el;
    }
    function button(text) { var el = node('button', '', text); el.type = 'button'; return el; }
    function bindPlayer(player, options) {
        options = options || {};
        if (!player || !player.video || !options.id) return null;
        if (bindings.has(player)) return bindings.get(player);
        var id = String(options.id), video = player.video, record = read(id);
        var active = false, loading = false, seekingResume = false, destroyed = false, pending = null, conflict = false;
        var position = null, duration = 0, ended = false;
        var seen = record ? record.updatedAt : 0, removers = [];
        var titleNode = document.querySelector('.video-console-heading');
        var title = (titleNode ? titleNode.textContent : document.title).replace(/NOW PLAYING \/ LOCAL MEDIA/g, '').replace(/\s+/g, ' ').trim().slice(0, 240);
        var panel = node('section', 'video-progress'); panel.setAttribute('aria-label', '本机播放进度');
        var label = panel.appendChild(node('span', 'video-progress__status'));
        label.setAttribute('role', 'status'); label.setAttribute('aria-live', 'polite');
        var actions = panel.appendChild(node('div', 'video-progress__actions'));
        var resume = actions.appendChild(button('继续播放')), restart = actions.appendChild(button('从头播放'));
        var take = actions.appendChild(button('以此处进度继续记录')); take.hidden = true;
        var host = document.querySelector('.player-main');
        var sidebar = document.querySelector('.player-sidebar');
        if (sidebar) sidebar.insertBefore(panel, sidebar.firstChild);
        else if (host && host.parentNode) host.parentNode.insertBefore(panel, host.nextSibling);
        else player.container.appendChild(panel);
        function listen(target, type, fn) { target.addEventListener(type, fn); removers.push(function () { target.removeEventListener(type, fn); }); }
        function render() {
            if (conflict) label.textContent = '另一标签页更新了进度，已暂停此页记录。';
            else if (unavailable) label.textContent = '浏览器无法保存进度（可能禁用存储或空间不足）。';
            else if (pending !== null) label.textContent = '正在等待媒体就绪以定位到 ' + time(pending) + '…';
            else if (record) label.textContent = (record.ended ? '本机已播完 · ' : '本机上次看到 ') + time(record.position) + ' / ' + time(record.duration);
            else label.textContent = '播放进度仅保存在此浏览器、此站点，不跨设备同步。';
            resume.hidden = conflict || !record || record.ended || record.position < 1;
            restart.hidden = conflict || !record;
            resume.disabled = restart.disabled = seekingResume;
            take.hidden = !conflict;
        }
        function valid() { return video.readyState >= 1 && Number.isFinite(video.duration) && video.duration > 0 && Number.isFinite(video.currentTime) && !video.error; }
        function remember() {
            if (!active || loading || seekingResume || pending !== null || conflict || !valid() || video.readyState < 2 || video.seeking) return;
            if (video.currentTime <= 0 && !video.ended) return;
            position = Math.min(video.currentTime, video.duration);
            duration = video.duration;
            ended = video.ended === true;
        }
        function saveOnExit() {
            remember();
            if (destroyed || position === null || conflict || pending !== null || seekingResume) return;
            var latest = read(id);
            if (latest && latest.tab !== tab && latest.updatedAt > seen) { conflict = true; render(); return; }
            var next = { version: 1, id: id, title: title || '视频', position: position, duration: duration,
                ended: ended, updatedAt: Math.max(Date.now(), seen + 1), tab: tab };
            if (write(next)) { record = next; seen = next.updatedAt; }
        }
        function play() {
            try { var promise = player.play ? player.play() : video.play(); if (promise && promise.catch) promise.catch(function () { label.textContent = '已定位，请点击播放器继续播放。'; }); }
            catch (error) { label.textContent = '已定位，请点击播放器继续播放。'; }
        }
        function software() { return video.ddpSoftwareDecoder && video.ddpSoftwareDecoder.isActive(); }
        function landed() {
            if (!seekingResume || video.seeking) return;
            seekingResume = false; pending = null; loading = false; active = true;
            remember(); render();
            if (video.paused) play();
        }
        function restore() {
            if (pending === null || seekingResume || !valid()) return;
            // libmedia cannot seek and start its output pipelines concurrently.
            // The first decoded frame AND an advancing media clock confirm startup.
            if (software() && (video.readyState < 2 || video.currentTime <= 0)) return;
            var target = Math.min(pending, Math.max(0, video.duration - 0.1));
            seekingResume = true;
            if (Math.abs(video.currentTime - target) < 0.05) { landed(); return; }
            try { player.seek(target); }
            catch (error) {
                pending = null; seekingResume = false; render();
                label.textContent = '暂时无法定位，请等待视频加载后重试。';
            }
        }
        function request(position) {
            conflict = false; var latest = read(id); if (latest) seen = latest.updatedAt;
            pending = position; render();
            if (software() && video.paused && (video.readyState < 2 || video.currentTime <= 0)) play();
            restore();
        }
        listen(resume, 'click', function () { request(record.position); });
        listen(restart, 'click', function () { request(0); });
        listen(take, 'click', function () { var latest = read(id); seen = latest ? latest.updatedAt : seen; conflict = false; active = true; remember(); render(); });
        listen(video, 'playing', function () { loading = false; if (pending !== null) restore(); else { active = true; render(); } });
        listen(video, 'timeupdate', function () { restore(); remember(); });
        listen(video, 'pause', remember);
        listen(video, 'seeked', function () { landed(); remember(); });
        listen(video, 'ended', function () { active = true; remember(); });
        listen(video, 'loadstart', function () { loading = true; });
        listen(video, 'emptied', function () { loading = true; });
        listen(video, 'loadedmetadata', function () { if (!active) loading = false; restore(); });
        listen(video, 'canplay', restore);
        listen(video, 'error', function () { if (pending !== null) { pending = null; seekingResume = false; render(); label.textContent = '视频加载失败，原来的进度仍保留。'; } });
        // Run before decoder teardown replaces the facade with an empty native video.
        global.addEventListener('pagehide', saveOnExit, true);
        listen(global, 'storage', function (event) {
            if (event.key !== key(id)) return;
            var latest = read(id);
            if (active && latest && latest.tab !== tab && latest.updatedAt > seen) conflict = true;
            else if (!active) { record = latest; seen = latest ? latest.updatedAt : 0; }
            render();
        });
        function destroy() { if (destroyed) return; destroyed = true; global.removeEventListener('pagehide', saveOnExit, true); removers.forEach(function (fn) { fn(); }); panel.remove(); bindings.delete(player); }
        if (player.on) player.on('destroy', destroy);
        var controller = { destroy: destroy }; bindings.set(player, controller);
        render();
        var params = new URL(global.location.href).searchParams;
        if (params.get('resume') === '1' && record && !record.ended && record.position >= 1) request(record.position);
        return controller;
    }
    function installHistory() {
        if (!/\/(?:index|bangumi|filelist|video)\.html$/.test(global.location.pathname)) return;
        var nav = document.querySelector('.app-nav__end'); if (!nav || document.getElementById('localProgressButton')) return;
        var open = button('本机进度'); open.id = 'localProgressButton'; open.className = 'local-progress-open';
        nav.insertBefore(open, nav.firstChild);
        var dialog = node('dialog', 'local-progress-dialog'); dialog.setAttribute('aria-label', '本机播放进度');
        var head = dialog.appendChild(node('div', 'local-progress-head'));
        head.appendChild(node('h2', '', '本机播放进度'));
        var close = head.appendChild(button('关闭'));
        dialog.appendChild(node('p', 'local-progress-hint', '仅此浏览器与站点保存，最多 300 个视频。清除浏览器数据会移除记录；不会同步到其他设备。'));
        var list = dialog.appendChild(node('div', 'local-progress-list')); document.body.appendChild(dialog);
        function refresh() {
            list.textContent = ''; var saved = entries();
            if (!saved.length) list.appendChild(node('p', '', unavailable ? '当前浏览器无法读取进度。' : '还没有记录。离开播放页时会保存观看位置。'));
            saved.forEach(function (record) {
                var row = list.appendChild(node('a', 'local-progress-row'));
                row.href = 'video.html?id=' + encodeURIComponent(record.id) + (record.ended ? '' : '&resume=1');
                row.appendChild(node('strong', '', record.title));
                row.appendChild(node('span', '', (record.ended ? '已播完 · ' : '继续 · ') + time(record.position) + ' / ' + time(record.duration)));
                row.appendChild(node('small', '', new Date(record.updatedAt).toLocaleString()));
            });
        }
        open.addEventListener('click', function () { refresh(); if (!dialog.open) dialog.showModal(); });
        close.addEventListener('click', function () { dialog.close(); });
        dialog.addEventListener('click', function (event) { if (event.target === dialog) { var rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
        dialog.addEventListener('close', function () { open.focus(); });
        global.addEventListener('storage', function () { if (dialog.open) refresh(); });
    }
    global.DandanProgress = { bindPlayer: bindPlayer, read: read, entries: entries, formatTime: time };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installHistory, { once: true }); else installHistory();
})(window);
