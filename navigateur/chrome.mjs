// Chrome dans le terminal kitty.
// - detecte Google Chrome, sinon Brave, sinon Chromium, et son dossier de profils ;
// - copie le profil choisi (cookies, sessions, mots de passe, favoris) dans un dossier
//   prive, efface a la fermeture : Chrome refuse d'etre pilote sur le profil d'origine ;
// - pilote Chrome sans fenetre par un canal prive (--remote-debugging-pipe, aucun port) ;
// - affiche chaque image de la page avec le protocole graphique de kitty ;
// - transmet clics, molette et clavier.
// Usage : poste-chrome [--profil NOM] [adresse ou recherche]
// Touches : Ctrl+L adresse, Alt+Gauche/Droite precedent/suivant, F5 recharger, F12 DevTools, Ctrl+Q quitter.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ouvrirPont } from './pont-devtools.mjs';

const HOME = os.homedir();
const ETAT = path.join(HOME, '.local/state/poste/chrome');
const ESC = '\x1b';
const ecrire = (s) => process.stdout.write(s);
const t0 = Date.now();
const etapes = [];  // durees de demarrage, ecrites dans demarrage.log (aucune donnee personnelle)
const etape = (nom) => {
    etapes.push(`${nom} ${Date.now() - t0} ms`);
    try { fs.writeFileSync(path.join(ETAT, 'demarrage.log'), etapes.join('\n') + '\n'); } catch { /* sans journal */ }
};

// ---------- 1. navigateur, profil, copie
const NAVIGATEURS = [
    ['google-chrome-stable', '.config/google-chrome'],
    ['google-chrome', '.config/google-chrome'],
    ['brave-browser', '.config/BraveSoftware/Brave-Browser'],
    ['chromium', '.config/chromium'],
    ['chromium-browser', '.config/chromium'],
];

function trouver(bin) {
    for (const d of (process.env.PATH || '/usr/bin').split(':')) {
        const p = path.join(d, bin);
        try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* suivant */ }
    }
    return null;
}

const args = process.argv.slice(2);
let nomProfil = 'Default';
let demande = '';
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--profil') nomProfil = args[++i] || 'Default';
    else { demande = args.slice(i).join(' '); break; }
}

let nav = null;
for (const [bin, conf] of NAVIGATEURS) {
    const p = trouver(bin);
    if (p && fs.existsSync(path.join(HOME, conf, 'Local State'))) { nav = { bin: p, source: path.join(HOME, conf) }; break; }
}
if (!nav) { console.error('Aucun Google Chrome, Brave ou Chromium avec un profil trouve.'); process.exit(1); }

const infos = JSON.parse(fs.readFileSync(path.join(nav.source, 'Local State'), 'utf8')).profile?.info_cache || {};
const profil = infos[nomProfil] ? nomProfil
    : (Object.entries(infos).find(([, v]) => v.name === nomProfil) || ['Default'])[0];

fs.mkdirSync(ETAT, { recursive: true, mode: 0o700 });
fs.chmodSync(ETAT, 0o700);
for (const d of fs.readdirSync(ETAT)) {  // copies laissees par un plantage
    const pid = Number(d.split('-')[1]);
    try { process.kill(pid, 0); } catch { fs.rmSync(path.join(ETAT, d), { recursive: true, force: true }); }
}
const copie = path.join(ETAT, `session-${process.pid}`);
const src = path.join(nav.source, profil);
const dst = path.join(copie, profil);
fs.mkdirSync(dst, { recursive: true, mode: 0o700 });
fs.copyFileSync(path.join(nav.source, 'Local State'), path.join(copie, 'Local State'));
for (const f of ['Preferences', 'Secure Preferences', 'Bookmarks']) {
    if (fs.existsSync(path.join(src, f))) fs.copyFileSync(path.join(src, f), path.join(dst, f));
}
for (const db of ['Cookies', 'Network/Cookies', 'Login Data', 'Web Data']) {  // copie coherente a chaud
    const s = path.join(src, db);
    if (!fs.existsSync(s)) continue;
    const d = path.join(dst, db);
    fs.mkdirSync(path.dirname(d), { recursive: true });
    for (const mode of ['mode=ro', 'mode=ro&immutable=1']) {  // immutable : base verrouillee par Chrome
        try { execFileSync('sqlite3', [`file:${s}?${mode}`, `.backup '${d}'`], { stdio: 'ignore', timeout: 15000 }); break; } catch { /* essai suivant */ }
    }
}
if (fs.existsSync(path.join(src, 'Local Storage'))) {
    fs.cpSync(path.join(src, 'Local Storage'), path.join(dst, 'Local Storage'), { recursive: true });
}

