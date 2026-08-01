'use strict';

{
    // ============================================================
    //  插件命名空间 - 避免与第三方插件冲突
    // ============================================================
    const ScrollPlugin = {};

    const config = typeof HFS !== 'undefined' && HFS.pluginConfig
        ? HFS.pluginConfig
        : {};

    // 从配置读取参数，如果没有则使用默认值
    const EXPIRE_MINUTES = config.expireMinutes ?? 10;
    const EXPIRE = EXPIRE_MINUTES === 0
        ? Infinity
        : EXPIRE_MINUTES * 60 * 1000;

    const MAX_RETRIES = config.maxRetries ?? 8;
    const RETRY_INTERVAL = config.retryInterval ?? 100;
    const RESTORE_DELAY = 80;
    const URI_WATCH_INTERVAL = 200;

    const STORAGE_KEY = "hfs-folder-scroll";
    const META_KEY = "hfs-folder-scroll-meta";

    // ============================================================
    //  播放器状态管理 - 检测视频播放器是否打开
    // ============================================================
    const PlayerState = {
        _isOpen: false,
        _scrollY: 0,
        _path: '',

        // 检测播放器是否打开
        isOpen() {
            // 检测 .showing-container 是否存在且可见
            const showingContainer = document.querySelector('.showing-container');
            if (showingContainer && showingContainer.offsetParent !== null) {
                return true;
            }

            // 检测 video-js 播放器是否存在
            const videoPlayer = document.querySelector('.video-js');
            if (videoPlayer && videoPlayer.offsetParent !== null) {
                return true;
            }

            // 检测是否有模态框/弹窗包含视频
            const modals = document.querySelectorAll('.dialog-backdrop.file-show, .modal.in, .v-dialog');
            for (const modal of modals) {
                if (modal.offsetParent !== null) {
                    const video = modal.querySelector('video, .video-js');
                    if (video) return true;
                }
            }

            return false;
        },

        // 更新状态
        update() {
            const wasOpen = this._isOpen;
            this._isOpen = this.isOpen();

            // 播放器刚关闭时，不要立即恢复滚动（等待用户交互）
            if (wasOpen && !this._isOpen) {
                // 标记播放器已关闭，但不自动恢复滚动
                this._justClosed = true;
                setTimeout(() => {
                    this._justClosed = false;
                }, 500);
            }

            return this._isOpen;
        },

        // 是否应该阻止滚动恢复
        shouldBlockRestore() {
            return this._isOpen || this._justClosed;
        },

        // 是否应该阻止保存滚动
        shouldBlockSave() {
            return this._isOpen;
        },

        // 获取当前状态
        get isOpen() {
            return this._isOpen;
        }
    };

    // ============================================================
    //  数据存储函数
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

        setTimeout(function () {
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

    function saveScroll() {
        // 如果播放器打开，不保存滚动位置
        if (PlayerState.shouldBlockSave()) {
            return;
        }

        const data = loadData();
        data[currentPath()] = {
            y: getScrollY(),
            time: Date.now()
        };
        saveData(data);
    }

    function restoreScroll() {
        // 如果播放器打开或刚刚关闭，不恢复滚动位置
        if (PlayerState.shouldBlockRestore()) {
            return;
        }

        cleanExpired();

        const data = loadData();
        const info = data[currentPath()];

        if (!info || typeof info.y !== 'number' || info.y < 0) {
            setScrollY(0);
            return;
        }

        let retry = 0;

        function restore() {
            // 恢复过程中如果播放器打开，停止恢复
            if (PlayerState.shouldBlockRestore()) {
                return;
            }
            setScrollY(info.y);
            retry++;
            if (retry < MAX_RETRIES)
                setTimeout(restore, RETRY_INTERVAL);
        }

        setTimeout(restore, RESTORE_DELAY);

        if (window.requestAnimationFrame) {
            requestAnimationFrame(function () {
                setTimeout(function () {
                    if (!PlayerState.shouldBlockRestore()) {
                        setScrollY(info.y);
                    }
                }, 50);
            });
        }
    }

    function installDailyCleaner() {
        if (EXPIRE === Infinity) return;

        cleanExpired();

        setInterval(function () {
            const meta = loadMeta();
            const today = getTodayStr();
            if (meta.lastClean !== today) {
                cleanExpired();
            }
        }, 60000);
    }

    // ============================================================
    //  事件监听器 - 使用命名空间避免冲突
    // ============================================================

    function installFolderClickListener() {
        document.addEventListener("click", function (e) {
            // 如果播放器打开，不保存滚动
            if (PlayerState.shouldBlockSave()) {
                return;
            }

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
        window.addEventListener("popstate", function () {
            setTimeout(function () {
                restoreScroll();
            }, 100);
        });
    }

    function installUriWatcher() {
        let last = currentPath();

        setInterval(function () {
            const now = currentPath();

            if (now !== last) {
                last = now;
                setTimeout(function () {
                    restoreScroll();
                }, 120);
            }
        }, URI_WATCH_INTERVAL);
    }

    // ============================================================
    //  播放器状态监听
    // ============================================================

    function installPlayerStateWatcher() {
        // 定期检测播放器状态
        setInterval(function () {
            PlayerState.update();
        }, 200);

        // 检测 DOM 变化（播放器可能通过 JS 动态添加）
        if (window.MutationObserver) {
            const observer = new MutationObserver(function () {
                PlayerState.update();
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class', 'style', 'hidden']
            });
        }

        // 监听全屏变化
        document.addEventListener('fullscreenchange', function () {
            setTimeout(function () {
                PlayerState.update();
            }, 100);
        });

        document.addEventListener('webkitfullscreenchange', function () {
            setTimeout(function () {
                PlayerState.update();
            }, 100);
        });
    }

    // ============================================================
    //  初始化
    // ============================================================

    // 初始化播放器状态
    PlayerState.update();

    // 安装播放器状态监听
    installPlayerStateWatcher();

    // 每日清理
    installDailyCleaner();

    // 页面可见性变化
    document.addEventListener("visibilitychange", function () {
        if (!document.hidden) {
            setTimeout(function () {
                restoreScroll();
            }, 200);
        }
    });

    // 页面显示（从 bfcache 恢复）
    window.addEventListener("pageshow", function (e) {
        if (e.persisted) {
            setTimeout(function () {
                restoreScroll();
            }, 150);
        }
    });

    // 页面卸载前保存
    window.addEventListener("beforeunload", function () {
        saveScroll();
    });

    window.addEventListener("pagehide", function () {
        saveScroll();
    });

    // 安装事件监听
    installFolderClickListener();
    installBackForwardListener();
    installUriWatcher();

    // 初始恢复
    setTimeout(restoreScroll, 300);

    if (document.readyState === 'complete') {
        setTimeout(restoreScroll, 500);
    } else {
        window.addEventListener('load', function () {
            setTimeout(restoreScroll, 400);
        });
    }

    // ============================================================
    //  导出到全局（供调试使用）
    // ============================================================
    ScrollPlugin.PlayerState = PlayerState;
    ScrollPlugin.saveScroll = saveScroll;
    ScrollPlugin.restoreScroll = restoreScroll;

    // 挂载到 window 方便调试，但使用独特命名避免冲突
    if (typeof window !== 'undefined') {
        window.__ScrollPlugin = ScrollPlugin;
    }
}