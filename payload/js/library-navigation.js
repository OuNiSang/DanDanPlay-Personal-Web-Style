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

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeLibraryNavigation, { once: true });
    } else {
        initializeLibraryNavigation();
    }
})();
