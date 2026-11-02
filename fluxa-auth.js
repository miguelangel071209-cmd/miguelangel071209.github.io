/* FLUXA · acceso privado con Supabase (solo clave pública; la seguridad real vive en RLS + hook del servidor) */
(function () {
  'use strict';
  var C = window.FLUXA_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var sb = null, uid = null, email = '', isAdmin = false, booted = false;
  var pending = new Map(), timers = {};

  /* ---------- Almacenamiento por usuario (aislado + sincronizado) ---------- */
  var pre = function () { return 'fx:' + uid + ':'; };
  window.LS = {
    getItem: function (k) { return localStorage.getItem(pre() + k); },
    setItem: function (k, v) { localStorage.setItem(pre() + k, v); queue(k, v); },
    removeItem: function (k) { localStorage.removeItem(pre() + k); queue(k, null); }
  };
  function queue(k, v) {
    if (!sb || !uid) return;
    pending.set(k, v);
    clearTimeout(timers[k]);
    timers[k] = setTimeout(function () { flushKey(k); }, 900);
  }
  async function flushKey(k) {
    if (!pending.has(k)) return true;
    var v = pending.get(k); pending.delete(k);
    try {
      var r = v === null
        ? await sb.from('user_data').delete().eq('user_id', uid).eq('key', k)
        : await sb.from('user_data').upsert({ user_id: uid, key: k, value: v }, { onConflict: 'user_id,key' });
      if (r.error) { pending.set(k, v); console.warn('FLUXA sync', k, r.error.message); return false; }
      return true;
    } catch (e) { pending.set(k, v); return false; }
  }
  async function flushAll() {
    var ks = Array.from(pending.keys()), ok = true;
    for (var i = 0; i < ks.length; i++) { clearTimeout(timers[ks[i]]); if (!(await flushKey(ks[i]))) ok = false; }
    return ok;
  }
  async function pull() {
    var r = await sb.from('user_data').select('key,value');
    if (r.error) throw r.error;
    r.data.forEach(function (row) { localStorage.setItem(pre() + row.key, row.value); });
    return r.data.length;
  }
  function hasLocal() {
    for (var i = 0; i < localStorage.length; i++) if (localStorage.key(i).indexOf(pre()) === 0) return true;
    return false;
  }
  /* Migración segura: datos previos (claves cs_*) se copian a la cuenta SOLO si el usuario lo confirma; el original se conserva como copia fxbak: */
  async function migrate(remoteCount) {
    var flag = 'fx:' + uid + ':__mig';
    if (remoteCount > 0 || hasLocal() || localStorage.getItem(flag)) return;
    var legacy = [];
    for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k.indexOf('cs_') === 0) legacy.push(k); }
    if (!legacy.length) return;
    localStorage.setItem(flag, '1');
    if (!confirm('Hay datos de FLUXA guardados en este dispositivo de antes de activar las cuentas.\n\n¿Importarlos a tu cuenta (' + email + ')? Acepta solo si son tuyos.')) return;
    var rows = legacy.map(function (k) { return { user_id: uid, key: k, value: localStorage.getItem(k) }; });
    var r = await sb.from('user_data').upsert(rows, { onConflict: 'user_id,key' });
    if (r.error) { alert('No se pudo importar ahora. Tus datos siguen intactos en este dispositivo.'); localStorage.removeItem(flag); return; }
    legacy.forEach(function (k, i) { localStorage.setItem(pre() + k, rows[i].value); localStorage.setItem('fxbak:' + k, rows[i].value); localStorage.removeItem(k); });
  }

  /* ---------- Interfaz de acceso ---------- */
  var st = document.createElement('style');
  st.textContent = '.fx-lock main{display:none}#fx-gate{position:fixed;inset:0;z-index:99999;background:var(--bg);display:flex;align-items:center;justify-content:center;padding:20px;overflow:auto}.fx-box{max-width:380px;width:100%;text-align:center}.fx-box img{width:84px;height:84px;border-radius:20px;margin:0 auto 8px;display:block}.fx-box h2{font-family:var(--hf);margin:6px 0}.fx-box input{margin-top:10px}#fx-bar{display:flex;gap:12px;justify-content:flex-end;align-items:center;font-size:12px;color:var(--mu);padding:4px 2px}#fx-bar a{color:var(--ac);font-weight:700;text-decoration:none}#fx-adm{position:fixed;inset:0;z-index:99998;background:var(--bg);overflow:auto;padding:16px}#fx-adm .w{max-width:560px;margin:0 auto}.fx-r{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid var(--bd);font-size:13px;word-break:break-all}.fx-r button{padding:6px 10px;border-radius:8px;border:1px solid var(--bd);background:var(--card);color:var(--tx);font-weight:700;font-size:12px}.fx-ok{color:#15803d;font-weight:700}.fx-no{color:#d33;font-weight:700}';
  document.head.appendChild(st);

  function gate(html) {
    var g = $('fx-gate');
    if (!g) { g = document.createElement('div'); g.id = 'fx-gate'; document.body.appendChild(g); }
    var logo = (document.querySelector('.hd img') || {}).src || '';
    g.innerHTML = '<div class="fx-box">' + (logo ? '<img alt="Fluxa" src="' + logo + '">' : '') + html + '</div>';
  }
  function showLoading(t) {
    gate('<p class="note">' + esc(t) + '</p>');
  }

  function showLogin(msg, bad) {
    gate(
      '<h2>Accede a FLUXA</h2>' +
      '<p class="note">Introduce tu correo y contraseña.</p>' +
      '<input id="fx-em" type="email" autocomplete="email" placeholder="tu@correo.com">' +
      '<input id="fx-pw" type="password" autocomplete="current-password" placeholder="Contraseña">' +
      '<button class="btn" id="fx-login">Entrar</button>' +
      '<p><a href="#" id="fx-register">Crear cuenta</a></p>' +
      '<p><a href="#" id="fx-reset">He olvidado mi contraseña</a></p>' +
      '<p class="note" id="fx-msg" style="' + (bad ? 'color:#d33' : '') + '">' + esc(msg || '') + '</p>'
    );

    $('fx-login').onclick = loginPassword;
    $('fx-register').onclick = function (e) {
      e.preventDefault();
      showRegister();
    };
    $('fx-reset').onclick = function (e) {
      e.preventDefault();
      resetPassword();
    };
  }

  function showRegister(msg, bad) {
    gate(
      '<h2>Crear cuenta</h2>' +
      '<p class="note">Solo podrán acceder los correos autorizados por el administrador.</p>' +
      '<input id="fx-em" type="email" autocomplete="email" placeholder="tu@correo.com">' +
      '<input id="fx-pw" type="password" autocomplete="new-password" placeholder="Crea una contraseña">' +
      '<button class="btn" id="fx-register-btn">Registrarme</button>' +
      '<p><a href="#" id="fx-back">Volver al acceso</a></p>' +
      '<p class="note" id="fx-msg" style="' + (bad ? 'color:#d33' : '') + '">' + esc(msg || '') + '</p>'
    );

    $('fx-register-btn').onclick = registerPassword;
    $('fx-back').onclick = function (e) {
      e.preventDefault();
      showLogin();
    };
  }

  async function loginPassword() {
    var em = ($('fx-em').value || '').trim().toLowerCase();
    var pw = $('fx-pw').value || '';
    var m = $('fx-msg');

    if (!em || !pw) {
      m.style.color = '#d33';
      m.textContent = 'Introduce tu correo y contraseña.';
      return;
    }

    $('fx-login').disabled = true;
    m.textContent = 'Comprobando…';

    var r = await sb.auth.signInWithPassword({ email: em, password: pw });

    $('fx-login').disabled = false;

    if (r.error) {
      m.style.color = '#d33';
      m.textContent = 'Correo o contraseña incorrectos.';
      return;
    }

    proceed(r.data.session);
  }

  async function registerPassword() {
    var em = ($('fx-em').value || '').trim().toLowerCase();
    var pw = $('fx-pw').value || '';
    var m = $('fx-msg');

    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(em)) {
      m.style.color = '#d33';
      m.textContent = 'Escribe un correo válido.';
      return;
    }

    if (pw.length < 8) {
      m.style.color = '#d33';
      m.textContent = 'La contraseña debe tener al menos 8 caracteres.';
      return;
    }

    $('fx-register-btn').disabled = true;
    m.textContent = 'Creando cuenta…';

    var r = await sb.auth.signUp({
      email: em,
      password: pw,
      options: {
        emailRedirectTo: location.origin + location.pathname
      }
    });

    $('fx-register-btn').disabled = false;

    if (r.error) {
      m.style.color = '#d33';
      m.textContent = 'No se pudo crear la cuenta. Comprueba los datos.';
      return;
    }

    if (r.data.session) {
      proceed(r.data.session);
    } else {
      showLogin('Si el correo está autorizado, confirma tu cuenta desde el email y después inicia sesión.', false);
    }
  }

  async function resetPassword() {
    var em = ($('fx-em').value || '').trim().toLowerCase();
    var m = $('fx-msg');

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      m.style.color = '#d33';
      m.textContent = 'Escribe primero tu correo.';
      return;
    }

    m.textContent = 'Enviando instrucciones…';

    var r = await sb.auth.resetPasswordForEmail(em, {
      redirectTo: location.origin + location.pathname
    });

    m.style.color = r.error ? '#d33' : '';
    m.textContent = r.error
      ? 'No se pudo enviar el correo. Inténtalo más tarde.'
      : 'Si el correo existe, recibirás instrucciones para cambiar la contraseña.';
  }

  function showRecovery() {
    gate(
      '<h2>Nueva contraseña</h2>' +
      '<input id="fx-newpw" type="password" autocomplete="new-password" placeholder="Nueva contraseña">' +
      '<button class="btn" id="fx-savepw">Guardar contraseña</button>' +
      '<p class="note" id="fx-msg"></p>'
    );

    $('fx-savepw').onclick = async function () {
      var pw = $('fx-newpw').value || '';
      var m = $('fx-msg');

      if (pw.length < 8) {
        m.style.color = '#d33';
        m.textContent = 'Usa al menos 8 caracteres.';
        return;
      }

      $('fx-savepw').disabled = true;
      m.textContent = 'Guardando…';

      var r = await sb.auth.updateUser({ password: pw });

      if (r.error) {
        $('fx-savepw').disabled = false;
        m.style.color = '#d33';
        m.textContent = 'No se pudo cambiar la contraseña. Solicita otro enlace.';
        return;
      }

      m.textContent = 'Contraseña actualizada. Entrando…';
      var s = (await sb.auth.getSession()).data.session;
      if (s) proceed(s);
    };
  }
  /* ---------- Flujo principal ---------- */
  async function check() {
    var r = await sb.rpc('my_access');
    if (r.error) return null;
    var a = Array.isArray(r.data) ? r.data[0] : r.data;
    return a || { status: 'none', role: 'user' };
  }
  async function proceed(session) {
    showLoading('Comprobando acceso…');
    uid = session.user.id; email = (session.user.email || '').toLowerCase();
    var a = await check();
    if (!a) { gate('<h2>Sin conexión con el servidor</h2><p class="note">No se pudo verificar tu acceso.</p><button class="btn" id="fx-rt">Reintentar</button>'); $('fx-rt').onclick = function () { proceed(session); }; return; }
    if (a.status !== 'authorized') { await sb.auth.signOut({ scope: 'local' }); uid = null; showLogin('Este correo no tiene acceso autorizado a FLUXA.', true); return; }
    isAdmin = a.role === 'admin';
    try { var n = await pull(); await migrate(n); }
    catch (e) { gate('<h2>No se pudieron cargar tus datos</h2><button class="btn" id="fx-rt">Reintentar</button>'); $('fx-rt').onclick = function () { proceed(session); }; return; }
    boot();
  }
  function boot() {
    booted = true;
    document.documentElement.classList.remove('fx-lock');
    var g = $('fx-gate'); if (g) g.remove();
    var bar = document.createElement('div'); bar.id = 'fx-bar';
    bar.innerHTML = '<span>' + esc(email) + '</span>' + (isAdmin ? '<a href="#" id="fx-adb">Administrar</a>' : '') + '<a href="#" id="fx-out">Cerrar sesión</a>';
    var mn = document.querySelector('main'); mn.insertBefore(bar, mn.firstChild);
    $('fx-out').onclick = function (e) { e.preventDefault(); logout(); };
    if (isAdmin) $('fx-adb').onclick = function (e) { e.preventDefault(); openAdmin(); };
    document.querySelectorAll('script[data-fx]').forEach(function (old) { var s = document.createElement('script'); s.text = old.textContent; old.replaceWith(s); });
    var recheck = async function () { var a = await check(); if (a && a.status !== 'authorized') { await sb.auth.signOut({ scope: 'local' }); location.reload(); } };
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') recheck(); else flushAll(); });
    window.addEventListener('pagehide', flushAll);
    setInterval(recheck, 300000);
  }
  async function logout() {
    var ok = await flushAll();
    if (!ok && !confirm('Algunos cambios aún no se han sincronizado. Si cierras sesión ahora podrías perderlos. ¿Cerrar sesión igualmente?')) return;
    var p = pre(), del = [];
    for (var i = 0; i < localStorage.length; i++) if (localStorage.key(i).indexOf(p) === 0) del.push(localStorage.key(i));
    del.forEach(function (k) { localStorage.removeItem(k); });
    await sb.auth.signOut({ scope: 'local' });
    location.reload();
  }

  /* ---------- Panel de administración (la seguridad real la imponen las políticas RLS) ---------- */
  async function openAdmin() {
    var o = $('fx-adm');
    if (!o) { o = document.createElement('div'); o.id = 'fx-adm'; document.body.appendChild(o); }
    o.innerHTML = '<div class="w"><div class="card"><h2>Usuarios de FLUXA</h2><input id="fx-ae" type="email" placeholder="correo@ejemplo.com"><button class="btn" id="fx-aa">Autorizar correo</button><p class="note" id="fx-am"></p></div><div class="card" id="fx-al"><p class="note">Cargando…</p></div><button class="btn" id="fx-ac" style="background:var(--card);color:var(--tx);border:1px solid var(--bd)">Cerrar panel</button></div>';
    $('fx-ac').onclick = function () { o.remove(); };
    $('fx-aa').onclick = async function () {
      var em = ($('fx-ae').value || '').trim().toLowerCase(), m = $('fx-am');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { m.textContent = 'Correo no válido.'; return; }
      var r = await sb.from('allowed_users').upsert({ email: em, status: 'authorized' }, { onConflict: 'email' });
      m.textContent = r.error ? 'Error: ' + r.error.message : '✓ ' + em + ' autorizado.';
      if (!r.error) { $('fx-ae').value = ''; list(); }
    };
    list();
  }
  async function list() {
    var box = $('fx-al'); if (!box) return;
    var r = await sb.from('allowed_users').select('email,status,role,created_at').order('created_at', { ascending: false });
    if (r.error) { box.innerHTML = '<p class="note">No tienes permiso o hubo un error.</p>'; return; }
    box.innerHTML = r.data.length ? r.data.map(function (u) {
      var me = u.email === email, ok = u.status === 'authorized';
      return '<div class="fx-r"><div>' + esc(u.email) + (u.role === 'admin' ? ' · <b>admin</b>' : '') + '<br><span class="' + (ok ? 'fx-ok' : 'fx-no') + '">' + (ok ? 'Autorizado' : 'Revocado') + '</span></div>' +
        (me ? '<span class="note">(tú)</span>' : '<button data-e="' + esc(u.email) + '" data-s="' + (ok ? 'revoked' : 'authorized') + '">' + (ok ? 'Revocar' : 'Volver a autorizar') + '</button>') + '</div>';
    }).join('') : '<p class="note">Sin usuarios.</p>';
    box.querySelectorAll('button[data-e]').forEach(function (b) {
      b.onclick = async function () {
        var r2 = await sb.from('allowed_users').update({ status: b.dataset.s }).eq('email', b.dataset.e);
        if (r2.error) alert('Error: ' + r2.error.message); list();
      };
    });
  }

  /* ---------- Inicio ---------- */
  async function init() {
    if (!window.supabase || !C.url || !C.anonKey || /TU[-_]/.test(C.url + C.anonKey)) {
      gate('<h2>Falta configurar Supabase</h2><p class="note">Edita config.js con la URL y la clave pública (anon) de tu proyecto.</p>'); return;
    }
    sb = window.supabase.createClient(C.url, C.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' } });
        var recovery = location.hash.indexOf('type=recovery') > -1;
    var hashErr = /error_description=([^&]+)/.exec(location.hash);
    var s = (await sb.auth.getSession()).data.session;

    if (recovery && s) {
      showRecovery();
    } else if (location.hash.indexOf('access_token') > -1 || hashErr) {
      history.replaceState(null, '', location.pathname + location.search);
      if (s) proceed(s);
      else showLogin(hashErr ? 'El enlace no es válido o ha caducado.' : '', !!hashErr);
    } else if (s) {
      proceed(s);
    } else {
      showLogin();
    }
    sb.auth.onAuthStateChange(function (ev) { if (ev === 'SIGNED_OUT' && booted) location.reload(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
