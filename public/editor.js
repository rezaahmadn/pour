// Draft autosave.
//
// The point of this whole project is writing on a phone, where the tab gets
// backgrounded, discarded by the OS, or refreshed by accident. Nothing here talks
// to the server: the draft lives on the device until it is published.
(function () {
  "use strict";

  var form = document.querySelector("form[data-autosave]");
  if (!form) return;

  var body = form.querySelector('[name="body"]');
  var tags = form.querySelector('[name="tags"]');
  var status = document.getElementById("draft-status");
  if (!body) return;

  var KEY = "pour.draft.v1";
  var DEBOUNCE_MS = 400;

  // iOS Safari in private mode throws on setItem rather than failing quietly, so
  // probe once and fall back to memory. Memory still survives a background and a
  // restore within the same page, just not a reload.
  var store = (function () {
    try {
      var probe = "__pour_probe__";
      window.localStorage.setItem(probe, probe);
      window.localStorage.removeItem(probe);
      return window.localStorage;
    } catch (err) {
      return null;
    }
  })();
  var memory = null;

  function read() {
    try {
      var raw = store ? store.getItem(KEY) : memory;
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function write(value) {
    var raw = JSON.stringify(value);
    if (!store) {
      memory = raw;
      return;
    }
    try {
      store.setItem(KEY, raw);
    } catch (err) {
      // Quota, most likely. Keep what we can rather than losing the draft outright.
      memory = raw;
    }
  }

  function clear() {
    memory = null;
    if (!store) return;
    try {
      store.removeItem(KEY);
    } catch (err) {
      /* nothing useful to do */
    }
  }

  function say(message) {
    if (status) status.textContent = message;
  }

  // Set once the form is on its way. Without it, the pagehide handler below fires
  // during the navigation that follows a successful publish and writes the draft
  // straight back after submit cleared it, so the next visit offers to restore a
  // post that is already published.
  var handedOff = false;

  // True while a saved draft is on offer but has not been restored or discarded.
  // Without this, opening the editor and leaving again would wipe the draft: the
  // textarea is empty at that point, and an empty editor otherwise means "discard".
  var awaitingChoice = false;

  function save() {
    if (handedOff) return;
    if (!body.value.trim()) {
      if (awaitingChoice) return;
      clear();
      say("");
      return;
    }
    write({ body: body.value, tags: tags ? tags.value : "", at: Date.now() });
    say(store ? "Draft saved on this device." : "Draft kept for this visit only.");
  }

  var timer = null;
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, DEBOUNCE_MS);
  }

  function ago(then) {
    var seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (seconds < 90) return "a moment ago";
    var minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + " minutes ago";
    var hours = Math.round(minutes / 60);
    return hours === 1 ? "an hour ago" : hours + " hours ago";
  }

  function offerRestore(draft) {
    var banner = document.createElement("div");
    banner.className = "restore";

    var text = document.createElement("span");
    text.textContent = "You have an unsaved draft from " + ago(draft.at) + ".";

    var restore = document.createElement("button");
    restore.type = "button";
    restore.textContent = "Restore it";
    restore.onclick = function () {
      awaitingChoice = false;
      body.value = draft.body;
      if (tags) tags.value = draft.tags || "";
      banner.remove();
      body.focus();
      say("Draft restored.");
    };

    var discard = document.createElement("button");
    discard.type = "button";
    discard.className = "linkish";
    discard.textContent = "Discard";
    discard.onclick = function () {
      awaitingChoice = false;
      clear();
      banner.remove();
      say("");
    };

    banner.appendChild(text);
    banner.appendChild(restore);
    banner.appendChild(discard);
    form.parentNode.insertBefore(banner, form);
  }

  var saved = read();
  if (saved && saved.body && saved.body.trim() && !body.value.trim()) {
    awaitingChoice = true;
    offerRestore(saved);
  } else if (body.value.trim()) {
    // The server re-rendered the editor with the text still in it, which happens
    // when a publish is rejected. Bank it now instead of waiting for a keystroke.
    save();
  }

  if (!store) say("Private browsing: this draft is only kept until you leave the page.");

  body.addEventListener("input", function () {
    // Typing over the offer is an answer to it: this is the draft now.
    awaitingChoice = false;
    schedule();
  });
  if (tags) tags.addEventListener("input", schedule);

  // A backgrounded tab may never get another event, so write immediately rather
  // than letting the debounce timer lose the race.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") save();
  });
  window.addEventListener("pagehide", save);

  // On success the browser leaves for the new post. On failure the server hands
  // the text back and the load path above saves it again.
  form.addEventListener("submit", function () {
    handedOff = true;
    if (timer) clearTimeout(timer);
    clear();
    say("");
  });
})();
