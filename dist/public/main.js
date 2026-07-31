'use strict';

{

const config = typeof HFS !== 'undefined' && HFS.pluginConfig
    ? HFS.pluginConfig
    : {};

const EXPIRE_MINUTES = config.expireMinutes ?? 10;
const EXPIRE = EXPIRE_MINUTES === 0
    ? Infinity
    : EXPIRE_MINUTES * 60 * 1000;

const MAX_RETRIES = config.maxRetries ?? 8;
const RETRY_INTERVAL = config.retryInterval ?? 100;
const RESTORE_DELAY = 80;
const URI_WATCH_INTERVAL = 200;

const STORAGE_KEY = "hfs-folder-scroll";

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

function restoreScroll() {
    const data = loadData();
    cleanExpired(data);

    const info = data[currentPath()];

    if (!info || typeof info.y !== 'number' || info.y < 0)
        return;

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