
// ════════════════════════════════════════════════════════
// FIREBASE CONFIG — Remplacez avec votre config Firebase
// ════════════════════════════════════════════════════════
// ⚠️ REMPLACEZ CES VALEURS PAR VOTRE CONFIG FIREBASE ⚠️
var isPreview = window.location.hostname !== 'petanque2026.vercel.app';
var FIREBASE_CONFIG = isPreview ? {
   apiKey: "AIzaSyBsQqaAC3BoexlDRiJea_4ig-GD06XTtik",
    authDomain: "petanque2026-dev.firebaseapp.com",
    projectId: "petanque2026-dev",
    storageBucket: "petanque2026-dev.firebasestorage.app",
    messagingSenderId: "380307809285",
    appId: "1:380307809285:web:9a0faf8ef3c354cf73e86c"
} : {
  apiKey: "AIzaSyB7dIu1U4OyfASS3EVFrJIEgQYO6SE5s4E",
    authDomain: "petanque2026-6ddba.firebaseapp.com",
    projectId: "petanque2026-6ddba",
    storageBucket: "petanque2026-6ddba.firebasestorage.app",
    messagingSenderId: "605171816217",
    appId: "1:605171816217:web:dce778072a15a6d2121788"
};
firebase.initializeApp(FIREBASE_CONFIG);
var db = firebase.firestore();

// ═══════════════════════════════════════════════════════
// CONSTANTES ET ÉTAT
// ═══════════════════════════════════════════════════════
const ADMIN_PWD    = 'admincohesion';
const SCORE_PWD    = 'gestionscore';
const POOL_COLORS  = {A:'#3B82F6',B:'#10B981',C:'#F97316',D:'#8B5CF6',E:'#EC4899',F:'#14B8A6',G:'#EAB308',H:'#6366F1'};
const POOL_LETTERS = 'ABCDEFGH';
function pcolor(p) { return POOL_COLORS[p] || '#8B7355'; }

let adminOpen        = false;
let scoreModeOnly    = false;
let maintenanceMode  = false;
let inscriptionsOuvertes = true;
let currentData      = null;
let myEquipeId       = null;
window._pronoSuggestions = [];

// ═══════════════════════════════════════════════════════
// FIRESTORE LIVE DATA
// ═══════════════════════════════════════════════════════
const liveData = {
  config:{}, equipes:[], matchs:[], tableau:[], consolation:[], pronostics:[], votes:[]
};
let _rebuildTimer = null;
function _scheduleRebuild() { clearTimeout(_rebuildTimer); _rebuildTimer = setTimeout(rebuildCurrentData, 80); }

function initFirebaseListeners() {
  // Timeout de chargement — affiche une erreur si rien ne charge en 8s
  const loadTimeout = setTimeout(() => {
    const sec = document.getElementById('pools-section');
    if (sec && sec.querySelector('.spinner')) {
      sec.innerHTML = `<div class="card"><div class="empty-state"><div class="es-icon">⚠️</div>
        Impossible de charger les données.<br>
        Vérifiez votre config Firebase et les règles Firestore.<br>
        <small style="color:var(--muted);font-size:0.75rem;">Ouvrez la console (F12) pour voir l'erreur.</small>
      </div></div>`;
    }
  }, 8000);

  let _firstLoad = false;
  function _onFirstLoad() {
    if (!_firstLoad) { _firstLoad = true; clearTimeout(loadTimeout); }
  }

  db.collection('config').doc('main')
    .onSnapshot(d => {
      liveData.config = d.exists ? d.data() : {};
      _onFirstLoad();
      _scheduleRebuild();
    }, e => { console.error('config:', e); });

  ['equipes','matchs','tableau','consolation','pronostics','votes'].forEach(col => {
    db.collection(col).onSnapshot(s => {
      liveData[col] = s.docs.map(d => ({ id: d.id, ...d.data() }));
      _onFirstLoad();
      _scheduleRebuild();
    }, e => console.error(col, e));
  });
}

// ═══════════════════════════════════════════════════════
// CALCUL LOCAL DES DONNÉES
// ═══════════════════════════════════════════════════════
function computeStandings(pool) {
  const teams  = liveData.equipes.filter(t => t.statut !== 'pending' && t.poule === pool);
  const matchs = liveData.matchs.filter(m => m.poule === pool && m.joue);
  const st = {};
  teams.forEach(t => { st[t.id] = { team:t, pts:0, v:0, d:0, pf:0, pc:0 }; });
  matchs.forEach(m => {
    if (!st[m.eq1]||!st[m.eq2]) return;
    const s1=Number(m.score1), s2=Number(m.score2);
    st[m.eq1].pf+=s1; st[m.eq1].pc+=s2; st[m.eq2].pf+=s2; st[m.eq2].pc+=s1;
    if (s1>s2)      { st[m.eq1].v++; st[m.eq1].pts+=2; st[m.eq2].d++; }
    else if (s2>s1) { st[m.eq2].v++; st[m.eq2].pts+=2; st[m.eq1].d++; }
    else            { st[m.eq1].pts++; st[m.eq2].pts++; }
  });
  return Object.values(st).sort((a,b) => {
    if (b.pts!==a.pts) return b.pts-a.pts;
    const da=a.pf-a.pc, db=b.pf-b.pc;
    if (db!==da) return db-da;
    return b.pf-a.pf;
  });
}

function buildPronosticsData() {
  try {
    return liveData.pronostics.map(p => {
      const choix = Array.isArray(p.choix) ? p.choix : [];
      const pvotes = liveData.votes.filter(v => v.pronosticId === p.id);
      const counts = {};
      choix.forEach(ch => { counts[ch] = 0; });
      pvotes.forEach(v => { if (counts[v.choix] !== undefined) counts[v.choix]++; });
      return { ...p, choix, totalVotes:pvotes.length, counts, votedEquipes:pvotes.map(v=>v.equipeId) };
    });
  } catch(e) { return []; }
}

function rebuildCurrentData() {
  const cfg        = liveData.config;
  const allRaw     = liveData.equipes;
  const teams          = allRaw.filter(t => t.statut!=='pending' && t.poule && t.poule!=='');
  const validatedTeams = allRaw.filter(t => t.statut!=='pending');
  const pending        = allRaw.filter(t => t.statut==='pending').map(t=>({id:t.id,nom:t.nom,j1:t.j1,j2:t.j2}));
  const pools = [...new Set(teams.map(t=>t.poule).filter(p=>p&&p!==''))].sort();
  const poolsData = pools.map(pool => ({
    pool,
    teams:     teams.filter(t=>t.poule===pool),
    matchs:    liveData.matchs.filter(m=>m.poule===pool),
    standings: computeStandings(pool)
  }));
  const tournoiDemarre = cfg.tournoiDemarre || false;
  const poolsForAssignment = tournoiDemarre
    ? poolsData.filter(p=>p.matchs.length===0||p.matchs.some(m=>!m.joue)).map(p=>({pool:p.pool,count:p.teams.length}))
    : [];
  currentData = {
    success:true, teams, validatedTeams, pending,
    pools:poolsData, tableau:liveData.tableau, consolation:liveData.consolation,
    inscriptionsOuvertes: cfg.inscriptionsOuvertes !== false,
    prixParPersonne:      cfg.prixParPersonne || 10,
    tournoiDemarre, poolsForAssignment,
    maintenanceMode: cfg.maintenanceMode || false,
    pronostics: buildPronosticsData()
  };
  applyData(currentData);
}

// ═══════════════════════════════════════════════════════
// UI CORE
// ═══════════════════════════════════════════════════════
function switchTab(id, el) {
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('tab-'+id).classList.add('active');
}

function checkPwd() {
  const val = document.getElementById('pwd-input').value;
  if (val===ADMIN_PWD||val===SCORE_PWD) {
    scoreModeOnly = (val===SCORE_PWD);
    document.getElementById('pwd-wall').style.display    = 'none';
    document.getElementById('admin-panel').style.display = 'block';
    adminOpen = true;
    if (scoreModeOnly) document.querySelectorAll('.score-only-hide').forEach(el=>el.style.display='none');
    if (currentData) renderAdmin(currentData);
  } else {
    const a = document.getElementById('pwd-alert');
    a.classList.add('show');
    setTimeout(()=>a.classList.remove('show'), 3000);
  }
}

