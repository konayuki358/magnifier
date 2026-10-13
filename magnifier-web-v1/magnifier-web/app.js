"use strict";

// Camera frames are displayed locally. Nothing is uploaded or saved.
const $ = (selector) => document.querySelector(selector);
const video = $("#camera");
const still = $("#still");
const stage = $("#cameraStage");
const message = $("#cameraMessage");
const messageTitle = $("#messageTitle");
const messageDetail = $("#messageDetail");
const retryButton = $("#retryButton");
const controls = $("#controls");
const zoomRange = $("#zoomRange");
const zoomText = $("#zoomText");
const torchButton = $("#torchButton");
const freezeButton = $("#freezeButton");
const freezeLabel = $("#freezeLabel");
const freezeIcon = $("#freezeIcon");

const MAX_USER_ZOOM = 8;
let stream = null;
let cameraTrack = null;
let userZoom = 1;
let cameraBaseZoom = 1;
let cameraMinZoom = 1;
let cameraMaxZoom = 1;
let nativeZoom = 1;
let nativeZoomAvailable = false;
let torchAvailable = false;
let torchOn = false;
let frozen = false;
let opening = false;
let applying = false;
let needApply = false;
let pinch = null;

const clamp = (number, min, max) => Math.min(max, Math.max(min, number));
const round = (number, digits = 2) => Number(number.toFixed(digits));

function showMessage(title, detail, retry = false) {
  messageTitle.textContent = title;
  messageDetail.textContent = detail;
  retryButton.hidden = !retry;
  message.hidden = false;
  controls.hidden = true;
}

function showCamera() {
  message.hidden = true;
  controls.hidden = false;
}

function applyPreviewZoom() {
  // Camera hardware zoom first, CSS enlargement only beyond hardware limits.
  const physicalFactor = nativeZoomAvailable ? nativeZoom / cameraBaseZoom : 1;
  const cssZoom = Math.max(1, userZoom / physicalFactor);
  const transform = `scale(${cssZoom})`;
  video.style.transform = transform;
  still.style.transform = transform;
}

function setZoom(zoom) {
  userZoom = round(clamp(zoom, 1, MAX_USER_ZOOM), 1);
  zoomRange.value = String(userZoom);
  zoomRange.style.setProperty("--range-pct", `${((userZoom - 1) / (MAX_USER_ZOOM - 1)) * 100}%`);
  zoomText.textContent = `${userZoom.toFixed(1)}×`;
  applyPreviewZoom();
  queueCameraUpdate();
}

function desiredNativeZoom() {
  return clamp(round(cameraBaseZoom * userZoom), cameraMinZoom, cameraMaxZoom);
}

// Serialize hardware constraint requests. Pinch events can arrive faster than
// applyConstraints() completes, and overlapping calls can otherwise race.
function queueCameraUpdate() {
  if (!cameraTrack || (!nativeZoomAvailable && !torchAvailable)) return;
  needApply = true;
  if (applying) return;
  void runCameraUpdates();
}

async function runCameraUpdates() {
  applying = true;
  while (needApply && cameraTrack?.readyState === "live") {
    needApply = false;
    const desiredZoom = desiredNativeZoom();
    const advanced = {};
    if (nativeZoomAvailable) advanced.zoom = desiredZoom;
    if (torchAvailable) advanced.torch = torchOn;
    if (Object.keys(advanced).length === 0) break;

    try {
      await cameraTrack.applyConstraints({ advanced: [advanced] });
      if (nativeZoomAvailable) nativeZoom = desiredZoom;
    } catch (error) {
      // Some phones report a capability but don't actually support changing it.
      // Retry with zoom alone, then fall back to enlarging the video element.
      if (torchAvailable && nativeZoomAvailable) {
        torchAvailable = false;
        torchOn = false;
        torchButton.disabled = true;
        torchButton.setAttribute("aria-pressed", "false");
        torchButton.setAttribute("aria-label", "この端末ではライトを利用できません");
        needApply = true;
      } else if (nativeZoomAvailable) {
        nativeZoomAvailable = false;
        nativeZoom = cameraBaseZoom;
      } else {
        torchAvailable = false;
        torchOn = false;
        torchButton.disabled = true;
        torchButton.setAttribute("aria-pressed", "false");
        torchButton.setAttribute("aria-label", "この端末ではライトを利用できません");
      }
    }
    applyPreviewZoom();
  }
  applying = false;
}

function resetCameraOptions() {
  userZoom = 1;
  frozen = false;
  torchOn = false;
  cameraBaseZoom = 1;
  cameraMinZoom = 1;
  cameraMaxZoom = 1;
  nativeZoom = 1;
  nativeZoomAvailable = false;
  torchAvailable = false;
  still.classList.remove("visible");
  freezeButton.setAttribute("aria-pressed", "false");
  freezeButton.setAttribute("aria-label", "映像を一時停止する");
  freezeLabel.textContent = "一時停止";
  freezeIcon.innerHTML = '<rect x="6" y="5" width="4" height="14" rx="1"></rect><rect x="14" y="5" width="4" height="14" rx="1"></rect>';
  torchButton.setAttribute("aria-pressed", "false");
  torchButton.setAttribute("aria-label", "ライトをつける");
  torchButton.disabled = true;
  setZoom(1);
}

