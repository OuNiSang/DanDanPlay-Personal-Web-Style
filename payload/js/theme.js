/* ===========================================================
   Theme and Web1 presentation controller
   -----------------------------------------------------------
   Loaded synchronously from style.sshtml so theme and UI-version
   attributes exist before the first paint.

   - dandanplay-theme: light | dark, dark by default.
   - dandanplay-ui-version: stable | v3, v3 by default on desktop.
   - <=768px always uses the stable presentation.
   - Buttons marked data-ui-version-toggle switch UI versions.
   - Unrelated #theme-toggle buttons keep the theme behavior.
   =========================================================== */
(function () {
    'use strict';

    var THEME_STORAGE_KEY = 'dandanplay-theme';
    var UI_STORAGE_KEY = 'dandanplay-ui-version';
    var desktopQuery = window.matchMedia ? window.matchMedia('(min-width: 769px)') : null;
    var button = null;
    var v3BootEligible = null;

    function getStoredTheme() {
        try {
            var value = localStorage.getItem(THEME_STORAGE_KEY);
            return value === 'dark' || value === 'light' ? value : null;
        } catch (error) {
            return null;
        }
    }

    function setStoredTheme(value) {
        try {
            if (value) localStorage.setItem(THEME_STORAGE_KEY, value);
            else localStorage.removeItem(THEME_STORAGE_KEY);
        } catch (error) {
            /* Storage may be unavailable in private mode. */
        }
    }

    function effectiveTheme() {
        return getStoredTheme() || 'dark';
    }

    function getStoredUiVersion() {
        try {
            var value = localStorage.getItem(UI_STORAGE_KEY);
            return value === 'stable' || value === 'v3' ? value : null;
        } catch (error) {
            return null;
        }
    }

    function setStoredUiVersion(value) {
        try {
            localStorage.setItem(UI_STORAGE_KEY, value === 'stable' ? 'stable' : 'v3');
        } catch (error) {
            /* The current visit can still switch before navigation. */
        }
    }

    function getUiPreference() {
        return getStoredUiVersion() || 'v3';
    }

    function isDesktop() {
        return Boolean(desktopQuery && desktopQuery.matches);
    }

    function effectiveUiVersion() {
        return isV3Desktop() ? 'v3' : 'stable';
    }

    function isV3Desktop() {
        if (v3BootEligible === null) {
            v3BootEligible = isDesktop() && getUiPreference() === 'v3';
        }
        return v3BootEligible && isDesktop() && getUiPreference() === 'v3';
    }

    function applyTheme() {
        var theme = effectiveTheme();
        var html = document.documentElement;
        html.setAttribute('data-theme', theme);
        html.setAttribute('data-bs-theme', theme);
        if (button && !button.hasAttribute('data-ui-version-toggle')) updateThemeButton();
    }

    function applyUiVersion() {
        var html = document.documentElement;
        html.setAttribute('data-ui-version', effectiveUiVersion());
        html.setAttribute('data-ui-version-preference', getUiPreference());
    }

    function syncUiStyles() {
        var enabled = isV3Desktop();
        Array.prototype.forEach.call(document.querySelectorAll('link[data-web1-v3]'), function (link) {
            link.disabled = !enabled;
        });
    }

    function updateThemeButton() {
        if (!button) return;
        var isDark = effectiveTheme() === 'dark';
        button.innerHTML = isDark
            ? '<i class="fas fa-sun" aria-hidden="true"></i>'
            : '<i class="fas fa-moon" aria-hidden="true"></i>';
        var label = isDark ? '切换到亮色主题' : '切换到暗色主题';
        button.setAttribute('aria-label', label);
        button.title = label;
    }

    function updateUiVersionButton() {
        if (!button) return;
        var desktop = isDesktop();
        var current = effectiveUiVersion();
        var target = current === 'v3' ? 'stable' : 'v3';
        var label = target === 'v3' ? '切换到 Web1 3.0' : '切换到稳定版';

        button.hidden = !desktop;
        button.disabled = !desktop;
        button.classList.add('ui-version-toggle');
        button.setAttribute('aria-label', label);
        button.setAttribute('data-current-version', current);
        button.title = label;
        button.innerHTML = target === 'v3'
            ? '<i class="fas fa-wand-magic-sparkles" aria-hidden="true"></i><span>3.0</span>'
            : '<i class="fas fa-clock-rotate-left" aria-hidden="true"></i><span>稳定版</span>';
    }

    function commitThemeToggle() {
        setStoredTheme(effectiveTheme() === 'dark' ? 'light' : 'dark');
        applyTheme();
    }

    function toggleTheme(event) {
        var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        var canUseViewTransition = typeof document.startViewTransition === 'function';

        if (reduceMotion) {
            commitThemeToggle();
            return;
        }

        var source = event && event.currentTarget ? event.currentTarget : button;
        var rect = source ? source.getBoundingClientRect() : { left: window.innerWidth, top: 0, width: 0, height: 0 };
        var x = rect.left + rect.width / 2;
        var y = rect.top + rect.height / 2;
        var radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
        var html = document.documentElement;
        html.style.setProperty('--theme-reveal-x', x + 'px');
        html.style.setProperty('--theme-reveal-y', y + 'px');
        html.style.setProperty('--theme-reveal-radius', radius + 'px');

        if (canUseViewTransition) {
            document.startViewTransition(commitThemeToggle);
            return;
        }

        html.classList.add('theme-fallback-transition');
        commitThemeToggle();
        window.setTimeout(function () {
            html.classList.remove('theme-fallback-transition');
        }, 420);
    }

    function toggleUiVersion(event) {
        if (event) event.preventDefault();
        if (!isDesktop()) return;

        setStoredUiVersion(effectiveUiVersion() === 'v3' ? 'stable' : 'v3');
        applyUiVersion();
        syncUiStyles();
        updateUiVersionButton();
        if (button) button.setAttribute('aria-busy', 'true');

        /* Changing the presentation replaces its complete controller layer.
           A normal same-page navigation deliberately remounts that layer. */
        window.location.replace(window.location.href);
    }

    function initButton() {
        if (button || !document.body) return;

        var existing = document.getElementById('theme-toggle');
        if (existing) {
            button = existing;
            if (button.hasAttribute('data-ui-version-toggle')) {
                button.addEventListener('click', toggleUiVersion);
                updateUiVersionButton();
            } else {
                button.addEventListener('click', toggleTheme);
                updateThemeButton();
            }
            return;
        }

        button = document.createElement('button');
        button.id = 'theme-toggle';
        button.type = 'button';
        button.className = 'theme-toggle theme-toggle--floating';
        button.addEventListener('click', toggleTheme);
        document.body.appendChild(button);
        updateThemeButton();
    }

    function handleDesktopChange() {
        applyUiVersion();
        syncUiStyles();
        if (button && button.hasAttribute('data-ui-version-toggle')) updateUiVersionButton();
        window.dispatchEvent(new CustomEvent('web1-ui-version-change', {
            detail: { version: effectiveUiVersion() }
        }));
    }

    window.Web1UiVersion = {
        preference: getUiPreference,
        effective: effectiveUiVersion,
        isV3Desktop: isV3Desktop,
        syncStyles: syncUiStyles
    };

    applyUiVersion();
    applyTheme();

    if (desktopQuery) {
        if (typeof desktopQuery.addEventListener === 'function') {
            desktopQuery.addEventListener('change', handleDesktopChange);
        } else if (typeof desktopQuery.addListener === 'function') {
            desktopQuery.addListener(handleDesktopChange);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            syncUiStyles();
            initButton();
        });
    } else {
        syncUiStyles();
        initButton();
    }
})();
