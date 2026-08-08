'use strict';

{
    // ============================================================
    //  Config Loading
    // ============================================================
    const config = typeof HFS !== 'undefined' && HFS.pluginConfig
        ? HFS.pluginConfig
        : {};

    const ENABLE_SCROLL_REMEMBER = config.enableScrollRemember !== false;
    const ENABLE_GESTURE_NAVIGATION = config.enableGestureNavigation !== false;

    const EXPIRE_MINUTES = config.scrollExpireMinutes ?? 10;
    const EXPIRE = EXPIRE_MINUTES === 0
        ? Infinity
        : EXPIRE_MINUTES * 60 * 1000;

    // ============================================================
    //  Gesture Navigation Settings (Hardcoded)
    // ============================================================
    const GESTURE_CONFIG = {
        MIN_SWIPE_DISTANCE: 90,
        MAX_VERTICAL_DEVIATION: 50,
        ACTIVATION_ZONE: {
            TOP: 0.25,
            BOTTOM: 0.75
        },
        COOLDOWN: 300,
        BACKSPACE_ENABLED: true
    };

    // ============================================================
    //  Scroll Position Memory Module
    // ============================================================
    const RESTORE_DELAY = 80;
    const URI_WATCH_INTERVAL = 200;

    const STORAGE_KEY = "hfs-folder-scroll";
    const META_KEY = "hfs-folder-scroll-meta";

    // ---- 狀態管理 ----
    let isRestoring = false;
    let restoreTimer = null;
    let isDialogOpen = false;
    let pendingRestoreTimers = [];
    let scrollSaveTimer = null; // 滾動保存防抖定時器

    // ---- Data functions ----
    function loadData() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return {};
            return JSON.parse(raw);
        } catch {
            return {};
        }
    }

    function saveData(data) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }

    function loadMeta() {
        try {
            const raw = localStorage.getItem(META_KEY);
            if (!raw) return {};
            return JSON.parse(raw);
        } catch {
            return {};
        }
    }

    function saveMeta(meta) {
        localStorage.setItem(META_KEY, JSON.stringify(meta));
    }

    function getTodayStr() {
        const d = new Date();
        return d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
    }

    function currentPath() {
        return location.pathname + location.search;
    }

    function getScrollY() {
        return window.pageYOffset
            || document.documentElement.scrollTop
            || document.body.scrollTop
            || 0;
    }

    // ---- 取消所有待執行的恢復 ----
    function cancelAllPendingRestores() {
        pendingRestoreTimers.forEach(function(timer) {
            clearTimeout(timer);
        });
        pendingRestoreTimers = [];
        
        if (restoreTimer) {
            clearTimeout(restoreTimer);
            restoreTimer = null;
        }
        isRestoring = false;
    }

    // ---- 安全的 setTimeout（可追蹤） ----
    function scheduleRestore(delay) {
        var timer = setTimeout(function() {
            var index = pendingRestoreTimers.indexOf(timer);
            if (index > -1) {
                pendingRestoreTimers.splice(index, 1);
            }
            restoreScroll();
        }, delay);
        pendingRestoreTimers.push(timer);
        return timer;
    }

    // ---- 檢查對話框狀態 ----
    function updateDialogState() {
        var dialog = document.querySelector('.dialog-backdrop.file-show');
        var wasOpen = isDialogOpen;
        isDialogOpen = dialog !== null && dialog.offsetParent !== null;
        
        if (isDialogOpen && !wasOpen) {
            cancelAllPendingRestores();
        }
    }

    // ---- 平滑滾動 ----
    function smoothSetScrollY(targetY) {
        updateDialogState();
        if (isDialogOpen) return;

        const startY = window.pageYOffset
            || document.documentElement.scrollTop
            || document.body.scrollTop
            || 0;

        const distance = targetY - startY;
        const MIN_DISTANCE = 10;

        if (Math.abs(distance) < MIN_DISTANCE) {
            window.scrollTo({ top: targetY, behavior: "instant" });
            if (document.documentElement) {
                document.documentElement.scrollTop = targetY;
            }
            if (document.body) {
                document.body.scrollTop = targetY;
            }
            return;
        }

        const DURATION = 800;
        const EASING = 'easeOutQuart';

        const startTime = performance.now();

        const easingMap = {
            easeOutQuad: function(t) { return 1 - Math.pow(1 - t, 2); },
            easeOutCubic: function(t) { return 1 - Math.pow(1 - t, 3); },
            easeOutQuart: function(t) { return 1 - Math.pow(1 - t, 4); },
            easeOutQuint: function(t) { return 1 - Math.pow(1 - t, 5); }
        };

        const easingFn = easingMap[EASING] || easingMap.easeOutQuart;

        function step(currentTime) {
            updateDialogState();
            if (isDialogOpen) return;

            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / DURATION, 1);
            const easedProgress = easingFn(progress);

            const currentY = startY + distance * easedProgress;
            window.scrollTo({ top: currentY, behavior: "instant" });
            if (document.documentElement) {
                document.documentElement.scrollTop = currentY;
            }
            if (document.body) {
                document.body.scrollTop = currentY;
            }

            if (progress < 1) {
                requestAnimationFrame(step);
            } else {
                window.scrollTo({ top: targetY, behavior: "instant" });
                if (document.documentElement) {
                    document.documentElement.scrollTop = targetY;
                }
                if (document.body) {
                    document.body.scrollTop = targetY;
                }
            }
        }

        requestAnimationFrame(step);
    }

    // ---- 清理過期記錄 ----
    function cleanExpired() {
        if (EXPIRE === Infinity) return;

        const meta = loadMeta();
        const today = getTodayStr();

        if (meta.lastClean === today) return;

        const data = loadData();
        const now = Date.now();
        let changed = false;

        for (const key in data) {
            if (now - data[key].time > EXPIRE) {
                delete data[key];
                changed = true;
            }
        }

        if (changed) {
            saveData(data);
        }

        meta.lastClean = today;
        saveMeta(meta);
    }

    // ---- 保存滾動位置 ----
    function saveScroll() {
        if (!ENABLE_SCROLL_REMEMBER) return;
        updateDialogState();
        if (isDialogOpen) return;
        if (isRestoring) return; // 恢復過程中不保存

        const data = loadData();
        data[currentPath()] = {
            y: getScrollY(),
            time: Date.now()
        };
        saveData(data);
    }

    // ---- 恢復滾動位置 ----
    function restoreScroll() {
        if (!ENABLE_SCROLL_REMEMBER) return;
        updateDialogState();
        if (isDialogOpen) return;

        const path = currentPath();

        if (isRestoring) {
            if (restoreTimer) {
                clearTimeout(restoreTimer);
                restoreTimer = null;
            }
            isRestoring = false;
        }

        cleanExpired();

        const data = loadData();
        const info = data[path];

        if (!info || typeof info.y !== 'number' || info.y < 0) {
            return;
        }

        const targetY = Math.max(0, info.y);

        isRestoring = true;

        restoreTimer = setTimeout(function() {
            restoreTimer = null;

            if (currentPath() !== path) {
                isRestoring = false;
                return;
            }

            updateDialogState();
            if (isDialogOpen) {
                isRestoring = false;
                return;
            }

            smoothSetScrollY(targetY);

            setTimeout(function() {
                isRestoring = false;
            }, 300);
        }, RESTORE_DELAY);

        setTimeout(function() {
            if (isRestoring) {
                isRestoring = false;
                if (restoreTimer) {
                    clearTimeout(restoreTimer);
                    restoreTimer = null;
                }
            }
        }, 3000);
    }

    // ---- 每日清理器 ----
    function installDailyCleaner() {
        if (EXPIRE === Infinity) return;

        cleanExpired();

        setInterval(function() {
            const meta = loadMeta();
            const today = getTodayStr();
            if (meta.lastClean !== today) {
                cleanExpired();
            }
        }, 60000);
    }

    // ---- 滾動監聽（實時保存） ----
    function installScrollListener() {
        if (!ENABLE_SCROLL_REMEMBER) return;

        window.addEventListener('scroll', function() {
            updateDialogState();
            if (isDialogOpen) return;
            if (isRestoring) return;

            // 防抖：用戶停止滾動 500ms 後保存
            if (scrollSaveTimer) {
                clearTimeout(scrollSaveTimer);
            }
            scrollSaveTimer = setTimeout(function() {
                scrollSaveTimer = null;
                saveScroll();
            }, 500);
        }, { passive: true });
    }

    // ---- 事件監聽 ----
    function installFolderClickListener() {
        if (!ENABLE_SCROLL_REMEMBER) return;

        document.addEventListener("click", function(e) {
            const a = e.target.closest("a");
            if (!a) return;

            const href = a.getAttribute("href");
            if (!href) return;
            if (href.includes("?dl")) return;
            if (href.includes(".") && !href.endsWith("/")) return;

            saveScroll();
        }, true);
    }

    function installBackForwardListener() {
        if (!ENABLE_SCROLL_REMEMBER) return;

        window.addEventListener("popstate", function() {
            scheduleRestore(100);
        });
    }

    function installUriWatcher() {
        if (!ENABLE_SCROLL_REMEMBER) return;

        let last = currentPath();

        setInterval(function() {
            const now = currentPath();

            if (now !== last) {
                last = now;
                scheduleRestore(120);
            }
        }, URI_WATCH_INTERVAL);
    }

    // ---- 初始化 ----
    function initScrollModule() {
        if (!ENABLE_SCROLL_REMEMBER) return;

        installDailyCleaner();
        installScrollListener(); // 新增：滾動監聽

        document.addEventListener("visibilitychange", function() {
            if (!document.hidden) {
                scheduleRestore(200);
            }
        });

        window.addEventListener("pageshow", function(e) {
            if (e.persisted) {
                scheduleRestore(150);
            }
        });

        window.addEventListener("beforeunload", function() {
            saveScroll();
        });

        window.addEventListener("pagehide", function() {
            saveScroll();
        });

        installFolderClickListener();
        installBackForwardListener();
        installUriWatcher();

        scheduleRestore(300);

        if (document.readyState === 'complete') {
            scheduleRestore(500);
            scheduleRestore(1000);
        } else {
            window.addEventListener('load', function() {
                scheduleRestore(400);
                scheduleRestore(900);
            });
        }
    }

    // ---- 供手勢導航使用 ----
    function saveForGesture() {
        if (!ENABLE_SCROLL_REMEMBER) return;
        saveScroll();
    }

    function restoreForGesture() {
        if (!ENABLE_SCROLL_REMEMBER) return;
        scheduleRestore(300);
    }

    // ============================================================
    //  Gesture Navigation Module
    // ============================================================
    const GestureModule = (function() {
        let lastActionTime = 0;
        let startPoint = null;

        function getCurrentPath() {
            let path = location.pathname;
            if (path.length > 1 && path.endsWith('/')) {
                path = path.slice(0, -1);
            }
            return path;
        }

        function getParentPath() {
            let path = getCurrentPath();
            if (path === '/') return '/';

            const parts = path.split('/').filter(p => p !== '');
            parts.pop();

            if (parts.length === 0) return '/';
            return '/' + parts.join('/');
        }

        function getParentButton() {
            const selectors = [
                '.breadcrumb [aria-label="parent folder"], [title="parent folder"]',
                '#breadcrumb-parent',
                '[href="#parent"], [onclick*="parent"]',
                'a[href*="/.."], a[href*="/../"]'
            ];

            for (const selector of selectors) {
                const elements = document.querySelectorAll(selector);
                for (const el of elements) {
                    if (el.offsetParent !== null) {
                        return el;
                    }
                }
            }
            return null;
        }

        function navigateToParent() {
            const parentPath = getParentPath();
            const currentPath = getCurrentPath();

            if (currentPath === '/' || parentPath === currentPath) {
                return;
            }

            saveForGesture();

            const breadcrumbLinks = document.querySelectorAll('.breadcrumb');
            for (const link of breadcrumbLinks) {
                const href = link.getAttribute('href');
                if (href && href !== '#' && href !== '..') {
                    const linkPath = href.startsWith('/') ? href : '/' + href.replace(/^\.\.\/?/, '');
                    if (linkPath === parentPath || linkPath + '/' === parentPath ||
                        href === '..' || href === '../') {
                        link.click();
                        restoreForGesture();
                        return;
                    }
                }
            }

            const parentBtn = getParentButton();
            if (parentBtn) {
                parentBtn.click();
                restoreForGesture();
                return;
            }

            const newUrl = parentPath;
            history.pushState(null, '', newUrl);

            const popStateEvent = new PopStateEvent('popstate', { state: null });
            window.dispatchEvent(popStateEvent);

            if (typeof window.HFS !== 'undefined' && typeof window.HFS.navigate === 'function') {
                window.HFS.navigate(newUrl);
            }

            restoreForGesture();
        }

        function triggerParentNavigation() {
            const now = Date.now();
            if (now - lastActionTime < GESTURE_CONFIG.COOLDOWN) return;
            lastActionTime = now;

            const activeElement = document.activeElement;
            const isContentEditable = activeElement && activeElement.isContentEditable;
            const inputTypes = ['INPUT', 'TEXTAREA', 'SELECT'];
            const isInputField = activeElement && inputTypes.includes(activeElement.tagName);

            if (isContentEditable || isInputField) {
                return;
            }

            const modal = document.querySelector('.dialog-backdrop.file-show, .modal.in, .v-dialog');
            if (modal) {
                const closeBtn = modal.querySelector('button[title="Close"], [aria-label="Close"], .close-button');
                if (closeBtn) {
                    closeBtn.click();
                    return;
                }
            }

            navigateToParent();
        }

        function handleTouchStart(e) {
            if (e.touches.length === 1) {
                startPoint = {
                    x: e.touches[0].clientX,
                    y: e.touches[0].clientY,
                    time: Date.now()
                };
            }
        }

        function handleTouchEnd(e) {
            if (!startPoint || e.changedTouches.length !== 1) return;

            const endPoint = {
                x: e.changedTouches[0].clientX,
                y: e.changedTouches[0].clientY
            };

            const height = window.innerHeight;
            const inZone = startPoint.y >= height * GESTURE_CONFIG.ACTIVATION_ZONE.TOP &&
                startPoint.y <= height * GESTURE_CONFIG.ACTIVATION_ZONE.BOTTOM;

            const dx = endPoint.x - startPoint.x;
            const dy = endPoint.y - startPoint.y;
            const isSwipe = Math.abs(dx) >= GESTURE_CONFIG.MIN_SWIPE_DISTANCE &&
                Math.abs(dy) <= GESTURE_CONFIG.MAX_VERTICAL_DEVIATION;

            if (inZone && isSwipe) {
                triggerParentNavigation();
            }

            startPoint = null;
        }

        function handleKeyDown(e) {
            if (!GESTURE_CONFIG.BACKSPACE_ENABLED) return;

            const activeElement = document.activeElement;
            const isContentEditable = activeElement && activeElement.isContentEditable;
            const inputTypes = ['INPUT', 'TEXTAREA', 'SELECT'];
            const isInputField = activeElement && inputTypes.includes(activeElement.tagName);

            if (e.keyCode === 8 && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
                if (!isContentEditable && !isInputField) {
                    e.preventDefault();
                    e.stopPropagation();
                    triggerParentNavigation();
                }
            }
        }

        function addDebugStyles() {
            const style = document.createElement('style');
            style.textContent = `
                @media (hover: none) {
                    body:after {
                        content: '';
                        position: fixed;
                        top: ${GESTURE_CONFIG.ACTIVATION_ZONE.TOP * 100}%;
                        bottom: ${(1 - GESTURE_CONFIG.ACTIVATION_ZONE.BOTTOM) * 100}%;
                        left: 0;
                        right: 0;
                        pointer-events: none;
                        z-index: 9999;
                        background: rgba(0,150,255,0.05);
                        display: none;
                    }
                    body.debug-gesture:after {
                        display: block;
                    }
                }
            `;
            document.head.appendChild(style);
        }

        function init() {
            if (!ENABLE_GESTURE_NAVIGATION) return;

            try {
                document.addEventListener('touchstart', handleTouchStart, { passive: true });
                document.addEventListener('touchend', handleTouchEnd, { passive: true });

                if (GESTURE_CONFIG.BACKSPACE_ENABLED) {
                    document.addEventListener('keydown', handleKeyDown, true);
                }

                addDebugStyles();
            } catch (e) {
                console.error('Gesture navigation initialization failed:', e);
            }
        }

        return {
            init: init
        };
    })();

    // ============================================================
    //  Public API
    // ============================================================
    const CombinedPluginAPI = {
        isScrollEnabled: function() { return ENABLE_SCROLL_REMEMBER; },
        isGestureEnabled: function() { return ENABLE_GESTURE_NAVIGATION; },

        scroll: {
            save: saveScroll,
            restore: restoreScroll
        },

        gesture: {
            triggerParent: function() {
                if (ENABLE_GESTURE_NAVIGATION) {
                    const event = new CustomEvent('gesture-navigate');
                    document.dispatchEvent(event);
                }
            }
        }
    };

    // ============================================================
    //  Initialization
    // ============================================================
    function init() {
        initScrollModule();
        GestureModule.init();

        if (typeof window !== 'undefined') {
            window.__CombinedPlugin = CombinedPluginAPI;
        }

        console.log('[Navigation Optimizer] Initialized:',
            'Scroll=' + (ENABLE_SCROLL_REMEMBER ? 'ON' : 'OFF'),
            'Gesture=' + (ENABLE_GESTURE_NAVIGATION ? 'ON' : 'OFF')
        );
    }

    if (document.readyState === 'complete') {
        init();
    } else {
        window.addEventListener('load', init);
        document.addEventListener('DOMContentLoaded', init);
    }
}