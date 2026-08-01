'use strict';

{
    // ============================================================
    // 配置部分 - 从 HFS 读取
    // ============================================================

    const config = typeof HFS !== 'undefined' && HFS.pluginConfig
        ? HFS.pluginConfig
        : {};

    // 所有功能默认开启，无需配置开关
    const EXPIRE_MINUTES = config.expireMinutes ?? 10;
    const EXPIRE = EXPIRE_MINUTES === 0
        ? Infinity
        : EXPIRE_MINUTES * 60 * 1000;

    // 固定参数
    const MAX_RETRIES = 8;
    const RETRY_INTERVAL = 100;
    const RESTORE_DELAY = 80;
    const URI_WATCH_INTERVAL = 200;

    // 手势导航参数
    const GESTURE_CONFIG = {
        MIN_SWIPE_DISTANCE: 90,
        MAX_VERTICAL_DEVIATION: 50,
        ACTIVATION_ZONE: {
            TOP: 0.25,
            BOTTOM: 0.75
        },
        COOLDOWN: 300
    };

    const STORAGE_KEY = "hfs-folder-scroll";
    const META_KEY = "hfs-folder-scroll-meta";

    let lastGestureTime = 0;
    let touchStartPoint = null;

    // ============================================================
    // 存储操作
    // ============================================================

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

    function saveToSessionStorage(data) {
        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch {
            // 静默失败
        }
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

    function setScrollY(y) {
        window.scrollTo({
            top: y,
            behavior: "instant"
        });

        if (document.documentElement) {
            document.documentElement.scrollTop = y;
        }
        if (document.body) {
            document.body.scrollTop = y;
        }

        setTimeout(function() {
            window.scrollTo({
                top: y,
                behavior: "instant"
            });
        }, 10);
    }

    // ============================================================
    // 滚动记忆核心功能
    // ============================================================

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
            saveToSessionStorage(data);
        }

        meta.lastClean = today;
        saveMeta(meta);
    }

    function saveScroll() {
        const data = loadData();
        const path = currentPath();
        const scrollData = {
            y: getScrollY(),
            time: Date.now()
        };
        data[path] = scrollData;
        saveData(data);
        saveToSessionStorage(data);
    }

    function restoreScroll() {
        cleanExpired();

        const data = loadData();
        const info = data[currentPath()];

        if (!info || typeof info.y !== 'number' || info.y < 0) {
            setScrollY(0);
            return;
        }

        let retry = 0;

        function restore() {
            setScrollY(info.y);
            retry++;
            if (retry < MAX_RETRIES)
                setTimeout(restore, RETRY_INTERVAL);
        }

        setTimeout(restore, RESTORE_DELAY);

        if (window.requestAnimationFrame) {
            requestAnimationFrame(function() {
                setTimeout(function() {
                    setScrollY(info.y);
                }, 50);
            });
        }
    }

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

    // ============================================================
    // 手势导航功能
    // ============================================================

    function encodePath(str) {
        if (typeof HFS !== 'undefined' && HFS.api && HFS.api.urlencode) {
            return HFS.api.urlencode(str);
        }
        return encodeURIComponent(str);
    }

    function decodePath(str) {
        if (typeof HFS !== 'undefined' && HFS.api && HFS.api.urldecode) {
            return HFS.api.urldecode(str);
        }
        return decodeURIComponent(str);
    }

    function getParentDirectory(currentPath) {
        try {
            let normalizedPath = currentPath.replace(/\\/g, '/');
            normalizedPath = normalizedPath.replace(/\/+/g, '/');

            let decodedPath = decodePath(normalizedPath);
            let pathParts = decodedPath.split('/').filter(part => part !== '');

            if (pathParts.length <= 1) {
                return '/';
            }

            pathParts.pop();
            let parentPath = '/' + pathParts.join('/');
            if (!parentPath.endsWith('/')) {
                parentPath += '/';
            }

            return encodePath(parentPath);
        } catch (error) {
            return currentPath;
        }
    }

    function processNavigationURL(urlString) {
        try {
            if (!urlString || urlString.startsWith('#') || urlString.startsWith('javascript:')) {
                return urlString;
            }

            const url = new URL(urlString, window.location.href);
            const parentPath = getParentDirectory(url.pathname);
            url.pathname = parentPath;

            return url.toString();
        } catch (e) {
            return urlString;
        }
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

    function triggerParentNavigation() {
        const now = Date.now();
        if (now - lastGestureTime < GESTURE_CONFIG.COOLDOWN) return;
        lastGestureTime = now;

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

        const parentBtn = getParentButton();
        if (!parentBtn) {
            return;
        }

        try {
            const originalHref = parentBtn.href ||
                parentBtn.getAttribute('data-href') ||
                parentBtn.getAttribute('onclick')?.match(/'(.*?)'|"(.*?)"/)?.[1] ||
                '#';

            const processedURL = processNavigationURL(originalHref);

            saveScroll();

            if (parentBtn.tagName === 'A') {
                if (processedURL !== originalHref) {
                    parentBtn.href = processedURL;
                }
                parentBtn.click();
            } else if (parentBtn.onclick) {
                parentBtn.onclick(new Event('click'));
            } else if (typeof parentBtn.click === 'function') {
                parentBtn.click();
            } else {
                window.location.href = processedURL;
            }
        } catch (e) {
            const currentPath = window.location.pathname;
            const parentPath = getParentDirectory(currentPath);
            window.location.href = parentPath;
        }
    }

    // ============================================================
    // 滑动手势事件
    // ============================================================

    function handleTouchStart(e) {
        if (e.touches.length === 1) {
            touchStartPoint = {
                x: e.touches[0].clientX,
                y: e.touches[0].clientY,
                time: Date.now()
            };
        }
    }

    function handleTouchEnd(e) {
        if (!touchStartPoint || e.changedTouches.length !== 1) return;

        const endPoint = {
            x: e.changedTouches[0].clientX,
            y: e.changedTouches[0].clientY
        };

        const height = window.innerHeight;
        const inZone = touchStartPoint.y >= height * GESTURE_CONFIG.ACTIVATION_ZONE.TOP &&
            touchStartPoint.y <= height * GESTURE_CONFIG.ACTIVATION_ZONE.BOTTOM;

        const dx = endPoint.x - touchStartPoint.x;
        const dy = endPoint.y - touchStartPoint.y;
        const isSwipe = Math.abs(dx) >= GESTURE_CONFIG.MIN_SWIPE_DISTANCE &&
            Math.abs(dy) <= GESTURE_CONFIG.MAX_VERTICAL_DEVIATION;

        if (inZone && isSwipe) {
            triggerParentNavigation();
        }

        touchStartPoint = null;
    }

    function installSwipeGesture() {
        try {
            document.addEventListener('touchstart', handleTouchStart, { passive: true });
            document.addEventListener('touchend', handleTouchEnd, { passive: true });

            const style = document.createElement('style');
            style.textContent = `
                @media (hover: none) {
                    body.debug-gesture:after {
                        content: '';
                        position: fixed;
                        top: ${GESTURE_CONFIG.ACTIVATION_ZONE.TOP * 100}%;
                        bottom: ${(1 - GESTURE_CONFIG.ACTIVATION_ZONE.BOTTOM) * 100}%;
                        left: 0;
                        right: 0;
                        pointer-events: none;
                        z-index: 9999;
                        background: rgba(0,150,255,0.05);
                        display: block;
                    }
                }
            `;
            document.head.appendChild(style);
        } catch (e) {
            // 静默失败
        }
    }

    // ============================================================
    // Backspace 键盘事件
    // ============================================================

    function handleKeyDown(e) {
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

    function installBackspaceNavigation() {
        try {
            document.addEventListener('keydown', handleKeyDown, true);
        } catch (e) {
            // 静默失败
        }
    }

    // ============================================================
    // 事件安装
    // ============================================================

    function installFolderClickListener() {
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
        window.addEventListener("popstate", function() {
            setTimeout(function() {
                restoreScroll();
            }, 100);
        });
    }

    function installUriWatcher() {
        let last = currentPath();

        setInterval(function() {
            const now = currentPath();

            if (now !== last) {
                last = now;
                setTimeout(function() {
                    restoreScroll();
                }, 120);
            }
        }, URI_WATCH_INTERVAL);
    }

    // ============================================================
    // 初始化
    // ============================================================

    installDailyCleaner();

    document.addEventListener("visibilitychange", function() {
        if (!document.hidden) {
            setTimeout(function() {
                restoreScroll();
            }, 200);
        }
    });

    window.addEventListener("pageshow", function(e) {
        if (e.persisted) {
            setTimeout(function() {
                restoreScroll();
            }, 150);
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
    installSwipeGesture();
    installBackspaceNavigation();

    setTimeout(restoreScroll, 300);

    if (document.readyState === 'complete') {
        setTimeout(restoreScroll, 500);
    } else {
        window.addEventListener('load', function() {
            setTimeout(restoreScroll, 400);
        });
    }
}