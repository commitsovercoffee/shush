/**
 * @file The main script for the extension's popup UI.
 * @description This script handles all user interactions for blocking sites, setting schedules and timers,
 * and managing the complete list of all blocked sites.
 */

// --- TYPE DEFINITIONS ---

/**
 * A schedule object defining a recurring block.
 * @typedef {Object} Schedule
 * @property {number} id - A unique identifier for the schedule (usually a timestamp).
 * @property {Array<number>} days - An array of days of the week (0=Sun, 1=Mon, ...).
 * @property {string} startTime - The start time for the block in "HH:mm" format.
 * @property {string} endTime - The end time for the block in "HH:mm" format.
 */

/**
 * A timer block object defining a temporary block.
 * @typedef {Object} TimerBlock
 * @property {number} endTime - The timestamp (in milliseconds) when the block expires.
 * @property {number} duration - The original duration of the timer in minutes.
 */

/**
 * A block detail object used for UI display.
 * @typedef {Object} BlockDetail
 * @property {string} type - The type of block ('instant', 'schedule', 'timer').
 * @property {string} text - The display text for the block.
 * @property {string|number} id - The unique identifier for the block.
 * @property {boolean} [isActive] - Whether the block is currently active.
 */

// --- HELPERS ---

/**
 * Extracts the origin (protocol + host) from a full URL.
 * @param {string} url - The full URL to parse.
 * @returns {string} The origin of the URL (e.g., "https://www.example.com"), or the original URL on error.
 */
function getOrigin(url) {
  try {
    return new URL(url).origin;
  } catch (e) {
    console.error("Could not parse URL:", url, e);
    return url;
  }
}

/**
 * Formats a duration in minutes into a human-readable string (e.g., "1h 30m").
 * @param {number} minutes - The total number of minutes.
 * @returns {string} The formatted time string.
 */
function formatTime(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

/**
 * Converts a day index (0-6) into a three-letter abbreviated day name.
 * @param {number} dayIndex - The day of the week, where 0 is Sunday.
 * @returns {string} The abbreviated day name (e.g., "Sun").
 */
function getDayName(dayIndex) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return days[dayIndex] || "";
}

// --- GLOBAL STATE & DOM REFERENCES ---

/** @type {HTMLElement | null} */
let siteUrlEl = document.getElementById("siteUrl");
/** @type {HTMLElement | null} */
let actionBtn = document.getElementById("actionBtn");
/** The full URL of the currently active tab. @type {string} */
let currentUrl = "";
/** The origin of the currently active tab. @type {string} */
let currentOrigin = "";
/** Interval ID for the active timer countdown. @type {number | null} */
let timerInterval = null;
/** The timer duration in minutes selected by the user in the UI. @type {number} */
let selectedTimerMinutes = 0;

// --- INITIALIZATION ---

/**
 * Initializes all UI components and event listeners when the popup's DOM is ready.
 */
