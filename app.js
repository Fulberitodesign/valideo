const App = (() => {
/* ---------------- Stockage hors ligne (IndexedDB) ---------------- */
const DB = {
  db: null, mem: { kv: {}, files: {} },
  async open() {
    try {
      this.db = await new Promise((res, rej) => {
        const r = indexedDB.open('valideo', 1);
        r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('files'); };
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
    } catch (e) { this.db = null; }
  },
  req(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(store, mode); const r = fn(t.objectStore(store));
      t.oncomplete = () => res(r ? r.result : undefined); t.onerror = () => rej(t.error);
    });
  },
  async get(s, k) { return this.db ? this.req(s, 'readonly', o => o.get(k)) : this.mem[s][k]; },
  async put(s, k, v) { if (!this.db) { this.mem[s][k] = v; return; } return this.req(s, 'readwrite', o => o.put(v, k)); },
  async del(s, k) { if (!this.db) { delete this.mem[s][k]; return; } return this.req(s, 'readwrite', o => o.delete(k)); },
  async keys(s) { return this.db ? this.req(s, 'readonly', o => o.getAllKeys()) : Object.keys(this.mem[s]); },
  async clear(s) { if (!this.db) { this.mem[s] = {}; return; } return this.req(s, 'readwrite', o => o.clear()); }
};

/* ---------------- Utilitaires ---------------- */
let S = null, view = { as: 'me' }, route = { page: 'dashboard', id: null };
let projFilter = 'en_cours', invFilter = 'all', curVer = {}, pendingPin = null, draft = null, notifyCtx = null, pendingConfirm = null, sigDirty = false;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
const iso = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
const today = () => iso(new Date());
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return iso(x); };
const diffDays = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);
const fdate = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const ftime = s => new Date(s).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const round = n => Math.round(n * 100) / 100;
const zeroDec = () => /CFA|XOF|XAF|FCFA|GNF|FC/i.test(S.settings.currency);
const fmt = n => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: zeroDec() ? 0 : 2, maximumFractionDigits: zeroDec() ? 0 : 2 }) + ' ' + S.settings.currency;
const FPS = 25;
const tc = sec => { sec = Math.max(0, sec || 0); const f = Math.floor((sec % 1) * FPS), s = Math.floor(sec) % 60, m = Math.floor(sec / 60) % 60, h = Math.floor(sec / 3600); return [h, m, s, f].map(x => String(x).padStart(2, '0')).join(':'); };
const pill = (k, l) => `<span class="pill ${k}">${esc(l)}</span>`;
const initials = s => (s || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
const proj = id => S.projects.find(p => p.id === id);
const client = id => S.clients.find(c => c.id === id);
const invoice = id => S.invoices.find(i => i.id === id);
const mediaById = id => S.media.find(m => m.id === id);
const cname = c => c ? (c.company || c.name) : '—';
const isOwner = () => view.as === 'me';
const TYPE_LABEL = { video: 'VIDÉO', audio: 'AUDIO', image: 'IMAGE' };
const DEFAULT_STEPS = ['Brief & devis validés', 'Dérushage', 'Montage V1', 'Retours client', 'Corrections / V2', 'Étalonnage & mixage', 'Livraison des fichiers'];
const COLORS = ['#0b7285', '#1c3d5a', '#5f3dc4', '#c2255c', '#d9480f', '#2b8a3e', '#212529'];
const TEMPLATES = [['moderne', 'Moderne'], ['classique', 'Classique'], ['epure', 'Épuré'], ['lateral', 'Bande latérale'], ['prestige', 'Prestige'], ['encadre', 'Encadré']];
const tplName = k => (TEMPLATES.find(t => t[0] === k) || [k, k])[1];
let layout = { clients: 'grid', projects: 'list', invoices: 'list' };
try { Object.assign(layout, JSON.parse(localStorage.getItem('valideo-layout')) || {}); } catch (e) {}
const viewToggle = k => `<div class="vtoggle" role="group" aria-label="Affichage"><button class="${layout[k] === 'list' ? 'on' : ''}" onclick="App.setLayout('${k}','list')" title="Liste" aria-label="Affichage en liste"><svg viewBox="0 0 16 16"><path d="M2 3.5h12M2 8h12M2 12.5h12"/></svg></button><button class="${layout[k] === 'grid' ? 'on' : ''}" onclick="App.setLayout('${k}','grid')" title="Grille" aria-label="Affichage en grille"><svg viewBox="0 0 16 16"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg></button></div>`;
function setLayout(k, v) { layout[k] = v; try { localStorage.setItem('valideo-layout', JSON.stringify(layout)); } catch (e) {} render(); }
const METHODS = ['Virement', 'Mobile Money', 'Espèces', 'Carte bancaire', 'Chèque', 'PayPal'];

const CFG = window.VALIDEO_CONFIG || {};
let MODE = 'app', PORTAL_TOKEN = null, sb = null, user = null;
const portalLink = cid => S.portals?.[cid] ? `${CFG.siteUrl || location.origin + location.pathname}?portail=${S.portals[cid]}` : null;

let saveT;
function save() {
  if (MODE === 'portal') return;
  clearTimeout(saveT); saveT = setTimeout(() => DB.put('kv', 'state', S).catch(() => toast("L'enregistrement local a échoué. Exportez une sauvegarde depuis Réglages.")), 200);
  Cloud.schedulePush();
}
function log(pid, text) { S.activity.unshift({ at: new Date().toISOString(), pid, text }); S.activity = S.activity.slice(0, 300); }

/* ---------------- Fichiers ---------------- */
const urlCache = {};
async function fileURL(id) {
  if (!id) return null; if (urlCache[id]) return urlCache[id];
  if (MODE === 'portal') return S.urls?.[id] || null;
  const b = await DB.get('files', id).catch(() => null);
  if (b) return (urlCache[id] = URL.createObjectURL(b));
  if (user && S.cloud.uploaded[id]) { const { data } = await sb.storage.from(Cloud.BUCKET).createSignedUrl(`${user.id}/${id}`, 3600).catch(() => ({})); if (data?.signedUrl) return (urlCache[id] = data.signedUrl); }
  return null;
}
/* Suppression automatique des médias X jours après validation */
const purgeDate = m => m.approvedAt && +S.settings.retentionDays ? addDays(m.approvedAt, +S.settings.retentionDays) : null;
async function purgeExpired() {
  if (MODE === 'portal' || !+S.settings.retentionDays) return;
  let changed = false;
  for (const m of S.media) {
    const d = purgeDate(m); if (m.purged || !d || d > today()) continue;
    for (const v of m.versions) {
      await DB.del('files', v.fileId).catch(() => {}); if (urlCache[v.fileId]) { URL.revokeObjectURL(urlCache[v.fileId]); delete urlCache[v.fileId]; }
      if (S.cloud.uploaded[v.fileId]) { S.cloud.pendingDel.push(v.fileId); delete S.cloud.uploaded[v.fileId]; }
    }
    m.purged = today(); changed = true;
    log(m.projectId, `Fichiers de « ${m.name} » supprimés (V1 à V${m.versions.at(-1).v}), ${S.settings.retentionDays} j après validation`);
  }
  if (changed) { save(); render(); }
}
function readDataURL(file) { return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); }); }
async function readImage(file, max = 600) {
  const src = await readDataURL(file);
  return new Promise((res, rej) => { const img = new Image(); img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)); const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); res(cv.toDataURL('image/png')); }; img.onerror = rej; img.src = src; });
}
function download(name, blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }

/* ---------------- Calculs ---------------- */
function progress(p) { if (!p.steps.length) return 0; return Math.round(p.steps.reduce((a, s) => a + (s.me ? .5 : 0) + (s.client ? .5 : 0), 0) / p.steps.length * 100); }
function totals(i) {
  const sub = i.lines.reduce((a, l) => a + (+l.qty || 0) * (+l.price || 0), 0);
  const d = i.discount || { type: 'pct', value: 0 };
  const disc = d.type === 'pct' ? sub * (+d.value || 0) / 100 : Math.min(Math.max(sub, 0), +d.value || 0);
  const ht = sub - disc, tva = ht * (+i.tva || 0) / 100, ttc = ht + tva;
  const paid = (i.payments || []).reduce((a, p) => a + (+p.amount || 0), 0);
  return { sub: round(sub), disc: round(disc), ht: round(ht), tva: round(tva), ttc: round(ttc), paid: round(paid), due: Math.max(0, round(ttc - paid)) };
}
const INV_LABEL = { brouillon: ['Brouillon', ''], a_verifier: ['À vérifier', 'warn'], envoyee: ['Envoyée', 'info'], partielle: ['Paiement partiel', 'info'], retard: ['En retard', 'bad'], payee: ['Payée', 'ok'] };
function invStatus(i) {
  if (i.status === 'brouillon' || i.status === 'a_verifier') return i.status;
  const t = totals(i); if (t.due <= 0.005) return 'payee';
  if (i.due < today()) return 'retard';
  return t.paid > 0 ? 'partielle' : 'envoyee';
}
const isSent = i => !['brouillon', 'a_verifier'].includes(i.status);
const invPill = i => { const [l, k] = INV_LABEL[invStatus(i)]; return pill(k, l); };
function deadlinePill(p) {
  if (p.status === 'termine') return pill('ok', 'Terminé');
  if (!p.deadline) return '';
  const d = diffDays(today(), p.deadline);
  if (d < 0) return pill('bad', `Délai dépassé · ${-d} j`);
  if (d === 0) return pill('bad', "Livraison aujourd'hui");
  if (d <= 3) return pill('warn', `J-${d}`);
  return pill('', `J-${d}`);
}
function clientStats(cid) {
  const ps = S.projects.filter(p => p.clientId === cid);
  const inv = S.invoices.filter(i => i.clientId === cid && isSent(i));
  let billed = 0, paid = 0, due = 0, late = 0;
  inv.forEach(i => { const t = totals(i); billed += t.ttc; paid += t.paid; due += t.due; if (invStatus(i) === 'retard') late += t.due; });
  return { ps, inv, active: ps.filter(p => p.status !== 'termine').length, done: ps.filter(p => p.status === 'termine').length, value: ps.reduce((a, p) => a + (+p.amount || 0), 0), billed, paid, due, late };
}
function nextNumber() { const st = S.settings; const n = `${st.prefix}-${new Date().getFullYear()}-${String(st.next).padStart(3, '0')}`; st.next++; return n; }

/* ---------------- Automatisation : fin de projet → facture ---------------- */
function createInvoiceFromProject(p, status) {
  const lines = [{ label: `${p.title} — montage vidéo`, qty: 1, price: +p.amount || 0 }];
  S.invoices.filter(i => i.projectId === p.id && i.kind === 'acompte').forEach(i => lines.push({ label: `Acompte déjà facturé (${i.number})`, qty: 1, price: -totals(i).ht }));
  const i = { id: uid(), number: nextNumber(), clientId: p.clientId, projectId: p.id, kind: 'final', date: today(), due: addDays(today(), +S.settings.payDays || 30), lines, discount: { type: 'pct', value: 0 }, tva: +S.settings.tva || 0, notes: '', status, payments: [], reminders: [], auto: status === 'a_verifier' };
  S.invoices.push(i);
  log(p.id, status === 'a_verifier' ? `Facture ${i.number} générée automatiquement, en attente de votre vérification` : `Facture ${i.number} créée`);
  return i;
}
function checkCompletion(p) {
  const done = p.steps.length > 0 && p.steps.every(s => s.me && s.client);
  if (done && p.status !== 'termine') {
    p.status = 'termine'; p.doneAt = today();
    if (MODE === 'portal') return;
    log(p.id, 'Projet terminé : toutes les étapes sont validées des deux côtés');
    if (!S.invoices.some(i => i.projectId === p.id && i.kind === 'final')) {
      const i = createInvoiceFromProject(p, 'a_verifier');
      setTimeout(() => toast(`Projet terminé. Facture ${i.number} générée (${fmt(totals(i).ttc)}), à vérifier avant envoi.`, isOwner() ? 'Vérifier' : null, () => go('invoice', i.id)), 50);
    }
  } else if (!done && p.status === 'termine') { p.status = 'en_cours'; p.doneAt = null; }
}

/* ---------------- Alertes ---------------- */
function alerts() {
  const out = [], t0 = today();
  S.invoices.forEach(i => {
    const c = client(i.clientId), t = totals(i), st = invStatus(i);
    if (st === 'a_verifier') out.push({ lvl: 'warn', title: `Facture ${i.number} à vérifier`, sub: `${i.auto ? 'Générée à la fin du projet' : 'Brouillon'} · ${cname(c)} · ${fmt(t.ttc)}`, act: [['Vérifier', `App.go('invoice','${i.id}')`]] });
    if (st === 'retard') { const d = diffDays(i.due, t0); const last = i.reminders?.length ? ` · relancée le ${fdate(i.reminders.at(-1))}` : ''; out.push({ lvl: 'bad', title: `${i.number} impayée depuis ${d} j`, sub: `${cname(c)} · reste ${fmt(t.due)}${last}`, act: [['Relancer', `App.remind('${i.id}')`]] }); }
    if ((st === 'envoyee' || st === 'partielle')) { const d = diffDays(t0, i.due); if (d <= 5) out.push({ lvl: 'info', title: `Échéance ${d === 0 ? "aujourd'hui" : 'dans ' + d + ' j'} · ${i.number}`, sub: `${cname(c)} · ${fmt(t.due)}`, act: [['Voir', `App.go('invoice','${i.id}')`]] }); }
  });
  S.projects.forEach(p => {
    if (p.status === 'termine' || !p.deadline) return;
    const d = diffDays(t0, p.deadline);
    if (d < 0) out.push({ lvl: 'bad', title: `Délai dépassé : ${p.title}`, sub: `Livraison prévue le ${fdate(p.deadline)} · ${progress(p)} %`, act: [['Ouvrir', `App.go('project','${p.id}')`]] });
    else if (d <= 3) out.push({ lvl: 'warn', title: `Livraison ${d === 0 ? "aujourd'hui" : 'dans ' + d + ' j'} : ${p.title}`, sub: `${cname(client(p.clientId))} · ${progress(p)} %`, act: [['Ouvrir', `App.go('project','${p.id}')`]] });
    p.steps.filter(s => s.client && !s.me).forEach(s => out.push({ lvl: 'info', title: `Le client a validé « ${s.label} »`, sub: `${p.title} · à confirmer de votre côté`, act: [['Confirmer', `App.toggleStep('${p.id}','${s.id}','me')`]] }));
  });
  S.media.forEach(m => {
    const pd = purgeDate(m);
    if (pd && !m.purged && diffDays(t0, pd) <= 2) out.push({ lvl: 'info', title: `Fichiers de « ${m.name} » supprimés ${pd === t0 ? "aujourd'hui" : 'le ' + fdate(pd)}`, sub: `Validé le ${fdate(m.approvedAt)} · libère de l'espace de stockage`, act: [['Voir', `App.go('media','${m.id}')`]] });
    const n = m.comments.filter(c => c.author === 'client' && !c.resolved).length;
    if (n) out.push({ lvl: 'info', title: `${n} retour${n > 1 ? 's' : ''} client à traiter`, sub: `${m.name} · ${proj(m.projectId)?.title || ''}`, act: [['Ouvrir', `App.go('media','${m.id}')`]] });
  });
  const o = { bad: 0, warn: 1, info: 2 };
  return out.sort((a, b) => o[a.lvl] - o[b.lvl]);
}
function alertList(list) {
  if (!list.length) return `<p class="empty">Rien d'urgent. Les relances, délais et retours clients apparaîtront ici.</p>`;
  return `<div class="alerts">${list.map(a => `<div class="alert ${a.lvl}"><span class="sev"></span><div><div class="a-t">${esc(a.title)}</div><div class="a-s">${esc(a.sub)}</div></div><div class="row">${a.act.map(([l, js]) => `<button class="btn sm" onclick="${js}">${l}</button>`).join('')}</div></div>`).join('')}</div>`;
}