function errorDescription(error) {
  if (!window.isSecureContext) return "カメラはHTTPSのサイトでのみ利用できます。GitHub Pagesで公開してから開いてください。";
  if (error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError") return "ブラウザの設定でカメラを許可してから、もう一度お試しください。";
  if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") return "利用できるカメラが見つかりませんでした。";
  if (error?.name === "NotReadableError" || error?.name === "TrackStartError") return "ほかのアプリがカメラを使用しているかもしれません。閉じてからお試しください。";
  return "カメラの起動に失敗しました。ブラウザのカメラ設定を確認して、もう一度お試しください。";
}

async function openCamera() {
  if (opening) return;
  opening = true;
  showMessage("カメラを起動しています…", "カメラへのアクセスを許可してください。");
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera API unavailable");
    if (stream) stream.getTracks().forEach((track) => track.stop());
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }
    });
    cameraTrack = stream.getVideoTracks()[0];
    video.srcObject = stream;
    await video.play();
    resetCameraOptions();
    const caps = typeof cameraTrack.getCapabilities === "function" ? cameraTrack.getCapabilities() : {};
    const settings = typeof cameraTrack.getSettings === "function" ? cameraTrack.getSettings() : {};
    if (caps.zoom && Number.isFinite(caps.zoom.min) && Number.isFinite(caps.zoom.max) && caps.zoom.max > caps.zoom.min) {
      cameraMinZoom = caps.zoom.min;
      cameraMaxZoom = caps.zoom.max;
      cameraBaseZoom = clamp(Number(settings.zoom) || 1, cameraMinZoom, cameraMaxZoom);
      nativeZoom = cameraBaseZoom;
      nativeZoomAvailable = true;
    }
    torchAvailable = caps.torch === true;
    torchButton.disabled = !torchAvailable;
    if (!torchAvailable) {
      torchButton.title = "この端末ではライトを利用できません";
      torchButton.setAttribute("aria-label", "この端末ではライトを利用できません");
    } else {
      torchButton.title = "";
    }
    showCamera();
  } catch (error) {
    console.warn("Camera unavailable:", error?.name || "unknown error");
    showMessage("カメラを使用できません", errorDescription(error), true);
  } finally {
    opening = false;
  }
}

zoomRange.addEventListener("input", () => setZoom(Number(zoomRange.value)));

// Pinch on the camera image. Controls remain normally clickable and draggable.
function touchDistance(touches) {
  return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
}
stage.addEventListener("touchstart", (event) => {
  if (event.touches.length === 2) {
    pinch = { distance: touchDistance(event.touches), initialZoom: userZoom };
    event.preventDefault();
  }
}, { passive: false });
stage.addEventListener("touchmove", (event) => {
  if (pinch && event.touches.length === 2) {
    event.preventDefault();
    const current = touchDistance(event.touches);
    if (pinch.distance > 0) setZoom(pinch.initialZoom * current / pinch.distance);
  }
}, { passive: false });
for (const type of ["touchend", "touchcancel"]) {
  stage.addEventListener(type, (event) => {
    if (event.touches.length < 2) pinch = null;
  }, { passive: true });
}

torchButton.addEventListener("click", () => {
  if (!torchAvailable || !cameraTrack) return;
  torchOn = !torchOn;
  torchButton.setAttribute("aria-pressed", String(torchOn));
  torchButton.setAttribute("aria-label", torchOn ? "ライトを消す" : "ライトをつける");
  queueCameraUpdate();
});

freezeButton.addEventListener("click", () => {
  if (!cameraTrack) return;
  if (!frozen) {
    if (!video.videoWidth || !video.videoHeight) return;
    still.width = video.videoWidth;
    still.height = video.videoHeight;
    const ctx = still.getContext("2d", { alpha: false });
    ctx.drawImage(video, 0, 0, still.width, still.height);
    still.classList.add("visible");
    frozen = true;
    freezeLabel.textContent = "再開";
    freezeIcon.innerHTML = '<path d="m8 5 11 7-11 7z"></path>';
    freezeButton.setAttribute("aria-pressed", "true");
    freezeButton.setAttribute("aria-label", "映像を再開する");
  } else {
    still.classList.remove("visible");
    frozen = false;
    freezeLabel.textContent = "一時停止";
    freezeIcon.innerHTML = '<rect x="6" y="5" width="4" height="14" rx="1"></rect><rect x="14" y="5" width="4" height="14" rx="1"></rect>';
    freezeButton.setAttribute("aria-pressed", "false");
    freezeButton.setAttribute("aria-label", "映像を一時停止する");
  }
});
retryButton.addEventListener("click", () => void openCamera());
window.addEventListener("pagehide", () => {
  if (stream) stream.getTracks().forEach((track) => track.stop());
});

// Cache app files after the first visit; camera access still requires permission.
if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

setZoom(1);
void openCamera();