document.addEventListener("DOMContentLoaded", function () {
  // Initialize tab switching functionality
  const tabs = document.querySelectorAll(".tab");
  const tabContents = document.querySelectorAll(".tab-content");

  tabs.forEach((tab) => {
    tab.addEventListener("click", function () {
      const targetTab = this.dataset.tab;

      // Remove active class from all tabs and contents
      tabs.forEach((t) => t.classList.remove("active"));
      tabContents.forEach((tc) => tc.classList.remove("active"));

      // Add active class to clicked tab and corresponding content
      this.classList.add("active");
      document.getElementById(`${targetTab}-content`).classList.add("active");

      // Load data when switching to manage tab
      if (targetTab === "manage") {
        loadAllBlocks();
      }
    });
  });

  // Initialize day selector buttons for the scheduler
  const dayButtons = document.querySelectorAll(".day-btn");
  dayButtons.forEach((btn) => {
    btn.addEventListener("click", function () {
      this.classList.toggle("selected");
    });
  });

  // Initialize quick timer selection buttons
  const quickTimers = document.querySelectorAll(".quick-timer");
  quickTimers.forEach((btn) => {
    btn.addEventListener("click", function () {
      // Remove selection from all buttons
      quickTimers.forEach((b) => b.classList.remove("selected"));
      // Select this button
      this.classList.add("selected");

      selectedTimerMinutes = parseInt(this.dataset.minutes, 10);
      updateTimerDisplay();
      updateCustomInputs();
    });
  });

  // Add event listeners for all interactive elements
  document
    .getElementById("customHours")
    .addEventListener("input", updateFromCustomInputs);
  document
    .getElementById("customMinutes")
    .addEventListener("input", updateFromCustomInputs);
  document
    .getElementById("addScheduleBtn")
    .addEventListener("click", addSchedule);
  document
    .getElementById("startTimerBtn")
    .addEventListener("click", startTimer);
  document.getElementById("stopTimerBtn").addEventListener("click", stopTimer);
  document.getElementById("exportBtn").addEventListener("click", exportBlocks);
  document.getElementById("importBtn").addEventListener("click", () => {
    document.getElementById("importFile").click();
  });
  document
    .getElementById("importFile")
    .addEventListener("change", importBlocks);

  // Load timer state
  loadTimerState();
});

// --- UI UPDATE & STATE CHECKING FUNCTIONS ---

/**
 * Updates the timer display text based on the `selectedTimerMinutes` value.
 */
function updateTimerDisplay() {
  const display = document.getElementById("timerDisplay");
  if (!display) return;

  if (selectedTimerMinutes > 0) {
    display.textContent = `Ready to block for ${formatTime(selectedTimerMinutes)}`;
    display.classList.remove("active");
  } else {
    display.textContent = "No timer set";
    display.classList.remove("active");
  }
}

/**
 * Populates the custom hour/minute input fields based on a quick-timer selection.
 */
function updateCustomInputs() {
  const hours = Math.floor(selectedTimerMinutes / 60);
  const minutes = selectedTimerMinutes % 60;
  document.getElementById("customHours").value = hours;
  document.getElementById("customMinutes").value = minutes;
}

/**
 * Updates `selectedTimerMinutes` when the user types in the custom input fields.
 */
function updateFromCustomInputs() {
  const hours = parseInt(document.getElementById("customHours").value, 10) || 0;
  const minutes =
    parseInt(document.getElementById("customMinutes").value, 10) || 0;
  selectedTimerMinutes = hours * 60 + minutes;

  // Remove selection from quick timers
  document.querySelectorAll(".quick-timer").forEach((btn) => {
    btn.classList.remove("selected");
  });

  updateTimerDisplay();
}

// --- MAIN ENTRY POINT ---

/**
 * Main entry point: queries the active tab to initialize the UI based on its URL.
 */
browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
  const tab = tabs[0];
  if (!tab) return;

  currentUrl = tab.url;
  currentOrigin = getOrigin(currentUrl);

  // Handle the special case where the user is on the "blocked.html" page
  if (tab.url.startsWith(browser.runtime.getURL("blocked.html"))) {
    browser.storage.local.get("lastBlocked").then((data) => {
      const lastBlockedOrigin = data.lastBlocked || "(unknown)";
      siteUrlEl.textContent = lastBlockedOrigin;
      actionBtn.textContent = "Unblock and Go";
      actionBtn.className = "btn-success";
      actionBtn.onclick = function () {
        if (data.lastBlocked) {
          unblockSite(data.lastBlocked, true); // Pass true to indicate redirect
        }
      };

      // Show current site info for blocked page
      currentOrigin = lastBlockedOrigin;
      showCurrentSiteInfo();
    });
    return;
  }

  // For any other page, set up the UI normally
  siteUrlEl.textContent = currentOrigin;
  checkBlockingStatus();
  showCurrentSiteInfo();
});

/**
 * Checks the block status for the current site and updates the main action button.
 */
