// Cámara y beep compartidos por los escáneres (Doble bulto, Contingencia).
// Movido tal cual desde DobleBulto.js el 16/11/2026, sin cambios de comportamiento.

// ---------- beep (el AudioContext se crea en el toque de "Escanear": iPhone lo exige) ----------
let audio = null;
function prepararAudio() {
  try { if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === "suspended") audio.resume(); } catch { audio = null; }
}
function beep(ok = true) {
  try { navigator.vibrate && navigator.vibrate(ok ? 50 : [40, 60, 40]); } catch {}
  try {
    if (!audio) return;
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = ok ? 1250 : 520; g.gain.value = 0.08;
    o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + (ok ? 0.09 : 0.18));
  } catch {}
}


// Cámara compartida entre aperturas del escáner (15/11): el iPhone vuelve a pedir permiso en cada
// getUserMedia, así que al cerrar el escáner la cámara queda abierta 2 minutos y si se vuelve a
// escanear se reusa sin preguntar. Si la app pasa a segundo plano y el escáner está cerrado se apaga;
// si el escáner está abierto, al volver se reconecta (el iPhone corta la cámara en segundo plano).
let camara = { stream: null, timer: null, enUso: false };
const camaraViva = () => camara.stream && camara.stream.getVideoTracks().some((t) => t.readyState === "live" && !t.muted);
async function obtenerCamara() {
  clearTimeout(camara.timer);
  camara.enUso = true;
  if (camaraViva()) return camara.stream;
  // La pidió index.html apenas se abrió el atajo: se usa esa (ya viene calentando)
  if (window.__camPromesa) {
    const p = window.__camPromesa; window.__camPromesa = null;
    try { camara.stream = await p; if (camaraViva()) return camara.stream; } catch { /* sigue abajo */ }
  }
  camara.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  return camara.stream;
}
function apagarCamara() {
  clearTimeout(camara.timer);
  if (camara.stream) camara.stream.getTracks().forEach((t) => t.stop());
  camara.stream = null;
}
function soltarCamara() {
  camara.enUso = false;
  clearTimeout(camara.timer);
  camara.timer = setTimeout(apagarCamara, 120000);
}
if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => { if (document.hidden && !camara.enUso) apagarCamara(); });

// iPhone (21/11): a veces Safari deja de respetar object-fit:cover (al volver a la app, al grabar pantalla o
// cuando la cámara cambia de resolución) y la imagen queda chiquita en el medio. En vez de depender de
// object-fit, se calcula a mano el tamaño que cubre la pantalla y se le pone en px al <video>.
function cubrirVideo(v) {
  if (!v || !v.videoWidth || !v.videoHeight || !v.parentElement) return;
  const W = v.parentElement.clientWidth, H = v.parentElement.clientHeight;
  if (!W || !H) return;
  const k = Math.max(W / v.videoWidth, H / v.videoHeight);
  const w = Math.ceil(v.videoWidth * k), h = Math.ceil(v.videoHeight * k);
  const st = v.style;
  const nuevo = { inset: "auto", left: `${Math.round((W - w) / 2)}px`, top: `${Math.round((H - h) / 2)}px`, width: `${w}px`, height: `${h}px`, objectFit: "fill", maxWidth: "none", maxHeight: "none" };
  for (const [k2, val] of Object.entries(nuevo)) if (st[k2] !== val) st[k2] = val;
}

// Además (21/11, 2º intento): Safari a veces pinta la imagen recortada en una franja aunque el elemento
// tenga bien el tamaño. Por eso en Palermo A/B y Doble bulto la imagen se copia cuadro a cuadro a un <canvas>
// a pantalla completa (recorte tipo "cover"); el <video> queda invisible y sigue sirviendo para leer los QR.
function espejarVideo(v, cv) {
  if (!v || !cv) return () => {};
  const ctx = cv.getContext("2d", { alpha: false });
  let id = 0, vivo = true;
  const cuadro = () => {
    if (!vivo) return;
    id = requestAnimationFrame(cuadro);
    const vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh || v.readyState < 2) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    const pw = Math.round(W * dpr), ph = Math.round(H * dpr);
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
    const k = Math.max(pw / vw, ph / vh);
    const dw = vw * k, dh = vh * k;
    try { ctx.drawImage(v, (pw - dw) / 2, (ph - dh) / 2, dw, dh); } catch (e) { /* cuadro no listo */ }
  };
  id = requestAnimationFrame(cuadro);
  return () => { vivo = false; cancelAnimationFrame(id); };
}

export { prepararAudio, beep, camaraViva, obtenerCamara, apagarCamara, soltarCamara, cubrirVideo, espejarVideo };