/* ---------------- Rendu ---------------- */
function navHTML() {
  if (!isOwner()) {
    const c = client(view.clientId); const ps = S.projects.filter(p => p.clientId === c.id);
    return `<button class="${route.page === 'client' ? 'on' : ''}" onclick="App.go('client','${c.id}')">Mon espace</button><div class="nav-label">Mes projets</div>` +
      ps.map(p => `<button class="sub ${route.id === p.id ? 'on' : ''}" onclick="App.go('project','${p.id}')"><span>${esc(p.title)}</span></button>`).join('');
  }
  const parent = { client: 'clients', project: 'projects', media: 'projects', invoice: 'invoices' }[route.page] || route.page;
  const nA = alerts().filter(a => a.lvl !== 'info').length, nV = S.invoices.filter(i => i.status === 'a_verifier').length;
  const items = [['dashboard', 'Tableau de bord', nA], ['clients', 'Clients'], ['projects', 'Projets'], ['invoices', 'Factures', nV], ['accounting', 'Comptabilité'], ['settings', 'Identité & réglages']];
  return items.map(([k, l, n]) => `<button class="${parent === k ? 'on' : ''}" onclick="App.go('${k}')"><span>${l}</span>${n ? `<span class="badge">${n}</span>` : ''}</button>`).join('');
}
function render() {
  if (!isOwner() && !client(view.clientId)) view = { as: 'me' };
  $('#nav').innerHTML = navHTML();
  $('#role').innerHTML = `<option value="me">Ma vue (monteur)</option><optgroup label="Voir comme un client">` + S.clients.map(c => `<option value="${c.id}">${esc(cname(c))}</option>`).join('') + '</optgroup>';
  $('#role-box').classList.toggle('client', !isOwner());
  $('#role').value = isOwner() ? 'me' : view.clientId;
  const r = route; let html;
  if (isOwner()) {
    html = ({ dashboard: pDashboard, clients: pClients, client: pClient, projects: pProjects, project: pProject, media: pMedia, invoices: pInvoices, invoice: pInvoice, accounting: pAccounting, settings: pSettings }[r.page] || pDashboard)(r.id);
  } else {
    const cid = view.clientId; let ok = false;
    if (r.page === 'project') ok = proj(r.id)?.clientId === cid;
    if (r.page === 'media') ok = proj(mediaById(r.id)?.projectId)?.clientId === cid;
    if (r.page === 'invoice') { const i = invoice(r.id); ok = i && i.clientId === cid && isSent(i); }
    if (!ok) { route = { page: 'client', id: cid }; }
    html = (MODE === 'portal' ? '' : `<div class="banner client"><span>Aperçu de l'espace client de <b>${esc(cname(client(cid)))}</b> : ce que votre client voit et peut faire (valider ses étapes, commenter les médias, consulter ses factures).</span><button class="btn sm" onclick="App.setRole('me')">Revenir à mon espace</button></div>`) +
      ({ client: pClient, project: pProject, media: pMedia, invoice: pInvoice }[route.page])(route.id);
  }
  $('#main').innerHTML = html;
  $('#sync').innerHTML = syncChip(); $('#sync').hidden = MODE === 'portal';
  afterRender();
}
function syncChip() {
  if (!Cloud.ready) return `<span class="dot"></span>Données sur cet appareil`;
  if (!user) return `<span class="dot off"></span>Non connecté · se connecter`;
  if (!navigator.onLine) return `<span class="dot off"></span>Hors ligne · synchro au retour`;
  return { ok: '<span class="dot ok"></span>Synchronisé', sync: '<span class="dot sync"></span>Synchronisation…', upload: '<span class="dot sync"></span>Envoi des fichiers…', error: '<span class="dot error"></span>Erreur de synchro · réessayer' }[Cloud.status] || '<span class="dot ok"></span>Connecté';
}
function go(page, id = null) { route = { page, id }; pendingPin = null; closeModal(); render(); window.scrollTo(0, 0); }
function setRole(v) {
  view = v === 'me' ? { as: 'me' } : { as: 'client', clientId: v };
  try { localStorage.setItem('valideo-view', JSON.stringify(view)); } catch (e) {}
  route = v === 'me' ? { page: 'dashboard' } : { page: 'client', id: v }; render(); window.scrollTo(0, 0);
}
const nf = () => `<p class="empty">Élément introuvable. <a onclick="App.go('dashboard')">Retour au tableau de bord</a></p>`;
const kpi = (l, v, s = '', tone = '') => `<div class="kpi ${tone}"><span class="k-l">${l}</span><span class="k-v">${v}</span><span class="k-s">${s}</span></div>`;
function projRow(p, showClient = true) {
  const pr = progress(p);
  return `<button class="prow" onclick="App.go('project','${p.id}')"><div><div class="t">${esc(p.title)}</div><div class="s">${showClient ? esc(cname(client(p.clientId))) + ' · ' : ''}${fmt(p.amount)} HT · livraison ${fdate(p.deadline)}</div><div class="prog"><div class="bar ${pr === 100 ? 'done' : ''}"><i style="width:${pr}%"></i></div><span class="mono small">${pr}%</span></div></div><div>${deadlinePill(p)}</div></button>`;
}

/* ----- Tableau de bord ----- */
function pDashboard() {
  const al = alerts(), t0 = today(), mo = t0.slice(0, 7);
  let toCollect = 0, late = 0, lateN = 0, month = 0;
  S.invoices.forEach(i => { if (!isSent(i)) return; const t = totals(i); toCollect += t.due; if (invStatus(i) === 'retard') { late += t.due; lateN++; } (i.payments || []).forEach(p => { if (p.date.slice(0, 7) === mo) month += +p.amount; }); });
  const active = S.projects.filter(p => p.status !== 'termine').sort((a, b) => (a.deadline || '9').localeCompare(b.deadline || '9'));
  const recent = S.activity.slice(0, 6);
  return `${S.settings.sample ? `<div class="banner"><span>Vous découvrez Validéo avec des <b>données d'exemple</b>. Essayez « Afficher en tant que » en bas du menu pour voir l'espace d'un client.</span><button class="btn sm" onclick="App.askReset()">Effacer les exemples et commencer</button></div>` : ''}
  <div class="ph"><div><div class="eyebrow">${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</div><h1>Bonjour ${esc((S.settings.owner || '').split(' ')[0])}</h1></div>
  <div class="row"><button class="btn" onclick="App.editClient()">Nouveau client</button><button class="btn primary" onclick="App.editProject()">Nouveau projet</button></div></div>
  <div class="kpis">${kpi('Projets en cours', active.length, `${S.projects.filter(p => p.status === 'termine').length} terminés`)}${kpi('À encaisser', fmt(toCollect), 'factures envoyées')}${kpi('En retard', fmt(late), `${lateN} facture${lateN > 1 ? 's' : ''}`, late ? 'bad' : '')}${kpi('Encaissé ce mois', fmt(month), new Date().toLocaleDateString('fr-FR', { month: 'long' }), 'ok')}</div>
  <div class="grid2"><section class="card"><div class="card-h"><h2>À traiter</h2><span class="muted small">${al.length} élément${al.length > 1 ? 's' : ''}</span></div>${alertList(al)}</section>
  <div class="stack"><section class="card"><div class="card-h"><h2>Projets en cours</h2><button class="link" onclick="App.go('projects')">Tous les projets</button></div>${active.length ? `<div class="plist">${active.map(p => projRow(p)).join('')}</div>` : `<p class="empty">Aucun projet en cours.</p>`}</section>
  <section class="card"><h2>Dernières activités</h2>${actList(recent, true)}</section></div></div>`;
}
function actList(list, withProj) {
  if (!list.length) return `<p class="empty">Aucune activité pour l'instant.</p>`;
  return `<div class="acts">${list.map(a => `<div><span class="mono">${ftime(a.at)}</span><span>${esc(a.text)}${withProj && proj(a.pid) ? ` · <a onclick="App.go('project','${a.pid}')">${esc(proj(a.pid).title)}</a>` : ''}</span></div>`).join('')}</div>`;
}

/* ----- Clients ----- */
function pClients() {
  const head = `<div class="ph"><div><h1>Clients</h1><div class="meta">${S.clients.length} client${S.clients.length > 1 ? 's' : ''}</div></div><div class="row">${viewToggle('clients')}<button class="btn primary" onclick="App.editClient()">Nouveau client</button></div></div>`;
  if (S.clients.length && layout.clients === 'list') return head + `<section class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Client</th><th>Contact</th><th class="num">En cours</th><th class="num">Total des projets</th><th class="num">Impayés</th></tr></thead><tbody>${S.clients.map(c => { const s = clientStats(c.id); return `<tr class="click" onclick="App.go('client','${c.id}')"><td><div class="row" style="flex-wrap:nowrap"><span class="avatar" style="width:32px;height:32px;font-size:12px">${initials(cname(c))}</span><b>${esc(cname(c))}</b></div></td><td class="muted small">${esc(c.company ? c.name : '')}${c.company ? '<br>' : ''}<span class="mono">${esc(c.email || c.phone || '')}</span></td><td class="num">${s.active}</td><td class="num">${fmt(s.value)}</td><td class="num" style="color:${s.due ? 'var(--bad)' : 'var(--ok)'}">${fmt(s.due)}</td></tr>`; }).join('')}</tbody></table></div></section>`;
  return head + `
  ${S.clients.length ? `<div class="cgrid">${S.clients.map(c => { const s = clientStats(c.id); return `<button class="ccard" onclick="App.go('client','${c.id}')"><div class="row"><span class="avatar">${initials(cname(c))}</span><div style="min-width:0"><div class="cn">${esc(cname(c))}</div><div class="muted small">${esc(c.company ? c.name : (c.email || c.phone || ''))}</div></div></div>
  <div class="cl"><span class="muted">Projets en cours</span><b class="mono">${s.active}</b></div><div class="cl"><span class="muted">Total des projets</span><b class="mono">${fmt(s.value)}</b></div><div class="cl"><span class="muted">Impayés</span><b class="mono" style="color:${s.due ? 'var(--bad)' : 'var(--ok)'}">${fmt(s.due)}</b></div></button>`; }).join('')}</div>` : `<p class="empty">Ajoutez votre premier client pour lui créer un tableau de bord.</p>`}`;
}
function pClient(id) {
  const c = client(id); if (!c) return nf(); const own = isOwner(); const s = clientStats(id);
  const invs = S.invoices.filter(i => i.clientId === id && (own || isSent(i))).sort((a, b) => b.date.localeCompare(a.date));
  return `${own ? `<div class="crumbs"><a onclick="App.go('clients')">Clients</a> /</div>` : ''}
  <div class="ph"><div class="row" style="gap:14px"><span class="avatar" style="width:52px;height:52px;font-size:18px">${initials(cname(c))}</span><div><h1>${own ? esc(cname(c)) : 'Bonjour ' + esc((c.name || '').split(' ')[0])}</h1><div class="meta">${own ? `${c.company ? esc(c.name) + ' · ' : ''}<span class="mono small">${esc(c.email || '')}</span> <span class="mono small">${esc(c.phone || '')}</span>` : `Vos projets avec ${esc(S.settings.name)}`}</div></div></div>
  ${own ? `<div class="row"><button class="btn" onclick="App.editClient('${c.id}')">Modifier</button><button class="btn" onclick="App.editInvoice(null,{clientId:'${c.id}'})">Nouvelle facture</button><button class="btn primary" onclick="App.editProject(null,'${c.id}')">Nouveau projet</button></div>` : ''}</div>
  <div class="kpis">${kpi('Projets', s.ps.length, `${s.active} en cours · ${s.done} terminé${s.done > 1 ? 's' : ''}`)}${kpi('Montant des projets', fmt(s.value), 'hors taxes')}${kpi('Payé', fmt(s.paid), `sur ${fmt(s.billed)} facturés`, 'ok')}${kpi('Impayés', fmt(s.due), s.late ? `dont ${fmt(s.late)} en retard` : 'aucun retard', s.late ? 'bad' : (s.due ? 'warn' : ''))}</div>
  <div class="grid2"><section class="card"><h2>Projets</h2>${s.ps.length ? `<div class="plist">${s.ps.map(p => projRow(p, false)).join('')}</div>` : '<p class="empty">Aucun projet.</p>'}</section>
  <section class="card"><h2>Factures</h2>${invs.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>N°</th><th>Échéance</th><th class="num">Montant</th><th class="num">Reste</th><th>Statut</th></tr></thead><tbody>${invs.map(i => { const t = totals(i); return `<tr class="click" onclick="App.go('invoice','${i.id}')"><td class="mono">${i.number}</td><td>${fdate(i.due)}</td><td class="num">${fmt(t.ttc)}</td><td class="num">${fmt(t.due)}</td><td>${invPill(i)}</td></tr>`; }).join('')}</tbody></table></div>` : '<p class="empty">Aucune facture.</p>'}</section></div>
  ${own ? `<div class="grid2" style="margin-top:16px"><section class="card"><div class="card-h"><h2>Espace client en ligne</h2>${portalLink(c.id) ? pill('ok', 'Actif') : pill('', 'Inactif')}</div>
    ${portalLink(c.id) ? `<p class="hint">Votre client suit ses projets, valide les étapes, commente les médias et consulte ses factures depuis ce lien privé, sans créer de compte.</p><div class="linkbox"><span style="flex:1">${esc(portalLink(c.id))}</span></div><div class="row"><button class="btn sm" onclick="App.copyText('${esc(portalLink(c.id))}')">Copier le lien</button><button class="btn sm primary" onclick="App.sendPortal('${c.id}')">Envoyer au client</button></div>`
      : `<p class="hint">${user ? 'Le lien sera créé à la prochaine synchronisation.' : 'Connectez-vous à votre compte en ligne (Réglages) pour donner à ce client un lien privé vers son espace.'}</p>${user ? '' : `<button class="btn sm" style="align-self:flex-start" onclick="App.go('settings')">Se connecter</button>`}`}</section>
  ${c.notes ? `<section class="card"><h2>Notes</h2><p class="hint" style="white-space:pre-wrap">${esc(c.notes)}</p></section>` : ''}</div>` : ''}`;
}

/* ----- Projets ----- */
function pProjects() {
  const list = S.projects.filter(p => projFilter === 'all' || (projFilter === 'termine' ? p.status === 'termine' : p.status !== 'termine'));
  const tab = (k, l) => `<button class="${projFilter === k ? 'on' : ''}" onclick="App.setFilter('proj','${k}')">${l}</button>`;
  const body = !list.length ? '<section class="card"><p class="empty">Aucun projet dans cette vue.</p></section>'
    : layout.projects === 'grid' ? `<div class="cgrid">${list.map(p => { const pr = progress(p); return `<button class="ccard" onclick="App.go('project','${p.id}')"><div class="card-h"><span class="muted small">${esc(cname(client(p.clientId)))}</span>${deadlinePill(p)}</div><div class="cn">${esc(p.title)}</div><div class="prog"><div class="bar ${pr === 100 ? 'done' : ''}"><i style="width:${pr}%"></i></div><span class="mono small">${pr}%</span></div><div class="cl"><span class="muted">Livraison</span><b>${fdate(p.deadline)}</b></div><div class="cl"><span class="muted">Montant HT</span><b class="mono">${fmt(p.amount)}</b></div></button>`; }).join('')}</div>`
    : `<section class="card"><div class="plist">${list.map(p => projRow(p)).join('')}</div></section>`;
  return `<div class="ph"><h1>Projets</h1><div class="row">${viewToggle('projects')}<button class="btn primary" onclick="App.editProject()">Nouveau projet</button></div></div>
  <div class="tabs">${tab('en_cours', 'En cours')}${tab('termine', 'Terminés')}${tab('all', 'Tous')}</div>${body}`;
}
function pProject(id) {
  const p = proj(id); if (!p) return nf();
  const c = client(p.clientId), own = isOwner(), pr = progress(p);
  const meds = S.media.filter(m => m.projectId === p.id);
  const invs = S.invoices.filter(i => i.projectId === p.id && (own || isSent(i)));
  const hasFinal = S.invoices.some(i => i.projectId === p.id && i.kind === 'final');
  return `<div class="crumbs">${own ? `<a onclick="App.go('projects')">Projets</a> / <a onclick="App.go('client','${c.id}')">${esc(cname(c))}</a>` : `<a onclick="App.go('client','${c.id}')">Mon espace</a>`} /</div>
  <div class="ph"><div><h1>${esc(p.title)}</h1><div class="meta"><span>${esc(cname(c))}</span>·<span>Livraison ${fdate(p.deadline)}</span>·<span class="mono">${fmt(p.amount)} HT</span>${deadlinePill(p)}</div></div>
  ${own ? `<div class="row"><button class="btn" onclick="App.editProject('${p.id}')">Modifier</button><button class="btn primary" onclick="App.notify('${p.id}')">Prévenir les participants</button></div>` : ''}</div>
  <div class="bigprog"><div class="bar ${pr === 100 ? 'done' : ''}"><i style="width:${pr}%"></i></div><b class="mono">${pr} %</b></div>
  <div class="grid2 wide-left">
    <section class="card"><div class="card-h"><h2>Étapes</h2>${own ? `<button class="btn sm ghost" onclick="App.addStep('${p.id}')">Ajouter une étape</button>` : ''}</div>
      <p class="hint">${own ? 'Une étape est terminée quand vous et votre client l\'avez validée. Vous pouvez cocher pour le client s\'il vous a confirmé par message. À la dernière validation, la facture est préparée automatiquement.' : 'Validez chaque étape quand elle vous convient. Votre monteur est prévenu à chaque validation.'}</p>
      <div class="steps">${p.steps.map((s, i) => stepRow(p, s, i)).join('') || '<p class="empty">Aucune étape.</p>'}</div></section>
    <div class="stack">
      <section class="card"><div class="card-h"><h2>Médias en révision</h2>${own ? `<label class="btn sm">Importer un fichier<input type="file" hidden accept="video/*,audio/*,image/*" onchange="App.uploadMedia('${p.id}',this)"></label>` : ''}</div>
        ${meds.length ? `<div class="mlist">${meds.map(m => `<button class="mrow" onclick="App.go('media','${m.id}')"><span class="mtype">${TYPE_LABEL[m.type]}</span><span class="mname">${esc(m.name)}</span><span class="mono small muted">V${m.versions.at(-1).v}</span>${mediaPill(m)}</button>`).join('')}</div>` : `<p class="empty">${own ? 'Importez une vidéo, un son ou une image : le client pourra commenter à un instant précis ou à un endroit précis.' : 'Aucun média pour l\'instant.'}</p>`}</section>
      <section class="card"><div class="card-h"><h2>Participants</h2>${own ? `<button class="btn sm ghost" onclick="App.editCollab('${p.id}')">Ajouter</button>` : ''}</div>
        <div class="people"><div class="person"><div><b>${esc(cname(c))}</b> <span class="muted small">Client</span><div class="mono small muted">${esc(c.email || '')} ${esc(c.phone || '')}</div></div></div>
        ${p.collaborators.map((x, i) => `<div class="person"><div><b>${esc(x.name)}</b> <span class="muted small">${esc(x.role || 'Participant')}</span><div class="mono small muted">${esc(x.email || '')} ${esc(x.phone || '')}</div></div>${own ? `<button class="icon-btn" aria-label="Retirer" onclick="App.delCollab('${p.id}',${i})">×</button>` : ''}</div>`).join('')}</div></section>
      <section class="card"><div class="card-h"><h2>Facturation</h2>${own ? `<div class="row">${hasFinal ? '' : `<button class="btn sm ghost" onclick="App.depositInvoice('${p.id}')">Acompte</button><button class="btn sm" onclick="App.finalInvoice('${p.id}')">Facturer maintenant</button>`}</div>` : ''}</div>
        ${invs.length ? `<div class="mlist">${invs.map(i => `<button class="mrow" onclick="App.go('invoice','${i.id}')"><span class="mono">${i.number}</span><span class="mname muted">${i.kind === 'acompte' ? 'Acompte' : i.kind === 'final' ? 'Facture finale' : 'Facture'}</span><span class="mono small">${fmt(totals(i).ttc)}</span>${invPill(i)}</button>`).join('')}</div>` : `<p class="empty">${own ? 'La facture finale sera générée automatiquement quand toutes les étapes seront validées.' : 'Aucune facture pour ce projet.'}</p>`}</section>
      <section class="card"><h2>Historique</h2>${actList(S.activity.filter(a => a.pid === p.id).slice(0, 10), false)}</section>
    </div>
  </div>`;
}
function mediaPill(m) {
  if (m.purged) return pill('', 'Fichiers supprimés');
  if (m.approvedV) { const pd = purgeDate(m); return pill('ok', `V${m.approvedV} validée${pd && isOwner() ? ' · suppr. ' + fdate(pd) : ''}`); }
  const open = m.comments.filter(x => !x.resolved).length;
  return open ? pill('warn', open + ' à traiter') : pill('info', 'En relecture');
}
function stepRow(p, s, i) {
  const own = isOwner(), both = s.me && s.client;
  if (!own) {
    const status = both ? `Terminée le ${fdate(s.meAt > s.clientAt ? s.meAt : s.clientAt)}` : s.client ? `Validée par vous le ${fdate(s.clientAt)} · finalisation en cours` : s.me ? 'Prête : à vous de valider' : 'En cours de réalisation';
    return `<div class="step cl ${both ? 'done' : ''}"><span class="s-idx mono">${String(i + 1).padStart(2, '0')}</span>
    <div class="s-label">${esc(s.label)}<span class="s-date ${s.me && !s.client ? 'ready' : ''}">${status}</span></div>
    ${s.client ? `<div class="row">${pill('ok', 'Validée')}${both ? '' : `<button class="link sm" onclick="App.toggleStep('${p.id}','${s.id}','client')">Annuler</button>`}</div>` : `<button class="btn sm ${s.me ? 'primary' : ''}" onclick="App.toggleStep('${p.id}','${s.id}','client')">Valider l'étape</button>`}</div>`;
  }
  const chk = (side, label, enabled, at) => `<label class="chk ${s[side] ? 'on' : ''} ${enabled ? '' : 'dis'}" title="${at ? 'Validé le ' + fdate(at) : ''}"><input type="checkbox" ${s[side] ? 'checked' : ''} ${enabled ? '' : 'disabled'} onchange="App.toggleStep('${p.id}','${s.id}','${side}')"><span>${label}</span></label>`;
  return `<div class="step ${both ? 'done' : ''}"><span class="s-idx mono">${String(i + 1).padStart(2, '0')}</span>
  <div class="s-label">${esc(s.label)}${both ? `<span class="s-date">Validée le ${fdate(s.meAt > s.clientAt ? s.meAt : s.clientAt)}</span>` : ''}</div>
  ${chk('me', own ? 'Moi' : 'Monteur', own, s.meAt)}${chk('client', 'Client', true, s.clientAt)}
  ${own ? `<div class="row" style="gap:0"><button class="icon-btn" title="Renommer" aria-label="Renommer" onclick="App.renameStep('${p.id}','${s.id}')">✎</button><button class="icon-btn" title="Supprimer" aria-label="Supprimer l'étape" onclick="App.delStep('${p.id}','${s.id}')">×</button></div>` : '<span></span>'}</div>`;
}

/* ----- Révision média ----- */
function sortedComments(m, v) { return m.comments.filter(c => c.v === v).sort((a, b) => m.type === 'image' ? a.at.localeCompare(b.at) : (a.t - b.t)); }
function pMedia(id) {
  const m = mediaById(id); if (!m) return nf(); const p = proj(m.projectId), c = client(p.clientId), own = isOwner();
  const vNum = curVer[m.id] || m.versions.at(-1).v, v = m.versions.find(x => x.v === vNum);
  const cs = sortedComments(m, vNum), open = cs.filter(x => !x.resolved).length;
  let stage;
  if (m.type === 'video') stage = `<div class="stage"><video id="player" controls playsinline preload="metadata" data-file="${v.fileId}"></video></div><div class="scrub" id="scrub" aria-label="Commentaires sur la timeline"></div>`;
  else if (m.type === 'audio') stage = `<div class="stage audio"><div class="aud-ico">♪ ${esc(m.name)}</div><audio id="player" controls preload="metadata" data-file="${v.fileId}"></audio></div><div class="scrub" id="scrub"></div>`;
  else stage = `<div class="stage" style="padding:0"><div class="imgbox" id="imgbox" onclick="App.pinAt(event)"><img id="player" alt="${esc(m.name)}" data-file="${v.fileId}">${cs.map((x, i) => `<button class="pin ${x.author} ${x.resolved ? 'res' : ''}" id="pin-${x.id}" style="left:${x.x}%;top:${x.y}%" onclick="event.stopPropagation();App.seek('${m.id}','${x.id}')">${i + 1}</button>`).join('')}</div></div>`;
  if (m.purged) stage = `<div class="stage"><div class="purged"><b>Fichiers supprimés le ${fdate(m.purged)}</b><span>Toutes les versions (V1 à V${m.versions.at(-1).v}) ont été effacées ${esc(S.settings.retentionDays)} jours après validation pour libérer de l'espace. Les commentaires restent consultables.</span></div></div>`;
  const author = x => x.author === 'me' ? esc(S.settings.owner || 'Monteur') : esc(cname(c));
  const pd = purgeDate(m), last = m.versions.at(-1).v;
  const approve = m.purged ? '' : m.approvedV
    ? `<div class="approve ok"><div><b>V${m.approvedV} validée le ${fdate(m.approvedAt)}</b><div class="hint">${pd ? `Les fichiers de toutes les versions seront supprimés le ${fdate(pd)}.` : 'Version finale approuvée.'}</div></div>${own ? `<button class="btn sm ghost" onclick="App.approveMedia('${m.id}',false)">Annuler la validation</button>` : ''}</div>`
    : `<div class="approve"><div><b>${own ? 'En attente de validation du client' : 'Cette version vous convient ?'}</b><div class="hint">${own ? 'Vous pouvez la marquer validée si le client vous a confirmé par message.' : 'Validez-la quand il n\'y a plus de correction à faire.'}</div></div><button class="btn sm primary" onclick="App.approveMedia('${m.id}',true)">${own ? `Marquer V${vNum} validée` : `Valider la V${vNum}`}</button></div>`;
  return `<div class="crumbs"><a onclick="App.go('project','${p.id}')">${esc(p.title)}</a> /</div>
  <div class="ph"><div><h1>${esc(m.name)}</h1><div class="meta"><span class="mtype">${TYPE_LABEL[m.type]}</span><span>${open ? open + ' commentaire' + (open > 1 ? 's' : '') + ' à traiter' : 'Aucun commentaire en attente'}</span></div></div>
  <div class="row"><label class="field" style="flex-direction:row;align-items:center;gap:8px"><span>Version</span><select id="ver" onchange="App.setVer('${m.id}',+this.value)">${m.versions.map(x => `<option value="${x.v}" ${x.v === vNum ? 'selected' : ''}>V${x.v} · ${fdate(x.at)}</option>`).join('')}</select></label>
  ${own && !m.purged ? `<label class="btn primary">Envoyer une nouvelle version<input type="file" hidden accept="video/*,audio/*,image/*" onchange="App.newVersion('${m.id}',this)"></label>` : ''}${own ? `<button class="btn ghost danger" onclick="App.delMedia('${m.id}')">Supprimer</button>` : ''}</div></div>
  <div class="review"><div class="stack">${stage}${approve}
    <div class="cform" ${m.purged ? 'hidden' : ''}><div class="ctime" id="ctime">${m.type === 'image' ? 'Cliquez sur l\'image à l\'endroit à commenter' : 'Commentaire à ' + tc(0)}</div>
    <textarea id="ctext" rows="3" placeholder="${m.type === 'image' ? 'Ex. : recadrer légèrement à gauche' : 'Ex. : couper ce plan plus tôt, la musique est trop forte ici…'}" onfocus="App.capture()"></textarea>
    <div class="row" style="justify-content:space-between"><span class="hint">${m.type === 'image' ? 'Le point orange marque l\'endroit commenté.' : 'La lecture se met en pause quand vous écrivez : le commentaire est attaché à cet instant.'}</span><button class="btn primary" onclick="App.addComment('${m.id}')">Ajouter le commentaire</button></div></div></div>
    <section class="card"><div class="card-h"><h2>Commentaires · V${vNum}</h2><span class="muted small">${cs.length}</span></div>
    ${cs.length ? `<div class="clist">${cs.map((x, i) => `<div class="cmt ${x.resolved ? 'res' : ''}" id="c-${x.id}"><div class="c-top"><button class="c-pos" onclick="App.seek('${m.id}','${x.id}')">${m.type === 'image' ? '#' + (i + 1) : tc(x.t)}</button><b>${author(x)}</b><span class="muted small">${ftime(x.at)}</span>${x.resolved ? pill('ok', 'Corrigé') : ''}</div><p>${esc(x.text)}</p>${own ? `<div class="row"><button class="btn sm ghost" onclick="App.resolve('${m.id}','${x.id}')">${x.resolved ? 'Rouvrir' : 'Marquer corrigé'}</button><button class="link sm" onclick="App.delComment('${m.id}','${x.id}')">Supprimer</button></div>` : ''}</div>`).join('')}</div>` : '<p class="empty">Pas encore de commentaire sur cette version.</p>'}</section>
  </div>`;
}

