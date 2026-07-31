'use strict';

{

const config = typeof HFS !== 'undefined' && HFS.pluginConfig
    ? HFS.pluginConfig
    : {};

const EXPIRE_MINUTES = config.expireMinutes ?? 10;
const EXPIRE = EXPIRE_MINUTES === 0
    ? Infinity
    : EXPIRE_MINUTES * 60 * 1000;

// 硬编码参数
const MAX_RETRIES = 8;
const RETRY_INTERVAL = 100;
const RESTORE_DELAY = 80;
const URI_WATCH_INTERVAL = 200;
const USER_INTERACTION_GRACE = 600;

const STORAGE_KEY = "hfs-folder-scroll";

let userInteracted = false;
let interactionTimer = null;
let isNavigating = false;
let pendingRestore = null;
let hasRestoredOnce = false;        // 标记是否已完成首次恢复
let restoreScheduled = false;       // 防止重复调度

//------------------------------------------------------------

function loadData() {
    try {
        return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}");
    }
    catch {
        return {};
    }
}

function saveData(data) {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
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
    if (!isNavigating && userInteracted) return;

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
        if (!isNavigating && userInteracted) return;
        window.scrollTo({
            top: y,
            behavior: "instant"
        });
    }, 10);
}

function markUserInteraction() {
    if (isNavigating) return;
    
    userInteracted = true;
    clearTimeout(interactionTimer);
    interactionTimer = setTimeout(function() {
        userInteracted = false;
    }, USER_INTERACTION_GRACE);
}

//------------------------------------------------------------

function cleanExpired(data) {
    if (EXPIRE === Infinity) return data;

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

    return data;
}

function saveScroll() {
    const data = loadData();
    data[currentPath()] = {
        y: getScrollY(),
        time: Date.now()
    };
    saveData(data);
}

function restoreScroll(force) {
    // 非强制恢复时，如果已经恢复过了，不再重复执行
    if (!force && hasRestoredOnce) {
        return;
    }

    if (restoreScheduled) {
        return;
    }
    restoreScheduled = true;

    if (pendingRestore) {
        clearTimeout(pendingRestore);
        pendingRestore = null;
    }

    if (force) {
        isNavigating = true;
        setTimeout(function() {
            isNavigating = false;
        }, 500);
    }

    if (!force && userInteracted) {
        pendingRestore = setTimeout(function() {
            restoreScheduled = false;
            restoreScroll(false);
        }, 300);
        return;
    }

    const data = loadData();
    cleanExpired(data);

    const info = data[currentPath()];

    if (!info || typeof info.y !== 'number' || info.y < 0) {
        restoreScheduled = false;
        return;
    }

    let retry = 0;

    function doRestore() {
        if (!force && userInteracted) {
            restoreScheduled = false;
            return;
        }
        setScrollY(info.y);
        retry++;
        if (retry < MAX_RETRIES) {
            setTimeout(doRestore, RETRY_INTERVAL);
        } else {
            // 恢复完成
            hasRestoredOnce = true;
            restoreScheduled = false;
        }
    }

    setTimeout(doRestore, RESTORE_DELAY);

    if (window.requestAnimationFrame) {
        requestAnimationFrame(function() {
            setTimeout(function() {
                if (!force && userInteracted) {
                    restoreScheduled = false;
                    return;
                }
                setScrollY(info.y);
                // 动画帧执行后标记恢复完成
                setTimeout(function() {
                    hasRestoredOnce = true;
                }, 100);
            }, 50);
        });
    }

    // 兜底：即使上面的重试都没成功，最终也标记完成
    setTimeout(function() {
        hasRestoredOnce = true;
        restoreScheduled = false;
    }, MAX_RETRIES * RETRY_INTERVAL + RESTORE_DELAY + 500);
}

function prepareNavigation() {
    saveScroll();
    userInteracted = false;
    isNavigating = true;
    hasRestoredOnce = false;   // 新页面需要重新恢复
    restoreScheduled = false;
    clearTimeout(interactionTimer);
    setTimeout(function() {
        isNavigating = false;
    }, 1000);
}

// 重置恢复状态（用于页面切换）
function resetRestoreState() {
    hasRestoredOnce = false;
    restoreScheduled = false;
}

//------------------------------------------------------------