function checkBlockingStatus() {
  Promise.all([
    browser.storage.local.get("blockedSites"),
    browser.storage.local.get("scheduledBlocks"),
    browser.storage.local.get("timerBlocks"),
  ]).then(([bs, sb, tb]) => {
    const blockedSites = bs.blockedSites || [];
    const scheduledBlocks = sb.scheduledBlocks || {};
    const timerBlocks = tb.timerBlocks || {};

    const isInstantBlocked = blockedSites.includes(currentOrigin);
    const isScheduleBlocked = isCurrentlyScheduleBlocked(
      scheduledBlocks[currentOrigin] || [],
    );
    const isTimerBlocked =
      timerBlocks[currentOrigin] &&
      timerBlocks[currentOrigin].endTime > Date.now();

    if (isInstantBlocked || isScheduleBlocked || isTimerBlocked) {
      actionBtn.textContent = "Unblock Site";
      actionBtn.className = "btn-success";
      actionBtn.onclick = function () {
        unblockSite(currentOrigin);
      };
    } else {
      actionBtn.textContent = "Block This Site";
      actionBtn.className = "btn-danger";
      actionBtn.onclick = function () {
        blockSite();
      };
    }
  });
}

/**
 * Displays all active and configured blocks for the current site in the header area.
 */
function showCurrentSiteInfo() {
  Promise.all([
    browser.storage.local.get("blockedSites"),
    browser.storage.local.get("scheduledBlocks"),
    browser.storage.local.get("timerBlocks"),
  ]).then(([bs, sb, tb]) => {
    const blockedSites = bs.blockedSites || [];
    const scheduledBlocks = sb.scheduledBlocks || {};
    const timerBlocks = tb.timerBlocks || {};

    const currentSiteHeader = document.getElementById("currentSiteHeader");
    const siteStatusBadge = document.getElementById("siteStatusBadge");
    const currentSiteBlocks = document.getElementById("currentSiteBlocks");

    /** @type {Array<BlockDetail>} */
    let blockDetails = [];
    let isCurrentlyBlocked = false;

    // Check instant block
    if (blockedSites.includes(currentOrigin)) {
      blockDetails.push({
        type: "instant",
        text: "Permanently blocked",
        id: "instant",
      });
      isCurrentlyBlocked = true;
    }

    // Check scheduled blocks
    if (scheduledBlocks[currentOrigin]) {
      scheduledBlocks[currentOrigin].forEach((schedule) => {
        const dayNames = schedule.days.map((day) => getDayName(day)).join(", ");
        const scheduleText = `${dayNames} ${schedule.startTime}-${schedule.endTime}`;
        const isActiveNow = isCurrentlyScheduleBlocked([schedule]);

        blockDetails.push({
          type: "schedule",
          text: scheduleText + (isActiveNow ? " (Active Now)" : ""),
          id: schedule.id,
          isActive: isActiveNow,
        });

        if (isActiveNow) {
          isCurrentlyBlocked = true;
        }
      });
    }

    // Check timer block
    if (timerBlocks[currentOrigin]) {
      const remaining = Math.max(
        0,
        Math.ceil(
          (timerBlocks[currentOrigin].endTime - Date.now()) / 1000 / 60,
        ),
      );
      if (remaining > 0) {
        blockDetails.push({
          type: "timer",
          text: `${formatTime(remaining)} remaining`,
          id: "timer",
          isActive: true,
        });
        isCurrentlyBlocked = true;
      }
    }

    // Update status badge
    if (isCurrentlyBlocked) {
      siteStatusBadge.textContent = "Status : Blocked";
      siteStatusBadge.className = "site-status-badge blocked";
    } else {
      siteStatusBadge.textContent = "Status : Allowed";
      siteStatusBadge.className = "site-status-badge allowed";
    }

    // Show blocks or empty state
    if (blockDetails.length > 0) {
      currentSiteBlocks.className = "current-site-blocks";
      currentSiteBlocks.innerHTML = blockDetails
        .map(
          (block) =>
            `<div class="block-item-mini">
                            <span>${block.text}</span>
                            <span class="block-type ${block.type}">${block.type}</span>
                        </div>`,
        )
        .join("");
    } else {
      currentSiteBlocks.className = "current-site-blocks";
      currentSiteBlocks.innerHTML = "No blocks configured for this site";
    }
  });
}

