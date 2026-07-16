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
