(function (window, document) {
    'use strict';

    if (!window.matchMedia('(min-width: 769px)').matches) return;
    if (window.Web1UiVersion && !window.Web1UiVersion.isV3Desktop()) return;

    var STORAGE_KEY = 'dandanplay.route-morph.v1';
    var PAYLOAD_VERSION = 1;
    var PAYLOAD_KIND = 'hero-to-video';
    var TTL_MS = 8000;
    var FAIL_OPEN_MS = 1500;
    var POINT_COUNT = 32;
    var LAYERS = ['acid', 'paper', 'ink'];
    var DRAW_ORDER = ['ink', 'paper', 'acid'];

    var mode = 'idle';
    var overlay = null;
    var overlayPromise = null;
    var overlayGeneration = 0;
    var paths = {};
    var activeTimeline = null;
    var activeTimer = 0;
    var holdTimer = 0;
    var armedPayload = null;
    var arrivalPromise = null;
    var arrivalResolve = null;
    var exitPromise = null;
    var playbackLinkActive = null;

    function hasReducedMotion() {
        return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    function hasGsap() {
        return Boolean(window.gsap && typeof window.gsap.timeline === 'function');
    }

    function finiteNumber(value) {
        return typeof value === 'number' && isFinite(value);
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function safeText(value, limit) {
        return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit);
    }

    function safeMediaUrl(value) {
        var raw = safeText(value, 49152);
        if (!raw) return '';
        try {
            var parsed = new URL(raw, window.location.href);
            if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'blob:') {
                return parsed.href;
            }
            if (parsed.protocol === 'data:' && /^data:image\//i.test(raw)) return raw;
        } catch (error) {}
        return '';
    }

    function currentViewport() {
        return {
            width: Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1),
            height: Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1),
            dpr: clamp(Number(window.devicePixelRatio) || 1, 0.5, 8)
        };
    }

    function currentFileId() {
        try { return String(new URL(window.location.href).searchParams.get('id') || ''); }
        catch (error) { return ''; }
    }

    function normalizeDestination(destination) {
        var rawHref = '';
        var explicitId = '';
        if (typeof destination === 'string') {
            rawHref = destination;
        } else if (destination && typeof destination === 'object') {
            rawHref = destination.href || destination.url || '';
            explicitId = destination.fileId || destination.id || '';
            if (!rawHref && destination.pathname) {
                rawHref = String(destination.pathname) + String(destination.search || '');
            }
            if (!rawHref && explicitId) {
                rawHref = 'video.html?id=' + encodeURIComponent(String(explicitId));
            }
        }
        if (!rawHref) return null;
        try {
            var url = new URL(String(rawHref), window.location.href);
            var fileId = String(explicitId || url.searchParams.get('id') || '');
            if (!fileId || url.origin !== window.location.origin) return null;
            return {
                href: url.href,
                pathname: url.pathname,
                search: url.search,
                id: fileId
            };
        } catch (error) {
            return null;
        }
    }

    function readStorageOnce() {
        var raw = '';
        try {
            raw = window.sessionStorage.getItem(STORAGE_KEY) || '';
            window.sessionStorage.removeItem(STORAGE_KEY);
        } catch (error) {
            return null;
        }
        if (!raw) return null;
        try { return JSON.parse(raw); }
        catch (error) { return null; }
    }

    function removeStoredPayload() {
        try { window.sessionStorage.removeItem(STORAGE_KEY); }
        catch (error) {}
    }

    function writePayload(payload) {
        try {
            window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
            return true;
        } catch (error) {
            return false;
        }
    }

    function validatePayload(payload) {
        if (!payload || typeof payload !== 'object') return false;
        if (payload.version !== PAYLOAD_VERSION || payload.kind !== PAYLOAD_KIND) return false;
        if (!finiteNumber(payload.createdAt) || !finiteNumber(payload.expiresAt)) return false;
        if (payload.expiresAt - payload.createdAt !== TTL_MS) return false;
        var age = Date.now() - payload.createdAt;
        if (age < 0 || age > TTL_MS || Date.now() > payload.expiresAt) return false;
        if (!payload.destination || typeof payload.destination !== 'object') return false;
        if (String(payload.destination.id || '') !== currentFileId()) return false;
        if (String(payload.destination.pathname || '') !== window.location.pathname) return false;
        if (!payload.viewport || !finiteNumber(payload.viewport.width) || !finiteNumber(payload.viewport.height)) return false;
        if (!payload.origin || !finiteNumber(payload.origin.left) || !finiteNumber(payload.origin.top)) return false;
        if (!finiteNumber(payload.origin.width) || !finiteNumber(payload.origin.height)) return false;
        if (payload.origin.width <= 0 || payload.origin.height <= 0) return false;
        if (!payload.shape || payload.shape.pointCount !== POINT_COUNT) return false;
        return true;
    }

    function hashSeed(value) {
        var text = String(value || 'ddp');
        var hash = 2166136261;
        for (var index = 0; index < text.length; index += 1) {
            hash ^= text.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return Math.abs(hash >>> 0) || 1;
    }

    function circlePoints(cx, cy, rx, ry) {
        var points = [];
        for (var index = 0; index < POINT_COUNT; index += 1) {
            var angle = -Math.PI / 2 + index / POINT_COUNT * Math.PI * 2;
            points.push({
                x: cx + Math.cos(angle) * rx,
                y: cy + Math.sin(angle) * ry
            });
        }
        return points;
    }

    function rotorPoints(cx, cy, rx, ry, seed) {
        var points = [];
        var phase = ((seed || 1) % 7 - 3) * 0.006;
        for (var index = 0; index < POINT_COUNT; index += 1) {
            var angle = -Math.PI / 2 + index / POINT_COUNT * Math.PI * 2 + phase;
            var facet = index % 4;
            var radius = facet === 0 ? 0.92 : (facet === 2 ? 1.055 : 0.985);
            points.push({
                x: cx + Math.cos(angle) * rx * radius,
                y: cy + Math.sin(angle) * ry * radius
            });
        }
        return points;
    }

    function sampleClosedPolyline(vertices) {
        var segments = [];
        var totalLength = 0;
        for (var index = 0; index < vertices.length; index += 1) {
            var from = vertices[index];
            var to = vertices[(index + 1) % vertices.length];
            var length = Math.hypot(to.x - from.x, to.y - from.y);
            segments.push({ from: from, to: to, start: totalLength, length: length });
            totalLength += length;
        }

        var points = [];
        for (var pointIndex = 0; pointIndex < POINT_COUNT; pointIndex += 1) {
            var distance = totalLength * pointIndex / POINT_COUNT;
            var segment = segments[segments.length - 1];
            for (var segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
                if (distance <= segments[segmentIndex].start + segments[segmentIndex].length) {
                    segment = segments[segmentIndex];
                    break;
                }
            }
            var amount = segment.length > 0 ? (distance - segment.start) / segment.length : 0;
            points.push({
                x: segment.from.x + (segment.to.x - segment.from.x) * amount,
                y: segment.from.y + (segment.to.y - segment.from.y) * amount
            });
        }
        return points;
    }

    function cutCornerRectPoints(cx, cy, width, height, cut) {
        var halfWidth = Math.max(1, width / 2);
        var halfHeight = Math.max(1, height / 2);
        var corner = clamp(cut || 0, 0, Math.min(halfWidth, halfHeight) * 0.46);
        return sampleClosedPolyline([
            { x: cx, y: cy - halfHeight },
            { x: cx + halfWidth - corner, y: cy - halfHeight },
            { x: cx + halfWidth, y: cy - halfHeight + corner },
            { x: cx + halfWidth, y: cy + halfHeight - corner },
            { x: cx + halfWidth - corner, y: cy + halfHeight },
            { x: cx - halfWidth + corner, y: cy + halfHeight },
            { x: cx - halfWidth, y: cy + halfHeight - corner },
            { x: cx - halfWidth, y: cy - halfHeight + corner },
            { x: cx - halfWidth + corner, y: cy - halfHeight }
        ]);
    }

    function interpolatePoints(from, to, progress) {
        var result = [];
        var amount = clamp(progress, 0, 1);
        for (var index = 0; index < POINT_COUNT; index += 1) {
            result.push({
                x: from[index].x + (to[index].x - from[index].x) * amount,
                y: from[index].y + (to[index].y - from[index].y) * amount
            });
        }
        return result;
    }

    function pointsAtProgress(keyframes, progress) {
        if (progress <= 1) return interpolatePoints(keyframes[0], keyframes[1], progress);
        return interpolatePoints(keyframes[1], keyframes[2], progress - 1);
    }

    function pathFromPoints(points) {
        var path = 'M' + points[0].x.toFixed(2) + ',' + points[0].y.toFixed(2);
        for (var index = 1; index < points.length; index += 1) {
            path += ' L' + points[index].x.toFixed(2) + ',' + points[index].y.toFixed(2);
        }
        return path + ' Z';
    }

    function svgElement(name) {
        return document.createElementNS('http://www.w3.org/2000/svg', name);
    }

    function buildOverlay() {
        var root = document.createElement('div');
        var unique = 'ddpRm' + Math.random().toString(36).slice(2, 9);
        root.className = 'ddp-route-morph';
        root.id = 'ddpRouteMorph';
        root.setAttribute('aria-hidden', 'true');

        var backdrop = document.createElement('span');
        backdrop.className = 'ddp-route-morph__backdrop';
        var backdropImage = document.createElement('img');
        backdropImage.alt = '';
        backdropImage.decoding = 'async';
        backdrop.appendChild(backdropImage);
        root.appendChild(backdrop);

        var svg = svgElement('svg');
        svg.setAttribute('class', 'ddp-route-morph__svg');
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.setAttribute('focusable', 'false');
        svg.setAttribute('data-morph-id', unique);
        DRAW_ORDER.forEach(function (layer) {
            var path = svgElement('path');
            path.setAttribute('data-morph-path', layer);
            path.setAttribute('class', 'ddp-route-morph__layer is-' + layer);
            path.setAttribute('vector-effect', 'non-scaling-stroke');
            paths[layer] = path;
            svg.appendChild(path);
        });
        root.appendChild(svg);

        var disc = document.createElement('span');
        disc.className = 'ddp-route-morph__disc';
        var artwork = document.createElement('img');
        artwork.alt = '';
        artwork.decoding = 'async';
        disc.appendChild(artwork);
        disc.appendChild(document.createElement('i'));
        root.appendChild(disc);

        var scanner = document.createElement('span');
        scanner.className = 'ddp-route-morph__scanner';
        scanner.appendChild(document.createElement('i'));
        root.appendChild(scanner);

        var label = document.createElement('span');
        label.className = 'ddp-route-morph__label';
        var kicker = document.createElement('small');
        kicker.textContent = 'DDP / MEDIA GATE';
        var title = document.createElement('b');
        var meta = document.createElement('em');
        label.appendChild(kicker);
        label.appendChild(title);
        label.appendChild(meta);
        root.appendChild(label);

        var grain = document.createElement('span');
        grain.className = 'ddp-route-morph__grain';
        root.appendChild(grain);

        var shutter = document.createElement('span');
        shutter.className = 'ddp-route-morph__shutter';
        root.appendChild(shutter);

        var shutterTrace = document.createElement('span');
        shutterTrace.className = 'ddp-route-morph__shutter-trace';
        root.appendChild(shutterTrace);
        return root;
    }

    function ensureOverlay() {
        if (overlay && overlay.isConnected) return Promise.resolve(overlay);
        if (overlayPromise) return overlayPromise;
        var generation = overlayGeneration;
        overlayPromise = new Promise(function (resolve) {
            function append() {
                if (!document.body) return;
                if (generation !== overlayGeneration) {
                    overlayPromise = null;
                    resolve(null);
                    return;
                }
                overlay = buildOverlay();
                document.body.appendChild(overlay);
                overlayPromise = null;
                resolve(overlay);
            }
            if (document.body) append();
            else document.addEventListener('DOMContentLoaded', append, { once: true });
        });
        return overlayPromise;
    }

    function sizeOverlay(viewport) {
        if (!overlay) return;
        var svg = overlay.querySelector('.ddp-route-morph__svg');
        svg.setAttribute('viewBox', '0 0 ' + viewport.width + ' ' + viewport.height);
    }

    function fullPoints(viewport, layerIndex) {
        var corner = clamp(Math.min(viewport.width, viewport.height) * 0.055, 24, 64);
        var overscan = corner + 18 + (2 - layerIndex) * 5;
        return cutCornerRectPoints(
            viewport.width / 2,
            viewport.height / 2,
            viewport.width + overscan * 2,
            viewport.height + overscan * 2,
            corner
        );
    }

    function sourceKeyframes(viewport, origin, seed, layerIndex) {
        var cx = origin.left + origin.width / 2;
        var cy = origin.top + origin.height / 2;
        var registrationPad = (2 - layerIndex) * 5;
        var radius = Math.max(origin.width, origin.height) / 2 + registrationPad;
        var paperOffsetX = layerIndex === 1 ? (seed % 2 ? 8 : -8) : 0;
        var paperOffsetY = layerIndex === 1 ? -5 : 0;
        return [
            circlePoints(cx + paperOffsetX, cy + paperOffsetY, radius, radius),
            rotorPoints(cx + paperOffsetX, cy + paperOffsetY, radius * 1.34, radius * 1.28, seed + layerIndex * 31),
            fullPoints(viewport, layerIndex)
        ];
    }

    function targetKeyframes(viewport, targetRect, seed, layerIndex) {
        var cx = targetRect.left + targetRect.width / 2;
        var cy = targetRect.top + targetRect.height / 2;
        var registrationPad = layerIndex === 0 ? 7 : (layerIndex === 1 ? 4 : 0);
        var paperOffsetX = layerIndex === 1 ? (seed % 2 ? 9 : -9) : 0;
        var paperOffsetY = layerIndex === 1 ? -5 : 0;
        var corner = clamp(Math.min(targetRect.width, targetRect.height) * 0.06, 10, 30);
        return [
            fullPoints(viewport, layerIndex),
            cutCornerRectPoints(
                cx + paperOffsetX,
                cy + paperOffsetY,
                targetRect.width + 54 + registrationPad * 2,
                targetRect.height + 42 + registrationPad * 2,
                corner + 8
            ),
            cutCornerRectPoints(
                cx + paperOffsetX,
                cy + paperOffsetY,
                targetRect.width + registrationPad * 2,
                targetRect.height + registrationPad * 2,
                corner
            )
        ];
    }

    function setPath(path, keyframes, progress) {
        path.setAttribute('d', pathFromPoints(pointsAtProgress(keyframes, progress)));
    }

    function makeProgressTween(timeline, state, path, keyframes, firstDuration, secondDuration, position, firstEase, secondEase) {
        setPath(path, keyframes, state.progress);
        timeline.to(state, {
            progress: 1,
            duration: firstDuration,
            ease: firstEase,
            onUpdate: function () { setPath(path, keyframes, state.progress); }
        }, position);
        timeline.to(state, {
            progress: 2,
            duration: secondDuration,
            ease: secondEase,
            onUpdate: function () { setPath(path, keyframes, state.progress); }
        }, position + firstDuration);
    }

    function applyMedia(root, data) {
        var artworkUrl = safeMediaUrl(data.artworkUrl);
        var backdropUrl = safeMediaUrl(data.backdropUrl);
        var artwork = root.querySelector('.ddp-route-morph__disc img');
        var backdrop = root.querySelector('.ddp-route-morph__backdrop img');
        if (artworkUrl) artwork.src = artworkUrl;
        else artwork.removeAttribute('src');
        if (backdropUrl) backdrop.src = backdropUrl;
        else backdrop.removeAttribute('src');
        root.querySelector('.ddp-route-morph__label b').textContent = safeText(data.title, 160) || '继续播放';
        root.querySelector('.ddp-route-morph__label em').textContent = 'LOAD / FILE ' + safeText(data.destination && data.destination.id, 48);
        root.classList.toggle('has-artwork', Boolean(artworkUrl));
        root.classList.toggle('has-backdrop', Boolean(backdropUrl));
    }

    function positionOriginVisual(root, origin, viewport) {
        var disc = root.querySelector('.ddp-route-morph__disc');
        var scanner = root.querySelector('.ddp-route-morph__scanner');
        var label = root.querySelector('.ddp-route-morph__label');
        [disc, scanner].forEach(function (element) {
            element.style.left = origin.left.toFixed(2) + 'px';
            element.style.top = origin.top.toFixed(2) + 'px';
            element.style.width = origin.width.toFixed(2) + 'px';
            element.style.height = origin.height.toFixed(2) + 'px';
        });
        disc.style.transform = 'rotate(' + origin.rotation.toFixed(2) + 'deg)';
        label.style.left = clamp(origin.left + origin.width + 18, 18, Math.max(18, viewport.width - 286)).toFixed(2) + 'px';
        label.style.top = clamp(origin.top + origin.height / 2 - 26, 18, Math.max(18, viewport.height - 88)).toFixed(2) + 'px';
    }

    function positionTargetVisual(root, targetRect) {
        var shutter = root.querySelector('.ddp-route-morph__shutter');
        var trace = root.querySelector('.ddp-route-morph__shutter-trace');
        [shutter, trace].forEach(function (element) {
            element.style.left = targetRect.left.toFixed(2) + 'px';
            element.style.top = targetRect.top.toFixed(2) + 'px';
            element.style.height = targetRect.height.toFixed(2) + 'px';
        });
        shutter.style.width = targetRect.width.toFixed(2) + 'px';
        trace.style.width = '2px';
    }

    function clearTimers() {
        if (activeTimer) window.clearTimeout(activeTimer);
        if (holdTimer) window.clearTimeout(holdTimer);
        activeTimer = 0;
        holdTimer = 0;
    }

    function killTimeline() {
        if (activeTimeline) {
            activeTimeline.kill();
            activeTimeline = null;
        }
    }

    function clearRootClasses() {
        document.documentElement.classList.remove(
            'ddp-route-morph-pending',
            'ddp-route-morph-exiting',
            'ddp-route-morph-arriving'
        );
    }

    function removeOverlay() {
        overlayGeneration += 1;
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        overlay = null;
        overlayPromise = null;
        paths = {};
        clearRootClasses();
    }

    function finishArrival(animated, reason) {
        clearTimers();
        killTimeline();
        removeOverlay();
        armedPayload = null;
        mode = 'idle';
        var resolve = arrivalResolve;
        arrivalResolve = null;
        arrivalPromise = null;
        if (resolve) resolve({ animated: Boolean(animated), reason: reason || '' });
    }

    function armFromSession() {
        if (mode === 'armed' || mode === 'arriving') return true;
        var candidate = readStorageOnce();
        if (!candidate || hasReducedMotion() || !validatePayload(candidate)) {
            clearRootClasses();
            return false;
        }
        armedPayload = candidate;
        mode = 'armed';
        document.documentElement.classList.add('ddp-route-morph-pending');
        activeTimer = window.setTimeout(function () {
            if (mode === 'armed' || mode === 'arriving') finishArrival(false, 'fail-open-timeout');
        }, FAIL_OPEN_MS);
        ensureOverlay().then(function (root) {
            if (mode !== 'armed' && mode !== 'arriving') return;
            var viewport = currentViewport();
            sizeOverlay(viewport);
            applyMedia(root, candidate);
            LAYERS.forEach(function (layer, index) {
                paths[layer].setAttribute('d', pathFromPoints(fullPoints(viewport, index)));
            });
            root.classList.add('is-armed');
        });
        return true;
    }

    function arrive(targetElement) {
        if (arrivalPromise) return arrivalPromise;
        if (!armedPayload || (mode !== 'armed' && mode !== 'arriving')) {
            return Promise.resolve({ animated: false, reason: 'not-armed' });
        }
        if (hasReducedMotion() || !hasGsap()) {
            finishArrival(false, hasReducedMotion() ? 'reduced-motion' : 'gsap-unavailable');
            return Promise.resolve({ animated: false, reason: hasReducedMotion() ? 'reduced-motion' : 'gsap-unavailable' });
        }
        var target = typeof targetElement === 'string' ? document.querySelector(targetElement) : targetElement;
        if (!target || typeof target.getBoundingClientRect !== 'function') {
            finishArrival(false, 'invalid-target');
            return Promise.resolve({ animated: false, reason: 'invalid-target' });
        }

        arrivalPromise = new Promise(function (resolve) { arrivalResolve = resolve; });
        mode = 'arriving';
        document.documentElement.classList.add('ddp-route-morph-arriving');
        if (activeTimer) window.clearTimeout(activeTimer);
        activeTimer = window.setTimeout(function () {
            if (mode === 'arriving') finishArrival(false, 'fail-open-timeout');
        }, FAIL_OPEN_MS);
        ensureOverlay().then(function (root) {
            if (mode !== 'arriving' || !armedPayload) return;
            var targetRect = target.getBoundingClientRect();
            if (!targetRect || targetRect.width <= 1 || targetRect.height <= 1) {
                finishArrival(false, 'empty-target');
                return;
            }
            var viewport = currentViewport();
            var seed = armedPayload.shape.seed || 1;
            sizeOverlay(viewport);
            applyMedia(root, armedPayload);
            positionTargetVisual(root, targetRect);
            root.classList.add('is-arriving');
            var states = LAYERS.map(function () { return { progress: 0 }; });
            try {
                activeTimeline = window.gsap.timeline({
                    defaults: { overwrite: 'auto' },
                    onComplete: function () { finishArrival(true, 'complete'); }
                });
                var shutter = root.querySelector('.ddp-route-morph__shutter');
                var shutterTrace = root.querySelector('.ddp-route-morph__shutter-trace');
                window.gsap.set(root, { autoAlpha: 1 });
                window.gsap.set(root.querySelector('.ddp-route-morph__disc'), { autoAlpha: 0 });
                window.gsap.set(root.querySelector('.ddp-route-morph__scanner'), { autoAlpha: 0 });
                window.gsap.set(root.querySelector('.ddp-route-morph__label'), { autoAlpha: 0 });
                window.gsap.set(shutter, { autoAlpha: 0, scaleX: 1, transformOrigin: 'right center' });
                window.gsap.set(shutterTrace, { autoAlpha: 0, x: 0 });
                window.gsap.set(paths.ink, { autoAlpha: 1 });
                window.gsap.set(paths.paper, { autoAlpha: 0 });
                window.gsap.set(paths.acid, { autoAlpha: 0.9, strokeDashoffset: 28 });
                LAYERS.forEach(function (layer, index) {
                    var firstDuration = index === 2 ? 0.18 : 0.17;
                    var secondDuration = 0.055;
                    var position = index === 2 ? 0.015 : (index === 1 ? 0.01 : 0);
                    makeProgressTween(
                        activeTimeline,
                        states[index],
                        paths[layer],
                        targetKeyframes(viewport, targetRect, seed, index),
                        firstDuration,
                        secondDuration,
                        position,
                        'power3.inOut',
                        'power4.out'
                    );
                });
                activeTimeline
                    .to(root.querySelector('.ddp-route-morph__backdrop'), { autoAlpha: 0.1, duration: 0.07, ease: 'power2.out' }, 0)
                    .to(root.querySelector('.ddp-route-morph__backdrop'), { autoAlpha: 0, duration: 0.1, ease: 'power2.in' }, 0.1)
                    .to(paths.paper, { autoAlpha: 0.46, duration: 0.025, ease: 'none' }, 0.13)
                    .to(paths.paper, { autoAlpha: 0, duration: 0.045, ease: 'power2.out' }, 0.155)
                    .to(paths.acid, { strokeDashoffset: 0, duration: 0.225, ease: 'none' }, 0)
                    .to(paths.acid, { autoAlpha: 0, duration: 0.055, ease: 'power2.out' }, 0.225)
                    .set(shutter, { autoAlpha: 1 }, 0.225)
                    .set(shutterTrace, { autoAlpha: 1 }, 0.225)
                    .to(paths.ink, { autoAlpha: 0, duration: 0.025, ease: 'none' }, 0.225)
                    .to(shutter, { scaleX: 0, duration: 0.145, ease: 'power3.inOut' }, 0.245)
                    .to(shutterTrace, { x: targetRect.width, duration: 0.145, ease: 'power3.inOut' }, 0.245)
                    .to(shutterTrace, { autoAlpha: 0, duration: 0.035, ease: 'power2.out' }, 0.38)
                    .to(root.querySelector('.ddp-route-morph__grain'), { autoAlpha: 0, duration: 0.14, ease: 'power2.out' }, 0.25)
                    .to(root, { autoAlpha: 0, duration: 0.035, ease: 'power2.out' }, 0.39);
            } catch (error) {
                finishArrival(false, 'timeline-error');
            }
        });
        return arrivalPromise;
    }

    function exit(options) {
        if (exitPromise) return exitPromise;
        var settings = options || {};
        var originElement = settings.originElement;
        var destination = normalizeDestination(settings.destination);
        if (hasReducedMotion() || !hasGsap()) {
            return Promise.resolve({
                animated: false,
                covered: false,
                reason: hasReducedMotion() ? 'reduced-motion' : 'gsap-unavailable'
            });
        }
        if (!originElement || typeof originElement.getBoundingClientRect !== 'function' || !destination) {
            return Promise.resolve({ animated: false, covered: false, reason: 'invalid-options' });
        }
        var measured = originElement.getBoundingClientRect();
        if (!measured || measured.width <= 1 || measured.height <= 1) {
            return Promise.resolve({ animated: false, covered: false, reason: 'empty-origin' });
        }

        mode = 'exiting';
        removeStoredPayload();
        clearTimers();
        killTimeline();
        var viewport = currentViewport();
        var rotation = 0;
        try { rotation = Number(window.gsap.getProperty(originElement, 'rotation')) || 0; }
        catch (error) {}
        var origin = {
            left: measured.left,
            top: measured.top,
            width: measured.width,
            height: measured.height,
            nx: measured.left / viewport.width,
            ny: measured.top / viewport.height,
            nw: measured.width / viewport.width,
            nh: measured.height / viewport.height,
            rotation: rotation
        };
        var seed = hashSeed(String(destination.id) + '|' + safeText(settings.title, 160));
        var payloadBase = {
            version: PAYLOAD_VERSION,
            kind: PAYLOAD_KIND,
            nonce: 'rm-' + Date.now().toString(36) + '-' + seed.toString(36),
            destination: destination,
            viewport: viewport,
            origin: origin,
            artworkUrl: safeMediaUrl(settings.artworkUrl),
            backdropUrl: safeMediaUrl(settings.backdropUrl),
            title: safeText(settings.title, 160),
            shape: {
                pointCount: POINT_COUNT,
                seed: seed,
                finalState: 'viewport-covered'
            },
            palette: {
                acid: '#d9f45b',
                paper: '#eef2e9',
                ink: '#080a08'
            }
        };

        exitPromise = new Promise(function (resolve) {
            var settled = false;
            function settle(result) {
                if (settled) return;
                settled = true;
                if (!result.covered) {
                    killTimeline();
                    removeOverlay();
                    mode = 'idle';
                }
                exitPromise = null;
                resolve(result);
            }
            activeTimer = window.setTimeout(function () {
                settle({ animated: false, covered: false, reason: 'fail-open-timeout' });
            }, FAIL_OPEN_MS);

            ensureOverlay().then(function (root) {
                if (settled || mode !== 'exiting') return;
                sizeOverlay(viewport);
                applyMedia(root, payloadBase);
                positionOriginVisual(root, origin, viewport);
                root.classList.add('is-exiting');
                document.documentElement.classList.add('ddp-route-morph-exiting');

                var states = LAYERS.map(function () { return { progress: 0 }; });
                try {
                    activeTimeline = window.gsap.timeline({
                        defaults: { overwrite: 'auto' },
                        onComplete: function () {
                            window.clearTimeout(activeTimer);
                            activeTimer = 0;
                            var createdAt = Date.now();
                            var payload = Object.assign({}, payloadBase, {
                                createdAt: createdAt,
                                expiresAt: createdAt + TTL_MS
                            });
                            if (!writePayload(payload)) {
                                settle({ animated: false, covered: false, reason: 'storage-unavailable' });
                                return;
                            }
                            mode = 'holding';
                            settle({ animated: true, covered: true, reason: 'complete', payload: payload });
                            holdTimer = window.setTimeout(function () {
                                if (mode !== 'holding') return;
                                removeStoredPayload();
                                removeOverlay();
                                mode = 'idle';
                            }, FAIL_OPEN_MS);
                        }
                    });
                    var disc = root.querySelector('.ddp-route-morph__disc');
                    var scanner = root.querySelector('.ddp-route-morph__scanner');
                    var label = root.querySelector('.ddp-route-morph__label');
                    var backdrop = root.querySelector('.ddp-route-morph__backdrop');
                    var shutter = root.querySelector('.ddp-route-morph__shutter');
                    var shutterTrace = root.querySelector('.ddp-route-morph__shutter-trace');
                    window.gsap.set(root, { autoAlpha: 1 });
                    window.gsap.set(disc, { autoAlpha: 1, scale: 1 });
                    window.gsap.set(scanner, { autoAlpha: 0, scale: 1.18, rotation: -18 });
                    window.gsap.set(label, { autoAlpha: 0, x: -8 });
                    window.gsap.set(backdrop, { autoAlpha: 0 });
                    window.gsap.set(shutter, { autoAlpha: 0, scaleX: 1 });
                    window.gsap.set(shutterTrace, { autoAlpha: 0, x: 0 });
                    window.gsap.set(paths.ink, { autoAlpha: 1 });
                    window.gsap.set(paths.paper, { autoAlpha: 0 });
                    window.gsap.set(paths.acid, { autoAlpha: 0.94, strokeDashoffset: 28 });
                    LAYERS.forEach(function (layer, index) {
                        var firstDuration = index === 2 ? 0.085 : 0.075;
                        var secondDuration = index === 2 ? 0.26 : (index === 1 ? 0.25 : 0.27);
                        var position = index === 2 ? 0.06 : (index === 1 ? 0.05 : 0.04);
                        makeProgressTween(
                            activeTimeline,
                            states[index],
                            paths[layer],
                            sourceKeyframes(viewport, origin, seed, index),
                            firstDuration,
                            secondDuration,
                            position,
                            'power2.inOut',
                            index === 2 ? 'power4.inOut' : 'power3.inOut'
                        );
                    });
                    activeTimeline
                        .to(backdrop, { autoAlpha: 0.12, duration: 0.07, ease: 'power2.out' }, 0)
                        .to(backdrop, { autoAlpha: 0, duration: 0.12, ease: 'power2.in' }, 0.16)
                        .to(scanner, { autoAlpha: 1, scale: 1, rotation: 0, duration: 0.065, ease: 'power3.out' }, 0)
                        .to(scanner, { rotation: '+=48_cw', duration: 0.11, ease: 'power2.inOut' }, 0.01)
                        .to(scanner, { scale: 0.94, duration: 0.03, ease: 'power2.in' }, 0.065)
                        .to(scanner, { scale: 1.02, duration: 0.045, ease: 'power3.out' }, 0.095)
                        .to(disc, { rotation: '+=72_cw', duration: 0.075, ease: 'power2.out' }, 0)
                        .to(disc, { rotation: '+=18_cw', duration: 0.04, ease: 'power4.out' }, 0.075)
                        .to(label, { autoAlpha: 1, x: 0, duration: 0.085, ease: 'power3.out' }, 0.035)
                        .to(label, { autoAlpha: 0, x: 7, duration: 0.08, ease: 'power2.in' }, 0.2)
                        .to(paths.paper, { autoAlpha: 0.52, duration: 0.025, ease: 'none' }, 0.12)
                        .to(paths.paper, { autoAlpha: 0, duration: 0.045, ease: 'power2.out' }, 0.145)
                        .to(paths.acid, { strokeDashoffset: 0, duration: 0.3, ease: 'none' }, 0.04)
                        .to(disc, { autoAlpha: 0, duration: 0.14, ease: 'power2.in' }, 0.14)
                        .to(scanner, { autoAlpha: 0, duration: 0.1, ease: 'power2.in' }, 0.16);
                } catch (error) {
                    settle({ animated: false, covered: false, reason: 'timeline-error' });
                }
            });
        });
        return exitPromise;
    }

    function playableLinkContext(link) {
        if (!link || typeof link.getAttribute !== 'function') return null;
        var destination = normalizeDestination(link.getAttribute('href') || '');
        if (!destination) return null;

        var episode = link.closest ? link.closest('.episode-item') : null;
        var thumbnail = link.querySelector ? link.querySelector('.file-thumbnail') : null;
        var backdrop = document.getElementById('modalArtwork');
        var episodeTitle = episode && episode.querySelector ? episode.querySelector('.episode-title') : null;
        var fileTitle = link.querySelector ? link.querySelector('.file-item-info') : null;
        var title = episodeTitle && episodeTitle.textContent
            ? episodeTitle.textContent
            : (fileTitle && fileTitle.textContent ? fileTitle.textContent : link.textContent);

        return {
            destination: destination,
            originElement: thumbnail || link,
            artworkUrl: thumbnail ? (thumbnail.currentSrc || thumbnail.src || '') : '',
            backdropUrl: backdrop ? (backdrop.currentSrc || backdrop.src || '') : '',
            title: title || ''
        };
    }

    function clearPlaybackLinkState() {
        if (playbackLinkActive && playbackLinkActive.link) {
            playbackLinkActive.link.classList.remove('is-route-leaving');
            playbackLinkActive.link.removeAttribute('aria-busy');
        }
        var modal = document.getElementById('bangumiModal');
        if (modal) modal.removeAttribute('aria-busy');
        playbackLinkActive = null;
    }

    function commitPlaybackDestination(destination) {
        window.location.assign(destination.href);
    }

    function handlePlaybackLinkClick(event) {
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;

        var target = event.target;
        var link = target && target.closest
            ? target.closest('a[data-route-morph="video"]')
            : null;
        if (!link) return;

        var context = playableLinkContext(link);
        if (!context) return;
        event.preventDefault();

        if (playbackLinkActive) return;
        playbackLinkActive = { link: link, destination: context.destination };
        link.classList.add('is-route-leaving');
        link.setAttribute('aria-busy', 'true');
        var modal = document.getElementById('bangumiModal');
        if (modal) modal.setAttribute('aria-busy', 'true');

        exit(context).then(function () {
            commitPlaybackDestination(context.destination);
        }, function () {
            commitPlaybackDestination(context.destination);
        });
    }

    function cancel(reason) {
        removeStoredPayload();
        clearTimers();
        if (mode === 'armed' || mode === 'arriving') {
            finishArrival(false, reason || 'cancelled');
            return;
        }
        killTimeline();
        removeOverlay();
        mode = 'idle';
        armedPayload = null;
        exitPromise = null;
    }

    window.addEventListener('pagehide', function () {
        clearTimers();
        killTimeline();
    });

    window.addEventListener('pageshow', function (event) {
        clearPlaybackLinkState();
        if (event.persisted) cancel('bfcache-restore');
    });

    document.addEventListener('click', handlePlaybackLinkClick, false);

    window.DdpRouteMorph = {
        exit: exit,
        arrive: arrive,
        arm: armFromSession,
        cancel: cancel,
        isArmed: function () { return Boolean(armedPayload); },
        storageKey: STORAGE_KEY
    };

    armFromSession();
})(window, document);
