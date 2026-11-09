// 弹幕外观设置管理
(function() {
    'use strict';
    
    // 默认弹幕设置
    const defaultDanmakuSettings = {
        fontSize: 25,
        fontFamily: '"Microsoft YaHei", SimHei, "Microsoft JhengHei", Arial, Helvetica, sans-serif',
        speed: 10, // 持续时间（秒）
        opacity: 1.0,
        textStrokeWidth: 0.5,
        textStrokeColor: '#000000',
        textShadowX: 1.0,
        textShadowY: 1.0,
        textShadowBlur: 0.5,
        textShadowColor: 'rgba(0, 0, 0, 0.5)',
        bold: false,
        displayArea: 100, // 显示区域百分比，默认100%全屏
        lineHeight: 0 // 行间距，默认0（无额外间距）
    };
    
    // 从localStorage加载设置
    function loadDanmakuSettings() {
        const savedSettings = localStorage.getItem('danmakuSettings');
        if (savedSettings) {
            try {
                return Object.assign({}, defaultDanmakuSettings, JSON.parse(savedSettings));
            } catch (e) {
                console.error('Failed to load danmaku settings:', e);
            }
        }
        return Object.assign({}, defaultDanmakuSettings);
    }
    
    function saveDanmakuSettings(settings) {
        try {
            localStorage.setItem('danmakuSettings', JSON.stringify(settings));
        } catch (e) {
            console.error('Failed to save danmaku settings:', e);
        }
    }
    
    function applyDanmakuStyles(settings) {
        const oldStyle = document.getElementById('dynamic-danmaku-style');
        if (oldStyle) {
            oldStyle.remove();
        }
        
        const style = document.createElement('style');
        style.id = 'dynamic-danmaku-style';
        
        const fontWeight = settings.bold ? 'bold' : 'normal';
        const lineHeight = settings.lineHeight || 0;
        
        style.textContent = `
            .dplayer-danmaku {
                font-size: ${settings.fontSize}px !important;
                font-family: ${settings.fontFamily} !important;
                height: ${settings.displayArea}% !important;
            }
            
            .dplayer-danmaku .dplayer-danmaku-item {
                font-weight: ${fontWeight} !important;
                opacity: ${settings.opacity} !important;
                -webkit-text-stroke: ${settings.textStrokeWidth}px ${settings.textStrokeColor} !important;
                text-stroke: ${settings.textStrokeWidth}px ${settings.textStrokeColor} !important;
                text-shadow: ${settings.textShadowX}px ${settings.textShadowY}px ${settings.textShadowBlur}px ${settings.textShadowColor} !important;
                margin-bottom: ${lineHeight}px !important;
                line-height: ${settings.fontSize + lineHeight}px !important;
            }
            
            .dplayer-danmaku .dplayer-danmaku-right.dplayer-danmaku-move {
                -webkit-animation: danmaku ${settings.speed}s linear !important;
                animation: danmaku ${settings.speed}s linear !important;
            }
            
            /* Mobile styles */
            .dplayer-mobile .dplayer-danmaku {
                font-size: ${Math.max(settings.fontSize - 5, 16)}px !important;
            }
            
            .dplayer.dplayer-arrow.dplayer-mobile .dplayer-danmaku {
                font-size: ${Math.max(settings.fontSize - 5, 16)}px !important;
            }
        `;
        
        document.head.appendChild(style);
    }
    
    // 初始化弹幕设置
    function initDanmakuSettings() {
        const settings = loadDanmakuSettings();
        applyDanmakuStyles(settings);
    }
    
    window.openDanmakuSettingsModal = function() {
        const modal = document.getElementById('danmakuSettingsModal');
        if (modal) {
            modal.style.display = 'block';
            // 加载当前设置到表单
            const settings = loadDanmakuSettings();
            document.getElementById('danmakuFontSize').value = settings.fontSize;
            document.getElementById('danmakuFontSizeValue').textContent = settings.fontSize;
            document.getElementById('danmakuFontFamily').value = settings.fontFamily;
            document.getElementById('danmakuSpeed').value = settings.speed;
            document.getElementById('danmakuSpeedValue').textContent = settings.speed;
            document.getElementById('danmakuOpacity').value = settings.opacity;
            document.getElementById('danmakuOpacityValue').textContent = Math.round(settings.opacity * 100);
            document.getElementById('danmakuTextStrokeWidth').value = settings.textStrokeWidth;
            document.getElementById('danmakuTextStrokeWidthValue').textContent = settings.textStrokeWidth;
            document.getElementById('danmakuTextStrokeColor').value = settings.textStrokeColor;
            document.getElementById('danmakuTextShadowX').value = settings.textShadowX;
            document.getElementById('danmakuTextShadowXValue').textContent = settings.textShadowX;
            document.getElementById('danmakuTextShadowY').value = settings.textShadowY;
            document.getElementById('danmakuTextShadowYValue').textContent = settings.textShadowY;
            document.getElementById('danmakuTextShadowBlur').value = settings.textShadowBlur;
            document.getElementById('danmakuTextShadowBlurValue').textContent = settings.textShadowBlur;
            document.getElementById('danmakuBold').checked = settings.bold;
            document.getElementById('danmakuDisplayArea').value = settings.displayArea;
            document.getElementById('danmakuDisplayAreaValue').textContent = settings.displayArea;
            document.getElementById('danmakuLineHeight').value = settings.lineHeight;
            document.getElementById('danmakuLineHeightValue').textContent = settings.lineHeight;
        }
    };
    
    // 关闭弹幕设置弹窗
    window.closeDanmakuSettingsModal = function() {
        const modal = document.getElementById('danmakuSettingsModal');
        if (modal) {
            modal.style.display = 'none';
        }
    };
    
    window.saveDanmakuSettings = function() {
        closeDanmakuSettingsModal();
    };
    
    // 重置为默认设置
    window.resetDanmakuSettings = function() {
        localStorage.removeItem('danmakuSettings');
        applyDanmakuStyles(defaultDanmakuSettings);
        
        document.getElementById('danmakuFontSize').value = defaultDanmakuSettings.fontSize;
        document.getElementById('danmakuFontSizeValue').textContent = defaultDanmakuSettings.fontSize;
        document.getElementById('danmakuFontFamily').value = defaultDanmakuSettings.fontFamily;
        document.getElementById('danmakuSpeed').value = defaultDanmakuSettings.speed;
        document.getElementById('danmakuSpeedValue').textContent = defaultDanmakuSettings.speed;
        document.getElementById('danmakuOpacity').value = defaultDanmakuSettings.opacity;
        document.getElementById('danmakuOpacityValue').textContent = Math.round(defaultDanmakuSettings.opacity * 100);
        document.getElementById('danmakuTextStrokeWidth').value = defaultDanmakuSettings.textStrokeWidth;
        document.getElementById('danmakuTextStrokeWidthValue').textContent = defaultDanmakuSettings.textStrokeWidth;
        document.getElementById('danmakuTextStrokeColor').value = defaultDanmakuSettings.textStrokeColor;
        document.getElementById('danmakuTextShadowX').value = defaultDanmakuSettings.textShadowX;
        document.getElementById('danmakuTextShadowXValue').textContent = defaultDanmakuSettings.textShadowX;
        document.getElementById('danmakuTextShadowY').value = defaultDanmakuSettings.textShadowY;
        document.getElementById('danmakuTextShadowYValue').textContent = defaultDanmakuSettings.textShadowY;
        document.getElementById('danmakuTextShadowBlur').value = defaultDanmakuSettings.textShadowBlur;
        document.getElementById('danmakuTextShadowBlurValue').textContent = defaultDanmakuSettings.textShadowBlur;
        document.getElementById('danmakuBold').checked = defaultDanmakuSettings.bold;
        document.getElementById('danmakuDisplayArea').value = defaultDanmakuSettings.displayArea;
        document.getElementById('danmakuDisplayAreaValue').textContent = defaultDanmakuSettings.displayArea;
        document.getElementById('danmakuLineHeight').value = defaultDanmakuSettings.lineHeight;
        document.getElementById('danmakuLineHeightValue').textContent = defaultDanmakuSettings.lineHeight;
    };
    
    window.updateDanmakuPreview = function(settingName, value) {
        const settings = loadDanmakuSettings();
        
        switch(settingName) {
            case 'fontSize':
                document.getElementById('danmakuFontSizeValue').textContent = value;
                settings.fontSize = parseInt(value);
                break;
            case 'speed':
                document.getElementById('danmakuSpeedValue').textContent = value;
                settings.speed = parseFloat(value);
                break;
            case 'opacity':
                settings.opacity = parseFloat(value);
                settings.textShadowColor = `rgba(0, 0, 0, ${parseFloat(value)})`;
                break;
            case 'textStrokeWidth':
                document.getElementById('danmakuTextStrokeWidthValue').textContent = value;
                settings.textStrokeWidth = parseFloat(value);
                break;
            case 'textShadowX':
                document.getElementById('danmakuTextShadowXValue').textContent = value;
                settings.textShadowX = parseFloat(value);
                break;
            case 'textShadowY':
                document.getElementById('danmakuTextShadowYValue').textContent = value;
                settings.textShadowY = parseFloat(value);
                break;
            case 'textShadowBlur':
                document.getElementById('danmakuTextShadowBlurValue').textContent = value;
                settings.textShadowBlur = parseFloat(value);
                break;
            case 'displayArea':
                document.getElementById('danmakuDisplayAreaValue').textContent = value;
                settings.displayArea = parseInt(value);
                break;
            case 'lineHeight':
                document.getElementById('danmakuLineHeightValue').textContent = value;
                settings.lineHeight = parseInt(value);
                break;
            case 'fontFamily':
                settings.fontFamily = value;
                break;
            case 'textStrokeColor':
                settings.textStrokeColor = value;
                break;
            case 'bold':
                settings.bold = value;
                break;
        }
        
        saveDanmakuSettings(settings);
        applyDanmakuStyles(settings);
    };
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initDanmakuSettings);
    } else {
        initDanmakuSettings();
    }
})();

