'use strict';

{

// 從 HFS 獲取配置（後台設定的值會注入到前端）
const config = typeof HFS !== 'undefined' && HFS.pluginConfig
    ? HFS.pluginConfig
    : {};

// 讀取配置，若無則使用預設值
const EXPIRE_MINUTES = config.expireMinutes ?? 10;
const EXPIRE = EXPIRE_MINUTES === 0
    ? Infinity
    : EXPIRE_MINUTES * 60 * 1000;

const MAX_RETRIES = config.maxRetries ?? 8;
const RETRY_INTERVAL = config.retryInterval ?? 100;
const RESTORE_DELAY = 80;
const URI_WATCH_INTERVAL = 200;

//------------------------------------------------------------

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

//------------------------------------------------------------

function saveScroll() {
    const data = loadData();

    data[currentPath()] = {
        y: window.scrollY,
        time: Date.now()
    };

    saveData(data);
}

//------------------------------------------------------------

function restoreScroll() {
    const data = loadData();
    cleanExpired(data);

    const info = data[currentPath()];

    if (!info)
        return;

    let retry = 0;

    function restore() {
        window.scrollTo({
            top: info.y,
            behavior: "instant"
        });

        retry++;

        if (retry < MAX_RETRIES)
            setTimeout(restore, RETRY_INTERVAL);
    }

    setTimeout(restore, RESTORE_DELAY);
}

//------------------------------------------------------------

function installFolderClickListener() {
    document.addEventListener("click", e => {
        const a = e.target.closest("a");

        if (!a)
            return;

        const href = a.getAttribute("href");

        if (!href)
            return;

        // 排除下載
        if (href.includes("?dl"))
            return;

        // 排除非目錄（有副檔名的檔案）
        if (href.includes(".") && !href.endsWith("/"))
            return;

        // 進入資料夾前記錄目前位置
        saveScroll();
    }, true);
}

//------------------------------------------------------------

function installBackForwardListener() {
    window.addEventListener("popstate", () => {
        setTimeout(() => {
            restoreScroll();
        }, 100);
    });
}

//------------------------------------------------------------

function installUriWatcher() {
    let last = currentPath();

    setInterval(() => {
        const now = currentPath();

        if (now !== last) {
            last = now;

            setTimeout(() => {
                restoreScroll();
            }, 120);
        }
    }, URI_WATCH_INTERVAL);
}

//------------------------------------------------------------

// 離開頁面時儲存
window.addEventListener("beforeunload", saveScroll);

// 安裝監聽器
installFolderClickListener();
installBackForwardListener();
installUriWatcher();

// 初次載入恢復
setTimeout(restoreScroll, 300);

}