/**
 * Remove block from header area based on type and id.
 * @param {string} type - The type of block to remove ('instant', 'schedule', 'timer').
 * @param {string|number} id - The unique identifier of the block.
 */
function removeBlockFromHeader(type, id) {
  if (type === "instant") {
    // Remove from instant blocks
    browser.storage.local.get("blockedSites").then((bs) => {
      let blockedSites = bs.blockedSites || [];
      blockedSites = blockedSites.filter((site) => site !== currentOrigin);
      browser.storage.local.set({ blockedSites }).then(() => {
        checkBlockingStatus();
        showCurrentSiteInfo();
      });
    });
  } else if (type === "schedule") {
    // Remove specific schedule
    browser.storage.local.get("scheduledBlocks").then((sb) => {
      let scheduledBlocks = sb.scheduledBlocks || {};
      if (scheduledBlocks[currentOrigin]) {
        scheduledBlocks[currentOrigin] = scheduledBlocks[currentOrigin].filter(
          (schedule) => schedule.id != id,
        );

        if (scheduledBlocks[currentOrigin].length === 0) {
          delete scheduledBlocks[currentOrigin];
        }

        browser.storage.local.set({ scheduledBlocks }).then(() => {
          checkBlockingStatus();
          showCurrentSiteInfo();
        });
      }
    });
  } else if (type === "timer") {
    // Remove timer block
    browser.storage.local.get("timerBlocks").then((tb) => {
      let timerBlocks = tb.timerBlocks || {};
      delete timerBlocks[currentOrigin];
      browser.storage.local.set({ timerBlocks }).then(() => {
        clearInterval(timerInterval);
        document.getElementById("timerDisplay").textContent = "No timer set";
        document.getElementById("timerDisplay").classList.remove("active");
        document.getElementById("startTimerBtn").style.display = "block";
        document.getElementById("stopTimerBtn").style.display = "none";
        checkBlockingStatus();
        showCurrentSiteInfo();
      });
    });
  }
}

/**
 * Checks if any of the provided schedules are active at the current moment.
 * @param {Array<Schedule>} schedules - An array of schedule objects to check.
 * @returns {boolean} True if the site is currently blocked by a schedule.
 */
function isCurrentlyScheduleBlocked(schedules) {
  const now = new Date();
  const currentDay = now.getDay();
  const currentTime = now.getHours() * 60 + now.getMinutes();

  return schedules.some((schedule) => {
    if (!schedule.days.includes(currentDay)) return false;

    const startTime =
      parseInt(schedule.startTime.split(":")[0], 10) * 60 +
      parseInt(schedule.startTime.split(":")[1], 10);
    const endTime =
      parseInt(schedule.endTime.split(":")[0], 10) * 60 +
      parseInt(schedule.endTime.split(":")[1], 10);

    if (startTime <= endTime) {
      return currentTime >= startTime && currentTime <= endTime;
    } else {
      // Crosses midnight
      return currentTime >= startTime || currentTime <= endTime;
    }
  });
}

// --- CORE ACTION FUNCTIONS ---

/**
 * Adds the current site to the permanent block list and redirects the user.
 */
function blockSite() {
  browser.storage.local.get("blockedSites").then((bs) => {
    let list = bs.blockedSites || [];
    if (!list.includes(currentOrigin)) {
      list.push(currentOrigin);
      browser.storage.local
        .set({
          blockedSites: list,
          lastBlocked: currentOrigin,
        })
        .then(() => {
          browser.tabs.update({ url: browser.runtime.getURL("blocked.html") });
          window.close();
        });
    }
  });
}

