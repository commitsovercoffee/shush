// Update current url, when dom loads...
document.addEventListener("DOMContentLoaded", async () => {
  let [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  document.getElementById("current-url").value = tab.url;

  const { encryptedPassword } =
    await browser.storage.local.get("encryptedPassword");
  if (encryptedPassword) {
    // Show login UI
    document.getElementById("signupPage").style.display = "none";
    document.getElementById("loginPage").style.display = "flex";
  } else {
    // Show setup UI
    document.getElementById("signupPage").style.display = "flex";
    document.getElementById("loginPage").style.display = "none";
    document.getElementById("status").textContent =
      "Please set a password to proceed.";
  }
});

function arrayBufferToBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    buf[i] = binary.charCodeAt(i);
  }
  return buf.buffer;
}

async function getOrCreateSalt() {
  const { encryptionSalt } = await browser.storage.local.get("encryptionSalt");
  if (encryptionSalt) {
    return new Uint8Array(base64ToArrayBuffer(encryptionSalt));
  } else {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    await browser.storage.local.set({
      encryptionSalt: arrayBufferToBase64(salt.buffer),
    });
    return salt;
  }
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

async function encryptPassword(password, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(password),
  );

  const combined = new Uint8Array(iv.byteLength + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.byteLength);

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

// Handle Save
document.getElementById("saveBtn").addEventListener("click", async () => {
  const password = document.getElementById("savePassword").value;
  const passphrase = "user-secret-passphrase"; // this could be derived from user data
  const key = await getKeyFromPassphrase(passphrase);
  const encrypted = await encryptPassword(password, key);
  await browser.storage.local.set({ encryptedPassword: encrypted });
  document.getElementById("status").textContent = "Please login to continue.";
  document.getElementById("signupPage").style.display = "none";
  document.getElementById("loginPage").style.display = "flex";
});

// Handle Login
document.getElementById("loginBtn").addEventListener("click", async () => {
  const inputPassword = document.getElementById("loginPassword").value;
  const passphrase = "user-secret-passphrase"; // must match what was used earlier
  const key = await getKeyFromPassphrase(passphrase);
  const { encryptedPassword } =
    await browser.storage.local.get("encryptedPassword");

  if (!encryptedPassword) {
    document.getElementById("status").textContent = "No password saved yet.";
    return;
  }

  try {
    const decrypted = await decryptPassword(encryptedPassword, key);
    if (decrypted === inputPassword) {
      document.getElementById("loginPage").style.display = "none";
      document.getElementById("blockPage").style.display = "flex";
    } else {
      document.getElementById("status").textContent = "Incorrect password.";
    }
  } catch (e) {
    document.getElementById("status").textContent = "Decryption failed.";
    console.error(e);
  }
});