etape('copie du profil');

// ---------- 2. Chrome et protocole de pilotage par canal prive
const chrome = spawn(nav.bin, [
    '--headless=new', `--user-data-dir=${copie}`, `--profile-directory=${profil}`,
    '--remote-debugging-pipe', '--disable-extensions', '--no-first-run',
    '--no-default-browser-check', '--disable-session-crashed-bubble',
    // sans fenetre, Chrome se croit en arriere-plan et ralentit minuteries et rendu
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    // ne pas se signaler comme navigateur pilote (navigator.webdriver) aux sites
    '--disable-blink-features=AutomationControlled',
    'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
const versChrome = chrome.stdio[3];
let recu = Buffer.alloc(0);
let numero = 0;
const attente = new Map();
const ecoutes = {};
const relais = new Map();  // session ouverte pour l'interface DevTools -> son relais
chrome.stdio[4].on('data', (b) => {
    recu = Buffer.concat([recu, b]);
    let i;
    while ((i = recu.indexOf(0)) >= 0) {
        const m = JSON.parse(recu.subarray(0, i).toString('utf8'));
        recu = recu.subarray(i + 1);
        if (m.sessionId && relais.has(m.sessionId)) relais.get(m.sessionId)(m);
        else if (m.id && attente.has(m.id)) { attente.get(m.id)(m.result || {}); attente.delete(m.id); }
        else if (m.method && ecoutes[m.method]) ecoutes[m.method](m.params || {}, m.sessionId);
    }
});
const cdp = (method, params = {}, sessionId) => new Promise((r) => {
    const id = ++numero;
    attente.set(id, r);
    versChrome.write(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }) + '\0');
});
let session = null;
const page = (method, params) => cdp(method, params, session);
let dt = null;          // DevTools ouverts : { cible, session }
let focus = 'page';     // zone qui recoit le clavier : 'page' ou 'dt'
const actif = (method, params) => cdp(method, params, focus === 'dt' && dt ? dt.session : session);

// ---------- 3. terminal
let fini = false;
let titre = '';
let adresse = '';
let edition = null;  // texte en cours de saisie dans la barre d'adresse
let decalage = 18;   // hauteur en pixels de la ligne de la barre
let largeur = 0;
let hauteur = 0;    // hauteur de la page en pixels
let hauteurDt = 0;  // hauteur des DevTools en pixels (0 si fermes)

function quitter(code = 0) {
    if (fini) return;
    fini = true;
    ecrire(`${ESC}_Ga=d,d=A,q=2${ESC}\\${ESC}[?2004l${ESC}[?1016l${ESC}[?1006l${ESC}[?1003l${ESC}[?25h${ESC}[?1049l`);
    try { process.stdin.setRawMode(false); } catch { /* deja restaure */ }
    chrome.kill();
    fs.rmSync(copie, { recursive: true, force: true });
    process.exit(code);
}
for (const s of ['SIGTERM', 'SIGHUP', 'SIGINT']) process.on(s, () => quitter(0));
chrome.on('exit', () => quitter(1));

function barre() {
    const cols = process.stdout.columns;
    const aide = ' Ctrl+L adresse  Alt+←/→  F5  F12  Ctrl+Q ';
    const texte = edition !== null ? ` Adresse : ${edition}▏` : ` ${titre || 'Chrome'} — ${adresse}`;
    const place = Math.max(0, cols - aide.length);
    const gauche = texte.length > place ? texte.slice(0, Math.max(0, place - 1)) + '…' : texte.padEnd(place);
    ecrire(`${ESC}7${ESC}[1;1H${ESC}[48;2;28;28;28m${ESC}[38;2;230;230;230m${gauche}`
        + `${ESC}[38;2;120;120;120m${aide.slice(0, cols - gauche.length)}${ESC}[0m${ESC}8`);
}

// Image PNG de la page, sous la barre, sans clignotement :
// - mise a jour synchronisee (?2026) : kitty n'affiche rien avant la fin de l'envoi ;
// - double tampon : la nouvelle image (page 1 ou 2, DevTools 3 ou 4) est posee, puis seulement l'ancienne effacee.
const imageActive = { page: 0, dt: 0 };
function afficher(b64, zone) {
    const base = zone === 'dt' ? 3 : 1;
    const ancienne = imageActive[zone];
    const nouvelle = ancienne === base ? base + 1 : base;
    const ligne = zone === 'dt' ? 2 + Math.round(hauteur / decalage) : 2;
    let s = `${ESC}[?2026h${ESC}7${ESC}[${ligne};1H`;
    for (let i = 0; i < b64.length; i += 4096) {
        const plus = i + 4096 < b64.length ? 1 : 0;
        const bout = b64.slice(i, i + 4096);
        s += i === 0 ? `${ESC}_Ga=T,f=100,i=${nouvelle},p=1,q=2,C=1,m=${plus};${bout}${ESC}\\` : `${ESC}_Gm=${plus};${bout}${ESC}\\`;
    }
    s += `${ESC}8`;
    if (ancienne) s += `${ESC}_Ga=d,d=I,i=${ancienne},q=2${ESC}\\`;
    imageActive[zone] = nouvelle;
    ecrire(s + `${ESC}[?2026l`);
}