function installUserInteractionDetector() {
    let scrollTimer = null;
    
    window.addEventListener("scroll", function() {
        if (!window._programmaticScroll && !isNavigating) {
            markUserInteraction();
            clearTimeout(scrollTimer);
            scrollTimer = setTimeout(function() {
                saveScroll();
            }, 300);
        }
    }, { passive: true });

    window.addEventListener("touchstart", function() {
        if (!isNavigating) markUserInteraction();
    }, { passive: true });

    window.addEventListener("touchmove", function() {
        if (!isNavigating) markUserInteraction();
    }, { passive: true });

    window.addEventListener("wheel", function(e) {
        if (e.deltaY !== 0 && !isNavigating) {
            markUserInteraction();
        }
    }, { passive: true });
}

const originalSetScrollY = setScrollY;
setScrollY = function(y) {
    window._programmaticScroll = true;
    originalSetScrollY(y);
    setTimeout(function() {
        window._programmaticScroll = false;
    }, 100);
};

//------------------------------------------------------------

function installFolderClickListener() {
    document.addEventListener("click", function(e) {
        const a = e.target.closest("a");
        if (!a) return;

        const href = a.getAttribute("href");
        if (!href) return;
        if (href.includes("?dl")) return;
        if (href.includes(".") && !href.endsWith("/")) return;

        prepareNavigation();
    }, true);
}

function installBackForwardListener() {
    window.addEventListener("popstate", function() {
        resetRestoreState();
        isNavigating = true;
        setTimeout(function() {
            restoreScroll(true);
            setTimeout(function() {
                isNavigating = false;
            }, 400);
        }, 100);
    });
}

function installUriWatcher() {
    let last = currentPath();

    setInterval(function() {
        const now = currentPath();

        if (now !== last) {
            last = now;
            resetRestoreState();
            isNavigating = true;
            setTimeout(function() {
                restoreScroll(true);
                setTimeout(function() {
                    isNavigating = false;
                }, 400);
            }, 120);
        }
    }, URI_WATCH_INTERVAL);
}

//------------------------------------------------------------

installUserInteractionDetector();

document.addEventListener("visibilitychange", function() {
    if (!document.hidden) {
        // 页面可见时，如果还没恢复过，尝试恢复
        if (!hasRestoredOnce) {
            resetRestoreState();
            isNavigating = true;
            setTimeout(function() {
                restoreScroll(true);
                setTimeout(function() {
                    isNavigating = false;
                }, 400);
            }, 200);
        }
    }
});

window.addEventListener("pageshow", function(e) {
    if (e.persisted) {
        resetRestoreState();
        isNavigating = true;
        setTimeout(function() {
            restoreScroll(true);
            setTimeout(function() {
                isNavigating = false;
            }, 400);
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

// 首次加载：等待 DOM 完全渲染后再恢复
function initialRestore() {
    resetRestoreState();
    isNavigating = true;
    
    // 等待内容稳定后再恢复
    const startTime = Date.now();
    let waitInterval = null;
    
    function checkAndRestore() {
        // 检查列表项是否已渲染（根据 HFS 的实际情况调整选择器）
        const items = document.querySelectorAll('.entry, .folder, .file, [data-path], .listing tbody tr');
        const elapsed = Date.now() - startTime;
        
        // 如果有内容，或者等待超过 2 秒，执行恢复
        if (items.length > 0 || elapsed > 2000) {
            if (waitInterval) {
                clearInterval(waitInterval);
                waitInterval = null;
            }
            restoreScroll(true);
            setTimeout(function() {
                isNavigating = false;
            }, 500);
        }
    }
    
    // 立即检查一次
    setTimeout(checkAndRestore, 300);
    
    // 持续检查
    waitInterval = setInterval(checkAndRestore, 200);
    
    // 兜底：3秒后强制完成
    setTimeout(function() {
        if (waitInterval) {
            clearInterval(waitInterval);
            waitInterval = null;
        }
        if (!hasRestoredOnce) {
            restoreScroll(true);
            setTimeout(function() {
                isNavigating = false;
            }, 500);
        }
    }, 3000);
}

// 启动首次恢复
if (document.readyState === 'complete') {
    setTimeout(initialRestore, 100);
} else if (document.readyState === 'interactive') {
    // DOM 可用但资源未加载完
    document.addEventListener('DOMContentLoaded', function() {
        setTimeout(initialRestore, 100);
    });
} else {
    window.addEventListener('load', function() {
        setTimeout(initialRestore, 100);
    });
}

// 兜底：如果上面的都没触发
setTimeout(function() {
    if (!hasRestoredOnce) {
        initialRestore();
    }
}, 1500);

}