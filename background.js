let blockedDomains = [];
let listenerRegistered = false;

browser.runtime.onStartup.addListener(loadBlockedDomains);
browser.runtime.onInstalled.addListener(loadBlockedDomains);

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.blockedDomains) {
    blockedDomains = changes.blockedDomains.newValue;
    updateRequestListener();
  }
});

function loadBlockedDomains() {
  browser.storage.local.get({ blockedDomains: [] }, (res) => {
    blockedDomains = res.blockedDomains;
    updateRequestListener();
  });
}

function redirect(request) {
  return {
    redirectUrl: browser.runtime.getURL("blocked.html"),
  };
}

function updateRequestListener() {
  if (listenerRegistered) {
    browser.webRequest.onBeforeRequest.removeListener(redirect);
  }

  if (blockedDomains.length > 0) {
    const patterns = blockedDomains.map((domain) => {
      if (!domain.startsWith("*://")) {
        return `*://*.${domain}/*`;
      }
      return domain;
    });

    browser.webRequest.onBeforeRequest.addListener(
      redirect,
      { urls: patterns },
      ["blocking"],
    );
    listenerRegistered = true;
  }
}