// Small transport controls shared by the desktop, stable and mobile players.
(function () {
    'use strict';

    function getAdjacentEpisodes() {
        var current = document.querySelector('#episodePanel .list-group-item.active');
        return {
            previous: current ? current.previousElementSibling : null,
            next: current ? current.nextElementSibling : null
        };
    }

    function bindPlaybackInput(player) {
        var container = player.container;
        var video = player.video;
        var gesture = null;
        var ghostClick = null;
        var fullscreenPending = false;
        var destroyed = false;
        var removers = [];
        var preview = document.createElement('div');
        preview.className = 'dplayer-gesture-seek';
        preview.hidden = true;
        preview.setAttribute('aria-hidden', 'true');
        preview.innerHTML = '<strong data-seek-delta></strong><span data-seek-target></span>';
        container.appendChild(preview);
        var deltaText = preview.querySelector('[data-seek-delta]');
        var targetText = preview.querySelector('[data-seek-target]');
        var fullButton = container.querySelector('.dplayer-full-icon');
        if (fullButton) {
            fullButton.setAttribute('aria-keyshortcuts', 'f');
            fullButton.setAttribute('aria-label', '全屏（F）');
            fullButton.title = '全屏（F）';
        }

        function listen(target, name, handler, options) {
            target.addEventListener(name, handler, options);
            removers.push(function () { target.removeEventListener(name, handler, options); });
        }

        function editable(target) {
            return target && (target.isContentEditable || (target.closest &&
                target.closest('input, textarea, select, [role="textbox"], [role="combobox"]')));
        }

        function fullscreenFailed() {
            if (!destroyed) player.notice('暂时无法切换全屏，请使用播放器全屏按钮');
        }

        function onFullscreenKey(event) {
            if ((event.key !== 'f' && event.key !== 'F') || event.defaultPrevented ||
                event.repeat || event.isComposing || event.keyCode === 229 ||
                event.ctrlKey || event.altKey || event.metaKey || event.shiftKey ||
                editable(event.target) || editable(document.activeElement) || document.hidden) return;
            event.preventDefault();
            event.stopPropagation();
            if (fullscreenPending) return;
            cancelGesture();
            var full = player.fullScreen;
            var current = document.fullscreenElement || document.webkitFullscreenElement ||
                document.mozFullScreenElement || document.msFullscreenElement;
            var target;
            var action;
            if (current) {
                target = document;
                action = document.exitFullscreen || document.webkitExitFullscreen ||
                    document.webkitCancelFullScreen || document.mozCancelFullScreen || document.msExitFullscreen;
            } else if (video.webkitDisplayingFullscreen) {
                target = video;
                action = video.webkitExitFullscreen || video.webkitExitFullScreen;
            } else if (full.isFullScreen('web')) {
                full.cancel('web');
                return;
            } else {
                // DPlayer's fullscreen events still own resize and scroll restoration.
                full.lastScrollPosition = { left: window.pageXOffset, top: window.pageYOffset };
                target = container;
                action = container.requestFullscreen || container.webkitRequestFullscreen ||
                    container.mozRequestFullScreen || container.msRequestFullscreen;
                if (!action) {
                    target = video;
                    action = video.webkitEnterFullscreen || video.webkitEnterFullScreen;
                }
            }
            if (!action) { fullscreenFailed(); return; }
            try {
                fullscreenPending = true;
                Promise.resolve(action.call(target)).then(function () {
                    fullscreenPending = false;
                }, function () {
                    fullscreenPending = false;
                    fullscreenFailed();
                });
            } catch (error) {
                fullscreenPending = false;
                fullscreenFailed();
            }
        }

        function seekable() {
            return !video.error && video.readyState >= 1 && !player.options.live &&
                Number.isFinite(video.duration) && video.duration > 0 && Number.isFinite(video.currentTime);
        }

        function cancelGesture() {
            gesture = null;
            preview.hidden = true;
        }

        function clock(seconds) {
            var value = Math.max(0, Math.round(seconds));
            var hours = Math.floor(value / 3600);
            var minutes = Math.floor(value / 60) % 60;
            var tail = String(value % 60).padStart(2, '0');
            return (hours ? hours + ':' + String(minutes).padStart(2, '0') : String(minutes).padStart(2, '0')) + ':' + tail;
        }

        function updatePreview(touch) {
            // Relative distance, independent of duration; one full player width = 90s.
            gesture.target = Math.max(0, Math.min(video.duration,
                gesture.time + (touch.clientX - gesture.x) / gesture.width * 90));
            var delta = gesture.target - gesture.time;
            deltaText.textContent = (delta < 0 ? '后退 ' : '前进 ') + clock(Math.abs(delta));
            targetText.textContent = clock(gesture.target) + ' / ' + clock(video.duration);
            preview.hidden = false;
        }

        function onTouchStart(event) {
            ghostClick = null;
            cancelGesture();
            if (event.touches.length !== 1 || event.defaultPrevented || !seekable()) return;
            var target = event.target;
            if (!target.closest || target.closest('a, button, input, textarea, select, [contenteditable], [role="button"], ' +
                '.dplayer-controller, .dplayer-setting, .dplayer-menu, .dplayer-mask, .dplayer-mobile-play')) return;
            var width = container.getBoundingClientRect().width;
            if (width <= 0) return;
            var touch = event.touches[0];
            gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY,
                width: width, time: video.currentTime, source: video.currentSrc,
                target: video.currentTime, horizontal: false };
        }

        function onTouchMove(event) {
            if (!gesture) return;
            if (event.touches.length !== 1 || !seekable() || video.currentSrc !== gesture.source) {
                cancelGesture(); return;
            }
            var touch = event.touches[0];
            if (touch.identifier !== gesture.id) { cancelGesture(); return; }
            if (!gesture.horizontal) {
                var dx = Math.abs(touch.clientX - gesture.x);
                var dy = Math.abs(touch.clientY - gesture.y);
                if (Math.max(dx, dy) < 10) return;
                // Once scrolling wins, this contact cannot turn into a seek.
                if (dy >= dx) { cancelGesture(); return; }
                if (dx < dy * 1.25) return;
                gesture.horizontal = true;
            }
            if (!event.cancelable) { cancelGesture(); return; }
            event.preventDefault();
            updatePreview(touch);
        }

        function onTouchEnd(event) {
            if (!gesture) return;
            if (event.touches.length || !gesture.horizontal || !seekable() || video.currentSrc !== gesture.source) {
                cancelGesture(); return;
            }
            var touch = Array.prototype.find.call(event.changedTouches, function (point) {
                return point.identifier === gesture.id;
            });
            if (!touch) { cancelGesture(); return; }
            updatePreview(touch);
            var time = gesture.target;
            ghostClick = { x: touch.clientX, y: touch.clientY, until: Date.now() + 500 };
            if (event.cancelable) event.preventDefault();
            cancelGesture();
            try { player.seek(time); }
            catch (error) { player.notice('暂时无法调整进度，请等待媒体就绪'); }
            player.controller.setAutoHide();
        }

        function onClick(event) {
            // Only suppress the compatibility click at the released contact. A new
            // touch, keyboard activation or unrelated mouse/control click stays native.
            if (!ghostClick || event.detail === 0 || Date.now() > ghostClick.until ||
                (event.sourceCapabilities && !event.sourceCapabilities.firesTouchEvents) ||
                Math.abs(event.clientX - ghostClick.x) > 25 || Math.abs(event.clientY - ghostClick.y) > 25) return;
            ghostClick = null;
            event.preventDefault();
            event.stopImmediatePropagation();
        }

        function onVisibility() { if (document.hidden) cancelGesture(); }
        listen(document, 'keydown', onFullscreenKey, true);
        listen(container, 'touchstart', onTouchStart, { passive: true });
        listen(container, 'touchmove', onTouchMove, { passive: false });
        listen(container, 'touchend', onTouchEnd, { passive: false });
        listen(container, 'touchcancel', cancelGesture, { passive: true });
        listen(container, 'click', onClick, true);
        listen(video, 'emptied', cancelGesture);
        listen(video, 'loadstart', cancelGesture);
        listen(video, 'error', cancelGesture);
        listen(window, 'resize', cancelGesture);
        listen(window, 'blur', cancelGesture);
        listen(document, 'visibilitychange', onVisibility);
        listen(document, 'fullscreenchange', cancelGesture);
        listen(document, 'webkitfullscreenchange', cancelGesture);
        player.on('resize', cancelGesture);

        return function () {
            destroyed = true;
            cancelGesture();
            ghostClick = null;
            removers.forEach(function (remove) { remove(); });
            preview.remove();
        };
    }

    function bindPlayer(player) {
        if (!player || !player.video || !player.container) return;
        var controls = player.container.querySelector('.dplayer-icons-left');
        if (!controls || controls.querySelector('.dplayer-skip-forward')) return;
        var video = player.video;
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'dplayer-icon dplayer-transport-control dplayer-skip-forward';
        button.setAttribute('aria-label', '跳过片头');
        button.title = '跳过片头';
        button.innerHTML = '<svg class="dplayer-skip-forward__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m3 5 9 7-9 7V5Zm9 0 9 7-9 7V5Z"/></svg>' +
            '<span class="dplayer-skip-forward__label" aria-hidden="true">跳过片头</span>';
        var playButton = controls.querySelector('.dplayer-play-icon');
        controls.insertBefore(button, playButton ? playButton.nextSibling : controls.firstChild);
        var adjacent = getAdjacentEpisodes();

        function episodeControl(source, direction, label, path) {
            var link = document.createElement('a');
            link.className = 'dplayer-icon dplayer-transport-control dplayer-episode-step dplayer-episode-' + direction;
            link.setAttribute('aria-label', label);
            link.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="' + path + '"/></svg>';
            if (source && source.matches('a[href]')) {
                link.href = source.href;
                link.setAttribute('data-route-morph', 'video');
                var title = source.querySelector('strong');
                link.title = label + (title ? '：' + title.textContent.trim() : '');
            } else {
                link.setAttribute('aria-disabled', 'true');
                link.tabIndex = -1;
                link.title = label + '（暂无可播放剧集）';
            }
            return link;
        }

        var previous = episodeControl(adjacent.previous, 'previous', '上一集', 'M5 5h2v14H5V5Zm14 0v14L9 12l10-7Z');
        var next = episodeControl(adjacent.next, 'next', '下一集', 'M17 5h2v14h-2V5ZM5 5l10 7-10 7V5Z');
        controls.insertBefore(previous, playButton || button);
        controls.insertBefore(next, button);
        var transportControls = [previous, next, button];

        function releasePointerFocus(event) {
            // A pointer click can retain :focus-visible from earlier keyboard use.
            // Keep keyboard/assistive activation focused, but never latch pointer focus.
            if (event.detail > 0 || event.pointerType) event.currentTarget.blur();
        }

        function resumeAutoHide() {
            // Skip does not bubble to DPlayer; its mobile controller also has no
            // click timer. Reuse the existing timer without altering its delay.
            player.controller.setAutoHide();
        }

        function navigate(event) {
            releasePointerFocus(event);
            if (!event.currentTarget.hasAttribute('href')) {
                event.preventDefault();
                event.stopPropagation();
            }
            // Enabled links retain native navigation, modifiers and route-morph handling.
        }

        function canSeek() {
            return !video.error && video.readyState >= 1 &&
                Number.isFinite(video.duration) && video.duration > 0 &&
                Number.isFinite(video.currentTime) && video.currentTime < video.duration;
        }

        function sync() {
            var disabled = !canSeek();
            if (button.disabled !== disabled) button.disabled = disabled;
        }

        function skip(event) {
            event.stopPropagation();
            releasePointerFocus(event);
            resumeAutoHide();
            if (!canSeek()) { sync(); return; }
            try {
                // DPlayer's seek also updates its progress, time and danmaku.
                // It leaves the existing play/pause state alone.
                player.seek(Math.min(video.currentTime + 85, video.duration));
            } catch (error) {
                player.notice('暂时无法快进，请等待媒体就绪');
            }
            sync();
        }

        function onKeydown(event) {
            // Let native activation work without toggling DPlayer's Space hotkey.
            if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
            if (event.key === ' ' && event.currentTarget.tagName === 'A') event.preventDefault();
        }

        function onKeyup(event) {
            if (event.key === ' ' && event.currentTarget.tagName === 'A') {
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.click();
            }
        }

        var events = ['loadedmetadata', 'durationchange', 'timeupdate', 'emptied', 'error'];
        events.forEach(function (name) { video.addEventListener(name, sync); });
        button.addEventListener('click', skip);
        previous.addEventListener('click', navigate);
        next.addEventListener('click', navigate);
        transportControls.forEach(function (control) {
            control.addEventListener('keydown', onKeydown);
            control.addEventListener('keyup', onKeyup);
            control.addEventListener('focus', resumeAutoHide);
        });
        var destroyPlaybackInput = bindPlaybackInput(player);
        var destroyed = false;
        function destroy() {
            if (destroyed) return;
            destroyed = true;
            destroyPlaybackInput();
            events.forEach(function (name) { video.removeEventListener(name, sync); });
            button.removeEventListener('click', skip);
            previous.removeEventListener('click', navigate);
            next.removeEventListener('click', navigate);
            transportControls.forEach(function (control) {
                control.removeEventListener('keydown', onKeydown);
                control.removeEventListener('keyup', onKeyup);
                control.removeEventListener('focus', resumeAutoHide);
                control.remove();
            });
            window.removeEventListener('pagehide', destroy);
        }
        player.on('destroy', destroy);
        window.addEventListener('pagehide', destroy, { once: true });
        sync();
    }

    window.DandanVideoControls = { bindPlayer: bindPlayer, getAdjacentEpisodes: getAdjacentEpisodes };
})();