/**
 * Removes all types of blocks (instant, schedule, timer) for a given site.
 * @param {string} [origin=currentOrigin] - The site origin to unblock.
 * @param {boolean} [shouldRedirect=false] - If true, redirects the active tab to the unblocked site.
 */
function unblockSite(origin = currentOrigin, shouldRedirect = false) {
  Promise.all([
    browser.storage.local.get("blockedSites"),
    browser.storage.local.get("scheduledBlocks"),
    browser.storage.local.get("timerBlocks"),
  ]).then(([bs, sb, tb]) => {
    let blockedSites = bs.blockedSites || [];
    let scheduledBlocks = sb.scheduledBlocks || {};
    let timerBlocks = tb.timerBlocks || {};

    // Remove from instant blocks
    blockedSites = blockedSites.filter((site) => site !== origin);

    // Remove from scheduled blocks
    delete scheduledBlocks[origin];

    // Remove from timer blocks
    delete timerBlocks[origin];

    browser.storage.local
      .set({
        blockedSites: blockedSites,
        scheduledBlocks: scheduledBlocks,
        timerBlocks: timerBlocks,
      })
      .then(() => {
        if (shouldRedirect || origin === currentOrigin) {
          // Redirect to the original site
          browser.tabs.update({ url: origin });
          window.close();
        } else {
          // Unblocking from manage tab
          loadAllBlocks();
          showCurrentSiteInfo();
          checkBlockingStatus();
        }
      });
  });
}

/**
 * Adds a new schedule for the current site based on UI selections.
 */
function addSchedule() {
  const selectedDays = Array.from(
    document.querySelectorAll(".day-btn.selected"),
  ).map((btn) => parseInt(btn.dataset.day, 10));
  const startTime = document.getElementById("scheduleStartTime").value;
  const endTime = document.getElementById("scheduleEndTime").value;

  if (selectedDays.length === 0) {
    alert("Please select at least one day.");
    return;
  }

  if (!startTime || !endTime) {
    alert("Please select start and end times.");
    return;
  }

  /** @type {Schedule} */
  const schedule = {
    id: Date.now(),
    days: selectedDays,
    startTime: startTime,
    endTime: endTime,
  };

  browser.storage.local.get("scheduledBlocks").then((sb) => {
    let scheduledBlocks = sb.scheduledBlocks || {};
    if (!scheduledBlocks[currentOrigin]) {
      scheduledBlocks[currentOrigin] = [];
    }
    scheduledBlocks[currentOrigin].push(schedule);

    browser.storage.local.set({ scheduledBlocks: scheduledBlocks }).then(() => {
      checkBlockingStatus();
      showCurrentSiteInfo();

      // Clear selection
      document.querySelectorAll(".day-btn.selected").forEach((btn) => {
        btn.classList.remove("selected");
      });

      // If schedule should block now, redirect immediately
      if (isCurrentlyScheduleBlocked([schedule])) {
        browser.storage.local.set({ lastBlocked: currentOrigin }).then(() => {
          browser.tabs.update({ url: browser.runtime.getURL("blocked.html") });
          window.close();
        });
      }
    });
  });
}

/**
 * Starts a temporary timer block for the current site.
 */
function startTimer() {
  if (selectedTimerMinutes <= 0) {
    alert("Please select a timer duration.");
    return;
  }

  const endTime = Date.now() + selectedTimerMinutes * 60 * 1000;

  browser.storage.local.get("timerBlocks").then((tb) => {
    let timerBlocks = tb.timerBlocks || {};
    timerBlocks[currentOrigin] = {
      endTime: endTime,
      duration: selectedTimerMinutes,
    };

    browser.storage.local.set({ timerBlocks: timerBlocks }).then(() => {
      // Block the site immediately
      browser.storage.local.set({ lastBlocked: currentOrigin }).then(() => {
        browser.tabs.update({ url: browser.runtime.getURL("blocked.html") });
        window.close();
      });
    });
  });
}

/**
 * Stops an active timer block for the current site.
 */
