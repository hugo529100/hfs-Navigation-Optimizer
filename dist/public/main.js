'use strict';

{
    // ============================================================
    //  配置加载
    // ============================================================
    const config = typeof HFS !== 'undefined' && HFS.pluginConfig
        ? HFS.pluginConfig
        : {};

    const EXPIRE_MINUTES = config.expireMinutes ?? 1440;
    const EXPIRE = EXPIRE_MINUTES === 0
        ? Infinity
        : EXPIRE_MINUTES * 60 * 1000;

    const MIN_FILES_THRESHOLD = config.minFilesThreshold ?? 25;

    // ============================================================
    //  内置参数
    // ============================================================
    const MAX_RETRIES = 8;
    const RETRY_INTERVAL = 150;
    const RESTORE_DELAY = 100;
    const URI_WATCH_INTERVAL = 300;
    const CACHE_DURATION = 10000;

    const STORAGE_KEY = "hfs-folder-scroll";
    const META_KEY = "hfs-folder-scroll-meta";

    // ============================================================
    //  状态管理
    // ============================================================
    let restorePending = false;
    let restoreTarget = null;
    let scrollTimeout = null;
    let lastSetScrollY = -1;
    let isRestoring = false;

    // ============================================================
    //  等待内容稳定
    // ============================================================
    function waitForContentStable(callback, maxWait = 3000) {
        let attempts = 0;
        let lastHeight = 0;
        let stableCount = 0;
        const CHECK_INTERVAL = 100;
        const STABLE_THRESHOLD = 3;

        function check() {
            attempts++;
            const currentHeight = document.documentElement.scrollHeight;
            
            const listWrapper = document.querySelector('.list-wrapper');
            const fileItems = document.querySelectorAll('.file-entry, .folder-entry, [role="row"], .list-item, .entry');
            
            if (currentHeight === lastHeight && lastHeight > 100) {
                stableCount++;
            } else {
                stableCount = 0;
                lastHeight = currentHeight;
            }

            const hasContent = listWrapper !== null || fileItems.length > 0;
            const isStable = stableCount >= STABLE_THRESHOLD;
            const isTimeout = attempts * CHECK_INTERVAL >= maxWait;

            if ((isStable && hasContent) || isTimeout) {
                callback();
                return;
            }

            setTimeout(check, CHECK_INTERVAL);
        }

        setTimeout(check, 50);
    }

    // ============================================================
    //  文件数量检测
    // ============================================================
    const fileCountCache = {};
    const fileCountFetching = {};

    async function getFileCount(path) {
        try {
            const pathWithoutQuery = path.split('?')[0];
            
            const now = Date.now();
            if (fileCountCache[pathWithoutQuery] && 
                (now - fileCountCache[pathWithoutQuery].time) < CACHE_DURATION) {
                return fileCountCache[pathWithoutQuery].count;
            }

            if (fileCountFetching[pathWithoutQuery]) {
                return new Promise((resolve) => {
                    const checkCache = setInterval(() => {
                        if (fileCountCache[pathWithoutQuery]) {
                            clearInterval(checkCache);
                            resolve(fileCountCache[pathWithoutQuery].count);
                        }
                    }, 50);
                    setTimeout(() => {
                        clearInterval(checkCache);
                        resolve(null);
                    }, 5000);
                });
            }

            fileCountFetching[pathWithoutQuery] = true;

            const apiUrl = '/~/api/get_file_list?uri=' + encodeURIComponent(pathWithoutQuery);
            
            const response = await fetch(apiUrl, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                fileCountFetching[pathWithoutQuery] = false;
                return null;
            }

            const data = await response.json();
            
            if (!data || !data.list || !Array.isArray(data.list)) {
                fileCountFetching[pathWithoutQuery] = false;
                return null;
            }

            const count = data.list.length;

            fileCountCache[pathWithoutQuery] = {
                count: count,
                time: now
            };

            fileCountFetching[pathWithoutQuery] = false;
            return count;
        } catch (error) {
            fileCountFetching[pathWithoutQuery] = false;
            return null;
        }
    }

    function getCachedFileCount(path) {
        const pathWithoutQuery = path.split('?')[0];
        const cached = fileCountCache[pathWithoutQuery];
        if (cached && (Date.now() - cached.time) < CACHE_DURATION) {
            return cached.count;
        }
        return null;
    }

    function shouldSkipSaveSync(path) {
        const count = getCachedFileCount(path);
        if (count === null) {
            return false;
        }
        return count < MIN_FILES_THRESHOLD;
    }

    async function shouldSkipSave(path) {
        const count = await getFileCount(path);
        if (count === null) {
            return false;
        }
        return count < MIN_FILES_THRESHOLD;
    }

    // ============================================================
    //  数据存储函数
    // ============================================================

    function loadData() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return {};
            return JSON.parse(raw);
        }
        catch {
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
        }
        catch {
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

    // ============================================================
    //  setScrollY 防抖
    // ============================================================

    function setScrollY(y) {
        const targetY = Math.max(0, y);
        
        if (Math.abs(lastSetScrollY - targetY) < 2) {
            return;
        }
        lastSetScrollY = targetY;

        if (scrollTimeout) {
            clearTimeout(scrollTimeout);
        }

        doSetScrollY(targetY);

        scrollTimeout = setTimeout(() => {
            doSetScrollY(targetY);
            scrollTimeout = null;
        }, 80);
    }

    function doSetScrollY(y) {
        const targetY = Math.max(0, y);
        
        window.scrollTo({
            top: targetY,
            behavior: "instant"
        });

        if (document.documentElement) {
            document.documentElement.scrollTop = targetY;
        }
        if (document.body) {
            document.body.scrollTop = targetY;
        }
    }

    // ============================================================
    //  核心功能
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
        }

        meta.lastClean = today;
        saveMeta(meta);
    }

    async function saveScroll() {
        const path = currentPath();
        
        const skip = await shouldSkipSave(path);
        if (skip) {
            return;
        }

        const data = loadData();
        data[path] = {
            y: getScrollY(),
            time: Date.now()
        };
        saveData(data);
    }

    function saveScrollSync() {
        const path = currentPath();
        
        if (shouldSkipSaveSync(path)) {
            return;
        }

        const data = loadData();
        data[path] = {
            y: getScrollY(),
            time: Date.now()
        };
        saveData(data);
    }

    // ============================================================
    //  恢复滚动（带内容稳定等待）
    // ============================================================

    function restoreScrollSync() {
        const path = currentPath();
        
        if (isRestoring) {
            return;
        }

        cleanExpired();

        const data = loadData();
        const info = data[path];

        if (!info || typeof info.y !== 'number' || info.y < 0) {
            setScrollY(0);
            return;
        }

        isRestoring = true;

        waitForContentStable(() => {
            const currentPathNow = currentPath();
            if (currentPathNow !== path) {
                isRestoring = false;
                return;
            }

            const dataNow = loadData();
            const infoNow = dataNow[path];
            if (!infoNow || typeof infoNow.y !== 'number' || infoNow.y < 0) {
                isRestoring = false;
                return;
            }

            setScrollY(infoNow.y);

            let retry = 0;
            function retryRestore() {
                if (retry >= MAX_RETRIES) {
                    isRestoring = false;
                    return;
                }
                if (currentPath() !== path) {
                    isRestoring = false;
                    return;
                }
                const dataRetry = loadData();
                const infoRetry = dataRetry[path];
                if (infoRetry && typeof infoRetry.y === 'number' && infoRetry.y >= 0) {
                    setScrollY(infoRetry.y);
                }
                retry++;
                setTimeout(retryRestore, RETRY_INTERVAL);
            }

            setTimeout(retryRestore, RESTORE_DELAY);

            if (window.requestAnimationFrame) {
                requestAnimationFrame(function() {
                    setTimeout(function() {
                        if (currentPath() === path) {
                            const dataRaf = loadData();
                            const infoRaf = dataRaf[path];
                            if (infoRaf && typeof infoRaf.y === 'number' && infoRaf.y >= 0) {
                                setScrollY(infoRaf.y);
                            }
                        }
                    }, 80);
                });
            }

            setTimeout(() => {
                isRestoring = false;
            }, 600);
        }, 3500);
    }

    async function restoreScroll() {
        const path = currentPath();
        
        if (isRestoring) {
            return;
        }

        cleanExpired();

        const data = loadData();
        const info = data[path];

        if (!info || typeof info.y !== 'number' || info.y < 0) {
            setScrollY(0);
            return;
        }

        isRestoring = true;

        await new Promise((resolve) => {
            waitForContentStable(() => {
                resolve();
            }, 3500);
        });

        if (currentPath() !== path) {
            isRestoring = false;
            return;
        }

        const dataNow = loadData();
        const infoNow = dataNow[path];
        if (!infoNow || typeof infoNow.y !== 'number' || infoNow.y < 0) {
            isRestoring = false;
            return;
        }

        setScrollY(infoNow.y);

        let retry = 0;
        function retryRestore() {
            if (retry >= MAX_RETRIES) {
                isRestoring = false;
                return;
            }
            if (currentPath() !== path) {
                isRestoring = false;
                return;
            }
            const dataRetry = loadData();
            const infoRetry = dataRetry[path];
            if (infoRetry && typeof infoRetry.y === 'number' && infoRetry.y >= 0) {
                setScrollY(infoRetry.y);
            }
            retry++;
            setTimeout(retryRestore, RETRY_INTERVAL);
        }

        setTimeout(retryRestore, RESTORE_DELAY);

        if (window.requestAnimationFrame) {
            requestAnimationFrame(function() {
                setTimeout(function() {
                    if (currentPath() === path) {
                        const dataRaf = loadData();
                        const infoRaf = dataRaf[path];
                        if (infoRaf && typeof infoRaf.y === 'number' && infoRaf.y >= 0) {
                            setScrollY(infoRaf.y);
                        }
                    }
                }, 80);
            });
        }

        setTimeout(() => {
            isRestoring = false;
        }, 600);
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
    //  预加载文件数量
    // ============================================================

    function preloadFileCount() {
        const path = currentPath();
        getFileCount(path).catch(() => {});
    }

    // ============================================================
    //  事件监听
    // ============================================================

    function installFolderClickListener() {
        document.addEventListener("click", function(e) {
            const a = e.target.closest("a");
            if (!a) return;

            const href = a.getAttribute("href");
            if (!href) return;
            if (href.includes("?dl")) return;
            if (href.includes(".") && !href.endsWith("/")) return;

            saveScrollSync();
        }, true);
    }

    function installBackForwardListener() {
        window.addEventListener("popstate", function() {
            setTimeout(function() {
                restoreScrollSync();
            }, 150);
        });
    }

    function installUriWatcher() {
        let last = currentPath();

        setInterval(function() {
            const now = currentPath();

            if (now !== last) {
                last = now;
                preloadFileCount();
                setTimeout(function() {
                    restoreScrollSync();
                }, 200);
            }
        }, URI_WATCH_INTERVAL);
    }

    // ============================================================
    //  暴露给第三方插件的接口
    // ============================================================

    const ScrollPluginAPI = {
        shouldSkipSave: function(path) {
            return shouldSkipSaveSync(path);
        },
        shouldSkipSaveAsync: async function(path) {
            return await shouldSkipSave(path);
        },
        saveScrollSync: saveScrollSync,
        saveScroll: saveScroll,
        restoreScrollSync: restoreScrollSync,
        restoreScroll: restoreScroll,
        getFileCount: getFileCount,
        getThreshold: function() {
            return MIN_FILES_THRESHOLD;
        },
        isRestoring: function() {
            return isRestoring;
        }
    };

    // ============================================================
    //  初始化
    // ============================================================

    preloadFileCount();

    installDailyCleaner();

    document.addEventListener("visibilitychange", function() {
        if (!document.hidden) {
            setTimeout(function() {
                restoreScrollSync();
            }, 300);
        }
    });

    window.addEventListener("pageshow", function(e) {
        if (e.persisted) {
            setTimeout(function() {
                restoreScrollSync();
            }, 200);
        }
    });

    window.addEventListener("beforeunload", function() {
        saveScrollSync();
    });

    window.addEventListener("pagehide", function() {
        saveScrollSync();
    });

    installFolderClickListener();
    installBackForwardListener();
    installUriWatcher();

    setTimeout(restoreScrollSync, 400);

    if (document.readyState === 'complete') {
        setTimeout(restoreScrollSync, 600);
    } else {
        window.addEventListener('load', function() {
            setTimeout(restoreScrollSync, 500);
        });
    }

    if (typeof window !== 'undefined') {
        window.__ScrollPlugin = ScrollPluginAPI;
    }
}