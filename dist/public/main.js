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

const STORAGE_KEY = "hfs-folder-scroll";
const META_KEY = "hfs-folder-scroll-meta";

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

//------------------------------------------------------------

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
    const data = loadData();
    data[currentPath()] = {
        y: getScrollY(),
        time: Date.now()
    };
    saveData(data);
}

function restoreScroll() {
    cleanExpired();

    const data = loadData();
    const info = data[currentPath()];

    // 首次进入没有记录 → 滚动到顶部 0
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

//------------------------------------------------------------

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

//------------------------------------------------------------

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

setTimeout(restoreScroll, 300);

if (document.readyState === 'complete') {
    setTimeout(restoreScroll, 500);
} else {
    window.addEventListener('load', function() {
        setTimeout(restoreScroll, 400);
    });
}

}