function stopTimer() {
  browser.storage.local.get("timerBlocks").then((tb) => {
    let timerBlocks = tb.timerBlocks || {};
    delete timerBlocks[currentOrigin];

    browser.storage.local.set({ timerBlocks: timerBlocks }).then(() => {
      clearInterval(timerInterval);
      document.getElementById("timerDisplay").textContent = "No timer set";
      document.getElementById("timerDisplay").classList.remove("active");
      document.getElementById("startTimerBtn").style.display = "block";
      document.getElementById("stopTimerBtn").style.display = "none";
      checkBlockingStatus();
      showCurrentSiteInfo();
    });
  });
}

// --- TIMER UI MANAGEMENT ---

/**
 * Updates the timer display every second for an active timer.
 */
function updateActiveTimerDisplay() {
  browser.storage.local.get("timerBlocks").then((tb) => {
    const timerBlocks = tb.timerBlocks || {};
    const timer = timerBlocks[currentOrigin];

    if (!timer || timer.endTime <= Date.now()) {
      // Timer expired or doesn't exist
      document.getElementById("timerDisplay").textContent = "No timer set";
      document.getElementById("timerDisplay").classList.remove("active");
      document.getElementById("startTimerBtn").style.display = "block";
      document.getElementById("stopTimerBtn").style.display = "none";
      clearInterval(timerInterval);

      if (timer) {
        // Clean up expired timer
        delete timerBlocks[currentOrigin];
        browser.storage.local.set({ timerBlocks: timerBlocks });
        checkBlockingStatus();
        showCurrentSiteInfo();
      }
      return;
    }

    const remaining = Math.max(
      0,
      Math.ceil((timer.endTime - Date.now()) / 1000 / 60),
    );
    document.getElementById("timerDisplay").textContent =
      `${formatTime(remaining)} remaining`;
    document.getElementById("timerDisplay").classList.add("active");

    // Also update the header info
    showCurrentSiteInfo();
  });
}

/**
 * Initializes the timer UI state when the popup is opened.
 */
function loadTimerState() {
  browser.storage.local.get("timerBlocks").then((tb) => {
    const timerBlocks = tb.timerBlocks || {};
    const timer = timerBlocks[currentOrigin];

    if (timer && timer.endTime > Date.now()) {
      document.getElementById("startTimerBtn").style.display = "none";
      document.getElementById("stopTimerBtn").style.display = "block";
      timerInterval = setInterval(updateActiveTimerDisplay, 1000);
      updateActiveTimerDisplay();
    }
  });
}

// --- MANAGE TAB & IMPORT/EXPORT ---

/**
 * Loads all configured blocks from storage and renders them in the "Manage" tab.
 */
