#!/usr/bin/env python3
"""Mensajes de liquidación desde el WhatsApp PERSONAL de Alejo (worker del VPS).

Corre cada minuto (/etc/cron.d/flexit-liq-wa) y dura ~55 s. Qué hace:
  * Pregunta a Supabase si hay algo que hacer (liq_wa_plan): cola pendiente o la app pidió "conectar".
  * Si hay: enciende la sesión OpenWA de Alejo (id en /root/flexit/liq-wa.sid). Si WhatsApp pide QR,
    lo publica en Supabase cada ~12 s (lo ve solo admin@flexit.app en Liquidaciones).
  * Con la sesión lista: sube los contactos (nombre + número, cada 6 h) y manda la cola de a UN
    mensaje, respetando el horario escalonado que puso la base (25–35 s entre cada uno; mínimo 25 s real).
  * Si no hay nada que hacer: APAGA la sesión. Así Chrome no queda abierto con tus chats toda la
    semana ni come memoria del VPS.
Nunca reinicia el container (eso es del guardián del bot) y nunca reintenta un envío dudoso.

Claves: /root/flexit/bot-wa.key (la misma del guardián, validada en Supabase contra bot_secreto);
la de OpenWA se lee dentro del container. Ninguna se escribe en el log.
"""
import json, os, subprocess, sys, time, urllib.request, fcntl

SB = os.environ.get("LIQ_WA_SB", "https://svlagoosmxxcsbevkrhy.supabase.co")
SBKEY = "sb_publishable_yYrDNXJECjKQJaa7xx4dww_iwugKOnI"
API = "http://localhost:2785/api"
R = os.environ.get("LIQ_WA_ROOT", "")  # solo para pruebas
CLAVE_F = R + "/root/flexit/bot-wa.key"
SID_F = R + "/root/flexit/liq-wa.sid"
# Desde 04/11 la sesión vive en un contenedor propio y liviano (motor Baileys, sin Chrome): openwa-liq.
# Si estos archivos no existen, cae al contenedor compartido del bot (comportamiento viejo).
CONT_F = R + "/root/flexit/liq-wa.container"
APIKEY_F = R + "/root/flexit/liq-wa.apikey"
LOG = R + "/var/log/flexit-liq-wa.log"
ULT_START = R + "/var/lib/flexit-liq-wa.ultimo-start"
DURACION = int(os.environ.get("LIQ_WA_DURACION", "52"))  # segundos por corrida (el cron vuelve a llamar al minuto)
LISTO = ("ready", "connected", "authenticated")

T0 = time.time()


def log(msg):
    try:
        with open(LOG, "a") as f:
            f.write(time.strftime("%F %T ") + msg + "\n")
    except OSError:
        pass