let reponsePixels = null;
const taillePixels = () => new Promise((r) => {
    reponsePixels = r;
    ecrire(`${ESC}[14t`);
    setTimeout(() => { if (reponsePixels === r) { reponsePixels = null; r({ w: process.stdout.columns * 9, h: process.stdout.rows * 18 }); } }, 1000);
});

async function dimensionner() {
    const px = await taillePixels();
    decalage = Math.floor(px.h / process.stdout.rows);
    largeur = px.w;
    const lignes = process.stdout.rows - 1;
    hauteur = dt ? Math.ceil(lignes / 2) * decalage : px.h - decalage;  // DevTools : moitie basse
    hauteurDt = dt ? px.h - decalage - hauteur : 0;
    const zones = [[session, hauteur]];
    if (dt) zones.push([dt.session, hauteurDt]);
    for (const [s, h] of zones) {
        await cdp('Emulation.setDeviceMetricsOverride', { width: largeur, height: h, deviceScaleFactor: 1, mobile: false }, s);
        await cdp('Page.stopScreencast', {}, s);
        await cdp('Page.startScreencast', { format: 'png', maxWidth: largeur, maxHeight: h, everyNthFrame: 1 }, s);
    }
}

// F12 : les vrais DevTools de Chrome (page devtools://, ouverte dans le meme Chrome sans
// fenetre), branches sur la page par le relais local de pont-devtools.mjs.
let pont = null;
let bascule = false;
async function devtools() {
    if (bascule) return;
    bascule = true;
    try {
        if (dt) {
            const d = dt;
            dt = null;
            focus = 'page';
            pont.deconnecter();
            await cdp('Target.closeTarget', { targetId: d.cible });
            ecrire(`${ESC}_Ga=d,d=I,i=3,q=2${ESC}\\${ESC}_Ga=d,d=I,i=4,q=2${ESC}\\`);
            imageActive.dt = 0;
        } else {
            pont ??= await ouvrirPont(async (envoyer) => {
                const { sessionId } = await cdp('Target.attachToTarget', { targetId: cible.targetId, flatten: true });
                relais.set(sessionId, (m) => { delete m.sessionId; envoyer(JSON.stringify(m)); });
                return {
                    recevoir: (t) => { const m = JSON.parse(t); m.sessionId = sessionId; versChrome.write(JSON.stringify(m) + '\0'); },
                    fermer: () => { relais.delete(sessionId); cdp('Target.detachFromTarget', { sessionId }); },
                };
            });
            const { targetId } = await cdp('Target.createTarget', { url: `devtools://devtools/bundled/devtools_app.html?ws=${pont.adresse}` });
            const s = (await cdp('Target.attachToTarget', { targetId, flatten: true })).sessionId;
            await cdp('Page.enable', {}, s);
            await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, s);
            await cdp('Emulation.setFocusEmulationEnabled', { enabled: true }, s);
            dt = { cible: targetId, session: s };
            focus = 'dt';
        }
        ecrire(`${ESC}[2J`);
        await dimensionner();
        barre();
    } finally { bascule = false; }
}

function versAdresse(t) {
    t = t.trim();
    if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return t;
    if (!/\s/.test(t) && /\.[a-z]{2,}(\/|:|$)/i.test(t)) return 'https://' + t;
    return 'https://www.google.com/search?q=' + encodeURIComponent(t);
}
const naviguer = (t) => page('Page.navigate', { url: versAdresse(t) });

async function historique(sens) {
    const h = await page('Page.getNavigationHistory');
    const e = h.entries?.[h.currentIndex + sens];
    if (e) page('Page.navigateToHistoryEntry', { entryId: e.id });
}

