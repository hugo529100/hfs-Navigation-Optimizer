'use strict';

{

const config = typeof HFS !== 'undefined' && HFS.pluginConfig
    ? HFS.pluginConfig
    : {};

const EXPIRE_MINUTES = config.expireMinutes ?? 10;
const EXPIRE = EXPIRE_MINUTES === 0
    ? Infinity
    : EXPIRE_MINUTES * 60 * 1000;

// 硬编码参数，不再从后端读取
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
            restoreScroll(false);
        }, 300);
        return;
    }

    const data = loadData();
    cleanExpired(data);

    const info = data[currentPath()];

    if (!info || typeof info.y !== 'number' || info.y < 0)
        return;

    let retry = 0;

    function doRestore() {
        if (!force && userInteracted) {
            return;
        }
        setScrollY(info.y);
        retry++;
        if (retry < MAX_RETRIES) {
            setTimeout(doRestore, RETRY_INTERVAL);
        }
    }

    setTimeout(doRestore, RESTORE_DELAY);

    if (window.requestAnimationFrame) {
        requestAnimationFrame(function() {
            setTimeout(function() {
                if (!force && userInteracted) return;
                setScrollY(info.y);
            }, 50);
        });
    }
}

function prepareNavigation() {
    saveScroll();
    userInteracted = false;
    isNavigating = true;
    clearTimeout(interactionTimer);
    setTimeout(function() {
        isNavigating = false;
    }, 1000);
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
        isNavigating = true;
        setTimeout(function() {
            restoreScroll(true);
            setTimeout(function() {
                isNavigating = false;
            }, 400);
        }, 200);
    }
});

window.addEventListener("pageshow", function(e) {
    if (e.persisted) {
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

setTimeout(function() {
    isNavigating = true;
    restoreScroll(true);
    setTimeout(function() {
        isNavigating = false;
    }, 500);
}, 300);

if (document.readyState === 'complete') {
    setTimeout(function() {
        isNavigating = true;
        restoreScroll(true);
        setTimeout(function() {
            isNavigating = false;
        }, 500);
    }, 500);
} else {
    window.addEventListener('load', function() {
        setTimeout(function() {
            isNavigating = true;
            restoreScroll(true);
            setTimeout(function() {
                isNavigating = false;
            }, 500);
        }, 400);
    });
}

}