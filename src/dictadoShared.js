// Búsqueda por voz del Buscador de envíos (BuscarEnvio.js).
// Usa el reconocimiento de voz del navegador (Chrome, Edge, Safari): gratis, sin servidor.
// En navegadores que no lo tienen (Firefox) el botón directamente no aparece.

export function soportaDictado() {
  return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

// Al dictar un número de envío dígito por dígito, el navegador a veces lo devuelve partido
// ("1 0 4 5 9 2 8" o "104 59 28"). Se juntan los grupos cortos SOLO si son 3 o más y el
// resultado tiene 6+ dígitos (largo de un ID/envío): así "Santa Magdalena 668 1405" (calle + CP,
// dos grupos) o "Calle 70 317" no se pegan.
export function normalizarDictado(texto) {
  return String(texto || '')
    .replace(/\b\d{1,3}(?:[\s-]+\d{1,3}){2,}\b/g, (m) => {
      const junto = m.replace(/[\s-]+/g, '');
      return junto.length >= 6 ? junto : m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

// Arranca a escuchar. onTexto(texto, final) se llama mientras habla (final=false) y al terminar
// (final=true). onError(mensaje) con un texto listo para mostrar. Devuelve una función para cortar.
export function escuchar({ onTexto, onError, onFin }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SR();
  rec.lang = 'es-AR';
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  rec.onresult = (e) => {
    let t = '', final = false;
    for (let i = 0; i < e.results.length; i++) {
      t += e.results[i][0].transcript;
      if (e.results[i].isFinal) final = true;
    }
    onTexto(normalizarDictado(t), final);
  };
  rec.onerror = (e) => {
    const msg = {
      'not-allowed': 'El navegador no dio permiso para usar el micrófono: habilitalo en el candado de la barra de direcciones.',
      'service-not-allowed': 'El navegador no dio permiso para usar el micrófono.',
      'no-speech': 'No escuché nada. Tocá 🎤 y hablá cerca del micrófono.',
      'audio-capture': 'No encontré un micrófono en este equipo.',
      'network': 'El dictado necesita internet y no pudo conectarse.',
    }[e.error];
    if (e.error !== 'aborted') onError(msg || 'No se pudo usar el dictado (' + e.error + ').');
  };
  rec.onend = () => onFin && onFin();
  rec.start();
  return () => { try { rec.stop(); } catch { /* ya terminó */ } };
}
