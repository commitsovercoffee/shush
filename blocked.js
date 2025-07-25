/**
 * @file Script for the blocked.html page.
 * @description This script selects a random message from a predefined list and
 * displays it on the page to provide user feedback.
 */

/**
 * An array of witty messages to be displayed on the blocked page.
 * @const
 * @type {Array<string>}
 */
const messages = [
  "Access denied. But hey, at least you tried.",
  "Your prefrontal cortex called, it’s tired of your nonsense.",
  "You said you'd stop doing this. I'm helping you keep that promise.",
  "You think this will relax you? It never does.",
  "You’ve reached your daily quota of bad decisions.",
];

/**
 * A reference to the paragraph element in the DOM where the message will be displayed.
 * @const
 * @type {?HTMLElement}
 */
const messageElement = document.getElementById("message");

// Ensure the element exists before trying to modify it.
if (messageElement) {
  // Select a random index from the messages array.
  const randomIndex = Math.floor(Math.random() * messages.length);
  // Set the text content of the element to the randomly selected message.
  messageElement.textContent = messages[randomIndex];
}
