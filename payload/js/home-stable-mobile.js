(function (window, document) {
    'use strict';

    if (!window.matchMedia || !window.MutationObserver) return;

    var mobileQuery = window.matchMedia('(max-width: 768px)');
    var stableRoot = null;
    var sourceObserver = null;
    var rootObserver = null;
    var syncFrame = 0;
    var active = false;
    var controlDisposers = [];
    var attributeSnapshots = [];

    function shouldUseStableView() {
        if (mobileQuery.matches) return true;
        return Boolean(window.Web1UiVersion && !window.Web1UiVersion.isV3Desktop());
    }

    function byId(id) {
        return document.getElementById(id);
    }

    function findMobile(id, fallbackSelector) {
        if (!stableRoot) return null;
        return byId(id) || (fallbackSelector ? stableRoot.querySelector(fallbackSelector) : null);
    }

    function setText(target, value) {
        if (!target) return;
        value = String(value == null ? '' : value);
        if (target.textContent !== value) target.textContent = value;
    }

    function copyChildren(source, target) {
        if (!source || !target || source.innerHTML === target.innerHTML) return;
        while (target.firstChild) target.removeChild(target.firstChild);
        Array.prototype.forEach.call(source.childNodes, function (node) {
            target.appendChild(node.cloneNode(true));
        });
    }

    function copyAttribute(source, target, name) {
        if (!source || !target) return;
        var value = source.getAttribute(name);
        if (value == null) target.removeAttribute(name);
        else target.setAttribute(name, value);
    }

    function mirrorBackground() {
        var source = byId('heroBg');
        var target = findMobile('heroMobileBg', '.idx-hero__bg');
        if (!source || !target) return;
        var backgroundImage = source.style.backgroundImage;
        if (!backgroundImage && window.getComputedStyle) {
            backgroundImage = window.getComputedStyle(source).backgroundImage;
        }
        if (target.style.backgroundImage !== backgroundImage) {
            target.style.backgroundImage = backgroundImage || '';
        }
    }

    function mirrorCover() {
        var source = byId('heroCover');
        var target = findMobile('heroMobileCover', '.idx-hero__cover');
        if (!source || !target) return;

        var sourceImage = source.querySelector('img');
        var targetImage = target.querySelector('img');
        if (!sourceImage) {
            if (targetImage) {
                targetImage.hidden = true;
                targetImage.removeAttribute('src');
                targetImage.removeAttribute('srcset');
            }
            return;
        }

        if (!targetImage) {
            targetImage = document.createElement('img');
            target.appendChild(targetImage);
        }

        var sourceUrl = sourceImage.getAttribute('src') || sourceImage.currentSrc || '';
        if (sourceUrl && targetImage.getAttribute('src') !== sourceUrl) {
            targetImage.setAttribute('src', sourceUrl);
        }
        ['srcset', 'sizes'].forEach(function (name) {
            copyAttribute(sourceImage, targetImage, name);
        });
        targetImage.alt = sourceImage.alt || (byId('heroTitle') ? byId('heroTitle').textContent : '');
        targetImage.decoding = 'async';
        targetImage.loading = 'eager';
        targetImage.hidden = false;
    }

    function mirrorCopy() {
        var sourceTitle = byId('heroTitle');
        var sourceBadge = byId('heroBadge');
        var sourceBadgeText = byId('heroBadgeText');
        var sourceMeta = byId('heroMeta');
        var sourceDescription = byId('heroDescription');

        var targetTitle = findMobile('heroMobileTitle', '.idx-hero__title');
        var targetBadge = findMobile('heroMobileBadge', '.idx-hero__badge');
        var targetBadgeText = findMobile('heroMobileBadgeText', '.idx-hero__badge span');
        var targetMeta = findMobile('heroMobileMeta', '.idx-hero__meta');
        var targetDescription = findMobile('heroMobileDescription', '.idx-hero__description');
        var targetContent = stableRoot ? stableRoot.querySelector('.idx-hero__content') : null;

        setText(targetTitle, sourceTitle ? sourceTitle.textContent : '');
        setText(targetBadgeText, sourceBadgeText ? sourceBadgeText.textContent : '');
        copyChildren(sourceMeta, targetMeta);
        setText(targetDescription, sourceDescription ? sourceDescription.textContent : '');

        var badgePopulated = Boolean(
            sourceBadgeText &&
            sourceBadgeText.textContent.trim() &&
            sourceBadge &&
            !sourceBadge.hidden &&
            sourceBadge.style.display !== 'none'
        );
        if (targetBadge) {
            targetBadge.hidden = !badgePopulated;
            targetBadge.classList.toggle('is-populated', badgePopulated);
        }

        var hasDescription = Boolean(
            sourceDescription &&
            !sourceDescription.hidden &&
            sourceDescription.textContent.trim()
        );
        if (targetDescription) targetDescription.hidden = !hasDescription;
        if (targetContent) targetContent.classList.toggle('has-description', hasDescription);
    }

    function sourceUnavailable(source) {
        return !source ||
            Boolean(source.disabled) ||
            source.getAttribute('aria-disabled') === 'true' ||
            source.getAttribute('aria-busy') === 'true';
    }

    function mirrorControlState(source, target, classNames) {
        if (!target) return;
        var unavailable = sourceUnavailable(source);
        if ('disabled' in target) target.disabled = unavailable;
        target.setAttribute('aria-disabled', unavailable ? 'true' : 'false');

        if (source) {
            copyAttribute(source, target, 'title');
            copyAttribute(source, target, 'aria-label');
            copyAttribute(source, target, 'aria-busy');
        } else {
            target.removeAttribute('aria-busy');
        }

        (classNames || []).forEach(function (name) {
            target.classList.toggle(name, Boolean(source && source.classList.contains(name)));
        });
    }

    function mirrorControls() {
        var sourcePlay = byId('heroPlayBtn');
        var targetPlay = findMobile('heroMobilePlayBtn', '.btn-hero-play');
        var sourceMode = byId('heroModeToggle');
        var targetMode = findMobile('heroMobileModeToggle', '.btn-hero-mode');

        setText(findMobile('heroMobileModeText', '.btn-hero-mode span'), byId('heroModeText') ? byId('heroModeText').textContent : '当前图片');
        setText(findMobile('heroMobileArtSource', '.btn-hero-mode small'), byId('heroArtSource') ? byId('heroArtSource').textContent : '本地');

        mirrorControlState(sourcePlay, targetPlay, ['is-armed', 'is-loading', 'is-playing']);
        mirrorControlState(sourceMode, targetMode, ['is-switching']);
    }

    function syncNow() {
        syncFrame = 0;
        if (!active || !shouldUseStableView() || !stableRoot || !stableRoot.isConnected) return;
        mirrorBackground();
        mirrorCover();
        mirrorCopy();
        mirrorControls();
        stableRoot.classList.add('is-synced');
    }

    function scheduleSync() {
        if (!active || syncFrame) return;
        syncFrame = window.requestAnimationFrame(syncNow);
    }

    function observeSources() {
        sourceObserver = new MutationObserver(scheduleSync);
        var seen = [];
        [
            'heroBg', 'heroCover', 'heroTitle', 'heroBadge', 'heroBadgeText',
            'heroMeta', 'heroDescription', 'heroPlayBtn', 'heroModeToggle',
            'heroModeText', 'heroArtSource'
        ].forEach(function (id) {
            var node = byId(id);
            if (!node || seen.indexOf(node) !== -1) return;
            seen.push(node);
            sourceObserver.observe(node, {
                attributes: true,
                childList: true,
                characterData: true,
                subtree: true,
                attributeFilter: [
                    'style', 'class', 'hidden', 'src', 'srcset', 'sizes', 'alt',
                    'disabled', 'aria-disabled', 'aria-busy', 'aria-label', 'title'
                ]
            });
        });
    }

    function forwardClick(sourceId, event) {
        event.preventDefault();
        var source = byId(sourceId);
        if (sourceUnavailable(source)) return;
        source.click();
        scheduleSync();
    }

    function bindControls() {
        var targetMode = findMobile('heroMobileModeToggle', '.btn-hero-mode');

        if (targetMode) {
            var modeHandler = function (event) { forwardClick('heroModeToggle', event); };
            targetMode.addEventListener('click', modeHandler);
            controlDisposers.push(function () { targetMode.removeEventListener('click', modeHandler); });
        }
    }

    function snapshotAttribute(node, name) {
        if (!node) return;
        attributeSnapshots.push({
            node: node,
            name: name,
            present: node.hasAttribute(name),
            value: node.getAttribute(name)
        });
    }

    function restoreAttributes() {
        attributeSnapshots.splice(0).forEach(function (snapshot) {
            if (!snapshot.node || !snapshot.node.isConnected) return;
            if (snapshot.present) snapshot.node.setAttribute(snapshot.name, snapshot.value);
            else snapshot.node.removeAttribute(snapshot.name);
        });
    }

    function activate() {
        if (active || !shouldUseStableView()) return;
        stableRoot = document.querySelector('.hero-stable-mobile');
        if (!stableRoot) {
            if (!rootObserver && document.documentElement) {
                rootObserver = new MutationObserver(function () {
                    if (!document.querySelector('.hero-stable-mobile')) return;
                    rootObserver.disconnect();
                    rootObserver = null;
                    activate();
                });
                rootObserver.observe(document.documentElement, { childList: true, subtree: true });
            }
            return;
        }

        if (rootObserver) {
            rootObserver.disconnect();
            rootObserver = null;
        }

        active = true;
        if (window.DandanHero3 && typeof window.DandanHero3.reset === 'function') {
            window.DandanHero3.reset(true);
        }
        if (window.DdpRouteMorph && typeof window.DdpRouteMorph.cancel === 'function') {
            window.DdpRouteMorph.cancel('stable-view');
        }
        stableRoot.hidden = false;
        stableRoot.setAttribute('aria-hidden', 'false');

        var desktopStage = document.querySelector('#heroBanner .hero3__stage');
        var heroBanner = byId('heroBanner');
        var mobileTitle = findMobile('heroMobileTitle', '.idx-hero__title');
        snapshotAttribute(desktopStage, 'aria-hidden');
        snapshotAttribute(heroBanner, 'aria-labelledby');
        if (desktopStage) desktopStage.setAttribute('aria-hidden', 'true');
        if (heroBanner && mobileTitle && mobileTitle.id) {
            heroBanner.setAttribute('aria-labelledby', mobileTitle.id);
        }

        bindControls();
        observeSources();
        syncNow();
    }

    function deactivate() {
        if (rootObserver) {
            rootObserver.disconnect();
            rootObserver = null;
        }
        if (!active) {
            /* The stylesheet may itself be conditionally loaded. Hide the
               fallback DOM on an initial desktop visit as well as on a live
               mobile-to-desktop breakpoint change. */
            var inactiveRoot = document.querySelector('.hero-stable-mobile');
            if (inactiveRoot) {
                inactiveRoot.setAttribute('aria-hidden', 'true');
                inactiveRoot.hidden = true;
            }
            return;
        }
        active = false;

        if (sourceObserver) {
            sourceObserver.disconnect();
            sourceObserver = null;
        }
        if (syncFrame) {
            window.cancelAnimationFrame(syncFrame);
            syncFrame = 0;
        }
        controlDisposers.splice(0).forEach(function (dispose) {
            try { dispose(); } catch (error) {}
        });
        restoreAttributes();

        if (stableRoot) {
            stableRoot.classList.remove('is-synced');
            stableRoot.setAttribute('aria-hidden', 'true');
            stableRoot.hidden = true;
        }
        stableRoot = null;
    }

    function reconcile() {
        if (shouldUseStableView()) activate();
        else deactivate();
    }

    if (typeof mobileQuery.addEventListener === 'function') {
        mobileQuery.addEventListener('change', reconcile);
    } else if (typeof mobileQuery.addListener === 'function') {
        mobileQuery.addListener(reconcile);
    }

    window.addEventListener('pagehide', deactivate);
    window.addEventListener('pageshow', reconcile);
    window.addEventListener('web1-ui-version-change', reconcile);

    /* The script is normally loaded after the Hero markup. Reconcile once
       immediately to prevent a desktop fallback flash, then once more at DOM
       readiness for integrations that place the script in <head>. */
    reconcile();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', reconcile, { once: true });
    }
})(window, document);