/* ----- Factures ----- */
function pInvoices() {
  const list = S.invoices.filter(i => { const st = invStatus(i); return invFilter === 'all' || st === invFilter || (invFilter === 'envoyee' && st === 'partielle'); }).sort((a, b) => b.number.localeCompare(a.number));
  const count = k => S.invoices.filter(i => invStatus(i) === k).length;
  const tab = (k, l) => `<button class="${invFilter === k ? 'on' : ''}" onclick="App.setFilter('inv','${k}')">${l}${k !== 'all' && count(k) ? ` · ${count(k)}` : ''}</button>`;
  return `<div class="ph"><h1>Factures</h1><div class="row">${viewToggle('invoices')}<button class="btn" onclick="App.go('settings')">Modèle et identité visuelle</button><button class="btn primary" onclick="App.editInvoice()">Nouvelle facture</button></div></div>
  <div class="tabs">${tab('all', 'Toutes')}${tab('a_verifier', 'À vérifier')}${tab('brouillon', 'Brouillons')}${tab('envoyee', 'Envoyées')}${tab('retard', 'En retard')}${tab('payee', 'Payées')}</div>
  ${list.length && layout.invoices === 'grid' ? `<div class="cgrid">${list.map(i => { const t = totals(i); return `<button class="ccard" onclick="App.go('invoice','${i.id}')"><div class="card-h"><span class="mono small">${i.number}</span>${invPill(i)}</div><div class="cn">${esc(cname(client(i.clientId)))}</div><div class="muted small">${esc(proj(i.projectId)?.title || 'Sans projet')}</div><div class="k-v mono" style="font-size:22px;font-weight:600">${fmt(t.ttc)}</div><div class="cl"><span class="muted">Échéance</span><b>${fdate(i.due)}</b></div><div class="cl"><span class="muted">Reste à payer</span><b class="mono" style="color:${t.due && isSent(i) ? 'var(--bad)' : 'inherit'}">${fmt(t.due)}</b></div></button>`; }).join('')}</div>` : `<section class="card">${list.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>N°</th><th>Client</th><th>Projet</th><th>Émise</th><th>Échéance</th><th class="num">Total</th><th class="num">Reste</th><th>Statut</th></tr></thead><tbody>
  ${list.map(i => { const t = totals(i); return `<tr class="click" onclick="App.go('invoice','${i.id}')"><td class="mono">${i.number}</td><td>${esc(cname(client(i.clientId)))}</td><td class="muted">${esc(proj(i.projectId)?.title || '—')}</td><td>${fdate(i.date)}</td><td>${fdate(i.due)}</td><td class="num">${fmt(t.ttc)}</td><td class="num">${fmt(t.due)}</td><td>${invPill(i)}</td></tr>`; }).join('')}</tbody></table></div>` : '<p class="empty">Aucune facture dans cette vue.</p>'}</section>`}`;
}
function stampSVG(st, color) {
  const k = uid();
  return `<svg class="stamp" viewBox="0 0 200 200" style="color:${color}" aria-hidden="true"><defs><path id="t${k}" d="M28,100 a72,72 0 1,1 144,0"/><path id="b${k}" d="M20,100 a80,80 0 0,0 160,0"/></defs>
  <circle cx="100" cy="100" r="95" fill="none" stroke="currentColor" stroke-width="4"/><circle cx="100" cy="100" r="61" fill="none" stroke="currentColor" stroke-width="1.6"/>
  <text fill="currentColor" font-size="16" font-weight="700" letter-spacing="2" font-family="Arial,sans-serif"><textPath href="#t${k}" startOffset="50%" text-anchor="middle">${esc((st.stampTop || st.name || '').toUpperCase())}</textPath></text>
  <text fill="currentColor" font-size="13" font-weight="700" letter-spacing="2" font-family="Arial,sans-serif"><textPath href="#b${k}" startOffset="50%" text-anchor="middle">${esc((st.stampBottom || '').toUpperCase())}</textPath></text>
  <text x="100" y="92" fill="currentColor" font-size="15" font-weight="800" text-anchor="middle" font-family="Arial,sans-serif">${esc((st.stampCenter || '').toUpperCase())}</text>
  <text x="100" y="116" fill="currentColor" font-size="11" text-anchor="middle" font-family="Arial,sans-serif">★ ★ ★</text></svg>`;
}
function invoiceDoc(i, tplOverride) {
  const st = S.settings, c = client(i.clientId) || {}, t = totals(i), p = proj(i.projectId), tpl = tplOverride || i.template || st.template;
  const paid = isSent(i) && invStatus(i) === 'payee';
  return `<div class="paper tpl-${tpl}" style="--brand:${esc(st.color)}">
  <div class="p-head"><div class="p-brand">${st.logo ? `<img class="p-logo" src="${st.logo}" alt="">` : ''}<div><div class="p-name">${esc(st.name)}</div><div class="p-small">${esc(st.address).replace(/\n/g, '<br>')}<br>${esc(st.email)}${st.phone ? ' · ' + esc(st.phone) : ''}${st.siret ? '<br>N° ' + esc(st.siret) : ''}</div></div></div>
  <div class="p-title"><div class="p-doc">${i.kind === 'acompte' ? 'ACOMPTE' : 'FACTURE'}</div><div class="p-num">N° ${esc(i.number)}</div><div class="p-small">Émise le ${fdate(i.date)}<br>Échéance le ${fdate(i.due)}</div></div></div>
  <div class="p-parties"><div><div class="p-label">Facturé à</div><b>${esc(c.company || c.name)}</b><div class="p-small">${c.company ? esc(c.name) + '<br>' : ''}${esc(c.address || '')}${c.address ? '<br>' : ''}${esc(c.email || '')}</div></div>
  <div><div class="p-label">Projet</div><b>${esc(p?.title || '—')}</b>${p?.deadline ? `<div class="p-small">Livraison ${fdate(p.deadline)}</div>` : ''}</div></div>
  <table class="p-lines"><thead><tr><th>Désignation</th><th class="n">Qté</th><th class="n">Prix unitaire</th><th class="n">Total HT</th></tr></thead><tbody>
  ${i.lines.map(l => `<tr><td>${esc(l.label)}</td><td class="n">${+l.qty || 0}</td><td class="n">${fmt(l.price)}</td><td class="n">${fmt((+l.qty || 0) * (+l.price || 0))}</td></tr>`).join('')}</tbody></table>
  <div class="p-totals"><div><span>Sous-total HT</span><span>${fmt(t.sub)}</span></div>
  ${t.disc ? `<div class="disc"><span>Remise${i.discount.type === 'pct' ? ' ' + i.discount.value + ' %' : ''}</span><span>− ${fmt(t.disc)}</span></div><div><span>Total HT</span><span>${fmt(t.ht)}</span></div>` : ''}
  <div><span>TVA ${+i.tva || 0} %</span><span>${fmt(t.tva)}</span></div><div class="grand"><span>Total TTC</span><span>${fmt(t.ttc)}</span></div>
  ${t.paid ? `<div><span>Déjà réglé</span><span>− ${fmt(t.paid)}</span></div><div><b>Reste à payer</b><b>${fmt(t.due)}</b></div>` : ''}</div>
  <div class="p-foot"><div class="p-pay"><div class="p-label">Règlement</div><pre class="p-small">${esc(st.iban)}</pre>${i.notes ? `<p class="p-small" style="margin:8px 0 0">${esc(i.notes)}</p>` : ''}</div>
  <div class="p-sign"><div class="p-label">Signature</div>${st.showStamp !== false ? stampSVG(st, st.color) : ''}${st.signature ? `<img class="sig" src="${st.signature}" alt="Signature">` : ''}</div></div>
  <div class="p-legal">${esc(st.legal)}${st.penalty ? ' ' + esc(st.penalty) : ''}</div>
  ${paid ? '<div class="p-paid">PAYÉE</div>' : ''}</div>`;
}
function pInvoice(id) {
  const i = invoice(id); if (!i) return nf(); const own = isOwner(), c = client(i.clientId), t = totals(i), st = invStatus(i);
  let side = '';
  const summary = `<section class="card"><h2>Montant</h2><div class="sum"><div><span class="muted">Sous-total HT</span><span class="mono">${fmt(t.sub)}</span></div>${t.disc ? `<div><span class="muted">Remise</span><span class="mono">− ${fmt(t.disc)}</span></div>` : ''}<div><span class="muted">TVA</span><span class="mono">${fmt(t.tva)}</span></div><div class="grand"><span>Total TTC</span><span class="mono">${fmt(t.ttc)}</span></div><div><span class="muted">Payé</span><span class="mono">${fmt(t.paid)}</span></div><div><span>Reste à payer</span><span class="mono ${t.due ? 'due' : ''}">${fmt(t.due)}</span></div></div></section>`;
  const pays = `<section class="card"><h2>Paiements</h2>${(i.payments || []).length ? `<div class="mlist">${i.payments.map(p => `<div class="mrow" style="cursor:default"><span class="mono small">${fdate(p.date)}</span><span class="mname">${esc(p.method)}${p.ref ? ' · ' + esc(p.ref) : ''}</span><b class="mono small">${fmt(p.amount)}</b>${p.proofId ? `<a class="link sm" data-proof="${p.proofId}" target="_blank" rel="noopener">Preuve</a>` : ''}${own ? `<button class="icon-btn" aria-label="Supprimer le paiement" onclick="App.delPayment('${i.id}','${p.id}')">×</button>` : ''}</div>`).join('')}</div>` : '<p class="empty">Aucun paiement enregistré.</p>'}${i.reminders?.length ? `<p class="hint">Relances : ${i.reminders.map(fdate).join(', ')}</p>` : ''}</section>`;
  if (own) {
    if (st === 'a_verifier' || st === 'brouillon') side += `<section class="card verify"><h2>${st === 'a_verifier' ? 'Vérification avant envoi' : 'Brouillon'}</h2><p class="hint">${st === 'a_verifier' ? 'Facture préparée automatiquement à la fin du projet, acomptes déduits. Contrôlez le montant, appliquez une remise si besoin, puis validez pour l\'envoyer.' : 'Complétez la facture, puis validez-la pour l\'envoyer.'}</p>
      <div class="disc-row"><label class="field"><span>Remise</span><input id="qd-val" type="number" min="0" step="any" value="${i.discount?.value || ''}" placeholder="0"></label><label class="field"><span>Type</span><select id="qd-type"><option value="pct" ${i.discount?.type !== 'fixed' ? 'selected' : ''}>%</option><option value="fixed" ${i.discount?.type === 'fixed' ? 'selected' : ''}>${esc(S.settings.currency)}</option></select></label><button class="btn" onclick="App.applyDiscount('${i.id}')">Appliquer</button></div>
      <div class="row"><button class="btn" onclick="App.editInvoice('${i.id}')">Modifier les lignes</button><button class="btn primary" onclick="App.validateInvoice('${i.id}')">Valider et envoyer</button></div></section>`;
    side += summary;
    if (isSent(i)) side += `<section class="card"><h2>Actions</h2><div class="row">${t.due ? `<button class="btn primary" onclick="App.payModal('${i.id}')">Enregistrer un paiement</button><button class="btn" onclick="App.remind('${i.id}')">Relancer</button>` : ''}<button class="btn" onclick="App.sendInvoice('${i.id}')">Renvoyer</button><button class="btn" onclick="App.editInvoice('${i.id}')">Modifier</button></div></section>`;
    side += pays;
    side += `<section class="card"><h2>Apparence</h2><label class="field"><span>Modèle de cette facture</span><select onchange="App.setTpl('${i.id}',this.value)"><option value="">Modèle par défaut (${tplName(S.settings.template)})</option>${TEMPLATES.map(([k, l]) => `<option value="${k}" ${i.template === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label><button class="link" onclick="App.go('settings')">Logo, couleurs, signature et cachet</button></section>
    <button class="btn ghost danger" onclick="App.delInvoice('${i.id}')">Supprimer la facture</button>`;
  } else {
    side = summary + `<section class="card"><h2>Comment régler</h2><pre class="hint" style="white-space:pre-wrap;font:inherit;margin:0">${esc(S.settings.iban)}</pre><p class="hint">Indiquez la référence <b class="mono">${esc(i.number)}</b> avec votre paiement.</p></section>` + pays;
  }
  return `<div class="crumbs">${own ? `<a onclick="App.go('invoices')">Factures</a>` : `<a onclick="App.go('client','${c.id}')">Mon espace</a>`} /</div>
  <div class="ph"><div><h1 class="mono">${esc(i.number)}</h1><div class="meta">${esc(cname(c))} · <span class="mono">${fmt(t.ttc)}</span> ${invPill(i)}</div></div><button class="btn" onclick="window.print()">Imprimer / enregistrer en PDF</button></div>
  <div class="inv-layout"><div class="paper-wrap" id="print-area">${invoiceDoc(i)}</div><aside class="stack">${side}</aside></div>`;
}

/* ----- Comptabilité ----- */
function allPayments() { const out = []; S.invoices.forEach(i => (i.payments || []).forEach(p => out.push({ ...p, inv: i }))); return out.sort((a, b) => b.date.localeCompare(a.date)); }
function niceMax(v) { const p = 10 ** Math.floor(Math.log10(v)); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
const short = v => v >= 1000 ? (v / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' k' : Math.round(v).toLocaleString('fr-FR');
function chartSVG() {
  const now = new Date(), months = [];
  for (let k = 11; k >= 0; k--) { const d = new Date(now.getFullYear(), now.getMonth() - k, 1); months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', ''), inc: 0, exp: 0 }); }
  allPayments().forEach(p => { const m = months.find(x => x.key === p.date.slice(0, 7)); if (m) m.inc += +p.amount; });
  S.expenses.forEach(e => { const m = months.find(x => x.key === e.date.slice(0, 7)); if (m) m.exp += +e.amount; });
  const max = niceMax(Math.max(1, ...months.map(m => Math.max(m.inc, m.exp))));
  const W = 760, H = 250, L = 52, R = 8, T = 14, B = 30, pw = W - L - R, ph = H - T - B, bw = pw / 12;
  let g = '';
  for (let i = 0; i <= 4; i++) { const y = T + ph * (1 - i / 4); g += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" style="stroke:var(--line)" stroke-width="1"/><text x="${L - 8}" y="${y + 4}" text-anchor="end">${short(max * i / 4)}</text>`; }
  months.forEach((m, i) => {
    const x = L + i * bw, hi = ph * m.inc / max, he = ph * m.exp / max;
    g += `<rect x="${x + bw * .16}" y="${T + ph - hi}" width="${bw * .38}" height="${hi}" rx="2" style="fill:var(--accent)"><title>${m.label} · encaissé ${fmt(m.inc)}</title></rect>`;
    g += `<rect x="${x + bw * .56}" y="${T + ph - he}" width="${bw * .26}" height="${he}" rx="2" style="fill:var(--muted)" opacity=".55"><title>${m.label} · dépenses ${fmt(m.exp)}</title></rect>`;
    g += `<text x="${x + bw / 2}" y="${H - 10}" text-anchor="middle">${m.label}</text>`;
  });
  return `<div class="tbl-wrap"><svg class="chart" viewBox="0 0 ${W} ${H}" style="min-width:560px" role="img" aria-label="Encaissements et dépenses sur 12 mois">${g}</svg></div>`;
}
function pAccounting() {
  const y = String(new Date().getFullYear()), mo = today().slice(0, 7), pays = allPayments();
  const incY = pays.filter(p => p.date.startsWith(y)).reduce((a, p) => a + +p.amount, 0), incM = pays.filter(p => p.date.startsWith(mo)).reduce((a, p) => a + +p.amount, 0);
  const expY = S.expenses.filter(e => e.date.startsWith(y)).reduce((a, e) => a + +e.amount, 0);
  const recv = S.invoices.filter(i => isSent(i) && totals(i).due > 0).sort((a, b) => a.due.localeCompare(b.due));
  const recvT = recv.reduce((a, i) => a + totals(i).due, 0), lateT = recv.filter(i => invStatus(i) === 'retard').reduce((a, i) => a + totals(i).due, 0);
  return `<div class="ph"><div><h1>Comptabilité</h1><div class="meta">Exercice ${y}</div></div><div class="row"><button class="btn" onclick="App.exportCSV()">Exporter pour le comptable (CSV)</button><button class="btn primary" onclick="App.editExpense()">Ajouter une dépense</button></div></div>
  <div class="kpis">${kpi('Encaissé ' + y, fmt(incY), `dont ${fmt(incM)} ce mois`, 'ok')}${kpi('Créances', fmt(recvT), `${recv.length} facture${recv.length > 1 ? 's' : ''} ouverte${recv.length > 1 ? 's' : ''}`, recvT ? 'warn' : '')}${kpi('Dont en retard', fmt(lateT), 'à relancer', lateT ? 'bad' : '')}${kpi('Dépenses ' + y, fmt(expY), `${S.expenses.length} ligne${S.expenses.length > 1 ? 's' : ''}`)}${kpi('Résultat ' + y, fmt(incY - expY), 'encaissé − dépenses')}</div>
  <section class="card" style="margin-bottom:16px"><div class="card-h"><h2>Encaissements et dépenses · 12 mois</h2><div class="legend"><span><i style="background:var(--accent)"></i>Encaissé</span><span><i style="background:var(--muted);opacity:.55"></i>Dépenses</span></div></div>${chartSVG()}</section>
  <div class="stack">
  <section class="card"><h2>Créances et impayés</h2>${recv.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Facture</th><th>Client</th><th>Émise</th><th>Échéance</th><th>Retard</th><th class="num">Total</th><th class="num">Reste dû</th><th></th></tr></thead><tbody>${recv.map(i => { const t = totals(i), d = diffDays(i.due, today()); return `<tr><td class="mono"><a onclick="App.go('invoice','${i.id}')">${i.number}</a></td><td>${esc(cname(client(i.clientId)))}</td><td>${fdate(i.date)}</td><td>${fdate(i.due)}</td><td>${d > 0 ? pill('bad', d + ' j') : pill('', 'à échoir')}</td><td class="num">${fmt(t.ttc)}</td><td class="num">${fmt(t.due)}</td><td><div class="row" style="flex-wrap:nowrap"><button class="btn sm" onclick="App.payModal('${i.id}')">Paiement</button><button class="btn sm ghost" onclick="App.remind('${i.id}')">Relancer</button></div></td></tr>`; }).join('')}</tbody></table></div>` : '<p class="empty">Aucune créance : tout est payé.</p>'}</section>
  <section class="card"><h2>Entrées (paiements reçus)</h2>${pays.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Client</th><th>Facture</th><th>Mode</th><th>Référence</th><th class="num">Montant</th><th>Preuve</th></tr></thead><tbody>${pays.map(p => `<tr><td>${fdate(p.date)}</td><td>${esc(cname(client(p.inv.clientId)))}</td><td class="mono"><a onclick="App.go('invoice','${p.inv.id}')">${p.inv.number}</a></td><td>${esc(p.method)}</td><td class="muted">${esc(p.ref || '—')}</td><td class="num">${fmt(p.amount)}</td><td>${p.proofId ? `<a class="link sm" data-proof="${p.proofId}" target="_blank" rel="noopener">${esc(p.proofName || 'Voir')}</a>` : '<span class="muted small">—</span>'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">Aucun paiement enregistré.</p>'}</section>
  <section class="card"><h2>Dépenses</h2>${S.expenses.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Libellé</th><th>Catégorie</th><th class="num">Montant</th><th></th></tr></thead><tbody>${[...S.expenses].sort((a, b) => b.date.localeCompare(a.date)).map(e => `<tr><td>${fdate(e.date)}</td><td>${esc(e.label)}</td><td>${pill('', e.category)}</td><td class="num">${fmt(e.amount)}</td><td><button class="icon-btn" aria-label="Supprimer" onclick="App.delExpense('${e.id}')">×</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">Aucune dépense.</p>'}</section></div>`;
}

/* ----- Réglages & identité visuelle ----- */
function sampleInvoice() {
  return S.invoices[0] || { id: 'x', number: `${S.settings.prefix}-${new Date().getFullYear()}-001`, clientId: S.clients[0]?.id, projectId: null, kind: 'final', date: today(), due: addDays(today(), 30), lines: [{ label: 'Montage vidéo — clip 2 min', qty: 1, price: 1200 }, { label: 'Étalonnage', qty: 1, price: 300 }], discount: { type: 'pct', value: 0 }, tva: S.settings.tva, status: 'brouillon', payments: [] };
}
function pSettings() {
  const st = S.settings;
  const f = (k, l, type = 'text', full = false) => `<label class="field ${full ? 'full' : ''}"><span>${l}</span><input id="s-${k}" type="${type}" value="${esc(st[k])}" oninput="App.setS('${k}',this.value)"></label>`;
  const ta = (k, l) => `<label class="field full"><span>${l}</span><textarea id="s-${k}" rows="3" oninput="App.setS('${k}',this.value)">${esc(st[k])}</textarea></label>`;
  return `<div class="ph"><div><h1>Identité & réglages</h1><div class="meta">Vos factures reprennent automatiquement votre logo, vos couleurs, votre signature et votre cachet.</div></div></div>
  <div class="set-layout"><div class="stack">
  <section class="card"><h2>Votre entreprise</h2><div class="form">${f('name', 'Nom commercial')}${f('owner', 'Votre nom')}${f('email', 'Email', 'email')}${f('phone', 'Téléphone / WhatsApp', 'tel')}${ta('address', 'Adresse')}${f('siret', 'N° SIRET / RCCM / NIF', 'text', true)}${ta('iban', 'Coordonnées de paiement (IBAN, Mobile Money…)')}${ta('legal', 'Mentions légales en pied de facture')}</div></section>
  <section class="card"><h2>Facturation</h2><div class="form">${f('currency', 'Devise (€, FCFA, $, MAD…)')}${f('tva', 'TVA par défaut (%)', 'number')}${f('payDays', 'Délai de paiement (jours)', 'number')}${f('prefix', 'Préfixe des numéros')}${f('next', 'Prochain numéro', 'number')}${f('penalty', 'Pénalités de retard (texte)')}</div></section>
  <section class="card"><h2>Identité visuelle</h2>
    <div class="field"><span>Logo ou photo</span><div class="row">${st.logo ? `<img src="${st.logo}" alt="Logo" style="max-height:48px;max-width:140px;border-radius:6px;background:#fff;padding:4px">` : ''}<label class="btn sm">${st.logo ? 'Remplacer' : 'Importer une image'}<input type="file" hidden accept="image/*" onchange="App.uploadLogo(this)"></label>${st.logo ? `<button class="link sm" onclick="App.setS('logo','',true)">Retirer</button>` : ''}</div></div>
    <div class="field"><span>Couleur de marque</span><div class="swatches">${COLORS.map(c => `<button class="sw ${st.color === c ? 'on' : ''}" style="background:${c}" aria-label="Couleur ${c}" onclick="App.setS('color','${c}',true)"></button>`).join('')}<input id="s-color" type="color" value="${esc(st.color)}" onchange="App.setS('color',this.value,true)" aria-label="Couleur personnalisée" style="width:42px;height:32px;padding:0;border:1px solid var(--line);border-radius:6px;background:none"></div></div>
    <div class="field"><span>Modèle de facture</span><div class="tpl-pick">${TEMPLATES.map(([k, l]) => `<button class="tpl-opt ${st.template === k ? 'on' : ''}" onclick="App.setS('template','${k}',true)"><div class="thumb">${invoiceDoc(sampleInvoice(), k)}</div><span>${l}</span></button>`).join('')}</div></div>
  </section>
  <section class="card"><h2>Signature</h2><p class="hint">Signez avec la souris ou le doigt, ou importez une image de signature.</p><canvas id="sigpad" width="840" height="300"></canvas>
    <div class="row"><button class="btn sm primary" onclick="App.saveSig()">Enregistrer la signature</button><button class="btn sm" onclick="App.clearSig()">Effacer</button><label class="btn sm ghost">Importer une image<input type="file" hidden accept="image/*" onchange="App.uploadSig(this)"></label>${st.signature ? `<button class="link sm" onclick="App.setS('signature','',true)">Retirer la signature</button>` : ''}</div></section>
  <section class="card"><h2>Cachet automatique</h2><div class="row" style="align-items:flex-start;gap:18px"><div style="width:130px;color:${esc(st.color)}">${stampSVG(st, st.color)}</div><div class="form" style="flex:1;min-width:220px">${f('stampTop', 'Texte du haut', 'text', true)}${f('stampBottom', 'Texte du bas')}${f('stampCenter', 'Texte central')}<label class="row full" style="gap:8px"><input type="checkbox" ${st.showStamp !== false ? 'checked' : ''} onchange="App.setS('showStamp',this.checked,true)"> Apposer le cachet sur les factures</label></div></div></section>
  <section class="card"><h2>Stockage des médias</h2><p class="hint">Quand le client valide un média, toutes ses versions (V1 jusqu'à la version finale) sont supprimées après ce délai, sur cet appareil et en ligne. Les commentaires et l'historique sont conservés.</p>
    <label class="field"><span>Supprimer les fichiers après validation</span><select id="s-retention" onchange="App.setS('retentionDays',this.value,true)">${[[1, '1 jour'], [3, '3 jours'], [7, '7 jours'], [14, '14 jours'], [30, '30 jours'], [60, '60 jours'], [0, 'Ne jamais supprimer']].map(([v, l]) => `<option value="${v}" ${+st.retentionDays === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></section>
  ${accountCard()}
  <section class="card"><h2>Sauvegarde et données</h2><p class="hint">Tout est enregistré dans ce navigateur, y compris hors ligne. Exportez régulièrement une sauvegarde (fichiers inclus) pour ne rien perdre ou passer sur un autre ordinateur.</p>
    <div class="row"><button class="btn" onclick="App.exportData()">Exporter une sauvegarde</button><label class="btn">Restaurer une sauvegarde<input type="file" hidden accept="application/json,.json" onchange="App.importData(this)"></label><button class="btn ghost danger" onclick="App.askReset()">Tout effacer</button></div></section>
  </div>
  <div class="preview stack"><div class="card-h"><h2>Aperçu</h2><span class="muted small">mis à jour en direct</span></div><div class="paper-wrap" id="tpl-preview">${invoiceDoc(sampleInvoice(), st.template)}</div></div></div>`;
}

/* ---------------- Après rendu : médias, preuves, signature ---------------- */
function afterRender() {
  document.querySelectorAll('[data-file]').forEach(async el => {
    const u = await fileURL(el.dataset.file);
    if (u) el.src = u; else el.closest('.stage')?.insertAdjacentHTML('beforeend', `<p class="hint" style="padding:20px;color:#ccc">${MODE === 'portal' ? 'Ce fichier n’est pas encore disponible en ligne. Réessayez dans quelques instants.' : 'Fichier introuvable sur cet appareil. Restaurez une sauvegarde ou envoyez une nouvelle version.'}</p>`);
  });
  document.querySelectorAll('[data-proof]').forEach(async a => { const u = await fileURL(a.dataset.proof); if (u) a.href = u; });
  const pl = $('#player'), m = route.page === 'media' && mediaById(route.id);
  if (pl && m && m.type !== 'image') {
    const draw = () => drawMarkers(m, pl);
    pl.addEventListener('loadedmetadata', draw);
    pl.addEventListener('timeupdate', () => { const ct = $('#ctime'); if (ct) ct.textContent = 'Commentaire à ' + tc(pl.currentTime); const ph = $('#scrub .ph-line'); if (ph && pl.duration) ph.style.left = (pl.currentTime / pl.duration * 100) + '%'; });
  }
  if ($('#sigpad')) initSig();
}
function drawMarkers(m, pl) {
  const sc = $('#scrub'); if (!sc || !pl.duration) return; const v = curVer[m.id] || m.versions.at(-1).v;
  sc.innerHTML = '<span class="ph-line"></span>' + sortedComments(m, v).map(c => `<button class="mk ${c.author} ${c.resolved ? 'res' : ''}" style="left:${Math.min(100, c.t / pl.duration * 100)}%" title="${tc(c.t)} · ${esc(c.text)}" onclick="App.seek('${m.id}','${c.id}')"></button>`).join('');
  sc.onclick = e => { if (e.target !== sc) return; const r = sc.getBoundingClientRect(); pl.currentTime = (e.clientX - r.left) / r.width * pl.duration; };
}
function initSig() {
  const cv = $('#sigpad'), ctx = cv.getContext('2d'); sigDirty = false;
  ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1b2a4a';
  if (S.settings.signature) { const im = new Image(); im.onload = () => { const k = Math.min(cv.width / im.width, cv.height / im.height); ctx.drawImage(im, (cv.width - im.width * k) / 2, (cv.height - im.height * k) / 2, im.width * k, im.height * k); }; im.src = S.settings.signature; }
  let on = false, last = null;
  const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
  cv.onpointerdown = e => { on = true; last = pos(e); cv.setPointerCapture(e.pointerId); };
  cv.onpointermove = e => { if (!on) return; const p = pos(e); ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...p); ctx.stroke(); last = p; sigDirty = true; };
  cv.onpointerup = cv.onpointercancel = () => { on = false; };
}

/* ---------------- Modale, toast, confirmation ---------------- */
function openModal(title, body, foot = '', wide = false) { $('#m-title').textContent = title; $('#m-body').innerHTML = body; $('#m-foot').innerHTML = foot; $('#modal-box').classList.toggle('wide', wide); $('#modal').hidden = false; setTimeout(() => $('#m-body input, #m-body textarea, #m-body select')?.focus(), 30); }
function closeModal() { $('#modal').hidden = true; }
function toast(text, actLabel, fn) {
  const el = document.createElement('div'); el.className = 'toast'; el.innerHTML = `<span>${esc(text)}</span>`;
  if (actLabel) { const b = document.createElement('button'); b.textContent = actLabel; b.onclick = () => { el.remove(); fn(); }; el.appendChild(b); }
  $('#toasts').appendChild(el); setTimeout(() => el.remove(), actLabel ? 9000 : 4000);
}
function confirmBox(title, text, okLabel, fn) { pendingConfirm = fn; openModal(title, `<p style="margin:0">${text}</p>`, `<button class="btn" onclick="App.closeModal()">Annuler</button><button class="btn primary" style="background:var(--bad);border-color:var(--bad);color:#fff" onclick="App.doConfirm()">${okLabel}</button>`); }
function doConfirm() { const f = pendingConfirm; pendingConfirm = null; closeModal(); f && f(); }
const val = id => document.getElementById(id)?.value ?? '';

/* ---------------- Clients ---------------- */
function editClient(id) {
  const c = id ? client(id) : { name: '', company: '', email: '', phone: '', address: '', notes: '' };
  openModal(id ? 'Modifier le client' : 'Nouveau client', `<div class="form">
  <label class="field"><span>Nom du contact</span><input id="f-name" value="${esc(c.name)}" placeholder="Awa Diallo"></label>
  <label class="field"><span>Entreprise (facultatif)</span><input id="f-company" value="${esc(c.company)}"></label>
  <label class="field"><span>Email</span><input id="f-email" type="email" value="${esc(c.email)}"></label>
  <label class="field"><span>WhatsApp (avec indicatif)</span><input id="f-phone" type="tel" value="${esc(c.phone)}" placeholder="+33 6 12 34 56 78"></label>
  <label class="field full"><span>Adresse de facturation</span><input id="f-address" value="${esc(c.address)}"></label>
  <label class="field full"><span>Notes</span><textarea id="f-notes" rows="3">${esc(c.notes)}</textarea></label></div>`,
  `${id ? `<button class="btn ghost danger" style="margin-right:auto" onclick="App.delClient('${id}')">Supprimer</button>` : ''}<button class="btn" onclick="App.closeModal()">Annuler</button><button class="btn primary" onclick="App.saveClient('${id || ''}')">Enregistrer</button>`);
}
function saveClient(id) {
  const d = { name: val('f-name').trim(), company: val('f-company').trim(), email: val('f-email').trim(), phone: val('f-phone').trim(), address: val('f-address').trim(), notes: val('f-notes') };
  if (!d.name && !d.company) return toast('Indiquez au moins un nom ou une entreprise.');
  if (id) Object.assign(client(id), d); else { id = uid(); S.clients.push({ id, ...d }); }
  save(); closeModal(); go('client', id); toast('Client enregistré');
}
function delClient(id) {
  if (S.invoices.some(i => i.clientId === id)) return toast('Ce client a des factures : supprimez-les d\'abord pour garder une comptabilité cohérente.');
  confirmBox('Supprimer ce client ?', `Ses projets et médias seront aussi supprimés.`, 'Supprimer', () => {
    S.projects.filter(p => p.clientId === id).forEach(p => S.media = S.media.filter(m => m.projectId !== p.id));
    S.projects = S.projects.filter(p => p.clientId !== id); S.clients = S.clients.filter(c => c.id !== id); save(); go('clients');
  });
}

/* ---------------- Projets ---------------- */
function editProject(id, cid) {
  if (!S.clients.length) { toast('Ajoutez d\'abord un client.'); return editClient(); }
  const p = id ? proj(id) : { title: '', clientId: cid || S.clients[0].id, amount: '', deadline: addDays(today(), 14) };
  openModal(id ? 'Modifier le projet' : 'Nouveau projet', `<div class="form">
  <label class="field full"><span>Titre du projet</span><input id="f-title" value="${esc(p.title)}" placeholder="Clip de lancement, film d'entreprise…"></label>
  <label class="field"><span>Client</span><select id="f-client">${S.clients.map(c => `<option value="${c.id}" ${c.id === p.clientId ? 'selected' : ''}>${esc(cname(c))}</option>`).join('')}</select></label>
  <label class="field"><span>Montant HT (${esc(S.settings.currency)})</span><input id="f-amount" type="number" min="0" step="any" value="${esc(p.amount)}"></label>
  <label class="field"><span>Date de livraison</span><input id="f-deadline" type="date" value="${esc(p.deadline)}"></label>
  ${id ? '' : `<label class="field full"><span>Étapes (une par ligne)</span><textarea id="f-steps" rows="7">${DEFAULT_STEPS.join('\n')}</textarea></label>`}</div>`,
  `${id ? `<button class="btn ghost danger" style="margin-right:auto" onclick="App.delProject('${id}')">Supprimer</button>` : ''}<button class="btn" onclick="App.closeModal()">Annuler</button><button class="btn primary" onclick="App.saveProject('${id || ''}')">Enregistrer</button>`);
}
function saveProject(id) {
  const d = { title: val('f-title').trim(), clientId: val('f-client'), amount: +val('f-amount') || 0, deadline: val('f-deadline') };
  if (!d.title) return toast('Donnez un titre au projet.');
  if (id) { Object.assign(proj(id), d); log(id, 'Projet modifié'); }
  else { id = uid(); S.projects.push({ id, ...d, status: 'en_cours', createdAt: today(), collaborators: [], steps: val('f-steps').split('\n').map(s => s.trim()).filter(Boolean).map(label => ({ id: uid(), label, me: false, client: false })) }); log(id, 'Projet créé'); }
  save(); closeModal(); go('project', id);
}
function delProject(id) {
  if (S.invoices.some(i => i.projectId === id)) return toast('Ce projet a des factures : supprimez-les d\'abord.');
  confirmBox('Supprimer ce projet ?', 'Les étapes, médias et commentaires seront supprimés.', 'Supprimer', () => { S.media = S.media.filter(m => m.projectId !== id); S.projects = S.projects.filter(p => p.id !== id); save(); go('projects'); });
}
function toggleStep(pid, sid, side) {
  const p = proj(pid), s = p.steps.find(x => x.id === sid); if (!s) return;
  if (MODE === 'portal') {
    if (side !== 'client') return;
    s.client = !s.client; s.clientAt = s.client ? today() : null; checkCompletion(p); render();
    portalSend('step', { projectId: pid, stepId: sid, value: s.client, date: today() });
    return toast(s.client ? `« ${s.label} » validée. ${S.settings.owner || 'Votre monteur'} est prévenu.` : 'Validation annulée');
  }
  s[side] = !s[side]; s[side + 'At'] = s[side] ? today() : null;
  const who = side === 'me' ? (S.settings.owner || 'Monteur') : cname(client(p.clientId));
  log(pid, `${who} a ${s[side] ? 'validé' : 'annulé la validation de'} « ${s.label} »`);
  checkCompletion(p); save(); render();
  if (s[side] && p.status !== 'termine') toast(`« ${s.label} » validée par ${side === 'me' ? 'vous' : 'le client'} · ${progress(p)} %`, 'Prévenir', () => notify(pid, `Bonjour, le projet « ${p.title} » avance : l'étape « ${s.label} » vient d'être validée par ${who}. Avancement : ${progress(p)} %.`));
}
function addStep(pid) { openModal('Ajouter une étape', `<label class="field"><span>Nom de l'étape</span><input id="f-step" placeholder="Sous-titrage, version 9:16…"></label>`, `<button class="btn" onclick="App.closeModal()">Annuler</button><button class="btn primary" onclick="App.saveStep('${pid}')">Ajouter</button>`); }
function saveStep(pid, sid) {
  const label = val('f-step').trim(); if (!label) return; const p = proj(pid);
  if (sid) p.steps.find(s => s.id === sid).label = label; else { p.steps.push({ id: uid(), label, me: false, client: false }); checkCompletion(p); }
  save(); closeModal(); render();
}
function renameStep(pid, sid) { const s = proj(pid).steps.find(x => x.id === sid); openModal('Renommer l\'étape', `<label class="field"><span>Nom de l'étape</span><input id="f-step" value="${esc(s.label)}"></label>`, `<button class="btn" onclick="App.closeModal()">Annuler</button><button class="btn primary" onclick="App.saveStep('${pid}','${sid}')">Enregistrer</button>`); }
function delStep(pid, sid) { const p = proj(pid); confirmBox('Supprimer cette étape ?', esc(p.steps.find(s => s.id === sid).label), 'Supprimer', () => { p.steps = p.steps.filter(s => s.id !== sid); checkCompletion(p); save(); render(); }); }
function editCollab(pid) {
  openModal('Ajouter un participant', `<p class="hint">Ex. : directeur artistique, chargé de com, producteur. Il recevra les alertes d'avancement par email ou WhatsApp.</p><div class="form">
  <label class="field"><span>Nom</span><input id="f-cn"></label><label class="field"><span>Rôle</span><input id="f-cr" placeholder="Directrice artistique"></label>
  <label class="field"><span>Email</span><input id="f-ce" type="email"></label><label class="field"><span>WhatsApp</span><input id="f-cp" type="tel" placeholder="+221 77 123 45 67"></label></div>`,
  `<button class="btn" onclick="App.closeModal()">Annuler</button><button class="btn primary" onclick="App.saveCollab('${pid}')">Ajouter</button>`);
}
function saveCollab(pid) {
  const d = { name: val('f-cn').trim(), role: val('f-cr').trim(), email: val('f-ce').trim(), phone: val('f-cp').trim() };
  if (!d.name || (!d.email && !d.phone)) return toast('Indiquez un nom et au moins un email ou un numéro WhatsApp.');
  proj(pid).collaborators.push(d); log(pid, `${d.name} ajouté aux participants`); save(); closeModal(); render();
}
function delCollab(pid, i) { const p = proj(pid); p.collaborators.splice(i, 1); save(); render(); }

/* ---------------- Notifications email / WhatsApp ---------------- */
function openSend(title, people, subject, msg, onSent) {
  notifyCtx = { people, subject, onSent };
  openModal(title, `<label class="field"><span>Message</span><textarea id="nt-msg" rows="6">${esc(msg)}</textarea></label>
  <div class="people">${people.map((x, i) => `<div class="person"><div><b>${esc(x.name)}</b> <span class="muted small">${esc(x.role || '')}</span><div class="mono small muted">${esc(x.email || '')} ${esc(x.phone || '')}</div></div><div class="row">${x.email ? `<a class="btn sm" href="#" onclick="App.prepLink(this,${i},'mail')">Email</a>` : ''}${x.phone ? `<a class="btn sm wa" href="#" target="_blank" rel="noopener" onclick="App.prepLink(this,${i},'wa')">WhatsApp</a>` : ''}</div></div>`).join('')}</div>
  <p class="hint">Chaque bouton ouvre votre messagerie ou WhatsApp avec le message prêt : il ne reste qu'à appuyer sur Envoyer.</p>`,
  `<button class="btn" onclick="App.copyMsg()">Copier le message</button><button class="btn primary" onclick="App.closeModal()">Terminé</button>`);
}
function prepLink(a, i, kind) {
  const x = notifyCtx.people[i], msg = val('nt-msg');
  a.href = kind === 'mail' ? `mailto:${encodeURIComponent(x.email)}?subject=${encodeURIComponent(notifyCtx.subject)}&body=${encodeURIComponent(msg)}` : `https://wa.me/${x.phone.replace(/[^\d]/g, '')}?text=${encodeURIComponent(msg)}`;
  notifyCtx.onSent && notifyCtx.onSent(x, kind);
}
function copyMsg() { const t = val('nt-msg'); navigator.clipboard?.writeText(t).then(() => toast('Message copié'), () => { $('#nt-msg').select(); toast('Sélectionné : faites Ctrl+C'); }); }
function notify(pid, msg) {
  const p = proj(pid), c = client(p.clientId);
  const people = [{ name: cname(c), role: 'Client', email: c.email, phone: c.phone }, ...p.collaborators];
  const done = p.steps.filter(s => s.me && s.client).map(s => s.label), next = p.steps.find(s => !(s.me && s.client));
  msg = msg || `Bonjour,\n\nPoint d'avancement sur « ${p.title} » : ${progress(p)} %.\nÉtapes terminées : ${done.join(', ') || 'aucune pour l\'instant'}.\n${next ? `Prochaine étape : ${next.label}.` : 'Toutes les étapes sont terminées.'}\nLivraison prévue le ${fdate(p.deadline)}.${portalLink(c.id) ? `\n\nSuivez le projet et validez les étapes ici :\n${portalLink(c.id)}` : ''}\n\n${S.settings.owner} · ${S.settings.name}`;
  openSend('Prévenir les participants', people, `${p.title} · avancement ${progress(p)} %`, msg, (x, k) => { log(pid, `Alerte envoyée à ${x.name} (${k === 'mail' ? 'email' : 'WhatsApp'})`); save(); });
}

/* ---------------- Médias & commentaires ---------------- */
function mediaType(f) { return f.type.startsWith('video') ? 'video' : f.type.startsWith('audio') ? 'audio' : f.type.startsWith('image') ? 'image' : null; }
async function uploadMedia(pid, input) {
  const f = input.files[0]; if (!f) return; const type = mediaType(f); if (!type) return toast('Format non pris en charge : choisissez une vidéo, un son ou une image.');
  const fid = uid(); try { await DB.put('files', fid, f); } catch (e) { return toast('Espace de stockage insuffisant pour ce fichier.'); }
  const m = { id: uid(), projectId: pid, name: f.name, type, versions: [{ v: 1, fileId: fid, name: f.name, at: today() }], comments: [] };
  S.media.push(m); log(pid, `Média « ${f.name} » importé (V1)`); save(); go('media', m.id);
  toast('Média en ligne pour révision', 'Prévenir le client', () => notify(pid, `Bonjour, « ${f.name} » est disponible pour relecture sur le projet « ${proj(pid).title} ». Vous pouvez ajouter vos commentaires directement sur la timeline.`));
}
async function newVersion(mid, input) {
  const f = input.files[0]; if (!f) return; const m = mediaById(mid); const fid = uid();
  try { await DB.put('files', fid, f); } catch (e) { return toast('Espace de stockage insuffisant pour ce fichier.'); }
  const prev = m.versions.at(-1).v, n = prev + 1, fixed = m.comments.filter(c => c.v === prev && c.resolved).length;
  m.versions.push({ v: n, fileId: fid, name: f.name, at: today() }); curVer[mid] = n; m.approvedV = null; m.approvedAt = null;
  log(m.projectId, `Nouvelle version V${n} de « ${m.name} »`); save(); render();
  toast(`V${n} en ligne`, 'Prévenir', () => notify(m.projectId, `Bonjour, la version V${n} de « ${m.name} » est disponible. ${fixed} correction${fixed > 1 ? 's' : ''} intégrée${fixed > 1 ? 's' : ''} depuis la V${prev}. Merci de la relire.`));
}
function setVer(mid, v) { curVer[mid] = v; pendingPin = null; render(); }
function capture() { const pl = $('#player'); if (pl && pl.pause && pl.tagName !== 'IMG') { pl.pause(); $('#ctime').textContent = 'Commentaire à ' + tc(pl.currentTime); } }
function pinAt(e) {
  const box = $('#imgbox'), r = box.getBoundingClientRect();
  pendingPin = { x: round((e.clientX - r.left) / r.width * 100), y: round((e.clientY - r.top) / r.height * 100) };
  box.querySelector('.pending')?.remove();
  box.insertAdjacentHTML('beforeend', `<span class="pin pending" style="left:${pendingPin.x}%;top:${pendingPin.y}%">+</span>`);
  $('#ctime').textContent = `Point placé (${Math.round(pendingPin.x)} %, ${Math.round(pendingPin.y)} %) · écrivez votre remarque`;
  $('#ctext').focus();
}
function addComment(mid) {
  const m = mediaById(mid), text = val('ctext').trim(); if (!text) return toast('Écrivez votre commentaire.');
  const v = curVer[mid] || m.versions.at(-1).v, c = { id: uid(), v, author: isOwner() ? 'me' : 'client', text, at: new Date().toISOString(), resolved: false };
  if (m.type === 'image') { if (!pendingPin) return toast('Cliquez d\'abord sur l\'image à l\'endroit concerné.'); Object.assign(c, pendingPin); }
  else c.t = $('#player')?.currentTime || 0;
  m.comments.push(c); pendingPin = null;
  if (MODE === 'portal') { render(); portalSend('comment', { mediaId: mid, comment: c }); return toast('Commentaire envoyé au monteur'); }
  log(m.projectId, `${isOwner() ? 'Vous avez' : cname(client(proj(m.projectId).clientId)) + ' a'} commenté « ${m.name} »${m.type !== 'image' ? ' à ' + tc(c.t) : ''}`);
  save(); render(); toast(isOwner() ? 'Commentaire ajouté' : 'Commentaire envoyé au monteur');
}
function seek(mid, cid) {
  const m = mediaById(mid), c = m.comments.find(x => x.id === cid); document.querySelectorAll('.cmt.focus').forEach(e => e.classList.remove('focus'));
  const el = $('#c-' + cid); if (el) { el.classList.add('focus'); el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  if (m.type === 'image') { const pin = $('#pin-' + cid); if (pin) { pin.classList.remove('flash'); void pin.offsetWidth; pin.classList.add('flash'); } }
  else { const pl = $('#player'); if (pl) { pl.currentTime = c.t; pl.pause(); } }
}
function resolve(mid, cid) { const m = mediaById(mid), c = m.comments.find(x => x.id === cid); c.resolved = !c.resolved; if (c.resolved) log(m.projectId, `Correction faite sur « ${m.name} » : ${c.text.slice(0, 60)}`); save(); render(); }
function approveMedia(mid, on) {
  const m = mediaById(mid), v = curVer[mid] || m.versions.at(-1).v;
  m.approvedV = on ? v : null; m.approvedAt = on ? today() : null;
  if (MODE === 'portal') { render(); portalSend('approve', { mediaId: mid, v, value: on, date: today() }); return toast(`V${v} validée. Merci !`); }
  log(m.projectId, on ? `V${v} de « ${m.name} » marquée validée` : `Validation de « ${m.name} » annulée`);
  save(); render();
  const pd = purgeDate(m); if (on && pd) toast(`Validée. Les fichiers seront supprimés le ${fdate(pd)}.`);
}
function delComment(mid, cid) { const m = mediaById(mid); m.comments = m.comments.filter(c => c.id !== cid); save(); render(); }
function delMedia(mid) { const m = mediaById(mid); confirmBox('Supprimer ce média ?', `« ${esc(m.name)} », toutes ses versions et commentaires seront supprimés.`, 'Supprimer', async () => { for (const v of m.versions) await DB.del('files', v.fileId).catch(() => {}); S.media = S.media.filter(x => x.id !== mid); save(); go('project', m.projectId); }); }

/* ---------------- Factures ---------------- */
function editInvoice(id, preset = {}) {
  const i = id ? invoice(id) : null;
  draft = i ? JSON.parse(JSON.stringify(i)) : { id: null, clientId: preset.clientId || S.clients[0]?.id, projectId: preset.projectId || '', kind: preset.kind || 'standard', date: today(), due: addDays(today(), +S.settings.payDays || 30), lines: preset.lines || [{ label: '', qty: 1, price: 0 }], discount: { type: 'pct', value: 0 }, tva: +S.settings.tva || 0, notes: '', status: 'brouillon', payments: [], reminders: [] };
  if (!draft.clientId) { toast('Ajoutez d\'abord un client.'); return editClient(); }
  openModal(i ? `Modifier ${i.number}` : 'Nouvelle facture', invForm(), `<button class="btn" onclick="App.closeModal()">Annuler</button><button class="btn primary" onclick="App.saveInvoice()">Enregistrer</button>`, true);
}
function invForm() {
  const d = draft, ps = S.projects.filter(p => p.clientId === d.clientId), t = totals(d);
  return `<div class="form">
  <label class="field"><span>Client</span><select id="d-client" onchange="App.d('clientId',this.value);App.d('projectId','');App.refreshForm()">${S.clients.map(c => `<option value="${c.id}" ${c.id === d.clientId ? 'selected' : ''}>${esc(cname(c))}</option>`).join('')}</select></label>
  <label class="field"><span>Projet</span><select id="d-project" onchange="App.d('projectId',this.value)"><option value="">Aucun</option>${ps.map(p => `<option value="${p.id}" ${p.id === d.projectId ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}</select></label>
  <label class="field"><span>Date d'émission</span><input id="d-date" type="date" value="${d.date}" oninput="App.d('date',this.value)"></label>
  <label class="field"><span>Échéance</span><input id="d-due" type="date" value="${d.due}" oninput="App.d('due',this.value)"></label>
  <label class="field"><span>Type</span><select id="d-kind" onchange="App.d('kind',this.value)">${[['standard', 'Facture'], ['acompte', 'Acompte'], ['final', 'Facture finale de projet']].map(([k, l]) => `<option value="${k}" ${d.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
  <label class="field"><span>TVA (%)</span><input id="d-tva" type="number" min="0" step="any" value="${d.tva}" oninput="App.d('tva',this.value)"></label></div>
  <div class="field"><span>Lignes</span><div class="tbl-wrap"><table class="lines-ed"><tbody>${d.lines.map((l, k) => `<tr><td><input id="dl-l${k}" value="${esc(l.label)}" placeholder="Désignation" oninput="App.dl(${k},'label',this.value)"></td><td><input id="dl-q${k}" type="number" step="any" value="${l.qty}" aria-label="Quantité" oninput="App.dl(${k},'qty',this.value)" style="width:70px"></td><td><input id="dl-p${k}" type="number" step="any" value="${l.price}" aria-label="Prix unitaire" oninput="App.dl(${k},'price',this.value)" style="width:110px"></td><td><button class="icon-btn" aria-label="Retirer la ligne" onclick="App.delLine(${k})">×</button></td></tr>`).join('')}</tbody></table></div><button class="btn sm ghost" style="align-self:flex-start" onclick="App.addLine()">Ajouter une ligne</button></div>
  <div class="form"><label class="field"><span>Remise</span><input id="d-dv" type="number" min="0" step="any" value="${d.discount.value}" oninput="App.dd('value',this.value)"></label>
  <label class="field"><span>Type de remise</span><select id="d-dt" onchange="App.dd('type',this.value)"><option value="pct" ${d.discount.type === 'pct' ? 'selected' : ''}>Pourcentage (%)</option><option value="fixed" ${d.discount.type === 'fixed' ? 'selected' : ''}>Montant (${esc(S.settings.currency)})</option></select></label>
  <label class="field full"><span>Note sur la facture (facultatif)</span><input id="d-notes" value="${esc(d.notes)}" oninput="App.d('notes',this.value)" placeholder="Merci pour votre confiance !"></label></div>
  <div class="sum" id="d-tot">${draftTotals(t)}</div>`;
}
const draftTotals = t => `<div><span class="muted">Sous-total HT</span><span class="mono">${fmt(t.sub)}</span></div>${t.disc ? `<div><span class="muted">Remise</span><span class="mono">− ${fmt(t.disc)}</span></div>` : ''}<div><span class="muted">TVA</span><span class="mono">${fmt(t.tva)}</span></div><div class="grand"><span>Total TTC</span><span class="mono">${fmt(t.ttc)}</span></div>`;
const upd = () => { const e = $('#d-tot'); if (e) e.innerHTML = draftTotals(totals(draft)); };
function saveInvoice() {
  const d = draft; d.lines = d.lines.filter(l => l.label || +l.price).map(l => ({ label: l.label, qty: +l.qty || 0, price: +l.price || 0 })); d.tva = +d.tva || 0; d.discount.value = +d.discount.value || 0;
  if (!d.lines.length) return toast('Ajoutez au moins une ligne.');
  if (!d.id) { d.id = uid(); d.number = nextNumber(); S.invoices.push(d); log(d.projectId, `Facture ${d.number} créée`); }
  else { const k = S.invoices.findIndex(x => x.id === d.id); S.invoices[k] = d; log(d.projectId, `Facture ${d.number} modifiée`); }
  save(); closeModal(); go('invoice', d.id); toast('Facture enregistrée');
}
function applyDiscount(id) { const i = invoice(id); i.discount = { type: val('qd-type'), value: +val('qd-val') || 0 }; log(i.projectId, `Remise appliquée sur ${i.number}`); save(); render(); toast(`Nouveau total : ${fmt(totals(i).ttc)}`); }
function validateInvoice(id) { const i = invoice(id); i.status = 'envoyee'; i.sentAt = today(); log(i.projectId, `Facture ${i.number} validée et envoyée`); save(); render(); sendInvoice(id); }
function sendInvoice(id) {
  const i = invoice(id), c = client(i.clientId), t = totals(i), p = proj(i.projectId);
  openSend(`Envoyer ${i.number}`, [{ name: cname(c), role: 'Client', email: c.email, phone: c.phone }], `Facture ${i.number} · ${S.settings.name}`,
    `Bonjour ${c.name || ''},\n\nVeuillez trouver ci-joint la facture ${i.number}${p ? ` pour le projet « ${p.title} »` : ''}, d'un montant de ${fmt(t.ttc)}, payable avant le ${fdate(i.due)}.\n\nCoordonnées de paiement :\n${S.settings.iban}\n\nMerci pour votre confiance,\n${S.settings.owner} · ${S.settings.name}`,
    (x, k) => { log(i.projectId, `Facture ${i.number} envoyée par ${k === 'mail' ? 'email' : 'WhatsApp'}`); save(); });
  $('#m-body').insertAdjacentHTML('beforeend', `<p class="hint">Pour joindre le PDF : fermez cette fenêtre, cliquez sur « Imprimer / enregistrer en PDF », puis ajoutez le fichier à votre message.</p>`);
}
function remind(id) {
  const i = invoice(id), c = client(i.clientId), t = totals(i), late = diffDays(i.due, today()), n = (i.reminders || []).length;
  openSend(`Relancer ${i.number}`, [{ name: cname(c), role: 'Client', email: c.email, phone: c.phone }], `${n ? 'Nouvelle relance' : 'Rappel'} · facture ${i.number}`,
    `Bonjour ${c.name || ''},\n\n${late > 0 ? `Sauf erreur de ma part, la facture ${i.number} arrivée à échéance le ${fdate(i.due)} (il y a ${late} jours) reste impayée.` : `Petit rappel : la facture ${i.number} arrive à échéance le ${fdate(i.due)}.`} Le montant restant dû est de ${fmt(t.due)}.\n\nCoordonnées de paiement :\n${S.settings.iban}\n\nSi le règlement a déjà été effectué, merci de ne pas tenir compte de ce message et de m'envoyer la preuve de paiement.\n\nCordialement,\n${S.settings.owner}`,
    (x, k) => { i.reminders = i.reminders || []; if (i.reminders.at(-1) !== today()) i.reminders.push(today()); log(i.projectId, `Relance ${i.number} envoyée par ${k === 'mail' ? 'email' : 'WhatsApp'}`); save(); });
}
function payModal(id) {
  const i = invoice(id), t = totals(i);
  openModal(`Paiement · ${i.number}`, `<div class="form">
  <label class="field"><span>Date de réception</span><input id="p-date" type="date" value="${today()}"></label>
  <label class="field"><span>Montant (${esc(S.settings.currency)})</span><input id="p-amount" type="number" step="any" min="0" value="${t.due}"></label>
  <label class="field"><span>Mode de paiement</span><select id="p-method">${METHODS.map(m => `<option>${m}</option>`).join('')}</select></label>
  <label class="field"><span>Référence (facultatif)</span><input id="p-ref" placeholder="N° de transaction"></label>
  <label class="field full"><span>Preuve de paiement (capture, reçu, PDF)</span><input id="p-proof" type="file" accept="image/*,application/pdf"></label></div><p class="hint">Reste dû : ${fmt(t.due)}</p>`,
  `<button class="btn" onclick="App.closeModal()">Annuler</button><button class="btn primary" onclick="App.savePayment('${id}')">Enregistrer le paiement</button>`);
}
async function savePayment(id) {
  const i = invoice(id), amount = +val('p-amount'); if (!amount) return toast('Indiquez le montant reçu.');
  const f = $('#p-proof').files[0], p = { id: uid(), date: val('p-date') || today(), amount, method: val('p-method'), ref: val('p-ref').trim() };
  if (f) { p.proofId = uid(); p.proofName = f.name; await DB.put('files', p.proofId, f).catch(() => { delete p.proofId; }); }
  i.payments = i.payments || []; i.payments.push(p); if (!isSent(i)) i.status = 'envoyee';
  log(i.projectId, `Paiement de ${fmt(amount)} reçu pour ${i.number} (${p.method})`); save(); closeModal(); render();
  toast(totals(i).due <= 0 ? `${i.number} est soldée` : `Paiement enregistré · reste ${fmt(totals(i).due)}`);
}
function delPayment(iid, pid) { const i = invoice(iid); confirmBox('Supprimer ce paiement ?', 'La facture redeviendra due pour ce montant.', 'Supprimer', () => { i.payments = i.payments.filter(p => p.id !== pid); save(); render(); }); }
function delInvoice(id) { const i = invoice(id); confirmBox(`Supprimer ${i.number} ?`, 'Cette action est définitive. Les paiements associés seront aussi retirés de la comptabilité.', 'Supprimer', () => { S.invoices = S.invoices.filter(x => x.id !== id); save(); go('invoices'); }); }
function setTpl(id, v) { invoice(id).template = v || undefined; save(); render(); }
function finalInvoice(pid) { const i = createInvoiceFromProject(proj(pid), 'brouillon'); save(); go('invoice', i.id); }
function depositInvoice(pid) { const p = proj(pid); editInvoice(null, { clientId: p.clientId, projectId: pid, kind: 'acompte', lines: [{ label: `Acompte 30 % — ${p.title}`, qty: 1, price: round((+p.amount || 0) * .3) }] }); }

/* ---------------- Dépenses & export ---------------- */
function editExpense() {
  openModal('Ajouter une dépense', `<div class="form"><label class="field"><span>Date</span><input id="e-date" type="date" value="${today()}"></label><label class="field"><span>Montant (${esc(S.settings.currency)})</span><input id="e-amount" type="number" step="any" min="0"></label>
  <label class="field full"><span>Libellé</span><input id="e-label" placeholder="Abonnement logiciel, disque dur, musique…"></label><label class="field full"><span>Catégorie</span><select id="e-cat">${['Logiciels', 'Matériel', 'Musique & banques d\'images', 'Déplacements', 'Sous-traitance', 'Frais bancaires', 'Autre'].map(c => `<option>${c}</option>`).join('')}</select></label></div>`,
  `<button class="btn" onclick="App.closeModal()">Annuler</button><button class="btn primary" onclick="App.saveExpense()">Ajouter</button>`);
}
function saveExpense() { const e = { id: uid(), date: val('e-date') || today(), amount: +val('e-amount') || 0, label: val('e-label').trim(), category: val('e-cat') }; if (!e.label || !e.amount) return toast('Indiquez un libellé et un montant.'); S.expenses.push(e); save(); closeModal(); render(); }
function delExpense(id) { S.expenses = S.expenses.filter(e => e.id !== id); save(); render(); }
function exportCSV() {
  const rows = [['Type', 'Date', 'Pièce', 'Client / libellé', 'Mode / catégorie', 'Montant']];
  allPayments().forEach(p => rows.push(['Encaissement', p.date, p.inv.number, cname(client(p.inv.clientId)), p.method, p.amount]));
  S.invoices.filter(isSent).forEach(i => { const t = totals(i); if (t.due > 0) rows.push(['Créance', i.due, i.number, cname(client(i.clientId)), invStatus(i) === 'retard' ? 'En retard' : 'À échoir', t.due]); });
  S.expenses.forEach(e => rows.push(['Dépense', e.date, '', e.label, e.category, -e.amount]));
  download(`valideo-compta-${today()}.csv`, new Blob(['﻿' + rows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\n')], { type: 'text/csv' }));
}

/* ---------------- Réglages ---------------- */
function setS(k, v, rerender) {
  S.settings[k] = ['tva', 'payDays', 'next', 'retentionDays'].includes(k) ? (+v || 0) : v; save();
  if (k === 'retentionDays') purgeExpired();
  if (rerender) return render();
  const pv = $('#tpl-preview'); if (pv) pv.innerHTML = invoiceDoc(sampleInvoice(), S.settings.template);
}
async function uploadLogo(input) { const f = input.files[0]; if (!f) return; try { S.settings.logo = await readImage(f, 500); save(); render(); } catch (e) { toast('Image illisible : essayez un PNG ou un JPG.'); } }
async function uploadSig(input) { const f = input.files[0]; if (!f) return; try { S.settings.signature = await readImage(f, 600); save(); render(); } catch (e) { toast('Image illisible : essayez un PNG ou un JPG.'); } }
function saveSig() { const cv = $('#sigpad'); if (!sigDirty && !S.settings.signature) return toast('Signez d\'abord dans le cadre.'); S.settings.signature = cv.toDataURL('image/png'); save(); render(); toast('Signature enregistrée'); }
function clearSig() { const cv = $('#sigpad'); cv.getContext('2d').clearRect(0, 0, cv.width, cv.height); sigDirty = false; }
async function exportData() {
  const files = {}; for (const k of await DB.keys('files')) { const b = await DB.get('files', k); if (b) files[k] = { name: b.name || k, data: await readDataURL(b) }; }
  download(`valideo-sauvegarde-${today()}.json`, new Blob([JSON.stringify({ app: 'valideo', version: 1, state: S, files })], { type: 'application/json' }));
}
async function importData(input) {
  const f = input.files[0]; if (!f) return;
  try {
    const j = JSON.parse(await f.text()); if (!['valideo', 'bobine'].includes(j.app) || !j.state) throw 0;
    await DB.clear('files');
    for (const [k, v] of Object.entries(j.files || {})) { const b = await (await fetch(v.data)).blob(); await DB.put('files', k, new File([b], v.name, { type: b.type })); }
    S = migrate(j.state); await DB.put('kv', 'state', S); Object.keys(urlCache).forEach(k => delete urlCache[k]); go('dashboard'); toast('Sauvegarde restaurée');
  } catch (e) { toast('Ce fichier n\'est pas une sauvegarde Validéo valide.'); }
}
function askReset() { confirmBox('Tout effacer ?', 'Clients, projets, médias, factures et dépenses seront supprimés de ce navigateur. Exportez une sauvegarde avant si besoin.', 'Tout effacer', async () => { await DB.clear('files'); S = blankState(); save(); view = { as: 'me' }; go('settings'); toast('Données effacées. Commencez par votre identité.'); }); }
function setFilter(kind, v) { if (kind === 'proj') projFilter = v; else invFilter = v; render(); }

/* ---------------- État initial & exemples ---------------- */
function blankState() {
  return { settings: { name: 'Mon studio', owner: 'Votre nom', email: '', phone: '', address: '', siret: '', iban: 'IBAN : …', currency: '€', tva: 0, payDays: 30, prefix: 'FAC', next: 1, template: 'moderne', color: '#0b7285', logo: '', signature: '', stampTop: 'MON STUDIO', stampBottom: 'MONTAGE VIDÉO', stampCenter: 'BON POUR ACCORD', showStamp: true, legal: '', penalty: '', sample: false }, clients: [], projects: [], media: [], invoices: [], expenses: [], activity: [] };
}
/* ---------------- En ligne : Supabase (compte, synchro, fichiers, espaces clients) ---------------- */
const URL_TTL = 60 * 60 * 24 * 14;
const Cloud = {
  ready: false, status: 'local', BUCKET: 'valideo-media', busy: false, again: false, pushT: null, signed: {}, lastPub: {}, channel: null,
  init() { if (CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase) { sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey); this.ready = true; } },
  setStatus(s) { this.status = s; const el = $('#sync'); if (el) el.innerHTML = syncChip(); },
  async start() {
    if (!this.ready) return;
    const { data } = await sb.auth.getSession(); user = data.session?.user || null;
    sb.auth.onAuthStateChange((_e, session) => { const u = session?.user || null; if (u?.id !== user?.id) { user = u; if (user) this.firstSync(); else { this.setStatus('local'); render(); } } });
    if (user) await this.firstSync();
    addEventListener('online', () => this.sync()); addEventListener('offline', () => this.setStatus(this.status));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.sync(); });
    setInterval(() => this.sync(), 90000);
  },
  async firstSync() {
    try {
      const { data, error } = await sb.from('workspaces').select('data,updated_at').eq('owner', user.id).maybeSingle(); if (error) throw error;
      if (data?.data && !(S.cloud.owner === user.id && S.cloud.dirty)) { S = migrate(data.data); S.cloud.syncedAt = data.updated_at; S.cloud.dirty = false; }
      else if (!data?.data) { if (S.settings.sample) { await DB.clear('files'); S = blankState(); } S.cloud.dirty = true; }
      S.cloud.owner = user.id; await DB.put('kv', 'state', S); render();
      this.subscribe(); await this.sync();
    } catch (e) { console.warn(e); this.setStatus('error'); }
  },
  subscribe() {
    if (this.channel) sb.removeChannel(this.channel);
    this.channel = sb.channel('actions-' + user.id).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'portal_actions', filter: `owner=eq.${user.id}` }, () => this.sync()).subscribe();
  },
  schedulePush() { if (!user || MODE === 'portal') return; S.cloud.dirty = true; clearTimeout(this.pushT); this.pushT = setTimeout(() => this.sync(), 1500); },
  async sync() {
    if (!user || !navigator.onLine) return this.setStatus(this.status);
    if (this.busy) { this.again = true; return; }
    this.busy = true; this.setStatus('sync');
    try { await this.pullActions(); await this.pullRemote(); await this.uploadFiles(); await this.deleteFiles(); await this.publishPortals(); await this.push(); this.setStatus('ok'); }
    catch (e) { console.warn(e); this.setStatus('error'); }
    finally { this.busy = false; if (this.again) { this.again = false; setTimeout(() => this.sync(), 300); } }
  },
  async pullRemote() {
    if (S.cloud.dirty) return;
    const { data, error } = await sb.from('workspaces').select('data,updated_at').eq('owner', user.id).maybeSingle(); if (error) throw error;
    if (data && data.updated_at > (S.cloud.syncedAt || '')) { S = migrate(data.data); S.cloud.syncedAt = data.updated_at; S.cloud.dirty = false; S.cloud.owner = user.id; await DB.put('kv', 'state', S); render(); }
  },
  async push() {
    if (!S.cloud.dirty) return; S.cloud.dirty = false;
    const now = new Date().toISOString();
    const { error } = await sb.from('workspaces').upsert({ owner: user.id, data: S, updated_at: now });
    if (error) { S.cloud.dirty = true; throw error; }
    S.cloud.syncedAt = now; await DB.put('kv', 'state', S);
  },
  async pullActions() {
    const { data, error } = await sb.from('portal_actions').select('*').eq('applied', false).order('id'); if (error) throw error;
    if (!data.length) return;
    const byToken = Object.fromEntries(Object.entries(S.portals).map(([cid, t]) => [t, cid]));
    data.forEach(a => applyAction(a, byToken[a.token]));
    const { error: e2 } = await sb.from('portal_actions').update({ applied: true }).in('id', data.map(a => a.id)); if (e2) throw e2;
    S.cloud.dirty = true; await DB.put('kv', 'state', S); render();
    toast(`${data.length} nouvelle${data.length > 1 ? 's' : ''} action${data.length > 1 ? 's' : ''} de vos clients`, 'Voir', () => go('dashboard'));
  },
  async uploadFiles() {
    const max = (+CFG.maxUploadMB || 50) * 1048576;
    for (const id of referencedFiles()) {
      if (S.cloud.uploaded[id] || S.cloud.tooBig[id]) continue;
      const b = await DB.get('files', id).catch(() => null); if (!b) continue;
      if (b.size > max) { S.cloud.tooBig[id] = true; S.cloud.dirty = true; toast(`« ${b.name || 'Fichier'} » dépasse ${CFG.maxUploadMB || 50} Mo : il reste sur cet appareil. Exportez une version de relecture plus légère (720p).`); continue; }
      this.setStatus('upload');
      const { error } = await sb.storage.from(this.BUCKET).upload(`${user.id}/${id}`, b, { upsert: true, contentType: b.type || 'application/octet-stream' });
      if (error) throw error;
      S.cloud.uploaded[id] = true; S.cloud.dirty = true;
    }
  },
  async deleteFiles() {
    if (!S.cloud.pendingDel.length) return;
    const ids = [...S.cloud.pendingDel];
    const { error } = await sb.storage.from(this.BUCKET).remove(ids.map(id => `${user.id}/${id}`)); if (error) throw error;
    S.cloud.pendingDel = S.cloud.pendingDel.filter(id => !ids.includes(id)); ids.forEach(id => delete this.signed[id]); S.cloud.dirty = true;
  },
  async publishPortals() {
    const now = Date.now();
    S.clients.forEach(c => { if (!S.portals[c.id]) { S.portals[c.id] = crypto.randomUUID(); S.cloud.dirty = true; } });
    const need = [];
    S.clients.forEach(c => clientFiles(c.id).forEach(id => { if (S.cloud.uploaded[id] && !(this.signed[id]?.exp > now + 3 * 864e5) && !need.includes(id)) need.push(id); }));
    if (need.length) {
      const { data, error } = await sb.storage.from(this.BUCKET).createSignedUrls(need.map(id => `${user.id}/${id}`), URL_TTL); if (error) throw error;
      data.forEach((d, k) => { if (d.signedUrl) this.signed[need[k]] = { url: d.signedUrl, exp: now + URL_TTL * 1000 }; });
    }
    const rows = [];
    for (const c of S.clients) {
      const urls = Object.fromEntries(clientFiles(c.id).filter(id => this.signed[id]).map(id => [id, this.signed[id].url]));
      const snap = portalSnapshot(c.id, urls), js = JSON.stringify(snap);
      if (this.lastPub[c.id] === js) continue;
      rows.push({ token: S.portals[c.id], owner: user.id, client_id: c.id, data: snap, updated_at: new Date().toISOString() }); this.lastPub[c.id] = js;
    }
    if (rows.length) { const { error } = await sb.from('portals').upsert(rows); if (error) { rows.forEach(r => delete this.lastPub[r.client_id]); throw error; } }
    const gone = Object.keys(S.portals).filter(cid => !client(cid));
    if (gone.length) { const { error } = await sb.from('portals').delete().in('client_id', gone).eq('owner', user.id); if (!error) { gone.forEach(cid => delete S.portals[cid]); S.cloud.dirty = true; } }
  }
};
function referencedFiles() {
  const ids = []; S.media.forEach(m => { if (!m.purged) m.versions.forEach(v => ids.push(v.fileId)); });
  S.invoices.forEach(i => (i.payments || []).forEach(p => p.proofId && ids.push(p.proofId))); return ids;
}
function clientFiles(cid) {
  const pids = new Set(S.projects.filter(p => p.clientId === cid).map(p => p.id)), ids = [];
  S.media.filter(m => pids.has(m.projectId) && !m.purged).forEach(m => m.versions.forEach(v => ids.push(v.fileId)));
  S.invoices.filter(i => i.clientId === cid && isSent(i)).forEach(i => (i.payments || []).forEach(p => p.proofId && ids.push(p.proofId)));
  return ids;
}
function portalSnapshot(cid, urls) {
  const c = { ...client(cid) }; delete c.notes;
  const ps = S.projects.filter(p => p.clientId === cid), pids = new Set(ps.map(p => p.id));
  const settings = { ...S.settings }; delete settings.sample; delete settings.next;
  return { settings, clients: [c], projects: ps, media: S.media.filter(m => pids.has(m.projectId)), invoices: S.invoices.filter(i => i.clientId === cid && isSent(i)), expenses: [],
    activity: S.activity.filter(a => pids.has(a.pid) && !/Facture|Relance|Paiement|Remise|Alerte/.test(a.text)).slice(0, 40), urls };
}
/* Applique une action envoyée depuis un espace client (validation, commentaire, approbation) */
function applyAction(a, cid) {
  const P = a.payload || {}, own = MODE !== 'portal';
  const okProj = p => p && (!cid || p.clientId === cid);
  if (a.type === 'step') {
    const p = proj(P.projectId), s = okProj(p) && p.steps.find(x => x.id === P.stepId); if (!s) return;
    s.client = !!P.value; s.clientAt = s.client ? (P.date || today()) : null;
    if (own) log(p.id, `${cname(client(p.clientId))} a ${s.client ? 'validé' : 'annulé la validation de'} « ${s.label} »`);
    checkCompletion(p);
  } else if (a.type === 'comment') {
    const m = mediaById(P.mediaId); if (!m || !okProj(proj(m.projectId)) || !P.comment || m.comments.some(c => c.id === P.comment.id)) return;
    const c = P.comment; m.comments.push({ id: String(c.id), v: +c.v, t: c.t != null ? +c.t : undefined, x: c.x != null ? +c.x : undefined, y: c.y != null ? +c.y : undefined, text: String(c.text || '').slice(0, 2000), at: c.at || new Date().toISOString(), author: 'client', resolved: false });
    if (own) log(m.projectId, `${cname(client(proj(m.projectId).clientId))} a commenté « ${m.name} »${c.t != null ? ' à ' + tc(c.t) : ''}`);
  } else if (a.type === 'approve') {
    const m = mediaById(P.mediaId); if (!m || !okProj(proj(m.projectId))) return;
    m.approvedV = P.value === false ? null : +P.v; m.approvedAt = P.value === false ? null : (P.date || today());
    if (own) log(m.projectId, m.approvedV ? `${cname(client(proj(m.projectId).clientId))} a validé la V${m.approvedV} de « ${m.name} »` : `Validation de « ${m.name} » annulée par le client`);
  }
}
async function portalSend(type, payload) {
  try { const { error } = await sb.rpc('portal_action', { p_token: PORTAL_TOKEN, p_type: type, p_payload: payload }); if (error) throw error; }
  catch (e) { toast("Connexion impossible : votre action n'a pas été transmise. Vérifiez votre connexion puis réessayez."); }
}
async function loadPortal(first) {
  const { data, error } = await sb.rpc('get_portal', { p_token: PORTAL_TOKEN });
  if (error || !data?.data) { if (first) $('#main').innerHTML = `<div class="loading"><div class="card" style="max-width:420px;text-align:center"><h2>Lien invalide ou expiré</h2><p class="hint">Demandez un nouveau lien à votre monteur.</p></div></div>`; return; }
  S = migrate(data.data); S.urls = data.data.urls || {};
  (data.pending || []).forEach(a => applyAction(a));
  view = { as: 'client', clientId: S.clients[0].id }; if (first) route = { page: 'client', id: view.clientId };
  const b = $('#brand'); b.innerHTML = `${S.settings.logo ? `<img src="${S.settings.logo}" alt="" style="width:34px;height:34px;object-fit:contain;border-radius:10px;background:#fff;padding:3px">` : '<span class="logo">' + b.querySelector('.logo').innerHTML + '</span>'}<span>${esc(S.settings.name)}<small>Espace projet</small></span>`;
  if (first || !document.activeElement || !['TEXTAREA', 'INPUT'].includes(document.activeElement.tagName)) render();
}
async function signIn(create) {
  const email = val('a-email').trim(), password = val('a-pass');
  if (!email || password.length < 8) return toast('Indiquez votre email et un mot de passe d\'au moins 8 caractères.');
  const r = create ? await sb.auth.signUp({ email, password, options: { emailRedirectTo: CFG.siteUrl || location.origin + location.pathname } }) : await sb.auth.signInWithPassword({ email, password });
  if (r.error) return toast(r.error.message.includes('Invalid login') ? 'Email ou mot de passe incorrect.' : r.error.message);
  if (create && !r.data.session) return toast('Compte créé. Confirmez votre adresse via l\'email reçu, puis connectez-vous.');
  toast('Connecté. Synchronisation en cours…');
}
async function signOut() { await sb.auth.signOut(); user = null; Cloud.setStatus('local'); render(); toast('Déconnecté. Vos données restent sur cet appareil.'); }
const accountCard = () => {
  if (!Cloud.ready) return `<section class="card"><h2>Compte en ligne</h2><p class="hint">La connexion à Supabase n'est pas configurée (fichier config.js). L'outil fonctionne en local sur cet appareil.</p></section>`;
  if (!user) return `<section class="card"><h2>Compte en ligne</h2><p class="hint">Connectez-vous pour retrouver vos données sur tous vos appareils et donner à chaque client un lien vers son espace.</p>
    <div class="form"><label class="field"><span>Email</span><input id="a-email" type="email" autocomplete="username"></label><label class="field"><span>Mot de passe</span><input id="a-pass" type="password" autocomplete="current-password"></label></div>
    <div class="row"><button class="btn primary" onclick="App.signIn(false)">Se connecter</button><button class="btn" onclick="App.signIn(true)">Créer mon compte</button></div></section>`;
  return `<section class="card"><div class="card-h"><h2>Compte en ligne</h2>${pill(Cloud.status === 'error' ? 'bad' : 'ok', Cloud.status === 'error' ? 'Erreur' : 'Connecté')}</div><p class="hint">${esc(user.email)} · ${S.cloud.syncedAt ? 'dernière synchro ' + ftime(S.cloud.syncedAt) : 'première synchro en cours'}. Les fichiers de plus de ${CFG.maxUploadMB || 50} Mo restent sur cet appareil.</p>
    <div class="row"><button class="btn" onclick="App.syncNow()">Synchroniser maintenant</button><button class="btn ghost" onclick="App.signOut()">Se déconnecter</button></div></section>`;
};
function copyText(t) { navigator.clipboard?.writeText(t).then(() => toast('Lien copié'), () => toast(t)); }
function sendPortal(cid) { const c = client(cid), l = portalLink(cid); openSend('Envoyer l\'espace client', [{ name: cname(c), role: 'Client', email: c.email, phone: c.phone }], `Votre espace projet · ${S.settings.name}`, `Bonjour ${c.name || ''},\n\nSuivez vos projets, validez les étapes et commentez les vidéos ici :\n${l}\n\n${S.settings.owner}`); }
function migrate(s) { const b = blankState(); s.settings = { retentionDays: 7, ...b.settings, ...s.settings }; s.portals = s.portals || {}; s.cloud = { uploaded: {}, tooBig: {}, pendingDel: [], dirty: false, ...(s.cloud || {}) }; ['clients', 'projects', 'media', 'invoices', 'expenses', 'activity'].forEach(k => s[k] = s[k] || []); return s; }
function sampleFrame() {
  return new Promise(res => {
    const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 720; const g = cv.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, 720); sky.addColorStop(0, '#f6c28b'); sky.addColorStop(.55, '#e58f65'); sky.addColorStop(1, '#5b3a4a'); g.fillStyle = sky; g.fillRect(0, 0, 1280, 720);
    g.fillStyle = '#ffe9be'; g.beginPath(); g.arc(880, 330, 70, 0, 7); g.fill();
    g.fillStyle = '#3a2633'; g.beginPath(); g.moveTo(0, 520); g.quadraticCurveTo(320, 430, 640, 500); g.quadraticCurveTo(960, 570, 1280, 470); g.lineTo(1280, 720); g.lineTo(0, 720); g.fill();
    g.fillStyle = '#24171f'; g.fillRect(430, 380, 46, 150); g.beginPath(); g.arc(453, 358, 26, 0, 7); g.fill();
    g.fillStyle = '#000'; g.fillRect(0, 0, 1280, 64); g.fillRect(0, 656, 1280, 64);
    g.fillStyle = '#fff'; g.font = '600 24px monospace'; g.fillText('PLAN 14 · EXT. JOUR · MAISON KORA', 40, 698); g.fillText('01:00:12:08', 1090, 698);
    cv.toBlob(b => res(b), 'image/jpeg', .86);
  });
}
async function seed() {
  const s = blankState(), t = today(), D = n => addDays(t, n), at = n => new Date(Date.now() + n * 864e5).toISOString();
  Object.assign(s.settings, { name: 'Studio Exemple', owner: 'Sam Exemple', email: 'contact@studio-exemple.fr', phone: '+33 6 12 34 56 78', address: '12 rue des Monteurs\n75011 Paris', siret: '123 456 789 00012', iban: 'IBAN : FR76 3000 6000 0112 3456 7890 189\nBIC : AGRIFRPP', legal: 'TVA non applicable, art. 293 B du CGI.', penalty: 'Pénalité de retard : 3 fois le taux d\'intérêt légal ; indemnité forfaitaire de recouvrement : 40 €.', next: 4, stampTop: 'STUDIO EXEMPLE', stampBottom: 'MONTAGE · ÉTALONNAGE', stampCenter: 'PARIS', sample: true });
  const c1 = { id: uid(), name: 'Awa Diallo', company: 'Maison Kora', email: 'awa@maisonkora.example', phone: '+33 6 11 22 33 44', address: '4 quai de Jemmapes, 75010 Paris', notes: 'Marque de prêt-à-porter. Préfère les retours par WhatsApp.' };
  const c2 = { id: uid(), name: 'Marc Lefèvre', company: 'Association Lumen', email: 'marc@lumen.example', phone: '+33 7 55 44 33 22', address: '', notes: '' };
  const c3 = { id: uid(), name: 'Théo Ndiaye', company: '', email: 'theo@exemple.example', phone: '+221 77 123 45 67', address: '', notes: 'Youtubeur, vlog hebdomadaire.' };
  s.clients = [c1, c2, c3];
  const mk = (n, doneMe, doneCl) => DEFAULT_STEPS.map((label, i) => ({ id: uid(), label, me: i < doneMe, client: i < doneCl, meAt: i < doneMe ? D(-20 + i * 3) : null, clientAt: i < doneCl ? D(-19 + i * 3) : null }));
  const p1 = { id: uid(), clientId: c1.id, title: 'Clip campagne automne', amount: 2400, deadline: D(3), status: 'en_cours', createdAt: D(-25), collaborators: [{ name: 'Inès Morel', role: 'Directrice artistique', email: 'ines@maisonkora.example', phone: '+33 6 98 76 54 32' }], steps: mk(0, 4, 3) };
  const p2 = { id: uid(), clientId: c2.id, title: 'Film institutionnel 3 min', amount: 1800, deadline: D(-1), status: 'en_cours', createdAt: D(-40), collaborators: [], steps: mk(0, 7, 6) };
  const p3 = { id: uid(), clientId: c3.id, title: 'Vlog série #12', amount: 350, deadline: D(-2), status: 'termine', doneAt: t, createdAt: D(-12), collaborators: [], steps: mk(0, 7, 7) };
  const p4 = { id: uid(), clientId: c2.id, title: 'Teaser festival', amount: 900, deadline: D(-62), status: 'termine', doneAt: D(-60), createdAt: D(-80), collaborators: [], steps: mk(0, 7, 7) };
  const p5 = { id: uid(), clientId: c3.id, title: 'Vlog série #13', amount: 350, deadline: D(9), status: 'en_cours', createdAt: D(-2), collaborators: [], steps: mk(0, 1, 1) };
  s.projects = [p1, p2, p3, p4, p5];
  const fid = uid(); const blob = await sampleFrame(); if (blob) await DB.put('files', fid, new File([blob], 'plan14-etalonnage.jpg', { type: 'image/jpeg' })).catch(() => {});
  s.media = [{ id: uid(), projectId: p1.id, name: 'Plan 14 · étalonnage.jpg', type: 'image', versions: [{ v: 1, fileId: fid, name: 'plan14.jpg', at: D(-3) }], comments: [
    { id: uid(), v: 1, author: 'client', x: 35.5, y: 56, text: 'La silhouette est trop sombre, on peut remonter un peu les ombres ?', at: at(-2), resolved: false },
    { id: uid(), v: 1, author: 'client', x: 69, y: 46, text: 'Le soleil brûle un peu, baisser les hautes lumières.', at: at(-2), resolved: true },
    { id: uid(), v: 1, author: 'me', x: 82, y: 95, text: 'Le timecode incrusté sera retiré sur l\'export final.', at: at(-1), resolved: false }] }];
  const L = (label, price) => ({ label, qty: 1, price });
  s.invoices = [
    { id: uid(), number: 'FAC-' + new Date().getFullYear() + '-001', clientId: c2.id, projectId: p4.id, kind: 'final', date: D(-60), due: D(-30), lines: [L('Teaser festival — montage 45 s', 750), L('Étalonnage et mixage', 150)], discount: { type: 'pct', value: 0 }, tva: 0, notes: '', status: 'envoyee', payments: [{ id: uid(), date: D(-36), amount: 900, method: 'Virement', ref: 'VIR-88231' }], reminders: [] },
    { id: uid(), number: 'FAC-' + new Date().getFullYear() + '-002', clientId: c1.id, projectId: p1.id, kind: 'acompte', date: D(-40), due: D(-10), lines: [L('Acompte 30 % — Clip campagne automne', 720)], discount: { type: 'pct', value: 0 }, tva: 0, notes: '', status: 'envoyee', payments: [], reminders: [] },
    { id: uid(), number: 'FAC-' + new Date().getFullYear() + '-003', clientId: c3.id, projectId: p3.id, kind: 'final', date: t, due: D(30), lines: [L('Vlog série #12 — montage vidéo', 350)], discount: { type: 'pct', value: 0 }, tva: 0, notes: '', status: 'a_verifier', auto: true, payments: [], reminders: [] }];
  s.expenses = [{ id: uid(), date: D(-10), label: 'Abonnement logiciel de montage', category: 'Logiciels', amount: 72.59 }, { id: uid(), date: D(-20), label: 'Licence musique clip Kora', category: 'Musique & banques d\'images', amount: 39 }, { id: uid(), date: D(-48), label: 'Disque SSD 2 To', category: 'Matériel', amount: 159 }];
  s.activity = [
    { at: at(0), pid: p3.id, text: 'Facture FAC générée automatiquement, en attente de votre vérification'.replace('FAC', s.invoices[2].number) },
    { at: at(-.1), pid: p3.id, text: 'Théo Ndiaye a validé « Livraison des fichiers »' },
    { at: at(-1), pid: p1.id, text: 'Vous avez commenté « Plan 14 · étalonnage.jpg »' },
    { at: at(-2), pid: p1.id, text: 'Maison Kora a commenté « Plan 14 · étalonnage.jpg »' },
    { at: at(-2.2), pid: p2.id, text: 'Sam Exemple a validé « Livraison des fichiers »' }];
  return s;
}

async function init() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  Cloud.init();
  PORTAL_TOKEN = new URLSearchParams(location.search).get('portail');
  if (PORTAL_TOKEN) {
    MODE = 'portal'; document.body.classList.add('portal');
    if (!Cloud.ready) { $('#main').innerHTML = '<div class="loading">Espace client indisponible pour le moment.</div>'; return; }
    await loadPortal(true);
    setInterval(() => loadPortal(false), 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) loadPortal(false); });
    return;
  }
  await DB.open();
  let st = await DB.get('kv', 'state').catch(() => null);
  if (!st) { st = await seed(); await DB.put('kv', 'state', st).catch(() => {}); }
  S = migrate(st);
  try { const v = JSON.parse(localStorage.getItem('valideo-view')); if (v && (v.as === 'me' || client(v.clientId))) view = v; } catch (e) {}
  if (!isOwner()) route = { page: 'client', id: view.clientId };
  render(); purgeExpired(); setInterval(purgeExpired, 36e5);
  Cloud.start();
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });
init();

return { setLayout, approveMedia, copyText, sendPortal, signIn, signOut, syncNow: () => Cloud.sync(), go, setRole, setFilter, editClient, saveClient, delClient, editProject, saveProject, delProject, toggleStep, addStep, saveStep, renameStep, delStep, editCollab, saveCollab, delCollab, notify, prepLink, copyMsg, uploadMedia, newVersion, setVer, capture, pinAt, addComment, seek, resolve, delComment, delMedia,
  editInvoice, saveInvoice, applyDiscount, validateInvoice, sendInvoice, remind, payModal, savePayment, delPayment, delInvoice, setTpl, finalInvoice, depositInvoice,
  editExpense, saveExpense, delExpense, exportCSV, setS, uploadLogo, uploadSig, saveSig, clearSig, exportData, importData, askReset, closeModal, doConfirm,
  d: (k, v) => { draft[k] = v; upd(); }, dd: (k, v) => { draft.discount[k] = v; upd(); }, dl: (i, k, v) => { draft.lines[i][k] = v; upd(); },
  addLine: () => { draft.lines.push({ label: '', qty: 1, price: 0 }); $('#m-body').innerHTML = invForm(); }, delLine: i => { draft.lines.splice(i, 1); $('#m-body').innerHTML = invForm(); }, refreshForm: () => { $('#m-body').innerHTML = invForm(); } };
})();
