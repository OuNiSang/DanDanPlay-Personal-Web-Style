(function () {
    'use strict';

    // Web1 3.0 is intentionally a desktop-only experience.  The homepage
    // keeps the stable 2.4 presentation and business flow at phone/tablet
    // widths, so none of the Hero 3D listeners or preload work should start.
    if (!window.matchMedia('(min-width: 769px)').matches ||
        (window.Web1UiVersion && !window.Web1UiVersion.isV3Desktop())) return;

    var RACK_TUNING = {
        itemCount: 25,
        anglePoints: [0, 46, 69, 87],
        farAngle: 87,
        apertureRadius: 2.5,
        lensResponse: 5.6,
        dockResponse: 7.2,
        selectAngle: 3,
        selectExitAngle: 5.5,
        selectVelocity: 0.22,
        selectDwell: 96,
        readableAngle: 75,
        minScale: 0.92,
        renderedRadius: 25,
        preloadRadius: 3.5
    };
    var ENTRY_RAIL_CRUISE_MS = 560;
    var ENTRY_RAIL_BRAKE_SECONDS = 1.18;
    var ENTRY_RAIL_BRAKE_EASE_DERIVATIVE = 4;
    var state = {
        ready: false,
        items: [],
        pool: [],
        cards: [],
        cardBindings: [],
        listeners: [],
        options: {},
        activeIndex: 0,
        sliderPosition: 0,
        sliderTarget: 0,
        sliderVelocity: 0,
        wheelAccumulator: 0,
        wheelLastPacket: 0,
        wheelLastStep: 0,
        sliderSettleTimer: 0,
        pendingSelection: -1,
        pendingSelectionSince: 0,
        pendingSelectionNotify: false,
        focusOnCommit: false,
        introRevealStrength: 1,
        introCenterLift: 1,
        introArrivalProgress: 1,
        introRackOffsetX: 0,
        introRackOffsetY: 0,
        introRackVelocity: 0,
        introFlow: 0,
        introReaderPosition: 0,
        introOpacity: 1,
        introMaterialize: 1,
        caseInspectProgress: 0,
        caseInspectScale: 1,
        inspectedCard: null,
        playerX: 0,
        rackDockWorld: null,
        rackDockCommitIndex: -1,
        rackDockNotify: false,
        exitProgress: 0,
        rackTicker: null,
        rackMoveDelayTimer: 0,
        rackMoveDelayUntil: 0,
        rackMovingVisual: false,
        rackNeedsRender: true,
        rackGeometry: [],
        rackLastCandidate: -1,
        carouselPosition: 0,
        entryTimeline: null,
        entryRailAnimation: null,
        entryRailActive: false,
        entryRailWidth: 0,
        entryRailCycleWidth: 0,
        entryRailCycleDuration: ENTRY_RAIL_CRUISE_MS,
        entryRailFinalX: 0,
        entryRailAlignedSlot: -1,
        entryRailArtworkReady: false,
        entryRailArtworkSignature: '',
        introOwnershipProgress: 1,
        entryHydrationTimer: 0,
        entryPlayed: false,
        entryRunning: false,
        backdropFront: 'A',
        backdropRequest: 0,
        backdropTimeline: null,
        backdropTargetUrl: '',
        backdropOwnerId: '',
        backdropPendingOwnerId: '',
        backdropIntentId: '',
        backdropIntentIndex: -1,
        mediaDiameter: 0,
        discOriginNeedsSync: false,
        deviceTimeline: null,
        deviceSpin: null,
        deviceHovering: false,
        casePinnedOpen: false,
        devicePreparing: false,
        devicePlaying: false,
        playSelectionId: '',
        playRequest: 0,
        hydrateRequest: 0,
        imagePromises: {},
        imageLoadStatus: {},
        preloadedPosterImages: {},
        backdropPreloadUrls: {},
        preloadedBackdropImages: {},
        preloadPlan: [],
        preloadStarts: [],
        rackArtworkReady: false,
        criticalArtworkIndexes: [],
        deferredArtworkQueue: [],
        deferredArtworkHandle: 0,
        deferredArtworkHandleType: '',
        deferredArtworkHydrated: 0,
        nearbyBackdropTimer: 0,
        resizeFrame: 0,
        signature: '',
        metrics: {
            shellWidth: 1440,
            spacing: 356,
            centerY: -118,
            visibleRadius: 2.45,
            centerScale: 1,
            cardWidth: 320
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

    // A rotating square element has a larger axis-aligned bounding rect even
    // when its physical circle has not changed size. Measure the element's
    // layout diameter multiplied by the transform's actual scale component so
    // debug/acceptance checks catch real scale jumps without flagging rotation.
    function renderedCircleDiameter(element) {
        if (!element) return 0;
        var diameter = Number(element.offsetWidth) || parseFloat(window.getComputedStyle(element).width) || 0;
        var transform = window.getComputedStyle(element).transform;
        if (!diameter || !transform || transform === 'none') return diameter;
        try {
            var Matrix = window.DOMMatrixReadOnly || window.DOMMatrix || window.WebKitCSSMatrix;
            if (!Matrix) return diameter;
            var matrix = new Matrix(transform);
            var x = Number(matrix.m11);
            var y = Number(matrix.m12);
            var z = Number(matrix.m13);
            if (!isFinite(x)) x = Number(matrix.a) || 0;
            if (!isFinite(y)) y = Number(matrix.b) || 0;
            if (!isFinite(z)) z = 0;
            var scale = Math.sqrt(x * x + y * y + z * z);
            return diameter * (isFinite(scale) && scale > 0 ? scale : 1);
        } catch (_) {
            return diameter;
        }
    }

    function setDiscArtwork(node, url) {
        if (!node) return;
        node.style.backgroundImage = url ? 'url(' + JSON.stringify(String(url)) + ')' : '';
    }

    function setSpineArtwork(card, url) {
        if (!card) return;
        if (url) card.style.setProperty('--hero3-spine-art', 'url(' + JSON.stringify(String(url)) + ')');
        else card.style.removeProperty('--hero3-spine-art');
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

    function pickRankedArtwork(source, names) {
        if (!source) return { url: '', rank: 0 };
        for (var i = 0; i < names.length; i += 1) {
            var url = primitiveText(source[names[i]]);
            if (url) return { url: url, rank: names.length - i };
        }
        return { url: '', rank: 0 };
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
        var posterChoice = pickRankedArtwork(raw, [
            'HeroPoster', 'PosterLarge', 'CoverLarge', 'LargeCover', 'Poster', 'Cover',
            'ImageUrl', 'BangumiCover', 'CoverImage', 'coverImage', 'Image', 'image'
        ]);
        var backdropChoice = pickRankedArtwork(raw, [
            'HeroArtwork', 'Backdrop', 'HeroBackdrop', 'Banner', 'BannerImage', 'HeroBanner', 'WideCover'
        ]);
        var poster = posterChoice.url;
        var backdrop = backdropChoice.url;
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
            posterRank: posterChoice.rank,
            backdrop: backdrop || poster,
            backdropRank: backdrop ? backdropChoice.rank : posterChoice.rank,
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
            return result.length >= 48;
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
        dom.entryRail = qs('.hero3__entry-rail', dom.shell);
        if (!dom.entryRail && dom.shell) {
            dom.entryRail = document.createElement('span');
            dom.entryRail.className = 'hero3__entry-rail';
            dom.entryRail.setAttribute('aria-hidden', 'true');
            dom.entryRail.innerHTML = '<span class="hero3__entry-rail-track">' +
                '<canvas class="hero3__entry-rail-art"></canvas></span>';
            dom.shell.insertBefore(dom.entryRail, dom.orbit || dom.shell.firstChild);
        }
        dom.entryRailTrack = qs('.hero3__entry-rail-track', dom.entryRail);
        dom.entryRailArt = qs('.hero3__entry-rail-art', dom.entryRailTrack);
        if (!dom.entryRailArt && dom.entryRailTrack) {
            dom.entryRailArt = document.createElement('canvas');
            dom.entryRailArt.className = 'hero3__entry-rail-art';
            dom.entryRailTrack.appendChild(dom.entryRailArt);
        }
        dom.inspectionLayer = qs('.hero3__inspection-layer', dom.shell);
        if (!dom.inspectionLayer && dom.shell) {
            dom.inspectionLayer = document.createElement('span');
            dom.inspectionLayer.className = 'hero3__inspection-layer';
            dom.inspectionLayer.setAttribute('aria-hidden', 'true');
            dom.shell.appendChild(dom.inspectionLayer);
        }
        dom.backdrop = qs('#hero3Backdrop');
        dom.backdropA = qs('#hero3BackdropA');
        dom.backdropB = qs('#hero3BackdropB');
        dom.info = qs('.hero3__info');
        dom.frame = qs('.hero3__frame');
        dom.register = qs('.hero3__register');
        dom.artSwitch = qs('.hero3__art-switch');
        dom.title = qs('#heroTitle');
        dom.meta = qs('#heroMeta');
        dom.description = qs('#heroDescription');
        dom.badge = qs('#heroBadge');
        dom.badgeText = qs('#heroBadgeText');
        dom.index = qs('#hero3Index');
        dom.code = qs('#hero3Code');
        dom.action = qs('#heroPlayBtn');
        dom.zone = qs('#hero3DeviceZone');
        dom.rackPrev = qs('#hero3RackPrev');
        dom.rackNext = qs('#hero3RackNext');
        dom.rackControls = qs('.hero3__rack-controls');
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
        state.metrics.shellWidth = width;
        /* Derive the canonical jewel-case box from the same responsive formula
           as --rack-card-width.  Measuring a rendered card is unsafe here: the
           first array entry is commonly a 10-50px compact spine, while a CSS
           media-query update can land one frame after the resize event and
           report the previous viewport's width.  Either value makes sequential
           2048 -> 1440 -> 1280 resizing shrink or over-expand the whole shelf. */
        var viewportHeight = window.innerHeight || 900;
        var canonicalWidth = width <= 1100 ?
            clamp(width * 0.26, 222, 280) :
            clamp(width * 0.22, 270, 390);
        if (viewportHeight <= 780) {
            canonicalWidth = clamp(Math.min(width * 0.22, viewportHeight * 0.42), 220, 310);
        }
        state.metrics.cardWidth = canonicalWidth;
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

    function rackLayoutMetrics(total) {
        var shellWidth = state.metrics.shellWidth || window.innerWidth;
        var furthestSlot = Math.floor(total / 2);
        var cardWidth = state.metrics.cardWidth || clamp(shellWidth * 0.22, 270, 390);
        var spineWidth = clamp(shellWidth * 0.028, 36, 52);
        var angleOne = RACK_TUNING.anglePoints[1] * Math.PI / 180;
        var angleTwo = RACK_TUNING.anglePoints[2] * Math.PI / 180;
        var firstReadableDistance = cardWidth * (0.5 + Math.cos(angleOne) * 0.5) + 2;
        var secondReadableDistance = firstReadableDistance +
            cardWidth * (Math.cos(angleOne) + Math.cos(angleTwo)) * 0.5 + 2;
        var sideInventoryCount = Math.max(1, furthestSlot - 2);
        var readableOuterEdge = secondReadableDistance + cardWidth * Math.cos(angleTwo) * 0.5;
        var narrowRack = shellWidth <= 1100;
        var sideGap = narrowRack ? 1 : 2;
        var minimumSpineWidth = narrowRack ? 4 : 10;
        var minimumSideClearance = narrowRack ? 6 : 40;
        // Perspective depth extends beyond the cover's simple cosine
        // projection. Reserve a visible physical seam so the first compact
        // case cannot disappear under the outer readable cover.
        var desiredSideClearance = narrowRack ? 8 : clamp(cardWidth * 0.16, 58, 72);
        var maximumSideClearance = shellWidth * 0.5 - readableOuterEdge -
            sideInventoryCount * minimumSpineWidth - sideGap * Math.max(0, sideInventoryCount - 1) - 8;
        var sideClearance = Math.max(minimumSideClearance,
            Math.min(desiredSideClearance, maximumSideClearance));
        var sideInventoryRoom = Math.max(0,
            shellWidth * 0.5 - readableOuterEdge - sideClearance - 8);
        var visibleSpineWidth = clamp(
            (sideInventoryRoom - sideGap * Math.max(0, sideInventoryCount - 1)) / sideInventoryCount,
            minimumSpineWidth,
            spineWidth
        );
        var spinePitch = visibleSpineWidth + sideGap;
        return {
            shellWidth: shellWidth,
            furthestSlot: furthestSlot,
            cardWidth: cardWidth,
            firstReadableDistance: firstReadableDistance,
            secondReadableDistance: secondReadableDistance,
            readableOuterEdge: readableOuterEdge,
            visibleSpineWidth: visibleSpineWidth,
            spinePitch: spinePitch,
            firstSpineDistance: readableOuterEdge + sideClearance + visibleSpineWidth * 0.5,
            sideClearance: sideClearance
        };
    }

    function wrappedDelta(index, position, total) {
        if (!total) return index - position;
        var normalizedPosition = ((position % total) + total) % total;
        var delta = index - normalizedPosition;
        if (delta > total / 2) delta -= total;
        if (delta < -total / 2) delta += total;
        return delta;
    }

    function shortestIndexDelta(nextIndex, currentIndex, total) {
        return wrappedDelta(nextIndex, currentIndex, total);
    }

    function wrapIndex(index, total) {
        if (!total) return 0;
        return ((Math.round(index) % total) + total) % total;
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function monotoneSample(points, distance, farStep) {
        var value = Math.max(0, Number(distance) || 0);
        var lastIndex = points.length - 1;
        if (value >= lastIndex) return points[lastIndex] + (value - lastIndex) * farStep;
        var index = Math.floor(value);
        var progress = value - index;
        var before = index > 0 ? points[index] - points[index - 1] : points[1] - points[0];
        var segment = points[index + 1] - points[index];
        var after = index + 2 < points.length ? points[index + 2] - points[index + 1] : segment;
        var tangentA = before > 0 && segment > 0 ? (2 * before * segment) / (before + segment) : 0;
        var tangentB = segment > 0 && after > 0 ? (2 * segment * after) / (segment + after) : 0;
        var t2 = progress * progress;
        var t3 = t2 * progress;
        return (2 * t3 - 3 * t2 + 1) * points[index] +
            (t3 - 2 * t2 + progress) * tangentA +
            (-2 * t3 + 3 * t2) * points[index + 1] +
            (t3 - t2) * tangentB;
    }

    function createSetters(card) {
        return {
            // The rack owns the outer transform exclusively.  Writing the
            // composed transform directly avoids running each frame through
            // CSSPlugin while preserving the inner GSAP case/hinge timelines.
            transform: function (value) { card.style.transform = value; },
            opacity: function (value) { card.style.opacity = String(value); }
        };
    }

    function setIntroOwnership(value) {
        var progress = clamp(value, 0, 1);
        state.introOwnershipProgress = progress;
        if (!dom.orbit) return;
        var rounded = progress.toFixed(4);
        if (dom.orbit.__hero3OwnershipProgress === rounded) return;
        dom.orbit.style.setProperty('--hero3-rack-ownership', rounded);
        dom.orbit.__hero3OwnershipProgress = rounded;
    }

    function renderRack() {
        var total = state.cards.length;
        if (!total) return;
        var strength = clamp(state.introRevealStrength, 0, 1);
        var centerLift = clamp(state.introCenterLift, 0, 1);
        var candidate = null;
        var geometry = state.rackGeometry;
        var exit = clamp(state.exitProgress, 0, 1);
        var layout = rackLayoutMetrics(total);
        var shellWidth = layout.shellWidth;
        // The whole shelf is present inside the viewport from the first frame.
        // Intro speed is a wrapped phase through the same fifteen physical
        // cases, never an off-screen translate of a second, differently sized
        // rack.  The orbit therefore stays at identity for intro and runtime.
        var groupX = 0;
        var groupOpacity = clamp(state.introOpacity, 0, 1);
        var groupTransform = 'translate3d(0,0,0)';
        if (dom.orbit && dom.orbit.__hero3RackTransform !== groupTransform) {
            dom.orbit.style.transform = groupTransform;
            dom.orbit.__hero3RackTransform = groupTransform;
        }
        if (dom.orbit && dom.orbit.__hero3RackOpacity !== groupOpacity) {
            dom.orbit.style.opacity = String(groupOpacity);
            dom.orbit.__hero3RackOpacity = groupOpacity;
        }
        var furthestSlot = layout.furthestSlot;
        var cardWidth = layout.cardWidth;
        var layoutPosition = state.sliderPosition + (state.entryRunning ? state.introFlow : 0);
        // Distances are calculated from the projected width of the same jewel
        // case. Adjacent faces meet with a narrow AO seam instead of overlapping
        // or leaving the centre and inventory as unrelated islands.
        var firstReadableDistance = layout.firstReadableDistance;
        var secondReadableDistance = layout.secondReadableDistance;
        var visibleSpineWidth = layout.visibleSpineWidth;
        var spinePitch = layout.spinePitch;
        var firstSpineDistance = layout.firstSpineDistance;
        // Closed, stopping and ready states share one physical spine width.
        // The former full-viewport pitch doubled each case at large viewports
        // and rewrote all 25 widths during unfold, producing both a size jump
        // and avoidable style/paint work.
        var introPitch = spinePitch;
        var renderedSpineWidth = visibleSpineWidth;
        geometry.length = total;
        var publishGeometry = !state.entryRunning && Math.abs(state.sliderVelocity) < 0.003 &&
            Math.abs(state.sliderTarget - state.sliderPosition) < 0.003;
        // This is the hottest path in the rack: it runs for every visible
        // animation frame.  A forEach callback allocated a fresh closure per
        // frame and showed up as avoidable GC pressure during repeated
        // selection.  Keep the loop allocation-free; each geometry record is
        // still reused in place below.
        for (var index = 0; index < state.cards.length; index += 1) {
            var entry = state.cards[index];
            var sliderDelta = wrappedDelta(index, layoutPosition, total);
            var absSlider = Math.abs(sliderDelta);
            var side = sliderDelta < -0.0001 ? -1 : (sliderDelta > 0.0001 ? 1 : 0);
            var direction = side || 1;
            // The read head stays fixed while the physical cases travel
            // around a short ring.  Five cases open into a reading aperture;
            // the others remain edge-on inventory with real, separated spines.
            var effectiveAbs = Math.max(0, absSlider);
            var aperture = clamp((RACK_TUNING.apertureRadius + 0.45 - absSlider) / 0.72, 0, 1);
            aperture = aperture * aperture * (3 - 2 * aperture);
            var localStrength = strength * aperture;
            var finalDistance;
            if (effectiveAbs <= 1) {
                finalDistance = firstReadableDistance * effectiveAbs;
            } else if (effectiveAbs <= 2) {
                finalDistance = firstReadableDistance +
                    (secondReadableDistance - firstReadableDistance) * (effectiveAbs - 1);
            } else if (effectiveAbs <= 3) {
                // The previous formula snapped every fractional slot in the
                // 2..3 interval directly onto firstSpineDistance. During a
                // selection this collapsed several cases into one physical
                // column, producing the visible overlay in the filmstrip.
                finalDistance = secondReadableDistance +
                    (firstSpineDistance - secondReadableDistance) * (effectiveAbs - 2);
            } else {
                finalDistance = firstSpineDistance + (effectiveAbs - 3) * spinePitch;
            }
            // The closed intro queue already spans the stage.  Reveal then
            // reshapes that ordered row into the reading aperture, so no
            // intermediate frame can collapse the cases into a tower.
            var storedDistance = absSlider * introPitch;
            var x = direction * (storedDistance + (finalDistance - storedDistance) * strength);
            var openAngle = -direction * Math.min(RACK_TUNING.farAngle,
                monotoneSample(RACK_TUNING.anglePoints, effectiveAbs, 0));
            if (effectiveAbs === 0) openAngle = 0;
            // The travelling collection is read through the *actual* printed
            // spines of these cases.  Keeping the outer case at +/-87deg and
            // counter-rotating a nested spine looked mathematically plausible,
            // but perspective multiplication reduced every illustrated spine
            // to a 1-2px line.  Start from a front-facing, narrow spine strip;
            // after the rack has fully stopped the same outer case rotates into
            // its final reading-aperture angle.  No second shelf or material
            // swap is involved, and the physical width stays invariant.
            var storedAngle = 0;
            var angle = storedAngle + (openAngle - storedAngle) * localStrength;
            var depth = clamp(1 - effectiveAbs / 2.7, 0, 1) * localStrength;
            // The shallow rail and the live closed rack share one plane. Any
            // vertical/depth staging begins only as the reading aperture opens;
            // the ownership frame itself therefore has no scale or edge jump.
            var storedY = 0;
            var finalY = 0;
            var y = state.introRackOffsetY + storedY + (finalY - storedY) * strength + exit * -10;
            var selected = index === state.activeIndex;
            // Visual ownership changes only after commitRackSelection().  The
            // previous dockTarget shortcut painted the incoming case as active
            // while the machine, backdrop and disc still belonged to the old
            // AnimeId.  That split identity is what allowed a far-edge case to
            // open and donate its projected disc geometry to the player.
            // Keep one visible selection owner throughout travel. The outgoing
            // case retains its highlight until commitRackSelection changes the
            // selected index on the settled frame; clearing it during motion
            // made the rack blink unselected before the target lit up.
            var active = selected && strength > 0.985;
            var inspection = selected ? clamp(state.caseInspectProgress, 0, 1) : 0;
            var centerFocus = Math.pow(clamp(1 - effectiveAbs / 0.92, 0, 1), 2);
            // Opening changes the hinge state, not the physical scale.  The
            // active case is already emphasised by the rack lens; pushing the
            // outer card toward the camera here made the disc grow before the
            // handoff and broke diameter continuity with the player.
            var finalZ = -32 + depth * 30;
            var z = finalZ * strength + centerFocus * 32 * centerLift;
            var scale = (1 - exit * 0.01) * (selected ? state.caseInspectScale : 1);
            // Keep the outer 3D context opaque while browsing.  Opacity below
            // one flattens descendants and would collapse the physical spine
            // plane back onto the cover.  Exit may still fade the assembled
            // rack because the transfer has already left browse mode.
            // Materialise the real, compact case spines while the same rack is
            // already travelling at speed. This reaches one before any case
            // unfolds, so opacity never flattens the readable 3D lids.
            var materialize = state.entryRunning && strength < 0.02 ?
                clamp(state.introMaterialize, 0, 1) : 1;
            var opacity = groupOpacity * materialize *
                (exit > 0 ? (1 - exit * 0.72) : 1);
            // A storage spine and its readable face are two material views of
            // the same case. Blend only through the short fan boundary instead
            // of flipping CSS ownership on one frame.
            // Start the printed-cover handoff as soon as a spine leaves its
            // storage slot. Delaying this until the case was already near its
            // final angle produced a visible "spine, empty gap, then cover"
            // sequence both during the intro and during one-step navigation.
            // During the entrance, reveal enough of the printed face as soon
            // as slots separate that the change reads as an opening cover,
            // never as five replacement spines standing over the canvas.
            // Runtime navigation keeps the more conservative handoff ramp.
            var surfaceProgress;
            if (state.entryRunning) {
                // Entrance reveal is temporal: the five prepared live cases
                // unfold from the stopped canvas slots.
                surfaceProgress = clamp(localStrength / 0.36, 0, 1);
            } else {
                // Runtime navigation is spatial. The former aperture/ramp
                // composition reached ~99% at |delta| 2.56, while the case was
                // still outside the five-cover fan. On the following frame it
                // failed the readable-angle gate and disappeared back into a
                // spine, producing the large one-frame poster flash on both
                // boundaries. Keep only a narrow printed edge at the seam and
                // finish the material handoff after the case is inside it.
                surfaceProgress = clamp((2.62 - effectiveAbs) / 0.42, 0, 1);
            }
            surfaceProgress = surfaceProgress * surfaceProgress * (3 - 2 * surfaceProgress);
            var readable = surfaceProgress >= 0.999 && Math.abs(openAngle) <= RACK_TUNING.readableAngle;
            // Transition ownership ends only when the readable surface has
            // actually accepted the case. This prevents a one-frame state in
            // which neither the clipped cover nor the readable cover owns it.
            var surfaceTransitioning = surfaceProgress > 0.001 && !readable;
            var card = entry.card;
            var rendered = true;
            // Only the five-card reading aperture keeps full front/back faces.
            // Once a case turns past it, fade to the light spine primitive
            // before hiding the expensive inner surfaces.
            // During the train phase every item is a real spine. The same
            // surface continuously crossfades into the readable cover as the
            // aperture unfolds; no hidden face pops into the middle of a frame.
            var edgeProgress = 1 - surfaceProgress;
            // Keep the five-card reading aperture laid out from the first
            // closed-train frame. Its faces remain fully transparent, but the
            // browser can rasterize them before the unfold instead of paying
            // a large first-paint cost during motion.
            // The travelling train is made of identical, edge-on physical
            // cases. Keeping the centre five as full transparent lid trees in
            // this phase made them look thicker than the compact inventory
            // spines, even though the outer geometry was unchanged. The faces
            // were pre-rasterised behind the opaque entry shelf, so they can rejoin the
            // same case continuously as reveal strength leaves zero.
            // Keep one extra case warm on each side of both the current and
            // target positions. The visible aperture remains five cases, but
            // the next surface is rasterised before selection motion starts.
            var targetAbs = Math.abs(wrappedDelta(index, state.sliderTarget, total));
            var warmAbs = Math.min(effectiveAbs, targetAbs);
            // Keep only the five-case reading aperture (plus the incoming
            // boundary case) as full-size compositor layers. Artwork can stay
            // preloaded out to preloadRadius without retaining a 300x380
            // transparent plane for every inventory spine.
            var compact = surfaceProgress <= 0.001 &&
                ((state.entryRunning && strength < 0.02) || warmAbs > 2.55);
            if (entry.visibleSpineWidth == null || Math.abs(entry.visibleSpineWidth - renderedSpineWidth) >= 0.25) {
                card.style.setProperty('--rack-visible-spine-width', renderedSpineWidth.toFixed(2) + 'px');
                entry.visibleSpineWidth = renderedSpineWidth;
            }
            var transformValue = 'translate(-50%, -50%) translate3d(' + x.toFixed(2) + 'px,' +
                y.toFixed(2) + 'px,' + z.toFixed(2) + 'px) rotateY(' + angle.toFixed(3) +
                'deg) scale(' + scale.toFixed(4) + ')';

            if (rendered && entry.transformValue !== transformValue) {
                entry.setters.transform(transformValue);
                entry.transformValue = transformValue;
            }
            if (entry.opacity !== opacity) {
                entry.setters.opacity(opacity);
                entry.opacity = opacity;
            }

            // The physical spine and its cover are two views of the same case.
            // Drive both from the exact same reveal strength so there is never
            // a CSS-state frame where the spine has turned away but the cover
            // has not appeared yet. Direct transform writes stay compositor-
            // only and avoid invalidating the entire orbit through a CSS var.
            // The spine is the visible edge of this exact outer case. Counter
            // the rack's current yaw instead of assuming a fixed +/-90deg face:
            // during the dock phase the outer case is still near 87deg, so a
            // fixed local 90deg rotation compounded to an almost back-facing
            // plane and made the whole shelf disappear for a frame. As the
            // five readable cases unfold, edgeProgress fades this counter-face
            // while the full physical lid takes over at the same geometry.
            var spineAngle = -angle;
            var spineTransform = 'translateX(-50%) rotateY(' + spineAngle.toFixed(3) + 'deg)';
            if (entry.spine && entry.spineTransform !== spineTransform) {
                entry.spine.style.transform = spineTransform;
                entry.spineTransform = spineTransform;
            }

            // Stacking only changes when a case crosses a logical slot.  The
            // previous continuous z-index formula invalidated the stacking tree
            // for most of the fifteen cases on every animation frame, which was
            // visible as a hitch during rapid stepping on software compositors.
            var slotRank = Math.min(furthestSlot, Math.round(absSlider));
            var stackOrder = 260 + (furthestSlot - slotRank) * 6 +
                (surfaceProgress > 0.015 ? 90 : 0) + (active ? 84 : 0) + (inspection > 0.001 ? 520 : 0);
            if (rendered && entry.stackOrder !== stackOrder) {
                card.style.zIndex = String(stackOrder);
                entry.stackOrder = stackOrder;
            }
            if (rendered && Math.abs((entry.edgeProgress == null ? -1 : entry.edgeProgress) - edgeProgress) >= 0.015) {
                card.style.setProperty('--rack-edge-progress', edgeProgress.toFixed(3));
                entry.edgeProgress = edgeProgress;
            }
            var sideName = side < 0 ? 'left' : (side > 0 ? 'right' : 'center');
            if (entry.side !== sideName) {
                card.dataset.rackSide = sideName;
                entry.side = sideName;
            }
            if (publishGeometry) {
                var roundedAngle = angle.toFixed(3);
                var roundedDelta = sliderDelta.toFixed(4);
                if (entry.angle !== roundedAngle) {
                    card.dataset.rackAngle = roundedAngle;
                    entry.angle = roundedAngle;
                }
                if (entry.delta !== roundedDelta) {
                    card.dataset.rackDelta = roundedDelta;
                    entry.delta = roundedDelta;
                }
            }
            if (entry.worldIndex !== index) {
                card.dataset.worldIndex = String(index);
                entry.worldIndex = index;
            }
            if (entry.readable !== readable || card.dataset.rackReadable !== (readable ? 'true' : 'false')) {
                card.dataset.rackReadable = readable ? 'true' : 'false';
                card.classList.toggle('is-rack-readable', readable);
                card.classList.toggle('is-rack-spine', !readable);
                entry.readable = readable;
            }
            if (entry.surfaceTransitioning !== surfaceTransitioning) {
                card.classList.toggle('is-rack-surface-transition', surfaceTransitioning);
                entry.surfaceTransitioning = surfaceTransitioning;
            }
            if (entry.surfaceProgress == null || Math.abs(entry.surfaceProgress - surfaceProgress) >= 0.008) {
                card.style.setProperty('--rack-surface-progress', surfaceProgress.toFixed(3));
                card.style.setProperty('--rack-surface-hidden',
                    ((1 - surfaceProgress) * 100).toFixed(2) + '%');
                card.style.setProperty('--rack-surface-half-hidden',
                    ((1 - surfaceProgress) * 50).toFixed(2) + '%');
                entry.surfaceProgress = surfaceProgress;
            }
            if (entry.compact !== compact) {
                card.classList.toggle('is-rack-compact', compact);
                entry.compact = compact;
            }
            if (entry.rendered !== rendered) {
                card.dataset.rackRendered = rendered ? 'true' : 'false';
                card.classList.toggle('is-rack-offstage', !rendered);
                entry.rendered = rendered;
            }
            if (!entry.card.__hero3ArtworkCommitted && state.rackArtworkReady &&
                absSlider <= RACK_TUNING.preloadRadius &&
                state.items[index] && state.imageLoadStatus[state.items[index].poster]) {
                promoteArtworkIndex(index, false);
            }
            if (entry.active !== active) {
                card.classList.toggle('is-active', active);
                entry.active = active;
            }
            if (entry.selected !== selected) {
                card.setAttribute('aria-selected', selected ? 'true' : 'false');
                card.tabIndex = selected ? 0 : -1;
                entry.selected = selected;
            }
            var hidden = false;
            if (entry.hidden !== hidden) {
                card.setAttribute('aria-hidden', hidden ? 'true' : 'false');
                entry.hidden = hidden;
            }

            var itemGeometry = geometry[index] || (geometry[index] = {});
            itemGeometry.index = index;
            itemGeometry.world = state.sliderPosition + sliderDelta;
            itemGeometry.x = x + groupX;
            itemGeometry.y = y;
            itemGeometry.z = z;
            itemGeometry.angle = angle;
            itemGeometry.scale = scale;
            itemGeometry.opacity = opacity;
            itemGeometry.readable = readable;
            itemGeometry.delta = sliderDelta;
            itemGeometry.baseX = x + groupX;
            itemGeometry.aperture = aperture;
            // Compact inventory cases intentionally sit near 0deg, so angle is
            // not a valid proxy for the case under the reader. Select only
            // from the reveal aperture and prefer the slot nearest its center.
            if (absSlider <= 0.75 && (!candidate || absSlider < Math.abs(candidate.delta))) {
                candidate = itemGeometry;
            }
        }

        state.rackCandidate = candidate;
        var nextCandidate = candidate ? candidate.index : -1;
        if (nextCandidate !== state.rackLastCandidate) {
            if (state.rackLastCandidate >= 0 && state.cards[state.rackLastCandidate]) {
                state.cards[state.rackLastCandidate].card.classList.remove('is-rack-candidate');
            }
            if (nextCandidate >= 0 && state.cards[nextCandidate]) {
                state.cards[nextCandidate].card.classList.add('is-rack-candidate');
            }
            state.rackLastCandidate = nextCandidate;
        }
        state.rackNeedsRender = false;
    }

    function evaluateRackSelection(now) {
        var candidate = state.rackCandidate;
        if (!candidate || state.entryRunning || state.deviceHovering || state.casePinnedOpen ||
            state.devicePreparing || state.devicePlaying ||
            state.rackDockCommitIndex >= 0 || state.introRevealStrength < 0.985) {
            state.pendingSelection = -1;
            state.pendingSelectionSince = 0;
            return;
        }
        var activeGeometry = state.rackGeometry[state.activeIndex];
        var activeInsideExit = activeGeometry && Math.abs(activeGeometry.angle) <= RACK_TUNING.selectExitAngle;
        var aligned = Math.abs(candidate.angle) <= RACK_TUNING.selectAngle;
        var settled = Math.abs(state.sliderVelocity) <= RACK_TUNING.selectVelocity;
        if ((!aligned || !settled) && !(candidate.index === state.activeIndex && activeInsideExit)) {
            state.pendingSelection = -1;
            state.pendingSelectionSince = 0;
            return;
        }
        if (!aligned || candidate.index === state.activeIndex) {
            state.pendingSelection = -1;
            state.pendingSelectionSince = 0;
            return;
        }
        if (state.pendingSelection !== candidate.index) {
            state.pendingSelection = candidate.index;
            state.pendingSelectionSince = now;
            return;
        }
        if (now - state.pendingSelectionSince >= RACK_TUNING.selectDwell) {
            commitRackSelection(candidate.index, state.pendingSelectionNotify, false);
            state.pendingSelection = -1;
            state.pendingSelectionSince = 0;
            state.pendingSelectionNotify = false;
        }
    }

    function stepRackPhysics(deltaMilliseconds) {
        var delta = clamp((Number(deltaMilliseconds) || 16.667) / 1000, 0.001, 0.05);
        if (!hasMotion()) {
            state.sliderPosition = state.sliderTarget;
            state.sliderVelocity = 0;
            return true;
        }
        var previousSlider = state.sliderPosition;
        var responseRate = state.rackDockWorld != null ? RACK_TUNING.dockResponse : RACK_TUNING.lensResponse;
        var response = 1 - Math.exp(-responseRate * delta);
        state.sliderPosition += (state.sliderTarget - state.sliderPosition) * response;
        state.sliderVelocity = (state.sliderPosition - previousSlider) / Math.max(delta, 0.001);
        if (Math.abs(state.sliderTarget - state.sliderPosition) < 0.0005 && Math.abs(state.sliderVelocity) < 0.02) {
            state.sliderPosition = state.sliderTarget;
            state.sliderVelocity = 0;
        }
        if (state.rackDockWorld != null && Math.abs(state.rackDockWorld - state.sliderPosition) < 0.001 &&
            Math.abs(state.sliderVelocity) < 0.02) {
            state.sliderPosition = state.rackDockWorld;
            state.sliderTarget = state.rackDockWorld;
            state.sliderVelocity = 0;
            state.rackDockWorld = null;
        }
        state.carouselPosition = state.sliderPosition;
        return Math.abs(previousSlider - state.sliderPosition) > 0.00001;
    }

    function rackTick(time, deltaMilliseconds) {
        var changed = stepRackPhysics(deltaMilliseconds);
        // The lightweight travelling skin ends when the closed rack has
        // physically stopped. Keeping it for the later centre-lift/unfold hid
        // the tray faces until the final frame and caused both a visual pop and
        // a large end-of-intro paint hitch.
        var introTravelling = state.entryRunning && state.entryRailActive;
        var movingVisual = introTravelling || state.rackDockWorld != null ||
            Math.abs(state.sliderTarget - state.sliderPosition) >= 0.0005 || Math.abs(state.sliderVelocity) >= 0.02;
        if (movingVisual !== state.rackMovingVisual) {
            state.rackMovingVisual = movingVisual;
            if (dom.hero) dom.hero.classList.toggle('is-rack-moving', movingVisual);
        }
        // Commit the docked item before drawing the final frame. Previously
        // renderRack() painted the target geometry with the old active item,
        // then commitRackSelection() painted again with the new active item.
        // That two-render handoff was the visible overlap/pop at rest.
        if (state.rackDockWorld == null && state.rackDockCommitIndex >= 0 &&
            Math.abs(state.sliderTarget - state.sliderPosition) < 0.0001 &&
            Math.abs(state.sliderVelocity) < 0.001) {
            var dockIndex = state.rackDockCommitIndex;
            var dockNotify = state.rackDockNotify;
            state.rackDockCommitIndex = -1;
            state.rackDockNotify = false;
            commitRackSelection(dockIndex, dockNotify, false, true);
            changed = true;
        }
        if (changed || state.rackNeedsRender || state.exitProgress > 0) renderRack();
        evaluateRackSelection((Number(time) || 0) * 1000);
        var idle = !state.entryRunning && state.exitProgress <= 0 && state.pendingSelection < 0 &&
            !state.rackNeedsRender && Math.abs(state.sliderTarget - state.sliderPosition) < 0.0001 &&
            Math.abs(state.sliderVelocity) < 0.001;
        if (idle && state.discOriginNeedsSync) {
            state.discOriginNeedsSync = false;
            syncDiscOrigin();
        }
        if (idle) stopRackTicker();
        if (idle && state.rackMovingVisual) {
            state.rackMovingVisual = false;
            if (dom.hero) dom.hero.classList.remove('is-rack-moving');
        }
    }

    function startRackTicker() {
        if (!window.gsap || state.rackTicker) return;
        state.rackTicker = rackTick;
        window.gsap.ticker.add(state.rackTicker);
    }

    function stopRackTicker() {
        if (!window.gsap || !state.rackTicker) return;
        window.gsap.ticker.remove(state.rackTicker);
        state.rackTicker = null;
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

    function setOrbitInspecting(inspecting) {
        if (!dom.orbit) return;
        dom.orbit.classList.toggle('is-case-inspecting', Boolean(inspecting));
    }

    function beginCaseInspection(card) {
        if (!card || !dom.orbit) return;
        if (dom.inspectionLayer && card.parentNode !== dom.inspectionLayer) {
            dom.inspectionLayer.appendChild(card);
        }
        state.inspectedCard = card;
        state.caseInspectProgress = 1;
        state.caseInspectScale = 1;
        setOrbitInspecting(true);
        state.rackNeedsRender = true;
        renderRack();
    }

    function endCaseInspection() {
        var card = state.inspectedCard;
        if (card && dom.orbit && card.parentNode !== dom.orbit) {
            var entryIndex = state.cards.findIndex(function (entry) { return entry.card === card; });
            var nextCard = null;
            for (var index = entryIndex + 1; index < state.cards.length; index += 1) {
                if (state.cards[index].card.parentNode === dom.orbit) {
                    nextCard = state.cards[index].card;
                    break;
                }
            }
            if (nextCard) dom.orbit.insertBefore(card, nextCard);
            else dom.orbit.appendChild(card);
        }
        state.inspectedCard = null;
        state.caseInspectProgress = 0;
        state.caseInspectScale = 1;
        setOrbitInspecting(false);
        state.rackNeedsRender = true;
        renderRack();
    }

    function setCasePreview(parts, open, immediate) {
        if (!parts || !window.gsap) return null;
        var previousTimeline = parts.card && parts.card.__hero3CaseTimeline;
        var wasOpen = Boolean(parts.card && (
            parts.card.__hero3CaseOpen === true ||
            parts.card.classList.contains('is-case-open')
        ));
        if (previousTimeline && parts.card && parts.card.__hero3CaseOpen === Boolean(open) && !immediate) return previousTimeline;
        if (previousTimeline) previousTimeline.kill();
        if (parts.card) {
            parts.card.__hero3CaseOpen = Boolean(open);
            if (open) {
                beginCaseInspection(parts.card);
                parts.card.classList.add('is-case-open', 'is-case-transitioning');
            }
            // Pointer tilt returning to neutral is not a case transition. The
            // old unconditional class raised an already-closed card to the
            // inspection z-layer for one frame while the rack was switching.
            else if (wasOpen) parts.card.classList.add('is-case-transitioning');
        }
        var phoneShift = casePhoneShift(parts.card, open);
        var duration = immediate ? 0 : (open ? 0.76 : 0.38);
        var timeline = window.gsap.timeline({
            defaults: { overwrite: 'auto' },
            onComplete: function () {
                if (parts.card && parts.card.__hero3CaseTimeline === timeline) {
                    parts.card.__hero3CaseTimeline = null;
                    parts.card.classList.remove('is-case-transitioning');
                    if (!open) {
                        parts.card.classList.remove('is-case-open');
                        endCaseInspection();
                    }
                }
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
                duration: immediate ? 0 : (open ? 0.58 : 0.32),
                ease: open ? 'power3.out' : 'power3.inOut',
                overwrite: 'auto'
            }, 'case');
        }
        if (parts.lid) {
            timeline.to(parts.lid, {
                x: open ? -8 : 0,
                z: 0,
                rotationY: open ? -180 : 0,
                scaleX: 1,
                skewY: 0,
                duration: immediate ? 0 : (open ? 0.64 : 0.36),
                ease: open ? 'power3.out' : 'power3.inOut',
                overwrite: 'auto'
            }, 'case');
        }
        if (parts.caseBack) {
            timeline.to(parts.caseBack, {
                z: 0,
                scale: 1,
                duration: duration,
                ease: open ? 'power3.out' : 'power3.inOut'
            }, 'case');
        }
        if (parts.caseDisc) {
            timeline.to(parts.caseDisc, {
                y: open ? -18 : 0,
                z: 0,
                scale: 1,
                rotation: 0,
                autoAlpha: open ? 1 : 0,
                duration: immediate ? 0 : (open ? 0.52 : 0.3),
                ease: open ? 'power3.out' : 'power3.inOut',
                overwrite: 'auto'
            }, open ? 'case+=0.16' : 'case');
        }
        if (parts.shadow) {
            timeline.to(parts.shadow, {
                autoAlpha: open ? 0 : (parts.card && parts.card.classList.contains('is-active') ? 0.7 : 0.62),
                duration: immediate ? 0 : (open ? 0.42 : 0.28),
                ease: open ? 'power2.in' : 'power3.out'
            }, open ? 'case+=0.08' : 'case+=0.06');
        }
        if (immediate && parts.card && !open) {
            parts.card.classList.remove('is-case-open', 'is-case-transitioning');
            endCaseInspection();
        }
        return timeline;
    }

    function waitForTimeline(timeline) {
        if (!timeline || typeof timeline.eventCallback !== 'function' || timeline.progress() >= 1) {
            return Promise.resolve();
        }
        return new Promise(function (resolve) {
            var previousComplete = timeline.eventCallback('onComplete');
            var previousInterrupt = timeline.eventCallback('onInterrupt');
            timeline.eventCallback('onComplete', function () {
                if (typeof previousComplete === 'function') previousComplete.apply(this, arguments);
                resolve();
            });
            timeline.eventCallback('onInterrupt', function () {
                if (typeof previousInterrupt === 'function') previousInterrupt.apply(this, arguments);
                resolve();
            });
        });
    }

    function cardStateIndex(card) {
        if (!card) return -1;
        var ownerId = String(card.getAttribute('data-anime-id') || '');
        if (!ownerId) return -1;
        return state.items.findIndex(function (item) {
            return String(item && item.id || '') === ownerId;
        });
    }

    function bindCard(card, index) {
        var click = function (event) {
            if (state.devicePreparing || state.devicePlaying) return;
            finishEntryForInput();
            // Rack cases are physical DOM nodes that may be detached into the
            // inspection layer and restored while the data pool is hydrated.
            // Never trust the index captured when this listener was created:
            // resolve the case's immutable AnimeId against the current state
            // at the moment of interaction. A stale closure here used to make
            // a visually highlighted case select/open an unrelated edge item,
            // after which the CD path measured that edge spine (about 17px)
            // instead of the selected disc (about 237px).
            var currentIndex = cardStateIndex(card);
            if (currentIndex < 0) return;
            if (currentIndex === state.activeIndex && Math.abs(wrappedDelta(currentIndex, state.sliderPosition, state.items.length)) < 0.08) {
                // The boolean is the source of truth while the reversible case
                // timeline is running. The transition class alone cannot tell
                // an opening case from a closing one and used to swallow the
                // first click immediately after a rack move.
                if (card.__hero3CaseOpen === true) {
                    if (event.target && event.target.closest && event.target.closest('.hero3__case-disc')) executePlay();
                    else resetDevice(false, true);
                } else {
                    startDeviceHover(true);
                }
                return;
            }
            var delta = shortestIndexDelta(currentIndex, state.activeIndex, state.items.length);
            selectIndex(currentIndex, delta >= 0 ? 1 : -1, false, true);
        };
        card.addEventListener('click', click);
        state.cardBindings.push(function () {
            card.removeEventListener('click', click);
        });

        if (!hasMotion()) return;
        var surface = qs('.hero3__case', card);
        var lid = qs('.hero3__case-lid', card);
        var caseBack = qs('.hero3__case-back', card);
        var caseDisc = qs('.hero3__case-disc', card);
        var shadow = qs('.hero3__card-shadow', card);
        var poster = qs('.hero3__poster', card);
        var foil = qs('.hero3__foil', card);
        var pointer = null;
        var pointerRect = null;
        var frame = 0;
        var motion = null;

        // Controllers are created only when a readable case is actually
        // touched. The rack keeps fifteen physical slots, but idle/edge spines
        // no longer pay for ten animated properties each.
        function ensureMotion() {
            if (motion) return true;
            if (!surface || !poster || card.classList.contains('is-rack-compact')) return false;
            motion = {
                surfaceRX: window.gsap.quickTo(surface, 'rotationX', { duration: 0.24, ease: 'power3.out' }),
                surfaceRY: window.gsap.quickTo(surface, 'rotationY', { duration: 0.24, ease: 'power3.out' }),
                surfaceZ: window.gsap.quickTo(surface, 'z', { duration: 0.24, ease: 'power3.out' }),
                surfaceScaleX: window.gsap.quickTo(surface, 'scaleX', { duration: 0.24, ease: 'power3.out' }),
                surfaceScaleY: window.gsap.quickTo(surface, 'scaleY', { duration: 0.24, ease: 'power3.out' }),
                lidSkewY: window.gsap.quickTo(lid, 'skewY', { duration: 0.24, ease: 'power3.out' }),
                posterX: window.gsap.quickTo(poster, 'x', { duration: 0.26, ease: 'power3.out' }),
                posterY: window.gsap.quickTo(poster, 'y', { duration: 0.26, ease: 'power3.out' }),
                posterScaleX: window.gsap.quickTo(poster, 'scaleX', { duration: 0.26, ease: 'power3.out' }),
                posterScaleY: window.gsap.quickTo(poster, 'scaleY', { duration: 0.26, ease: 'power3.out' })
            };
            return true;
        }

        function disposeMotion() {
            if (!motion) return;
            Object.keys(motion).forEach(function (key) {
                if (motion[key] && motion[key].tween) motion[key].tween.kill();
            });
            motion = null;
        }

        function preview(open, immediate) {
            if (open && (!card.classList.contains('is-active') || state.devicePreparing || state.devicePlaying)) return null;
            return setCasePreview({ card: card, surface: surface, lid: lid, caseBack: caseBack, caseDisc: caseDisc, shadow: shadow }, open, immediate);
        }

        function renderPointer() {
            frame = 0;
            if (!pointer || state.rackMovingVisual || state.entryRunning || state.devicePreparing || state.devicePlaying ||
                (!card.classList.contains('is-active') && !card.classList.contains('is-rack-readable')) || !ensureMotion()) return;
            var rect = pointerRect || (pointerRect = card.getBoundingClientRect());
            var relX = pointer.clientX - rect.left - rect.width / 2;
            var relY = pointer.clientY - rect.top - rect.height / 2;
            var unitX = relX / Math.max(rect.width / 2, 1);
            var unitY = relY / Math.max(rect.height / 2, 1);
            var active = card.classList.contains('is-active');
            var shadowX = active ? Math.max(2, Math.min(50, 26 - unitX * 22)) : Math.max(12, Math.min(28, 20 - unitX * 7));
            var shadowY = active ? Math.max(4, Math.min(46, 22 - unitY * 16)) : Math.max(10, Math.min(27, 18 - unitY * 6));
            var shadowSkew = active ? Math.max(-8, Math.min(6, -1.1 + unitX * 5.4)) : Math.max(-3, Math.min(2, -0.7 + unitX * 1.8));
            var shadowScaleX = 1 + Math.min(active ? 0.18 : 0.05, Math.abs(unitX) * (active ? 0.16 : 0.045));
            var shadowScaleY = 1 + Math.min(active ? 0.13 : 0.04, Math.abs(unitY) * (active ? 0.11 : 0.035));
            var edgeOpacity = Math.min(0.92, 0.38 + Math.abs(unitX) * 0.48);
            var edgeOffset = 12 + Math.min(16, Math.abs(unitX) * 14);
            if (foil) {
                foil.style.removeProperty('transition');
                foil.style.removeProperty('opacity');
            }
            card.classList.add('is-pointer-reacting');
            card.style.setProperty('--pointer-glint-x', (50 + unitX * 34).toFixed(2) + '%');
            card.style.setProperty('--pointer-glint-y', (42 + unitY * 30).toFixed(2) + '%');
            card.style.setProperty('--foil-shift-x', (unitX * 12).toFixed(2) + 'px');
            card.style.setProperty('--foil-shift-y', (unitY * 9).toFixed(2) + 'px');
            card.style.setProperty('--foil-skew', (unitX * 3.2).toFixed(2) + 'deg');
            card.style.setProperty('--shadow-x', shadowX.toFixed(2) + 'px');
            card.style.setProperty('--shadow-y', shadowY.toFixed(2) + 'px');
            card.style.setProperty('--shadow-skew', shadowSkew.toFixed(2) + 'deg');
            card.style.setProperty('--shadow-scale-x', shadowScaleX.toFixed(3));
            card.style.setProperty('--shadow-scale-y', shadowScaleY.toFixed(3));
            card.style.setProperty('--edge-opacity', edgeOpacity.toFixed(3));
            card.style.setProperty('--edge-offset', edgeOffset.toFixed(2) + 'px');
            card.style.setProperty('--case-edge-left-opacity', (unitX >= 0 ? edgeOpacity : 0.06).toFixed(3));
            card.style.setProperty('--case-edge-right-opacity', (unitX < 0 ? edgeOpacity : 0.06).toFixed(3));
            var caseOpen = card.classList.contains('is-case-open');
            motion.surfaceRX(caseOpen ? 0 : unitY * (active ? 9.5 : 2.8));
            motion.surfaceRY(caseOpen ? 0 : unitX * (active ? -11.5 : -3.2));
            motion.surfaceZ(caseOpen ? 0 : (active ? 40 : 12));
            motion.surfaceScaleX(1);
            motion.surfaceScaleY(1);
            motion.lidSkewY(caseOpen ? 0 : unitX * (active ? -0.7 : -0.22));
            motion.posterX(caseOpen ? 0 : unitX * (active ? -7 : -2.2));
            motion.posterY(caseOpen ? 0 : unitY * (active ? -5 : -1.6));
            motion.posterScaleX(caseOpen ? 1 : (active ? 1.035 : 1.01));
            motion.posterScaleY(caseOpen ? 1 : (active ? 1.035 : 1.01));
        }

        function move(event) {
            if (event.pointerType === 'touch' ||
                state.rackMovingVisual || state.entryRunning || state.devicePreparing || state.devicePlaying ||
                (!card.classList.contains('is-active') && !card.classList.contains('is-rack-readable')) || !ensureMotion()) return;
            pointer = { clientX: event.clientX, clientY: event.clientY };
            if (!frame) frame = window.requestAnimationFrame(renderPointer);
        }

        function reset(immediate, forceClose) {
            pointer = null;
            pointerRect = null;
            card.classList.remove('is-pointer-reacting');
            card.style.removeProperty('--pointer-glint-x');
            card.style.removeProperty('--pointer-glint-y');
            card.style.removeProperty('--foil-shift-x');
            card.style.removeProperty('--foil-shift-y');
            card.style.removeProperty('--foil-skew');
            // Make the hover-only foil teardown deterministic even when a
            // pointer leave coincides with a rack selection and CSS class
            // ownership changes in the same frame.
            if (foil) {
                foil.style.transition = 'none';
                foil.style.opacity = '0';
            }
            if (frame) window.cancelAnimationFrame(frame);
            frame = 0;
            if (!motion) {
                if (forceClose && card.__hero3CaseOpen) preview(false, Boolean(immediate));
                return;
            }
            window.gsap.to(card, {
                '--shadow-x': '22px',
                '--shadow-y': card.classList.contains('is-active') ? '12px' : '18px',
                '--shadow-skew': card.classList.contains('is-active') ? '-0.8deg' : '-1.1deg',
                '--shadow-scale-x': '1',
                '--shadow-scale-y': '1',
                '--edge-opacity': card.classList.contains('is-active') ? '0.42' : '0',
                '--edge-offset': '12px',
                '--case-edge-left-opacity': '0',
                '--case-edge-right-opacity': '0',
                duration: immediate ? 0 : 0.2,
                ease: 'power2.out',
                overwrite: true
            });
            var cardIsActive = card.classList.contains('is-active');
            var keepOpen = !forceClose && cardIsActive &&
                (state.deviceHovering || state.devicePreparing || state.devicePlaying);
            if (immediate) {
                disposeMotion();
                window.gsap.set(surface, { x: 0, y: 0, rotationX: 0, rotationY: 0, z: 0, scale: 1 });
                window.gsap.set(lid, { skewY: 0 });
                window.gsap.set(poster, { x: 0, y: 0, scale: 1 });
                if (cardIsActive) preview(keepOpen, true);
            } else if (cardIsActive) {
                disposeMotion();
                preview(keepOpen, false);
                window.gsap.to(poster, { x: 0, y: 0, scale: 1, duration: 0.42, ease: 'power3.out', overwrite: true });
            } else {
                motion.surfaceRX(0);
                motion.surfaceRY(0);
                motion.surfaceZ(0);
                motion.surfaceScaleX(1);
                motion.surfaceScaleY(1);
                motion.lidSkewY(0);
                motion.posterX(0);
                motion.posterY(0);
                motion.posterScaleX(1);
                motion.posterScaleY(1);
            }
        }

        function enter(event) {
            if (event.pointerType === 'touch') return;
            if (state.rackMovingVisual || state.entryRunning || state.devicePreparing || state.devicePlaying ||
                (!card.classList.contains('is-active') && !card.classList.contains('is-rack-readable'))) return;
            pointerRect = card.getBoundingClientRect();
            pointer = { clientX: event.clientX, clientY: event.clientY };
            if (ensureMotion() && !frame) frame = window.requestAnimationFrame(renderPointer);
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

    function resetCardTilts(indexes) {
        if (!Array.isArray(indexes)) {
            entryResetters.forEach(function (reset) { reset(); });
            return;
        }
        var seen = {};
        indexes.forEach(function (index) {
            if (seen[index] || !entryResetters[index]) return;
            seen[index] = true;
            entryResetters[index]();
        });
    }

    function renderCards() {
        if (!dom.orbit) return;
        if (state.inspectedCard && state.inspectedCard.parentNode) {
            state.inspectedCard.parentNode.removeChild(state.inspectedCard);
            state.inspectedCard = null;
        }
        if (dom.inspectionLayer) dom.inspectionLayer.innerHTML = '';
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
                '<img class="hero3__poster" data-poster="', escapeHtml(item.poster), '" alt="', escapeHtml(item.title), '" decoding="async" loading="eager" fetchpriority="auto">',
                '<span class="hero3__foil" aria-hidden="true"></span>',
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
                '<span class="hero3__lid-edge hero3__lid-edge--left" aria-hidden="true"></span>',
                '<span class="hero3__lid-edge hero3__lid-edge--right" aria-hidden="true"></span>',
                '<span class="hero3__lid-edge hero3__lid-edge--top" aria-hidden="true"></span>',
                '<span class="hero3__lid-edge hero3__lid-edge--bottom" aria-hidden="true"></span>',
                '</span>',
                '</span>',
                '<span class="hero3__case-spine" aria-hidden="true">',
                '<small>', String(index + 1).padStart(2, '0'), '</small>',
                '<b>', escapeHtml(item.title), '</b>',
                '</span>',
                '</button>'
            ].join('');
        }).join('');
        state.cards = qsa('.hero3__card', dom.orbit).map(function (card, index) {
            card.style.setProperty('--hero3-spine-hue', String((index * 47 + 68) % 360));
            /* The real 3D rack remains visually parked behind the cheap entry
               rail until every poster has decoded. Assigning sources later in
               bounded batches prevents image decode from sharing selection
               frames with the compositor animation. */
            card.__hero3ArtworkRequested = false;
            card.__hero3ArtworkCommitted = false;
            bindCard(card, index);
            return {
                card: card,
                spine: qs('.hero3__case-spine', card),
                setters: createSetters(card)
            };
        });
        refreshMetrics();
        state.sliderPosition = state.activeIndex;
        state.sliderTarget = state.activeIndex;
        state.carouselPosition = state.activeIndex;
        state.sliderVelocity = 0;
        state.rackNeedsRender = true;
        dom.orbit.setAttribute('data-rack-ready', 'true');
        renderRack();
        renderEntryRail();
        syncDiscOrigin();
    }

    function paintEntryRailArtwork(layout, trackWidth, signature, force) {
        var canvas = dom.entryRailArt;
        if (!canvas || !state.items.length || !state.rackArtworkReady) return false;
        if (!force && state.entryRailArtworkReady && state.entryRailArtworkSignature === signature) return true;
        var height = layout.cardWidth * 1.2666667;
        var pixelRatio = clamp(window.devicePixelRatio || 1, 1, 1.35);
        var bitmapWidth = Math.max(1, Math.round(trackWidth * pixelRatio));
        var bitmapHeight = Math.max(1, Math.round(height * pixelRatio));
        if (canvas.width !== bitmapWidth) canvas.width = bitmapWidth;
        if (canvas.height !== bitmapHeight) canvas.height = bitmapHeight;
        canvas.style.width = trackWidth.toFixed(2) + 'px';
        canvas.style.height = height.toFixed(2) + 'px';
        var context = canvas.getContext('2d', { alpha: false });
        if (!context) return false;
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'medium';
        context.fillStyle = '#071009';
        context.fillRect(0, 0, trackWidth, height);
        var slotCount = Math.ceil(trackWidth / layout.spinePitch);
        var painted = 0;
        for (var slot = 0; slot < slotCount; slot += 1) {
            var itemIndex = slot % state.items.length;
            var item = state.items[itemIndex];
            var image = item && state.preloadedPosterImages[item.poster];
            var x = slot * layout.spinePitch;
            var faceX = x + 1;
            var faceWidth = Math.max(1, layout.visibleSpineWidth);
            context.fillStyle = 'hsl(' + ((slot * 47 + 326) % 360) + ' 44% 35%)';
            context.fillRect(faceX, 0, faceWidth, height);
            if (image && image.naturalWidth && image.naturalHeight) {
                // Match the exact poster slice that the live cover reveals
                // from this closed slot. First reproduce object-fit: cover for
                // a 135/171 case, then take the hinge-side strip (or the centre
                // strip for the selected case). The shallow rail can therefore
                // hand the same pixels to the expanding live face.
                var cardRatio = layout.cardWidth / height;
                var imageRatio = image.naturalWidth / image.naturalHeight;
                var coverWidth = image.naturalWidth;
                var coverHeight = image.naturalHeight;
                var coverX = 0;
                var coverY = 0;
                if (imageRatio > cardRatio) {
                    coverWidth = image.naturalHeight * cardRatio;
                    coverX = (image.naturalWidth - coverWidth) * 0.5;
                } else {
                    coverHeight = image.naturalWidth / cardRatio;
                    coverY = (image.naturalHeight - coverHeight) * 0.5;
                }
                var sourceWidth = Math.max(1, coverWidth * faceWidth / layout.cardWidth);
                var sourceHeight = coverHeight;
                var sourceY = coverY;
                var delta = wrappedDelta(itemIndex, state.activeIndex, state.items.length);
                var sliceProgress = delta < -0.0001 ? 1 : (delta > 0.0001 ? 0 : 0.5);
                var sourceX = coverX + (coverWidth - sourceWidth) * sliceProgress;
                try {
                    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight,
                        faceX, 0, faceWidth, height);
                    painted += 1;
                } catch (error) {}
            }
            context.fillStyle = 'rgba(2, 5, 3, 0.82)';
            context.fillRect(x, 0, 1, height);
            context.fillStyle = 'rgba(225, 240, 212, 0.18)';
            context.fillRect(faceX + faceWidth - 1, 0, 1, height);
        }
        var shade = context.createLinearGradient(0, 0, 0, height);
        shade.addColorStop(0, 'rgba(255,255,255,0.17)');
        shade.addColorStop(0.16, 'rgba(255,255,255,0)');
        shade.addColorStop(0.72, 'rgba(0,0,0,0.08)');
        shade.addColorStop(1, 'rgba(0,0,0,0.56)');
        context.fillStyle = shade;
        context.fillRect(0, 0, trackWidth, height);
        state.entryRailArtworkReady = painted > 0;
        state.entryRailArtworkSignature = signature;
        if (dom.entryRail) {
            if (state.entryRailArtworkReady) dom.entryRail.setAttribute('data-entry-art', 'ready');
            else dom.entryRail.removeAttribute('data-entry-art');
        }
        return state.entryRailArtworkReady;
    }

    function renderEntryRail(forceArtwork) {
        if (!dom.entryRailTrack || !dom.entryRail) return;
        var count = state.items.length || RACK_TUNING.itemCount;
        var layout = rackLayoutMetrics(count);
        var sequenceWidth = layout.spinePitch * count;
        var repetitions = Math.max(3, Math.ceil(layout.shellWidth / sequenceWidth) + 2);
        var trackWidth = sequenceWidth * repetitions;
        state.entryRailCycleWidth = sequenceWidth;
        state.entryRailCycleDuration = Math.max(180,
            ENTRY_RAIL_CRUISE_MS * sequenceWidth / Math.max(layout.shellWidth, 1));
        dom.entryRail.style.setProperty('--hero3-entry-pitch', layout.spinePitch.toFixed(2) + 'px');
        dom.entryRail.style.setProperty('--hero3-entry-spine-width', layout.visibleSpineWidth.toFixed(2) + 'px');
        dom.entryRail.style.setProperty('--hero3-entry-card-height',
            (layout.cardWidth * 1.2666667).toFixed(2) + 'px');
        dom.entryRail.style.setProperty('--hero3-entry-track-width', trackWidth.toFixed(2) + 'px');
        dom.entryRail.style.setProperty('--hero3-entry-cycle-width', sequenceWidth.toFixed(2) + 'px');
        var signature = (state.items.map(function (item) { return item.id + ':' + item.poster; }).join('|') ||
            'placeholder-' + count) + '|active:' + state.activeIndex + '@' + trackWidth.toFixed(1) + 'x' +
            (layout.cardWidth * 1.2666667).toFixed(1);
        dom.entryRailTrack.setAttribute('data-entry-signature', signature);
        dom.entryRailTrack.style.setProperty('--hero3-entry-count', String(count));
        if (!state.rackArtworkReady) {
            state.entryRailArtworkReady = false;
            state.entryRailArtworkSignature = '';
            dom.entryRail.removeAttribute('data-entry-art');
            return;
        }
        paintEntryRailArtwork(layout, trackWidth, signature, Boolean(forceArtwork));
    }

    function cancelEntryRailAnimation() {
        if (!state.entryRailAnimation) return;
        if (typeof state.entryRailAnimation.cancel === 'function') state.entryRailAnimation.cancel();
        else if (typeof state.entryRailAnimation.kill === 'function') state.entryRailAnimation.kill();
        state.entryRailAnimation = null;
    }

    function startEntryRailCruise(forceRestart) {
        if (!hasMotion() || !dom.entryRail || !dom.entryRailTrack) return;
        renderEntryRail();
        if (state.entryRailAnimation && !forceRestart) return;
        cancelEntryRailAnimation();
        state.entryRailWidth = dom.shell.getBoundingClientRect().width || window.innerWidth;
        var travelDistance = state.entryRailCycleWidth || state.entryRailWidth;
        var cycleDuration = state.entryRailCycleDuration || ENTRY_RAIL_CRUISE_MS;
        window.gsap.killTweensOf([dom.entryRail, dom.entryRailTrack]);
        window.gsap.set(dom.entryRailTrack, { x: 0, force3D: true });
        // Keep one visual material and one opacity from first paint through
        // high-speed travel and braking.  Fading the rail up here previously
        // exposed the already-hydrated deep rack for a frame, then replaced
        // it with a nearly black abstract rail before restoring the artwork.
        window.gsap.set(dom.entryRail, { autoAlpha: 1, scaleY: 1, transformOrigin: '50% 50%' });
        state.entryRailAnimation = dom.entryRailTrack.animate([
            { transform: 'translate3d(0,0,0)' },
            { transform: 'translate3d(' + (-travelDistance) + 'px,0,0)' }
        ], {
            duration: cycleDuration,
            iterations: Infinity,
            easing: 'linear'
        });
        state.entryRailActive = true;
    }

    function brakeEntryRail(timeline, at) {
        if (!timeline || !dom.entryRailTrack || !dom.entryRail) return;
        startEntryRailCruise(false);
        var travelDistance = state.entryRailCycleWidth || state.entryRailWidth ||
            dom.shell.getBoundingClientRect().width || window.innerWidth;
        var animation = state.entryRailAnimation;
        var cycleDuration = animation && Number(animation.effect && animation.effect.getTiming().duration) ?
            Number(animation.effect.getTiming().duration) : state.entryRailCycleDuration;
        var phase = animation ? ((Number(animation.currentTime) || 0) % cycleDuration) / cycleDuration : 0;
        var currentX = -travelDistance * phase;
        var cruiseSpeed = travelDistance / (cycleDuration / 1000);
        var brakeDistance = cruiseSpeed * ENTRY_RAIL_BRAKE_SECONDS / ENTRY_RAIL_BRAKE_EASE_DERIVATIVE;
        var layout = rackLayoutMetrics(state.items.length || RACK_TUNING.itemCount);
        // Land the active cached-art item on the exact read-head centre. The
        // live closed rack uses the same wrapped item order and pitch, so this
        // also aligns every neighbouring poster slice before ownership changes.
        var naturalTargetX = currentX - brakeDistance;
        var sequenceWidth = layout.spinePitch * (state.items.length || RACK_TUNING.itemCount);
        var faceCenterOffset = 1 + layout.visibleSpineWidth * 0.5;
        var activeIndex = wrapIndex(state.activeIndex, state.items.length || RACK_TUNING.itemCount);
        var firstCycleTargetX = layout.shellWidth * 0.5 - faceCenterOffset -
            activeIndex * layout.spinePitch;
        var repeatIndex = Math.round((firstCycleTargetX - naturalTargetX) / sequenceWidth);
        var alignedTargetX = firstCycleTargetX - repeatIndex * sequenceWidth;
        // Never reverse during braking merely to reach a nearer repeated copy.
        while (alignedTargetX >= currentX - 0.5) {
            repeatIndex += 1;
            alignedTargetX -= sequenceWidth;
        }
        state.entryRailFinalX = alignedTargetX;
        state.entryRailAlignedSlot = activeIndex + repeatIndex *
            (state.items.length || RACK_TUNING.itemCount);
        cancelEntryRailAnimation();
        window.gsap.set(dom.entryRailTrack, { x: currentX, force3D: true });
        timeline.to(dom.entryRailTrack, {
            x: alignedTargetX,
            duration: ENTRY_RAIL_BRAKE_SECONDS,
            ease: 'power4.out',
            force3D: true,
            overwrite: true
        }, at);
    }

    function stopEntryRail(clearContent) {
        cancelEntryRailAnimation();
        state.entryRailActive = false;
        if (window.gsap) {
            window.gsap.killTweensOf([dom.entryRail, dom.entryRailTrack]);
            if (dom.entryRail) window.gsap.set(dom.entryRail, { autoAlpha: 0, clearProps: 'transform' });
            if (dom.entryRailTrack) window.gsap.set(dom.entryRailTrack, { clearProps: 'transform,willChange' });
        }
        if (clearContent && dom.entryRailTrack) {
            dom.entryRailTrack.removeAttribute('data-entry-signature');
            if (dom.entryRailArt) {
                dom.entryRailArt.width = 1;
                dom.entryRailArt.height = 1;
            }
            state.entryRailArtworkReady = false;
            state.entryRailArtworkSignature = '';
            state.entryRailAlignedSlot = -1;
            if (dom.entryRail) dom.entryRail.removeAttribute('data-entry-art');
        }
    }

    function prepareEntryFrames(hydrateRequest) {
        if (hydrateRequest !== state.hydrateRequest || state.entryPlayed || state.entryRunning) return;
        if (!hasMotion()) {
            window.requestAnimationFrame(playEntry);
            return;
        }

        // Paint the deep rack exactly once in its canonical closed pose. The
        // loading/high-speed phase is owned by the shallow entry rail, so the
        // browser never has to rasterise and transform 25 complete jewel cases
        // on every travelling frame.
        state.introOpacity = 1;
        state.introMaterialize = 1;
        state.introRevealStrength = 0;
        state.introCenterLift = 0;
        setIntroOwnership(0);
        state.introArrivalProgress = 1;
        state.introFlow = 0;
        state.introRackOffsetX = 0;
        state.introRackOffsetY = 0;
        state.rackNeedsRender = true;
        renderRack();
        startEntryRailCruise(false);
        if (dom.hero) dom.hero.setAttribute('data-hero-intro', 'hydrated-run');
        if (state.entryHydrationTimer) window.clearTimeout(state.entryHydrationTimer);
        state.entryHydrationTimer = window.setTimeout(function () {
            state.entryHydrationTimer = 0;
            if (hydrateRequest !== state.hydrateRequest || state.entryPlayed) return;
            window.requestAnimationFrame(playEntry);
        }, 160);
    }

    function playEntry() {
        if (state.entryPlayed || !state.cards.length) return;
        state.entryPlayed = true;
        if (dom.hero) dom.hero.setAttribute('data-hero-intro', 'preparing');
        if (!hasMotion()) {
            stopEntryRail(false);
            state.introOpacity = 1;
            state.introMaterialize = 1;
            state.introRevealStrength = 1;
            state.introCenterLift = 1;
            setIntroOwnership(1);
            state.introArrivalProgress = 1;
            state.introRackOffsetX = 0;
            state.introRackOffsetY = 0;
            state.introRackVelocity = 0;
            state.introFlow = 0;
            state.introReaderPosition = 0.5;
            state.entryRunning = false;
            state.rackNeedsRender = true;
            renderRack();
            if (dom.backdrop) dom.backdrop.style.opacity = '';
            if (dom.hero) dom.hero.setAttribute('data-hero-intro', 'ready');
            syncPlayerCarriage(true);
            syncDiscOrigin();
            prioritizeDeferredArtwork(state.activeIndex);
            scheduleDeferredArtworkHydration(state.hydrateRequest);
            return;
        }

        var gsap = window.gsap;
        state.entryRunning = true;
        state.introOpacity = 1;
        state.introMaterialize = 1;
        state.introRevealStrength = 0;
        state.introCenterLift = 0;
        setIntroOwnership(0);
        state.introArrivalProgress = 1;
        state.introRackOffsetX = 0;
        state.introRackOffsetY = 0;
        state.introRackVelocity = 0;
        state.introFlow = 0;
        state.introReaderPosition = 0;
        state.rackNeedsRender = true;
        renderRack();
        startRackTicker();
        startEntryRailCruise(false);
        var frameParts = [dom.frame, dom.register, dom.artSwitch].filter(Boolean);
        var finalTargets = [dom.backdrop, dom.zone, dom.rackControls, dom.info, dom.orbit].concat(frameParts).filter(Boolean);

        state.entryTimeline = gsap.timeline({
            defaults: { ease: 'power3.out', overwrite: 'auto' },
            onComplete: function () {
                stopEntryRail(false);
                state.entryRunning = false;
                state.entryTimeline = null;
                state.introOpacity = 1;
                state.introMaterialize = 1;
                state.introRevealStrength = 1;
                state.introCenterLift = 1;
                setIntroOwnership(1);
                state.introArrivalProgress = 1;
                state.introRackOffsetX = 0;
                state.introRackOffsetY = 0;
                state.introRackVelocity = 0;
                state.introFlow = 0;
                state.introReaderPosition = 0.5;
                state.rackNeedsRender = true;
                renderRack();
                if (dom.hero) dom.hero.setAttribute('data-hero-intro', 'ready');
                if (finalTargets.length) gsap.set(finalTargets, { clearProps: 'opacity,visibility,transform,willChange' });
                if (dom.led) gsap.set(dom.led, { clearProps: 'willChange' });
                if (dom.action) gsap.set(dom.action, { clearProps: 'willChange' });
                syncPlayerCarriage(false);
                syncDiscOrigin();
                prioritizeDeferredArtwork(state.activeIndex);
                scheduleDeferredArtworkHydration(state.hydrateRequest);
            }
        });

        if (frameParts.length) gsap.set(frameParts, { autoAlpha: 0, y: 5 });
        if (dom.orbit) gsap.set(dom.orbit, { autoAlpha: 0.001, visibility: 'visible', willChange: 'opacity' });
        if (dom.backdrop) gsap.set(dom.backdrop, { opacity: 0.001, visibility: 'visible', willChange: 'opacity' });
        if (dom.zone) gsap.set(dom.zone, { opacity: 0.001, visibility: 'visible', y: 14, willChange: 'transform,opacity' });
        if (dom.action) gsap.set(dom.action, { force3D: true, willChange: 'transform' });
        if (dom.rackControls) gsap.set(dom.rackControls, { opacity: 0.001, visibility: 'visible', y: 7, willChange: 'transform,opacity' });
        if (dom.info) gsap.set(dom.info, { opacity: 0.001, visibility: 'visible', y: 8, willChange: 'transform,opacity' });
        if (dom.led) gsap.set(dom.led, { opacity: 0.18, visibility: 'visible', willChange: 'opacity' });
        state.entryTimeline.call(function () {
            if (dom.hero) dom.hero.setAttribute('data-hero-intro', 'train-run');
        }, null, 0);
        brakeEntryRail(state.entryTimeline, 0);
        if (frameParts.length) {
            state.entryTimeline.to(frameParts, {
                autoAlpha: 1,
                y: 0,
                duration: 0.22,
                stagger: 0.06,
                ease: 'power3.out'
            }, 0.04);
        }
        state.entryTimeline
            .addLabel('full-stop', 1.18)
            .addLabel('live-aligned', 1.36)
            .addLabel('direct-unfold', 1.42)
            .addLabel('ownership-switch', 2.08)
            .addLabel('backdrop-reveal', 2.4)
            .addLabel('device-wake', 2.7);
        state.entryTimeline
            .call(function () {
                if (dom.hero) dom.hero.setAttribute('data-hero-intro', 'rack-stop');
            }, null, 'full-stop')
            // Prepare the live rack beneath the stopped rail at the same item
            // order, pitch and centre. Its storage spines remain invisible, so
            // enabling this layer cannot create a second row.
            .call(function () {
                if (dom.hero) dom.hero.setAttribute('data-hero-intro', 'live-aligned');
            }, null, 'live-aligned')
            .set(dom.orbit, { autoAlpha: 1 }, 'live-aligned')
            .call(function () {
                if (dom.hero) dom.hero.setAttribute('data-hero-intro', 'rack-open');
            }, null, 'direct-unfold')
            .to(state, {
                introRevealStrength: 1,
                introCenterLift: 1,
                duration: 0.92,
                ease: 'power2.inOut',
                onUpdate: function () { state.rackNeedsRender = true; }
            }, 'direct-unfold')
            // Exchange only ownership after the live outer spines are aligned
            // with the same canvas slots. The paired linear fade prevents a
            // brightness pulse while the unfolded covers retain foreground.
            .call(function () {
                if (dom.hero) dom.hero.setAttribute('data-hero-intro', 'ownership-switch');
            }, null, 'ownership-switch')
            .to(state, {
                introOwnershipProgress: 1,
                duration: 0.3,
                ease: 'none',
                onUpdate: function () { setIntroOwnership(state.introOwnershipProgress); },
                onComplete: function () { setIntroOwnership(1); }
            }, 'ownership-switch')
            .to(dom.entryRail, {
                autoAlpha: 0,
                duration: 0.3,
                ease: 'none'
            }, 'ownership-switch')
            .call(function () {
                stopEntryRail(false);
            }, null, 'backdrop-reveal')
            .call(function () {
                if (dom.hero) dom.hero.setAttribute('data-hero-intro', 'backdrop');
            }, null, 'backdrop-reveal');
        if (dom.backdrop) {
            state.entryTimeline.to(dom.backdrop, {
                opacity: 1,
                duration: 0.44,
                ease: 'power2.out'
            }, 'backdrop-reveal');
        }
        state.entryTimeline.call(function () {
            if (dom.hero) dom.hero.setAttribute('data-hero-intro', 'device');
        }, null, 'device-wake');
        if (dom.zone) {
            state.entryTimeline.to(dom.zone, {
                opacity: 1,
                y: 0,
                duration: 0.4,
                ease: 'power3.out'
            }, 'device-wake');
        }
        if (dom.led) {
            state.entryTimeline.fromTo(dom.led, {
                autoAlpha: 0.18
            }, {
                autoAlpha: 1,
                duration: 0.28,
                ease: 'back.out(2)'
            }, 'device-wake+=0.18');
        }
        var closingTargets = [dom.rackControls, dom.info].filter(Boolean);
        if (closingTargets.length) {
            state.entryTimeline.to(closingTargets, {
                autoAlpha: 1,
                y: 0,
                duration: 0.32,
                stagger: 0.08,
                ease: 'power3.out'
            }, 'device-wake+=0.3');
        }
    }

    function finishEntryForInput() {
        if (!state.entryRunning || !state.entryTimeline) return;
        state.entryTimeline.progress(1);
    }

    function scheduleSliderDock() {
        if (state.sliderSettleTimer) window.clearTimeout(state.sliderSettleTimer);
        state.sliderSettleTimer = window.setTimeout(function () {
            state.sliderSettleTimer = 0;
            if (state.devicePreparing || state.devicePlaying || !state.items.length) return;
            state.rackDockWorld = Math.round(state.sliderTarget);
            state.sliderTarget = state.rackDockWorld;
            state.rackDockCommitIndex = -1;
            state.rackDockNotify = false;
            state.pendingSelectionNotify = true;
            state.pendingSelection = -1;
            state.pendingSelectionSince = 0;
            state.rackNeedsRender = true;
            startRackTicker();
        }, 140);
    }

    function preloadImage(url, options) {
        if (!url) return Promise.resolve(false);
        options = options || {};
        if (String(options.reason || '').indexOf('backdrop') >= 0) state.backdropPreloadUrls[url] = true;
        if (state.imagePromises[url]) return state.imagePromises[url];
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
                state.imageLoadStatus[url] = Boolean(value);
                if (value) state.preloadedPosterImages[url] = image;
                if (value && state.backdropPreloadUrls[url]) state.preloadedBackdropImages[url] = image;
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
        var indexes = [];
        var preferred = Math.max(0, Math.min(length - 1, Number(activeIndex) || 0));
        if (!length) return indexes;
        indexes.push(preferred);
        for (var distance = 1; indexes.length < length; distance += 1) {
            var before = preferred - distance;
            var after = preferred + distance;
            if (before >= 0) indexes.push(before);
            if (after < length) indexes.push(after);
        }
        return indexes;
    }

    function preloadItems(items, activeIndex, requestId) {
        var source = items || [];
        var indexes = preloadIndexes(source.length, activeIndex);
        var criticalCount = indexes.length;
        var criticalIndexes = indexes.slice(0, criticalCount);
        state.criticalArtworkIndexes = criticalIndexes.slice();
        state.deferredArtworkQueue = [];
        state.deferredArtworkHydrated = 0;
        state.preloadPlan = criticalIndexes.map(function (index) { return index + 1; });
        var cursor = 0;
        var results = new Array(criticalIndexes.length);
        var workers = [];
        var workerCount = Math.min(2, criticalIndexes.length);

        // The shallow CSS rail is intentionally allowed to cruise for longer
        // while every rack poster is fetched and decoded. This spends memory
        // and loading time before the handoff so the 3D entrance and direct
        // interaction never compete with background image decode or DOM image
        // promotion. Failed artwork still settles to the reserved placeholder.
        function worker() {
            function next() {
                if (requestId && requestId !== state.hydrateRequest) return Promise.resolve();
                var position = cursor++;
                if (position >= criticalIndexes.length) return Promise.resolve();
                var index = criticalIndexes[position];
                var item = source[index];
                if (!item || !item.poster) {
                    results[position] = false;
                    return next();
                }
                return preloadImage(item.poster, {
                    index: index + 1,
                    reason: 'poster',
                    priority: position < 5 ? 'high' : 'auto'
                }).then(function (loaded) {
                    results[position] = loaded;
                    return next();
                });
            }
            return next();
        }
        for (var workerIndex = 0; workerIndex < workerCount; workerIndex += 1) workers.push(worker());
        var activeBackdrop = source[activeIndex] && (source[activeIndex].backdrop || source[activeIndex].poster);
        var backdropTask = activeBackdrop ? preloadImage(activeBackdrop, {
                index: activeIndex + 1,
                reason: 'backdrop',
                priority: 'high'
            }) : Promise.resolve(false);
        return Promise.all([Promise.all(workers), backdropTask]).then(function () {
            return results;
        });
    }

    function promoteArtworkIndex(index, reveal) {
        var entry = state.cards[index];
        var card = entry && entry.card;
        var item = state.items[index];
        if (!card || !item || !item.poster || !state.imageLoadStatus[item.poster]) return false;
        var image = qs('.hero3__poster', card);
        var discArtwork = qs('.hero3__disc-art', card);
        var currentPoster = image ? (image.getAttribute('src') || '') : '';
        if (state.rackArtworkReady && card.__hero3ArtworkCommitted && currentPoster && currentPoster !== item.poster) {
            return true;
        }
        card.__hero3ArtworkRequested = true;
        card.__hero3ArtworkCommitted = true;
        if (image && image.getAttribute('src') !== item.poster) image.src = item.poster;
        setDiscArtwork(discArtwork, item.poster);
        setSpineArtwork(card, item.poster);
        card.classList.add('has-rack-artwork');
        if (reveal) {
            revealArtwork(image);
            revealArtwork(discArtwork);
        }
        return true;
    }

    function promoteRackArtwork(requestId) {
        return new Promise(function (resolve) {
            var index = 0;
            var promoteIndexes = state.criticalArtworkIndexes.slice();
            function promoteBatch() {
                if (requestId !== state.hydrateRequest) {
                    resolve(false);
                    return;
                }
                var end = Math.min(index + 4, promoteIndexes.length);
                for (; index < end; index += 1) {
                    promoteArtworkIndex(promoteIndexes[index], false);
                }
                if (index < promoteIndexes.length) {
                    window.requestAnimationFrame(promoteBatch);
                    return;
                }
                state.rackArtworkReady = true;
                // Paint decoded poster crops into one shallow canvas before the
                // brake begins. The moving layer stays text-free and performs
                // no per-case work while travelling.
                renderEntryRail(true);
                // Two paint opportunities ensure all hidden layers are
                // composited before the full-width rail begins braking.
                window.requestAnimationFrame(function () {
                    window.requestAnimationFrame(function () { resolve(true); });
                });
            }
            window.requestAnimationFrame(promoteBatch);
        });
    }

    function cancelDeferredArtworkHydration() {
        if (!state.deferredArtworkHandle) return;
        if (state.deferredArtworkHandleType === 'idle' && typeof window.cancelIdleCallback === 'function') {
            window.cancelIdleCallback(state.deferredArtworkHandle);
        } else {
            window.clearTimeout(state.deferredArtworkHandle);
        }
        state.deferredArtworkHandle = 0;
        state.deferredArtworkHandleType = '';
    }

    function prioritizeDeferredArtwork(activeIndex) {
        if (!state.deferredArtworkQueue.length || !state.items.length) return;
        var priority = [];
        [0, -1, 1, -2, 2, -3, 3].forEach(function (offset) {
            var index = wrapIndex(activeIndex + offset, state.items.length);
            if (state.deferredArtworkQueue.indexOf(index) >= 0 && priority.indexOf(index) < 0) priority.push(index);
        });
        if (!priority.length) return;
        state.deferredArtworkQueue = priority.concat(state.deferredArtworkQueue.filter(function (index) {
            return priority.indexOf(index) < 0;
        }));
    }

    function scheduleDeferredArtworkHydration(requestId) {
        cancelDeferredArtworkHydration();
        if (requestId !== state.hydrateRequest || !state.rackArtworkReady || !state.deferredArtworkQueue.length) return;

        function run(deadline) {
            state.deferredArtworkHandle = 0;
            state.deferredArtworkHandleType = '';
            if (requestId !== state.hydrateRequest || document.hidden) return;
            if (state.entryRunning || state.rackMovingVisual || state.devicePreparing || state.devicePlaying) {
                scheduleDeferredArtworkHydration(requestId);
                return;
            }
            if (deadline && typeof deadline.timeRemaining === 'function' && !deadline.didTimeout && deadline.timeRemaining() < 7) {
                scheduleDeferredArtworkHydration(requestId);
                return;
            }
            var index = state.deferredArtworkQueue.shift();
            var item = state.items[index];
            if (!item || !item.poster) {
                scheduleDeferredArtworkHydration(requestId);
                return;
            }
            preloadImage(item.poster, {
                index: index + 1,
                reason: 'idle-poster',
                priority: 'low'
            }).then(function (loaded) {
                if (requestId !== state.hydrateRequest) return;
                if (loaded && promoteArtworkIndex(index, true)) state.deferredArtworkHydrated += 1;
                scheduleDeferredArtworkHydration(requestId);
            });
        }

        if (typeof window.requestIdleCallback === 'function') {
            state.deferredArtworkHandleType = 'idle';
            state.deferredArtworkHandle = window.requestIdleCallback(run, { timeout: 1200 });
        } else {
            state.deferredArtworkHandleType = 'timeout';
            state.deferredArtworkHandle = window.setTimeout(function () { run(null); }, 180);
        }
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
        if (!image || !item.poster) return;
        // Once the real rack has been promoted, keep its visual media frozen
        // for the lifetime of this Hero session. Detail hydration can improve
        // poster ranking after the entrance has finished; replacing an already
        // composited face during navigation forces a new decode/raster pass and
        // reads as a blank-frame/card-switch artifact. Text metadata can still
        // refresh independently through updateCardMetadata().
        var currentPoster = image.getAttribute('src') || '';
        if (state.rackArtworkReady && card.__hero3ArtworkCommitted && currentPoster && currentPoster !== item.poster) return;
        image.dataset.poster = item.poster;
        if (!card.__hero3ArtworkRequested) return;
        setSpineArtwork(card, item.poster);
        if (image.getAttribute('src') === item.poster) return;
        var token = (card.__hero3ArtworkToken || 0) + 1;
        card.__hero3ArtworkToken = token;
        preloadImage(item.poster).then(function (loaded) {
            if (!loaded || !image.isConnected || !card.__hero3ArtworkRequested ||
                card.__hero3ArtworkToken !== token || image.getAttribute('src') === item.poster) return;
            var discArtwork = card ? qs('.hero3__disc-art', card) : null;
            image.src = item.poster;
            setDiscArtwork(discArtwork, item.poster);
            setSpineArtwork(card, item.poster);
            card.__hero3ArtworkCommitted = true;
            card.classList.add('has-rack-artwork');
            revealArtwork(image);
            revealArtwork(discArtwork);
        });
    }

    function clearInactiveCaseStates(activeIndex) {
        state.cards.forEach(function (entry, index) {
            if (!entry || !entry.card || index === activeIndex) return;
            var card = entry.card;
            if (card.__hero3CaseTimeline) {
                card.__hero3CaseTimeline.kill();
                card.__hero3CaseTimeline = null;
            }
            card.__hero3CaseOpen = false;
            card.classList.remove('is-case-open', 'is-case-transitioning');
        });
    }

    function requestCardArtwork(entry, item) {
        var card = entry && entry.card;
        if (!card || !item || !item.poster) return Promise.resolve(false);
        if (card.__hero3ArtworkRequested) return state.imagePromises[item.poster] || Promise.resolve(true);
        card.__hero3ArtworkRequested = true;
        var token = (card.__hero3ArtworkToken || 0) + 1;
        card.__hero3ArtworkToken = token;
        var image = qs('.hero3__poster', card);
        var discArtwork = qs('.hero3__disc-art', card);
        return preloadImage(item.poster, { reason: 'nearby-poster', priority: 'auto' }).then(function (loaded) {
            if (!loaded || !card.isConnected || !image || !card.__hero3ArtworkRequested || card.__hero3ArtworkToken !== token) return false;
            image.src = item.poster;
            setDiscArtwork(discArtwork, item.poster);
            setSpineArtwork(card, item.poster);
            card.__hero3ArtworkCommitted = true;
            card.classList.add('has-rack-artwork');
            revealArtwork(image);
            revealArtwork(discArtwork);
            return true;
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
        var spineTitle = qs('.hero3__case-spine b', card);
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
        if (spineTitle) spineTitle.textContent = item.title;
        if (summary) summary.textContent = accessibleItemSummary(item);
    }

    function syncDiscArtwork(item) {
        if (!item) return;
        var ownerId = String(item.id || '');
        setDiscArtwork(dom.discArt, item.poster);
        setDiscArtwork(dom.loadedDiscArt, item.poster);
        if (dom.disc) dom.disc.setAttribute('data-anime-id', ownerId);
        if (dom.loadedDisc) dom.loadedDisc.setAttribute('data-anime-id', ownerId);
        if (dom.action) dom.action.setAttribute('data-anime-id', ownerId);
    }

    function updateBackdrop(item, immediate, allowIntent) {
        if (!dom.backdropA || !dom.backdropB || !item) return;
        var url = item.backdrop || item.poster;
        if (!url) return;
        var front = state.backdropFront === 'A' ? dom.backdropA : dom.backdropB;
        var back = state.backdropFront === 'A' ? dom.backdropB : dom.backdropA;
        var backName = state.backdropFront === 'A' ? 'B' : 'A';
        var nextRatio = item.backdropKind === 'wide' ? 'wide' : 'poster';
        var ownerId = String(item.id || '');
        var frontOwnerId = String(front.getAttribute('data-anime-id') || '');

        function ownerIsCurrent() {
            var activeItem = state.items[state.activeIndex];
            var activeMatches = activeItem && String(activeItem.id || '') === ownerId;
            var intentMatches = Boolean(allowIntent) && state.backdropIntentId === ownerId;
            return activeMatches || intentMatches;
        }

        if (front.getAttribute('src') === url && frontOwnerId === ownerId && front.classList.contains('is-active')) {
            state.backdropTargetUrl = url;
            state.backdropOwnerId = ownerId;
            state.backdropPendingOwnerId = '';
            front.setAttribute('data-ratio', nextRatio);
            dom.backdrop.setAttribute('data-ratio', nextRatio);
            return;
        }

        if (state.backdropTargetUrl === url && state.backdropPendingOwnerId === ownerId &&
            ((front.getAttribute('src') === url && frontOwnerId === ownerId) ||
                (back.getAttribute('src') === url && String(back.getAttribute('data-anime-id') || '') === ownerId))) {
            if (front.getAttribute('src') === url && frontOwnerId === ownerId) {
                front.setAttribute('data-ratio', nextRatio);
                dom.backdrop.setAttribute('data-ratio', nextRatio);
            }
            if (back.getAttribute('src') === url && String(back.getAttribute('data-anime-id') || '') === ownerId) {
                back.setAttribute('data-ratio', nextRatio);
            }
            return;
        }

        state.backdropTargetUrl = url;
        state.backdropPendingOwnerId = ownerId;
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
        back.setAttribute('data-anime-id', ownerId);
        if (immediate && frontOwnerId !== ownerId) {
            front.classList.remove('is-active');
            front.style.opacity = '0';
            front.style.visibility = 'hidden';
        }

        var revealed = false;
        var decodeStarted = false;

        function reveal() {
            if (revealed || requestId !== state.backdropRequest ||
                !ownerIsCurrent() ||
                String(back.getAttribute('data-anime-id') || '') !== ownerId) return;
            revealed = true;
            back.onload = null;
            back.onerror = null;
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
                    autoAlpha: 0
                });
                window.gsap.set(front, {
                    autoAlpha: targetOpacity
                });
                state.backdropTimeline = window.gsap.timeline({
                    defaults: { overwrite: 'auto' },
                    onComplete: function () {
                        if (requestId !== state.backdropRequest || !ownerIsCurrent() ||
                            String(back.getAttribute('data-anime-id') || '') !== ownerId) return;
                        state.backdropTimeline = null;
                        front.classList.remove('is-active');
                        dom.backdrop.classList.remove('is-switching');
                        window.gsap.set(front, { autoAlpha: 0 });
                        clearLayerStyles(front);
                        clearLayerStyles(back);
                    }
                })
                    .to(front, {
                        autoAlpha: 0,
                        duration: 0.18,
                        ease: 'power2.out'
                    }, 0)
                    .to(back, {
                        autoAlpha: targetOpacity,
                        duration: 0.2,
                        ease: 'power3.out'
                    }, 0);
            }
            state.backdropOwnerId = ownerId;
            state.backdropPendingOwnerId = '';
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
            state.backdropPendingOwnerId = '';
            if (String(front.getAttribute('data-anime-id') || '') === ownerId) {
                state.backdropTargetUrl = front.getAttribute('src') || '';
                state.backdropOwnerId = ownerId;
            } else {
                state.backdropTargetUrl = '';
                state.backdropOwnerId = '';
            }
        };
        if (state.preloadedBackdropImages[url]) {
            if (back.getAttribute('src') !== url) back.src = url;
            decodeAndReveal();
        } else if (back.getAttribute('src') === url && back.complete && back.naturalWidth) decodeAndReveal();
        else back.src = url;
    }

    function updateSelectionRegister(item, index) {
        if (!item) return;
        var registerIndex = Number.isFinite(Number(index)) ? Number(index) : state.activeIndex;
        if (dom.index) dom.index.textContent = String(registerIndex + 1).padStart(2, '0');
        if (dom.code) dom.code.textContent = item.code;
        if (dom.register) dom.register.setAttribute('data-anime-id', String(item.id || ''));
    }

    function updateInfo(item) {
        if (!item) return;
        var progress = item.progress;
        // Publish the committed identity before updating any dependent media.
        // The backdrop, case disc and player disc all validate against this
        // attribute so no previous/outer card can become the transfer source.
        if (dom.hero) {
            dom.hero.setAttribute('data-hero-state', 'ready');
            dom.hero.setAttribute('data-active-anime-id', item.id);
        }
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
        updateSelectionRegister(item, state.activeIndex);
        if (dom.action) dom.action.setAttribute('aria-label', '继续播放 ' + item.title);
        if (dom.mechMeta) dom.mechMeta.textContent = 'EP ' + String(progress.watched || 0).padStart(2, '0') + ' / LOAD + RESUME';
        syncDiscArtwork(item);
    }

    function commitRackSelection(index, notify, immediateBackdrop, deferRender) {
        var item = state.items[index];
        if (!item) return;
        var changed = index !== state.activeIndex;
        if (changed) {
            var previousIndex = state.activeIndex;
            // Do not force layout for the old case while the rack is about to
            // move. The flight-disc origin is measured once, after docking.
            resetDevice(true, true, true);
            resetCardTilts([previousIndex]);
            state.activeIndex = index;
            clearInactiveCaseStates(index);
        }
        updateInfo(item);
        updateBackdrop(item, Boolean(immediateBackdrop), false);
        if (state.backdropIntentId === String(item.id || '')) {
            state.backdropIntentId = '';
            state.backdropIntentIndex = -1;
        }
        prioritizeDeferredArtwork(index);
        scheduleDeferredArtworkHydration(state.hydrateRequest);
        if (state.nearbyBackdropTimer) window.clearTimeout(state.nearbyBackdropTimer);
        state.nearbyBackdropTimer = window.setTimeout(function () {
            state.nearbyBackdropTimer = 0;
            if (!state.items[index] || state.activeIndex !== index || state.devicePreparing || state.devicePlaying) return;
            [-1, 1, -2, 2].forEach(function (offset) {
                var nearbyIndex = wrapIndex(index + offset, state.items.length);
                var nearby = state.items[nearbyIndex];
                var nearbyBackdrop = nearby && (nearby.backdrop || nearby.poster);
                if (nearbyBackdrop) preloadImage(nearbyBackdrop, {
                    index: nearbyIndex + 1,
                    reason: 'nearby-backdrop',
                    priority: Math.abs(offset) === 1 ? 'high' : 'auto'
                });
            });
        }, 320);
        state.rackNeedsRender = true;
        if (!deferRender) {
            renderRack();
            startRackTicker();
        }
        state.discOriginNeedsSync = true;
        if (notify && state.options && typeof state.options.onSelect === 'function') {
            state.options.onSelect(item.raw, item);
        }
        if (state.focusOnCommit && state.cards[index] && state.cards[index].card) {
            try { state.cards[index].card.focus({ preventScroll: true }); }
            catch (error) { state.cards[index].card.focus(); }
        }
        state.focusOnCommit = false;
    }

    function selectIndex(nextIndex, direction, immediate, notify) {
        var total = state.items.length;
        if (!total || state.devicePreparing || state.devicePlaying) return;
        var moveFocus = document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('hero3__card');
        nextIndex = wrapIndex(nextIndex, total);
        finishEntryForInput();
        if (state.sliderSettleTimer) {
            window.clearTimeout(state.sliderSettleTimer);
            state.sliderSettleTimer = 0;
        }
        var motionBase = state.sliderTarget;
        var delta = shortestIndexDelta(nextIndex, motionBase, total);
        // At the exact half-turn, preserve the control direction so repeated
        // steps never reverse unexpectedly.
        if (total % 2 === 0 && Math.abs(delta) === total / 2 && direction) {
            delta = Math.abs(delta) * (direction < 0 ? -1 : 1);
        }
        var target = motionBase + delta;
        var closeDelay = prepareRackMove();
        resetCardTilts([state.activeIndex]);
        state.sliderTarget = target;
        state.rackDockWorld = Math.round(target);
        state.rackDockCommitIndex = nextIndex;
        state.rackDockNotify = Boolean(notify);
        state.pendingSelectionNotify = false;
        var targetItem = state.items[nextIndex];
        var targetBackdrop = targetItem && (targetItem.backdrop || targetItem.poster);
        // The upper-right register describes the accepted navigation target,
        // not the outgoing card. This write happens before animation or image
        // work, so rapid reversals cannot leave a stale channel identity.
        if (targetItem) {
            updateSelectionRegister(targetItem, nextIndex);
            if (state.options && typeof state.options.onIntent === 'function') {
                state.options.onIntent(targetItem.raw, targetItem, nextIndex);
            }
        }
        state.backdropIntentId = '';
        state.backdropIntentIndex = -1;
        if (targetItem && targetBackdrop) {
            state.backdropIntentId = String(targetItem.id || '');
            state.backdropIntentIndex = nextIndex;
            preloadImage(targetBackdrop, {
                index: nextIndex + 1,
                reason: 'selection-target-backdrop',
                priority: 'high'
            });
            // The target layer may decode during card motion. Cached artwork
            // begins responding immediately; a later load is still guarded by
            // the latest navigation intent and cannot promote stale identity.
            updateBackdrop(targetItem, false, true);
        }
        if (closeDelay) stopRackTicker();
        state.focusOnCommit = moveFocus;
        state.pendingSelection = -1;
        state.pendingSelectionSince = 0;
        state.rackNeedsRender = true;
        queueRackMotion(closeDelay);

        if (immediate || !hasMotion()) {
            cancelRackMoveDelay();
            state.sliderPosition = target;
            state.sliderVelocity = 0;
            state.carouselPosition = target;
            state.rackDockWorld = null;
            state.rackDockCommitIndex = -1;
            state.rackDockNotify = false;
            state.backdropIntentId = '';
            state.backdropIntentIndex = -1;
            commitRackSelection(nextIndex, notify, Boolean(immediate));
        }
    }

    function cardPartsAt(index) {
        var active = state.cards[index] && state.cards[index].card;
        return {
            index: index,
            animeId: active ? String(active.getAttribute('data-anime-id') || '') : '',
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

    function activeCardParts() {
        return cardPartsAt(state.activeIndex);
    }

    function committedSelection(requireSettled) {
        var index = state.activeIndex;
        var item = state.items[index];
        var parts = cardPartsAt(index);
        var id = item ? String(item.id || '') : '';
        var heroId = dom.hero ? String(dom.hero.getAttribute('data-active-anime-id') || '') : '';
        if (!item || !parts.card || !id || parts.animeId !== id || heroId !== id) return null;
        if (requireSettled) {
            var delta = Math.abs(wrappedDelta(index, state.sliderPosition, state.items.length));
            var geometry = state.rackGeometry[index];
            if (state.entryRunning || state.rackMovingVisual || state.rackDockCommitIndex >= 0 ||
                delta > 0.08 || Math.abs(state.sliderVelocity) > 0.03 ||
                (geometry && Math.abs(geometry.angle || 0) > 1.5)) return null;
        }
        return { index: index, id: id, item: item, parts: parts };
    }

    function selectionIsCurrent(selection, requireSettled) {
        if (!selection) return false;
        var current = committedSelection(Boolean(requireSettled));
        return Boolean(current && current.index === selection.index && current.id === selection.id);
    }

    function syncPlayerCarriage(immediate) {
        if (!dom.zone || !window.gsap) return;
        // The ring moves through one fixed read head.  During a drag the user
        // may pull the carriage a short distance, but it docks back at center.
        var targetX = 0;
        state.playerX = targetX;
        window.gsap.to(dom.zone, {
            x: targetX,
            duration: immediate || !hasMotion() ? 0 : 0.72,
            ease: 'power3.inOut',
            overwrite: 'auto',
            onComplete: syncDiscOrigin
        });
    }

    function cancelRackMoveDelay() {
        if (state.rackMoveDelayTimer) {
            window.clearTimeout(state.rackMoveDelayTimer);
            state.rackMoveDelayTimer = 0;
        }
        state.rackMoveDelayUntil = 0;
    }

    function queueRackMotion(delay) {
        if (!delay) {
            cancelRackMoveDelay();
            startRackTicker();
            return;
        }
        if (state.rackMoveDelayTimer) window.clearTimeout(state.rackMoveDelayTimer);
        state.rackMoveDelayTimer = window.setTimeout(function () {
            state.rackMoveDelayTimer = 0;
            state.rackMoveDelayUntil = 0;
            startRackTicker();
            scheduleSliderDock();
        }, Math.max(0, delay));
    }

    function prepareRackMove() {
        var now = Date.now();
        if (state.rackMoveDelayUntil > now) return state.rackMoveDelayUntil - now;
        var parts = activeCardParts();
        var activeCard = parts && parts.card;
        var caseIsExposed = state.deviceHovering || (activeCard && (
            activeCard.classList.contains('is-case-open') ||
            activeCard.classList.contains('is-case-transitioning')
        ));
        if (!caseIsExposed) return 0;
        if (activeCard.__hero3CaseOpen === false && activeCard.classList.contains('is-case-transitioning')) {
            state.rackMoveDelayUntil = now + 370;
            return 370;
        }
        // A browsed case first returns to the shelf plane, then the rack moves.
        // This prevents an open lid from being carried into the left stack and
        // makes repeated trackpad packets share one close operation.
        resetDevice(false, true);
        state.rackMoveDelayUntil = now + 370;
        return 370;
    }

    function configureLiftGuide(path) {
        if (!path || !dom.guide) return;
        dom.guide.style.left = path.startX.toFixed(2) + 'px';
        dom.guide.style.top = path.startY.toFixed(2) + 'px';
        dom.guide.style.width = (path.discSize + 48).toFixed(2) + 'px';
        dom.guide.style.height = path.distance.toFixed(2) + 'px';
        dom.guide.style.transform = 'translateX(-50%) rotate(' + path.guideAngle.toFixed(3) + 'deg)';
    }

    function measureDiscPath(selection) {
        selection = selection || committedSelection(true);
        if (!selection || !selectionIsCurrent(selection, true)) return null;
        var parts = selection.parts;
        if (!parts.caseDisc || !dom.shell || !dom.tray || !dom.disc) return null;
        var coordinateRoot = dom.disc.offsetParent || dom.shell;
        var rootRect = coordinateRoot.getBoundingClientRect();
        var sourceRect = parts.caseDisc.getBoundingClientRect();
        // The bounding box of a disc inside an edge-on case is a projected
        // ellipse and can be only a few pixels wide. Its physical diameter is
        // the untransformed layout width; only its centre comes from the
        // rendered box. This keeps case, flight and machine media identical.
        var logicalDiameter = parts.caseDisc.offsetWidth ||
            parseFloat(window.getComputedStyle(parts.caseDisc).width) ||
            state.mediaDiameter || 210;
        state.mediaDiameter = logicalDiameter;
        if (dom.action) dom.action.style.setProperty('--loaded-disc-size', logicalDiameter.toFixed(2) + 'px');
        var targetRect = dom.tray.getBoundingClientRect();
        var discDiameter = dom.disc.offsetWidth || 210;
        var path = {
            startX: sourceRect.left + sourceRect.width / 2 - rootRect.left,
            startY: sourceRect.top + sourceRect.height / 2 - rootRect.top,
            startScale: logicalDiameter / Math.max(discDiameter, 1),
            targetX: targetRect.left + targetRect.width / 2 - rootRect.left,
            targetY: targetRect.top + targetRect.height / 2 - rootRect.top,
            discSize: logicalDiameter,
            animeId: selection.id
        };
        var dx = path.targetX - path.startX;
        var dy = path.targetY - path.startY;
        path.distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        path.guideAngle = -Math.atan2(dx, dy) * 180 / Math.PI;
        configureLiftGuide(path);
        return path;
    }

    function syncDiscOrigin() {
        var selection = committedSelection(true);
        var path = selection ? measureDiscPath(selection) : null;
        if (!path || !dom.disc || !window.gsap || state.devicePreparing || state.devicePlaying) return path;
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

    function resetDevice(immediate, force, skipDiscSync) {
        if ((state.devicePreparing || state.devicePlaying) && !force) return;
        state.deviceHovering = false;
        state.casePinnedOpen = false;
        if (force) {
            state.devicePreparing = false;
            state.devicePlaying = false;
            state.playSelectionId = '';
            state.playRequest += 1;
        }
        state.exitProgress = 0;
        state.rackNeedsRender = true;
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
        if (!skipDiscSync) syncDiscOrigin();
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

    function startDeviceHover(pinned, selection) {
        if (state.devicePreparing || state.devicePlaying) return null;
        selection = selection || committedSelection(true);
        if (!selection || !selectionIsCurrent(selection, true)) return null;
        if (pinned) state.casePinnedOpen = true;
        var parts = selection.parts;
        if (state.deviceHovering && parts.card && parts.card.__hero3CaseOpen === true) {
            return parts.card.__hero3CaseTimeline || null;
        }
        resetCardTilts([state.activeIndex]);
        state.deviceHovering = true;
        if (dom.action) dom.action.classList.add('is-armed');
        if (!hasMotion()) {
            return setCasePreview(parts, true, true);
        }
        window.gsap.killTweensOf([dom.tray, dom.deckLid, dom.mechButton, dom.led, dom.guide, dom.guideCoupler, parts.surface, parts.lid, parts.caseBack, parts.caseDisc, parts.shadow].concat(dom.guideRails || []).filter(Boolean));
        var openTimeline = setCasePreview(parts, true, false);
        window.gsap.to(dom.tray, { y: -14, scale: 1, duration: 0.54, ease: 'power4.out', overwrite: true });
        window.gsap.to(dom.deckLid, { y: -22, duration: 0.46, ease: 'power3.out', overwrite: true });
        window.gsap.to(dom.mechButton, { y: 1, duration: 0.16, ease: 'power2.out', overwrite: true });
        window.gsap.to(dom.led, { opacity: 1, duration: 0.22, ease: 'power3.out', overwrite: true });
        if (dom.guide) window.gsap.set(dom.guide, { autoAlpha: 0 });
        return openTimeline;
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
        var frameParts = [qs('.hero3__frame'), qs('.hero3__register'), qs('.hero3__art-switch')].filter(Boolean);
        if (dom.action) dom.action.classList.add('is-playing');
        if (dom.loadState) dom.loadState.textContent = 'PLAY';
        state.deviceTimeline = window.gsap.timeline({
            defaults: { ease: 'power3.inOut', overwrite: 'auto' }
        });
        state.deviceTimeline
            .addLabel('exit', 0)
            .to(dom.loadedDisc, { rotation: '+=420_cw', scale: 1, duration: 0.76, ease: 'none' }, 'exit')
            .to(dom.zone, { y: 10, scale: 0.985, autoAlpha: 0.52, duration: 0.62 }, 'exit+=0.08')
            .to(state, {
                exitProgress: 1,
                duration: 0.56,
                ease: 'power2.inOut',
                onUpdate: function () { state.rackNeedsRender = true; }
            }, 'exit+=0.1')
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
        if (!state.items.length || state.devicePreparing || state.devicePlaying) return;
        var selection = committedSelection(true);
        if (!selection) return;
        var requestId = ++state.playRequest;
        var intentPromise = requestPlayIntent(selection.item);
        if (!hasMotion()) {
            intentPromise.then(function (intent) {
                if (requestId === state.playRequest && selectionIsCurrent(selection, true)) {
                    commitPlayIntent(intent, requestId);
                }
            });
            return;
        }

        // Opening and transferring are two serial phases. The old timeline
        // started the flight while the case was still rotating and could read
        // geometry from whichever outer card happened to occupy that slot.
        var openTimeline = startDeviceHover(false, selection);
        state.devicePreparing = true;
        state.playSelectionId = selection.id;
        if (dom.action) {
            dom.action.classList.add('is-loading');
            dom.action.setAttribute('aria-busy', 'true');
        }
        if (dom.loadState) dom.loadState.textContent = 'OPEN';

        waitForTimeline(openTimeline).then(function () {
            if (requestId !== state.playRequest || !selectionIsCurrent(selection, true) ||
                state.playSelectionId !== selection.id) return;
            var parts = selection.parts;
            var path = measureDiscPath(selection);
            if (!parts.lid || !parts.caseDisc || !path || path.animeId !== selection.id) {
                resetDevice(false, true);
                return;
            }

            state.devicePreparing = false;
            state.devicePlaying = true;
            state.deviceHovering = false;
            if (dom.loadState) dom.loadState.textContent = 'READ';
            syncDiscArtwork(selection.item);
            window.gsap.killTweensOf([
                dom.disc, dom.guide, dom.guideCoupler, dom.tray, dom.deckLid,
                dom.loadedDisc, dom.mechButton, dom.led
            ].concat(dom.guideRails || []).filter(Boolean));
            window.gsap.set(dom.tray, { y: -14, scale: 1 });
            window.gsap.set(dom.deckLid, { y: -22 });
            window.gsap.set(dom.disc, {
                xPercent: -50,
                yPercent: -50,
                x: path.startX,
                y: path.startY,
                scale: path.startScale,
                rotation: 0,
                autoAlpha: 1
            });
            window.gsap.set(dom.loadedDisc, {
                xPercent: -50,
                yPercent: -50,
                rotation: 0,
                autoAlpha: 0,
                scale: 1
            });
            window.gsap.set(parts.caseDisc, { autoAlpha: 0 });
            if (dom.guide) window.gsap.set(dom.guide, { autoAlpha: 0.74 });
            if (dom.guideRails && dom.guideRails.length) {
                window.gsap.set(dom.guideRails, { scaleY: 0, transformOrigin: '50% 0%' });
            }
            if (dom.guideCoupler) window.gsap.set(dom.guideCoupler, { y: 0, autoAlpha: 0 });

            var animationResolve;
            var animationPromise = new Promise(function (resolve) { animationResolve = resolve; });
            state.deviceTimeline = window.gsap.timeline({
                defaults: { ease: 'power3.inOut', overwrite: 'auto' },
                onComplete: function () {
                    animationResolve();
                    if (requestId !== state.playRequest || !selectionIsCurrent(selection, false) ||
                        state.playSelectionId !== selection.id) return;
                    state.deviceTimeline = null;
                    state.deviceSpin = window.gsap.to(dom.loadedDisc, {
                        rotation: '+=360_cw',
                        duration: 0.82,
                        repeat: -1,
                        ease: 'none',
                        overwrite: false
                    });
                },
                onInterrupt: function () { animationResolve(); }
            });
            state.deviceTimeline
                .addLabel('lift', 0)
                .to(dom.mechButton, { y: 5, duration: 0.16, ease: 'power2.in' }, 'lift')
                .to(dom.guideRails, { scaleY: 1, duration: 0.28, ease: 'power3.out', stagger: 0.025 }, 'lift')
                .to(dom.guideCoupler, { autoAlpha: 1, duration: 0.14 }, 'lift+=0.04')
                .addLabel('transfer', 0.12)
                .to(dom.disc, {
                    x: path.targetX,
                    y: path.targetY,
                    rotation: 0,
                    duration: 0.98,
                    ease: 'power2.inOut'
                }, 'transfer')
                .to(dom.guideCoupler, {
                    y: path.distance,
                    duration: 0.98,
                    ease: 'power2.inOut'
                }, 'transfer')
                .addLabel('dock', 1.1)
                .set(dom.loadedDisc, { autoAlpha: 1, rotation: 0, scale: 1 }, 'dock')
                .set(dom.disc, { autoAlpha: 0 }, 'dock+=0.01')
                .to(dom.loadedDisc, { rotation: 720, duration: 1.02, ease: 'none' }, 'dock')
                .to(dom.guideCoupler, { autoAlpha: 0, duration: 0.16, ease: 'power2.out' }, 'dock')
                .to(dom.guideRails, { scaleY: 0, duration: 0.34, ease: 'power3.in', stagger: 0.025 }, 'dock+=0.04')
                .to(dom.deckLid, { y: 0, duration: 0.38, ease: 'power3.inOut' }, 'dock+=0.08')
                .to(dom.tray, { y: 0, scale: 1, duration: 0.44, ease: 'power3.inOut' }, 'dock+=0.08')
                .to(dom.mechButton, { y: 0, duration: 0.18, ease: 'back.out(2)' }, 'dock+=0.1')
                .to(dom.led, { opacity: 0.26, duration: 0.1, repeat: 5, yoyo: true, ease: 'steps(1)' }, 'dock');

            intentPromise.then(function (intent) {
                if (requestId === state.playRequest && state.playSelectionId === selection.id && dom.loadState) {
                    dom.loadState.textContent = intent.transition ? 'SYNC' : 'OPEN';
                }
                return intent;
            });
            Promise.all([animationPromise, intentPromise]).then(function (values) {
                if (requestId !== state.playRequest || state.playSelectionId !== selection.id ||
                    !selectionIsCurrent(selection, false)) return;
                var intent = values[1];
                if (!intent.transition) {
                    resetDevice(false, true);
                    commitPlayIntent(intent, requestId);
                    return;
                }
                runPlaybackExit(intent, selection.item, requestId);
            });
        });
    }

    function initDevice() {
        if (!dom.action) return;
        listen(dom.action, 'pointerenter', function (event) {
            if (event.pointerType !== 'touch') startDeviceHover(false);
        }, { passive: true });
        listen(dom.action, 'focus', function () { startDeviceHover(false); });
        listen(dom.action, 'pointerleave', function () {
            if (!state.devicePreparing && !state.devicePlaying && !state.casePinnedOpen) resetDevice(false, false);
        }, { passive: true });
        listen(dom.action, 'blur', function () {
            if (!state.devicePreparing && !state.devicePlaying && !state.casePinnedOpen) resetDevice(false, false);
        });
        listen(dom.action, 'click', function (event) {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            executePlay();
        });
        listen(document, 'pointerdown', function (event) {
            if (!state.casePinnedOpen || state.devicePreparing || state.devicePlaying) return;
            var parts = activeCardParts();
            if ((parts.card && parts.card.contains(event.target)) || (dom.action && dom.action.contains(event.target))) return;
            resetDevice(false, true);
        }, true);
        resetDevice(true, true);
    }

    function initRackInput() {
        function step(direction) {
            if (!state.items.length || state.devicePreparing || state.devicePlaying) return;
            selectIndex(wrapIndex(Math.round(state.sliderTarget) + direction, state.items.length), direction, false, true);
        }

        listen(dom.rackPrev, 'click', function () { step(-1); });
        listen(dom.rackNext, 'click', function () { step(1); });

        listen(dom.shell || dom.hero, 'wheel', function (event) {
            if (!event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || state.devicePreparing || state.devicePlaying) return;
            var packet = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
            if (Math.abs(packet) < 1) return;
            event.preventDefault();
            finishEntryForInput();
            var now = performance.now();
            if (now - state.wheelLastPacket > 180) state.wheelAccumulator = 0;
            state.wheelLastPacket = now;
            state.wheelAccumulator += packet;
            if (Math.abs(state.wheelAccumulator) < 42 || now - state.wheelLastStep < 110) return;
            var direction = state.wheelAccumulator > 0 ? 1 : -1;
            state.wheelAccumulator = 0;
            state.wheelLastStep = now;
            step(direction);
        }, { passive: false });

    }

    function heroIsActive() {
        if (!dom.hero) return false;
        var rect = dom.hero.getBoundingClientRect();
        return rect.bottom > window.innerHeight * 0.28 && rect.top < window.innerHeight * 0.72;
    }

    function initKeys() {
        // Capture at window level so the rack keeps its keyboard contract even
        // when page-level navigation or third-party controls consume bubbling
        // key events later in the chain.
        listen(window, 'keydown', function (event) {
            var target = event.target;
            var tag = target && target.tagName ? target.tagName.toLowerCase() : '';
            var typing = tag === 'input' || tag === 'textarea' || tag === 'select' || (target && target.isContentEditable);
            var focusInHero = target === document.body || target === document.documentElement || (dom.hero && dom.hero.contains(target));
            var interactive = target && target.closest
                ? target.closest('a, button, summary, [role="button"], [role="link"]')
                : null;
            var isCarouselCard = interactive && interactive.classList.contains('hero3__card');
            var isRackControl = interactive && interactive.closest && interactive.closest('.hero3__rack-controls');
            var isPlayAction = interactive === dom.action;
            if (typing || !focusInHero || (interactive && !isCarouselCard && !isRackControl && !isPlayAction) || event.metaKey || event.ctrlKey || event.altKey || !heroIsActive() || !state.items.length) return;
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                var direction = event.key === 'ArrowRight' ? 1 : -1;
                selectIndex(wrapIndex(Math.round(state.sliderTarget) + direction, state.items.length), direction, false, true);
            } else if (event.key === 'Enter' && !isRackControl) {
                event.preventDefault();
                executePlay();
            }
        }, true);
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
                item.backdropRank = Math.max(Number(item.backdropRank || 0), 100);
                item.backdropKind = 'wide';
            } else if (kind === 'poster-backdrop') {
                item.backdrop = url;
                item.backdropRank = Math.max(Number(item.backdropRank || 0), 100);
                item.backdropKind = 'poster';
            } else {
                item.poster = url;
                item.posterRank = Math.max(Number(item.posterRank || 0), 100);
                posterChanged = true;
                if (!item.backdrop || item.backdropKind === 'poster') item.backdrop = url;
            }
            if (posterChanged) updateCardArtwork(item);
            if (state.items[state.activeIndex] && state.items[state.activeIndex].id === id) {
                updateBackdrop(item, false, false);
            } else if (state.backdropIntentId === id) {
                updateBackdrop(item, false, true);
            }
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
        if (selectedPoolIndex < 0) selectedPoolIndex = 0;
        var itemCount = Math.min(RACK_TUNING.itemCount, pool.length);
        var selectedIndex = -1;
        var heroItems = [];
        var canReuseRack = state.items.length === itemCount && state.items.every(function (previous) {
            return pool.some(function (item) { return item.id === previous.id; });
        });
        if (canReuseRack) {
            heroItems = state.items.map(function (previous) {
                return pool.find(function (item) { return item.id === previous.id; }) || previous;
            });
            selectedIndex = heroItems.findIndex(function (item) { return item.id === desiredId; });
        }
        if (selectedIndex < 0) {
            selectedIndex = Math.floor(itemCount / 2);
            var startIndex = selectedPoolIndex - selectedIndex;
            heroItems = [];
            for (var itemOffset = 0; itemOffset < itemCount; itemOffset += 1) {
                heroItems.push(pool[(startIndex + itemOffset + pool.length) % pool.length]);
            }
        }
        var hydrateRequest = ++state.hydrateRequest;
        cancelDeferredArtworkHydration();
        if (state.entryHydrationTimer) {
            window.clearTimeout(state.entryHydrationTimer);
            state.entryHydrationTimer = 0;
        }
        var previousItems = state.items.slice();
        var nextSignature = heroItems.map(function (item) { return item.id; }).join('|');
        var structureChanged = nextSignature !== state.signature;
        if (!structureChanged && previousItems.length) {
            var previousById = {};
            previousItems.forEach(function (item) { previousById[item.id] = item; });
            heroItems.forEach(function (item) {
                var previous = previousById[item.id];
                if (!previous) return;
                if (previous.poster && Number(previous.posterRank || 0) > Number(item.posterRank || 0)) {
                    item.poster = previous.poster;
                    item.posterRank = previous.posterRank;
                }
                if (previous.backdrop && Number(previous.backdropRank || 0) > Number(item.backdropRank || 0)) {
                    item.backdrop = previous.backdrop;
                    item.backdropRank = previous.backdropRank;
                    item.backdropKind = previous.backdropKind;
                }
            });
        }
        state.options = options;
        state.pool = pool;
        state.items = heroItems;
        state.signature = nextSignature;
        state.backdropIntentId = '';
        state.backdropIntentIndex = -1;

        var preloadGate = preloadItems(heroItems, selectedIndex, hydrateRequest);

        if (structureChanged) {
            state.rackArtworkReady = false;
            state.entryRailArtworkReady = false;
            state.entryRailArtworkSignature = '';
            if (dom.entryRail) dom.entryRail.removeAttribute('data-entry-art');
            state.activeIndex = selectedIndex;
            state.sliderPosition = selectedIndex;
            state.sliderTarget = selectedIndex;
            state.rackDockWorld = null;
            state.rackDockCommitIndex = -1;
            state.rackDockNotify = false;
            state.carouselPosition = selectedIndex;
            state.introOpacity = 1;
            state.introMaterialize = 1;
            state.introRevealStrength = 0;
            state.introCenterLift = 0;
            setIntroOwnership(0);
            state.introArrivalProgress = 1;
            // Keep the canonical 3D rack parked in its final closed geometry.
            // The shallow rail owns every travelling frame and is already in
            // motion before artwork/data hydrate, so hydration never changes
            // the physical size or depth of a case.
            state.introRackOffsetX = 0;
            state.introRackOffsetY = 0;
            state.introRackVelocity = 0;
            state.introFlow = 0;
            renderCards();
            startEntryRailCruise(false);
            updateInfo(state.items[state.activeIndex]);
            // Bind the first backdrop immediately to the same committed item.
            // Poster decoding may finish later, but an old owner's artwork is
            // hidden now rather than remaining visible through the intro gate.
            updateBackdrop(state.items[state.activeIndex], true);
            preloadGate.then(function () {
                if (hydrateRequest !== state.hydrateRequest) return;
                return promoteRackArtwork(hydrateRequest);
            }).then(function (promoted) {
                if (!promoted || hydrateRequest !== state.hydrateRequest) return;
                prepareEntryFrames(hydrateRequest);
            });
        } else {
            if (!options.preservePosition) {
                state.sliderPosition = selectedIndex;
                state.sliderTarget = selectedIndex;
                state.carouselPosition = selectedIndex;
                state.sliderVelocity = 0;
                commitRackSelection(selectedIndex, false, false);
            }
            state.items.forEach(function (item) {
                updateCardArtwork(item);
                updateCardMetadata(item);
            });
            updateInfo(state.items[state.activeIndex]);
            updateBackdrop(state.items[state.activeIndex], false);
            syncDiscOrigin();
            syncPlayerCarriage(false);
            if (!state.entryPlayed && !state.entryRunning) {
                preloadGate.then(function () {
                    if (hydrateRequest !== state.hydrateRequest || state.entryPlayed) return;
                    return promoteRackArtwork(hydrateRequest);
                }).then(function (promoted) {
                    if (!promoted || hydrateRequest !== state.hydrateRequest || state.entryPlayed) return;
                    prepareEntryFrames(hydrateRequest);
                });
            } else if (state.entryPlayed) {
                preloadGate.then(function () {
                    if (hydrateRequest !== state.hydrateRequest) return;
                    state.criticalArtworkIndexes.forEach(function (index) {
                        promoteArtworkIndex(index, true);
                    });
                    prioritizeDeferredArtwork(state.activeIndex);
                    scheduleDeferredArtworkHydration(hydrateRequest);
                });
            }
        }
    }

    function init() {
        if (state.ready) return;
        cacheDom();
        if (!dom.hero || !dom.shell || !dom.orbit) return;
        state.ready = true;
        dom.hero.setAttribute('data-hero-layout', 'rack');
        dom.hero.setAttribute('data-hero-slider', 'ring');
        dom.hero.setAttribute('data-hero-intro', 'preparing');
        if (dom.backdrop) dom.backdrop.style.opacity = '0';
        refreshMetrics();
        // Treat the very first visual frame. The rail begins moving with
        // lightweight placeholder spines before the media APIs resolve, then
        // swaps cached artwork into the same reserved slots without relayout.
        startEntryRailCruise(false);
        initRackInput();
        initKeys();
        initDevice();
        startRackTicker();
        listen(window, 'resize', function () {
            if (state.resizeFrame) return;
            state.resizeFrame = window.requestAnimationFrame(function () {
                state.resizeFrame = 0;
                refreshMetrics();
                if (state.entryRunning) finishEntryForInput();
                else if (!state.entryPlayed && state.entryRailActive) startEntryRailCruise(true);
                state.rackNeedsRender = true;
                renderRack();
                syncPlayerCarriage(true);
                resetDevice(true, true);
            });
        }, { passive: true });
        listen(window, 'blur', function () { resetDevice(true, true); });
        listen(document, 'visibilitychange', function () {
            if (document.hidden) resetDevice(true, true);
        });
        listen(window, 'pageshow', function () {
            startRackTicker();
            if (!state.entryPlayed) startEntryRailCruise(true);
            state.rackNeedsRender = true;
            resetDevice(true, true);
        });
        listen(window, 'pagehide', function () {
            stopRackTicker();
            stopEntryRail(true);
            cancelDeferredArtworkHydration();
            cancelRackMoveDelay();
            if (state.entryHydrationTimer) {
                window.clearTimeout(state.entryHydrationTimer);
                state.entryHydrationTimer = 0;
            }
            if (state.sliderSettleTimer) {
                window.clearTimeout(state.sliderSettleTimer);
                state.sliderSettleTimer = 0;
            }
            if (state.nearbyBackdropTimer) {
                window.clearTimeout(state.nearbyBackdropTimer);
                state.nearbyBackdropTimer = 0;
            }
            if (state.entryTimeline) {
                state.entryTimeline.kill();
                state.entryTimeline = null;
            }
            state.entryRunning = false;
            state.introOpacity = 1;
            state.introMaterialize = 1;
            state.introRevealStrength = 1;
            state.introCenterLift = 1;
            setIntroOwnership(1);
            state.introArrivalProgress = 1;
            state.introRackOffsetX = 0;
            state.introRackOffsetY = 0;
            state.introFlow = 0;
            state.rackDockWorld = null;
            state.rackDockCommitIndex = -1;
            state.rackDockNotify = false;
            if (dom.hero) dom.hero.setAttribute('data-hero-intro', 'ready');
            if (state.backdropTimeline) state.backdropTimeline.kill();
            if (state.deviceTimeline) state.deviceTimeline.kill();
            if (state.deviceSpin) state.deviceSpin.kill();
            killCaseTimelines();
            endCaseInspection();
        });

    }

    function destroy() {
        clearCardBindings();
        state.listeners.splice(0).forEach(function (dispose) {
            try { dispose(); } catch (error) {}
        });
        state.rackDockWorld = null;
        state.rackDockCommitIndex = -1;
        state.rackDockNotify = false;
        state.backdropIntentId = '';
        state.backdropIntentIndex = -1;
        state.rackMovingVisual = false;
        state.introRackOffsetX = 0;
        state.introRackOffsetY = 0;
        state.introFlow = 0;
        state.introCenterLift = 1;
        state.introMaterialize = 1;
        setIntroOwnership(1);
        stopEntryRail(true);
        stopRackTicker();
        cancelDeferredArtworkHydration();
        cancelRackMoveDelay();
        if (state.entryHydrationTimer) {
            window.clearTimeout(state.entryHydrationTimer);
            state.entryHydrationTimer = 0;
        }
        if (state.nearbyBackdropTimer) {
            window.clearTimeout(state.nearbyBackdropTimer);
            state.nearbyBackdropTimer = 0;
        }
        if (state.sliderSettleTimer) {
            window.clearTimeout(state.sliderSettleTimer);
            state.sliderSettleTimer = 0;
        }
        if (state.entryTimeline) state.entryTimeline.kill();
        if (state.backdropTimeline) state.backdropTimeline.kill();
        if (state.deviceTimeline) state.deviceTimeline.kill();
        if (state.deviceSpin) state.deviceSpin.kill();
        killCaseTimelines();
        endCaseInspection();
        state.entryTimeline = null;
        state.entryRunning = false;
        state.imagePromises = {};
        state.imageLoadStatus = {};
        state.preloadedPosterImages = {};
        state.rackArtworkReady = false;
        state.entryRailArtworkReady = false;
        state.entryRailArtworkSignature = '';
        state.criticalArtworkIndexes = [];
        state.deferredArtworkQueue = [];
        state.deferredArtworkHydrated = 0;
        state.backdropPreloadUrls = {};
        state.preloadedBackdropImages = {};
        state.rackGeometry = [];
        state.rackCandidate = null;
        if (dom.orbit) dom.orbit.removeAttribute('data-rack-ready');
        if (dom.hero) {
            dom.hero.classList.remove('is-rack-moving');
            dom.hero.removeAttribute('data-hero-layout');
            dom.hero.removeAttribute('data-hero-intro');
            dom.hero.removeAttribute('data-hero-slider');
        }
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
                selectedIndex: state.activeIndex,
                activeId: state.items[state.activeIndex] ? state.items[state.activeIndex].id : null,
                sliderPosition: state.sliderPosition,
                sliderTarget: state.sliderTarget,
                sliderVelocity: state.sliderVelocity,
                rackDockWorld: state.rackDockWorld,
                rackDockCommitIndex: state.rackDockCommitIndex,
                playerX: state.playerX,
                interactionMode: 'cyclic-rack-controls',
                pendingIndex: state.pendingSelection,
                introRunning: state.entryRunning,
                entryRailActive: state.entryRailActive,
                entryRailSpineCount: dom.entryRailTrack ? qsa('.hero3__entry-spine', dom.entryRailTrack).length : 0,
                entryRailFinalX: state.entryRailFinalX,
                entryRailAlignedSlot: state.entryRailAlignedSlot,
                entryRailArtworkReady: state.entryRailArtworkReady,
                entryRailCycleWidth: state.entryRailCycleWidth,
                introOwnershipProgress: state.introOwnershipProgress,
                backdropIntentId: state.backdropIntentId,
                backdropIntentIndex: state.backdropIntentIndex,
                rackArtworkReady: state.rackArtworkReady,
                criticalArtworkIndexes: state.criticalArtworkIndexes.slice(),
                deferredArtworkQueue: state.deferredArtworkQueue.slice(),
                deferredArtworkHydrated: state.deferredArtworkHydrated,
                introRevealStrength: state.introRevealStrength,
                introCenterLift: state.introCenterLift,
                introArrivalProgress: state.introArrivalProgress,
                introRackOffsetX: state.introRackOffsetX,
                introRackOffsetY: state.introRackOffsetY,
                introRackVelocity: state.introRackVelocity,
                introFlow: state.introFlow,
                introOpacity: state.introOpacity,
                introMaterialize: state.introMaterialize,
                casePinnedOpen: state.casePinnedOpen,
                slotCount: state.cards.length,
                geometry: state.rackGeometry.map(function (entry) {
                    return {
                        index: entry.index,
                        x: entry.x,
                        y: entry.y,
                        z: entry.z,
                        angle: entry.angle,
                        scale: entry.scale,
                        opacity: entry.opacity,
                        readable: entry.readable,
                        delta: entry.delta
                    };
                }),
                preloadPlan: state.preloadPlan.slice(),
                preloadedBackdrops: Object.keys(state.preloadedBackdropImages),
                preloadStarts: state.preloadStarts.map(function (entry) {
                    return { index: entry.index, reason: entry.reason, priority: entry.priority, url: entry.url };
                }),
                entryPlayed: state.entryPlayed,
                entryRunning: state.entryRunning,
                devicePreparing: state.devicePreparing,
                devicePlaying: state.devicePlaying,
                playSelectionId: state.playSelectionId,
                heroOwnerId: dom.hero ? String(dom.hero.getAttribute('data-active-anime-id') || '') : '',
                backdropOwnerId: state.backdropOwnerId,
                backdropPendingOwnerId: state.backdropPendingOwnerId,
                backdropFrontOwnerId: (state.backdropFront === 'A' ? dom.backdropA : dom.backdropB)
                    ? String((state.backdropFront === 'A' ? dom.backdropA : dom.backdropB).getAttribute('data-anime-id') || '')
                    : '',
                discOwnerId: dom.disc ? String(dom.disc.getAttribute('data-anime-id') || '') : '',
                loadedDiscOwnerId: dom.loadedDisc ? String(dom.loadedDisc.getAttribute('data-anime-id') || '') : '',
                actionOwnerId: dom.action ? String(dom.action.getAttribute('data-anime-id') || '') : '',
                mediaDiameter: state.mediaDiameter,
                activeCaseDiscLayoutDiameter: (activeCardParts().caseDisc && activeCardParts().caseDisc.offsetWidth) || 0,
                flightDiscRenderedDiameter: renderedCircleDiameter(dom.disc),
                loadedDiscRenderedDiameter: renderedCircleDiameter(dom.loadedDisc)
            };
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