function loadAllBlocks() {
  Promise.all([
    browser.storage.local.get("blockedSites"),
    browser.storage.local.get("scheduledBlocks"),
    browser.storage.local.get("timerBlocks"),
  ])
    .then(([bs, sb, tb]) => {
      const blockedSites = bs.blockedSites || [];
      const scheduledBlocks = sb.scheduledBlocks || {};
      const timerBlocks = tb.timerBlocks || {};
      const blockList = document.getElementById("blockList");

      // Clear existing content
      blockList.innerHTML = "";

      const allBlocks = [];

      // Add instant blocks
      blockedSites.forEach((site) => {
        allBlocks.push({
          site,
          type: "instant",
          details: "Permanently blocked",
          id: null, // No specific ID for instant blocks
        });
      });

      // Add scheduled blocks
      Object.entries(scheduledBlocks).forEach(([site, schedules]) => {
        schedules.forEach((schedule) => {
          const dayNames = schedule.days
            .map((day) => getDayName(day))
            .join(", ");
          const details = `${dayNames} ${schedule.startTime}-${schedule.endTime}`;
          allBlocks.push({
            site,
            type: "schedule",
            details,
            id: schedule.id, // Include schedule ID for removal
          });
        });
      });

      // Add timer blocks
      Object.entries(timerBlocks).forEach(([site, timer]) => {
        const remaining = Math.max(
          0,
          Math.ceil((timer.endTime - Date.now()) / 1000 / 60),
        );
        const details =
          remaining > 0 ? `${formatTime(remaining)} remaining` : "Expired";
        allBlocks.push({
          site,
          type: "timer",
          details,
          id: null, // No specific ID for timer blocks
        });
      });

      if (allBlocks.length === 0) {
        blockList.innerHTML = '<div class="empty-state">No blocked sites</div>';
        return;
      }

      // Create block items with proper event handlers
      allBlocks.forEach((block, index) => {
        const blockItem = document.createElement("div");
        blockItem.className = "block-item";

        // Create remove data object
        const removeData = {
          type: block.type,
          site: block.site,
          id: block.id,
        };

        blockItem.innerHTML = `
                    <div>
                        <div style="font-weight: 500;">${block.site}</div>
                        <div style="color: #718096; font-size: 0.75em;">${block.details}</div>
                    </div>
                    <div>
                        <span class="block-type ${block.type}">${block.type}</span>
                        <button class="btn-danger remove-btn" data-remove='${JSON.stringify(removeData)}'>Remove</button>
                    </div>
                `;

        blockList.appendChild(blockItem);
      });

      // Add event listeners to all remove buttons
      const removeButtons = blockList.querySelectorAll(".remove-btn");
      removeButtons.forEach((button) => {
        button.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          const removeDataStr = this.getAttribute("data-remove");
          unblockFromManage(removeDataStr);
        });
      });
    })
    .catch((error) => {
      console.error("Error loading blocks:", error);
      document.getElementById("blockList").innerHTML =
        '<div class="empty-state">Error loading blocks</div>';
    });
}

/**
 * Handles the removal of a block initiated from the "Manage" tab.
 * @param {string} removeDataStr - JSON string containing block removal data.
 */
