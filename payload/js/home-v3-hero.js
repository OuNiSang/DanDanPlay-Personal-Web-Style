(function () {
    'use strict';

    // Web1 3.0 is intentionally a desktop-only experience.  The homepage
    // keeps the stable 2.4 presentation and business flow at phone/tablet
    // widths, so none of the Hero 3D listeners or preload work should start.
    if (!window.matchMedia('(min-width: 769px)').matches ||
        (window.Web1UiVersion && !window.Web1UiVersion.isV3Desktop())) return;

    var state = {
        ready: false,
        items: [],
        pool: [],
        cards: [],
        cardBindings: [],
        listeners: [],
        options: {},
        activeIndex: 0,
        carouselPosition: 0,
        carouselTween: null,
        entryTimeline: null,
        entryPlayed: false,
        entryRunning: false,
        backdropFront: 'A',
        backdropRequest: 0,
        backdropTimeline: null,
        backdropTargetUrl: '',
        mediaDiameter: 0,
        deviceTimeline: null,
        deviceSpin: null,
        deviceHovering: false,
        devicePlaying: false,
        playRequest: 0,
        hydrateRequest: 0,
        imagePromises: {},
        preloadPlan: [],
        preloadStarts: [],
        resizeFrame: 0,
        signature: '',
        metrics: {
            spacing: 356,
            centerY: -118,
            visibleRadius: 2.45,
            centerScale: 1
        }
    };

    var dom = {};

    function hasMotion() {
        return Boolean(window.gsap) && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function qs(selector, root) {
        return (root || document).querySelector(selector);
    }

    function qsa(selector, root) {
        return Array.prototype.slice.call((root || document).querySelectorAll(selector));
    }

    function setDiscArtwork(node, url) {
        if (!node) return;
        node.style.backgroundImage = url ? 'url(' + JSON.stringify(String(url)) + ')' : '';
    }

    function listen(target, type, handler, options) {
        if (!target) return;
        target.addEventListener(type, handler, options);
        state.listeners.push(function () {
            target.removeEventListener(type, handler, options);
        });
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function primitiveText(value) {
        if (typeof value === 'string') return value.trim();
        if (typeof value === 'number' && isFinite(value)) return String(value);
        return '';
    }

    function pickText(source, names) {
        if (!source) return '';
        for (var i = 0; i < names.length; i++) {
            var value = primitiveText(source[names[i]]);
            if (value) return value;
        }
        return '';
    }

    function pickArtwork(source, names) {
        return pickText(source, names);
    }

    function normalizeDate(value) {
        var text = primitiveText(value);
        if (!text) return '--';
        var chinese = text.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
        if (chinese) {
            return chinese[1] + '.' + chinese[2].padStart(2, '0') + '.' + chinese[3].padStart(2, '0');
        }
        var date = new Date(text);
        if (!isNaN(date.getTime())) {
            return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('.');
        }
        return text.length > 14 ? text.slice(0, 14) : text;
    }

    function normalizeDateTime(value) {
        var text = primitiveText(value);
        if (!text) return '尚无记录';
        var date = new Date(text);
        if (!isNaN(date.getTime())) {
            return [
                date.getFullYear() + '.' + String(date.getMonth() + 1).padStart(2, '0') + '.' + String(date.getDate()).padStart(2, '0'),
                String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0')
            ].join(' ');
        }
        return text.length > 20 ? text.slice(0, 20) : text;
    }

    function getProgress(raw, options) {
        if (options && typeof options.getProgress === 'function') {
            try {
                var progress = options.getProgress(raw);
                if (progress && typeof progress === 'object') {
                    return {
                        watched: Math.max(0, Number(progress.watched || 0)),
                        total: Math.max(0, Number(progress.total || 0)),
                        percent: Math.max(0, Math.min(100, Number(progress.percent || 0)))
                    };
                }
            } catch (error) {}
        }
        var watched = Math.max(0, Number(raw.EpisodeWatched || 0));
        var total = Math.max(0, Number(raw.EpisodeTotal || 0));
        return {
            watched: watched,
            total: total,
            percent: total > 0 ? Math.max(0, Math.min(100, Math.round(watched / total * 100))) : 0
        };
    }

    function mapItem(raw, index, options) {
        if (!raw || typeof raw !== 'object') return null;
        var id = primitiveText(raw.AnimeId || raw.Id || raw.BangumiId || index + 1);
        var title = pickText(raw, ['Title', 'AnimeTitle', 'Name', 'title']) || '未命名作品';
        var poster = pickArtwork(raw, [
            'HeroPoster', 'PosterLarge', 'CoverLarge', 'LargeCover', 'Poster', 'Cover',
            'ImageUrl', 'BangumiCover', 'CoverImage', 'coverImage', 'Image', 'image'
        ]);
        var backdrop = pickArtwork(raw, [
            'HeroArtwork', 'Backdrop', 'HeroBackdrop', 'Banner', 'BannerImage', 'HeroBanner', 'WideCover'
        ]);
        var progress = getProgress(raw, options || {});
        var date = normalizeDate(pickText(raw, ['Details', 'OnAirDate', 'LastPlay', 'LastUpdate', 'Created']));
        var status = pickText(raw, [
            'StatusText', 'BangumiStatusText', 'AnimeStatusText', 'TypeDescription', 'FavoriteStatus'
        ]);
        var synopsis = pickText(raw, ['HeroSynopsis', 'Synopsis', 'Summary', 'Description', 'Intro']);
        var episodeNumber = Math.max(0, Number(progress.watched || 0));
        var episodeLabel = episodeNumber > 0 ? '第 ' + episodeNumber + ' 话' : '从第 1 话开始';
        var episodeTitleSource = pickText(raw, [
            'LastEpisodeTitle', 'LastWatchedEpisodeTitle', 'CurrentEpisodeTitle', 'EpisodeTitle'
        ]);
        var episodeTitle = episodeTitleSource || '单集标题待媒体库同步';
        var lastWatched = normalizeDateTime(pickText(raw, [
            'LastWatched', 'LastWatchedCloud', 'LastPlayTime', 'LastPlayedAt', 'LastPlay'
        ]));
        var episodeAirDate = normalizeDate(pickText(raw, [
            'EpisodeAirDate', 'AirDate', 'OnAirDate', 'BroadcastDate'
        ]));
        return {
            id: id,
            title: title,
            poster: poster,
            backdrop: backdrop || poster,
            backdropKind: backdrop ? 'wide' : 'poster',
            progress: progress,
            date: date,
            status: status,
            synopsis: synopsis,
            episodeLabel: episodeLabel,
            episodeTitle: episodeTitle,
            episodeTitlePending: !episodeTitleSource,
            lastWatched: lastWatched,
            episodeAirDate: episodeAirDate === '--' ? '放送信息未同步' : episodeAirDate,
            code: 'DDP / ' + id,
            raw: raw
        };
    }

    function uniqueItems(rawItems, options) {
        var seenIds = {};
        var seenArtwork = {};
        var result = [];
        (rawItems || []).some(function (raw, index) {
            var item = mapItem(raw, index, options);
            if (!item || !item.poster) return false;
            var idKey = item.id || item.title;
            var artKey = item.poster.split('&token=')[0];
            if (seenIds[idKey] || seenArtwork[artKey]) return false;
            seenIds[idKey] = true;
            seenArtwork[artKey] = true;
            result.push(item);
            return result.length >= 24;
        });
        return result;
    }

    function ensureReady() {
        if (!state.ready) init();
        return state.ready;
    }

    function cacheDom() {
        dom.hero = qs('#heroBanner');
        dom.shell = qs('#hero3Shell');
        dom.orbit = qs('#hero3Orbit');
        dom.entryCloud = qs('#hero3EntryCloud');
        dom.entrySpark = qs('#hero3EntrySpark');
        dom.backdrop = qs('#hero3Backdrop');
        dom.backdropA = qs('#hero3BackdropA');
        dom.backdropB = qs('#hero3BackdropB');
        dom.info = qs('.hero3__info');
        dom.title = qs('#heroTitle');
        dom.meta = qs('#heroMeta');
        dom.description = qs('#heroDescription');
        dom.badge = qs('#heroBadge');
        dom.badgeText = qs('#heroBadgeText');
        dom.index = qs('#hero3Index');
        dom.code = qs('#hero3Code');
        dom.action = qs('#heroPlayBtn');
        dom.zone = qs('#hero3DeviceZone');
        dom.player = qs('.hero3__player');
        dom.machine = qs('.hero3__machine');
        dom.mechButton = qs('.hero3__mechanical-button');
        dom.mechMeta = qs('#hero3MechMeta');
        dom.loadState = qs('.hero3__load-state');
        dom.led = qs('.hero3__machine-led');
        dom.disc = qs('#hero3Disc');
        dom.discArt = qs('#hero3DiscArt');
        dom.guide = qs('#hero3LiftGuide');
        dom.guideRails = qsa('.hero3__lift-rail', dom.guide);
        dom.guideCoupler = qs('.hero3__lift-coupler', dom.guide);
        dom.tray = qs('#hero3Tray');
        dom.deckLid = qs('#hero3DeckLid');
        dom.loadedDisc = qs('#hero3LoadedDisc');
        dom.loadedDiscArt = qs('#hero3LoadedDiscArt');
    }

    function refreshMetrics() {
        if (!dom.shell) return;
        var width = dom.shell.getBoundingClientRect().width || window.innerWidth;
        if (width <= 430) {
            state.metrics.spacing = Math.max(158, width * 0.48);
            state.metrics.centerY = -26;
            state.metrics.visibleRadius = 1.65;
            state.metrics.centerScale = 1;
        } else if (width <= 768) {
            state.metrics.spacing = Math.max(190, width * 0.41);
            state.metrics.centerY = -42;
            state.metrics.visibleRadius = 1.85;
            state.metrics.centerScale = 1;
        } else if (width <= 900) {
            state.metrics.spacing = Math.max(258, width * 0.34);
            state.metrics.centerY = -88;
            state.metrics.visibleRadius = 2.45;
            state.metrics.centerScale = 1;
        } else {
            state.metrics.spacing = Math.min(610, Math.max(410, width * 0.292));
            state.metrics.centerY = -110;
            state.metrics.visibleRadius = 2.45;
            state.metrics.centerScale = 1;
        }
    }

    function wrappedDelta(index, position, total) {
        var delta = index - position;
        while (delta > total / 2) delta -= total;
        while (delta < total / -2) delta += total;
        return delta;
    }

    function shortestIndexDelta(nextIndex, currentIndex, total) {
        var delta = nextIndex - currentIndex;
        if (delta > total / 2) delta -= total;
        if (delta < total / -2) delta += total;
        return delta;
    }

    function visualFor(delta) {
        var abs = Math.abs(delta);
        return {
            x: delta * state.metrics.spacing,
            y: state.metrics.centerY + abs * 7,
            scale: Math.max(0.82, state.metrics.centerScale - abs * 0.075),
            opacity: Math.max(0.72, 1 - abs * 0.1),
            visible: abs <= state.metrics.visibleRadius,
            z: Math.round(90 - abs * 18)
        };
    }

    function createSetters(card) {
        var gsap = window.gsap;
        if (!gsap) return null;
        gsap.set(card, { xPercent: -50, yPercent: -50, transformPerspective: 1200 });
        return true;
    }

    function layoutCarousel(position) {
        var total = state.cards.length;
        if (!total || state.entryRunning) return;
        state.cards.forEach(function (entry, index) {
            var delta = wrappedDelta(index, position, total);
            var visual = visualFor(delta);
            var card = entry.card;
            if (window.gsap && entry.setters) {
                window.gsap.set(card, {
                    xPercent: -50,
                    yPercent: -50,
                    x: visual.x,
                    y: visual.y,
                    z: 0,
                    scale: visual.scale,
                    rotationX: 0,
                    rotationY: 0,
                    autoAlpha: visual.visible ? visual.opacity : 0
                });
            } else {
                card.style.opacity = visual.visible ? visual.opacity : 0;
                card.style.transform = 'translate(-50%, -50%) translate3d(' + visual.x + 'px,' + visual.y + 'px,0) scale(' + visual.scale + ')';
            }
            card.style.zIndex = String(visual.z);
            card.setAttribute('aria-hidden', visual.visible ? 'false' : 'true');
            card.setAttribute('aria-selected', Math.abs(delta) < 0.18 ? 'true' : 'false');
            card.classList.toggle('is-active', Math.abs(delta) < 0.18);
            card.tabIndex = Math.abs(delta) < 0.18 ? 0 : -1;
            card.dataset.slot = String(Math.round(delta));
        });
    }

    function clearCardBindings() {
        state.cardBindings.splice(0).forEach(function (dispose) {
            try { dispose(); } catch (error) {}
        });
    }

    function killCaseTimelines() {
        state.cards.forEach(function (entry) {
            var card = entry && entry.card;
            if (!card || !card.__hero3CaseTimeline) return;
            card.__hero3CaseTimeline.kill();
            card.__hero3CaseTimeline = null;
        });
    }

    function casePhoneShift(card, open) {
        if (!open || !card) return 0;
        var cardRect = card.getBoundingClientRect();
        var projectedOverflow = cardRect.width * 1.16 - cardRect.left + 8;
        var viewportInset = window.innerWidth <= 768 ? 6 : 0;
        return Math.round(Math.max(viewportInset, Math.min(cardRect.width * 0.34, projectedOverflow / 1.4)));
    }

    function setCasePreview(parts, open, immediate) {
        if (!parts || !window.gsap) return;
        var previousTimeline = parts.card && parts.card.__hero3CaseTimeline;
        if (previousTimeline) previousTimeline.kill();
        if (parts.card) parts.card.classList.toggle('is-case-open', Boolean(open));
        var phoneShift = casePhoneShift(parts.card, open);
        var duration = immediate ? 0 : (open ? 0.76 : 0.52);
        var timeline = window.gsap.timeline({
            defaults: { overwrite: 'auto' },
            onComplete: function () {
                if (parts.card && parts.card.__hero3CaseTimeline === timeline) parts.card.__hero3CaseTimeline = null;
            }
        });
        if (parts.card) parts.card.__hero3CaseTimeline = timeline;
        timeline.addLabel('case', 0);
        if (parts.surface) {
            timeline.to(parts.surface, {
                x: phoneShift,
                y: 0,
                rotationX: 0,
                rotationY: 0,
                z: 0,
                scale: 1,
                duration: immediate ? 0 : (open ? 0.68 : 0.46),
                ease: open ? 'power4.inOut' : 'power3.out',
                overwrite: 'auto'
            }, 'case');
        }
        if (parts.lid) {
            timeline.to(parts.lid, {
                x: open ? -8 : 0,
                rotationY: open ? -160 : 0,
                scaleX: 1,
                skewY: 0,
                duration: immediate ? 0 : (open ? 0.76 : 0.52),
                ease: open ? 'power4.inOut' : 'power3.out',
                overwrite: 'auto'
            }, 'case');
        }
        if (parts.caseBack) {
            timeline.to(parts.caseBack, {
                z: open ? -10 : 0,
                scale: open ? 0.994 : 1,
                duration: duration,
                ease: open ? 'power4.inOut' : 'power3.out'
            }, 'case');
        }
        if (parts.caseDisc) {
            timeline.to(parts.caseDisc, {
                y: open ? -18 : 0,
                z: open ? 12 : 0,
                scale: open ? 1.012 : 1,
                rotation: 0,
                autoAlpha: 1,
                duration: immediate ? 0 : (open ? 0.58 : 0.44),
                ease: open ? 'back.out(1.45)' : 'power3.out',
                overwrite: 'auto'
            }, open ? 'case+=0.16' : 'case');
        }
        if (parts.shadow) {
            timeline.to(parts.shadow, {
                autoAlpha: open ? 0 : (parts.card && parts.card.classList.contains('is-active') ? 0.7 : 0.62),
                duration: immediate ? 0 : (open ? 0.42 : 0.38),
                ease: open ? 'power2.in' : 'power3.out'
            }, open ? 'case+=0.08' : 'case+=0.06');
        }
    }

    function bindCard(card, index) {
        var click = function () {
            var delta = shortestIndexDelta(index, state.activeIndex, state.items.length);
            selectIndex(index, delta >= 0 ? 1 : -1, false, true);
        };
        card.addEventListener('click', click);
        state.cardBindings.push(function () { card.removeEventListener('click', click); });

        if (!hasMotion()) return;
        var surface = qs('.hero3__case', card);
        var lid = qs('.hero3__case-lid', card);
        var caseBack = qs('.hero3__case-back', card);
        var caseDisc = qs('.hero3__case-disc', card);
        var shadow = qs('.hero3__card-shadow', card);
        var poster = qs('.hero3__poster', card);
        var caption = qs('.hero3__caption', card);
        var pointer = null;
        var frame = 0;

        function preview(open, immediate) {
            if (open && (!card.classList.contains('is-active') || state.devicePlaying)) return;
            setCasePreview({ card: card, surface: surface, lid: lid, caseBack: caseBack, caseDisc: caseDisc, shadow: shadow }, open, immediate);
        }

        function renderPointer() {
            frame = 0;
            if (!pointer) return;
            var rect = card.getBoundingClientRect();
            var relX = pointer.clientX - rect.left - rect.width / 2;
            var relY = pointer.clientY - rect.top - rect.height / 2;
            var unitX = relX / Math.max(rect.width / 2, 1);
            var unitY = relY / Math.max(rect.height / 2, 1);
            var shadowX = Math.max(2, Math.min(50, 26 - unitX * 22));
            var shadowY = Math.max(4, Math.min(46, 22 - unitY * 16));
            var shadowSkew = Math.max(-8, Math.min(6, -1.1 + unitX * 5.4));
            var shadowScaleX = 1 + Math.min(0.18, Math.abs(unitX) * 0.16);
            var shadowScaleY = 1 + Math.min(0.13, Math.abs(unitY) * 0.11);
            var edgeOpacity = Math.min(0.92, 0.38 + Math.abs(unitX) * 0.48);
            var edgeOffset = 12 + Math.min(16, Math.abs(unitX) * 14);
            window.gsap.to(card, {
                '--shadow-x': shadowX.toFixed(2) + 'px',
                '--shadow-y': shadowY.toFixed(2) + 'px',
                '--shadow-skew': shadowSkew.toFixed(2) + 'deg',
                '--shadow-scale-x': shadowScaleX.toFixed(3),
                '--shadow-scale-y': shadowScaleY.toFixed(3),
                '--edge-opacity': edgeOpacity.toFixed(3),
                '--edge-offset': edgeOffset.toFixed(2) + 'px',
                duration: 0.24,
                ease: 'power3.out',
                overwrite: 'auto'
            });
            var caseOpen = card.classList.contains('is-case-open');
            window.gsap.to(surface, {
                rotationX: caseOpen ? 0 : unitY * 9.5,
                rotationY: caseOpen ? 0 : unitX * -11.5,
                z: caseOpen ? 0 : 40,
                scale: caseOpen ? 1 : 1.022,
                duration: 0.34,
                ease: 'power4.out',
                overwrite: 'auto'
            });
            if (!card.classList.contains('is-case-open')) {
                window.gsap.to(lid, {
                    scaleX: 1,
                    skewY: unitX * -0.7,
                    duration: 0.34,
                    ease: 'power3.out',
                    overwrite: 'auto'
                });
            }
            window.gsap.to(poster, {
                x: unitX * -7,
                y: unitY * -5,
                scale: 1.035,
                duration: 0.36,
                ease: 'power3.out',
                overwrite: 'auto'
            });
            window.gsap.to(caption, {
                x: unitX * 9,
                y: unitY * 7,
                z: 46,
                duration: 0.3,
                ease: 'power3.out',
                overwrite: 'auto'
            });
        }

        function move(event) {
            if (event.pointerType === 'touch') return;
            pointer = event;
            if (!frame) frame = window.requestAnimationFrame(renderPointer);
        }

        function reset(immediate, forceClose) {
            pointer = null;
            if (frame) window.cancelAnimationFrame(frame);
            frame = 0;
            window.gsap.to(card, {
                '--shadow-x': '22px',
                '--shadow-y': card.classList.contains('is-active') ? '12px' : '18px',
                '--shadow-skew': card.classList.contains('is-active') ? '-0.8deg' : '-1.1deg',
                '--shadow-scale-x': '1',
                '--shadow-scale-y': '1',
                '--edge-opacity': card.classList.contains('is-active') ? '0.42' : '0',
                '--edge-offset': '12px',
                duration: immediate ? 0 : 0.38,
                ease: 'power3.out',
                overwrite: true
            });
            window.gsap.to(surface, { x: 0, y: 0, rotationX: 0, rotationY: 0, z: 0, scale: 1, duration: immediate ? 0 : 0.46, ease: 'elastic.out(1, 0.45)', overwrite: true });
            var keepOpen = !forceClose && card.classList.contains('is-active') && (state.deviceHovering || state.devicePlaying);
            preview(keepOpen, immediate);
            window.gsap.to(poster, { x: 0, y: 0, scale: 1, duration: immediate ? 0 : 0.42, ease: 'power3.out', overwrite: true });
            window.gsap.to(caption, { x: 0, y: 0, z: 0, duration: immediate ? 0 : 0.36, ease: 'power3.out', overwrite: true });
        }

        function enter(event) {
            if (event.pointerType === 'touch') return;
        }

        function leave() {
            reset(false, false);
        }

        function focus() {
            reset(false, false);
        }

        function blur() {
            reset(false, false);
        }

        card.addEventListener('pointerenter', enter, { passive: true });
        card.addEventListener('pointermove', move, { passive: true });
        card.addEventListener('pointerleave', leave, { passive: true });
        card.addEventListener('focus', focus);
        card.addEventListener('blur', blur, true);
        entryResetters.push(function () { reset(true, true); });
        state.cardBindings.push(function () {
            card.removeEventListener('pointerenter', enter);
            card.removeEventListener('pointermove', move);
            card.removeEventListener('pointerleave', leave);
            card.removeEventListener('focus', focus);
            card.removeEventListener('blur', blur, true);
            reset(true, true);
        });
    }

    var entryResetters = [];

    function accessibleItemSummary(item) {
        var progress = item.progress || {};
        return [
            '继续观看 ' + item.episodeLabel,
            item.episodeTitle,
            '上次观看 ' + item.lastWatched,
            '本集上映 ' + item.episodeAirDate,
            '观看进度 ' + String(progress.percent || 0) + '%，共 ' + String(progress.total || '--') + ' 话'
        ].filter(Boolean).join('。');
    }

    function resetCardTilts() {
        entryResetters.forEach(function (reset) { reset(); });
    }

    function renderCards() {
        if (!dom.orbit) return;
        clearCardBindings();
        entryResetters = [];
        dom.orbit.innerHTML = state.items.map(function (item, index) {
            var progress = item.progress;
            var meta = 'EP ' + String(progress.watched || 0).padStart(2, '0') + ' / ' + progress.percent + '%';
            var summaryId = 'hero3-card-summary-' + index;
            return [
                '<button class="hero3__card" type="button" role="option" data-index="', index,
                '" data-anime-id="', escapeHtml(item.id), '" aria-label="切换到 ', escapeHtml(item.title),
                '" aria-describedby="', summaryId, '">',
                '<span class="hero3__sr-summary" id="', summaryId, '">', escapeHtml(accessibleItemSummary(item)), '</span>',
                '<span class="hero3__card-shadow" aria-hidden="true"></span>',
                '<span class="hero3__case">',
                '<span class="hero3__case-back" aria-hidden="true">',
                '<span class="hero3__case-back-grid"></span>',
                '<span class="hero3__case-disc"><span class="hero3__disc-art"></span><span class="hero3__disc-spectrum"></span></span>',
                '<span class="hero3__case-back-mark"><b>DISC / ', String(index + 1).padStart(2, '0'), '</b><small>', escapeHtml(item.code), '</small></span>',
                '</span>',
                '<span class="hero3__case-lid">',
                '<span class="hero3__case-cover-face">',
                '<img class="hero3__poster" src="', escapeHtml(item.poster), '" alt="', escapeHtml(item.title), '" decoding="async" loading="eager" fetchpriority="', [0, 6, 1, 5, 2].indexOf(index) >= 0 ? 'high' : 'auto', '">',
                '<span class="hero3__caption"><strong>', escapeHtml(item.title), '</strong><small>', escapeHtml(meta), '</small></span>',
                '</span>',
                '<span class="hero3__case-lid-inside" aria-hidden="true">',
                '<span class="hero3__case-inlay"></span>',
                '<span class="hero3__case-print">',
                '<span class="hero3__inside-kicker">CONTINUE / ', escapeHtml(item.code), '</span>',
                '<span class="hero3__inside-series">', escapeHtml(item.title), '</span>',
                '<span class="hero3__inside-label">CURRENT EPISODE</span>',
                '<strong class="hero3__inside-episode">', escapeHtml(item.episodeLabel), '</strong>',
                '<span class="hero3__inside-title', item.episodeTitlePending ? ' is-pending' : '', '">', escapeHtml(item.episodeTitle), '</span>',
                '<span class="hero3__inside-context">', escapeHtml([item.status, item.date].filter(Boolean).join(' / ') || '媒体库观看记录'), '</span>',
                '<span class="hero3__inside-summary">', escapeHtml(item.synopsis || '该作品暂未提供简介；播放位置与本集信息已从本地媒体库同步。'), '</span>',
                '<span class="hero3__inside-meta">',
                '<span><small>上次观看</small><b>', escapeHtml(item.lastWatched), '</b></span>',
                '<span><small>本集上映</small><b>', escapeHtml(item.episodeAirDate), '</b></span>',
                '<span><small>观看进度</small><b>', escapeHtml(String(progress.percent) + '% / ' + String(progress.total || '--') + ' 话'), '</b></span>',
                '</span>',
                '<span class="hero3__inside-action">碟片已就绪 / 移至下方装载</span>',
                '</span>',
                '</span>',
                '</span>',
                '<span class="hero3__case-spine" aria-hidden="true"></span>',
                '</span>',
                '</button>'
            ].join('');
        }).join('');
        state.cards = qsa('.hero3__card', dom.orbit).map(function (card, index) {
            setDiscArtwork(qs('.hero3__disc-art', card), state.items[index] && state.items[index].poster);
            bindCard(card, index);
            return { card: card, setters: createSetters(card) };
        });
        refreshMetrics();
        state.carouselPosition = state.activeIndex;
        layoutCarousel(state.carouselPosition);
        syncDiscOrigin();
    }

    function renderEntryCloud() {
        if (!dom.entryCloud) return;
        var source = state.pool.length ? state.pool : state.items;
        var entries = [];
        for (var index = 0; index < 120; index += 1) entries.push(source[index % source.length]);
        dom.entryCloud.innerHTML = entries.map(function (item, index) {
            var col = index % 12;
            var row = Math.floor(index / 12);
            var jx = ((seededUnit(index, 3) - 0.5) * 1.7).toFixed(2) + 'vw';
            var jy = ((seededUnit(index, 4) - 0.5) * 1.4).toFixed(2) + 'vh';
            var tilt = ((seededUnit(index, 5) - 0.5) * 13).toFixed(2) + 'deg';
            return '<span class="hero3__entry-mini" data-entry-index="' + index + '" style="--entry-col:' + col + ';--entry-row:' + row + ';--entry-jx:' + jx + ';--entry-jy:' + jy + ';--entry-tilt:' + tilt + '"><img src="' + escapeHtml(item.poster) + '" alt=""></span>';
        }).join('');
    }

    function seededUnit(index, salt) {
        var value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
        return value - Math.floor(value);
    }

    function playEntry() {
        if (state.entryPlayed || !state.cards.length) return;
        state.entryPlayed = true;
        if (!hasMotion()) {
            if (dom.entryCloud) dom.entryCloud.innerHTML = '';
            if (dom.entrySpark) dom.entrySpark.style.display = 'none';
            layoutCarousel(state.carouselPosition);
            return;
        }

        var gsap = window.gsap;
        var minis = qsa('.hero3__entry-mini', dom.entryCloud);
        var entryOrigins = minis.map(function (target) {
            var rect = target.getBoundingClientRect();
            var shellRect = dom.shell.getBoundingClientRect();
            return {
                x: shellRect.left + shellRect.width * 0.5 - (rect.left + rect.width / 2),
                y: shellRect.top + shellRect.height * 0.44 - (rect.top + rect.height / 2)
            };
        });
        state.entryRunning = true;
        state.cards.forEach(function (entry) {
            gsap.set(entry.card, { autoAlpha: 0 });
            gsap.set(qs('.hero3__case', entry.card), { x: 0, y: 0, scale: 1, autoAlpha: 1 });
            gsap.set(qs('.hero3__caption', entry.card), { x: 0, y: 0, autoAlpha: 1 });
        });
        gsap.set([dom.info, dom.zone], { autoAlpha: 0 });
        gsap.set(dom.entrySpark, { xPercent: -50, yPercent: -50, autoAlpha: 0, scale: 0.28, rotation: 0 });
        gsap.set(minis, {
            x: function (i) { return entryOrigins[i].x; },
            y: function (i) { return entryOrigins[i].y; },
            z: -260,
            rotation: function (i) { return (seededUnit(i, 8) - 0.5) * 96; },
            rotationY: function (i) { return (seededUnit(i, 9) - 0.5) * 44; },
            rotationX: function (i) { return (seededUnit(i, 10) - 0.5) * -36; },
            scale: 0.08,
            autoAlpha: 0
        });

        state.entryTimeline = gsap.timeline({
            defaults: { ease: 'power4.out' },
            onComplete: function () {
                state.entryRunning = false;
                if (dom.entryCloud) dom.entryCloud.innerHTML = '';
                layoutCarousel(state.carouselPosition);
                syncDiscOrigin();
            }
        });

        state.entryTimeline
            .to(minis, {
                x: function (i, target) {
                    var col = Number(target.style.getPropertyValue('--entry-col')) || 0;
                    var row = Number(target.style.getPropertyValue('--entry-row')) || 0;
                    var angle = Math.atan2(row - 4.5, col - 5.5);
                    return entryOrigins[i].x + Math.cos(angle) * (88 + seededUnit(i, 14) * 168);
                },
                y: function (i, target) {
                    var col = Number(target.style.getPropertyValue('--entry-col')) || 0;
                    var row = Number(target.style.getPropertyValue('--entry-row')) || 0;
                    var angle = Math.atan2(row - 4.5, col - 5.5);
                    return entryOrigins[i].y + Math.sin(angle) * (70 + seededUnit(i, 15) * 132);
                },
                rotation: function (i) { return (seededUnit(i, 18) - 0.5) * 156; },
                scale: 0.16,
                autoAlpha: 0.9,
                duration: 0.22,
                stagger: { amount: 0.12, from: 'center' },
                ease: 'power3.out'
            }, 0.04)
            .to(minis, {
                x: 0,
                y: 0,
                z: 0,
                rotation: function (_, target) { return target.style.getPropertyValue('--entry-tilt') || '0deg'; },
                rotationY: function (i) { return (seededUnit(i, 11) - 0.5) * 16; },
                rotationX: function (i) { return (seededUnit(i, 12) - 0.5) * 12; },
                scale: 0.96,
                autoAlpha: 0.82,
                duration: 0.48,
                stagger: { amount: 0.18, from: 'random' },
                ease: 'back.out(1.1)'
            }, 0.2)
            .to(minis, {
                x: function (i) { var col = i % 12; return (col < 6 ? -1 : 1) * (window.innerWidth * (0.22 + Math.abs(col - 5.5) * 0.034)); },
                y: function (i) { return (Math.floor(i / 12) - 4.5) * 24; },
                z: -320,
                rotationY: function (i) { return i % 12 < 6 ? 30 : -30; },
                rotationX: function (i) { return (Math.floor(i / 12) - 4.5) * -2.6; },
                scale: 0.56,
                autoAlpha: 0.12,
                duration: 0.34,
                stagger: { grid: [10, 12], each: 0.003, from: 'center' },
                ease: 'expo.inOut'
            }, 0.82)
            .to(dom.entrySpark, { autoAlpha: 1, scale: 1, rotation: 45, duration: 0.12, ease: 'power2.out' }, 1.02)
            .to(dom.entrySpark, { autoAlpha: 0, scale: 2.2, rotation: 120, duration: 0.3, ease: 'power3.out' }, 1.14)
            .call(function () {
                state.entryRunning = false;
                layoutCarousel(state.carouselPosition);
                state.entryRunning = true;
                state.cards.forEach(function (entry) {
                    if (entry.card.getAttribute('aria-hidden') === 'false') {
                        gsap.set(entry.card, { autoAlpha: 0 });
                        gsap.set(qs('.hero3__case', entry.card), { x: Number(entry.card.dataset.slot || 0) * -34, scale: 0.96 });
                    }
                });
            }, null, 1.08)
            .to(minis, { autoAlpha: 0, duration: 0.18, ease: 'power2.out' }, 1.08)
            .to(state.cards.map(function (entry) { return entry.card; }).filter(function (card) { return card.getAttribute('aria-hidden') === 'false'; }), {
                autoAlpha: function (_, target) { return Math.max(0.6, 1 - Math.abs(Number(target.getAttribute('data-slot')) || 0) * 0.13); },
                duration: 0.4,
                stagger: { each: 0.024, from: 'center' },
                ease: 'power3.out'
            }, 1.12)
            .to(state.cards.map(function (entry) { return qs('.hero3__case', entry.card); }), { x: 0, scale: 1, duration: 0.48, stagger: { each: 0.022, from: 'center' }, ease: 'power4.out' }, 1.12)
            .fromTo(state.cards.map(function (entry) { return qs('.hero3__caption', entry.card); }), { y: 10, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.26, stagger: { each: 0.018, from: 'center' }, ease: 'power3.out' }, 1.24)
            .fromTo([dom.info, dom.zone], { y: 18, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.3, stagger: 0.035 }, 1.38)
            .set(dom.entryCloud, { autoAlpha: 0, display: 'none' }, 1.62)
            .call(function () { state.entryRunning = false; layoutCarousel(state.carouselPosition); syncDiscOrigin(); }, null, 1.72);
    }

    function preloadImage(url, options) {
        if (!url) return Promise.resolve(false);
        if (state.imagePromises[url]) return state.imagePromises[url];
        options = options || {};
        state.imagePromises[url] = new Promise(function (resolve) {
            var settled = false;
            var image = new Image();
            image.decoding = 'async';
            if ('fetchPriority' in image) image.fetchPriority = options.priority || 'auto';
            state.preloadStarts.push({
                index: Number(options.index) || 0,
                reason: options.reason || 'artwork',
                priority: options.priority || 'auto',
                url: url
            });
            function finish(value) {
                if (settled) return;
                settled = true;
                resolve(value);
            }
            image.onload = function () {
                if (image.decode) image.decode().catch(function () {}).then(function () { finish(true); });
                else finish(true);
            };
            image.onerror = function () { finish(false); };
            image.src = url;
            if (image.complete && image.naturalWidth) image.onload();
        });
        return state.imagePromises[url];
    }

    function preloadIndexes(length, activeIndex) {
        var editorialOrder = [0, 6, 1, 5, 2, 4, 3];
        var indexes = [];
        var preferred = Math.max(0, Math.min(length - 1, Number(activeIndex) || 0));
        if (length) indexes.push(preferred);
        editorialOrder.forEach(function (index) {
            if (index < length && indexes.indexOf(index) < 0) indexes.push(index);
        });
        for (var index = 0; index < length; index += 1) {
            if (indexes.indexOf(index) < 0) indexes.push(index);
        }
        return indexes;
    }

    function preloadItems(items, activeIndex) {
        var source = items || [];
        var indexes = preloadIndexes(source.length, activeIndex);
        var seen = {};
        var posterTasks = [];
        state.preloadPlan = indexes.map(function (index) { return index + 1; });

        // Start all cover requests first in the visual reading order.  Wide
        // backdrops follow afterwards so card 7 cannot be starved by cards 2-6.
        indexes.forEach(function (index, order) {
            var url = source[index] && source[index].poster;
            if (!url || seen[url]) return;
            seen[url] = true;
            posterTasks.push(preloadImage(url, {
                index: index + 1,
                reason: 'poster',
                priority: order < 5 ? 'high' : 'auto'
            }));
        });
        indexes.forEach(function (index) {
            var url = source[index] && source[index].backdrop;
            if (!url || seen[url]) return;
            seen[url] = true;
            preloadImage(url, {
                index: index + 1,
                reason: 'backdrop',
                priority: index === activeIndex ? 'high' : 'auto'
            });
        });
        return Promise.all(posterTasks);
    }

    function revealArtwork(node) {
        if (!node || !hasMotion() || typeof node.animate !== 'function') return;
        if (node.__hero3ArtworkReveal) node.__hero3ArtworkReveal.cancel();
        node.__hero3ArtworkReveal = node.animate([
            { opacity: 0.32, filter: 'contrast(0.78) saturate(0.82)' },
            { opacity: 1, filter: 'contrast(1) saturate(1)' }
        ], {
            duration: 220,
            easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
            fill: 'none'
        });
        node.__hero3ArtworkReveal.onfinish = function () { node.__hero3ArtworkReveal = null; };
        node.__hero3ArtworkReveal.oncancel = function () { node.__hero3ArtworkReveal = null; };
    }

    function updateCardArtwork(item) {
        var card = qs('.hero3__card[data-anime-id="' + String(item.id).replace(/"/g, '\\"') + '"]', dom.orbit);
        var image = card ? qs('.hero3__poster', card) : null;
        if (!image || !item.poster || image.getAttribute('src') === item.poster) return;
        preloadImage(item.poster).then(function (loaded) {
            if (!loaded || !image.isConnected || image.getAttribute('src') === item.poster) return;
            var discArtwork = card ? qs('.hero3__disc-art', card) : null;
            image.src = item.poster;
            setDiscArtwork(discArtwork, item.poster);
            revealArtwork(image);
            revealArtwork(discArtwork);
        });
    }

    function updateCardMetadata(item) {
        var card = qs('.hero3__card[data-anime-id="' + String(item.id).replace(/"/g, '\\"') + '"]', dom.orbit);
        if (!card) return;
        var progress = item.progress;
        var captionTitle = qs('.hero3__caption strong', card);
        var captionMeta = qs('.hero3__caption small', card);
        var insideSeries = qs('.hero3__inside-series', card);
        var insideEpisode = qs('.hero3__inside-episode', card);
        var insideTitle = qs('.hero3__inside-title', card);
        var insideContext = qs('.hero3__inside-context', card);
        var insideSummary = qs('.hero3__inside-summary', card);
        var insideMeta = qsa('.hero3__inside-meta b', card);
        var summary = qs('.hero3__sr-summary', card);
        card.setAttribute('aria-label', '切换到 ' + item.title);
        if (captionTitle) captionTitle.textContent = item.title;
        if (captionMeta) captionMeta.textContent = 'EP ' + String(progress.watched || 0).padStart(2, '0') + ' / ' + progress.percent + '%';
        if (insideSeries) insideSeries.textContent = item.title;
        if (insideEpisode) insideEpisode.textContent = item.episodeLabel;
        if (insideTitle) {
            insideTitle.textContent = item.episodeTitle;
            insideTitle.classList.toggle('is-pending', Boolean(item.episodeTitlePending));
        }
        if (insideContext) insideContext.textContent = [item.status, item.date].filter(Boolean).join(' / ') || '媒体库观看记录';
        if (insideSummary) insideSummary.textContent = item.synopsis || '该作品暂未提供简介；播放位置与本集信息已从本地媒体库同步。';
        if (insideMeta[0]) insideMeta[0].textContent = item.lastWatched;
        if (insideMeta[1]) insideMeta[1].textContent = item.episodeAirDate;
        if (insideMeta[2]) insideMeta[2].textContent = String(progress.percent) + '% / ' + String(progress.total || '--') + ' 话';
        if (summary) summary.textContent = accessibleItemSummary(item);
    }

    function syncDiscArtwork(item) {
        if (!item) return;
        setDiscArtwork(dom.discArt, item.poster);
        setDiscArtwork(dom.loadedDiscArt, item.poster);
    }

    function updateBackdrop(item, immediate) {
        if (!dom.backdropA || !dom.backdropB || !item) return;
        var url = item.backdrop || item.poster;
        if (!url) return;
        var front = state.backdropFront === 'A' ? dom.backdropA : dom.backdropB;
        var back = state.backdropFront === 'A' ? dom.backdropB : dom.backdropA;
        var backName = state.backdropFront === 'A' ? 'B' : 'A';
        var nextRatio = item.backdropKind === 'wide' ? 'wide' : 'poster';

        if (front.getAttribute('src') === url && front.classList.contains('is-active')) {
            state.backdropTargetUrl = url;
            front.setAttribute('data-ratio', nextRatio);
            dom.backdrop.setAttribute('data-ratio', nextRatio);
            return;
        }

        if (state.backdropTargetUrl === url && (front.getAttribute('src') === url || back.getAttribute('src') === url)) {
            if (front.getAttribute('src') === url) {
                front.setAttribute('data-ratio', nextRatio);
                dom.backdrop.setAttribute('data-ratio', nextRatio);
            }
            if (back.getAttribute('src') === url) back.setAttribute('data-ratio', nextRatio);
            return;
        }

        state.backdropTargetUrl = url;
        var requestId = ++state.backdropRequest;
        if (state.backdropTimeline) {
            state.backdropTimeline.kill();
            state.backdropTimeline = null;
        }
        if (window.gsap) window.gsap.killTweensOf([front, back]);
        dom.backdrop.classList.remove('is-switching');

        function clearLayerStyles(layer) {
            layer.style.removeProperty('opacity');
            layer.style.removeProperty('visibility');
            layer.style.removeProperty('transform');
            layer.style.removeProperty('clip-path');
        }

        front.classList.add('is-active');
        back.classList.remove('is-active');
        front.style.zIndex = '1';
        back.style.zIndex = '2';
        clearLayerStyles(front);
        clearLayerStyles(back);

        var revealed = false;
        var decodeStarted = false;

        function reveal() {
            if (revealed || requestId !== state.backdropRequest) return;
            revealed = true;
            back.onload = null;
            back.onerror = null;
            var nextScale = nextRatio === 'poster' ? 1.15 : 1.045;
            var previousRatio = front.getAttribute('data-ratio') === 'poster' ? 'poster' : 'wide';
            var previousScale = previousRatio === 'poster' ? 1.17 : 1.06;
            dom.backdrop.setAttribute('data-ratio', nextRatio);
            back.setAttribute('data-ratio', nextRatio);
            back.style.zIndex = '2';
            front.style.zIndex = '1';
            if (window.gsap) window.gsap.killTweensOf([front, back]);
            if (immediate || !hasMotion()) {
                back.classList.add('is-active');
                front.classList.remove('is-active');
                clearLayerStyles(front);
                clearLayerStyles(back);
                dom.backdrop.classList.remove('is-switching');
                state.backdropFront = backName;
            } else {
                var targetOpacity = document.documentElement.getAttribute('data-theme') === 'light' ? 0.5 : 0.68;
                back.classList.add('is-active');
                front.classList.add('is-active');
                dom.backdrop.classList.add('is-switching');
                state.backdropFront = backName;
                window.gsap.set(back, {
                    autoAlpha: 0,
                    scale: nextScale + 0.07,
                    xPercent: 2.4,
                    clipPath: 'polygon(47% 0%, 55% 0%, 51% 100%, 43% 100%)'
                });
                window.gsap.set(front, {
                    autoAlpha: targetOpacity,
                    scale: previousScale,
                    xPercent: 0,
                    clipPath: 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)'
                });
                state.backdropTimeline = window.gsap.timeline({
                    defaults: { overwrite: 'auto' },
                    onComplete: function () {
                        if (requestId !== state.backdropRequest) return;
                        state.backdropTimeline = null;
                        front.classList.remove('is-active');
                        dom.backdrop.classList.remove('is-switching');
                        window.gsap.set(front, { autoAlpha: 0, xPercent: 0, scale: previousScale });
                        clearLayerStyles(front);
                        clearLayerStyles(back);
                    }
                })
                    .to(front, {
                        autoAlpha: targetOpacity * 0.36,
                        scale: previousScale + 0.04,
                        xPercent: -1.4,
                        duration: 0.68,
                        ease: 'power2.inOut'
                    }, 0)
                    .to(back, {
                        autoAlpha: targetOpacity,
                        scale: nextScale,
                        xPercent: 0,
                        clipPath: 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)',
                        duration: 0.88,
                        ease: 'expo.inOut'
                    }, 0.03)
                    .to(front, {
                        autoAlpha: 0,
                        duration: 0.28,
                        ease: 'power2.in'
                    }, 0.58);
            }
        }

        function decodeAndReveal() {
            if (decodeStarted || requestId !== state.backdropRequest) return;
            decodeStarted = true;
            if (back.decode) back.decode().catch(function () {}).then(reveal);
            else reveal();
        }

        back.onload = decodeAndReveal;
        back.onerror = function () {
            if (requestId !== state.backdropRequest) return;
            back.onload = null;
            back.onerror = null;
            back.classList.remove('is-active');
            clearLayerStyles(back);
            state.backdropTargetUrl = front.getAttribute('src') || '';
        };
        if (back.getAttribute('src') === url && back.complete && back.naturalWidth) decodeAndReveal();
        else back.src = url;
    }

    function updateInfo(item) {
        if (!item) return;
        var progress = item.progress;
        var metaText = 'EP ' + String(progress.watched || 0).padStart(2, '0') + ' / ' + progress.percent + '% / ' + item.date;
        if (dom.title) dom.title.textContent = item.title;
        if (dom.meta) dom.meta.textContent = metaText;
        if (dom.description) {
            dom.description.textContent = item.synopsis || '';
            dom.description.hidden = !item.synopsis;
        }
        if (dom.badge && dom.badgeText) {
            dom.badgeText.textContent = item.status || '';
            dom.badge.hidden = !item.status;
            dom.badge.style.display = item.status ? '' : 'none';
        }
        if (dom.index) dom.index.textContent = String(state.activeIndex + 1).padStart(2, '0');
        if (dom.code) dom.code.textContent = item.code;
        if (dom.action) dom.action.setAttribute('aria-label', '继续播放 ' + item.title);
        if (dom.mechMeta) dom.mechMeta.textContent = 'EP ' + String(progress.watched || 0).padStart(2, '0') + ' / LOAD + RESUME';
        syncDiscArtwork(item);
        if (dom.hero) {
            dom.hero.setAttribute('data-hero-state', 'ready');
            dom.hero.setAttribute('data-active-anime-id', item.id);
        }
    }

    function selectIndex(nextIndex, direction, immediate, notify) {
        var total = state.items.length;
        if (!total) return;
        var moveFocus = document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('hero3__card');
        nextIndex = window.gsap ? window.gsap.utils.wrap(0, total, nextIndex) : ((nextIndex % total) + total) % total;
        var previousIndex = state.activeIndex;
        var delta = shortestIndexDelta(nextIndex, previousIndex, total);
        if (nextIndex === previousIndex && !immediate) return;

        resetDevice(true, true);
        resetCardTilts();
        state.activeIndex = nextIndex;
        var item = state.items[nextIndex];

        if (immediate || !hasMotion()) {
            updateInfo(item);
            updateBackdrop(item, Boolean(immediate));
            state.carouselPosition = nextIndex;
            layoutCarousel(state.carouselPosition);
            syncDiscOrigin();
            if (notify && state.options && typeof state.options.onSelect === 'function') {
                state.options.onSelect(item.raw, item);
            }
        } else {
            var start = state.carouselPosition;
            var target = start + delta;
            var proxy = { value: start };
            if (state.carouselTween) state.carouselTween.kill();
            state.carouselTween = window.gsap.to(proxy, {
                value: target,
                duration: 0.86,
                ease: 'power3.inOut',
                overwrite: true,
                onUpdate: function () {
                    state.carouselPosition = proxy.value;
                    layoutCarousel(state.carouselPosition);
                },
                onComplete: function () {
                    state.carouselPosition = target;
                    layoutCarousel(state.carouselPosition);
                    state.carouselTween = null;
                    syncDiscOrigin();
                }
            });
            window.gsap.timeline({ defaults: { overwrite: 'auto' } })
                .to(dom.info, { y: direction >= 0 ? -8 : 8, autoAlpha: 0, duration: 0.14, ease: 'power2.in' }, 0)
                .call(function () {
                    updateInfo(item);
                    updateBackdrop(item, false);
                    if (notify && state.options && typeof state.options.onSelect === 'function') {
                        state.options.onSelect(item.raw, item);
                    }
                }, null, 0.38)
                .fromTo(dom.info, { y: direction >= 0 ? 12 : -12, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.32, ease: 'power3.out' }, 0.44);
        }
        if (moveFocus && state.cards[nextIndex] && state.cards[nextIndex].card) {
            try { state.cards[nextIndex].card.focus({ preventScroll: true }); }
            catch (error) { state.cards[nextIndex].card.focus(); }
        }
    }

    function activeCardParts() {
        var active = state.cards[state.activeIndex] && state.cards[state.activeIndex].card;
        return {
            card: active,
            surface: active ? qs('.hero3__case', active) : null,
            lid: active ? qs('.hero3__case-lid', active) : null,
            caseBack: active ? qs('.hero3__case-back', active) : null,
            caseDisc: active ? qs('.hero3__case-disc', active) : null,
            shadow: active ? qs('.hero3__card-shadow', active) : null,
            discArt: active ? qs('.hero3__disc-art', active) : null,
            caption: active ? qs('.hero3__caption', active) : null
        };
    }

    function configureLiftGuide(path) {
        if (!path || !dom.guide) return;
        dom.guide.style.left = path.startX.toFixed(2) + 'px';
        dom.guide.style.top = path.startY.toFixed(2) + 'px';
        dom.guide.style.width = (path.discSize + 48).toFixed(2) + 'px';
        dom.guide.style.height = path.distance.toFixed(2) + 'px';
        dom.guide.style.transform = 'translateX(-50%) rotate(' + path.guideAngle.toFixed(3) + 'deg)';
    }

    function measureDiscPath(sourceOffsetX) {
        var parts = activeCardParts();
        if (!parts.caseDisc || !dom.shell || !dom.tray || !dom.disc) return null;
        var shellRect = dom.shell.getBoundingClientRect();
        var sourceRect = parts.caseDisc.getBoundingClientRect();
        var currentLift = window.gsap ? Number(window.gsap.getProperty(parts.caseDisc, 'y')) || 0 : 0;
        var desiredLift = -18;
        var carouselMoving = Boolean(state.carouselTween && typeof state.carouselTween.isActive === 'function' && state.carouselTween.isActive());
        var logicalDiameter = parts.caseDisc.offsetWidth || state.mediaDiameter || 210;
        if (!state.mediaDiameter || !carouselMoving) state.mediaDiameter = logicalDiameter;
        logicalDiameter = state.mediaDiameter || logicalDiameter;
        if (dom.action) dom.action.style.setProperty('--loaded-disc-size', logicalDiameter.toFixed(2) + 'px');
        var targetRect = dom.tray.getBoundingClientRect();
        var discDiameter = dom.disc.offsetWidth || 210;
        var path = {
            startX: sourceRect.left + sourceRect.width / 2 - shellRect.left + (Number(sourceOffsetX) || 0),
            startY: sourceRect.top + sourceRect.height / 2 - shellRect.top + desiredLift - currentLift,
            startScale: logicalDiameter / Math.max(discDiameter, 1),
            targetX: targetRect.left + targetRect.width / 2 - shellRect.left,
            targetY: targetRect.top + targetRect.height / 2 - shellRect.top,
            discSize: logicalDiameter
        };
        var dx = path.targetX - path.startX;
        var dy = path.targetY - path.startY;
        path.distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        path.guideAngle = -Math.atan2(dx, dy) * 180 / Math.PI;
        configureLiftGuide(path);
        return path;
    }

    function syncDiscOrigin() {
        var path = measureDiscPath();
        if (!path || !dom.disc || !window.gsap || state.devicePlaying) return path;
        window.gsap.set(dom.disc, {
            xPercent: -50,
            yPercent: -50,
            x: path.startX,
            y: path.startY,
            scale: path.startScale,
            rotation: 0,
            autoAlpha: 0
        });
        return path;
    }

    function resetDevice(immediate, force) {
        if (state.devicePlaying && !force) return;
        state.deviceHovering = false;
        if (force) {
            state.devicePlaying = false;
            state.playRequest += 1;
        }
        if (state.deviceTimeline) {
            state.deviceTimeline.kill();
            state.deviceTimeline = null;
        }
        if (state.deviceSpin) {
            state.deviceSpin.kill();
            state.deviceSpin = null;
        }
        qsa('.hero3__transfer').forEach(function (node) { node.remove(); });
        if (!dom.disc || !window.gsap) return;
        var parts = activeCardParts();
        if (dom.action) {
            dom.action.classList.remove('is-armed', 'is-loading', 'is-playing');
            dom.action.setAttribute('aria-busy', 'false');
        }
        if (dom.loadState) dom.loadState.textContent = 'READY';
        syncDiscOrigin();
        window.gsap.killTweensOf([dom.disc, dom.guide, dom.guideCoupler, dom.tray, dom.deckLid, dom.loadedDisc, dom.mechButton, dom.led, parts.surface, parts.lid, parts.caseBack, parts.caseDisc, parts.shadow, parts.caption].concat(dom.guideRails || []).filter(Boolean));
        window.gsap.set(dom.disc, { rotation: 0, autoAlpha: 0 });
        if (dom.guide) window.gsap.set(dom.guide, { autoAlpha: 0 });
        if (dom.guideRails && dom.guideRails.length) window.gsap.set(dom.guideRails, { scaleY: 0, transformOrigin: '50% 0%' });
        if (dom.guideCoupler) window.gsap.set(dom.guideCoupler, { y: 0, autoAlpha: 0 });
        window.gsap.to(dom.tray, { y: 0, scale: 1, duration: immediate ? 0 : 0.42, ease: 'power3.out', overwrite: true });
        window.gsap.to(dom.deckLid, { y: 0, duration: immediate ? 0 : 0.34, ease: 'power3.out', overwrite: true });
        window.gsap.set(dom.loadedDisc, { xPercent: -50, yPercent: -50, rotation: 0, autoAlpha: 0, scale: 1 });
        setCasePreview(parts, false, immediate);
        if (parts.caption) window.gsap.set(parts.caption, { autoAlpha: 1 });
        window.gsap.to(dom.mechButton, { y: 0, duration: immediate ? 0 : 0.18, ease: 'power2.out', overwrite: true });
        window.gsap.to(dom.led, { opacity: 0.48, duration: immediate ? 0 : 0.18, overwrite: true });
    }

    function startDeviceHover() {
        if (!hasMotion() || state.devicePlaying || state.deviceHovering) return;
        resetCardTilts();
        state.deviceHovering = true;
        var parts = activeCardParts();
        if (dom.action) dom.action.classList.add('is-armed');
        window.gsap.killTweensOf([dom.tray, dom.deckLid, dom.mechButton, dom.led, dom.guide, dom.guideCoupler, parts.surface, parts.lid, parts.caseBack, parts.caseDisc, parts.shadow].concat(dom.guideRails || []).filter(Boolean));
        setCasePreview(parts, true, false);
        window.gsap.to(dom.tray, { y: -14, scale: 1.025, duration: 0.54, ease: 'power4.out', overwrite: true });
        window.gsap.to(dom.deckLid, { y: -22, duration: 0.46, ease: 'power3.out', overwrite: true });
        window.gsap.to(dom.mechButton, { y: 1, duration: 0.16, ease: 'power2.out', overwrite: true });
        window.gsap.to(dom.led, { opacity: 1, duration: 0.22, ease: 'power3.out', overwrite: true });
        if (dom.guide) window.gsap.set(dom.guide, { autoAlpha: 0 });
    }

    function normalizePlayIntent(result) {
        if (typeof result === 'function') {
            return { transition: true, commit: result };
        }
        if (result && typeof result === 'object' && typeof result.commit === 'function') {
            return {
                transition: result.transition !== false,
                destination: result.destination || null,
                commit: result.commit
            };
        }
        return { transition: false, commit: function () {} };
    }

    function requestPlayIntent(item) {
        if (!state.options || typeof state.options.onPlay !== 'function') {
            return Promise.resolve(normalizePlayIntent(null));
        }
        try {
            return Promise.resolve(state.options.onPlay(item.raw, item))
                .then(normalizePlayIntent)
                .catch(function () { return normalizePlayIntent(null); });
        } catch (error) {
            return Promise.resolve(normalizePlayIntent(null));
        }
    }

    function recoverPlaybackNavigation(requestId) {
        if (!requestId || requestId !== state.playRequest) return;
        if (window.DdpRouteMorph && typeof window.DdpRouteMorph.cancel === 'function') {
            try { window.DdpRouteMorph.cancel(); } catch (error) {}
        }
        resetDevice(false, true);
    }

    function commitPlayIntent(intent, requestId) {
        if (!intent || typeof intent.commit !== 'function') return false;
        var hrefBeforeCommit = window.location.href;
        try {
            var result = intent.commit();
            if (result && typeof result.then === 'function') {
                Promise.resolve(result).catch(function () { recoverPlaybackNavigation(requestId); });
            }
        } catch (error) {
            recoverPlaybackNavigation(requestId);
            return false;
        }
        if (requestId && intent.destination) {
            window.setTimeout(function () {
                if (window.location.href === hrefBeforeCommit) recoverPlaybackNavigation(requestId);
            }, 1800);
        }
        return true;
    }

    function createLegacyTransfer() {
        var transfer = document.createElement('div');
        var targetRect = dom.tray.getBoundingClientRect();
        transfer.className = 'hero3__transfer';
        transfer.innerHTML = '<span>正在进入播放</span>';
        transfer.style.setProperty('--transfer-x', (targetRect.left + targetRect.width / 2).toFixed(1) + 'px');
        transfer.style.setProperty('--transfer-y', (targetRect.top + targetRect.height / 2).toFixed(1) + 'px');
        document.body.appendChild(transfer);
        return transfer;
    }

    function runPlaybackExit(intent, item, requestId) {
        if (!window.gsap || requestId !== state.playRequest) return;
        var cards = state.cards.map(function (entry) { return entry.card; });
        var frameParts = [qs('.hero3__frame'), qs('.hero3__register'), qs('.hero3__art-switch')].filter(Boolean);
        if (dom.action) dom.action.classList.add('is-playing');
        if (dom.loadState) dom.loadState.textContent = 'PLAY';
        state.deviceTimeline = window.gsap.timeline({
            defaults: { ease: 'power3.inOut', overwrite: 'auto' }
        });
        state.deviceTimeline
            .addLabel('exit', 0)
            .to(dom.loadedDisc, { rotation: '+=420_cw', scale: 1.02, duration: 0.76, ease: 'none' }, 'exit')
            .to(dom.zone, { y: 10, scale: 0.985, autoAlpha: 0.52, duration: 0.62 }, 'exit+=0.08')
            .to(cards, { y: '-=10', scale: 0.99, autoAlpha: 0.28, duration: 0.56, stagger: { each: 0.018, from: 'center' }, ease: 'power2.inOut' }, 'exit+=0.1')
            .to(frameParts, { autoAlpha: 0.24, duration: 0.42, stagger: 0.025 }, 'exit+=0.16')
            .to(dom.backdrop, { scale: 1.025, autoAlpha: 0.56, duration: 0.76, ease: 'power2.inOut' }, 'exit+=0.04');

        if (window.DdpRouteMorph && typeof window.DdpRouteMorph.exit === 'function') {
            Promise.resolve(window.DdpRouteMorph.exit({
                originElement: dom.loadedDisc,
                artworkUrl: item && item.poster,
                backdropUrl: item && (item.backdrop || item.poster),
                title: item && item.title,
                destination: intent.destination || null
            })).then(function () {
                if (requestId !== state.playRequest) return;
                if (state.deviceSpin) {
                    state.deviceSpin.kill();
                    state.deviceSpin = null;
                }
                commitPlayIntent(intent, requestId);
            }).catch(function () {
                if (requestId === state.playRequest) commitPlayIntent(intent, requestId);
            });
            return;
        }

        var transfer = createLegacyTransfer();
        window.gsap.timeline({ defaults: { overwrite: 'auto' } })
            .fromTo(transfer, {
                autoAlpha: 0,
                clipPath: 'circle(0 at var(--transfer-x) var(--transfer-y))'
            }, {
                autoAlpha: 1,
                clipPath: 'circle(22vmax at var(--transfer-x) var(--transfer-y))',
                duration: 0.36,
                ease: 'power2.in'
            })
            .to(transfer, {
                clipPath: 'circle(150vmax at var(--transfer-x) var(--transfer-y))',
                duration: 0.64,
                ease: 'expo.inOut'
            })
            .call(function () {
                if (requestId === state.playRequest) commitPlayIntent(intent, requestId);
            });
    }

    function executePlay() {
        if (!state.items.length || state.devicePlaying) return;
        var activeItem = state.items[state.activeIndex];
        var requestId = ++state.playRequest;
        var intentPromise = requestPlayIntent(activeItem);
        if (!hasMotion()) {
            intentPromise.then(commitPlayIntent);
            return;
        }

        startDeviceHover();
        state.devicePlaying = true;
        state.deviceHovering = false;
        var parts = activeCardParts();
        var playPhoneShift = casePhoneShift(parts.card, true);
        if (parts.card && parts.card.__hero3CaseTimeline) {
            parts.card.__hero3CaseTimeline.kill();
            parts.card.__hero3CaseTimeline = null;
        }
        window.gsap.killTweensOf([dom.tray, dom.deckLid].filter(Boolean));
        window.gsap.set(dom.tray, { y: -14, scale: 1.025 });
        window.gsap.set(dom.deckLid, { y: -22 });
        var currentSurfaceX = parts.surface ? Number(window.gsap.getProperty(parts.surface, 'x')) || 0 : 0;
        var path = measureDiscPath(playPhoneShift - currentSurfaceX);
        if (!path || !parts.lid || !parts.caseDisc) {
            state.devicePlaying = false;
            intentPromise.then(commitPlayIntent);
            return;
        }
        if (dom.action) {
            dom.action.classList.add('is-loading');
            dom.action.setAttribute('aria-busy', 'true');
        }
        if (dom.loadState) dom.loadState.textContent = 'READ';
        syncDiscArtwork(activeItem);

        window.gsap.killTweensOf([dom.disc, dom.guide, dom.guideCoupler, dom.tray, dom.deckLid, dom.loadedDisc, dom.mechButton, dom.led, parts.surface, parts.lid, parts.caseBack, parts.caseDisc, parts.shadow, parts.caption].concat(dom.guideRails || []).filter(Boolean));
        window.gsap.set(dom.disc, {
            xPercent: -50,
            yPercent: -50,
            x: path.startX,
            y: path.startY,
            scale: path.startScale,
            rotation: 0,
            autoAlpha: 0
        });
        window.gsap.set(dom.loadedDisc, { xPercent: -50, yPercent: -50, rotation: 0, autoAlpha: 0, scale: 1 });
        if (dom.guide) window.gsap.set(dom.guide, { autoAlpha: 1 });
        if (dom.guideRails && dom.guideRails.length) window.gsap.set(dom.guideRails, { scaleY: 0, transformOrigin: '50% 0%' });
        if (dom.guideCoupler) window.gsap.set(dom.guideCoupler, { y: 0, autoAlpha: 0 });
        var animationResolve;
        var animationPromise = new Promise(function (resolve) { animationResolve = resolve; });
        state.deviceTimeline = window.gsap.timeline({
            defaults: { ease: 'power3.inOut', overwrite: 'auto' },
            onComplete: function () {
                if (requestId !== state.playRequest) return;
                state.deviceTimeline = null;
                state.deviceSpin = window.gsap.to(dom.loadedDisc, {
                    rotation: '+=360_cw',
                    duration: 0.82,
                    repeat: -1,
                    ease: 'none',
                    overwrite: false
                });
                animationResolve();
            }
        });
        state.deviceTimeline
            .addLabel('open', 0)
            .to(dom.mechButton, { y: 5, duration: 0.16, ease: 'power2.in' }, 'open')
            .to(dom.tray, { y: -14, scale: 1.025, duration: 0.28, ease: 'power3.out' }, 'open')
            .to(dom.deckLid, { y: -22, duration: 0.28, ease: 'power3.out' }, 'open')
            .to(parts.surface, { x: playPhoneShift, y: 0, rotationX: 0, rotationY: 0, z: 0, scale: 1, duration: 0.68, ease: 'power4.inOut' }, 'open')
            .to(parts.lid, { x: -8, rotationY: -160, scaleX: 1, skewY: 0, duration: 0.72, ease: 'power4.inOut' }, 'open')
            .to(parts.caseBack, { z: -10, scale: 0.994, duration: 0.72, ease: 'power4.inOut' }, 'open')
            .to(parts.shadow, { autoAlpha: 0, duration: 0.42, ease: 'power2.in' }, 'open+=0.08')
            .to(parts.caption, { autoAlpha: 0.18, duration: 0.24 }, 'open+=0.08')
            .to(parts.caseDisc, { y: -18, z: 12, scale: 1.012, rotation: 0, duration: 0.48, ease: 'back.out(1.45)' }, 'open+=0.18')
            .set(dom.guide, { autoAlpha: 0.74 }, 'open+=0.28')
            .to(dom.guideRails, { scaleY: 1, duration: 0.48, ease: 'power3.out', stagger: 0.04 }, 'open+=0.28')
            .to(dom.guideCoupler, { autoAlpha: 1, duration: 0.18 }, 'open+=0.42')
            .addLabel('lock', 0.58)
            .set(dom.disc, { autoAlpha: 1 }, 'lock')
            .set(parts.caseDisc, { autoAlpha: 0 }, 'lock+=0.01')
            .addLabel('transfer', 0.64)
            .to(dom.disc, { x: path.targetX, y: path.targetY, rotation: 0, duration: 0.92, ease: 'power2.inOut' }, 'transfer')
            .to(dom.guideCoupler, { y: path.distance, duration: 0.92, ease: 'power2.inOut' }, 'transfer')
            .addLabel('dock', 1.55)
            .set(dom.loadedDisc, { autoAlpha: 1, rotation: 0 }, 'dock')
            .set(dom.disc, { autoAlpha: 0 }, 'dock+=0.01')
            .to(dom.loadedDisc, { rotation: 720, duration: 1.02, ease: 'none' }, 'dock')
            .to(dom.guideCoupler, { autoAlpha: 0, duration: 0.16, ease: 'power2.out' }, 'dock')
            .to(dom.guideRails, { scaleY: 0, duration: 0.34, ease: 'power3.in', stagger: 0.03 }, 'dock+=0.04')
            .to(dom.deckLid, { y: 0, duration: 0.38, ease: 'power3.inOut' }, 'dock+=0.08')
            .to(dom.tray, { y: 0, scale: 1, duration: 0.44, ease: 'power3.inOut' }, 'dock+=0.08')
            .to(dom.mechButton, { y: 0, duration: 0.18, ease: 'back.out(2)' }, 'dock+=0.1')
            .to(dom.led, { opacity: 0.26, duration: 0.1, repeat: 5, yoyo: true, ease: 'steps(1)' }, 'dock');

        intentPromise.then(function (intent) {
            if (requestId !== state.playRequest) return intent;
            if (dom.loadState) dom.loadState.textContent = intent.transition ? 'SYNC' : 'OPEN';
            return intent;
        });
        Promise.all([animationPromise, intentPromise]).then(function (values) {
            if (requestId !== state.playRequest) return;
            var intent = values[1];
            if (!intent.transition) {
                resetDevice(false, true);
                commitPlayIntent(intent);
                return;
            }
            runPlaybackExit(intent, activeItem, requestId);
        });
    }

    function initDevice() {
        if (!dom.action) return;
        listen(dom.action, 'pointerenter', function (event) {
            if (event.pointerType !== 'touch') startDeviceHover();
        }, { passive: true });
        listen(dom.action, 'focus', startDeviceHover);
        listen(dom.action, 'pointerleave', function () {
            if (!state.devicePlaying) resetDevice(false, false);
        }, { passive: true });
        listen(dom.action, 'blur', function () {
            if (!state.devicePlaying) resetDevice(false, false);
        });
        listen(dom.action, 'click', function (event) {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            executePlay();
        });
        resetDevice(true, true);
    }

    function heroIsActive() {
        if (!dom.hero) return false;
        var rect = dom.hero.getBoundingClientRect();
        return rect.bottom > window.innerHeight * 0.28 && rect.top < window.innerHeight * 0.72;
    }

    function initKeys() {
        listen(document, 'keydown', function (event) {
            var target = event.target;
            var tag = target && target.tagName ? target.tagName.toLowerCase() : '';
            var typing = tag === 'input' || tag === 'textarea' || tag === 'select' || (target && target.isContentEditable);
            var focusInHero = target === document.body || target === document.documentElement || (dom.hero && dom.hero.contains(target));
            var interactive = target && target.closest
                ? target.closest('a, button, summary, [role="button"], [role="link"]')
                : null;
            var isCarouselCard = interactive && interactive.classList.contains('hero3__card');
            if (typing || !focusInHero || (interactive && !isCarouselCard) || event.metaKey || event.ctrlKey || event.altKey || !heroIsActive() || !state.items.length) return;
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                var direction = event.key === 'ArrowRight' ? 1 : -1;
                selectIndex(state.activeIndex + direction, direction, false, true);
            } else if (event.key === 'Enter') {
                event.preventDefault();
                executePlay();
            }
        });
    }

    function updateArtwork(animeId, url, kind) {
        var id = String(animeId || '');
        if (!id || !url) return;
        var artworkIndex = state.items.findIndex(function (item) { return item.id === id; });
        var isPreHydrateActive = artworkIndex < 0 && !state.items.length;
        var isActiveArtwork = isPreHydrateActive || artworkIndex === state.activeIndex;
        function apply(item) {
            if (item.id !== id) return;
            var posterChanged = false;
            if (kind === 'wide') {
                item.backdrop = url;
                item.backdropKind = 'wide';
            } else if (kind === 'poster-backdrop') {
                item.backdrop = url;
                item.backdropKind = 'poster';
            } else {
                item.poster = url;
                posterChanged = true;
                if (!item.backdrop || item.backdropKind === 'poster') item.backdrop = url;
            }
            if (posterChanged) updateCardArtwork(item);
            if (state.items[state.activeIndex] && state.items[state.activeIndex].id === id) updateBackdrop(item, false);
        }
        preloadImage(url, {
            index: artworkIndex >= 0 ? artworkIndex + 1 : (isPreHydrateActive ? 1 : 0),
            reason: 'artwork',
            priority: isActiveArtwork ? 'high' : 'auto'
        }).then(function (loaded) {
            if (loaded) state.pool.forEach(apply);
        });
    }

    function updateSynopsis(animeId, text) {
        var id = String(animeId || '');
        var value = primitiveText(text);
        if (!id || !value) return;
        state.items.forEach(function (item) {
            if (item.id === id) item.synopsis = value;
        });
        state.pool.forEach(function (item) {
            if (item.id === id) item.synopsis = value;
        });
        if (state.items[state.activeIndex] && state.items[state.activeIndex].id === id) updateInfo(state.items[state.activeIndex]);
    }

    function hydrate(rawItems, options) {
        if (!ensureReady()) return;
        options = options || {};
        var pool = uniqueItems(rawItems, options);
        if (!pool.length) return;
        var desiredId = String(options.activeAnimeId || '');
        var selectedPoolIndex = pool.findIndex(function (item) { return item.id === desiredId; });
        var heroItems = pool.slice(0, 7);
        if (selectedPoolIndex >= 7) heroItems[heroItems.length - 1] = pool[selectedPoolIndex];
        var selectedIndex = heroItems.findIndex(function (item) { return item.id === desiredId; });
        if (selectedIndex < 0) selectedIndex = 0;
        var hydrateRequest = ++state.hydrateRequest;

        preloadItems(heroItems, selectedIndex).then(function () {
            if (hydrateRequest !== state.hydrateRequest) return;
            var nextSignature = heroItems.map(function (item) { return item.id; }).join('|');
            var structureChanged = nextSignature !== state.signature;
            state.options = options;
            state.pool = pool;
            state.items = heroItems;
            state.signature = nextSignature;

            if (structureChanged) {
                state.activeIndex = selectedIndex;
                state.carouselPosition = selectedIndex;
                renderCards();
                renderEntryCloud();
                updateInfo(state.items[state.activeIndex]);
                updateBackdrop(state.items[state.activeIndex], true);
                window.requestAnimationFrame(playEntry);
            } else {
                state.activeIndex = selectedIndex;
                if (!options.preservePosition) {
                    state.carouselPosition = selectedIndex;
                    layoutCarousel(state.carouselPosition);
                }
                state.items.forEach(function (item) {
                    updateCardArtwork(item);
                    updateCardMetadata(item);
                });
                updateInfo(state.items[state.activeIndex]);
                updateBackdrop(state.items[state.activeIndex], false);
                syncDiscOrigin();
            }
        });
    }

    function init() {
        if (state.ready) return;
        cacheDom();
        if (!dom.hero || !dom.shell || !dom.orbit) return;
        state.ready = true;
        refreshMetrics();
        initKeys();
        initDevice();
        listen(window, 'resize', function () {
            if (state.resizeFrame) return;
            state.resizeFrame = window.requestAnimationFrame(function () {
                state.resizeFrame = 0;
                refreshMetrics();
                layoutCarousel(state.carouselPosition);
                resetDevice(true, true);
            });
        }, { passive: true });
        listen(window, 'blur', function () { resetDevice(true, true); });
        listen(document, 'visibilitychange', function () {
            if (document.hidden) resetDevice(true, true);
        });
        listen(window, 'pageshow', function () { resetDevice(true, true); });
        listen(window, 'pagehide', function () {
            if (state.carouselTween) state.carouselTween.kill();
            if (state.entryTimeline) state.entryTimeline.kill();
            if (state.backdropTimeline) state.backdropTimeline.kill();
            if (state.deviceTimeline) state.deviceTimeline.kill();
            if (state.deviceSpin) state.deviceSpin.kill();
            killCaseTimelines();
        });

    }

    function destroy() {
        clearCardBindings();
        state.listeners.splice(0).forEach(function (dispose) {
            try { dispose(); } catch (error) {}
        });
        if (state.carouselTween) state.carouselTween.kill();
        if (state.entryTimeline) state.entryTimeline.kill();
        if (state.backdropTimeline) state.backdropTimeline.kill();
        if (state.deviceTimeline) state.deviceTimeline.kill();
        if (state.deviceSpin) state.deviceSpin.kill();
        killCaseTimelines();
        state.ready = false;
    }

    window.DandanHero3 = {
        hydrate: hydrate,
        updateArtwork: updateArtwork,
        updateSynopsis: updateSynopsis,
        select: function (index) { selectIndex(index, index >= state.activeIndex ? 1 : -1, false, true); },
        playActive: executePlay,
        reset: function (immediate) { resetDevice(Boolean(immediate), true); },
        destroy: destroy,
        debugState: function () {
            return {
                ready: state.ready,
                itemCount: state.items.length,
                activeIndex: state.activeIndex,
                activeId: state.items[state.activeIndex] ? state.items[state.activeIndex].id : null,
                preloadPlan: state.preloadPlan.slice(),
                preloadStarts: state.preloadStarts.map(function (entry) {
                    return { index: entry.index, reason: entry.reason, priority: entry.priority, url: entry.url };
                }),
                entryPlayed: state.entryPlayed,
                entryRunning: state.entryRunning,
                devicePlaying: state.devicePlaying
            };
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
