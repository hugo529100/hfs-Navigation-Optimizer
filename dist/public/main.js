'use strict';

{
    // ============================================================
    //  配置加载
    // ============================================================
    const config = typeof HFS !== 'undefined' && HFS.pluginConfig
        ? HFS.pluginConfig
        : {};

    const EXPIRE_MINUTES = config.expireMinutes ?? 10;
    const EXPIRE = EXPIRE_MINUTES === 0
        ? Infinity
        : EXPIRE_MINUTES * 60 * 1000;

    // 文件数量阈值：少于这个数量的文件不记录滚动位置
    // 没有记录 = 返回顶部（默认行为）
    const MIN_FILES_THRESHOLD = config.minFilesThreshold ?? 50;

    // ============================================================
    //  内置重试参数
    // ============================================================
    const MAX_RETRIES = 8;
    const RETRY_INTERVAL = 100;
    const RESTORE_DELAY = 80;
    const URI_WATCH_INTERVAL = 200;
    const CACHE_DURATION = 10000;

    const STORAGE_KEY = "hfs-folder-scroll";
    const META_KEY = "hfs-folder-scroll-meta";

    // ============================================================
    //  文件数量检测 - 通过 HFS API（文件和文件夹都计数）
    // ============================================================
    const fileCountCache = {};

    async function getFileCount(path) {
        try {
            const pathWithoutQuery = path.split('?')[0];
            
            const now = Date.now();
            if (fileCountCache[pathWithoutQuery] && 
                (now - fileCountCache[pathWithoutQuery].time) < CACHE_DURATION) {
                return fileCountCache[pathWithoutQuery].count;
            }

            const apiUrl = '/~/api/get_file_list?uri=' + encodeURIComponent(pathWithoutQuery);
            
            const response = await fetch(apiUrl, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                return null;
            }

            const data = await response.json();
            
            if (!data || !data.list || !Array.isArray(data.list)) {
                return null;
            }

            // 文件和文件夹都计数（list 中所有项都算）
            const count = data.list.length;

            fileCountCache[pathWithoutQuery] = {
                count: count,
                time: now
            };

            return count;
        } catch (error) {
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

    // 判断是否应该跳过保存滚动位置
    function shouldSkipSaveSync(path) {
        const count = getCachedFileCount(path);
        if (count === null) {
            // 没有缓存时，保守处理：不跳过（允许保存）
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
        
        // 文件数量少于阈值 → 不保存
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

    async function restoreScroll() {
        const path = currentPath();
        
        cleanExpired();

        const data = loadData();
        const info = data[path];

        // 没有记录 → 返回顶部（默认行为）
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

    function restoreScrollSync() {
        const path = currentPath();
        
        cleanExpired();

        const data = loadData();
        const info = data[path];

        // 没有记录 → 返回顶部（默认行为）
        if (!info || typeof info.y !== 'number' || info.y < 0) {
            setScrollY(0);
            return;
        }

        setScrollY(info.y);
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
            }, 100);
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
                }, 120);
            }
        }, URI_WATCH_INTERVAL);
    }

    // ============================================================
    //  暴露给第三方插件的接口
    // ============================================================

    const ScrollPluginAPI = {
        // 判断路径是否应该跳过保存
        shouldSkipSave: function(path) {
            return shouldSkipSaveSync(path);
        },
        shouldSkipSaveAsync: async function(path) {
            return await shouldSkipSave(path);
        },
        // 保存当前滚动（同步/异步）
        saveScrollSync: saveScrollSync,
        saveScroll: saveScroll,
        // 恢复滚动（同步/异步）
        restoreScrollSync: restoreScrollSync,
        restoreScroll: restoreScroll,
        // 工具方法
        getFileCount: getFileCount,
        getThreshold: function() {
            return MIN_FILES_THRESHOLD;
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
            }, 200);
        }
    });

    window.addEventListener("pageshow", function(e) {
        if (e.persisted) {
            setTimeout(function() {
                restoreScrollSync();
            }, 150);
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

    setTimeout(restoreScrollSync, 300);

    if (document.readyState === 'complete') {
        setTimeout(restoreScrollSync, 500);
    } else {
        window.addEventListener('load', function() {
            setTimeout(restoreScrollSync, 400);
        });
    }

    if (typeof window !== 'undefined') {
        window.__ScrollPlugin = ScrollPluginAPI;
    }
}