function openRegisterModal() {
  ['reg-team','reg-p1','reg-p2'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('reg-alert').classList.remove('show');
  const closed=document.getElementById('reg-closed'), form=document.getElementById('reg-form');
  if (inscriptionsOuvertes) { closed.style.display='none'; form.style.display='block'; }
  else                       { closed.style.display='block'; form.style.display='none'; }
  document.getElementById('register-modal').classList.add('open');
}
function closeRegisterModal()   { document.getElementById('register-modal').classList.remove('open'); }
function closeRegisterOnOverlay(e) { if(e.target===document.getElementById('register-modal')) closeRegisterModal(); }
function openEditModal(id,nom,j1,j2) {
  document.getElementById('edit-team-id').value=id;
  document.getElementById('edit-nom').value=nom;
  document.getElementById('edit-j1').value=j1;
  document.getElementById('edit-j2').value=j2;
  document.getElementById('edit-alert').classList.remove('show');
  document.getElementById('edit-modal').classList.add('open');
}
function closeEditModal()   { document.getElementById('edit-modal').classList.remove('open'); }
function closeEditOnOverlay(e) { if(e.target===document.getElementById('edit-modal')) closeEditModal(); }
function closeFicheModal()  { document.getElementById('fiche-modal').classList.remove('open'); }
function closeEditScoresModal() { document.getElementById('edit-scores-modal').classList.remove('open'); }

function toast(msg) {
  const el=document.getElementById('toast');
  el.textContent=msg; el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'),3000);
}
function showAlert(id,msg,type) {
  const el=document.getElementById(id);
  el.textContent=msg;
  el.className='alert '+(type==='ok'?'alert-ok':'alert-err')+' show';
  setTimeout(()=>el.classList.remove('show'),5000);
}
function esc(str) {
  const el=document.createElement('div');
  el.appendChild(document.createTextNode(str||''));
  return el.innerHTML;
}
function tname(id,teams) {
  if (!id) return null;
  const t=teams.find(t=>String(t.id)===String(id));
  return t?t.nom:null;
}

// no-ops (Firestore handles refresh via onSnapshot)
function refreshData() {}
function doRefresh(btn) { btn.classList.add('spinning'); setTimeout(()=>btn.classList.remove('spinning'),800); }

function applyData(d) {
  if (!d) return;
  currentData = d;
  inscriptionsOuvertes = d.inscriptionsOuvertes !== false;
  updateInscriptionsBtn(inscriptionsOuvertes);
  updateAdminBadge(d.pending ? d.pending.length : 0);
  updatePrixDisplay(d.prixParPersonne || 10);
  updateDemarrerBtn(d.tournoiDemarre || false);
  maintenanceMode = d.maintenanceMode || false;
  updateMaintenanceBtn(maintenanceMode);
  const badge = document.getElementById('team-count-badge');
  if (badge) badge.textContent = (d.teams||[]).length + ' équipe' + ((d.teams||[]).length!==1?'s':'');
  renderPublic(d);
  renderPronostics(d);
  if (adminOpen) renderAdmin(d);
}

function updateAdminBadge(n) {
  const btn = Array.from(document.querySelectorAll('.tab-btn')).find(b=>b.textContent.includes('Admin'));
  if (!btn) return;
  btn.textContent = n>0 ? '⚙️ Admin ('+n+')' : '⚙️ Admin';
}
function updateDemarrerBtn(tournoiDemarre) {
  const card = document.getElementById('demarrer-card');
  if (card) card.style.display = (tournoiDemarre||scoreModeOnly) ? 'none' : 'block';
}
function updatePrixDisplay(prix) {
  const total = prix * 2;
  const e1=document.getElementById('modal-prix-equipe'), e2=document.getElementById('modal-prix-detail');
  const e3=document.getElementById('banner-prix'), inp=document.getElementById('input-prix');
  if (e1) e1.textContent = total + ' € par equipe';
  if (e2) e2.textContent = '2 joueurs x '+prix+' € — a regler a l\'organisateur';
  if (e3) e3.textContent = 'Tournoi ouvert a tous — '+total+' € par equipe (2 joueurs)';
  if (inp && inp!==document.activeElement) inp.value = prix;
}
function updateInscriptionsBtn(ouvert) {
  const btn=document.getElementById('btn-toggle-inscriptions');
  const lbl=document.getElementById('inscriptions-status-label');
  const sub=document.getElementById('inscriptions-status-sub');
  if (!btn) return;
  if (ouvert) {
    btn.textContent='✅ Ouvertes'; btn.className='toggle-switch-btn ouvert';
    if(lbl) lbl.textContent='Inscriptions ouvertes';
    if(sub) sub.textContent="Les joueurs peuvent s'inscrire depuis la page publique";
  } else {
    btn.textContent='🔒 Fermees'; btn.className='toggle-switch-btn ferme';
    if(lbl) lbl.textContent='Inscriptions fermees';
    if(sub) sub.textContent='Les joueurs voient un message de cloture';
  }
}
function updateMaintenanceBtn(actif) {
  const btn=document.getElementById('btn-toggle-maintenance');
  const lbl=document.getElementById('maintenance-label');
  const sub=document.getElementById('maintenance-sub');
  if (!btn) return;
  if (actif) {
    btn.textContent='🔧 Activé'; btn.style.background='var(--terra)'; btn.style.color='white'; btn.style.border='none';
    if(lbl) lbl.textContent='🔧 Mode maintenance ACTIVÉ';
    if(sub) sub.textContent='La page publique affiche "Maintenance en cours"';
  } else {
    btn.textContent='🔧 Désactivé'; btn.style.background=''; btn.style.color=''; btn.style.border='';
    if(lbl) lbl.textContent='🔧 Mode maintenance';
    if(sub) sub.textContent='La page publique est visible normalement';
  }
}

// ═══════════════════════════════════════════════════════
// FIRESTORE WRITE HELPERS
// ═══════════════════════════════════════════════════════
async function fbConfig(updates) {
  await db.collection('config').doc('main').set(updates, { merge:true });
}

function computePoolSizes(n) {
  const r=n%4, full=Math.floor(n/4);
  if (r===0)   return Array(full).fill(4);
  if (r>=3)    return [...Array(full).fill(4), r];
  if (r===1)   return full ? [...Array(full-1).fill(4), 5] : [1];
  if (n===2)   return [2];
  if (full<2)  return [3,3];
  return [...Array(full-2).fill(4), 5, 5];
}

async function fbGeneratePoolMatchs(pool, poolTeams) {
  const batch = db.batch();
  for (let i=0; i<poolTeams.length; i++) {
    for (let j=i+1; j<poolTeams.length; j++) {
      batch.set(db.collection('matchs').doc(), {
        poule:pool, eq1:poolTeams[i].id, eq2:poolTeams[j].id, score1:0, score2:0, joue:false
      });
    }
  }
  await batch.commit();
}

async function fbTryGenerateBracket() {
  if (liveData.tableau.length > 0) return;
  const teams = liveData.equipes.filter(t => t.statut!=='pending');
  const pools = [...new Set(teams.map(t=>t.poule).filter(p=>p&&p!==''))].sort();
  if (!pools.length) return;
  for (const pool of pools) {
    const pm = liveData.matchs.filter(m=>m.poule===pool);
    if (!pm.length || !pm.every(m=>m.joue)) return;
  }
  const firstsRaw=[], secondsRaw=[];
  pools.forEach(pool => {
    const st = computeStandings(pool);
    if (st.length >= 2) { firstsRaw.push(st[0]); secondsRaw.push(st[1]); }
  });
  const sortByPerf = (a,b) => b.pts-a.pts || (b.pf-b.pc)-(a.pf-a.pc) || b.pf-a.pf;
  firstsRaw.sort(sortByPerf);
  secondsRaw.sort(sortByPerf);
  const firsts  = firstsRaw.map(s => s.team.id);
  const seconds = secondsRaw.map(s => s.team.id);
  await fbGenerateBracket(firsts, seconds, pools);
}

async function fbGenerateBracket(firsts, seconds, pools) {
  const n = firsts.length;
  const tb = () => db.collection('tableau').doc();
  const batch = db.batch();
  if (n===1) {
    batch.set(tb(),{tour:'Finale',slot:1,eq1:firsts[0],eq2:seconds[0],score1:0,score2:0,joue:false,gagnant:''});
  } else if (n===2) {
    batch.set(tb(),{tour:'Demi-finale',slot:1,eq1:firsts[0],eq2:seconds[1],score1:0,score2:0,joue:false,gagnant:''});
    batch.set(tb(),{tour:'Demi-finale',slot:2,eq1:firsts[1],eq2:seconds[0],score1:0,score2:0,joue:false,gagnant:''});
    batch.set(tb(),{tour:'Petite finale',slot:1,eq1:'',eq2:'',score1:0,score2:0,joue:false,gagnant:''});
    batch.set(tb(),{tour:'Finale',slot:1,eq1:'',eq2:'',score1:0,score2:0,joue:false,gagnant:''});
  } else if (n===5) {
    // Seeds 1-6 directement en QF ; seeds 7-10 (4 derniers runners-up) jouent les barrages
    // Barrage 1 : seed 8 (seconds[2]) vs seed 9 (seconds[3]) → gagnant → QF1.eq2
    // Barrage 2 : seed 7 (seconds[1]) vs seed 10 (seconds[4]) → gagnant → QF4.eq2
    batch.set(tb(),{tour:'Barrage',slot:1,eq1:seconds[2],eq2:seconds[3],score1:0,score2:0,joue:false,gagnant:''});
    batch.set(tb(),{tour:'Barrage',slot:2,eq1:seconds[1],eq2:seconds[4],score1:0,score2:0,joue:false,gagnant:''});
    // QF : 1vs(bar1), 4vs5, 3vs6, 2vs(bar2)
    batch.set(tb(),{tour:'Quart de finale',slot:1,eq1:firsts[0],eq2:'',score1:0,score2:0,joue:false,gagnant:''});
    batch.set(tb(),{tour:'Quart de finale',slot:2,eq1:firsts[3],eq2:firsts[4],score1:0,score2:0,joue:false,gagnant:''});
    batch.set(tb(),{tour:'Quart de finale',slot:3,eq1:firsts[2],eq2:seconds[0],score1:0,score2:0,joue:false,gagnant:''});
    batch.set(tb(),{tour:'Quart de finale',slot:4,eq1:firsts[1],eq2:'',score1:0,score2:0,joue:false,gagnant:''});
    batch.set(tb(),{tour:'Demi-finale',slot:1,eq1:'',eq2:'',score1:0,score2:0,joue:false,gagnant:''});
    batch.set(tb(),{tour:'Demi-finale',slot:2,eq1:'',eq2:'',score1:0,score2:0,joue:false,gagnant:''});
    batch.set(tb(),{tour:'Petite finale',slot:1,eq1:'',eq2:'',score1:0,score2:0,joue:false,gagnant:''});
    batch.set(tb(),{tour:'Finale',slot:1,eq1:'',eq2:'',score1:0,score2:0,joue:false,gagnant:''});
  } else {
    const nQF = Math.min(n,4);
    for (let i=0;i<nQF;i++) {
      batch.set(tb(),{tour:'Quart de finale',slot:i+1,eq1:firsts[i]||'',eq2:seconds[nQF-1-i]||'',score1:0,score2:0,joue:false,gagnant:''});
    }
    batch.set(tb(),{tour:'Demi-finale',slot:1,eq1:'',eq2:'',score1:0,score2:0,joue:false,gagnant:''});
    batch.set(tb(),{tour:'Demi-finale',slot:2,eq1:'',eq2:'',score1:0,score2:0,joue:false,gagnant:''});
    batch.set(tb(),{tour:'Petite finale',slot:1,eq1:'',eq2:'',score1:0,score2:0,joue:false,gagnant:''});
    batch.set(tb(),{tour:'Finale',slot:1,eq1:'',eq2:'',score1:0,score2:0,joue:false,gagnant:''});
  }
  await batch.commit();
  // Consolation — triés par performance (meilleurs d'abord)
  const losersRaw = [];
  pools.forEach(pool => {
    const st = computeStandings(pool);
    for (let i=2;i<st.length;i++) losersRaw.push(st[i]);
  });
  const sortByPerf2 = (a,b) => b.pts-a.pts || (b.pf-b.pc)-(a.pf-a.pc) || b.pf-a.pf;
  losersRaw.sort(sortByPerf2);
  const losers = losersRaw.map(s => s.team.id);
  if (losers.length >= 2) await fbGenerateConsolation(losers);
}

async function fbGenerateConsolation(losers) {
  const nl = losers.length;
  const cb = () => db.collection('consolation').doc();
  const batch = db.batch();
  if (nl===2) {
    batch.set(cb(),{tour:'Finale Conso',slot:1,eq1:losers[0],eq2:losers[1],score1:0,score2:0,joue:false,gagnant:''});
  } else if (nl<=4) {
    batch.set(cb(),{tour:'Demi Conso',slot:1,eq1:losers[0],eq2:losers[nl-1],score1:0,score2:0,joue:false,gagnant:''});
    batch.set(cb(),{tour:'Demi Conso',slot:2,eq1:losers[1],eq2:losers[nl-2]||'',score1:0,score2:0,joue:false,gagnant:''});
    batch.set(cb(),{tour:'Finale Conso',slot:1,eq1:'',eq2:'',score1:0,score2:0,joue:false,gagnant:''});
  } else if (nl===10) {
    // Seeds 1-6 directement en Quart Conso ; seeds 7-10 jouent les barrages conso
    // Barrage Conso 1 : seed 8 (losers[7]) vs seed 9 (losers[8]) → gagnant → QC1.eq2
    // Barrage Conso 2 : seed 7 (losers[6]) vs seed 10 (losers[9]) → gagnant → QC4.eq2
    batch.set(cb(),{tour:'Barrage Conso',slot:1,eq1:losers[7],eq2:losers[8],score1:0,score2:0,joue:false,gagnant:''});
    batch.set(cb(),{tour:'Barrage Conso',slot:2,eq1:losers[6],eq2:losers[9],score1:0,score2:0,joue:false,gagnant:''});
    // QC : 1vs(bar1), 4vs5, 3vs6, 2vs(bar2)
    batch.set(cb(),{tour:'Quart Conso',slot:1,eq1:losers[0],eq2:'',score1:0,score2:0,joue:false,gagnant:''});
    batch.set(cb(),{tour:'Quart Conso',slot:2,eq1:losers[3],eq2:losers[4],score1:0,score2:0,joue:false,gagnant:''});
    batch.set(cb(),{tour:'Quart Conso',slot:3,eq1:losers[2],eq2:losers[5],score1:0,score2:0,joue:false,gagnant:''});
    batch.set(cb(),{tour:'Quart Conso',slot:4,eq1:losers[1],eq2:'',score1:0,score2:0,joue:false,gagnant:''});
    batch.set(cb(),{tour:'Demi Conso',slot:1,eq1:'',eq2:'',score1:0,score2:0,joue:false,gagnant:''});
    batch.set(cb(),{tour:'Demi Conso',slot:2,eq1:'',eq2:'',score1:0,score2:0,joue:false,gagnant:''});
    batch.set(cb(),{tour:'Finale Conso',slot:1,eq1:'',eq2:'',score1:0,score2:0,joue:false,gagnant:''});
  } else {
    const nQF = Math.min(Math.floor(nl/2),4);
    for (let i=0;i<nQF;i++) {
      batch.set(cb(),{tour:'Quart Conso',slot:i+1,eq1:losers[i]||'',eq2:losers[nl-1-i]||'',score1:0,score2:0,joue:false,gagnant:''});
    }
    batch.set(cb(),{tour:'Demi Conso',slot:1,eq1:'',eq2:'',score1:0,score2:0,joue:false,gagnant:''});
    batch.set(cb(),{tour:'Demi Conso',slot:2,eq1:'',eq2:'',score1:0,score2:0,joue:false,gagnant:''});
    batch.set(cb(),{tour:'Finale Conso',slot:1,eq1:'',eq2:'',score1:0,score2:0,joue:false,gagnant:''});
  }
  await batch.commit();
}

async function fbAdvanceWinner(colName, tour, slot, winnerId, loserId) {
  const docs = colName==='tableau' ? liveData.tableau : liveData.consolation;
  const place = async (targetTour, targetSlot, useEq1, teamId) => {
    if (!teamId) return;
    const doc = docs.find(d => d.tour===targetTour && d.slot===targetSlot);
    if (doc) await db.collection(colName).doc(doc.id).update(useEq1 ? {eq1:teamId} : {eq2:teamId});
  };
  if (colName==='tableau') {
    if (tour==='Barrage')       await place('Quart de finale', slot===1?1:4, false, winnerId);
    else if (tour==='Quart de finale') await place('Demi-finale', slot<=2?1:2, slot%2===1, winnerId);
    else if (tour==='Demi-finale') {
      await place('Finale', 1, slot===1, winnerId);
      if (loserId) await place('Petite finale', 1, slot===1, loserId);
    }
  } else {
    if (tour==='Barrage Conso') await place('Quart Conso', slot===1?1:4, false, winnerId);
    else if (tour==='Quart Conso')  await place('Demi Conso',   slot<=2?1:2, slot%2===1, winnerId);
    else if (tour==='Demi Conso') await place('Finale Conso', 1, slot===1, winnerId);
  }
}

// ═══════════════════════════════════════════════════════
// ACTIONS — INSCRIPTIONS
// ═══════════════════════════════════════════════════════
function validatePetanqueScore(s1,s2) {
  s1=Number(s1); s2=Number(s2);
  if (s1<0||s2<0)     return { err:'Les scores ne peuvent pas etre negatifs.' };
  if (s1===0&&s2===0) return { err:'Le score 0-0 est invalide.' };
  if (s1===s2)         return { err:"Pas d'egalite en petanque !" };
  if (s1>13||s2>13)   return { err:'Score maximum en petanque : 13 points.' };
  if (Math.max(s1,s2)<13) return { warn:'Le vainqueur n\'a que '+Math.max(s1,s2)+' points. Confirmer ?' };
  return { ok:true };
}

function submitRegister() {
  const nom=document.getElementById('reg-team').value.trim();
  const p1=document.getElementById('reg-p1').value.trim();
  const p2=document.getElementById('reg-p2').value.trim();
  if (!nom||!p1||!p2) { showAlert('reg-alert','Veuillez remplir tous les champs','err'); return; }
  const btn=document.getElementById('btn-reg-submit');
  btn.disabled=true; btn.textContent='Envoi en cours...';
  (async () => {
    try {
      if (liveData.equipes.find(t => t.nom.toLowerCase()===nom.toLowerCase())) {
        throw new Error("Ce nom d'equipe est deja pris");
      }
      await db.collection('equipes').add({
        nom, j1:p1, j2:p2, poule:'', statut:'pending',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      closeRegisterModal();
      const prixTotal = ((currentData?.prixParPersonne||10)*2) + ' €';
      toast("✅ Inscription envoyee ! Reglez "+prixTotal+" a l'organisateur pour confirmer.");
    } catch(e) {
      showAlert('reg-alert','❌ '+e.message,'err');
    } finally {
      btn.disabled=false; btn.textContent='Envoyer mon inscription';
    }
  })();
}

function doValidate(id, selectId) {
  const pool = selectId ? (document.getElementById(selectId)?.value||'') : '';
  const tournoiDemarre = liveData.config.tournoiDemarre || false;
  const msg = pool ? '✅ Équipe validée → Poule '+pool : "✅ Équipe validée — poule attribuée au démarrage";
  (async () => {
    try {
      if (tournoiDemarre && pool) {
        await db.collection('equipes').doc(id).update({ statut:'active', poule:pool });
        const existing = liveData.equipes.filter(t => t.poule===pool && t.statut!=='pending' && t.id!==id);
        if (existing.length) {
          const batch = db.batch();
          existing.forEach(t => {
            batch.set(db.collection('matchs').doc(), { poule:pool, eq1:id, eq2:t.id, score1:0, score2:0, joue:false });
          });
          await batch.commit();
        }
      } else {
        await db.collection('equipes').doc(id).update({ statut:'active' });
      }
      toast(msg);
    } catch(e) { alert('Erreur : '+e.message); }
  })();
}

function doDeletePending(id) {
  if (!confirm('Supprimer cette inscription ?')) return;
  db.collection('equipes').doc(id).delete()
    .then(() => toast('🗑 Inscription supprimee'))
    .catch(e => alert('Erreur : '+e.message));
}

function submitTeam() {
  const nom=document.getElementById('f-team').value.trim();
  const p1=document.getElementById('f-p1').value.trim();
  const p2=document.getElementById('f-p2').value.trim();
  if (!nom||!p1||!p2) { showAlert('team-alert','Veuillez remplir tous les champs','err'); return; }
  const btn=document.getElementById('btn-add-team');
  btn.disabled=true; btn.textContent='Inscription...';
  (async () => {
    try {
      if (liveData.equipes.find(t => t.nom.toLowerCase()===nom.toLowerCase())) {
        throw new Error("Ce nom d'equipe est deja pris");
      }
      await db.collection('equipes').add({
        nom, j1:p1, j2:p2, poule:'', statut:'active',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      ['f-team','f-p1','f-p2'].forEach(id => document.getElementById(id).value='');
      showAlert('team-alert','✅ Equipe inscrite','ok');
    } catch(e) {
      showAlert('team-alert','❌ '+e.message,'err');
    } finally {
      btn.disabled=false; btn.textContent='Inscrire et valider directement';
    }
  })();
}

function submitEdit() {
  const id=document.getElementById('edit-team-id').value;
  const nom=document.getElementById('edit-nom').value.trim();
  const j1=document.getElementById('edit-j1').value.trim();
  const j2=document.getElementById('edit-j2').value.trim();
  if (!nom||!j1||!j2) { showAlert('edit-alert','Veuillez remplir tous les champs','err'); return; }
  if (liveData.equipes.find(t => String(t.id)!==String(id) && t.nom.toLowerCase()===nom.toLowerCase())) {
    showAlert('edit-alert','❌ Nom deja pris','err'); return;
  }
  db.collection('equipes').doc(id).update({ nom, j1, j2 })
    .then(() => { closeEditModal(); toast('✅ Equipe modifiee'); })
    .catch(e => showAlert('edit-alert','❌ '+e.message,'err'));
}

// ═══════════════════════════════════════════════════════
// ACTIONS — SCORES
// ═══════════════════════════════════════════════════════
function submitScore(id) {
  const s1=document.getElementById('ps1_'+id).value;
  const s2=document.getElementById('ps2_'+id).value;
  const v=validatePetanqueScore(s1,s2);
  if (v.err) { alert('❌ '+v.err); return; }
  if (v.warn && !confirm('⚠️ '+v.warn)) return;
  optimisticUpdatePoolScore(id, Number(s1), Number(s2));
  db.collection('matchs').doc(id).update({ score1:Number(s1), score2:Number(s2), joue:true })
    .then(() => fbTryGenerateBracket())
    .catch(e => alert('Erreur : '+e.message));
}

function submitFinalScore(id) {
  const s1=document.getElementById('fs1_'+id).value;
  const s2=document.getElementById('fs2_'+id).value;
  const v=validatePetanqueScore(s1,s2);
  if (v.err) { alert('❌ '+v.err); return; }
  if (v.warn && !confirm('⚠️ '+v.warn)) return;
  optimisticUpdateFinalScore(id, Number(s1), Number(s2));
  const n1=Number(s1), n2=Number(s2);
  const match = liveData.tableau.find(m => m.id===id);
  const gagnant = n1>n2 ? match?.eq1 : match?.eq2;
  const perdant  = n1>n2 ? match?.eq2 : match?.eq1;
  db.collection('tableau').doc(id).update({ score1:n1, score2:n2, joue:true, gagnant:gagnant||'' })
    .then(() => { if (match) fbAdvanceWinner('tableau', match.tour, match.slot, gagnant, perdant); })
    .catch(e => alert('Erreur : '+e.message));
}

function submitConsolationScore(id) {
  const s1=document.getElementById('cs1_'+id).value;
  const s2=document.getElementById('cs2_'+id).value;
  const v=validatePetanqueScore(s1,s2);
  if (v.err) { alert('❌ '+v.err); return; }
  if (v.warn && !confirm('⚠️ '+v.warn)) return;
  optimisticUpdateConsolationScore(id, Number(s1), Number(s2));
  const n1=Number(s1), n2=Number(s2);
  const match = liveData.consolation.find(m => m.id===id);
  const gagnant = n1>n2 ? match?.eq1 : match?.eq2;
  db.collection('consolation').doc(id).update({ score1:n1, score2:n2, joue:true, gagnant:gagnant||'' })
    .then(() => { if (match) fbAdvanceWinner('consolation', match.tour, match.slot, gagnant, null); })
    .catch(e => alert('Erreur : '+e.message));
}

let originalScores = {};
function openEditScoresModal() {
  if (!currentData) return;
  const { teams, pools, tableau, consolation } = currentData;
  originalScores = {};
  const playedPool  = pools.flatMap(p => p.matchs.filter(m => m.joue).map(m => ({...m, poolLabel:p.pool})));
  const playedFinal = (tableau||[]).filter(m => m.joue);
  const playedConso = (consolation||[]).filter(m => m.joue);
  if (!playedPool.length && !playedFinal.length && !playedConso.length) {
    document.getElementById('edit-scores-content').innerHTML =
      '<div class="empty-state"><div class="es-icon">📋</div>Aucun match joue pour le moment</div>';
    document.getElementById('edit-scores-modal').classList.add('open');
    return;
  }
  let html = '';
  // Consolation
  const CONSO_ORDER=['Barrage Conso','Quart Conso','Demi Conso','Finale Conso'];
  const CLABELS={'Barrage Conso':'Barrages Conso','Quart Conso':'Quarts Conso','Demi Conso':'Demi Conso','Finale Conso':'Finale Conso'};
  if (playedConso.length) {
    const byC = {};
    playedConso.forEach(m => { if(!byC[m.tour]) byC[m.tour]=[]; byC[m.tour].push(m); });
    CONSO_ORDER.filter(t=>byC[t]).forEach(tour => {
      html += `<div class="edit-tour-label">🥉 ${CLABELS[tour]}</div>`;
      byC[tour].forEach(m => {
        const key='consolation_'+m.id; originalScores[key]={s1:Number(m.score1),s2:Number(m.score2)};
        const t1=tname(m.eq1,teams)||'?', t2=tname(m.eq2,teams)||'?';
        html += `<div class="edit-score-row" id="row_${key}">
          <span class="edit-score-teams">${esc(t1)} — ${esc(t2)}</span>
          <div class="edit-score-inputs">
            <input type="number" min="0" max="13" value="${m.score1}" id="es1_${key}" oninput="markModified('${key}')">
            <span class="colon">:</span>
            <input type="number" min="0" max="13" value="${m.score2}" id="es2_${key}" oninput="markModified('${key}')">
          </div></div>`;
      });
    });
  }
  // Tableau final
  const FINAL_ORDER=['Barrage','Quart de finale','Demi-finale','Petite finale','Finale'];
  if (playedFinal.length) {
    const byF = {};
    playedFinal.forEach(m => { if(!byF[m.tour]) byF[m.tour]=[]; byF[m.tour].push(m); });
    FINAL_ORDER.filter(t=>byF[t]).forEach(tour => {
      html += `<div class="edit-tour-label">🏆 ${tour}</div>`;
      byF[tour].forEach(m => {
        const key='final_'+m.id; originalScores[key]={s1:Number(m.score1),s2:Number(m.score2)};
        const t1=tname(m.eq1,teams)||'?', t2=tname(m.eq2,teams)||'?';
        html += `<div class="edit-score-row" id="row_${key}">
          <span class="edit-score-teams">${esc(t1)} — ${esc(t2)}</span>
          <div class="edit-score-inputs">
            <input type="number" min="0" max="13" value="${m.score1}" id="es1_${key}" oninput="markModified('${key}')">
            <span class="colon">:</span>
            <input type="number" min="0" max="13" value="${m.score2}" id="es2_${key}" oninput="markModified('${key}')">
          </div></div>`;
      });
    });
  }
  // Poules
  const byPool = {};
  playedPool.forEach(m => { if(!byPool[m.poolLabel]) byPool[m.poolLabel]=[]; byPool[m.poolLabel].push(m); });
  Object.keys(byPool).sort().forEach(pool => {
    html += `<div class="edit-tour-label">
      <span class="pool-chip" style="background:${pcolor(pool)};width:20px;height:20px;font-size:0.65rem;">${pool}</span> Poule ${pool}
    </div>`;
    byPool[pool].forEach(m => {
      const key='pool_'+m.id; originalScores[key]={s1:Number(m.score1),s2:Number(m.score2)};
      const t1=tname(m.eq1,teams)||'?', t2=tname(m.eq2,teams)||'?';
      html += `<div class="edit-score-row" id="row_${key}">
        <span class="edit-score-teams">${esc(t1)} — ${esc(t2)}</span>
        <div class="edit-score-inputs">
          <input type="number" min="0" max="13" value="${m.score1}" id="es1_${key}" oninput="markModified('${key}')">
          <span class="colon">:</span>
          <input type="number" min="0" max="13" value="${m.score2}" id="es2_${key}" oninput="markModified('${key}')">
        </div></div>`;
    });
  });
  document.getElementById('edit-scores-content').innerHTML = html;
  document.getElementById('edit-scores-modal').classList.add('open');
}

function markModified(key) {
  const s1=Number(document.getElementById('es1_'+key)?.value);
  const s2=Number(document.getElementById('es2_'+key)?.value);
  const orig=originalScores[key];
  const changed = !orig || s1!==orig.s1 || s2!==orig.s2;
  const row=document.getElementById('row_'+key);
  if (row) row.classList.toggle('modified', changed);
}

function submitEditedScores() {
  const changes = [];
  for (const key of Object.keys(originalScores)) {
    const s1=Number(document.getElementById('es1_'+key)?.value);
    const s2=Number(document.getElementById('es2_'+key)?.value);
    const orig=originalScores[key];
    if (s1===orig.s1 && s2===orig.s2) continue;
    const v=validatePetanqueScore(s1,s2);
    if (v.err) { alert('❌ '+v.err+' (match '+key+')'); return; }
    const parts=key.split('_');
    changes.push({ type:parts[0], id:parts[1], s1, s2 });
  }
  if (!changes.length) { toast('Aucune modification détectée'); closeEditScoresModal(); return; }
  const btn=document.getElementById('btn-save-edits');
  btn.disabled=true; btn.textContent='Enregistrement...';
  (async () => {
    try {
      const batch = db.batch();
      for (const ch of changes) {
        const colName = ch.type==='pool' ? 'matchs' : ch.type==='final' ? 'tableau' : 'consolation';
        const ref = db.collection(colName).doc(ch.id);
        const n1=Number(ch.s1), n2=Number(ch.s2);
        const docs = colName==='matchs' ? liveData.matchs : colName==='tableau' ? liveData.tableau : liveData.consolation;
        const match = docs.find(m => m.id===ch.id);
        const updates = { score1:n1, score2:n2, joue:true };
        if (colName!=='matchs') updates.gagnant = (n1>n2 ? match?.eq1 : match?.eq2) || '';
        batch.update(ref, updates);
      }
      await batch.commit();
      await fbTryGenerateBracket();
      closeEditScoresModal();
      toast('✅ '+changes.length+' score(s) mis à jour');
    } catch(e) {
      alert('Erreur : '+e.message);
    } finally {
      btn.disabled=false; btn.textContent='Enregistrer les modifications';
    }
  })();
}

// ═══════════════════════════════════════════════════════
// ACTIONS — CONFIG ADMIN
// ═══════════════════════════════════════════════════════
function doToggleInscriptions() {
  if (!confirm(inscriptionsOuvertes ? 'Fermer les inscriptions ?' : 'Ouvrir les inscriptions ?')) return;
  fbConfig({ inscriptionsOuvertes: !inscriptionsOuvertes }).catch(e => alert('Erreur : '+e.message));
}
function doSetPrix() {
  const val = parseFloat(document.getElementById('input-prix').value);
  if (isNaN(val)||val<0) { alert('Prix invalide'); return; }
  fbConfig({ prixParPersonne:val }).then(() => {
    const saved = document.getElementById('prix-saved');
    if (saved) { saved.style.display='inline'; setTimeout(()=>saved.style.display='none', 2500); }
  }).catch(e => alert('Erreur : '+e.message));
}
function doToggleMaintenance() {
  if (!confirm(maintenanceMode ? 'Désactiver la maintenance ?' : "Activer la maintenance ? La page publique sera inaccessible.")) return;
  fbConfig({ maintenanceMode: !maintenanceMode }).catch(e => alert('Erreur : '+e.message));
}

// ═══════════════════════════════════════════════════════
// ACTIONS — DÉMARRAGE TOURNOI
// ═══════════════════════════════════════════════════════
// État temporaire du tirage (côté client uniquement)
let _tiragePoolGroups = {}; // { A: [{id, nom, ...}], B: [...] }

function _computeTirage() {
  const teams = liveData.equipes.filter(t => t.statut!=='pending');
  const shuffled = [...teams];
  for (let i=shuffled.length-1; i>0; i--) {
    const j=Math.floor(Math.random()*(i+1));
    [shuffled[i],shuffled[j]] = [shuffled[j],shuffled[i]];
  }
  const sizes = computePoolSizes(shuffled.length);
  const groups = {};
  let idx=0;
  sizes.forEach((size,pi) => {
    if (pi>=8) return;
    const pool = POOL_LETTERS[pi];
    groups[pool] = [];
    for (let k=0; k<size && idx<shuffled.length; k++,idx++) {
      groups[pool].push(shuffled[idx]);
    }
  });
  return groups;
}

function doDemarrerTournoi() {
  const nb = (currentData?.validatedTeams||[]).length;
  if (nb<2) { alert('Il faut au moins 2 équipes validées pour démarrer.'); return; }
  _tiragePoolGroups = _computeTirage();
  renderTirageModal();
  document.getElementById('tirage-modal').classList.add('open');
}

function reshuffleTirage() {
  _tiragePoolGroups = _computeTirage();
  renderTirageModal();
}

function closeTirageModal() {
  document.getElementById('tirage-modal').classList.remove('open');
}

function renderTirageModal() {
  const grid = document.getElementById('tirage-pools-grid');
  const info = document.getElementById('tirage-info');
  if (!grid) return;
  const pools = Object.keys(_tiragePoolGroups).sort();
  const totalTeams = pools.reduce((s,p) => s+_tiragePoolGroups[p].length, 0);
  info.textContent = totalTeams + ' équipes — ' + pools.length + ' poule(s)';

  let html = '';
  pools.forEach(pool => {
    const teams = _tiragePoolGroups[pool];
    const otherPools = pools.filter(p => p !== pool);
    html += `<div class="tirage-pool">
      <div class="tirage-pool-label">
        <span style="width:18px;height:18px;border-radius:5px;background:${pcolor(pool)};display:inline-block;flex-shrink:0;"></span>
        Poule ${pool} <span style="font-weight:400;color:var(--muted);font-size:0.72rem;">(${teams.length})</span>
      </div>`;
    teams.forEach(t => {
      const moveOpts = otherPools.map(p =>
        `<option value="${p}">→ ${p}</option>`
      ).join('');
      html += `<div class="tirage-team-item">
        <div class="tirage-team-info">
          <div class="tirage-team-nom" title="${esc(t.nom)}">${esc(t.nom)}</div>
          <div class="tirage-team-joueurs">👤 ${esc(t.j1||'')} &nbsp;·&nbsp; 👤 ${esc(t.j2||'')}</div>
        </div>
        <select class="tirage-team-move" onchange="moveTeamInTirage('${t.id}','${pool}',this.value);this.value='';"
          title="Déplacer vers une autre poule">
          <option value="" disabled selected>↕</option>
          ${moveOpts}
        </select>
      </div>`;
    });
    html += '</div>';
  });
  grid.innerHTML = html;
}

function moveTeamInTirage(teamId, fromPool, toPool) {
  if (!toPool || toPool===fromPool) return;
  const team = _tiragePoolGroups[fromPool]?.find(t => t.id===teamId);
  if (!team) return;
  _tiragePoolGroups[fromPool] = _tiragePoolGroups[fromPool].filter(t => t.id!==teamId);
  if (!_tiragePoolGroups[toPool]) _tiragePoolGroups[toPool] = [];
  _tiragePoolGroups[toPool].push(team);
  // Supprimer les poules vides
  Object.keys(_tiragePoolGroups).forEach(p => {
    if (_tiragePoolGroups[p].length === 0) delete _tiragePoolGroups[p];
  });
  // Réattribuer les lettres dans l'ordre
  const sorted = Object.values(_tiragePoolGroups).sort((a,b) => {
    const firstA = Object.keys(_tiragePoolGroups).find(k => _tiragePoolGroups[k]===a);
    const firstB = Object.keys(_tiragePoolGroups).find(k => _tiragePoolGroups[k]===b);
    return firstA < firstB ? -1 : 1;
  });
  _tiragePoolGroups = {};
  sorted.forEach((teams, i) => { _tiragePoolGroups[POOL_LETTERS[i]] = teams; });
  renderTirageModal();
}

async function confirmerTirage() {
  const btn = document.getElementById('btn-confirmer-tirage');
  btn.disabled=true; btn.textContent='⏳ Démarrage en cours...';
  try {
    const pools = Object.keys(_tiragePoolGroups);

    // Supprimer tous les matchs existants pour éviter les doublons en cas de relance
    const existingMatchs = await db.collection('matchs').get();
    if (existingMatchs.docs.length > 0) {
      const delBatch = db.batch();
      existingMatchs.docs.forEach(d => delBatch.delete(d.ref));
      await delBatch.commit();
    }

    const batch = db.batch();
    pools.forEach(pool => {
      _tiragePoolGroups[pool].forEach(team => {
        batch.update(db.collection('equipes').doc(team.id), { poule:pool });
      });
    });
    await batch.commit();
    for (const pool of pools) {
      await fbGeneratePoolMatchs(pool, _tiragePoolGroups[pool]);
    }
    await fbConfig({ tournoiDemarre:true });
    closeTirageModal();
    const total = pools.reduce((s,p) => s+_tiragePoolGroups[p].length, 0);
    toast('🚀 Tournoi démarré ! '+total+' équipes en '+pools.length+' poule(s)');
  } catch(e) {
    btn.disabled=false; btn.textContent='✅ Confirmer et démarrer';
    alert('Erreur : '+e.message);
  }
}

function doForceStart(pool) {
  if (!confirm('Demarrer la Poule '+pool+' avec les équipes actuelles ?\n\nAttention : aucune equipe ne pourra rejoindre ensuite.')) return;
  const poolTeams = liveData.equipes.filter(t => t.poule===pool && t.statut!=='pending');
  if (poolTeams.length<2) { alert('Il faut au moins 2 équipes.'); return; }
  fbGeneratePoolMatchs(pool, poolTeams)
    .then(() => toast('▶ Poule '+pool+' démarrée ('+poolTeams.length+' équipes, '+(poolTeams.length*(poolTeams.length-1)/2)+' matchs)'))
    .catch(e => alert('Erreur : '+e.message));
}

function confirmReset() {
  if (!confirm('Réinitialiser complètement le tournoi ? Action irréversible.')) return;
  (async () => {
    try {
      for (const col of ['equipes','matchs','tableau','consolation','pronostics','votes']) {
        const snap = await db.collection(col).get();
        if (!snap.docs.length) continue;
        const batch = db.batch();
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
      await db.collection('config').doc('pronoScores').delete().catch(()=>{});
      await fbConfig({ inscriptionsOuvertes:true, prixParPersonne:10, tournoiDemarre:false, maintenanceMode:false });
      showAlert('reset-alert','✅ Tournoi réinitialisé','ok');
    } catch(e) { showAlert('reset-alert','❌ '+e.message,'err'); }
  })();
}

// ═══════════════════════════════════════════════════════
// ACTIONS — PRONOSTICS
// ═══════════════════════════════════════════════════════
function doCreatePronostic() {
  const question = document.getElementById('prono-question').value.trim();
  const choixRaw = document.getElementById('prono-choix').value.trim();
  const points   = parseInt(document.getElementById('prono-points').value) || 1;
  if (!question) { showAlert('prono-create-alert','Question requise','err'); return; }
  const choix = choixRaw.split('\n').map(l=>l.trim()).filter(Boolean);
  if (choix.length<2) { showAlert('prono-create-alert','Minimum 2 choix','err'); return; }
  const tmpId = 'tmp_'+Date.now();
  if (currentData) {
    if (!currentData.pronostics) currentData.pronostics=[];
    currentData.pronostics.unshift({ id:tmpId, question, choix, statut:'inactif', bonneReponse:'', points, totalVotes:0, counts:{}, votedEquipes:[] });
    renderAdminPronostics(currentData.pronostics, currentData.teams);
    renderPronostics(currentData);
  }
  document.getElementById('prono-question').value='';
  document.getElementById('prono-choix').value='';
  showAlert('prono-create-alert','⏳ Création en cours...','ok');
  db.collection('pronostics').add({ question, choix, statut:'inactif', bonneReponse:'', points, createdAt:firebase.firestore.FieldValue.serverTimestamp() })
    .then(() => showAlert('prono-create-alert','✅ Pronostic créé','ok'))
    .catch(e => {
      if (currentData?.pronostics) currentData.pronostics=currentData.pronostics.filter(p=>p.id!==tmpId);
      showAlert('prono-create-alert','❌ '+e.message,'err');
    });
}

function doToggleProno(id, statut) {
  if (currentData?.pronostics) {
    currentData.pronostics = currentData.pronostics.map(p => String(p.id)===String(id) ? {...p,statut} : p);
    renderAdminPronostics(currentData.pronostics, currentData.teams);
    renderPronostics(currentData);
  }
  db.collection('pronostics').doc(id).update({ statut }).catch(e => alert('❌ '+e.message));
}

function doCloseProno(id) {
  const sel = document.getElementById('prono-rep-'+id);
  if (!sel) return;
  const rep = sel.value;
  if (!confirm('Clore ce pronostic avec "'+rep+'" comme bonne réponse ?\n\nLes points seront attribués automatiquement.')) return;
  if (currentData?.pronostics) {
    currentData.pronostics = currentData.pronostics.map(p =>
      String(p.id)===String(id) ? {...p, statut:'clos', bonneReponse:rep} : p
    );
    renderAdminPronostics(currentData.pronostics, currentData.teams);
    renderPronostics(currentData);
  }
  (async () => {
    try {
      await db.collection('pronostics').doc(id).update({ statut:'clos', bonneReponse:rep });
      const prono   = liveData.pronostics.find(p => p.id===id);
      const points  = prono?.points || 1;
      // Lire les votes directement depuis Firestore (plus fiable que liveData)
      const votesSnap = await db.collection('votes').where('pronosticId','==',id).where('choix','==',rep).get();
      if (!votesSnap.empty) {
        const scoresSnap = await db.collection('config').doc('pronoScores').get();
        const scores = scoresSnap.exists ? scoresSnap.data() : {};
        votesSnap.docs.forEach(d => {
          const equipeId = d.data().equipeId;
          scores[equipeId] = (scores[equipeId]||0) + points;
        });
        await db.collection('config').doc('pronoScores').set(scores, { merge:true });
      }
      toast('✅ Pronostic clos — points attribués');
      // Forcer re-render du scoreboard
      if (currentData) renderPronostics(currentData);
    } catch(e) { alert('Erreur : '+e.message); }
  })();
}

function doDeleteProno(id) {
  if (!confirm('Supprimer ce pronostic et tous ses votes ?')) return;
  if (currentData?.pronostics) {
    currentData.pronostics = currentData.pronostics.filter(p => String(p.id)!==String(id));
    renderAdminPronostics(currentData.pronostics, currentData.teams);
    renderPronostics(currentData);
  }
  (async () => {
    try {
      await db.collection('pronostics').doc(id).delete();
      const votesSnap = await db.collection('votes').where('pronosticId','==',id).get();
      if (votesSnap.docs.length) {
        const batch = db.batch();
        votesSnap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
      toast('🗑 Pronostic supprimé');
    } catch(e) { alert('Erreur : '+e.message); }
  })();
}

function togglePronoCard(id) {
  const card = document.getElementById('prono-card-' + id);
  if (card) card.classList.toggle('open');
}

function doVote(pronosticId, choix) {
  if (!myEquipeId) { toast("Sélectionnez d'abord votre équipe !"); return; }
  if (currentData?.pronostics) {
    currentData.pronostics = currentData.pronostics.map(p => {
      if (String(p.id)!==String(pronosticId)) return p;
      const newCounts = {...p.counts};
      if (newCounts[choix]!==undefined) newCounts[choix]++; else newCounts[choix]=1;
      return { ...p, counts:newCounts, totalVotes:(p.totalVotes||0)+1, votedEquipes:[...(p.votedEquipes||[]),myEquipeId] };
    });
    renderPronostics(currentData);
    toast('✅ Vote enregistré !');
  }
  db.collection('votes').where('pronosticId','==',pronosticId).where('equipeId','==',myEquipeId).get()
    .then(snap => {
      if (!snap.empty) { alert("❌ Votre equipe a deja vote pour ce pronostic"); return; }
      return db.collection('votes').add({ pronosticId, equipeId:myEquipeId, choix });
    })
    .catch(e => alert('Erreur : '+e.message));
}


function openVotesModal() {
  renderVotesModal();
  document.getElementById('votes-modal').classList.add('open');
}
function closeVotesModal() {
  document.getElementById('votes-modal').classList.remove('open');
}

function renderVotesModal() {
  const content = document.getElementById('votes-modal-content');
  if (!content) return;
  const pronostics = currentData?.pronostics || [];
  const allVotes   = liveData.votes || [];
  const teams      = liveData.equipes || [];

  if (pronostics.length === 0) {
    content.innerHTML = '<div class="empty-state"><div class="es-icon">🎯</div>Aucun pronostic</div>';
    return;
  }

  const teamName = id => teams.find(t => String(t.id)===String(id))?.nom || '(équipe inconnue)';

  let html = '';
  pronostics.forEach(p => {
    const votes = allVotes.filter(v => v.pronosticId === p.id);
    const statusLabel = p.statut==='ouvert' ? '🟢 Ouvert' : p.statut==='clos' ? '🔒 Clos' : '⏸️ Inactif';
    const optsHtml = p.choix.map(ch => `<option value="${ch.replace(/"/g,'&quot;')}">${esc(ch)}</option>`).join('');

    html += `<div style="border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
        <span style="font-family:'Outfit',sans-serif;font-size:0.88rem;font-weight:800;color:var(--navy);flex:1;">${esc(p.question)}</span>
        <span class="prono-status-badge ${p.statut}" style="flex-shrink:0;">${statusLabel}</span>
      </div>`;

    if (votes.length === 0) {
      html += `<div style="font-size:0.78rem;color:var(--muted);font-style:italic;">Aucun vote pour ce pronostic.</div>`;
    } else {
      votes.forEach(v => {
        const escapedChoix = v.choix.replace(/'/g, "\\'");
        html += `<div id="vote-row-${v.id}" style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:7px;background:var(--sand);margin-bottom:5px;flex-wrap:wrap;">
          <span style="font-size:0.82rem;font-weight:600;flex:1;min-width:100px;">${esc(teamName(v.equipeId))}</span>
          <span style="font-size:0.78rem;color:var(--muted);">→</span>
          <span id="vote-label-${v.id}" style="font-size:0.82rem;font-weight:600;color:var(--navy);">${esc(v.choix)}</span>
          <div id="vote-edit-${v.id}" style="display:none;flex:1;min-width:140px;align-items:center;gap:5px;">
            <select id="vote-sel-${v.id}" style="flex:1;padding:4px 8px;border:1.5px solid var(--border);border-radius:6px;font-size:0.8rem;">${optsHtml}</select>
            <button onclick="doSaveVoteEdit('${v.id}')" style="padding:4px 8px;background:var(--green);color:white;border:none;border-radius:6px;font-size:0.78rem;font-weight:600;cursor:pointer;">✓</button>
            <button onclick="doCancelVoteEdit('${v.id}')" style="padding:4px 8px;background:var(--sand);color:var(--text);border:1px solid var(--border);border-radius:6px;font-size:0.78rem;cursor:pointer;">✗</button>
          </div>
          <button id="vote-editbtn-${v.id}" onclick="doStartVoteEdit('${v.id}','${escapedChoix}')" style="padding:3px 8px;background:var(--sand);border:1px solid var(--border);border-radius:6px;font-size:0.75rem;cursor:pointer;">✏️ Modifier</button>
          <button onclick="doDeleteVote('${v.id}')" style="padding:3px 8px;background:var(--red-bg);color:var(--red);border:1px solid #f5c6c2;border-radius:6px;font-size:0.75rem;cursor:pointer;">🗑 Suppr.</button>
        </div>`;
      });
    }
    html += '</div>';
  });

  content.innerHTML = html;
}

function doStartVoteEdit(voteId, currentChoix) {
  const sel = document.getElementById('vote-sel-' + voteId);
  if (sel) sel.value = currentChoix;
  document.getElementById('vote-label-' + voteId).style.display = 'none';
  document.getElementById('vote-editbtn-' + voteId).style.display = 'none';
  const editDiv = document.getElementById('vote-edit-' + voteId);
  if (editDiv) editDiv.style.display = 'flex';
}

function doCancelVoteEdit(voteId) {
  document.getElementById('vote-label-' + voteId).style.display = '';
  document.getElementById('vote-editbtn-' + voteId).style.display = '';
  const editDiv = document.getElementById('vote-edit-' + voteId);
  if (editDiv) editDiv.style.display = 'none';
}

function doSaveVoteEdit(voteId) {
  const sel = document.getElementById('vote-sel-' + voteId);
  if (!sel) return;
  db.collection('votes').doc(voteId).update({ choix: sel.value })
    .then(() => { renderVotesModal(); toast('✅ Vote modifié'); })
    .catch(e => alert('Erreur : ' + e.message));
}

function doDeleteVote(voteId) {
  if (!confirm("Supprimer ce vote ? L'équipe pourra revoter.")) return;
  db.collection('votes').doc(voteId).delete()
    .then(() => { renderVotesModal(); toast('🗑 Vote supprimé — l\'équipe peut revoter'); })
    .catch(e => alert('Erreur : ' + e.message));
}
async function fbGetPronosticScoreboard() {
  try {
    const snap   = await db.collection('config').doc('pronoScores').get();
    const scores = snap.exists ? snap.data() : {};
    const teams  = liveData.equipes.filter(t => t.statut!=='pending');
    return {
      scoreboard: teams
        .map(t => ({ id:t.id, nom:t.nom, j1:t.j1, j2:t.j2, points:scores[t.id]||0 }))
        .sort((a,b) => b.points-a.points)
    };
  } catch(e) { return { scoreboard:[] }; }
}

// ═══════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', initFirebaseListeners);


function renderPublic(data) {
  if (!data || !data.success) {
    document.getElementById('pools-section').innerHTML = '<div class="card"><div class="empty-state">Erreur de chargement</div></div>';
    return;
  }

  const { teams, pools, tableau } = data;

  document.getElementById('team-count-badge').textContent =
    teams.length + ' equipe' + (teams.length !== 1 ? 's' : '');

  // Champion
  const finale = tableau.find(m => m.tour === 'Finale' && m.joue);
  if (finale) {
    const champT = teams.find(t => String(t.id) === String(finale.gagnant));
    document.getElementById('champion-area').innerHTML = `
      <div class="champion-banner">
        <div class="trophy">🏆</div>
        <div class="winner-label">Champion du tournoi</div>
        <div class="winner-name">${champT ? esc(champT.nom) : '—'}</div>
        ${champT ? `<div class="winner-players">👤 ${esc(champT.j1)} &amp; ${esc(champT.j2)}</div>` : ''}
      </div>`;
  } else {
    document.getElementById('champion-area').innerHTML = '';
  }

  // ── Mode maintenance ──
  if (data.maintenanceMode) {
    document.getElementById('champion-area').innerHTML   = '';
    document.getElementById('bracket-section').innerHTML = '';
    document.getElementById('consolation-section').innerHTML = '';
    document.getElementById('stats-section').innerHTML   = '';
    document.getElementById('pools-section').innerHTML   = `
      <div class="maintenance-screen">
        <span class="maintenance-icon">🔧</span>
        <h2>Maintenance en cours</h2>
        <p>L'application est temporairement indisponible.<br>Merci de réessayer dans quelques minutes.</p>
      </div>`;
    // Masquer aussi le bandeau d'inscription
    const banner = document.getElementById('register-banner');
    if (banner) banner.style.display = 'none';
    return;
  } else {
    const banner = document.getElementById('register-banner');
    if (banner) banner.style.display = '';
  }

  // ── Phase d'inscriptions (avant démarrage) ──
  if (!data.tournoiDemarre) {
    const vt = data.validatedTeams || [];
    let phaseHtml = `<div class="phase-banner">
      <div class="phase-banner-icon">📋</div>
      <div class="phase-banner-text">
        <h3>Phase d'inscriptions en cours...</h3>
        <p>${vt.length} équipe${vt.length !== 1 ? 's' : ''} inscrite${vt.length !== 1 ? 's' : ''} — les poules seront attribuées au démarrage du tournoi</p>
      </div>
    </div>`;
    if (vt.length > 0) {
      phaseHtml += `<div class="section-header"><h2>✅ Équipes inscrites (${vt.length})</h2></div><div class="card"><div class="inscription-list">`;
      vt.forEach((t, i) => {
        phaseHtml += `<div class="inscription-card">
          <div class="inscription-card-num">#${i+1}</div>
          <div class="inscription-card-name">${esc(t.nom)}</div>
          <div class="inscription-card-players">👤 ${esc(t.j1)}<br>👤 ${esc(t.j2)}</div>
        </div>`;
      });
      phaseHtml += `</div></div>`;
    } else {
      phaseHtml += `<div class="card"><div class="empty-state"><div class="es-icon">🎯</div>Aucune équipe inscrite pour le moment.<br>Soyez les premiers !</div></div>`;
    }

    // ── Équipes en attente de validation ──
    const pt = data.pending || [];
    if (pt.length > 0) {
      phaseHtml += `<div class="section-header"><h2>⏳ En attente de validation (${pt.length})</h2></div>`;
      phaseHtml += `<div class="card">`;
      phaseHtml += `<p style="font-size:0.75rem;color:var(--muted);margin-bottom:10px;">Ces équipes ont soumis leur inscription. Leur paiement n'a pas encore été confirmé par l'organisateur.</p>`;
      phaseHtml += `<div style="display:flex;flex-direction:column;gap:6px;">`;
      phaseHtml += `</div><div class="inscription-list">`;
      pt.forEach((t, i) => {
        phaseHtml += `<div class="inscription-card" style="border-left:3px solid var(--gold);opacity:0.85;">
          <div class="inscription-card-num" style="color:var(--gold);">⏳ En attente</div>
          <div class="inscription-card-name">${esc(t.nom)}</div>
          <div class="inscription-card-players">👤 ${esc(t.j1)}<br>👤 ${esc(t.j2)}</div>
        </div>`;
      });
      phaseHtml += `</div></div>`;
    }
    document.getElementById('pools-section').innerHTML = phaseHtml;
    document.getElementById('bracket-section').innerHTML = '';
    document.getElementById('consolation-section').innerHTML = '';
    document.getElementById('stats-section').innerHTML = '';
    return;
  }

  // ── Tournoi démarré ──
  if (pools.length === 0) {
    document.getElementById('pools-section').innerHTML = `
      <div class="card">
        <div class="empty-state">
          <div class="es-icon">🎯</div>
          Le tournoi n'a pas encore demarre.<br>Les poules apparaitront ici des les premieres equipes validees.
        </div>
      </div>`;
  } else {
    let html = '<div class="section-header"><h2>🏅 Phase de poules</h2></div>';
    pools.forEach(({ pool, teams: pt, matchs, standings }) => {
      const played   = matchs.filter(m => m.joue).length;
      const total    = matchs.length;
      const pct      = total > 0 ? Math.round((played/total)*100) : 0;
      const expectedMatchs = pt.length * (pt.length - 1) / 2;
      const complete = total > 0 && total >= expectedMatchs && played >= expectedMatchs;
      const waitCnt  = 4 - pt.length;

      html += `<div class="card">
        <div class="card-title">
          <span class="pool-chip" style="background:${pcolor(pool)}">${pool}</span>
          Poule ${pool}
          <span style="margin-left:auto;font-size:0.75rem;font-weight:500;color:var(--muted)">${played}/${total||6} matchs</span>
        </div>`;

      if (total > 0) {
        html += `<div class="pool-progress">
          <div class="pool-progress-bar"><div class="pool-progress-fill ${complete?'done':''}" style="width:${pct}%"></div></div>
          <span class="pool-progress-label">${complete ? '✅ Terminee' : pct+'%'}</span>
        </div>`;
      }

      if (standings.length > 0) {
        html += `<table class="standings-table"><thead><tr>
          <th>#</th><th>Equipe</th><th>J</th><th>V</th><th>D</th><th>+/-</th><th>Pts</th>
        </tr></thead><tbody>`;
        standings.forEach((s, i) => {
          const j = s.v + s.d, diff = s.pf - s.pc;
          const rk = ['r1','r2','r3','rn'][Math.min(i,3)];
          const q  = complete && i < 2;
          html += `<tr class="${q?'qualified':''}">
            <td><span class="rank-dot ${rk}">${i+1}</span></td>
            <td><span class="team-link" onclick="openTeamFiche('${s.team.id}')">${esc(s.team.nom)}</span>${q?'<span class="q-badge">Q</span>':''}</td>
            <td>${j}</td><td>${s.v}</td><td>${s.d}</td>
            <td>${diff>=0?'+':''}${diff}</td>
            <td><strong>${s.pts}</strong></td>
          </tr>`;
        });
        html += `</tbody></table>`;
      }

      if (matchs.length > 0) {
        const playedCount = matchs.filter(m => m.joue).length;
        const btnId  = 'toggle-' + pool;
        const wrapId = 'wrap-'   + pool;
        html += `<button class="matches-toggle" id="${btnId}" onclick="toggleMatches('${pool}')">
          <span class="toggle-label">⚽ Matchs <span style="background:var(--navy);color:white;font-size:0.68rem;padding:1px 7px;border-radius:10px;margin-left:2px;">${playedCount}/${matchs.length}</span></span>
          <span class="toggle-arrow">▼</span>
        </button>`;
        html += `<div class="match-list-wrap" id="${wrapId}"><div class="match-list">`;
        matchs.forEach(m => {
          const t1 = tname(m.eq1, teams)||'?', t2 = tname(m.eq2, teams)||'?';
          if (m.joue) {
            const s1=Number(m.score1),s2=Number(m.score2);
            html += `<div class="match-item">
              <span class="match-team ${s1>s2?'won':''}">${esc(t1)}</span>
              <span class="score-pill played">${s1} — ${s2}</span>
              <span class="match-team right ${s2>s1?'won':''}">${esc(t2)}</span>
            </div>`;
          } else {
            html += `<div class="match-item">
              <span class="match-team">${esc(t1)}</span>
              <span class="score-pill pending">vs</span>
              <span class="match-team right">${esc(t2)}</span>
            </div>`;
          }
        });
        html += `</div></div>`;
      } else if (waitCnt > 0) {
        html += `<div class="empty-state" style="padding:12px;font-size:0.8rem;">⏳ En attente de <strong>${waitCnt}</strong> equipe(s) — ou démarrez la poule dès maintenant</div>`;
      }

      html += `</div>`;
    });
    document.getElementById('pools-section').innerHTML = html;
  }

  renderBracket(data);
  renderConsolation(data);
  renderStats(data);
}

// ─────────────────────────────────────────────────
//  RENDU BRACKET
// ─────────────────────────────────────────────────
function renderBracket({ tableau, teams }) {
  const sec = document.getElementById('bracket-section');
  if (!tableau || tableau.length === 0) {
    sec.innerHTML = `<div class="section-header"><h2>🏆 Tableau final</h2></div>
      <div class="card"><div class="empty-state"><div class="es-icon">🏆</div>Le tableau s'affichera quand tous les matchs de poules seront termines</div></div>`;
    return;
  }

  const ROUND_ORDER = ['Barrage','Quart de finale','Demi-finale','Finale'];
  const byRound = {};
  tableau.forEach(m => { if (!byRound[m.tour]) byRound[m.tour]=[]; byRound[m.tour].push(m); });
  const rounds = ROUND_ORDER.filter(r => byRound[r]);

  function buildBMatch(m, teams) {
    const n1=tname(m.eq1,teams), n2=tname(m.eq2,teams);
    const s1=m.joue?m.score1:'', s2=m.joue?m.score2:'';
    const w1=m.joue&&Number(m.score1)>Number(m.score2), w2=m.joue&&Number(m.score2)>Number(m.score1);
    const cl1=n1?`class="team-link" onclick="openTeamFiche('${m.eq1}')"`:''
    const cl2=n2?`class="team-link" onclick="openTeamFiche('${m.eq2}')"`:''
    return `<div class="b-match">
      <div class="b-team ${w1?'winner':''}"><span class="b-name ${!n1?'tbd':''}" ${cl1}>${n1||'— En attente —'}</span><span class="b-score">${s1}</span></div>
      <div class="b-team ${w2?'winner':''}"><span class="b-name ${!n2?'tbd':''}" ${cl2}>${n2||'— En attente —'}</span><span class="b-score">${s2}</span></div>
    </div>`;
  }

  let html = '<div class="section-header"><h2>🏆 Tableau final</h2></div><div class="card"><div class="bracket-scroll"><div class="bracket-flex">';

  rounds.forEach((rname, ri) => {
    const matches = byRound[rname].sort((a,b) => a.slot - b.slot);
    html += `<div class="b-round"><div class="b-round-label">${rname}</div><div class="b-round-matches">`;
    matches.forEach(m => { html += buildBMatch(m, teams); });
    html += `</div></div>`;
    if (ri < rounds.length-1) {
      html += `<div class="b-connector">`;
      matches.forEach(() => html += `<div class="b-arrow">›</div>`);
      html += `</div>`;
    }
  });

  html += '</div></div></div>';

  // Petite finale séparée sous le bracket
  if (byRound['Petite finale']) {
    const pf = byRound['Petite finale'][0];
    const pn1=tname(pf.eq1,teams), pn2=tname(pf.eq2,teams);
    const ps1=pf.joue?pf.score1:'', ps2=pf.joue?pf.score2:'';
    const pw1=pf.joue&&Number(pf.score1)>Number(pf.score2), pw2=pf.joue&&Number(pf.score2)>Number(pf.score1);
    html += `<div class="card" style="margin-top:0;">
      <div class="petite-finale-label">🥉 Match pour la 3ème place</div>
      ${buildBMatch(pf, teams)}
    </div>`;
  }

  sec.innerHTML = html;
}

// ─────────────────────────────────────────────────
//  RENDU ADMIN
// ─────────────────────────────────────────────────
function renderAdmin({ teams, validatedTeams, pending, pools, tableau, consolation, tournoiDemarre, poolsForAssignment, pronostics }) {

  // ── Inscriptions en attente ──
  const pendingCard = document.getElementById('pending-card');
  if (pending.length === 0) {
    document.getElementById('pending-list').innerHTML =
      '<div class="empty-state"><div class="es-icon">✅</div>Aucune inscription en attente</div>';
    if (!scoreModeOnly) pendingCard.style.display = 'block';
  } else {
    if (!scoreModeOnly) pendingCard.style.display = 'block';
    const tournoiActif = tournoiDemarre || false;
    const availPools   = poolsForAssignment || [];

    let html = `<p style="font-size:0.78rem;color:var(--muted);margin-bottom:12px;">
      ${tournoiActif
        ? 'Tournoi en cours — choisissez la poule pour chaque équipe avant de valider.'
        : 'Cliquez "Valider" après réception du paiement. Les poules seront attribuées au démarrage du tournoi.'}
    </p>`;

    pending.forEach(t => {
      const selectId = 'pool-select-' + t.id;
      const poolSelectHtml = tournoiActif && availPools.length > 0
        ? `<div class="pending-pool-select" style="margin:8px 0 0;">
            <label style="font-size:0.72rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;display:block;margin-bottom:4px;">Poule</label>
            <select id="${selectId}" class="pool-selector">
              ${availPools.map(p => `<option value="${p.pool}">Poule ${p.pool} (${p.count} équipes)</option>`).join('')}
            </select>
           </div>`
        : '';
      const validateCall = tournoiActif && availPools.length > 0
        ? `doValidate('${t.id}', '${selectId}')`
        : `doValidate('${t.id}')`;
      html += `<div class="pending-item">
        <div class="pending-item-header">
          <span class="pending-team-name">${esc(t.nom)}</span>
        </div>
        <div class="pending-players">👤 ${esc(t.j1)} &nbsp;|&nbsp; 👤 ${esc(t.j2)}</div>
        ${poolSelectHtml}
        <div class="pending-actions" style="margin-top:8px;">
          <button class="btn btn-green btn-sm" onclick="${validateCall}">✓ Payé — Valider</button>
          <button class="btn btn-icon btn-ghost" onclick="openEditModal('${t.id}','${esc(t.nom).replace(/'/g,"\'")}','${esc(t.j1).replace(/'/g,"\'")}','${esc(t.j2).replace(/'/g,"\'")}')">✏️</button>
          <button class="btn btn-icon btn-danger" onclick="doDeletePending('${t.id}')">🗑</button>
        </div>
      </div>`;
    });
    document.getElementById('pending-list').innerHTML = html;
  }

  // ── Equipes actives (toutes les validées, avec ou sans poule) ──
  const displayTeams = validatedTeams || teams;
  if (displayTeams.length === 0) {
    document.getElementById('active-teams-list').innerHTML =
      '<div class="empty-state"><div class="es-icon">🎯</div>Aucune equipe validee pour l\'instant</div>';
  } else {
    let html = '';
    displayTeams.forEach(t => {
      const poolBadge = t.poule && t.poule !== ''
        ? `<span class="pool-chip" style="background:${pcolor(t.poule)};width:26px;height:26px;font-size:0.72rem;border-radius:7px;">${t.poule}</span>`
        : `<span style="width:26px;height:26px;border-radius:7px;background:var(--sand);display:inline-flex;align-items:center;justify-content:center;font-size:0.7rem;color:var(--muted);">—</span>`;
      html += `<div class="active-team-item">
        ${poolBadge}
        <div class="active-team-info">
          <div class="active-team-name">${esc(t.nom)}</div>
          <div class="active-team-players">👤 ${esc(t.j1)} &nbsp;|&nbsp; 👤 ${esc(t.j2)}</div>
        </div>
        <div class="active-team-actions">
          <button class="btn btn-icon btn-ghost" onclick="openEditModal('${t.id}','${esc(t.nom).replace(/'/g,"\'")}','${esc(t.j1).replace(/'/g,"\'")}','${esc(t.j2).replace(/'/g,"\'")}')">✏️</button>
        </div>
      </div>`;
    });
    document.getElementById('active-teams-list').innerHTML = html;
  }

  // ── Scores poules ──
  const allPools    = pools;
  const allUnplayed = pools.flatMap(p => p.matchs.filter(m => !m.joue));
  // Poules avec equipes mais sans matchs generes (incompletes)
  const incompletePools = allPools.filter(p => p.matchs.length === 0 && p.teams.length >= 2);

  if (allUnplayed.length === 0 && incompletePools.length === 0 && pools.length > 0) {
    document.getElementById('pool-scores').innerHTML = '<div class="empty-state"><div class="es-icon">✅</div>Tous les matchs de poules sont termines !</div>';
  } else if (allUnplayed.length === 0 && incompletePools.length === 0) {
    document.getElementById('pool-scores').innerHTML = '<div class="empty-state"><div class="es-icon">⏳</div>Aucune poule active pour le moment.</div>';
  } else {
    let html = '';

    // Afficher les poules incompletes avec bouton "Demarrer"
    incompletePools.forEach(p => {
      const waitLeft = 4 - p.teams.length;
      html += `<div class="pool-group-label">
        <span class="pool-chip" style="background:${pcolor(p.pool)};width:22px;height:22px;font-size:0.72rem;">${p.pool}</span>
        Poule ${p.pool} — ${p.teams.length} equipe(s)
      </div>
      <div class="match-score-entry" style="border-left:3px solid var(--gold);">
        <div class="match-label" style="color:var(--gold);">⚠️ Poule incomplete — ${waitLeft} place(s) restante(s)</div>
        <div style="font-size:0.8rem;color:var(--muted);margin-bottom:8px;">
          ${p.teams.map(t => esc(t.nom)).join(', ')}
        </div>
        <div style="font-size:0.78rem;color:var(--muted);margin-bottom:10px;">
          Demarrer maintenant generera <strong>${p.teams.length*(p.teams.length-1)/2} matchs</strong> (round-robin a ${p.teams.length}).
        </div>
        <div class="validate-row">
          <button class="btn btn-gold btn-sm" onclick="doForceStart('${p.pool}')">▶ Demarrer la poule a ${p.teams.length}</button>
        </div>
      </div>`;
    });

    const byPool = {};
    allUnplayed.forEach(m => { if (!byPool[m.poule]) byPool[m.poule]=[]; byPool[m.poule].push(m); });
    Object.keys(byPool).sort().forEach(pool => {
      html += `<div class="pool-group-label"><span class="pool-chip" style="background:${pcolor(pool)};width:22px;height:22px;font-size:0.72rem;">${pool}</span> Poule ${pool}</div>`;
      byPool[pool].forEach(m => {
        const t1=tname(m.eq1,teams)||'?', t2=tname(m.eq2,teams)||'?';
        html += `<div class="match-score-entry">
          <div class="match-label">${esc(t1)} vs ${esc(t2)}</div>
          <div class="score-inputs">
            <span class="team-name-score">${esc(t1)}</span>
            <input type="number" min="0" max="13" value="0" id="ps1_${m.id}">
            <span class="colon">:</span>
            <input type="number" min="0" max="13" value="0" id="ps2_${m.id}">
            <span class="team-name-score right">${esc(t2)}</span>
          </div>
          <div class="validate-row"><button class="btn btn-primary btn-sm" onclick="submitScore('${m.id}')">✓ Valider</button></div>
        </div>`;
      });
    });
    document.getElementById('pool-scores').innerHTML = html;
  }

  // ── Scores tableau final ──
  const playableFinal = tableau.filter(m => !m.joue && m.eq1 && m.eq2 && String(m.eq1)!=='' && String(m.eq2)!=='');
  if (tableau.length > 0) {
    document.getElementById('final-scores-card').style.display = 'block';
    if (playableFinal.length === 0) {
      const done = tableau.every(m => m.joue);
      document.getElementById('final-scores').innerHTML = done
        ? '<div class="empty-state"><div class="es-icon">🏆</div>Le tournoi est termine !</div>'
        : '<div class="empty-state"><div class="es-icon">⏳</div>En attente des tours precedents</div>';
    } else {
      const RLABELS = {'Barrage':'⚡ Barrages','Quart de finale':'⚡ Quarts','Demi-finale':'🔥 Demi-finales','Petite finale':'🥉 3ème place','Finale':'🏆 Finale'};
      let html = '';
      ['Barrage','Quart de finale','Demi-finale','Petite finale','Finale'].forEach(round => {
        const rm = playableFinal.filter(m => m.tour===round);
        if (!rm.length) return;
        html += `<div class="pool-group-label">${RLABELS[round]||round}</div>`;
        rm.forEach(m => {
          const t1=tname(m.eq1,teams)||'?', t2=tname(m.eq2,teams)||'?';
          html += `<div class="match-score-entry">
            <div class="match-label">${esc(t1)} vs ${esc(t2)}</div>
            <div class="score-inputs">
              <span class="team-name-score">${esc(t1)}</span>
              <input type="number" min="0" max="13" value="0" id="fs1_${m.id}">
              <span class="colon">:</span>
              <input type="number" min="0" max="13" value="0" id="fs2_${m.id}">
              <span class="team-name-score right">${esc(t2)}</span>
            </div>
            <div class="validate-row"><button class="btn btn-gold btn-sm" onclick="submitFinalScore('${m.id}')">✓ Valider</button></div>
          </div>`;
        });
      });
      document.getElementById('final-scores').innerHTML = html;
    }
  } else {
    document.getElementById('final-scores-card').style.display = 'none';
  }

  // ── Scores consolation ──
  // consolation vient des params
  const playableConso = consolation.filter(m => !m.joue && m.eq1 && m.eq2 && String(m.eq1)!=='' && String(m.eq2)!=='');
  if (consolation.length > 0) {
    document.getElementById('consolation-scores-card').style.display = 'block';
    const CLABELS = { 'Barrage Conso':'⚡ Barrages Conso', 'Quart Conso':'⚡ Quarts Conso', 'Demi Conso':'🔥 Demi Conso', 'Finale Conso':'🥉 Finale Conso' };
    if (playableConso.length === 0) {
      const done = consolation.every(m => m.joue);
      document.getElementById('consolation-scores').innerHTML = done
        ? '<div class="empty-state"><div class="es-icon">🥉</div>Tableau de consolation terminé !</div>'
        : '<div class="empty-state"><div class="es-icon">⏳</div>En attente des tours précédents</div>';
    } else {
      let html = '';
      ['Barrage Conso','Quart Conso','Demi Conso','Finale Conso'].forEach(round => {
        const rm = playableConso.filter(m => m.tour===round);
        if (!rm.length) return;
        html += `<div class="pool-group-label">${CLABELS[round]||round}</div>`;
        rm.forEach(m => {
          const t1=tname(m.eq1,teams)||'?', t2=tname(m.eq2,teams)||'?';
          html += `<div class="match-score-entry">
            <div class="match-label">${esc(t1)} vs ${esc(t2)}</div>
            <div class="score-inputs">
              <span class="team-name-score">${esc(t1)}</span>
              <input type="number" min="0" max="13" value="0" id="cs1_${m.id}">
              <span class="colon">:</span>
              <input type="number" min="0" max="13" value="0" id="cs2_${m.id}">
              <span class="team-name-score right">${esc(t2)}</span>
            </div>
            <div class="validate-row"><button class="btn btn-sm" style="background:var(--gold);color:var(--navy);font-weight:700;" onclick="submitConsolationScore('${m.id}')">✓ Valider</button></div>
          </div>`;
        });
      });
      document.getElementById('consolation-scores').innerHTML = html;
    }
  } else {
    document.getElementById('consolation-scores-card').style.display = 'none';
  }

  // ── Pronostics admin ──
  renderAdminPronostics(pronostics || [], teams);
}



function renderAdminPronostics(pronostics, teams) {
  // Mettre à jour les suggestions
  if (currentData) renderPronoSuggestions(currentData);
  const sec = document.getElementById('admin-prono-list');
  if (!sec) return;
  if (!pronostics || pronostics.length === 0) {
    sec.innerHTML = '<div class="empty-state"><div class="es-icon">🎯</div>Aucun pronostic créé</div>';
    return;
  }

  let html = '';
  pronostics.forEach(p => {
    const total = p.totalVotes || 0;
    const statusLabel = p.statut === 'ouvert' ? '🟢 Ouvert' : p.statut === 'clos' ? '🔒 Clos' : '⏸️ Inactif';

    html += `<div class="admin-prono-item">
      <div class="admin-prono-q">${esc(p.question)}</div>
      <div class="admin-prono-meta">
        <span class="prono-status-badge ${p.statut}">${statusLabel}</span>
        &nbsp;${total} vote${total>1?'s':''} · ⭐ ${p.points} pt${p.points>1?'s':''}
        ${p.bonneReponse ? `· ✅ Bonne réponse : <strong>${esc(p.bonneReponse)}</strong>` : ''}
      </div>`;

    // Résultats des votes
    if (total > 0) {
      html += `<div style="margin-bottom:8px;">`;
      p.choix.forEach(ch => {
        const cnt = (p.counts && p.counts[ch]) || 0;
        const pct = total > 0 ? Math.round((cnt/total)*100) : 0;
        const isWin = p.statut==='clos' && p.bonneReponse === ch;
        html += `<div style="font-size:0.75rem;color:var(--muted);display:flex;align-items:center;gap:6px;margin-bottom:3px;">
          <span style="min-width:130px;${isWin?'color:var(--green);font-weight:700;':''}">${esc(ch)}</span>
          <div class="prono-bar-wrap"><div class="prono-bar ${isWin?'winner':''}" style="width:${pct}%"></div></div>
          <span style="min-width:32px;">${cnt} (${pct}%)</span>
        </div>`;
      });
      html += `</div>`;
    }

    html += `<div class="admin-prono-actions">`;

    if (p.statut === 'inactif') {
      html += `<button class="btn btn-sm btn-green" onclick="doToggleProno('${p.id}','ouvert')">🟢 Ouvrir</button>`;
    }
    if (p.statut === 'ouvert') {
      html += `<button class="btn btn-sm btn-ghost" onclick="doToggleProno('${p.id}','inactif')">⏸️ Mettre en pause</button>`;
    }
    if (p.statut !== 'clos') {
      // Bouton clore avec sélection de la bonne réponse
      const opts = p.choix.map(ch => `<option value="${ch.replace(/"/g,'&quot;')}">${esc(ch)}</option>`).join('');
      html += `<select id="prono-rep-${p.id}" style="padding:6px 10px;border:1.5px solid var(--border);border-radius:7px;font-size:0.8rem;max-width:160px;">${opts}</select>`;
      html += `<button class="btn btn-sm btn-terra" onclick="doCloseProno('${p.id}')">🔒 Clore + Bonne réponse</button>`;
    }
    html += `<button class="btn btn-sm btn-danger" onclick="doDeleteProno('${p.id}')">🗑</button>`;
    html += `</div></div>`;
  });

  sec.innerHTML = html;
}


function renderConsolation(data) {
  const sec = document.getElementById('consolation-section');
  if (!sec) return;
  const { consolation, teams } = data;

  if (!consolation || consolation.length === 0) { sec.innerHTML = ''; return; }

  const ROUND_ORDER = ['Barrage Conso','Quart Conso','Demi Conso','Finale Conso'];
  const ROUND_LABELS = { 'Barrage Conso':'Barrages', 'Quart Conso':'Quarts', 'Demi Conso':'Demi-finales', 'Finale Conso':'Finale' };
  const byRound = {};
  consolation.forEach(m => { if (!byRound[m.tour]) byRound[m.tour]=[]; byRound[m.tour].push(m); });
  const rounds = ROUND_ORDER.filter(r => byRound[r]);

  let html = '<div class="section-header"><h2>🥉 Tableau de consolation</h2></div>';
  html += '<div class="card"><div class="bracket-scroll"><div class="bracket-flex">';

  rounds.forEach((rname, ri) => {
    const matches = byRound[rname].sort((a,b) => a.slot - b.slot);
    html += `<div class="b-round"><div class="b-round-label">${ROUND_LABELS[rname]||rname}</div><div class="b-round-matches">`;
    matches.forEach(m => {
      const n1=tname(m.eq1,teams), n2=tname(m.eq2,teams);
      const s1=m.joue?m.score1:'', s2=m.joue?m.score2:'';
      const w1=m.joue&&Number(m.score1)>Number(m.score2), w2=m.joue&&Number(m.score2)>Number(m.score1);
      const cl1=n1?`class="team-link" onclick="openTeamFiche(${m.eq1})"`:''
      const cl2=n2?`class="team-link" onclick="openTeamFiche(${m.eq2})"`:'';
      html += `<div class="b-match">
        <div class="b-team ${w1?'winner':''}"><span class="b-name ${!n1?'tbd':''}" ${cl1}>${n1||'— En attente —'}</span><span class="b-score">${s1}</span></div>
        <div class="b-team ${w2?'winner':''}"><span class="b-name ${!n2?'tbd':''}" ${cl2}>${n2||'— En attente —'}</span><span class="b-score">${s2}</span></div>
      </div>`;
    });
    html += `</div></div>`;
    if (ri < rounds.length-1) {
      html += `<div class="b-connector">`;
      matches.forEach(() => html += `<div class="b-arrow">›</div>`);
      html += `</div>`;
    }
  });

  html += '</div></div></div>';
  sec.innerHTML = html;
}

function computeStats(data) {
  const { teams, pools, tableau } = data;
  const allPlayedPool  = pools.flatMap(p => p.matchs.filter(m => m.joue == 1));
  const allPlayedFinal = tableau.filter(m => m.joue == 1);
  const allPlayed      = [...allPlayedPool, ...allPlayedFinal];
  if (allPlayed.length === 0) return null;

  const g = {};
  teams.forEach(t => { g[t.id] = { id: t.id, nom: t.nom, sc: 0, co: 0, played: 0 }; });

  allPlayed.forEach(m => {
    const s1=Number(m.score1), s2=Number(m.score2);
    if (g[m.eq1]) { g[m.eq1].sc+=s1; g[m.eq1].co+=s2; g[m.eq1].played++; }
    if (m.eq2 && g[m.eq2]) { g[m.eq2].sc+=s2; g[m.eq2].co+=s1; g[m.eq2].played++; }
  });

  const active = Object.values(g).filter(t => t.played > 0);
  if (active.length === 0) return null;

  const bestScorer  = [...active].sort((a,b) => b.sc-a.sc)[0];
  const bestDefense = [...active].sort((a,b) => a.co-b.co)[0];
  const tightest    = allPlayed.reduce((best, m) => {
    const diff = Math.abs(Number(m.score1)-Number(m.score2));
    if (best === null || diff < best.diff) return { m, diff };
    return best;
  }, null);

  return { bestScorer, bestDefense, tightest, totalMatchs: allPlayed.length };
}

function renderStats(data) {
  const sec = document.getElementById('stats-section');
  if (!sec) return;
  const stats = computeStats(data);
  if (!stats) { sec.innerHTML = ''; return; }

  const { bestScorer, bestDefense, tightest, totalMatchs } = stats;
  const t1 = tname(tightest.m.eq1, data.teams)||'?';
  const t2 = tname(tightest.m.eq2, data.teams)||'?';

  sec.innerHTML = `
    <div class="section-header"><h2>📊 Statistiques</h2></div>
    <div class="card">
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon">⚽</div>
          <div class="stat-label">Meilleur attaque</div>
          <div class="stat-value">${esc(bestScorer.nom)}</div>
          <div class="stat-sub">${bestScorer.sc} pts marqués</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">🛡️</div>
          <div class="stat-label">Meilleure défense</div>
          <div class="stat-value">${esc(bestDefense.nom)}</div>
          <div class="stat-sub">${bestDefense.co} pts encaissés</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">🎯</div>
          <div class="stat-label">Match le plus serré</div>
          <div class="stat-value" style="font-size:0.78rem;">${esc(t1)} ${tightest.m.score1}–${tightest.m.score2} ${esc(t2)}</div>
          <div class="stat-sub">Écart de ${tightest.diff} pt${tightest.diff>1?'s':''}</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">🏅</div>
          <div class="stat-label">Matchs joués</div>
          <div class="stat-value">${totalMatchs}</div>
          <div class="stat-sub">au total</div>
        </div>
      </div>
    </div>`;
}

function openTeamFiche(teamId) {
  const data = currentData;
  if (!data) return;
  const team = data.teams.find(t => String(t.id) === String(teamId));
  if (!team) return;

  // Matchs de poule
  const poolMatchs = data.pools
    .flatMap(p => p.matchs)
    .filter(m => String(m.eq1)===String(teamId)||String(m.eq2)===String(teamId));

  // Matchs tableau final
  const finalMatchs = data.tableau
    .filter(m => String(m.eq1)===String(teamId)||String(m.eq2)===String(teamId));

  // Stats globales
  let w=0,l=0,sc=0,co=0;
  [...poolMatchs, ...finalMatchs].filter(m=>m.joue==1).forEach(m => {
    const mine = String(m.eq1)===String(teamId);
    const ms = Number(mine?m.score1:m.score2);
    const os = Number(mine?m.score2:m.score1);
    sc+=ms; co+=os;
    if (ms>os) w++; else l++;
  });

  // ── En-tête ──
  let html = `<div class="fiche-header">
    <div class="fiche-name">${esc(team.nom)}</div>
    <div class="fiche-players">👤 ${esc(team.j1)} &nbsp;&amp;&nbsp; ${esc(team.j2)}</div>
    <span class="fiche-pool" style="background:${pcolor(team.poule)}">Poule ${team.poule}</span>
  </div>`;

  // ── Résumé en liste ──
  html += `<div class="fiche-summary">
    <div class="fiche-summary-row win-row">
      <span class="fsr-label">✅ Victoires</span>
      <span class="fsr-val">${w}</span>
    </div>
    <div class="fiche-summary-row loss-row">
      <span class="fsr-label">❌ Défaites</span>
      <span class="fsr-val">${l}</span>
    </div>
    <div class="fiche-summary-row">
      <span class="fsr-label">⚽ Points marqués</span>
      <span class="fsr-val">${sc}</span>
    </div>
    <div class="fiche-summary-row">
      <span class="fsr-label">🛡️ Points encaissés</span>
      <span class="fsr-val">${co}</span>
    </div>
    <div class="fiche-summary-row" style="border-bottom:none;">
      <span class="fsr-label">📊 Différence</span>
      <span class="fsr-val" style="color:${sc-co>=0?'var(--green)':'var(--red)'}">${sc-co>=0?'+':''}${sc-co}</span>
    </div>
  </div>`;

  // ── Détail des matchs ──
  function matchRow(m, tourLabel) {
    if (!m.joue) {
      const opp = String(m.eq1)===String(teamId) ? tname(m.eq2,data.teams) : tname(m.eq1,data.teams);
      return `<div class="fiche-row fiche-row-pending">
        <span class="fiche-row-icon">⏳</span>
        <span class="fiche-row-text">À jouer contre <strong>${esc(opp||'?')}</strong>${tourLabel ? ' <span class="fiche-tour-tag">'+tourLabel+'</span>' : ''}</span>
      </div>`;
    }
    const mine = String(m.eq1)===String(teamId);
    const ms = Number(mine?m.score1:m.score2), os = Number(mine?m.score2:m.score1);
    const win = ms > os;
    const opp = mine ? tname(m.eq2,data.teams) : tname(m.eq1,data.teams);
    return `<div class="fiche-row ${win?'fiche-row-win':'fiche-row-loss'}">
      <span class="fiche-row-icon">${win?'🟢':'🔴'}</span>
      <span class="fiche-row-text">
        ${win?'Victoire':'Défaite'} contre <strong>${esc(opp||'?')}</strong>${tourLabel ? ' <span class="fiche-tour-tag">'+tourLabel+'</span>' : ''}
      </span>
      <span class="fiche-row-score">${ms} – ${os}</span>
    </div>`;
  }

  const allMatchs = [
    ...poolMatchs.map(m => ({ m, label: null })),
    ...finalMatchs.map(m => ({ m, label: m.tour }))
  ];

  if (allMatchs.length > 0) {
    html += `<div class="fiche-tour-label" style="margin-top:16px;">Résultats</div>`;
    allMatchs.forEach(({ m, label }) => { html += matchRow(m, label); });
  }

  document.getElementById('fiche-content').innerHTML = html;
  document.getElementById('fiche-modal').classList.add('open');
}

// ─────────────────────────────────────────────────
//  PRONOSTICS — SUGGESTIONS ADMIN
// ─────────────────────────────────────────────────
function prefillProno(question, choix, points) {
  document.getElementById('prono-question').value = question;
  document.getElementById('prono-choix').value    = choix.join('\n');
  document.getElementById('prono-points').value   = points || 1;
  // Scroll vers le formulaire
  document.getElementById('prono-question').scrollIntoView({ behavior: 'smooth', block: 'center' });
  document.getElementById('prono-question').focus();
}

function renderPronoSuggestions(data) {
  const sec = document.getElementById('prono-suggestions');
  if (!sec) return;

  const { pools, teams, validatedTeams, tableau } = data;
  const allTeams = validatedTeams || teams || [];
  const suggestions = [];

  // ── Gagnant de chaque poule ──
  if (pools && pools.length > 0) {
    pools.forEach(p => {
      if (p.teams && p.teams.length >= 2) {
        suggestions.push({
          label: '🏅 Gagnant Poule ' + p.pool,
          question: 'Quelle équipe va gagner la Poule ' + p.pool + ' ?',
          choix: p.teams.map(t => t.nom),
          points: 1,
          color: '#3B82F6'
        });
      }
    });
  }

  // ── Champion du tournoi ──
  if (allTeams.length >= 2) {
    suggestions.push({
      label: '🏆 Champion du tournoi',
      question: 'Quelle équipe va remporter le tournoi ?',
      choix: allTeams.map(t => t.nom),
      points: 3,
      color: '#F59E0B'
    });
  }

  // ── Vainqueur consolation ──
  if (allTeams.length >= 4) {
    suggestions.push({
      label: '🥉 Vainqueur consolation',
      question: 'Quelle équipe va gagner le tableau de consolation ?',
      choix: allTeams.map(t => t.nom),
      points: 2,
      color: '#10B981'
    });
  }

  // ── Finaliste surprise (equipes qualifiées si tableau dispo) ──
  if (tableau && tableau.length > 0) {
    const qfTeams = [];
    tableau.forEach(m => {
      if (m.eq1 && m.eq1 !== '') {
        const t = allTeams.find(t => String(t.id) === String(m.eq1));
        if (t && !qfTeams.find(x => x.id === t.id)) qfTeams.push(t);
      }
      if (m.eq2 && m.eq2 !== '') {
        const t = allTeams.find(t => String(t.id) === String(m.eq2));
        if (t && !qfTeams.find(x => x.id === t.id)) qfTeams.push(t);
      }
    });
    if (qfTeams.length >= 2) {
      suggestions.push({
        label: '⚡ Finaliste surprise',
        question: 'Quelle équipe qualifiée va créer la surprise ?',
        choix: qfTeams.map(t => t.nom),
        points: 2,
        color: '#8B5CF6'
      });
    }
  }

  // ── Match le plus serré ──
  if (pools && pools.some(p => p.matchs && p.matchs.some(m => !m.joue))) {
    const upcoming = [];
    pools.forEach(p => {
      p.matchs.filter(m => !m.joue).forEach(m => {
        const t1 = tname(m.eq1, allTeams), t2 = tname(m.eq2, allTeams);
        if (t1 && t2) upcoming.push({ t1, t2, poule: p.pool });
      });
    });
    if (upcoming.length > 0) {
      // Premier match à venir
      const m = upcoming[0];
      suggestions.push({
        label: '🎯 ' + m.t1 + ' vs ' + m.t2,
        question: 'Qui va gagner : ' + m.t1 + ' ou ' + m.t2 + ' (Poule ' + m.poule + ') ?',
        choix: [m.t1, m.t2],
        points: 1,
        color: '#E85D26'
      });
    }
  }

  if (suggestions.length === 0) {
    sec.innerHTML = '<span style="font-size:0.75rem;color:var(--muted);font-style:italic;">Disponible une fois les équipes inscrites</span>';
    return;
  }

  // Stocker dans un tableau global pour éviter les problèmes de quotes dans onclick
  window._pronoSuggestions = suggestions;

  sec.innerHTML = suggestions.map((s, i) => `
    <button onclick="prefillPronoByIndex(${i})"
      style="padding:6px 12px;background:white;color:${s.color};border:1.5px solid ${s.color};border-radius:8px;
             font-family:'DM Sans',sans-serif;font-size:0.78rem;font-weight:700;cursor:pointer;transition:all 0.15s;white-space:nowrap;"
      onmouseover="this.style.background='${s.color}';this.style.color='white';"
      onmouseout="this.style.background='white';this.style.color='${s.color}';">
      ${esc(s.label)}
    </button>`
  ).join('');
}

function prefillPronoByIndex(i) {
  const s = window._pronoSuggestions && window._pronoSuggestions[i];
  if (!s) return;
  prefillProno(s.question, s.choix, s.points);
}

// ─────────────────────────────────────────────────
//  PRONOSTICS — RENDU PUBLIC
// ─────────────────────────────────────────────────

function renderPronostics(data) {
  const sec  = document.getElementById('prono-public-section');
  const secS = document.getElementById('prono-scoreboard-section');
  if (!sec) return;

  const pronostics = data.pronostics || [];
  const teams      = [...(data.validatedTeams || []), ...(data.teams || [])];
  // Dédupliquer
  const seen = new Set();
  const allTeams = teams.filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true; });

  const opened   = pronostics.filter(p => p.statut === 'ouvert');
  const closed   = pronostics.filter(p => p.statut === 'clos');
  const inactive = pronostics.filter(p => p.statut === 'inactif');

  if (pronostics.length === 0) {
    sec.innerHTML = `<div class="card"><div class="empty-state"><div class="es-icon">🎯</div>Aucun pronostic disponible pour le moment.<br>Revenez plus tard !</div></div>`;
    if (secS) secS.innerHTML = '';
    return;
  }

  // Sélecteur d'équipe
  let html = `<div class="card" style="margin-bottom:14px;">
    <div class="card-title" style="margin-bottom:10px;">👥 Vous êtes...</div>
    <label class="prono-select-label">Sélectionnez votre équipe pour voter</label>
    <select id="prono-team-select" class="pool-selector" onchange="myEquipeId=this.value; renderPronostics(currentData);">
      <option value="" ${!myEquipeId?'selected':''} disabled>-- Sélectionnez votre équipe --</option>
      ${allTeams.map(t => `<option value="${t.id}" ${String(t.id)===String(myEquipeId)?'selected':''}>${esc(t.nom)}</option>`).join('')}
    </select>
  </div>`;

  // Pronostics ouverts
  if (opened.length > 0) {
    html += `<div class="prono-section-hdr ouvert">🟢 Votes ouverts <span style="font-weight:400;font-size:0.78rem;opacity:0.8;">(${opened.length})</span></div>`;
    opened.forEach(p => { html += buildPronoCard(p, myEquipeId, false); });
  }

  // Inactifs (visibles mais pas votables)
  if (inactive.length > 0) {
    html += `<div class="prono-section-hdr inactif">🟠 Pronostics à venir <span style="font-weight:400;font-size:0.78rem;opacity:0.8;">(${inactive.length})</span></div>`;
    inactive.forEach(p => { html += buildPronoCard(p, myEquipeId, false); });
  }

  // Pronostics clos
  if (closed.length > 0) {
    html += `<div class="prono-section-hdr clos">🔴 Résultats <span style="font-weight:400;font-size:0.78rem;opacity:0.8;">(${closed.length})</span></div>`;
    closed.forEach(p => { html += buildPronoCard(p, myEquipeId, true); });
  }

  sec.innerHTML = html;

  // Scoreboard
  if (closed.length > 0 && secS) {
    fbGetPronosticScoreboard().then(r => {
      if (!r.scoreboard || r.scoreboard.every(s => s.points === 0)) {
        secS.innerHTML = '';
        return;
      }
      let sHtml = `<div class="section-header"><h2>🏅 Classement pronostics</h2></div><div class="card">`;
      r.scoreboard.filter(s => s.points > 0).forEach((s, i) => {
        const ranks = ['r1','r2','r3'];
        const rk = ranks[i] || '';
        sHtml += `<div class="score-board-row">
          <span class="score-board-rank ${rk}">${i+1}</span>
          <span class="score-board-name">${esc(s.nom)}</span>
          <span class="score-board-pts">${s.points} pt${s.points>1?'s':''}</span>
        </div>`;
      });
      sHtml += '</div>';
      secS.innerHTML = sHtml;
    }).catch(() => {});
  } else if (secS) {
    secS.innerHTML = '';
  }
}

function buildPronoCard(p, equipeId, isClosed) {
  const total  = p.totalVotes || 0;
  const haVote = equipeId && p.votedEquipes && p.votedEquipes.map(String).includes(String(equipeId));
  const showBars = haVote || isClosed || p.statut === 'inactif';
  // Ouvert ET pas encore voté = déplié ; déjà voté / clos / inactif = replié
  const startOpen = p.statut === 'ouvert' && !haVote;

  let html = `<div class="prono-card ${startOpen ? 'open' : ''}" id="prono-card-${p.id}">
    <div class="prono-card-header" onclick="togglePronoCard('${p.id}')">
      <div class="prono-card-header-left">
        <span class="prono-status-badge ${p.statut}${haVote ? ' voted' : ''}">${
          p.statut === 'ouvert' ? (equipeId ? (haVote ? '✅ Votre équipe a voté' : '🗳️ Votre équipe n\'a pas encore voté') : '🟢 Vote ouvert')
          : p.statut === 'clos' ? '🔒 Résultat disponible'
          : '⏸️ Bientôt'
        }</span>
        <div class="prono-question">${esc(p.question)}</div>
      </div>
      <span class="prono-card-chevron">▼</span>
    </div>
    <div class="prono-card-body">
    <div class="prono-choices">`;

  p.choix.forEach(ch => {
    const count  = (p.counts && p.counts[ch]) || 0;
    const pct    = total > 0 ? Math.round((count/total)*100) : 0;
    const isWin  = isClosed && p.bonneReponse === ch;
    const isSel  = haVote; // on ne sait pas exactement quel choix l'équipe a fait côté public (sans re-fetch)
    const cls    = isWin ? 'winner' : '';

    if (showBars) {
      html += `<div class="prono-choice-btn ${cls}" style="flex-direction:column;align-items:stretch;gap:5px;cursor:default;">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <span>${esc(ch)}${isWin ? ' ✅' : ''}</span>
          <span style="font-size:0.75rem;font-weight:700;">${count} vote${count>1?'s':''}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <div class="prono-bar-wrap"><div class="prono-bar ${isWin?'winner':''}" style="width:${pct}%"></div></div>
          <span class="prono-pct">${pct}%</span>
        </div>
      </div>`;
    } else if (p.statut === 'ouvert' && equipeId && !haVote) {
      html += `<button class="prono-choice-btn" onclick="doVote('${p.id}','${ch.replace(/'/g,"\\'")}')">
        ${esc(ch)}
      </button>`;
    } else {
      html += `<div class="prono-choice-btn" style="cursor:default;opacity:0.7;">${esc(ch)}</div>`;
    }
  });

  html += `</div>`;

  if (haVote && !isClosed) {
    html += `<div class="prono-voted-msg">✅ Votre équipe a voté</div>`;
  }
  if (!equipeId && p.statut === 'ouvert') {
    html += `<div class="prono-voted-msg">↑ Sélectionnez votre équipe pour voter</div>`;
  }

  html += `<div class="prono-footer">
    <span>${total} vote${total>1?'s':''} au total</span>
    <span class="prono-points-badge">⭐ ${p.points} pt${p.points>1?'s':''}</span>
  </div>
  </div></div>`;

  return html;
}


// ─────────────────────────────────────────────────
//  MISES A JOUR OPTIMISTES (affichage immediat)
// ─────────────────────────────────────────────────
function optimisticUpdatePoolScore(matchId, s1, s2) {
  if (!currentData || !currentData.pools) return;
  // Trouver le match dans currentData et le marquer comme joué
  currentData.pools.forEach(p => {
    p.matchs.forEach(m => {
      if (String(m.id) === String(matchId)) {
        m.score1 = s1; m.score2 = s2; m.joue = true;
      }
    });
    // Recalculer le classement localement
    p.standings = computeLocalStandings(p.pool, p.teams, p.matchs);
  });
  renderPublic(currentData);
  if (adminOpen) renderAdmin(currentData);
}

function optimisticUpdateFinalScore(matchId, s1, s2) {
  if (!currentData || !currentData.tableau) return;
  currentData.tableau.forEach(m => {
    if (String(m.id) === String(matchId)) {
      m.score1 = s1; m.score2 = s2; m.joue = true;
      m.gagnant = s1 > s2 ? m.eq1 : m.eq2;
    }
  });
  renderPublic(currentData);
  if (adminOpen) renderAdmin(currentData);
}

function optimisticUpdateConsolationScore(matchId, s1, s2) {
  if (!currentData || !currentData.consolation) return;
  currentData.consolation.forEach(m => {
    if (String(m.id) === String(matchId)) {
      m.score1 = s1; m.score2 = s2; m.joue = true;
      m.gagnant = s1 > s2 ? m.eq1 : m.eq2;
    }
  });
  renderPublic(currentData);
  if (adminOpen) renderAdmin(currentData);
}

// Calcul classement en local (identique au backend)
function computeLocalStandings(pool, teams, matchs) {
  const st = {};
  teams.forEach(t => { st[t.id] = { team: t, pts: 0, v: 0, d: 0, pf: 0, pc: 0 }; });
  matchs.filter(m => m.joue).forEach(m => {
    if (!st[m.eq1] || !st[m.eq2]) return;
    const s1 = Number(m.score1), s2 = Number(m.score2);
    st[m.eq1].pf += s1; st[m.eq1].pc += s2;
    st[m.eq2].pf += s2; st[m.eq2].pc += s1;
    if      (s1 > s2) { st[m.eq1].v++; st[m.eq1].pts += 2; st[m.eq2].d++; }
    else if (s2 > s1) { st[m.eq2].v++; st[m.eq2].pts += 2; st[m.eq1].d++; }
    else              { st[m.eq1].pts++; st[m.eq2].pts++; }
  });
  return Object.values(st).sort((a,b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    const da = a.pf - a.pc, db = b.pf - b.pc;
    if (db !== da) return db - da;
    return b.pf - a.pf;
  });
}



// ─────────────────────────────────────────────────
//  TOGGLE MATCHS PAR POULE
// ─────────────────────────────────────────────────
function toggleMatches(pool) {
  const btn  = document.getElementById('toggle-' + pool);
  const wrap = document.getElementById('wrap-'   + pool);
  if (!btn || !wrap) return;
  const isOpen = wrap.classList.contains('open');
  btn.classList.toggle('open', !isOpen);
  wrap.classList.toggle('open', !isOpen);
}