// ---------- 4. souris (coordonnees en pixels, mode 1016)
let dernierClic = { t: 0, x: 0, y: 0, n: 0 };
function souris(b, x, y, relache) {
    const px = x - 1;
    let py = y - 1 - decalage;
    if (py < 0) { if (!relache && b === 0) { edition = ''; barre(); } return; }
    let zone = session;
    if (dt && py >= hauteur) { zone = dt.session; py -= hauteur; }
    if (!relache && !(b & 32) && !(b & 64)) focus = zone === session ? 'page' : 'dt';
    const page = (method, params) => cdp(method, params, zone);
    const modifiers = (b & 8 ? 1 : 0) | (b & 16 ? 2 : 0) | (b & 4 ? 8 : 0);
    if (b & 64) {
        page('Input.dispatchMouseEvent', { type: 'mouseWheel', x: px, y: py, deltaX: 0, deltaY: (b & 1) ? 120 : -120, modifiers });
        return;
    }
    const bouton = ['left', 'middle', 'right', 'none'][b & 3];
    const buttons = { left: 1, right: 2, middle: 4, none: 0 }[bouton];
    if (b & 32) { page('Input.dispatchMouseEvent', { type: 'mouseMoved', x: px, y: py, button: bouton, buttons, modifiers }); return; }
    if (!relache) {
        const t = Date.now();
        const proche = t - dernierClic.t < 400 && Math.abs(px - dernierClic.x) < 5 && Math.abs(py - dernierClic.y) < 5;
        dernierClic = { t, x: px, y: py, n: proche ? dernierClic.n + 1 : 1 };
    }
    page('Input.dispatchMouseEvent', {
        type: relache ? 'mouseReleased' : 'mousePressed', x: px, y: py, button: bouton, buttons, clickCount: dernierClic.n, modifiers,
    });
}

// ---------- 5. clavier
const TOUCHES = {
    '\r': ['Enter', 13, '\r'], '\x7f': ['Backspace', 8], '\b': ['Backspace', 8], '\t': ['Tab', 9],
    '\x1b': ['Escape', 27], '\x1b[A': ['ArrowUp', 38], '\x1b[B': ['ArrowDown', 40], '\x1b[C': ['ArrowRight', 39],
    '\x1b[D': ['ArrowLeft', 37], '\x1bOA': ['ArrowUp', 38], '\x1bOB': ['ArrowDown', 40], '\x1bOC': ['ArrowRight', 39],
    '\x1bOD': ['ArrowLeft', 37], '\x1b[3~': ['Delete', 46], '\x1b[H': ['Home', 36], '\x1b[F': ['End', 35],
    '\x1b[1~': ['Home', 36], '\x1b[4~': ['End', 35], '\x1b[5~': ['PageUp', 33], '\x1b[6~': ['PageDown', 34],
};

function envoyerTouche(key, keyCode, texte, modifiers = 0) {
    const code = key.length === 1 ? `Key${key.toUpperCase()}` : key;
    actif('Input.dispatchKeyEvent', { type: texte ? 'keyDown' : 'rawKeyDown', key, code, windowsVirtualKeyCode: keyCode, modifiers, ...(texte && { text: texte }) });
    actif('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, modifiers });
}

function touche(seq) {
    if (edition !== null) {  // saisie dans la barre d'adresse
        if (seq === '\r') { const t = edition; edition = null; if (t.trim()) naviguer(t); }
        else if (seq === '\x1b') edition = null;
        else if (seq === '\x7f' || seq === '\b') edition = edition.slice(0, -1);
        barre();
        return;
    }
    if (seq === '\x11') return quitter(0);                                   // Ctrl+Q
    if (seq === '\x0c') { edition = ''; return barre(); }                    // Ctrl+L
    if (seq === '\x1b[15~' || seq === '\x12') return page('Page.reload');    // F5, Ctrl+R
    if (seq === '\x1b[24~') return devtools();                              // F12
    if (seq === '\x1b[1;3D') return historique(-1);                          // Alt+Gauche
    if (seq === '\x1b[1;3C') return historique(1);                           // Alt+Droite
    if (seq === '\x1b[Z') return envoyerTouche('Tab', 9, null, 8);           // Maj+Tab
    if (TOUCHES[seq]) { const [k, c, t] = TOUCHES[seq]; return envoyerTouche(k, c, t); }
    const c = seq.charCodeAt(0);
    if (seq.length === 1 && c >= 1 && c <= 26) return envoyerTouche(String.fromCharCode(c + 96), c + 64, null, 2);  // Ctrl+lettre
}

function texte(t) {
    if (edition !== null) { edition += t; barre(); }
    else actif('Input.insertText', { text: t });
}

let entree = '';
function lireEntree() {
    while (entree.length) {
        let m;
        if ((m = entree.match(/^\x1b\[4;(\d+);(\d+)t/))) { if (reponsePixels) { const r = reponsePixels; reponsePixels = null; r({ w: +m[2], h: +m[1] }); } }
        else if ((m = entree.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])/))) souris(+m[1], +m[2], +m[3], m[4] === 'm');
        else if (entree.startsWith('\x1b[200~')) {
            const fin = entree.indexOf('\x1b[201~');
            if (fin < 0) return;
            texte(entree.slice(6, fin));
            m = [entree.slice(0, fin + 6)];
        }
        else if (/^\x1b(\[[0-9;<]*)?$/.test(entree) && entree.length > 1) return;  // sequence incomplete
        else if ((m = entree.match(/^\x1b\[[0-9;]*[A-Za-z~]|^\x1bO[A-Za-z]/))) touche(m[0]);
        else if ((m = entree.match(/^[^\x00-\x1f\x7f]+/))) texte(m[0]);
        else { m = [entree[0]]; touche(m[0]); }
        entree = entree.slice(m[0].length);
    }
}

// ---------- 6. demarrage
ecrire(`${ESC}[?1049h${ESC}[?25l${ESC}[2J${ESC}[?1003h${ESC}[?1006h${ESC}[?1016h${ESC}[?2004h`);
process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { entree += d; lireEntree(); });

