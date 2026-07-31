'use strict';

{

const config = typeof HFS !== 'undefined' && HFS.pluginConfig
    ? HFS.pluginConfig
    : {};

const EXPIRE_MINUTES = config.expireMinutes ?? 10;
const EXPIRE = EXPIRE_MINUTES === 0
    ? Infinity
    : EXPIRE_MINUTES * 60 * 1000;

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
let hasRestoredOnce = false;
let restoreScheduled = false;
let currentFolderPath = '';      // 当前文件夹路径（从 API 获取）
let isFolderPage = false;        // 当前页面是否是文件夹列表

//------------------------------------------------------------

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

function getPathFromUrl() {
    // 从 URL 中提取路径，例如 /Musics/B-Music/
    try {
        const url = new URL(location.href);
        return url.pathname;
    } catch {
        return location.pathname;
    }
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

// 通过 API 检测当前页面是否是文件夹列表，并获取实际路径
function detectFolderViaApi(callback) {
    const path = getPathFromUrl();
    
    // 如果是根目录或者明显不是文件夹，先快速判断
    if (path === '/' || path === '/index.html') {
        isFolderPage = true;
        currentFolderPath = '/';
        if (callback) callback(true);
        return;
    }

    // 排除文件（带扩展名且不以 / 结尾）
    if (path.includes('.') && !path.endsWith('/')) {
        isFolderPage = false;
        currentFolderPath = '';
        if (callback) callback(false);
        return;
    }

    // 调用 API 检测
    const apiUrl = '/~/api/get_file_list?uri=' + encodeURIComponent(path);
    
    fetch(apiUrl, {
        headers: { 'Accept': 'application/json' }
    })
    .then(function(res) {
        if (!res.ok) throw new Error('API error');
        return res.json();
    })
    .then(function(data) {
        // 有 list 字段且是数组，说明是文件夹
        if (data && Array.isArray(data.list)) {
            isFolderPage = true;
            currentFolderPath = path;
        } else {
            isFolderPage = false;
            currentFolderPath = '';
        }
        if (callback) callback(isFolderPage);
    })
    .catch(function() {
        // API 调用失败，回退到 URL 判断
        if (path.endsWith('/') || path === '') {
            isFolderPage = true;
            currentFolderPath = path || '/';
        } else {
            isFolderPage = false;
            currentFolderPath = '';
        }
        if (callback) callback(isFolderPage);
    });
}

function shouldIgnorePage() {
    // 如果不是文件夹列表页，忽略
    if (!isFolderPage) return true;
    
    // 排除特殊路径
    const url = location.href;
    if (url.includes('?dl')) return true;
    if (url.includes('?upload')) return true;
    if (url.includes('/~login')) return true;
    if (url.includes('/~logout')) return true;
    if (url.includes('/~upload')) return true;
    if (url.includes('/~api')) return true;
    
    return false;
}

function getStorageKey() {
    // 用文件夹路径作为存储 key
    return currentFolderPath || getPathFromUrl();
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
    if (shouldIgnorePage()) return;
    
    const data = loadData();
    const key = getStorageKey();
    data[key] = {
        y: getScrollY(),
        time: Date.now()
    };
    saveData(data);
}

function restoreScroll(force) {
    if (shouldIgnorePage()) {
        hasRestoredOnce = true;
        return;
    }

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

    const key = getStorageKey();
    const info = data[key];

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
                setTimeout(function() {
                    hasRestoredOnce = true;
                }, 100);
            }, 50);
        });
    }

    setTimeout(function() {
        hasRestoredOnce = true;
        restoreScheduled = false;
    }, MAX_RETRIES * RETRY_INTERVAL + RESTORE_DELAY + 500);
}

function prepareNavigation() {
    saveScroll();
    userInteracted = false;
    isNavigating = true;
    hasRestoredOnce = false;
    restoreScheduled = false;
    clearTimeout(interactionTimer);
    setTimeout(function() {
        isNavigating = false;
    }, 1000);
}

function resetRestoreState() {
    hasRestoredOnce = false;
    restoreScheduled = false;
}

