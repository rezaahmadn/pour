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
  var SYNC_MS = Number(form.dataset.syncMs || 5000);

  // The server's copy, handed over with the page so both are in hand before the
  // first paint. It is what makes a draft begun on a phone reachable on a laptop.
  var savedAt = Number(form.dataset.savedAt || 0);
  var serverDraft = savedAt
    ? { body: form.dataset.savedBody || "", tags: form.dataset.savedTags || "", at: savedAt }
    : null;

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

  // Whichever copy is newer is the one to offer. Both belong to the same person,
  // so the later keystroke is the one they meant.
  var local = read();
  var saved = local;
  if (serverDraft && (!local || serverDraft.at > local.at)) saved = serverDraft;

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

  // Pushing to the server is deliberately slower and separate from the local
  // save. Local keeps the words safe on this device; this makes them reachable
  // from another one, and a failure here must never look like data loss.
  var lastPushed = null;
  function push() {
    if (handedOff || awaitingChoice) return;
    var snapshot = body.value;
    if (snapshot === lastPushed) return;
    lastPushed = snapshot;
    var payload = new URLSearchParams();
    payload.set("body", snapshot);
    payload.set("tags", tags ? tags.value : "");
    fetch("/draft", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: payload.toString(),
      credentials: "same-origin",
    }).catch(function () {
      // Offline, most likely. The local copy is still there, so say nothing and
      // let the next tick try again.
      lastPushed = null;
    });
  }
  setInterval(push, SYNC_MS);
  if (tags) tags.addEventListener("input", schedule);

  // A backgrounded tab may never get another event, so write immediately rather
  // than letting the debounce timer lose the race.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") save();
  });
  window.addEventListener("pagehide", function () {
    save();
    push();
  });

  // Pictures.
  //
  // The resize and re-encode happen here, in the browser, and that is the whole
  // point: drawing a photo onto a canvas and reading it back produces a new file
  // with none of the original's EXIF, so the GPS coordinates in a phone snapshot
  // never leave the device. The server refuses anything that did not come through
  // this path, which is why it only accepts canvas formats.
  var MAX_EDGE = 2000;
  var picker = document.getElementById("image-file");
  var imageStatus = document.getElementById("image-status");

  function sayImage(message) {
    if (imageStatus) imageStatus.textContent = message;
  }

  function reencode(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
        var canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        var ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("no canvas"));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          function (blob) {
            if (blob) resolve(blob);
            else reject(new Error("encode failed"));
          },
          "image/webp",
          0.82,
        );
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("not an image"));
      };
      img.src = url;
    });
  }

  function insertAtCursor(text) {
    var start = body.selectionStart;
    var end = body.selectionEnd;
    body.value = body.value.slice(0, start) + text + body.value.slice(end);
    body.selectionStart = body.selectionEnd = start + text.length;
    body.focus();
    save();
  }

  if (picker) {
    picker.addEventListener("change", function () {
      var file = picker.files && picker.files[0];
      if (!file) return;
      sayImage("Preparing the picture\u2026");
      reencode(file)
        .then(function (blob) {
          var payload = new FormData();
          payload.append("file", new File([blob], "image.webp", { type: "image/webp" }));
          return fetch("/upload", {
            method: "POST",
            body: payload,
            credentials: "same-origin",
          });
        })
        .then(function (res) {
          return res.json().then(function (data) {
            if (!res.ok) throw new Error(data.error || "Upload failed.");
            return data;
          });
        })
        .then(function (data) {
          insertAtCursor("\n\n" + data.markdown + "\n\n");
          sayImage("Picture added. It is stripped of location data.");
        })
        .catch(function (err) {
          sayImage(err.message || "That picture could not be added.");
        })
        .then(function () {
          picker.value = "";
        });
    });
  }

  // On success the browser leaves for the new post. On failure the server hands
  // the text back and the load path above saves it again.
  form.addEventListener("submit", function () {
    handedOff = true;
    if (timer) clearTimeout(timer);
    clear();
    say("");
  });
})();