const { targetInfos = [] } = await cdp('Target.getTargets');
etape('chrome pret');
const cible = targetInfos.find((t) => t.type === 'page');
if (!cible) quitter(1);
session = (await cdp('Target.attachToTarget', { targetId: cible.targetId, flatten: true })).sessionId;
ecoutes['Target.targetInfoChanged'] = ({ targetInfo: t }) => {
    if (t.targetId === cible.targetId) { titre = t.title; adresse = t.url; barre(); }
    else if (t.type === 'page' && t.url && t.url !== 'about:blank' && !t.url.startsWith('devtools://')) {  // lien ouvert dans un nouvel onglet : on le suit ici
        naviguer(t.url);
        cdp('Target.closeTarget', { targetId: t.targetId });
    }
};
await cdp('Target.setDiscoverTargets', { discover: true });
// diagnostic a la demande : POSTE_CHROME_JOURNAL=1 poste-chrome ... -> journal.log
const journal = process.env.POSTE_CHROME_JOURNAL ? path.join(ETAT, 'journal.log') : null;
const noter = (texte) => { if (journal) fs.appendFileSync(journal, `${Date.now() - t0} ms  ${texte}\n`); };
let images = 0;
ecoutes['Page.screencastFrame'] = (p, s) => {
    cdp('Page.screencastFrameAck', { sessionId: p.sessionId }, s);
    const zone = s === session ? 'page' : 'dt';
    if (zone === 'dt' && !dt) return;
    if (!imageActive.page) etape('premiere image');
    noter(`image ${zone} n°${++images} (${Math.round(p.data.length / 1024)} Ko)`);
    afficher(p.data, zone);
};
if (journal) {
    fs.writeFileSync(journal, '');
    ecoutes['Page.loadEventFired'] = () => noter('chargement termine (load)');
    ecoutes['Page.frameNavigated'] = ({ frame }) => { if (!frame.parentId) noter(`page : ${frame.url.slice(0, 80)}`); };
    ecoutes['Network.loadingFailed'] = (p) => noter(`requete echouee : ${p.errorText} ${p.blockedReason || ''} ${p.type || ''}`);
    ecoutes['Network.responseReceived'] = (p) => { if (p.response.status >= 400) noter(`HTTP ${p.response.status} ${p.response.url.slice(0, 120)}`); };
    ecoutes['Runtime.exceptionThrown'] = (p) => noter(`erreur JS : ${(p.exceptionDetails.exception?.description || p.exceptionDetails.text).slice(0, 200)}`);
    ecoutes['Log.entryAdded'] = ({ entry: e }) => { if (e.level === 'error') noter(`console : ${e.text.slice(0, 200)}`); };
    await page('Network.enable');
    await page('Runtime.enable');
    await page('Log.enable');
}
await page('Page.enable');
// s'annoncer comme un Chrome normal : en "HeadlessChrome", beaucoup de sites servent une autre page
const { userAgent = '' } = await cdp('Browser.getVersion');
await page('Emulation.setUserAgentOverride', { userAgent: userAgent.replace('HeadlessChrome', 'Chrome') });
// page au premier plan et active : survols, focus et animations comme dans une vraie fenetre
await page('Emulation.setFocusEmulationEnabled', { enabled: true });
await dimensionner();
process.stdout.on('resize', async () => { ecrire(`${ESC}[2J`); await dimensionner(); barre(); });
barre();
if (demande) naviguer(demande); else { edition = ''; barre(); }
