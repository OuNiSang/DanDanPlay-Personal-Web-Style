(function () {
    'use strict';

    if (!window.matchMedia('(min-width: 769px)').matches) return;
    if (window.Web1UiVersion && typeof window.Web1UiVersion.isV3Desktop === 'function' && !window.Web1UiVersion.isV3Desktop()) return;

    var root = document.querySelector('.idx-body');
    if (!root || !window.gsap) return;

    var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    var activeCase = null;
    var activeRect = null;
    var lastPointer = null;
    var moveFrame = 0;
    var motionControllers = new WeakMap();
    var updateRevealTimeline = null;
    var updateRevealObserver = null;

    function getMotionProfile(card) {
        if (card.classList.contains('media-case--continue')) {
            return { rotateX: 12, rotateY: 14, lift: 40, cover: 10, shadow: 6 };
        }
        if (card.classList.contains('media-case--update')) {
            return { rotateX: 7, rotateY: 9, lift: 24, cover: 6, shadow: 2 };
        }
        return { rotateX: 10, rotateY: 12, lift: 32, cover: 8, shadow: 5 };
    }

    function getParts(card) {
        return {
            surface: card.querySelector('.media-case__surface'),
            shadow: card.querySelector('.media-case__shadow'),
            cover: card.querySelector('.media-case__cover, .pc__img, .follow-card__cover'),
            sheen: card.querySelector('.media-case__sheen')
        };
    }

    function quick(target, property, duration) {
        return target ? gsap.quickTo(target, property, {
            duration: duration,
            ease: 'power3.out',
            overwrite: 'auto'
        }) : function () {};
    }

    function getMotionController(card, parts) {
        var controller = motionControllers.get(card);
        if (controller) return controller;
        if (parts.surface) {
            gsap.set(parts.surface, { transformPerspective: 940, transformOrigin: '50% 68%' });
        }
        controller = {
            surface: {
                rotationX: quick(parts.surface, 'rotationX', 0.22),
                rotationY: quick(parts.surface, 'rotationY', 0.22),
                x: quick(parts.surface, 'x', 0.22),
                y: quick(parts.surface, 'y', 0.22),
                z: quick(parts.surface, 'z', 0.24),
                scaleX: quick(parts.surface, 'scaleX', 0.24),
                scaleY: quick(parts.surface, 'scaleY', 0.24)
            },
            shadow: {
                x: quick(parts.shadow, 'x', 0.26),
                y: quick(parts.shadow, 'y', 0.26),
                rotation: quick(parts.shadow, 'rotation', 0.26),
                skewY: quick(parts.shadow, 'skewY', 0.26),
                scaleX: quick(parts.shadow, 'scaleX', 0.26),
                scaleY: quick(parts.shadow, 'scaleY', 0.26),
                opacity: quick(parts.shadow, 'opacity', 0.22)
            },
            cover: {
                x: quick(parts.cover, 'x', 0.3),
                y: quick(parts.cover, 'y', 0.3),
                scaleX: quick(parts.cover, 'scaleX', 0.3),
                scaleY: quick(parts.cover, 'scaleY', 0.3)
            }
        };
        motionControllers.set(card, controller);
        return controller;
    }

    function resetCase(card, immediate) {
        if (!card) return;
        var parts = getParts(card);
        var duration = immediate || reducedMotion.matches ? 0 : 0.5;
        card.classList.remove('is-pointer-active', 'is-pointer-pressed');
        gsap.killTweensOf([parts.surface, parts.shadow, parts.cover].filter(Boolean));
        motionControllers.delete(card);
        if (parts.surface) {
            gsap.to(parts.surface, {
                rotationX: 0,
                rotationY: 0,
                x: 0,
                y: 0,
                z: 0,
                scaleX: 1,
                scaleY: 1,
                duration: duration,
                ease: 'power3.out',
                overwrite: true,
                clearProps: 'transform'
            });
        }
        if (parts.shadow) {
            gsap.to(parts.shadow, {
                x: 0,
                y: 0,
                rotation: 0,
                skewY: -0.8,
                scaleX: 1,
                scaleY: 1,
                opacity: 0.72,
                duration: duration,
                ease: 'power3.out',
                overwrite: true,
                clearProps: 'transform,opacity'
            });
        }
        if (parts.cover) {
            gsap.to(parts.cover, {
                x: 0,
                y: 0,
                scaleX: 1.012,
                scaleY: 1.012,
                duration: duration,
                ease: 'power3.out',
                overwrite: true,
                clearProps: 'transform'
            });
        }
        if (parts.sheen) {
            parts.sheen.style.removeProperty('--case-light-x');
            parts.sheen.style.removeProperty('--case-light-y');
        }
    }

    function renderPointer() {
        moveFrame = 0;
        if (!activeCase || !activeRect || !lastPointer || reducedMotion.matches) return;
        var profile = getMotionProfile(activeCase);
        var parts = getParts(activeCase);
        if (!parts.surface) return;
        var controller = getMotionController(activeCase, parts);

        var nx = Math.max(-1, Math.min(1, ((lastPointer.clientX - activeRect.left) / activeRect.width - 0.5) * 2));
        var ny = Math.max(-1, Math.min(1, ((lastPointer.clientY - activeRect.top) / activeRect.height - 0.5) * 2));
        var pressed = activeCase.classList.contains('is-pointer-pressed');
        var pressFactor = pressed ? 0.42 : 1;

        controller.surface.rotationX(-ny * profile.rotateX * pressFactor);
        controller.surface.rotationY(nx * profile.rotateY * pressFactor);
        controller.surface.x(nx * 3.2);
        controller.surface.y(pressed ? 4 : -4 - Math.abs(nx) * 2);
        controller.surface.z(pressed ? profile.lift * 0.18 : profile.lift);
        controller.surface.scaleX(pressed ? 0.982 : 1.018);
        controller.surface.scaleY(pressed ? 0.982 : 1.018);

        if (parts.shadow) {
            controller.shadow.x(nx * profile.shadow);
            controller.shadow.y(profile.shadow + Math.abs(ny) * 6);
            controller.shadow.rotation(nx * 2.1);
            controller.shadow.skewY(-0.8 + nx * -1.2);
            controller.shadow.scaleX(pressed ? 0.94 : 1.015);
            controller.shadow.scaleY(pressed ? 0.94 : 1.015);
            controller.shadow.opacity(pressed ? 0.48 : 0.78);
        }

        if (parts.cover) {
            controller.cover.x(-nx * profile.cover);
            controller.cover.y(-ny * profile.cover);
            controller.cover.scaleX(pressed ? 1.018 : 1.052);
            controller.cover.scaleY(pressed ? 1.018 : 1.052);
        }

        if (parts.sheen) {
            parts.sheen.style.setProperty('--case-light-x', ((nx + 1) * 50).toFixed(2) + '%');
            parts.sheen.style.setProperty('--case-light-y', ((ny + 1) * 50).toFixed(2) + '%');
        }
    }

    function queuePointer(event) {
        lastPointer = { clientX: event.clientX, clientY: event.clientY };
        if (!moveFrame) moveFrame = window.requestAnimationFrame(renderPointer);
    }

    root.addEventListener('pointerover', function (event) {
        if (!finePointer.matches || reducedMotion.matches) return;
        var card = event.target.closest('.media-case');
        if (!card || !root.contains(card)) return;
        if (event.relatedTarget && card.contains(event.relatedTarget)) return;
        if (activeCase && activeCase !== card) resetCase(activeCase, false);
        activeCase = card;
        activeRect = card.querySelector('.media-case__surface').getBoundingClientRect();
        activeCase.classList.add('is-pointer-active');
        queuePointer(event);
    });

    root.addEventListener('pointermove', function (event) {
        if (!activeCase || event.pointerType === 'touch') return;
        queuePointer(event);
    }, { passive: true });

    root.addEventListener('pointerout', function (event) {
        if (!activeCase) return;
        var card = event.target.closest('.media-case');
        if (card !== activeCase || (event.relatedTarget && card.contains(event.relatedTarget))) return;
        resetCase(activeCase, false);
        activeCase = null;
        activeRect = null;
        lastPointer = null;
    });

    root.addEventListener('pointerdown', function (event) {
        var card = event.target.closest('.media-case');
        if (!card || card !== activeCase || event.pointerType === 'touch') return;
        card.classList.add('is-pointer-pressed');
        queuePointer(event);
    });

    root.addEventListener('pointerup', function (event) {
        if (!activeCase) return;
        activeCase.classList.remove('is-pointer-pressed');
        queuePointer(event);
    });

    root.addEventListener('pointercancel', function () {
        if (!activeCase) return;
        resetCase(activeCase, false);
        activeCase = null;
        activeRect = null;
        lastPointer = null;
    });

    function resetAll() {
        if (moveFrame) window.cancelAnimationFrame(moveFrame);
        moveFrame = 0;
        root.querySelectorAll('.media-case').forEach(function (card) {
            resetCase(card, true);
        });
        activeCase = null;
        activeRect = null;
        lastPointer = null;
    }

    function killUpdateReveal() {
        if (updateRevealTimeline) {
            updateRevealTimeline.kill();
            updateRevealTimeline = null;
        }
    }

    function setGsapTargets(targets, vars) {
        if (!targets) return;
        if (targets.nodeType) {
            gsap.set(targets, vars);
            return;
        }
        var list = Array.prototype.slice.call(targets);
        if (list.length) gsap.set(list, vars);
    }

    function setUpdateRevealEndState(section) {
        var weekPage = section.querySelector('.update-timeline__page--week');
        if (!weekPage) return;
        var days = weekPage.querySelectorAll('.schedule-day--recent');
        var headers = weekPage.querySelectorAll('.schedule-day__header');
        var cards = weekPage.querySelectorAll('.timeline-card');
        var surfaces = weekPage.querySelectorAll('.media-case__surface');
        var shadows = weekPage.querySelectorAll('.media-case__shadow');

        gsap.set(weekPage, { '--update-rail-progress': 1 });
        setGsapTargets(days, { '--update-node-opacity': 1, '--update-node-scale': 1 });
        setGsapTargets(headers, { autoAlpha: 1, y: 0 });
        setGsapTargets(cards, { autoAlpha: 1 });
        setGsapTargets(surfaces, { autoAlpha: 1, y: 0, rotationX: 0, scaleX: 1, scaleY: 1, clearProps: 'transform,opacity,visibility' });
        setGsapTargets(shadows, { autoAlpha: 0.72, y: 0, scaleX: 1, scaleY: 1, clearProps: 'transform,visibility' });
        section.classList.add('is-update-sequence-complete');
    }

    function prepareUpdateReveal(section) {
        killUpdateReveal();
        if (section.classList.contains('is-update-sequence-complete')) {
            section.classList.remove('is-update-sequence-complete');
        }
        var weekPage = section.querySelector('.update-timeline__page--week');
        if (!weekPage) return;
        var days = weekPage.querySelectorAll('.schedule-day--recent');
        var headers = weekPage.querySelectorAll('.schedule-day__header');
        var cards = weekPage.querySelectorAll('.timeline-card');
        var surfaces = weekPage.querySelectorAll('.media-case__surface');
        var shadows = weekPage.querySelectorAll('.media-case__shadow');

        gsap.set(weekPage, { '--update-rail-progress': 0 });
        setGsapTargets(days, { '--update-node-opacity': 0, '--update-node-scale': 0.46 });
        setGsapTargets(headers, { autoAlpha: 0, y: 7 });
        setGsapTargets(cards, { autoAlpha: 0 });
        setGsapTargets(surfaces, { autoAlpha: 0, y: 18, rotationX: -8, scaleX: 0.9, scaleY: 0.9, transformOrigin: '50% 82%' });
        setGsapTargets(shadows, { autoAlpha: 0, y: 7, scaleX: 0.94, scaleY: 0.94 });
    }

    function playUpdateReveal(section) {
        if (!section || !section.classList.contains('is-update-revealed')) return;
        if (reducedMotion.matches) {
            killUpdateReveal();
            setUpdateRevealEndState(section);
            return;
        }

        prepareUpdateReveal(section);
        var weekPage = section.querySelector('.update-timeline__page--week');
        if (!weekPage) return;
        var days = weekPage.querySelectorAll('.schedule-day--recent');
        var headers = weekPage.querySelectorAll('.schedule-day__header');
        var cards = weekPage.querySelectorAll('.timeline-card');
        var surfaces = weekPage.querySelectorAll('.media-case__surface');
        var shadows = weekPage.querySelectorAll('.media-case__shadow');
        if (!days.length) {
            setUpdateRevealEndState(section);
            return;
        }

        updateRevealTimeline = gsap.timeline({
            defaults: { ease: 'power3.out' },
            onComplete: function () {
                updateRevealTimeline = null;
                section.classList.add('is-update-sequence-complete');
                setGsapTargets(headers, { clearProps: 'willChange' });
                setGsapTargets(cards, { clearProps: 'willChange' });
                setGsapTargets(surfaces, { clearProps: 'willChange' });
                setGsapTargets(shadows, { clearProps: 'willChange' });
            }
        });
        updateRevealTimeline
            .addLabel('rail', 0)
            .to(weekPage, { '--update-rail-progress': 1, duration: 0.48, ease: 'power2.inOut' }, 'rail')
            .addLabel('nodes', '>')
            .to(days, {
                '--update-node-opacity': 1,
                '--update-node-scale': 1,
                duration: 0.22,
                stagger: 0.035,
                ease: 'back.out(1.9)'
            }, 'nodes')
            .to(headers, { autoAlpha: 1, y: 0, duration: 0.2, stagger: 0.035 }, 'nodes+=0.05')
            .addLabel('cards', '>+=0.04')
            .set(cards, { autoAlpha: 1 }, 'cards')
            .to(surfaces, {
                autoAlpha: 1,
                y: 0,
                rotationX: 0,
                scaleX: 1,
                scaleY: 1,
                duration: 0.38,
                stagger: 0.028,
                ease: 'back.out(1.45)'
            }, 'cards')
            .to(shadows, {
                autoAlpha: 0.72,
                y: 0,
                scaleX: 1,
                scaleY: 1,
                duration: 0.28,
                stagger: 0.028
            }, 'cards+=0.04');
    }

    function observeUpdateReveal() {
        var section = document.getElementById('luSection');
        if (!section || !window.MutationObserver) return;
        if (updateRevealObserver) updateRevealObserver.disconnect();
        updateRevealObserver = new MutationObserver(function (mutations) {
            var structureChanged = mutations.some(function (mutation) {
                return mutation.type === 'childList';
            });
            var sectionStateChanged = mutations.some(function (mutation) {
                return mutation.type === 'attributes' && mutation.target === section;
            });
            if ((structureChanged || sectionStateChanged) &&
                section.classList.contains('is-update-armed') &&
                !section.classList.contains('is-update-revealed')) {
                prepareUpdateReveal(section);
                return;
            }
            if (sectionStateChanged && !updateRevealTimeline &&
                section.classList.contains('is-update-revealed') &&
                !section.classList.contains('is-update-sequence-complete')) {
                playUpdateReveal(section);
            }
        });
        updateRevealObserver.observe(section, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
    }

    observeUpdateReveal();

    function syncDocumentMotion() {
        document.body.classList.toggle('is-home-motion-paused', document.hidden);
        if (document.hidden) resetAll();
    }

    document.addEventListener('visibilitychange', syncDocumentMotion);
    syncDocumentMotion();

    reducedMotion.addEventListener('change', resetAll);
    finePointer.addEventListener('change', resetAll);
    window.addEventListener('blur', resetAll);
    window.addEventListener('pagehide', function () {
        resetAll();
        killUpdateReveal();
        if (updateRevealObserver) updateRevealObserver.disconnect();
    });
    window.addEventListener('pageshow', function (event) {
        if (!event.persisted) return;
        syncDocumentMotion();
        // pagehide disconnected the observer. Restore it for the same page
        // when history navigation revives it from the back/forward cache.
        observeUpdateReveal();
        var section = document.getElementById('luSection');
        if (section && section.classList.contains('is-update-revealed') &&
            !section.classList.contains('is-update-sequence-complete')) {
            setUpdateRevealEndState(section);
        }
    });

    window.DandanHomeContent = { reset: resetAll, revealUpdates: playUpdateReveal };
})();
