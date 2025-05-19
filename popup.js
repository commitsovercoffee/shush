let isBlocked = false;

document.addEventListener("DOMContentLoaded", async () => {
  // Get active tab info
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });

  // Check if user is on the blocked.html page
  const messageElem = document.getElementById("message");
  const urlInput = document.getElementById("current-url");

  if (tab.url.endsWith("blocked.html")) {
    isBlocked = true;
    messageElem.textContent = "This website is blocked.";
  } else {
    isBlocked = false;
    urlInput.value = tab.url;
  }

  // Determine auth flow
  const { encryptedVerifier } =
    await browser.storage.local.get("encryptedVerifier");
  const { isLoggedIn } = await browser.storage.session.get("isLoggedIn");

  if (encryptedVerifier) {
    showPage(
      isLoggedIn ? "home" : "login",
      isLoggedIn ? "Welcome back." : "Login Page",
    );
  } else {
    showPage("signup", "Signup Page");
  }

  // Setup toggle buttons
  document.querySelectorAll(".day").forEach((btn) => {
    btn.addEventListener("click", () => btn.classList.toggle("selected"));
  });

  // Add the click listener directly here:
  document
    .querySelector("#home .primary-btn")
    .addEventListener("click", handleBlockSite);
});

// 🚫 Handle Block Button

async function handleBlockSite() {
  const currentUrlInput = document.getElementById("current-url").value.trim();
  const fromTime = document.getElementById("from").value;
  const toTime = document.getElementById("to").value;
  const redirectUrl = document.getElementById("redirect-url").value.trim();
  const selectedDays = Array.from(
    document.querySelectorAll(".day.selected"),
  ).map((btn) => btn.textContent);

  // ✅ Validation
  if (!currentUrlInput) {
    alert("Please enter a website URL to block.");
    return;
  }

  let normalizedUrl;
  try {
    normalizedUrl = new URL(currentUrlInput);
  } catch (e) {
    alert("Please enter a valid website URL.");
    return;
  }

  if (selectedDays.length === 0) {
    alert("Please select at least one day.");
    return;
  }

  if (!fromTime || !toTime) {
    alert("Please specify both 'From' and 'To' times.");
    return;
  }

  if (redirectUrl) {
    try {
      new URL("https://" + redirectUrl); // Validate
    } catch (e) {
      alert("Please enter a valid redirect URL or leave it blank.");
      return;
    }
  }

  const fullUrl = normalizedUrl.href;

  const newEntry = {
    url: fullUrl,
    days: selectedDays,
    from: fromTime,
    to: toTime,
    redirect: redirectUrl || null,
  };

  const { blockedDomains = [] } =
    await browser.storage.local.get("blockedDomains");

  // Avoid duplicates (case insensitive full URL match)
  const existingIndex = blockedDomains.findIndex(
    (entry) => entry.url?.toLowerCase() === fullUrl.toLowerCase(),
  );

  if (existingIndex !== -1) {
    blockedDomains[existingIndex] = newEntry;
  } else {
    blockedDomains.push(newEntry);
  }

  await browser.storage.local.set({ blockedDomains });

  alert("Site successfully blocked.");

  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (tabs.length > 0) {
    const tab = tabs[0];
    browser.runtime.sendMessage({
      action: "redirectBlockedTab",
      url: fullUrl,
      tabId: tab.id,
    });
  }
}

// 🧭 Page Router
function showPage(page, message) {
  const pages = ["signup", "login", "home"];
  pages.forEach((id) => {
    document.getElementById(id).style.display = page === id ? "flex" : "none";
  });
  document.getElementById("message").textContent = message;
}

// 🔐 Signup Handler
document.getElementById("signup-btn").addEventListener("click", async () => {
  const password = document.getElementById("set-password").value.trim();
  if (!password || password.length < 4) {
    return (document.getElementById("message").textContent =
      "Password must be at least 4 characters.");
  }

  const key = await getKeyFromPassphrase(password);
  const encrypted = await encryptPassword("verify", key);
  await browser.storage.local.set({ encryptedVerifier: encrypted });
  showPage("login", "Please login to continue.");
});

// 🔐 Login Handler
document.getElementById("login-btn").addEventListener("click", async () => {
  const password = document.getElementById("input-password").value.trim();
  if (!password) {
    return (document.getElementById("message").textContent =
      "Enter your password.");
  }

  const key = await getKeyFromPassphrase(password);
  const { encryptedVerifier } =
    await browser.storage.local.get("encryptedVerifier");

  if (!encryptedVerifier)
    return showPage("signup", "No password found. Please sign up.");

  try {
    const decrypted = await decryptPassword(encryptedVerifier, key);
    if (decrypted === "verify") {
      await browser.storage.session.set({ isLoggedIn: true });
      showPage("home", "Welcome!");
    } else {
      document.getElementById("message").textContent = "Incorrect password.";
    }
  } catch (err) {
    document.getElementById("message").textContent =
      "Incorrect password or corrupted data.";
    console.error("Decryption failed:", err);
  }
});

// 🔐 Crypto Utilities
function arrayBufferToBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
  return buf.buffer;
}

async function getOrCreateSalt() {
  const { encryptionSalt } = await browser.storage.local.get("encryptionSalt");
  if (encryptionSalt) {
    return new Uint8Array(base64ToArrayBuffer(encryptionSalt));
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  await browser.storage.local.set({
    encryptionSalt: arrayBufferToBase64(salt.buffer),
  });
  return salt;
}

async function getKeyFromPassphrase(passphrase) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );

  const salt = await getOrCreateSalt();
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
}

async function encryptPassword(data, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(data),
  );

  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return arrayBufferToBase64(combined.buffer);
}

async function decryptPassword(dataB64, key) {
  const data = new Uint8Array(base64ToArrayBuffer(dataB64));
  const iv = data.slice(0, 12);
  const ciphertext = data.slice(12);

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  );

  return new TextDecoder().decode(decrypted);
}