// 重新检测当前页面
function reDetectPage(callback) {
    detectFolderViaApi(function(success) {
        if (success) {
            // 如果是文件夹页，尝试恢复
            if (!shouldIgnorePage() && !hasRestoredOnce) {
                resetRestoreState();
                isNavigating = true;
                setTimeout(function() {
                    restoreScroll(true);
                    setTimeout(function() {
                        isNavigating = false;
                    }, 400);
                }, 100);
            }
        }
        if (callback) callback();
    });
}

//------------------------------------------------------------

function installUserInteractionDetector() {
    let scrollTimer = null;
    
    window.addEventListener("scroll", function() {
        if (!window._programmaticScroll && !isNavigating && !shouldIgnorePage()) {
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
        if (href.includes("?upload")) return;
        if (href.includes(".") && !href.endsWith("/")) return;

        prepareNavigation();
    }, true);
}

function installBackForwardListener() {
    window.addEventListener("popstate", function() {
        // 重新检测页面
        detectFolderViaApi(function() {
            resetRestoreState();
            isNavigating = true;
            setTimeout(function() {
                restoreScroll(true);
                setTimeout(function() {
                    isNavigating = false;
                }, 400);
            }, 100);
        });
    });
}

function installUriWatcher() {
    let last = getPathFromUrl();

    setInterval(function() {
        const now = getPathFromUrl();

        if (now !== last) {
            last = now;
            // URL 变化，重新检测
            detectFolderViaApi(function() {
                if (!shouldIgnorePage()) {
                    resetRestoreState();
                    isNavigating = true;
                    setTimeout(function() {
                        restoreScroll(true);
                        setTimeout(function() {
                            isNavigating = false;
                        }, 400);
                    }, 120);
                }
            });
        }
    }, URI_WATCH_INTERVAL);
}

//------------------------------------------------------------

installUserInteractionDetector();

document.addEventListener("visibilitychange", function() {
    if (!document.hidden && !shouldIgnorePage()) {
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
        detectFolderViaApi(function() {
            if (!shouldIgnorePage()) {
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

// 初始化：先检测页面类型，再恢复
function init() {
    detectFolderViaApi(function() {
        if (shouldIgnorePage()) {
            hasRestoredOnce = true;
            return;
        }

        resetRestoreState();
        isNavigating = true;
        
        const startTime = Date.now();
        let waitInterval = null;
        
        function checkAndRestore() {
            const items = document.querySelectorAll('.entry, .folder, .file, [data-path], .listing tbody tr, .table-row');
            const elapsed = Date.now() - startTime;
            
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
        
        setTimeout(checkAndRestore, 300);
        waitInterval = setInterval(checkAndRestore, 200);
        
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
    });
}

// 根据 DOM 状态启动
if (document.readyState === 'complete') {
    setTimeout(init, 100);
} else if (document.readyState === 'interactive') {
    document.addEventListener('DOMContentLoaded', function() {
        setTimeout(init, 100);
    });
} else {
    window.addEventListener('load', function() {
        setTimeout(init, 100);
    });
}

setTimeout(function() {
    if (!hasRestoredOnce) {
        // 如果还没初始化完成，强制重试
        detectFolderViaApi(function() {
            if (!shouldIgnorePage() && !hasRestoredOnce) {
                init();
            }
        });
    }
}, 2000);

// 调试工具
window.hfsScrollDebug = function() {
    const data = loadData();
    console.log('📦 存储的滚动位置:', data);
    console.log('📌 当前路径:', getPathFromUrl());
    console.log('📌 文件夹路径:', currentFolderPath);
    console.log('📌 存储Key:', getStorageKey());
    console.log('📌 当前滚动位置:', getScrollY());
    console.log('📌 是否文件夹页:', isFolderPage);
    console.log('📌 是否忽略:', shouldIgnorePage());
    console.log('📌 已恢复:', hasRestoredOnce);
    return data;
};

// 手动强制恢复
window.hfsRestore = function() {
    resetRestoreState();
    isNavigating = true;
    restoreScroll(true);
    setTimeout(function() {
        isNavigating = false;
    }, 500);
};

}