function unblockFromManage(removeDataStr) {
  try {
    const removeData = JSON.parse(removeDataStr);

    if (removeData.type === "instant") {
      browser.storage.local.get("blockedSites").then((bs) => {
        let blockedSites = bs.blockedSites || [];
        blockedSites = blockedSites.filter((site) => site !== removeData.site);

        browser.storage.local.set({ blockedSites }).then(() => {
          // Check if this is the current site and redirect if so
          if (removeData.site === currentOrigin) {
            browser.tabs.update({ url: removeData.site });
            window.close();
            return;
          }

          // Otherwise just refresh UI components
          loadAllBlocks();
          checkBlockingStatus();
          showCurrentSiteInfo();
        });
      });
    } else if (removeData.type === "schedule") {
      browser.storage.local.get("scheduledBlocks").then((sb) => {
        let scheduledBlocks = sb.scheduledBlocks || {};

        if (scheduledBlocks[removeData.site]) {
          scheduledBlocks[removeData.site] = scheduledBlocks[
            removeData.site
          ].filter((schedule) => schedule.id !== removeData.id);

          if (scheduledBlocks[removeData.site].length === 0) {
            delete scheduledBlocks[removeData.site];
          }

          browser.storage.local.set({ scheduledBlocks }).then(() => {
            // Check if this is the current site and if it's no longer blocked
            if (removeData.site === currentOrigin) {
              // Check if site still has other blocks
              Promise.all([
                browser.storage.local.get("blockedSites"),
                browser.storage.local.get("timerBlocks"),
              ]).then(([bs, tb]) => {
                const blockedSites = bs.blockedSites || [];
                const timerBlocks = tb.timerBlocks || {};

                const isStillBlocked =
                  blockedSites.includes(currentOrigin) ||
                  (timerBlocks[currentOrigin] &&
                    timerBlocks[currentOrigin].endTime > Date.now());

                if (!isStillBlocked) {
                  // No other blocks, redirect to the site
                  browser.tabs.update({ url: removeData.site });
                  window.close();
                  return;
                }

                // Still has other blocks, just refresh UI
                loadAllBlocks();
                checkBlockingStatus();
                showCurrentSiteInfo();
              });
            } else {
              // Different site, just refresh UI
              loadAllBlocks();
              showCurrentSiteInfo(); // Update header if it affects current site
            }
          });
        }
      });
    } else if (removeData.type === "timer") {
      browser.storage.local.get("timerBlocks").then((tb) => {
        let timerBlocks = tb.timerBlocks || {};
        delete timerBlocks[removeData.site];

        browser.storage.local.set({ timerBlocks }).then(() => {
          // Check if this is the current site and redirect if so
          if (removeData.site === currentOrigin) {
            // Check if site still has other blocks
            Promise.all([
              browser.storage.local.get("blockedSites"),
              browser.storage.local.get("scheduledBlocks"),
            ]).then(([bs, sb]) => {
              const blockedSites = bs.blockedSites || [];
              const scheduledBlocks = sb.scheduledBlocks || {};

              const isStillBlocked =
                blockedSites.includes(currentOrigin) ||
                isCurrentlyScheduleBlocked(
                  scheduledBlocks[currentOrigin] || [],
                );

              if (!isStillBlocked) {
                // No other blocks, redirect to the site
                browser.tabs.update({ url: removeData.site });
                window.close();
                return;
              }

              // Still has other blocks, just refresh UI
              clearInterval(timerInterval);
              document.getElementById("timerDisplay").textContent =
                "No timer set";
              document
                .getElementById("timerDisplay")
                .classList.remove("active");
              document.getElementById("startTimerBtn").style.display = "block";
              document.getElementById("stopTimerBtn").style.display = "none";
              loadAllBlocks();
              checkBlockingStatus();
              showCurrentSiteInfo();
            });
          } else {
            // Different site, just refresh UI
            loadAllBlocks();
            showCurrentSiteInfo(); // Update header if it affects current site
          }
        });
      });
    }
  } catch (error) {
    console.error("Error removing block:", error);
    alert("Error removing block. Please try again.");
  }
}

/**
 * Exports all permanent and scheduled blocks to a downloadable JSON file.
 */
function exportBlocks() {
  Promise.all([
    browser.storage.local.get("blockedSites"),
    browser.storage.local.get("scheduledBlocks"),
  ]).then(([bs, sb]) => {
    const exportData = {
      blockedSites: bs.blockedSites || [],
      scheduledBlocks: sb.scheduledBlocks || {},
      exportDate: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `website-blocks-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

/**
 * Imports blocks from a previously exported JSON file and merges them with existing settings.
 * @param {Event} event - The `change` event from the file input element.
 */
function importBlocks(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const importData = JSON.parse(e.target.result);

      if (!importData.blockedSites && !importData.scheduledBlocks) {
        alert("Invalid file format");
        return;
      }

      // Merge with existing data
      Promise.all([
        browser.storage.local.get("blockedSites"),
        browser.storage.local.get("scheduledBlocks"),
      ]).then(([bs, sb]) => {
        const blockedSites = [
          ...new Set([
            ...(bs.blockedSites || []),
            ...(importData.blockedSites || []),
          ]),
        ];

        const scheduledBlocks = {
          ...(sb.scheduledBlocks || {}),
          ...(importData.scheduledBlocks || {}),
        };

        browser.storage.local
          .set({
            blockedSites: blockedSites,
            scheduledBlocks: scheduledBlocks,
          })
          .then(() => {
            alert("Blocks imported successfully");
            loadAllBlocks();
            checkBlockingStatus();
            showCurrentSiteInfo();
          });
      });
    } catch (error) {
      alert("Error reading file");
    }
  };
  reader.readAsText(file);
}

// --- GLOBAL EXPORTS ---

// Make functions globally accessible for inline handlers
window.unblockFromManage = unblockFromManage;
window.removeBlockFromHeader = removeBlockFromHeader;
