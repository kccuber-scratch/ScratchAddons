const promisify =
  (callbackFn) =>
  (...args) =>
    new Promise((resolve) => callbackFn(...args, resolve));

function getDefaultStoreId() {
  // Request Scratch to set the CSRF token.
  return fetch("https://scratch.mit.edu/csrf_token/", {
    credentials: "include",
  })
    .catch(() => {})
    .then(() =>
      promisify(chrome.cookies.get)({
        url: "https://scratch.mit.edu/",
        name: "scratchcsrftoken",
      })
    )
    .then((cookie) => {
      return (scratchAddons.cookieStoreId = cookie.storeId);
    });
}

(async function () {
  const defaultStoreId = await getDefaultStoreId();
  console.log("Default cookie store ID: ", defaultStoreId);
  await checkSession();
})();

chrome.cookies.onChanged.addListener(({ cookie, cause }) => {
  if (cookie.name === "scratchsessionsid" || cookie.name === "scratchlanguage" || cookie.name === "scratchcsrftoken") {
    if (cookie.name === "scratchlanguage") {
      setLanguage();
    } else if (!scratchAddons.cookieStoreId) {
      getDefaultStoreId().then(() => checkSession());
    } else if (cookie.storeId === scratchAddons.cookieStoreId) {
      checkSession();
    }
    notifyContentScripts(cookie);
  }
});

function getCookieValue(name) {
  return new Promise((resolve) => {
    chrome.cookies.get(
      {
        url: "https://scratch.mit.edu/",
        name,
      },
      (cookie) => {
        if (cookie && cookie.value) resolve(cookie.value);
        else resolve(null);
      }
    );
  });
}

async function setLanguage() {
  scratchAddons.globalState.auth.scratchLang = (await getCookieValue("scratchlanguage")) || navigator.language;
}

let isChecking = false;

async function checkSession() {
  let res;
  let json;
  if (isChecking) return;
  isChecking = true;
  try {
    res = await fetch("https://scratch.mit.edu/session/", {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    json = await res.json();
  } catch (err) {
    console.warn(err);
    json = {};
    // If Scratch is down, or there was no internet connection, recheck soon:
    if ((res && !res.ok) || !res) {
      isChecking = false;
      setTimeout(checkSession, 60000);
      scratchAddons.globalState.auth = {
        isLoggedIn: false,
        username: null,
        userId: null,
        xToken: null,
        csrfToken: null,
        scratchLang: (await getCookieValue("scratchlanguage")) || navigator.language,
      };
      return;
    }
  }
  const scratchLang = (await getCookieValue("scratchlanguage")) || navigator.language;
  const csrfToken = await getCookieValue("scratchcsrftoken");
  scratchAddons.globalState.auth = {
    isLoggedIn: Boolean(json.user),
    username: json.user ? json.user.username : null,
    userId: json.user ? json.user.id : null,
    xToken: json.user ? json.user.token : null,
    csrfToken,
    scratchLang,
  };
  isChecking = false;
}

function notifyContentScripts(cookie) {
  if (cookie.name === "scratchlanguage") return;
  const storeId = cookie.storeId;
  const cond = {};
  if (typeof browser === "object") {
    // Firefox-exclusive.
    cond.cookieStoreId = storeId;
  }
  // On Chrome this can cause unnecessary session re-fetch, but there should be
  // no harm (aside from extra requests) when doing so.
  chrome.tabs.query(cond, (tabs) =>
    tabs.forEach((tab) => chrome.tabs.sendMessage(tab.id, "refetchSession", () => void chrome.runtime.lastError))
  );
}
