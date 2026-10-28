(function (global) {
    'use strict';
    var VERSION = '1.3.1', bindings = new WeakMap(), libraryPromise = null, wasmBuffers = null, wasmPromise = null;
    var scriptUrl = global.document && global.document.currentScript ? global.document.currentScript.src : '';
    var vendorRoot = new URL('vendor/libmedia-1.3.1/', scriptUrl || global.location.href).href;
    var cleanup = Promise.resolve();

    function loadLibrary() {
        if (global.AVPlayer) return Promise.resolve(global.AVPlayer);
        if (!libraryPromise) libraryPromise = new Promise(function (resolve, reject) {
            var script = document.createElement('script');
            script.src = vendorRoot + 'dist/umd/avplayer.js';
            script.onload = function () { global.AVPlayer ? resolve(global.AVPlayer) : reject(new Error('解码器未初始化')); };
            script.onerror = function () { libraryPromise = null; reject(new Error('解码器资源读取失败')); };
            document.head.appendChild(script);
        });
        return libraryPromise;
    }
    function getWasm(type, id) {
        var path;
        if (type === 'decoder' && id === 86056) path = 'decode/eac3-simd.wasm';
        else if (type === 'decoder' && id === 173) path = 'decode/hevc-simd.wasm';
        else if (type === 'decoder' && typeof global.VideoDecoder === 'function') return null;
        else if (type === 'resampler') path = 'resample/resample-simd.wasm';
        else if (type === 'stretchpitcher') path = 'stretchpitch/stretchpitch-simd.wasm';
        else throw new Error('本次试用未包含该解码器：' + type + '/' + id);
        if (!wasmBuffers || !wasmBuffers[path]) throw new Error('解码资源尚未读取');
        return wasmBuffers[path];
    }
    function loadWasm() {
        if (!wasmPromise) wasmPromise = Promise.all([
            ['decode/eac3-simd.wasm', 624542], ['decode/hevc-simd.wasm', 1187929],
            ['resample/resample-simd.wasm', 263311], ['stretchpitch/stretchpitch-simd.wasm', 45775]
        ].map(async function (entry) {
            var response = await fetch(vendorRoot + 'wasm/' + entry[0], { credentials: 'same-origin' });
            if (!response.ok) throw new Error('解码资源读取失败：' + response.status);
            var bytes = await response.arrayBuffer();
            if (bytes.byteLength !== entry[1]) throw new Error('解码资源大小不符');
            return [entry[0], bytes];
        })).then(function (entries) { wasmBuffers = Object.fromEntries(entries); }).catch(function (error) { wasmPromise = null; throw error; });
        return wasmPromise;
    }
    async function closeContext(ctx) {
        if (!ctx || ctx.state === 'closed') return;
        var listener, timer;
        var closed = new Promise(function (resolve, reject) {
            listener = function () { if (ctx.state === 'closed') resolve(); };
            ctx.addEventListener('statechange', listener);
            timer = setTimeout(function () { reject(new Error('音频资源释放超时')); }, 10000);
        });
        try { await Promise.all([ctx.close(), closed]); }
        finally { clearTimeout(timer); ctx.removeEventListener('statechange', listener); }
    }
    function disposeEngine(engine) {
        if (!engine) return cleanup;
        var Library = global.AVPlayer, ctx = Library.audioContext;
        cleanup = cleanup.catch(function () {}).then(async function () {
            await engine.destroy();
            if (Library.Instances.length === 0) {
                await closeContext(ctx);
                await Library.stopPipelines();
            }
        });
        return cleanup;
    }
    function nativeEac3(video) {
        return !!video.canPlayType('audio/mp4; codecs="ec-3"');
    }
    async function prepare(selection) {
        var mode = new URL(global.location.href).searchParams.get('decoder');
        if (mode === 'native' || selection.isCompatible) return selection;
        if (mode === 'software') return Object.assign({}, selection, { software: true, decoderReason: '用户指定软件解码' });
        if (nativeEac3(document.createElement('video')) || !global.DandanVideoCodecProbe) return selection;
        var result = await global.DandanVideoCodecProbe.inspect(selection.url);
        if (result.codec === 'eac3') return Object.assign({}, selection, { software: true, decoderReason: '原生不支持 E-AC-3' });
        return selection;
    }

    function attach(video, player, options) {
        if (bindings.has(video)) return bindings.get(video);
        options = options || {};
        var originalUrl = options.url || player.options.video.url;
        var native = { play: video.play.bind(video), pause: video.pause.bind(video), load: video.load.bind(video) };
        var savedDescriptors = {}, engine = null, layer = null, generation = 0, active = false, destroyed = false;
        var ready = Promise.resolve(), playing = false, time = 0, duration = NaN, muted = video.muted;
        var volume = video.volume, rate = video.playbackRate || 1, seeking = false, ended = false, error = null;
        var firstFrame = false, clockObserved = false, width = 0, height = 0, frameId = 0, frameCallbacks = new Map(), resize = null;
        var seekChain = Promise.resolve(), desiredTime = 0, panel = null, status = null, toggle = null;
        var originalDestroy = null, originalScreenshot = null, records = [], nativeResume = null, nativeRestore = null, nativeSeeked = null, timerDescriptor = null, timerGuarded = false, requestedLoading = false;
        var EMPTY = { length: 0, start: function () { throw new DOMException('No range', 'IndexSizeError'); }, end: function () { throw new DOMException('No range', 'IndexSizeError'); } };
        function record(event, data) {
            records.push({ event: event, at: Math.round(performance.now()), data: data || null });
            if (records.length > 60) records.shift();
        }
        function emit(name) { if (!destroyed) video.dispatchEvent(new Event(name)); }
        function notify(text, failed) {
            if (status) status.textContent = text;
            if (panel) panel.dataset.decoderState = failed ? 'error' : active ? 'software' : 'native';
            record(failed ? 'error' : 'state', text);
        }
        function fail(reason) {
            if (!active || destroyed) return;
            playing = false;
            error = { code: 0, message: String(reason && reason.message || reason) };
            notify('软件解码未能播放：' + error.message + '。可切回原生播放。', true);
            emit('error'); emit('pause');
        }
        function property(name, descriptor) {
            savedDescriptors[name] = Object.getOwnPropertyDescriptor(video, name);
            Object.defineProperty(video, name, Object.assign({ configurable: true }, descriptor));
        }
        function restoreProperties() {
            Object.keys(savedDescriptors).forEach(function (name) {
                if (savedDescriptors[name]) Object.defineProperty(video, name, savedDescriptors[name]);
                else delete video[name];
            });
            savedDescriptors = {};
        }
        function updateVolume() {
            if (engine) engine.setVolume(muted ? 0 : volume, true);
            emit('volumechange');
        }
        function seekTo(value) {
            value = Number(value);
            if (!Number.isFinite(value) || value < 0 || destroyed) return;
            desiredTime = Number.isFinite(duration) ? Math.min(value, duration) : value;
            time = desiredTime; seeking = true; ended = false; emit('seeking');
            var own = generation;
            seekChain = seekChain.catch(function () {}).then(async function () {
                await ready;
                if (own !== generation || !active || destroyed) return;
                await engine.seek(BigInt(Math.round(desiredTime * 1000)));
                if (!playing && own === generation && engine) await engine.pause();
            }).catch(fail);
        }
        function requestPlay() {
            var own = generation;
            playing = true; ended = false; emit('play');
            var ctx = global.AVPlayer && global.AVPlayer.audioContext;
            if (ctx && ctx.state === 'suspended') ctx.resume().catch(function () {});
            return ready.then(async function () {
                if (!active || destroyed || own !== generation || !playing) return;
                await engine.play();
            }).catch(function (reason) { fail(reason); throw reason; });
        }
        function pause() {
            playing = false;
            if (engine) Promise.resolve(engine.pause()).catch(fail);
            emit('pause');
        }
        function rendered() {
            if (!active || destroyed) return;
            firstFrame = true;
            if (engine.canvas) { width = engine.canvas.width; height = engine.canvas.height; }
            emit('loadeddata'); emit('canplay');
            var callbacks = Array.from(frameCallbacks.values());
            frameCallbacks.clear();
            callbacks.forEach(function (callback) { callback(performance.now(), { mediaTime: time, presentedFrames: 1, width: width, height: height }); });
            player.container.classList.remove('dplayer-loading');
            notify('软件解码 · E-AC-3 试用');
        }
        function installFacade() {
            var getters = {
                paused: function () { return !playing; }, ended: function () { return ended; }, seeking: function () { return seeking; },
                duration: function () { return duration; }, readyState: function () { return firstFrame ? 4 : Number.isFinite(duration) ? 1 : 0; },
                networkState: function () { return error ? 3 : 2; }, error: function () { return error; },
                videoWidth: function () { return width; }, videoHeight: function () { return height; },
                currentSrc: function () { return originalUrl; }, buffered: function () { return EMPTY; },
                played: function () { return time > 0 ? { length: 1, start: function () { return 0; }, end: function () { return time; } } : EMPTY; },
                seekable: function () { return Number.isFinite(duration) ? { length: 1, start: function () { return 0; }, end: function () { return duration; } } : EMPTY; }
            };
            Object.keys(getters).forEach(function (name) { property(name, { get: getters[name] }); });
            property('currentTime', { get: function () { return engine && clockObserved && !seeking ? Number(engine.currentTime) / 1000 : time; }, set: seekTo });
            property('volume', { get: function () { return volume; }, set: function (value) { volume = Math.min(1, Math.max(0, Number(value) || 0)); updateVolume(); } });
            property('muted', { get: function () { return muted; }, set: function (value) { muted = !!value; updateVolume(); } });
            property('playbackRate', { get: function () { return rate; }, set: function (value) { rate = Number(value) || 1; if (engine) engine.setPlaybackRate(rate); emit('ratechange'); } });
            property('src', { get: function () { return originalUrl; }, set: function (value) { originalUrl = new URL(value, location.href).href; time = desiredTime = 0; } });
            property('play', { value: requestPlay }); property('pause', { value: pause });
            property('load', { value: function () { var keep = time, resume = playing; ready = open(keep); ready.catch(fail); if (resume) requestPlay().catch(function () {}); } });
            property('getVideoPlaybackQuality', { value: function () { return { totalVideoFrames: firstFrame ? Math.max(1, Number(engine && engine.getStats().videoFrameRenderCount) || 1) : 0, droppedVideoFrames: 0 }; } });
            property('requestVideoFrameCallback', { value: function (callback) {
                var id = ++frameId; frameCallbacks.set(id, callback);
                if (firstFrame) requestAnimationFrame(function () { if (frameCallbacks.has(id) && active) { frameCallbacks.delete(id); callback(performance.now(), { mediaTime: time, presentedFrames: 1 }); } });
                return id;
            } });
            property('cancelVideoFrameCallback', { value: function (id) { frameCallbacks.delete(id); } });
        }
        async function open(position) {
            var own = ++generation, old = engine; engine = null;
            firstFrame = false; clockObserved = false; error = null; duration = NaN; time = desiredTime = position || 0; seeking = false;
            emit('emptied'); emit('loadstart'); notify('正在读取软件解码器 · 试用');
            await disposeEngine(old); await cleanup;
            var Library = await loadLibrary();
            await loadWasm();
            if (!active || destroyed || own !== generation) return;
            var instance = engine = new Library({ container: layer, getWasm: getWasm, checkUseMSE: function () { return false; },
                enableWorker: true, enableHardware: true, enableWebCodecs: true, enableWebGPU: false, enableAudioWorklet: true,
                enableJitterBuffer: false, audioWorkletBufferLength: 10, preLoadTime: 0.2, loop: false });
            function on(name, fn) { instance.on(name, function () { if (own === generation && active && !destroyed) fn.apply(null, arguments); }); }
            on(Library.Events.FIRST_VIDEO_RENDERED, rendered);
            on(Library.Events.TIME, function () { if (!seeking && firstFrame) { clockObserved = true; time = Number(instance.currentTime) / 1000; } emit('timeupdate'); });
            on(Library.Events.PLAYING, function () { if (playing) emit('playing'); else instance.pause(); });
            on(Library.Events.SEEKED, function () { seeking = false; time = clockObserved ? Number(instance.currentTime) / 1000 : desiredTime; emit('seeked'); emit('timeupdate'); });
            on(Library.Events.ENDED, function () { ended = true; playing = false; emit('ended'); });
            on(Library.Events.ERROR, function (reason) { fail(reason || '解码失败'); });
            await instance.load(new URL(originalUrl, location.href).href, { ioLoaderOptions: { preload: 1048576 } });
            if (!active || destroyed || own !== generation) return;
            duration = Number(instance.getDuration()) / 1000;
            var streams = instance.getStreams();
            var visual = streams.find(function (stream) { return stream.codecparProxy && stream.codecparProxy.codecType === 0; });
            if (visual) { width = visual.codecparProxy.width; height = visual.codecparProxy.height; }
            instance.setSubtitleEnable(false);
            updateVolume(); instance.setPlaybackRate(rate);
            emit('durationchange'); emit('loadedmetadata');
            if (position > 0) await instance.seek(BigInt(Math.round(position * 1000)));
            notify('软件解码已就绪 · 点击播放');
            record('loaded', { duration: duration, secure: isSecureContext, webCodecs: typeof VideoDecoder === 'function' });
        }
        function enable() {
            if (active || destroyed) return ready;
            time = nativeRestore ? nativeRestore.position : Number(video.currentTime) || 0;
            volume = video.volume; muted = video.muted; rate = nativeRestore ? nativeRestore.rate : video.playbackRate || 1;
            if (nativeResume) video.removeEventListener('loadedmetadata', nativeResume);
            if (nativeSeeked) video.removeEventListener('seeked', nativeSeeked);
            nativeResume = nativeSeeked = nativeRestore = null;
            playing = !video.paused; native.pause(); video.removeAttribute('src'); native.load();
            active = true; installFacade();
            document.body.classList.add('ddp-software-page');
            layer = document.createElement('div'); layer.className = 'ddp-software-surface';
            video.parentNode.insertBefore(layer, video); video.classList.add('ddp-software-facade');
            if (toggle) toggle.textContent = '切回原生';
            player.container.classList.add('ddp-software-active');
            resize = new ResizeObserver(function () { if (engine && active) engine.resize(layer.clientWidth, layer.clientHeight); }); resize.observe(layer);
            ready = open(time); ready.catch(fail);
            if (playing) requestPlay().catch(function () {});
            emit('ddpdecoderchange');
            return ready;
        }
        async function disable() {
            if (!active || destroyed) return;
            var position = time, resume = playing, old = engine; engine = null;
            active = false; playing = false; generation++; frameCallbacks.clear();
            if (resize) resize.disconnect(); resize = null;
            try { await disposeEngine(old); } catch (reason) { record('cleanup-error', String(reason.message || reason)); }
            if (destroyed) return;
            restoreProperties(); layer.remove(); layer = null; video.classList.remove('ddp-software-facade');
            player.container.classList.remove('ddp-software-active');
            document.body.classList.remove('ddp-software-page');
            video.volume = volume; video.muted = muted; video.playbackRate = rate;
            if (toggle) toggle.textContent = '软件解码（试用）';
            nativeRestore = { position: position, rate: rate };
            nativeSeeked = function () { nativeRestore = null; nativeSeeked = null; };
            video.addEventListener('seeked', nativeSeeked, { once: true });
            nativeResume = function () {
                video.volume = volume; video.muted = muted; video.playbackRate = rate;
                video.currentTime = Math.min(position, video.duration || position);
                if (resume) native.play().catch(function () {});
                nativeResume = null;
            };
            video.addEventListener('loadedmetadata', nativeResume, { once: true });
            video.src = originalUrl; native.load(); notify('原生播放'); emit('ddpdecoderchange');
        }
        function bindControls() {
            if (panel) return;
            panel = document.getElementById('videoDecoderStatus');
            if (panel) {
                status = panel.querySelector('[data-decoder-status]'); toggle = panel.querySelector('[data-decoder-toggle]');
                panel.hidden = false; toggle.textContent = active ? '切回原生' : '软件解码（试用）';
                toggle.addEventListener('click', function () { if (toggle.disabled) return; toggle.disabled = true;
                    Promise.resolve(active ? disable() : enable()).catch(function (reason) { notify('切换未完成：' + String(reason.message || reason), true); }).finally(function () { toggle.disabled = false; }); });
                notify(active ? '软件解码 · E-AC-3 试用' : '原生播放');
            }
            if (!originalDestroy) {
                originalDestroy = player.destroy;
                player.destroy = function () { destroy(); return originalDestroy.apply(player, arguments); };
            }
            if (player.timer && !timerGuarded) {
                timerGuarded = true;
                timerDescriptor = Object.getOwnPropertyDescriptor(player.timer, 'enableloadingChecker');
                requestedLoading = player.timer.enableloadingChecker;
                Object.defineProperty(player.timer, 'enableloadingChecker', { configurable: true,
                    get: function () { return active ? false : requestedLoading; },
                    set: function (value) { requestedLoading = value; } });
            }
            var shot = player.container.querySelector('.dplayer-camera-icon');
            if (shot) { originalScreenshot = function (event) { if (active) { event.preventDefault(); event.stopImmediatePropagation(); notify('软件解码试用暂不支持截图，可切回原生。'); } }; shot.addEventListener('click', originalScreenshot, true); }
        }
        function destroy() {
            if (destroyed) return cleanup;
            destroyed = true; active = false; generation++; playing = false; frameCallbacks.clear();
            if (resize) resize.disconnect();
            if (nativeResume) video.removeEventListener('loadedmetadata', nativeResume);
            if (nativeSeeked) video.removeEventListener('seeked', nativeSeeked);
            if (timerGuarded) {
                if (timerDescriptor) Object.defineProperty(player.timer, 'enableloadingChecker', timerDescriptor);
                else delete player.timer.enableloadingChecker;
            }
            var old = engine; engine = null;
            restoreProperties(); native.pause(); video.removeAttribute('src'); native.load();
            if (layer) layer.remove();
            global.removeEventListener('pagehide', destroy);
            bindings.delete(video); return disposeEngine(old);
        }
        var controller = { enable: enable, disable: disable, destroy: destroy, bindControls: bindControls,
            isActive: function () { return active; }, getEngine: function () { return engine; },
            diagnostics: function () { return { version: VERSION, active: active, time: time, duration: duration, firstFrame: firstFrame, paused: !playing, error: error, events: records.slice() }; } };
        bindings.set(video, controller); video.ddpSoftwareDecoder = controller;
        global.addEventListener('pagehide', destroy);
        if (options.start) enable();
        return controller;
    }
    global.DandanSoftwareVideo = { prepare: prepare, attach: attach, version: VERSION };
})(window);
