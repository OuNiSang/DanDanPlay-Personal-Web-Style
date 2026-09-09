(function () {
    'use strict';

    function getActiveView() {
        var params = new URLSearchParams(window.location.search);
        var nav = String(params.get('nav') || '').toLowerCase();
        if (nav) return nav;

        var type = String(params.get('type') || '').toLowerCase();
        var name = String(params.get('name') || '');
        if (type === 'nav' && name === '最近收录') return 'recent-files';

        return '';
    }

    function initializeLibraryNavigation() {
        var activeView = getActiveView();
        document.body.classList.add('library-page');
        if (activeView) document.body.dataset.libraryView = activeView;

        var activeLink = document.querySelector('[data-library-nav="' + activeView + '"]');
        if (!activeLink) return;

        activeLink.classList.add('is-active');
        activeLink.setAttribute('aria-current', 'page');

        window.requestAnimationFrame(function () {
            activeLink.scrollIntoView({ block: 'nearest', inline: 'center' });
        });
    }

    function initializeLibrarySearch() {
        var search = document.querySelector('.app-nav__search');
        if (!search) return;

        var toggle = search.querySelector('.app-nav__search-toggle');
        var input = search.querySelector('input');
        if (!toggle || !input) return;

        function setSearchOpen(open, focusInput) {
            search.classList.toggle('is-open', open);
            toggle.setAttribute('aria-expanded', String(open));
            toggle.setAttribute('aria-label', open ? '收起搜索' : '打开搜索');

            if (focusInput) {
                window.requestAnimationFrame(function () {
                    input.focus({ preventScroll: true });
                    input.select();
                });
            }
        }

        toggle.addEventListener('click', function () {
            if (window.matchMedia('(max-width: 768px)').matches) {
                setSearchOpen(!search.classList.contains('is-open'), true);
                return;
            }

            input.focus({ preventScroll: true });
        });

        input.addEventListener('keydown', function (event) {
            if (event.key !== 'Escape') return;
            setSearchOpen(false, false);
            toggle.focus({ preventScroll: true });
        });

        if (new URLSearchParams(window.location.search).get('search') === '1') {
            setSearchOpen(true, true);
        }
    }

    function initializeLibraryPage() {
        initializeLibraryNavigation();
        initializeLibrarySearch();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeLibraryPage, { once: true });
    } else {
        initializeLibraryPage();
    }
})();

