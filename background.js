/**
 * @file The background script for the website blocker extension.
 * @description This script handles all core logic, including intercepting web requests,
 * checking them against blocking rules (instant, scheduled, and timer-based),
 * and redirecting the user when a site is blocked.
 */

"use strict";

// --- TYPE DEFINITIONS ---

/**
 * Defines the structure of a schedule object used for time-based blocking.
 * @typedef {Object} Schedule
 * @property {Array<number>} days - Array of days of the week (0=Sun, 1=Mon, ...).
 * @property {string} startTime - The start time for the block in "HH:mm" format.
 * @property {string} endTime - The end time for the block in "HH:mm" format.
 */

/**
 * Defines the structure of the object returned by getBlockingStatus.
 * @typedef {Object} BlockingStatus
 * @property {boolean} shouldBlock - Indicates whether the site should be blocked.
 * @property {string} reason - The reason for blocking ('instant', 'timer', 'schedule', or '').
 */

// --- CONSTANTS ---

/**
 * The URL for the extension's internal "blocked" page. Cached for efficiency.
 * @type {string}
 */
const REDIRECT_URL = browser.runtime.getURL("blocked.html");

// --- HELPERS ---

/**
 * Extracts the origin (e.g., "https://www.example.com") from a full URL.
 * @param {string} url - The full URL to parse.
 * @returns {string} The origin of the URL, or the original URL on error.
 */
function getOrigin(url) {
  try {
    return new URL(url).origin;
  } catch (e) {
    console.error("Could not parse URL:", url, e);
    return url; // Fallback for invalid URLs
  }
}

/**
 * Checks if the current time falls within any of the provided schedules.
 * @param {Array<Schedule>} schedules - An array of schedule objects for a site.
 * @returns {boolean} True if the site should be blocked according to the schedule.
 */
function isScheduleBlocked(schedules) {
  if (!schedules || schedules.length === 0) return false;

  const now = new Date();
  const currentDay = now.getDay(); // Sunday: 0, Monday: 1, ...
  const currentTimeInMinutes = now.getHours() * 60 + now.getMinutes();

  // Check if any schedule matches the current day and time.
  return schedules.some((schedule) => {
    if (!schedule.days?.includes(currentDay)) return false;

    try {
      const [startHour, startMin] = schedule.startTime.split(":").map(Number);
      const [endHour, endMin] = schedule.endTime.split(":").map(Number);
      const startTotalMinutes = startHour * 60 + startMin;
      const endTotalMinutes = endHour * 60 + endMin;

      // Handle normal (same-day) and overnight time windows.
      if (startTotalMinutes <= endTotalMinutes) {
        return (
          currentTimeInMinutes >= startTotalMinutes &&
          currentTimeInMinutes <= endTotalMinutes
        );
      } else {
        return (
          currentTimeInMinutes >= startTotalMinutes ||
          currentTimeInMinutes <= endTotalMinutes
        );
      }
    } catch (e) {
      console.error("Error parsing schedule time:", schedule, e);
      return false;
    }
  });
}

// --- CORE LOGIC ---

/**
 * Determines if a given URL origin should be blocked based on all stored rules.
 * @param {string} origin - The URL origin to check.
 * @returns {Promise<BlockingStatus>} A promise that resolves with the blocking status.
 */
async function getBlockingStatus(origin) {
  // Fetch all blocking rules from storage in parallel.
  const data = await browser.storage.local.get([
    "blockedSites",
    "scheduledBlocks",
    "timerBlocks",
  ]);
  const { blockedSites = [], scheduledBlocks = {}, timerBlocks = {} } = data;

  // 1. Check for a permanent block.
  if (blockedSites.includes(origin)) {
    return { shouldBlock: true, reason: "instant" };
  }

  // 2. Check for an active timer block.
  const timer = timerBlocks[origin];
  if (timer && timer.endTime > Date.now()) {
    return { shouldBlock: true, reason: "timer" };
  }

  // 3. Check for a scheduled block.
  const schedules = scheduledBlocks[origin];
  if (schedules && isScheduleBlocked(schedules)) {
    return { shouldBlock: true, reason: "schedule" };
  }

  // If no rules match, the site is not blocked.
  return { shouldBlock: false, reason: "" };
}

/**
 * Removes expired timers from browser storage to keep data clean.
 * @returns {Promise<void>}
 */
async function cleanupExpiredTimers() {
  try {
    const result = await browser.storage.local.get("timerBlocks");
    const timerBlocks = result.timerBlocks || {};
    const now = Date.now();
    let hasChanges = false;

    // Find and remove any timers where the end time is in the past.
    for (const origin in timerBlocks) {
      if (timerBlocks[origin].endTime <= now) {
        delete timerBlocks[origin];
        hasChanges = true;
        console.log(`Cleaned up expired timer for: ${origin}`);
      }
    }

    // If any timers were removed, update storage.
    if (hasChanges) {
      await browser.storage.local.set({ timerBlocks });
    }
  } catch (e) {
    console.error("Error during timer cleanup:", e);
  }
}

// --- MAIN EVENT LISTENER ---

/**
 * Intercepts navigation requests to check if they should be blocked.
 * This is the primary entry point for the extension's blocking functionality.
 * @param {object} details - The details of the request from the webRequest API.
 * @see https://developer.mozilla.org/en-US/docs/Mozilla/Add-on_SDK/API/webRequest#onBeforeRequest
 * @returns {Promise<browser.webRequest.BlockingResponse>} A response object that either allows
 * the request or redirects it.
 */
async function onBeforeRequestListener(details) {
  // Ignore requests for internal or browser-specific pages to prevent loops.
  if (
    details.url.startsWith("about:") ||
    details.url.startsWith("moz-extension://") ||
    details.url.includes("blocked.html")
  ) {
    return {};
  }

  try {
    const origin = getOrigin(details.url);
    const { shouldBlock, reason } = await getBlockingStatus(origin);

    if (shouldBlock) {
      console.log(`Blocking [${reason}]: ${origin}`);
      // Store the last blocked site info for the popup UI.
      await browser.storage.local.set({
        lastBlocked: origin,
        blockReason: reason,
      });
      // Redirect the user to the blocked page.
      return { redirectUrl: REDIRECT_URL };
    }
  } catch (error) {
    console.error("Error in onBeforeRequest listener:", error);
  }

  // By default, allow the request to proceed.
  return {};
}

browser.webRequest.onBeforeRequest.addListener(
  onBeforeRequestListener,
  {
    urls: ["<all_urls>"],
    types: ["main_frame"],
  },
  ["blocking"],
);

// --- INITIALIZATION & LIFECYCLE HOOKS ---

// Perform cleanup when the extension is first installed or updated.
browser.runtime.onInstalled.addListener(() => {
  console.log("Extension installed/updated. Cleaning up timers.");
  cleanupExpiredTimers();
});

// Perform cleanup when the browser starts.
browser.runtime.onStartup.addListener(() => {
  console.log("Browser startup. Cleaning up timers.");
  cleanupExpiredTimers();
});

// Periodically clean up expired timers every minute.
setInterval(cleanupExpiredTimers, 60 * 1000);

// Run an initial cleanup when the script first loads.
cleanupExpiredTimers();

console.log("Background script loaded and listeners attached.");
