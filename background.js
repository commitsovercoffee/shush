browser.runtime.onMessage.addListener((message, sender) => {
  if (message.action === "redirectBlockedTab") {
    const redirectUrl = shouldBlockRequest(message.url);
    if (redirectUrl && message.tabId) {
      // Redirect the current tab immediately
      browser.tabs.update(message.tabId, { url: redirectUrl });
    }
  }
});

let blockedDomains = [];
blockedDomains = blockedDomains.filter((entry) => entry.url);
let listenerRegistered = false;

// Load blocked domains on startup/install
browser.runtime.onStartup.addListener(loadBlockedDomains);
browser.runtime.onInstalled.addListener(loadBlockedDomains);

// Listen for changes to blocked domains and update listener
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

// Check if hostname matches domain or its subdomains
function domainMatches(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

// Determine if the request URL should be blocked, returning redirect URL or null

function shouldBlockRequest(url) {
  const now = new Date();
  const currentDay = now.toLocaleDateString("en-US", { weekday: "short" });
  const currentTime = now.toTimeString().slice(0, 5);

  for (const rule of blockedDomains) {
    if (!rule.url) continue;

    if (url !== rule.url) continue; // Full exact match

    if (!rule.days.includes(currentDay)) continue;

    if (!isTimeInRange(currentTime, rule.from, rule.to)) continue;

    return rule.redirect || browser.runtime.getURL("blocked.html");
  }

  return null;
}

// Check if current time falls in blocking range (including overnight)
function isTimeInRange(current, from, to) {
  if (from > to) {
    return current >= from || current <= to;
  }
  return current >= from && current <= to;
}

// Handle webRequest redirect logic
function redirect(request) {
  const redirectUrl = shouldBlockRequest(request.url);
  if (redirectUrl) {
    // If URL already has scheme or is an extension URL, return as-is
    if (
      redirectUrl.startsWith("http://") ||
      redirectUrl.startsWith("https://") ||
      redirectUrl.startsWith("moz-extension://") ||
      redirectUrl.startsWith("chrome-extension://")
    ) {
      return { redirectUrl };
    }
    // Otherwise prepend https:// scheme
    return { redirectUrl: `https://${redirectUrl}` };
  }
  return {};
}

// Add or update the webRequest listener
function updateRequestListener() {
  if (listenerRegistered) {
    browser.webRequest.onBeforeRequest.removeListener(redirect);
    listenerRegistered = false;
  }

  if (blockedDomains.length > 0) {
    browser.webRequest.onBeforeRequest.addListener(
      redirect,
      { urls: ["<all_urls>"] },
      ["blocking"],
    );
    listenerRegistered = true;
  }
}