/* Desktop Web1 3.0 archive motion. No-op for filelist and stable mobile views. */
(function () {
    'use strict';

    var desktopQuery = window.matchMedia('(min-width: 769px)');
    var reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    var cleanupCurrent = null;
    var wasDesktop = desktopQuery.matches;
    var motionProperties = [
        '--lib-tilt-x', '--lib-tilt-y', '--lib-image-x', '--lib-image-y',
        '--lib-caption-x', '--lib-caption-y', '--lib-shadow-x', '--lib-shadow-y',
        '--lib-light-x', '--lib-light-y'
    ];

    function isV3Desktop() {
        if (!desktopQuery.matches) return false;
        return !window.Web1UiVersion ||
            typeof window.Web1UiVersion.isV3Desktop !== 'function' ||
            window.Web1UiVersion.isV3Desktop();
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function setup() {
        var root = document.body;
        var scroller = document.getElementById('posterGroups');
        var railNumber = document.getElementById('libraryRailNumber');
        var railTitle = document.getElementById('libraryRailTitle');
        var railMeta = document.getElementById('libraryRailMeta');

        if (!root || !root.classList.contains('library-page--v3') || !scroller) {
            return function () {};
        }

        var groups = [];
        var groupOffsets = [];
        var activeGroup = null;
        var activeCard = null;
        var pointerState = null;
        var pointerFrame = 0;
        var scrollFrame = 0;
        var refreshFrame = 0;
        var settleTimer = 0;
        var mutationObserver = null;
        var entryObserver = null;
        var railAnimation = null;
        var animatedGroups = new WeakSet();
        var stats = {
            refreshes: 0,
            groupReveals: 0,
            pointerFrames: 0,
            scrollFrames: 0
        };

        root.dataset.libraryMotion = reducedMotionQuery.matches ? 'reduced' : 'ready';

        function setRail(group) {
            if (!group || group === activeGroup) return;
            activeGroup = group;
            if (railNumber) railNumber.textContent = group.dataset.focusNumber || '01';
            if (railTitle) railTitle.textContent = group.dataset.focusTitle || '媒体库';
            if (railMeta) railMeta.textContent = group.dataset.focusMeta || 'LOCAL MEDIA INDEX';

            var rail = railNumber && railNumber.closest('.library-archive-rail');
            if (rail && !reducedMotionQuery.matches && typeof rail.animate === 'function') {
                if (railAnimation) railAnimation.cancel();
                railAnimation = rail.animate([
                    { opacity: 0.72, transform: 'translate3d(-14px, 0, 0)' },
                    { opacity: 1, transform: 'translate3d(0, 0, 0)' }
                ], {
                    duration: 300,
                    easing: 'cubic-bezier(.22,1,.36,1)'
                });
            }
        }

        function updateRailFromScroll() {
            scrollFrame = 0;
            stats.scrollFrames += 1;
            if (!groups.length) return;

            var target = scroller.scrollTop + Math.min(96, scroller.clientHeight * 0.18);
            var nearestIndex = 0;
            var nearestDistance = Infinity;

            groupOffsets.forEach(function (offset, index) {
                var distance = Math.abs(offset - target);
                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestIndex = index;
                }
            });

            setRail(groups[nearestIndex]);
        }

        function animateGroup(group) {
            if (reducedMotionQuery.matches || animatedGroups.has(group)) return;
            animatedGroups.add(group);
            stats.groupReveals += 1;

            var revealTargets = [
                group.querySelector('.poster-group__header'),
                group.querySelector('.poster-group__grid')
            ].filter(Boolean);
            revealTargets.forEach(function (target, index) {
                if (typeof target.animate !== 'function') return;
                target.animate([
                    {
                        opacity: 0,
                        transform: 'translate3d(0, 24px, 0)'
                    },
                    {
                        opacity: 1,
                        transform: 'translate3d(0, 0, 0)'
                    }
                ], {
                    duration: 440,
                    delay: index * 55,
                    easing: 'cubic-bezier(.16,1,.3,1)',
                    fill: 'backwards'
                });
            });
        }

        function normalizeCardActivation() {
            if (!window.jQuery || typeof window.showModal !== 'function') return;

            Array.prototype.forEach.call(scroller.querySelectorAll('.poster-item'), function (card) {
                // Identity is authored by createPosterItem(). Reconstructing it from the
                // current DOM index breaks as soon as search/filtering changes the list.
                if (!card.dataset.animeId) return;
                if (card.dataset.libraryDelegated === 'true') return;
                window.jQuery(card).off('click keydown');
                card.dataset.libraryDelegated = 'true';
            });
        }

        function refreshGroups() {
            refreshFrame = 0;
            stats.refreshes += 1;
            normalizeCardActivation();
            groups = Array.prototype.slice.call(scroller.querySelectorAll('.poster-group'));
            groupOffsets = groups.map(function (group) { return group.offsetTop; });

            if (entryObserver) entryObserver.disconnect();
            entryObserver = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    if (entry.isIntersecting) animateGroup(entry.target);
                });
            }, {
                root: scroller,
                rootMargin: '12% 0px 12% 0px',
                threshold: 0.08
            });
            groups.forEach(function (group) { entryObserver.observe(group); });

            activeGroup = null;
            updateRailFromScroll();
        }

        function scheduleRefresh() {
            if (!refreshFrame) refreshFrame = window.requestAnimationFrame(refreshGroups);
        }

        function resetCard(card, immediate) {
            if (!card) return;
            window.clearTimeout(card._libraryMotionResetTimer);
            card.style.setProperty('--lib-tilt-x', '0deg');
            card.style.setProperty('--lib-tilt-y', '0deg');
            card.style.setProperty('--lib-image-x', '0px');
            card.style.setProperty('--lib-image-y', '0px');
            card.style.setProperty('--lib-caption-x', '0px');
            card.style.setProperty('--lib-caption-y', '0px');
            card.style.setProperty('--lib-shadow-x', '7px');
            card.style.setProperty('--lib-shadow-y', '9px');
            card.style.setProperty('--lib-light-x', '50%');
            card.style.setProperty('--lib-light-y', '42%');

            card._libraryMotionResetTimer = window.setTimeout(function () {
                card.classList.remove('is-pointer-active');
                if (immediate) {
                    motionProperties.forEach(function (property) {
                        card.style.removeProperty(property);
                    });
                }
            }, immediate ? 0 : 360);
        }

        function renderPointer() {
            pointerFrame = 0;
            if (!pointerState || !activeCard || reducedMotionQuery.matches) return;
            stats.pointerFrames += 1;

            var rect = activeCard.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            var normalizedX = clamp((pointerState.clientX - rect.left) / rect.width * 2 - 1, -1, 1);
            var normalizedY = clamp((pointerState.clientY - rect.top) / rect.height * 2 - 1, -1, 1);

            activeCard.classList.add('is-pointer-active');
            activeCard.style.setProperty('--lib-tilt-x', (-normalizedY * 7).toFixed(2) + 'deg');
            activeCard.style.setProperty('--lib-tilt-y', (normalizedX * 8).toFixed(2) + 'deg');
            activeCard.style.setProperty('--lib-image-x', (-normalizedX * 4).toFixed(2) + 'px');
            activeCard.style.setProperty('--lib-image-y', (-normalizedY * 4).toFixed(2) + 'px');
            activeCard.style.setProperty('--lib-caption-x', (normalizedX * 3).toFixed(2) + 'px');
            activeCard.style.setProperty('--lib-caption-y', (normalizedY * 2).toFixed(2) + 'px');
            activeCard.style.setProperty('--lib-shadow-x', (7 - normalizedX * 3).toFixed(2) + 'px');
            activeCard.style.setProperty('--lib-shadow-y', (9 + normalizedY * 3).toFixed(2) + 'px');
            activeCard.style.setProperty('--lib-light-x', ((normalizedX + 1) * 50).toFixed(1) + '%');
            activeCard.style.setProperty('--lib-light-y', ((normalizedY + 1) * 50).toFixed(1) + '%');
        }

        function onPointerMove(event) {
            if (reducedMotionQuery.matches || event.pointerType === 'touch') return;
            var card = event.target.closest('.poster-item');
            if (!card || !scroller.contains(card)) return;

            if (activeCard && activeCard !== card) resetCard(activeCard, false);
            activeCard = card;
            pointerState = { clientX: event.clientX, clientY: event.clientY };
            if (!pointerFrame) pointerFrame = window.requestAnimationFrame(renderPointer);
        }

        function onPointerOut(event) {
            var card = event.target.closest('.poster-item');
            if (!card || card.contains(event.relatedTarget)) return;
            pointerState = null;
            if (pointerFrame) window.cancelAnimationFrame(pointerFrame);
            pointerFrame = 0;
            resetCard(card, false);
            if (activeCard === card) activeCard = null;
        }

        function onFocusIn(event) {
            var card = event.target.closest('.poster-item');
            if (!card) return;
            setRail(card.closest('.poster-group'));
        }

        function onActivate(event) {
            var card = event.target.closest('.poster-item[data-library-delegated="true"]');
            if (!card || !scroller.contains(card)) return;
            if (event.type === 'keydown') {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
            }
            window.showModal(card.dataset.animeId, card.dataset.animeTitle || '');
        }

        function onScroll() {
            if (!scroller.classList.contains('is-scrolling')) {
                scroller.classList.add('is-scrolling');
                root.dataset.libraryScroll = 'active';
                if (activeCard) resetCard(activeCard, true);
                activeCard = null;
                pointerState = null;
            }

            window.clearTimeout(settleTimer);
            settleTimer = window.setTimeout(function () {
                scroller.classList.remove('is-scrolling');
                root.removeAttribute('data-library-scroll');
            }, 120);

            if (!scrollFrame) scrollFrame = window.requestAnimationFrame(updateRailFromScroll);
        }

        function onResize() {
            scheduleRefresh();
        }

        scroller.addEventListener('pointermove', onPointerMove, { passive: true });
        scroller.addEventListener('pointerout', onPointerOut, { passive: true });
        scroller.addEventListener('focusin', onFocusIn);
        scroller.addEventListener('click', onActivate);
        scroller.addEventListener('keydown', onActivate);
        scroller.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onResize, { passive: true });

        mutationObserver = new MutationObserver(function () {
            scheduleRefresh();
        });
        mutationObserver.observe(scroller, { childList: true });
        refreshGroups();

        window.Web1V3LibraryMotion = {
            refresh: scheduleRefresh,
            stats: function () {
                return {
                    refreshes: stats.refreshes,
                    groupReveals: stats.groupReveals,
                    pointerFrames: stats.pointerFrames,
                    scrollFrames: stats.scrollFrames,
                    groups: groups.length,
                    activeAnimations: document.getAnimations().filter(function (animation) {
                        return animation.playState === 'running';
                    }).length
                };
            }
        };

        return function () {
            scroller.removeEventListener('pointermove', onPointerMove);
            scroller.removeEventListener('pointerout', onPointerOut);
            scroller.removeEventListener('focusin', onFocusIn);
            scroller.removeEventListener('click', onActivate);
            scroller.removeEventListener('keydown', onActivate);
            scroller.removeEventListener('scroll', onScroll);
            window.removeEventListener('resize', onResize);
            if (mutationObserver) mutationObserver.disconnect();
            if (entryObserver) entryObserver.disconnect();
            if (pointerFrame) window.cancelAnimationFrame(pointerFrame);
            if (scrollFrame) window.cancelAnimationFrame(scrollFrame);
            if (refreshFrame) window.cancelAnimationFrame(refreshFrame);
            window.clearTimeout(settleTimer);
            if (railAnimation) railAnimation.cancel();
            if (activeCard) resetCard(activeCard, true);
            scroller.classList.remove('is-scrolling');
            root.removeAttribute('data-library-motion');
            root.removeAttribute('data-library-scroll');
            if (window.Web1V3LibraryMotion && window.Web1V3LibraryMotion.refresh === scheduleRefresh) {
                delete window.Web1V3LibraryMotion;
            }
        };
    }

    function arm() {
        if (cleanupCurrent) cleanupCurrent();
        if (desktopQuery.matches !== wasDesktop && window.jQuery && Array.isArray(window.bangumiList)) {
            wasDesktop = desktopQuery.matches;
            window.renderBangumiList(window.bangumiList);
            window.renderQuickNav(window.bangumiList);
        }
        cleanupCurrent = isV3Desktop() ? setup() : null;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', arm, { once: true });
    } else {
        arm();
    }

    desktopQuery.addEventListener('change', arm);
    reducedMotionQuery.addEventListener('change', arm);
    window.addEventListener('web1-ui-version-change', arm);
    window.addEventListener('pageshow', function (event) {
        if (event.persisted) arm();
    });
})();
