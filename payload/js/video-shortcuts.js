(function (global) {
    'use strict';
    var bindings = new WeakMap();

    function bindPlayer(player) {
        if (!player || !player.container || !player.video) return { destroy: function () {} };
        if (bindings.has(player)) return bindings.get(player);
        var document = global.document;
        var container = player.container;
        var destroyed = false;
        var returnFocus = null;
        var removers = [];
        var dialog = document.createElement('dialog');
        dialog.className = 'dplayer-shortcuts-dialog';
        dialog.setAttribute('aria-label', '快捷键');
        dialog.innerHTML = '<header><h2>快捷键</h2><button type="button" data-shortcuts-close aria-label="关闭快捷键查询">关闭</button></header>' +
            '<p>空格和方向键请先点击播放器再使用。</p>' +
            '<table><thead><tr><th scope="col">按键</th><th scope="col">功能</th></tr></thead><tbody>' +
            '<tr><td><kbd>Space</kbd></td><td>播放 / 暂停</td></tr>' +
            '<tr><td><kbd>←</kbd> <kbd>→</kbd></td><td>后退 / 前进 5 秒</td></tr>' +
            '<tr><td><kbd>↑</kbd> <kbd>↓</kbd></td><td>增大 / 减小音量 10%</td></tr>' +
            '<tr><td><kbd>J</kbd></td><td>跳过片头</td></tr>' +
            '<tr><td><kbd>F</kbd></td><td>进入 / 退出全屏</td></tr>' +
            '<tr><td><kbd>?</kbd></td><td>打开快捷键查询</td></tr>' +
            '<tr><td><kbd>Esc</kbd></td><td>关闭快捷键查询</td></tr>' +
            '</tbody></table><small>输入文字时不会触发 J、F 或 ?。查询打开时，播放快捷键暂不响应。</small>';
        container.appendChild(dialog);
        var close = dialog.querySelector('[data-shortcuts-close]');
        var contextEntry = document.createElement('button');
        contextEntry.type = 'button';
        contextEntry.className = 'dplayer-menu-item dplayer-shortcuts-menu';
        contextEntry.textContent = '快捷键';
        contextEntry.setAttribute('aria-haspopup', 'dialog');
        var contextMenu = container.querySelector('.dplayer-menu');
        if (contextMenu) contextMenu.insertBefore(contextEntry, contextMenu.firstChild);
        var settingEntry = document.createElement('button');
        settingEntry.type = 'button';
        settingEntry.className = 'dplayer-setting-item dplayer-shortcuts-setting';
        settingEntry.textContent = '快捷键';
        settingEntry.setAttribute('aria-haspopup', 'dialog');
        settingEntry.setAttribute('aria-keyshortcuts', '?');
        var settings = container.querySelector('.dplayer-setting-origin-panel');
        if (settings) settings.appendChild(settingEntry);
        var settingBox = container.querySelector('.dplayer-setting-box');
        var gear = container.querySelector('.dplayer-setting-icon');
        var previousMenuRoom = settingBox ? settingBox.style.getPropertyValue('--ddp-shortcuts-menu-room') : '';

        function listen(node, name, callback, options) {
            node.addEventListener(name, callback, options);
            removers.push(function () { node.removeEventListener(name, callback, options); });
        }
        function editable(node) {
            return node && (node.isContentEditable || (node.closest && node.closest('input, textarea, select, [role="textbox"], [role="combobox"]')));
        }
        function fitSettings() {
            if (destroyed || !settingBox || !settingBox.offsetParent) return;
            var style = global.getComputedStyle(settingBox);
            var room = settingBox.offsetParent.getBoundingClientRect().bottom - (parseFloat(style.bottom) || 0) -
                container.getBoundingClientRect().top - 12;
            if (style.boxSizing !== 'border-box') room -= (parseFloat(style.paddingTop) || 0) +
                (parseFloat(style.paddingBottom) || 0) + (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
            settingBox.style.setProperty('--ddp-shortcuts-menu-room', Math.max(60, Math.floor(room)) + 'px');
        }
        function resize() {
            if (settingBox && settingBox.classList.contains('dplayer-setting-box-open')) fitSettings();
        }
        function show(event) {
            if (event) event.stopPropagation();
            if (destroyed || dialog.open) return;
            var active = document.activeElement;
            returnFocus = active && container.contains(active) &&
                !active.closest('.dplayer-setting-box, .dplayer-menu') ? active :
                container.querySelector('.dplayer-skip-forward:not(:disabled)') || container.querySelector('.dplayer-setting-icon');
            if (player.contextmenu) player.contextmenu.hide();
            if (player.setting) player.setting.hide();
            dialog.showModal();
            close.focus({ preventScroll: true });
        }
        function hide() { if (dialog.open) dialog.close(); }
        function restoreFocus() {
            if (destroyed) return;
            if (player.controller) player.controller.show();
            if (returnFocus && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
            returnFocus = null;
        }
        function keys(event) {
            if (destroyed) return;
            if (dialog.open) {
                // Capture before document-level DPlayer and J/F listeners. Native
                // button activation and Tab still use their browser defaults.
                event.stopPropagation();
                if (event.key === 'Escape') { event.preventDefault(); hide(); }
                return;
            }
            if (event.key !== '?' || event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229 ||
                event.ctrlKey || event.altKey || event.metaKey || editable(event.target) || editable(document.activeElement) || document.hidden) return;
            event.preventDefault();
            event.stopPropagation();
            show();
        }
        function destroy() {
            if (destroyed) return;
            destroyed = true;
            removers.forEach(function (remove) { remove(); });
            hide();
            dialog.remove(); contextEntry.remove(); settingEntry.remove();
            if (settingBox) {
                if (previousMenuRoom) settingBox.style.setProperty('--ddp-shortcuts-menu-room', previousMenuRoom);
                else settingBox.style.removeProperty('--ddp-shortcuts-menu-room');
            }
            returnFocus = null;
            bindings.delete(player);
        }
        var controller = { destroy: destroy };
        bindings.set(player, controller);
        listen(contextEntry, 'click', show);
        listen(settingEntry, 'click', show);
        if (gear) listen(gear, 'click', fitSettings, true);
        [contextEntry, settingEntry].forEach(function (entry) {
            listen(entry, 'keydown', function (event) {
                if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
            });
        });
        listen(close, 'click', hide);
        listen(dialog, 'close', restoreFocus);
        listen(dialog, 'cancel', function (event) { event.preventDefault(); hide(); });
        listen(dialog, 'contextmenu', function (event) { event.stopPropagation(); });
        listen(dialog, 'touchstart', function (event) { event.stopPropagation(); }, { passive: true });
        listen(global, 'keydown', keys, true);
        listen(global, 'pagehide', destroy);
        listen(global, 'resize', resize);
        if (typeof player.on === 'function') { player.on('destroy', destroy); player.on('resize', resize); }
        return controller;
    }
    global.DandanVideoShortcuts = { bindPlayer: bindPlayer };
})(window);
