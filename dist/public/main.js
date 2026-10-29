'use strict';

{
    // ============================================================
    //  Config Loading
    // ============================================================
    // 兼容多种 HFS 版本：优先 getPluginConfig()，其次 HFS.pluginConfig，
    // 最后退到空对象。避免后端关闭后前端仍按默认 true 启用。
    function readPluginConfig() {
        try {
            if (typeof window !== 'undefined' &&
                window.HFS &&
                typeof window.HFS.getPluginConfig === 'function') {
                const c = window.HFS.getPluginConfig();
                if (c && typeof c === 'object') return c;
            }
        } catch (e) { }
        try {
            if (typeof window !== 'undefined' &&
                window.HFS &&
                window.HFS.pluginConfig &&
                typeof window.HFS.pluginConfig === 'object') {
                return window.HFS.pluginConfig;
            }
        } catch (e) { }
        return {};
    }

    const config = readPluginConfig();

    function configBool(v, defaultValue) {
        if (v === false || v === 'false' || v === 0 || v === '0') return false;
        if (v === true || v === 'true' || v === 1 || v === '1') return true;
        return defaultValue;
    }

    const ENABLE_SCROLL_REMEMBER = configBool(config.enableScrollRemember, true);
    const ENABLE_GESTURE_NAVIGATION = configBool(config.enableGestureNavigation, true);

    // 從小時轉換為毫秒
    const EXPIRE_HOURS = (function () {
        const v = config.expireHours;
        if (v === undefined || v === null || v === '') return 24;
        const n = Number(v);
        return isNaN(n) ? 24 : n;
    })();
    const EXPIRE = EXPIRE_HOURS === 0
        ? Infinity
        : EXPIRE_HOURS * 60 * 60 * 1000;

    // ============================================================
    //  Options 界面：滾動記憶前端開關（默認開啟）
    // ============================================================
    const STORAGE_KEY_SCROLL_UI = 'hfs_scroll_remember_ui_enabled';
    const TOGGLE_ID = 'scroll-remember-toggle';

    function isLocalStorageSupported() {
        try {
            localStorage.setItem('__t', '1');
            localStorage.removeItem('__t');
            return true;
        } catch (e) {
            return false;
        }
    }

    function getScrollUiEnabled() {
        if (!isLocalStorageSupported()) return true;
        const val = localStorage.getItem(STORAGE_KEY_SCROLL_UI);
        return val === null ? true : val === 'true';   // 默認開啟
    }

    function setScrollUiEnabled(value) {
        if (isLocalStorageSupported()) {
            localStorage.setItem(STORAGE_KEY_SCROLL_UI, value ? 'true' : 'false');
        }
    }

    // 綜合判斷：服務器配置啟用 且 前端開關開啟
    function isScrollRememberActive() {
        return ENABLE_SCROLL_REMEMBER && getScrollUiEnabled();
    }

    // 向 Options 對話框注入開關
    function insertScrollToggle() {
        const optionsDialog = document.querySelector('.dialog[aria-modal="true"]');
        if (!optionsDialog || document.getElementById(TOGGLE_ID)) return;

        const themeSelect = document.getElementById('option-theme');
        if (!themeSelect) return;

        const toggleHTML = `
          <div id="${TOGGLE_ID}" style="display:block;margin-top:1em">
            <label style="display:block;cursor:pointer">
              <input type="checkbox" id="scroll-remember-checkbox">
              Remember Scroll Position
            </label>
          </div>
        `;
        themeSelect.insertAdjacentHTML('afterend', toggleHTML);

        const checkbox = document.getElementById('scroll-remember-checkbox');
        checkbox.checked = getScrollUiEnabled();
        checkbox.addEventListener('change', (e) => {
            setScrollUiEnabled(e.target.checked);
            if (typeof HFS.reloadList === 'function') HFS.reloadList();
        });
    }

    // 監聽 Options 對話框出現
    function initOptionsObserver() {
        const observer = new MutationObserver(() => {
            const title = document.querySelector('.dialog-title')?.textContent || '';
            if (title.includes('Options')) {
                setTimeout(insertScrollToggle, 100);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(initOptionsObserver, 500));
    } else {
        setTimeout(initOptionsObserver, 500);
    }

    // ============================================================
    //  Performance Detection Module
    // ============================================================
    const PerformanceDetector = {
        _isLowPerf: null,
        _tested: false,

        /**
         * 檢測設備是否為低性能
         * 使用多種指標綜合判斷
         */
        detect: function() {
            if (this._tested) return this._isLowPerf;

            let lowPerfScore = 0;
            const totalTests = 5;

            try {
                // 測試1: CPU 運算速度
                const start1 = performance.now();
                let sum = 0;
                for (let i = 0; i < 50000; i++) {
                    sum += Math.sqrt(i) * Math.sin(i);
                }
                const cpuTime = performance.now() - start1;
                if (cpuTime > 100) lowPerfScore++;
                if (cpuTime > 200) lowPerfScore++;

                // 測試2: 記憶體 / 設備類型檢測
                const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|Windows Phone|Opera Mini|IEMobile/i.test(navigator.userAgent);
                const isOldBrowser = /MSIE|Trident|Edge\/1[0-9]|Firefox\/[4-5][0-9]|Chrome\/[4-9][0-9]?[0-9]?/i.test(navigator.userAgent);
                if (isMobile) lowPerfScore++;
                if (isOldBrowser) lowPerfScore++;

                // 測試3: 硬體並行性
                const cores = navigator.hardwareConcurrency || 1;
                if (cores <= 2) lowPerfScore++;

                // 測試4: 記憶體限制
                if (navigator.deviceMemory && navigator.deviceMemory < 4) lowPerfScore++;

                // 測試5: 幀率測試 (簡單版)
                let frameTime = 0;
                const start2 = performance.now();
                requestAnimationFrame(function(timestamp) {
                    frameTime = timestamp - start2;
                    if (frameTime > 20) lowPerfScore++;
                });
                // 同步等待一幀
                const syncStart = performance.now();
                while (performance.now() - syncStart < 20) {
                    // 等待
                }
                // 如果上面的 requestAnimationFrame 還沒執行，用同步方式檢測
                if (frameTime === 0) {
                    // 用 setTimeout 檢測
                    const checkStart = performance.now();
                    setTimeout(function() {
                        const elapsed = performance.now() - checkStart;
                        if (elapsed > 30) lowPerfScore++;
                    }, 0);
                }

            } catch (e) {
                // 檢測失敗，保守判斷為低性能
                lowPerfScore = 3;
            }

            // 如果分數超過總測試的一半，判定為低性能
            this._isLowPerf = lowPerfScore >= (totalTests / 2);
            this._tested = true;

            return this._isLowPerf;
        },

        /**
         * 獲取檢測結果（快取）
         */
        isLowPerformance: function() {
            if (!this._tested) {
                this.detect();
            }
            return this._isLowPerf;
        },

        /**
         * 重置檢測（用於重新測試）
         */
        reset: function() {
            this._isLowPerf = null;
            this._tested = false;
        }
    };

    // ============================================================
    //  Performance-based Configuration
    // ============================================================
    const IS_LOW_PERFORMANCE = PerformanceDetector.isLowPerformance();

    // 根據性能調整配置
    const ENABLE_SMOOTH_SCROLL = configBool(config.enableSmoothScroll, true) && !IS_LOW_PERFORMANCE;
    const SCROLL_DURATION = IS_LOW_PERFORMANCE ? 200 : 800;
    const RESTORE_DELAY = IS_LOW_PERFORMANCE ? 30 : 80;
    const URI_WATCH_INTERVAL = IS_LOW_PERFORMANCE ? 500 : 200;
    const MAX_ANIMATION_FRAMES = IS_LOW_PERFORMANCE ? 30 : 120;

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
    const STORAGE_KEY = "hfs-folder-scroll";
    const META_KEY = "hfs-folder-scroll-meta";
    const MIN_ENTRIES_TO_SAVE = 9; // 最少条目数，少于这个值不保存滚动位置

    // ---- 狀態管理 ----
    let isRestoring = false;
    let restoreTimer = null;
    let isDialogOpen = false;
    let pendingRestoreTimers = [];
    let scrollSaveTimer = null;
    let animationFrameId = null;
    let isAnimating = false;

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

    // ---- 獲取頁面條目數量 ----
    function getEntryCount() {
        // 嘗試多種選擇器以兼容不同版本的HFS
        const selectors = [
            '.dir li',
            '.list li',
            '#files-list li',
            '[role="list"] li',
            '[role="listitem"]',
            '.entry'
        ];
        
        for (const selector of selectors) {
            const items = document.querySelectorAll(selector);
            if (items.length > 0) {
                return items.length;
            }
        }
        
        // 如果找不到條目容器，嘗試從文件列表容器中統計
        const containers = document.querySelectorAll('.dir, .list, #files-list, [role="list"]');
        for (const container of containers) {
            const items = container.querySelectorAll('li, .entry, [role="listitem"]');
            if (items.length > 0) {
                return items.length;
            }
        }
        
        return 0;
    }

    // ---- 檢查是否應該跳過（條目數量太少） ----
    function shouldSkipDueToFewEntries() {
        const entryCount = getEntryCount();
        return entryCount > 0 && entryCount < MIN_ENTRIES_TO_SAVE;
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
        
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
            isAnimating = false;
        }
        
        isRestoring = false;
    }

    // ---- 安全的 setTimeout（可追蹤） ----
    function scheduleRestore(delay) {
        // 檢查條目數量，少於 MIN_ENTRIES_TO_SAVE 個不排程恢復
        if (shouldSkipDueToFewEntries()) {
            return null;
        }

        if (isRestoring) {
            cancelAllPendingRestores();
        }
        
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

    // ---- 平滑滾動（優化版，支援低性能設備） ----
    function smoothSetScrollY(targetY) {
        updateDialogState();
        if (isDialogOpen) return;

        // 檢查條目數量，少於 MIN_ENTRIES_TO_SAVE 個不做任何動作
        if (shouldSkipDueToFewEntries()) {
            return;
        }

        // 低性能設備或平滑滾動被禁用時，直接跳轉
        if (!ENABLE_SMOOTH_SCROLL) {
            window.scrollTo({ top: targetY, behavior: "instant" });
            return;
        }

        // 防止重入
        if (isAnimating) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
            isAnimating = false;
            window.scrollTo({ top: targetY, behavior: "instant" });
            return;
        }

        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
            isAnimating = false;
        }

        const startY = getScrollY();
        const distance = targetY - startY;
        const MIN_DISTANCE = 10;

        if (Math.abs(distance) < MIN_DISTANCE) {
            window.scrollTo({ top: targetY, behavior: "instant" });
            return;
        }

        const DURATION = SCROLL_DURATION;
        const startTime = performance.now();
        isAnimating = true;

        let frameCount = 0;
        const MAX_FRAMES = MAX_ANIMATION_FRAMES;

        function step(currentTime) {
            frameCount++;
            
            // 強制終止條件
            if (!isAnimating || frameCount > MAX_FRAMES) {
                isAnimating = false;
                animationFrameId = null;
                window.scrollTo({ top: targetY, behavior: "instant" });
                return;
            }
            
            updateDialogState();
            if (isDialogOpen) {
                isAnimating = false;
                animationFrameId = null;
                return;
            }

            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / DURATION, 1);
            // 使用簡單的 easeOutQuad 緩動
            const easedProgress = 1 - Math.pow(1 - progress, 2);

            const currentY = startY + distance * easedProgress;
            window.scrollTo({ top: currentY, behavior: "instant" });

            if (progress < 1 && isAnimating) {
                animationFrameId = requestAnimationFrame(step);
            } else {
                isAnimating = false;
                animationFrameId = null;
                window.scrollTo({ top: targetY, behavior: "instant" });
            }
        }

        animationFrameId = requestAnimationFrame(step);
    }

    // ---- 清理過期記錄 ----
    function cleanExpired() {
        if (EXPIRE === Infinity) return;

        const now = Date.now();
        let scrollChanged = false;

        // 清理滾動記錄
        const scrollData = loadData();
        for (const key in scrollData) {
            if (now - scrollData[key].time > EXPIRE) {
                delete scrollData[key];
                scrollChanged = true;
            }
        }
        if (scrollChanged) {
            saveData(scrollData);
        }

        // 更新清理時間標記（只記錄日期）
        const meta = loadMeta();
        const today = getTodayStr();
        if (meta.lastClean !== today) {
            meta.lastClean = today;
            saveMeta(meta);
        }
    }

    // ---- 強制清理所有過期記錄（供外部調用） ----
    function forceCleanExpired() {
        cleanExpired();
    }

    // ---- 保存滾動位置（每次訪問更新當前目錄時間） ----
    function saveScroll() {
        if (!isScrollRememberActive()) return;
        if (isRestoring) return;
        if (isAnimating) return;
        
        updateDialogState();
        if (isDialogOpen) return;

        // 檢查條目數量，少於 MIN_ENTRIES_TO_SAVE 個不保存
        if (shouldSkipDueToFewEntries()) {
            return;
        }

        const data = loadData();
        data[currentPath()] = {
            y: getScrollY(),
            time: Date.now()
        };
        saveData(data);
    }

    // ---- 延遲保存（防抖） ----
    function debouncedSaveScroll() {
        if (scrollSaveTimer) {
            clearTimeout(scrollSaveTimer);
        }
        scrollSaveTimer = setTimeout(function() {
            scrollSaveTimer = null;
            saveScroll();
        }, 500);
    }

    // ---- 恢復滾動位置（優化版） ----
    function restoreScroll() {
        if (!isScrollRememberActive()) return;
        if (isRestoring) return;
        
        updateDialogState();
        if (isDialogOpen) return;

        // 取消所有待執行的恢復
        cancelAllPendingRestores();

        // 檢查條目數量，少於 MIN_ENTRIES_TO_SAVE 個不恢復
        if (shouldSkipDueToFewEntries()) {
            return;
        }

        const path = currentPath();

        // 每次恢復前都清理過期記錄
        cleanExpired();

        const data = loadData();
        const info = data[path];

        if (!info || typeof info.y !== 'number' || info.y < 0) {
            return;
        }

        const targetY = Math.max(0, info.y);

        isRestoring = true;

        // 先立即跳轉到目標位置（防止閃爍）
        window.scrollTo({ top: targetY, behavior: "instant" });

        // 延遲執行平滑滾動（如果啟用）
        if (ENABLE_SMOOTH_SCROLL) {
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
        } else {
            // 低性能設備：直接跳轉，不等待動畫
            isRestoring = false;
        }

        // 超時保護
        setTimeout(function() {
            if (isRestoring) {
                isRestoring = false;
                if (restoreTimer) {
                    clearTimeout(restoreTimer);
                    restoreTimer = null;
                }
                // 確保最終位置正確
                const data = loadData();
                const info = data[path];
                if (info && typeof info.y === 'number') {
                    window.scrollTo({ top: Math.max(0, info.y), behavior: "instant" });
                }
            }
        }, 2000);
    }

    // ---- 每日清理器（放緩檢查頻率） ----
    function installDailyCleaner() {
        if (EXPIRE === Infinity) return;

        // 初始清理
        cleanExpired();

        // 每 30 分鐘檢查一次是否需要清理（放緩頻率）
        setInterval(function() {
            const meta = loadMeta();
            const today = getTodayStr();
            // 如果日期變了，執行清理
            if (meta.lastClean !== today) {
                cleanExpired();
            } else {
                // 檢查是否有記錄過期（只在日期未變時檢查）
                const now = Date.now();
                const scrollData = loadData();
                let needsClean = false;
                
                // 檢查滾動記錄
                for (const key in scrollData) {
                    if (now - scrollData[key].time > EXPIRE) {
                        needsClean = true;
                        break;
                    }
                }
                
                if (needsClean) {
                    cleanExpired();
                }
            }
        }, 1800000); // 30分鐘檢查一次
    }

    // ---- 滾動監聽（優化版，支援低性能設備） ----
    function installScrollListener() {
        if (!isScrollRememberActive()) return;

        let ticking = false;
        let lastScrollSaveTime = 0;
        const MIN_SAVE_INTERVAL = IS_LOW_PERFORMANCE ? 200 : 100;

        window.addEventListener('scroll', function() {
            if (!isScrollRememberActive()) return;
            updateDialogState();
            if (isDialogOpen) return;
            if (isRestoring) return;
            if (isAnimating) return;

            // 時間節流
            const now = Date.now();
            if (now - lastScrollSaveTime < MIN_SAVE_INTERVAL) return;
            lastScrollSaveTime = now;

            if (!ticking) {
                window.requestAnimationFrame(function() {
                    debouncedSaveScroll();
                    ticking = false;
                });
                ticking = true;
            }
        }, { passive: true });
    }

    // ---- 事件監聽 ----
    function installFolderClickListener() {
        if (!isScrollRememberActive()) return;

        document.addEventListener("click", function(e) {
            if (!isScrollRememberActive()) return;

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
        if (!isScrollRememberActive()) return;

        window.addEventListener("popstate", function() {
            if (!isScrollRememberActive()) return;
            cancelAllPendingRestores();
            scheduleRestore(RESTORE_DELAY + 20);
        });
    }

    function installUriWatcher() {
        if (!isScrollRememberActive()) return;

        let last = currentPath();
        let isProcessing = false;

        setInterval(function() {
            if (!isScrollRememberActive()) return;
            if (isProcessing) return;
            
            const now = currentPath();

            if (now !== last) {
                isProcessing = true;
                last = now;
                cancelAllPendingRestores();
                scheduleRestore(RESTORE_DELAY + 40);
                isProcessing = false;
            }
        }, URI_WATCH_INTERVAL);
    }

    // ---- 初始化 ----
    function initScrollModule() {
        if (!isScrollRememberActive()) return;

        installDailyCleaner();
        installScrollListener();

        document.addEventListener("visibilitychange", function() {
            if (!isScrollRememberActive()) return;
            if (!document.hidden) {
                cancelAllPendingRestores();
                scheduleRestore(RESTORE_DELAY + 120);
            }
        });

        window.addEventListener("pageshow", function(e) {
            if (!isScrollRememberActive()) return;
            if (e.persisted) {
                cancelAllPendingRestores();
                scheduleRestore(RESTORE_DELAY + 70);
            }
        });

        window.addEventListener("beforeunload", function() {
            if (!isScrollRememberActive()) return;
            saveScroll();
        });

        window.addEventListener("pagehide", function() {
            if (!isScrollRememberActive()) return;
            saveScroll();
        });

        installFolderClickListener();
        installBackForwardListener();
        installUriWatcher();

        if (document.readyState === 'complete') {
            setTimeout(function() {
                scheduleRestore(RESTORE_DELAY + 420);
            }, 100);
        } else {
            window.addEventListener('load', function() {
                setTimeout(function() {
                    scheduleRestore(RESTORE_DELAY + 320);
                }, 100);
            });
        }
    }

    // ---- 供手勢導航使用 ----
    function saveForGesture() {
        if (!isScrollRememberActive()) return;
        saveScroll();
    }

    function restoreForGesture() {
        if (!isScrollRememberActive()) return;
        cancelAllPendingRestores();
        scheduleRestore(RESTORE_DELAY + 220);
    }

    // ============================================================
    //  Gesture Navigation Module
    // ============================================================
    const GestureModule = (function() {
        let lastActionTime = 0;
        let startPoint = null;
        let isMultiTouch = false; // 標記是否為多指觸摸

        // —— 雙指觸發後的放大避讓狀態 ——
        // 一旦檢測到雙指動作，就進入避讓，直到圖片放大特徵消失。
        let zoomAvoidActive = false;
        let zoomAvoidTimer = null;
        let zoomAvoidDeadline = 0;
        const ZOOM_AVOID_POLL_MS = 250;
        const ZOOM_AVOID_MAX_MS = 60000;

        // 最小化避讓：檢測圖片瀏覽器是否處於放大模式。
        // 不修改圖片瀏覽器插件，僅從其 DOM 推斷。
        function isImageBrowserZoomed() {
            try {
                const viewer = document.querySelector('.file-show');
                if (!viewer) return false;

                // 優先：讀取倍數字樣按鈕
                const resetBtn = viewer.querySelector('.ib-zoom-reset');
                if (resetBtn) {
                    const txt = (resetBtn.textContent || '').trim();
                    if (txt && txt !== '1.0x') return true;
                    if (txt === '1.0x') return false;
                }

                // 兜底：檢查主圖內聯 transform 是否帶 scale > 1
                const showing = viewer.querySelector('img.showing');
                if (showing) {
                    const t = showing.style.transform || '';
                    const m = t.match(/scale\(([\d.]+)\)/);
                    if (m) {
                        const s = parseFloat(m[1]);
                        if (!isNaN(s) && s > 1.001) return true;
                    }
                }

                // 兜底：容器 touch-action 被設為 none（放大時圖片瀏覽器會這麼做）
                const container = viewer.querySelector('.showing-container');
                if (container && container.style.touchAction === 'none') {
                    return true;
                }

                return false;
            } catch (e) {
                return false;
            }
        }

        function stopZoomAvoidPolling() {
            if (zoomAvoidTimer) {
                clearInterval(zoomAvoidTimer);
                zoomAvoidTimer = null;
            }
        }

        function beginZoomAvoid() {
            zoomAvoidActive = true;
            zoomAvoidDeadline = Date.now() + ZOOM_AVOID_MAX_MS;
            if (zoomAvoidTimer) return;
            zoomAvoidTimer = setInterval(function() {
                // 超過兜底時間，強制解除，避免異常卡死
                if (Date.now() > zoomAvoidDeadline) {
                    zoomAvoidActive = false;
                    stopZoomAvoidPolling();
                    return;
                }
                // 放大特徵消失 → 解除避讓
                if (!isImageBrowserZoomed()) {
                    zoomAvoidActive = false;
                    stopZoomAvoidPolling();
                }
            }, ZOOM_AVOID_POLL_MS);
        }

        function isZoomAvoiding() {
            return zoomAvoidActive || isImageBrowserZoomed();
        }

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

        /**
         * 嘗試關閉當前打開的對話框 / file-show。
         * 只依賴固定結構類名，與界面語言無關。
         * @returns {boolean} 偵測到對話框並處理則返回 true。
         */
        function tryCloseOpenDialog() {
            // 固定框架類名判斷（語言無關）
            const modal = document.querySelector(
                '.dialog-backdrop.file-show, .dialog-backdrop, .modal.in, .v-dialog'
            );
            if (!modal) return false;

            // 可見性判斷（語言無關）
            if (modal.offsetParent === null &&
                getComputedStyle(modal).display === 'none') {
                return false;
            }

            // 固定圖標 / 結構類名找關閉鈕，找不到就點 backdrop（語言無關）
            const closeBtn =
                modal.querySelector('.dialog-closer') ||
                modal.querySelector('.fa-cancel')?.closest('button') ||
                modal.querySelector('.fa-times')?.closest('button') ||
                modal.querySelector('button.icon-button:last-of-type');

            (closeBtn || modal).click();

            // 對話框存在即視為已處理，杜絕 fallthrough 到返回上一層
            return true;
        }

        function triggerParentNavigation() {
            // 避讓：圖片瀏覽器處於放大模式或雙指避讓期內，禁止手勢返回/關閉
            if (isZoomAvoiding()) return;

            const now = Date.now();
            if (now - lastActionTime < GESTURE_CONFIG.COOLDOWN) return;
            lastActionTime = now;

            const activeElement = document.activeElement;
            const isContentEditable = activeElement && activeElement.isContentEditable;
            const isInputField = activeElement &&
                ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeElement.tagName);

            if (isContentEditable || isInputField) return;

            // 有對話框 → 只關閉，直接結束（不返回上一層）
            if (tryCloseOpenDialog()) return;

            // 無對話框 → 才返回上一層
            navigateToParent();
        }

        function handleTouchStart(e) {
            // 已有避讓或當前放大 → 不記錄起點
            if (isZoomAvoiding()) {
                if (e.touches.length > 1) {
                    // 再次雙指，續期避讓
                    beginZoomAvoid();
                }
                isMultiTouch = true;
                startPoint = null;
                return;
            }

            // 多指觸摸（如雙指縮放）→ 標記並放棄單指滑動判斷
            if (e.touches.length > 1) {
                // 首次檢測到雙指：進入避讓，直到放大特徵消失
                beginZoomAvoid();
                isMultiTouch = true;
                startPoint = null;
                return;
            }

            // 單指觸摸
            if (e.touches.length === 1) {
                isMultiTouch = false;
                startPoint = {
                    x: e.touches[0].clientX,
                    y: e.touches[0].clientY,
                    time: Date.now()
                };
            }
        }

        function handleTouchEnd(e) {
            if (isZoomAvoiding()) {
                if (e.touches.length === 0) {
                    isMultiTouch = false;
                }
                startPoint = null;
                return;
            }

            // 多指觸摸結束 → 重置狀態，不觸發手勢
            if (isMultiTouch) {
                if (e.touches.length === 0) {
                    isMultiTouch = false;
                }
                startPoint = null;
                return;
            }

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

        function handleTouchCancel() {
            // 觸摸被系統取消（如來電、手勢衝突）→ 重置所有狀態
            isMultiTouch = false;
            startPoint = null;
        }

        function handleKeyDown(e) {
            if (!GESTURE_CONFIG.BACKSPACE_ENABLED) return;
            if (isZoomAvoiding()) return;

            const activeElement = document.activeElement;
            const isContentEditable = activeElement && activeElement.isContentEditable;
            const isInputField = activeElement &&
                ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeElement.tagName);

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
                document.addEventListener('touchcancel', handleTouchCancel, { passive: true });

                if (GESTURE_CONFIG.BACKSPACE_ENABLED) {
                    document.addEventListener('keydown', handleKeyDown, true);
                }

                addDebugStyles();
            } catch (e) {
                // 靜默處理初始化失敗
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
        isScrollEnabled: function() { return isScrollRememberActive(); },
        isGestureEnabled: function() { return ENABLE_GESTURE_NAVIGATION; },
        isLowPerformance: function() { return IS_LOW_PERFORMANCE; },

        scroll: {
            save: saveScroll,
            restore: restoreScroll,
            cleanExpired: forceCleanExpired
        },

        gesture: {
            triggerParent: function() {
                if (ENABLE_GESTURE_NAVIGATION) {
                    const event = new CustomEvent('gesture-navigate');
                    document.dispatchEvent(event);
                }
            }
        },

        performance: {
            detect: PerformanceDetector.detect.bind(PerformanceDetector),
            isLowPerformance: PerformanceDetector.isLowPerformance.bind(PerformanceDetector),
            reset: PerformanceDetector.reset.bind(PerformanceDetector)
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
    }

    // 防止多次初始化
    let initialized = false;
    function safeInit() {
        if (initialized) return;
        initialized = true;
        
        if (document.readyState === 'complete') {
            init();
        } else {
            window.addEventListener('load', init);
        }
    }

    safeInit();
}