def rpc(fn, **args):
    req = urllib.request.Request(f"{SB}/rest/v1/rpc/{fn}", data=json.dumps(args).encode(), method="POST",
                                 headers={"apikey": SBKEY, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        t = r.read().decode()
        return json.loads(t) if t else None


def contenedor():
    try:
        return open(CONT_F).read().strip() or "openwa-api"
    except OSError:
        return "openwa-api"


def es_baileys():
    return contenedor() != "openwa-api"


def okey():
    try:
        k = open(APIKEY_F).read().strip()
        if k:
            return k
    except OSError:
        pass
    r = subprocess.run(["docker", "exec", contenedor(), "cat", "/app/data/.api-key"], capture_output=True, text=True, timeout=20)
    if r.returncode != 0 or not r.stdout.strip():
        raise RuntimeError("container openwa-api no responde")
    return r.stdout.strip()


def wa(metodo, ruta, body=None, timeout=30):
    """Llama a OpenWA desde adentro del container (igual que el guardián). Devuelve (código, json|texto)."""
    cmd = ["docker", "exec", "-i", contenedor(), "curl", "-s", "-m", str(timeout), "-w", "\n%{http_code}",
           "-X", metodo, "-H", f"X-API-Key: {okey()}", f"{API}{ruta}"]
    if body is not None:
        cmd[5:5] = ["-H", "Content-Type: application/json", "--data-binary", "@-"]
    r = subprocess.run(cmd, input=json.dumps(body) if body is not None else None,
                       capture_output=True, text=True, timeout=timeout + 15)
    salida, _, code = r.stdout.rpartition("\n")
    try:
        datos = json.loads(salida) if salida.strip() else None
    except ValueError:
        datos = salida[:300]
    return (int(code) if code.isdigit() else 0), datos


def estado(sid):
    code, d = wa("GET", f"/sessions/{sid}", timeout=20)
    if code == 404:
        return "no_existe"
    if isinstance(d, dict):
        d = d.get("data", d) if isinstance(d.get("data"), dict) else d
        return str(d.get("status") or d.get("state") or "desconocido").lower()
    return "sin_respuesta"


def buscar_qr(o):
    if isinstance(o, dict):
        if o.get("statusCode", 200) >= 400:
            return None
        for k in ("qrCode", "qr", "qrcode", "code", "base64", "image", "data"):
            v = o.get(k)
            if isinstance(v, str) and len(v) > 10:
                return v
        for v in o.values():
            r = buscar_qr(v)
            if r:
                return r
    return None


def qr_actual(sid):
    code, d = wa("GET", f"/sessions/{sid}/qr", timeout=20)
    return buscar_qr(d) if code == 200 else None


def contactos(sid, clave):
    code, d = wa("GET", f"/sessions/{sid}/contacts", timeout=60)
    lista = d.get("data", d) if isinstance(d, dict) else d
    if code != 200 or not isinstance(lista, list):
        log(f"contactos: respuesta {code}")
        return
    items = []
    for c in lista:
        if not isinstance(c, dict):
            continue
        cid = c.get("id")
        if isinstance(cid, dict):
            cid = cid.get("_serialized")
        nombre = c.get("name") or c.get("pushname") or c.get("shortName") or ""
        if isinstance(cid, str) and cid.endswith("@s.whatsapp.net"):  # Baileys → formato de la base
            cid = cid.split("@")[0].split(":")[0] + "@c.us"
        if isinstance(cid, str) and cid.endswith("@c.us") and nombre and c.get("isGroup") is not True:
            items.append({"chat_id": cid, "nombre": nombre})
    if items:  # nunca vaciar la lista por una respuesta rara
        r = rpc("liq_wa_contactos_subir", p_clave=clave, p_items=items)
        log(f"contactos subidos: {r}")


def arrancar(sid):
    # no más de un start cada 2 min (el arranque de Chrome tarda)
    try:
        if time.time() - os.path.getmtime(ULT_START) < 120:
            return
    except OSError:
        pass
    open(ULT_START, "w").close()
    code, d = wa("POST", f"/sessions/{sid}/start", timeout=60)
    log(f"start sesión → {code}")
    # "failed" (p. ej. reconnect attempts exhausted): OpenWA la da por "ya iniciada" y rechaza el start
    # con 400 → hay que frenarla y volver a arrancarla (04/11)
    if code == 400 and "already started" in json.dumps(d):
        c1, _ = wa("POST", f"/sessions/{sid}/stop", timeout=60)
        time.sleep(3)
        c2, _ = wa("POST", f"/sessions/{sid}/start", timeout=60)
        log(f"sesión trabada: stop → {c1}, start → {c2}")


def mandar_cola(sid, clave):
    while time.time() - T0 < DURACION:
        t = rpc("liq_wa_tomar", p_clave=clave)
        if not t or not t.get("ok"):
            log(f"tomar: {t}")
            return
        if not t.get("id"):
            time.sleep(6)
            continue
        try:
            chat = t["chat_id"]
            if es_baileys():
                chat = chat.replace("@c.us", "@s.whatsapp.net")
            code, d = wa("POST", f"/sessions/{sid}/messages/send-text", {"chatId": chat, "text": t["texto"]}, timeout=45)
            if es_baileys() and code in (400, 404, 422):  # rechazo de formato: seguro que no salió → probar @c.us
                log(f"envío #{t['id']}: {code} con {chat}, pruebo @c.us")
                code, d = wa("POST", f"/sessions/{sid}/messages/send-text", {"chatId": t["chat_id"], "text": t["texto"]}, timeout=45)
            ok = 200 <= code < 300
            if code == 0:  # curl sin respuesta (timeout): no sabemos si salió
                err = "WhatsApp no respondió a tiempo — revisá en el celu si llegó antes de reenviar"
            else:
                err = None if ok else f"OpenWA {code}: {json.dumps(d)[:200] if not isinstance(d, str) else d[:200]}"
        except Exception as e:  # timeout: no sabemos si salió → error, sin reintento
            ok, err = False, f"sin respuesta de OpenWA ({type(e).__name__}) — revisá en el celu si llegó"
        rpc("liq_wa_resultado", p_clave=clave, p_id=t["id"], p_ok=ok, p_error=err)
        log(f"envío #{t['id']} → {'OK' if ok else err}")


def main():
    lock = open(R + "/run/flexit-liq-wa.lock", "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return
    try:
        clave = open(CLAVE_F).read().strip()
        sid = open(SID_F).read().strip()
    except OSError as e:
        log(f"falta configuración: {e}")
        return

    plan = rpc("liq_wa_plan", p_clave=clave)
    if not plan or not plan.get("ok"):
        log(f"plan rechazado: {plan}")
        return

    try:
        e = estado(sid)
    except RuntimeError as ex:
        rpc("liq_wa_reportar", p_clave=clave, p_estado="container_caido", p_error=str(ex))
        return

    if not plan.get("encender"):
        if e in LISTO or e in ("initializing", "starting", "connecting", "qr", "qr_ready", "scan_qr"):
            code, _ = wa("POST", f"/sessions/{sid}/stop", timeout=60)
            log(f"sin trabajo → stop sesión ({code})")
            e = "stopped"
        rpc("liq_wa_reportar", p_clave=clave, p_estado=e)
        return

    if e in LISTO:
        rpc("liq_wa_reportar", p_clave=clave, p_estado=e)
        # PRIMERO la cola: leer contactos puede tardar > 1 min y dejaba la cola sin salir (04/11)
        mandar_cola(sid, clave)
        if plan.get("contactos"):
            try:
                contactos(sid, clave)
            except Exception as ex:
                log(f"contactos falló: {ex}")
        return

    if e == "no_existe":
        rpc("liq_wa_reportar", p_clave=clave, p_estado="no_existe",
            p_error="la sesión de OpenWA no existe — correr vps/setup-liq-wa.sh")
        return

    # no está lista: ¿pide QR? publicarlo seguido mientras dure la corrida
    q = qr_actual(sid)
    if q:
        while q and time.time() - T0 < DURACION:
            rpc("liq_wa_reportar", p_clave=clave, p_estado="qr", p_qr=q)
            time.sleep(12)
            e = estado(sid)
            if e in LISTO:
                log("QR escaneado → sesión lista")
                rpc("liq_wa_reportar", p_clave=clave, p_estado=e)
                return
            q = qr_actual(sid)
        return

    rpc("liq_wa_reportar", p_clave=clave, p_estado=e)
    if e not in ("initializing", "starting", "connecting"):
        arrancar(sid)


if __name__ == "__main__":
    try:
        main()
    except Exception as ex:
        log(f"error: {type(ex).__name__}: {ex}")
        sys.exit(1)
