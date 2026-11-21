// Chrome dans le terminal kitty.
// - profil : voir profil.mjs (copie permanente du profil Chrome, cookies fusionnes) ;
// - pilote Chrome sans fenetre par un canal prive (--remote-debugging-pipe, aucun port) ;
// - affiche chaque image de la page avec le protocole graphique de kitty ;
// - onglets, DevTools (F12), dialogues, copier/coller, telechargements, envoi de fichiers (yazi),
//   zoom, recherche, forme du curseur ; adresses memorisees pour la restauration apres reboot.
// Usage : poste-chrome [--profil NOM] [--actualiser] [adresse ou recherche]
import { execFile } from 'node:child_process';
import { lancerChrome } from './canal.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { ouvrirPont } from './pont-devtools.mjs';
import { preparerProfil, ETAT, trouver } from './profil.mjs';
import { versAdresse, TOUCHES, SELECTION, ZOOMS, AIDE, FOND, afficher, imageActive, decouper, dessinerBarre, creerCurseur, appliquerZoom, brancherJournal,
    brancherTelechargements, choisirAvecYazi } from './outils.mjs';

const ESC = '\x1b';
const ecrire = (s) => process.stdout.write(s);
process.stdout.on('error', () => {});  // fenetre fermee : terminal disparu, on nettoie quand meme
const ENTRER = `${ESC}[?1049h${ESC}[?25l${ESC}[2J${ESC}[?1003h${ESC}[?1006h${ESC}[?1016h${ESC}[?2004h`;
const SORTIR = `${ESC}_Ga=d,d=A,q=2${ESC}\\${ESC}]22;${ESC}\\${ESC}[?2004l${ESC}[?1016l${ESC}[?1006l${ESC}[?1003l${ESC}[?25h${ESC}[?1049l`;
const t0 = Date.now();
const etapes = [];  // durees de demarrage, ecrites dans demarrage.log (aucune donnee personnelle)
const etape = (nom) => {
    etapes.push(`${nom} ${Date.now() - t0} ms`);
    try { fs.writeFileSync(path.join(ETAT, 'demarrage.log'), etapes.join('\n') + '\n'); } catch { /* sans journal */ }
};

// ---------- 1. arguments, profil
const args = process.argv.slice(2);
let nomProfil = 'Default';
let actualiser = false;
let demandes = [];
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--profil') nomProfil = args[++i] || 'Default';
    else if (args[i] === '--actualiser') actualiser = true;
    else { demandes = [args.slice(i).join(' ')]; break; }
}
// onglets a rouvrir apres un redemarrage, poses par launch_wrapper.py : "actif url1 url2 ..."
let actifRestaure = 0;
if (process.env.KITTY_POSTE_WEB) {
    const [a, ...u] = process.env.KITTY_POSTE_WEB.split(' ');
    actifRestaure = Number(a) || 0;
    demandes = u.filter((x) => /^https?:\/\/\S+$/.test(x));
    delete process.env.KITTY_POSTE_WEB;
}
let prof;
try { prof = preparerProfil(nomProfil, actualiser); } catch (e) { console.error(e.message); process.exit(1); }
etape(prof.temporaire ? 'copie temporaire du profil' : 'profil du terminal');

// ---------- 2. Chrome (canal.mjs) et etat
const { chrome, cdp, ecoutes, relais, brut } = lancerChrome(prof);
const onglets = [];      // { cible, session, titre, adresse }
let actuel = 0;
let session = null;      // session de l'onglet affiche
let cible = null;        // son identifiant de cible
const page = (method, params) => cdp(method, params, session);
let dt = null;           // DevTools ouverts : { cible, session }
let focus = 'page';      // zone qui recoit le clavier : 'page' ou 'dt'
const actif = (method, params) => cdp(method, params, focus === 'dt' && dt ? dt.session : session);
let fini = false;
let saisie = null;       // barre en saisie : { invite, texte, libre, garder, valider(t), annuler() }
let avis = '', avisMinuteur = null;  // message temporaire de la barre
let zoom = 1;
let decalage = 18;       // hauteur en pixels de la barre (0 en mode immersif)
let immersif = false;    // F11 : sans barre, fenetre kitty en plein ecran
let largeur = 0;         // largeur de la page en pixels
let hauteur = 0;
let colonnesPage = 0;
let ua = '';

function quitter(code = 0, volontaire = false) {
    if (fini) return;
    fini = true;
    // fermeture voulue : rien a rouvrir au prochain demarrage
    if (volontaire) ecrire(`${ESC}]1337;SetUserVar=poste_web\x07`);
    ecrire(SORTIR);
    try { process.stdin.setRawMode(false); } catch { /* deja restaure */ }
    // effacer la copie temporaire seulement une fois Chrome arrete : en s'arretant il y reecrit des fichiers
    const nettoyer = () => {  // ses processus annexes ecrivent encore un instant : on reessaie
        try { if (prof.temporaire) fs.rmSync(prof.dossier, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* efface au prochain lancement */ }
        process.exit(code);
    };
    if (chrome.exitCode !== null || chrome.signalCode !== null) return nettoyer();
    chrome.once('exit', nettoyer);
    chrome.kill();
    setTimeout(() => chrome.kill('SIGKILL'), 3000).unref();
}
for (const s of ['SIGTERM', 'SIGHUP', 'SIGINT']) process.on(s, () => quitter(0));
chrome.on('exit', () => quitter(1));

// adresses des onglets dans une variable de la fenetre kitty, sauvegardee avec la session
let memoire = null;
function memoriser() {
    const garde = onglets.filter((o) => /^https?:\/\/\S+$/.test(o.adresse));
    const val = garde.length ? `${Math.max(0, garde.indexOf(onglets[actuel]))} ${garde.map((o) => o.adresse).join(' ')}` : '';
    if (val === memoire) return;
    memoire = val;
    ecrire(val ? `${ESC}]1337;SetUserVar=poste_web=${Buffer.from(val).toString('base64')}\x07` : `${ESC}]1337;SetUserVar=poste_web\x07`);
}

// ---------- 4. barre du haut : onglets (cliquables), adresse, saisies, avis
let zonesOnglets = [];
function barre() {
    if (immersif && !saisie && !ouvreDt && !avis) { zonesOnglets = []; return ecrire(`${ESC}7${ESC}[1;1H${ESC}[0m${ESC}[2K${ESC}8`); }
    const cols = process.stdout.columns;
    const aide = ` ${zoom !== 1 ? `${Math.round(zoom * 100)} %  ` : ''}${AIDE} `;
    const morceaux = [];
    zonesOnglets = [];
    const o = onglets[actuel];
    if (saisie) morceaux.push([` ${saisie.invite}${saisie.libre ? `${saisie.texte}▏` : ''}`, '40;40;60']);
    else if (ouvreDt) morceaux.push([' Ouverture des DevTools…', FOND]);
    else if (avis) morceaux.push([` ${avis}`, '30;50;30']);
    else {
        let col = 0;
        if (onglets.length > 1) onglets.forEach((x, i) => {
            const t = ` ${i + 1} ${(x.titre || x.adresse || 'nouvel onglet').slice(0, 16)} `;
            zonesOnglets.push({ debut: col, fin: col + t.length, i });
            morceaux.push([t, i === actuel ? '70;70;70' : FOND]);
            col += t.length;
        });
        morceaux.push([onglets.length > 1 ? ` ${o?.adresse || ''}` : ` ${o?.titre || 'Chrome'} — ${o?.adresse || ''}`, FOND]);
    }
    dessinerBarre(morceaux, aide, cols);
}
function montrer(t) {
    avis = t;
    barre();
    clearTimeout(avisMinuteur);
    avisMinuteur = setTimeout(() => { avis = ''; barre(); }, 4000);
}
const saisieAdresse = () => { saisie = { invite: 'Adresse : ', texte: '', libre: true, valider: (t) => t.trim() && naviguer(t) }; barre(); };

let reponsePixels = null;
const taillePixels = () => new Promise((r) => {
    reponsePixels = r;
    ecrire(`${ESC}[14t`);
    setTimeout(() => { if (reponsePixels === r) { reponsePixels = null; r({ w: process.stdout.columns * 9, h: process.stdout.rows * 18 }); } }, 1000);
});

let pixels = null;     // taille de la zone de texte en pixels (derniere mesure)
let partPage = 0.5;    // part de la largeur pour la page quand les DevTools sont ouverts
async function dimensionner(remesurer = true) {
    if (remesurer || !pixels) pixels = await taillePixels();
    const px = pixels;
    decalage = immersif ? 0 : Math.floor(px.h / process.stdout.rows);
    hauteur = px.h - decalage;
    const cols = process.stdout.columns;
    colonnesPage = dt ? Math.round(cols * partPage) : cols;  // DevTools a droite
    largeur = dt ? Math.floor(colonnesPage * px.w / cols) : px.w;
    const zones = [[session, largeur]];
    if (dt) zones.push([dt.session, px.w - largeur]);
    for (const [s, w] of zones) {
        await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: hauteur, deviceScaleFactor: 1, mobile: false }, s);
        await cdp('Page.stopScreencast', {}, s);
        await cdp('Page.startScreencast', { format: 'png', maxWidth: w, maxHeight: hauteur, everyNthFrame: 1 }, s);
    }
}
let redimEnCours = false;
let redimAFaire = false;
async function redimensionner() {
    if (redimEnCours) { redimAFaire = true; return; }
    redimEnCours = true;
    try { do { redimAFaire = false; await dimensionner(false); } while (redimAFaire); } finally { redimEnCours = false; }
}

// ---------- 5. onglets
async function preparer(targetId) {
    const s = (await cdp('Target.attachToTarget', { targetId, flatten: true })).sessionId;
    const o = { cible: targetId, session: s, titre: '', adresse: '' };
    onglets.push(o);
    if (journal) for (const d of ['Network.enable', 'Runtime.enable', 'Log.enable']) await cdp(d, {}, s);
    await cdp('Page.enable', {}, s);
    await cdp('Page.setInterceptFileChooserDialog', { enabled: true }, s);
    // s'annoncer comme un Chrome normal : en "HeadlessChrome", beaucoup de sites servent une autre page
    await cdp('Emulation.setUserAgentOverride', { userAgent: ua }, s);
    // page au premier plan et active : survols, focus et animations comme dans une vraie fenetre
    await cdp('Emulation.setFocusEmulationEnabled', { enabled: true }, s);
    if (zoom !== 1) await appliquerZoom(cdp, o, zoom);
    return o;
}
async function activer(i) {
    if (i < 0 || i >= onglets.length) return;
    const avecDt = !!dt;
    if (i !== actuel) {
        if (avecDt) await devtools();  // les DevTools suivent l'onglet affiche
        if (session) await cdp('Page.stopScreencast', {}, session);
    }
    actuel = i;
    ({ session, cible } = onglets[i]);
    ecrire(`${ESC}_Ga=d,d=I,i=1,q=2${ESC}\\${ESC}_Ga=d,d=I,i=2,q=2${ESC}\\`);
    imageActive.page = 0;
    await dimensionner(false);
    barre();
    memoriser();
    if (avecDt && !dt) await devtools();
}
async function nouvelOnglet(url, montrerLe = true) {
    const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
    const o = await preparer(targetId);
    if (url) cdp('Page.navigate', { url: versAdresse(url) }, o.session);
    if (!montrerLe) return barre();
    await activer(onglets.length - 1);
    if (!url) saisieAdresse();
}
const naviguer = (t) => page('Page.navigate', { url: versAdresse(t) });
async function historique(sens) {
    const h = await page('Page.getNavigationHistory');
    const e = h.entries?.[h.currentIndex + sens];
    if (e) page('Page.navigateToHistoryEntry', { entryId: e.id });
}

// F12 : les vrais DevTools de Chrome (page devtools://, ouverte dans le meme Chrome sans
// fenetre), branches sur l'onglet affiche par le relais local de pont-devtools.mjs.
let pont = null;
let bascule = false;
let ouvreDt = false;  // message dans la barre pendant l'ouverture
async function devtools() {
    if (bascule) return;
    bascule = true;
    try {
        if (dt) {
            const d = dt;
            dt = null;
            focus = 'page';
            ouvreDt = false;
            pont.deconnecter();
            await cdp('Target.closeTarget', { targetId: d.cible });
            ecrire(`${ESC}_Ga=d,d=I,i=3,q=2${ESC}\\${ESC}_Ga=d,d=I,i=4,q=2${ESC}\\`);
            imageActive.dt = 0;
        } else {
            ouvreDt = true;  // le premier chargement des DevTools prend quelques secondes
            barre();
            pont ??= await ouvrirPont(async (envoyer) => {
                const { sessionId } = await cdp('Target.attachToTarget', { targetId: cible, flatten: true });
                relais.set(sessionId, (m) => { delete m.sessionId; envoyer(JSON.stringify(m)); });
                return {
                    recevoir: (t) => { const m = JSON.parse(t); m.sessionId = sessionId; brut(m); },
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
    } catch { ouvreDt = false; } finally { bascule = false; barre(); }
}

// ---------- 6. presse-papiers, recherche, zoom, envoi de fichiers
async function copier() {
    const r = await actif('Runtime.evaluate', { expression: SELECTION, returnByValue: true });
    const t = r.result?.value || '';
    if (!t) return envoyerTouche('c', 67, null, 2);
    ecrire(`${ESC}]52;c;${Buffer.from(t).toString('base64')}\x07`);  // presse-papiers via kitty
    montrer(`Copié (${t.length} caractères)`);
}
function coller() {
    const xclip = trouver('xclip');
    if (!xclip) return montrer('Coller : Ctrl+Maj+V');
    execFile(xclip, ['-o', '-selection', 'clipboard'], { timeout: 2000 }, (e, t) => { if (!e && t) texte(t); });
}
function rechercher() {
    saisie = {
        invite: 'Rechercher : ', texte: '', libre: true, garder: true,
        valider: async (t) => {
            if (!t) return;
            const r = await page('Runtime.evaluate', { expression: `window.find(${JSON.stringify(t)}, false, false, true)`, returnByValue: true });
            if (saisie) { saisie.invite = r.result?.value ? 'Rechercher (Entrée : suivant) : ' : 'Rechercher (introuvable) : '; barre(); }
        },
    };
    barre();
}
// F11 : page sur tout le terminal, fenetre kitty en plein ecran (wmctrl, X11)
function immersion() {
    immersif = !immersif;
    const wmctrl = trouver('wmctrl');
    if (wmctrl && process.env.WINDOWID) execFile(wmctrl, ['-i', '-r', process.env.WINDOWID, '-b', `${immersif ? 'add' : 'remove'},fullscreen`], () => {});
    ecrire(`${ESC}[2J`);
    redimensionner();
    barre();
}
function zoomer(sens) {
    const i = ZOOMS.indexOf(zoom);
    zoom = sens === 0 ? 1 : ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, i + sens))];
    for (const o of onglets) appliquerZoom(cdp, o, zoom);
    barre();
}
// <input type=file> : yazi en plein terminal pour choisir, puis retour a la page
function choisirFichiers(p, s) {
    const yazi = trouver('yazi');
    if (!yazi || !p.backendNodeId) return montrer('Envoi de fichier : yazi introuvable');
    ecrire(SORTIR);
    process.stdin.setRawMode(false);
    process.stdin.pause();
    const fichiers = choisirAvecYazi(yazi, path.join(ETAT, `choix-${process.pid}`), p.mode !== 'selectSingle');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    ecrire(ENTRER);
    imageActive.page = imageActive.dt = 0;
    oublierCurseur();
    if (fichiers.length) cdp('DOM.setFileInputFiles', { files: fichiers, backendNodeId: p.backendNodeId }, s);
    redimensionner();
    barre();
}

// ---------- 7. souris (coordonnees en pixels, mode 1016)
let dernierClic = { t: 0, x: 0, y: 0, n: 0 };
let glisse = false;  // separation page / DevTools : on la saisit a +-4 pixels et on la tire
const { poserCurseur, suivreCurseur, oublierCurseur } = creerCurseur(cdp);

function souris(b, x, y, relache) {
    let px = x - 1;
    const py = y - 1 - decalage;
    const surSeparation = dt && py >= 0 && Math.abs(px - largeur) <= 4;
    if (dt && (glisse || (!relache && b === 0 && surSeparation))) {
        glisse = !relache;
        if ((b & 32) || relache) { partPage = Math.min(0.85, Math.max(0.15, px / pixels.w)); redimensionner(); }
        return;
    }
    if (py < 0) {  // barre : onglet cliquable, sinon saisie d'adresse (pas pendant un dialogue)
        poserCurseur('default');
        if (relache || b !== 0 || saisie?.annuler) return;
        const col = Math.floor(px / (pixels.w / process.stdout.columns));
        const z = zonesOnglets.find((q) => col >= q.debut && col < q.fin);
        if (z) activer(z.i); else saisieAdresse();
        return;
    }
    if (surSeparation && (b & 32)) return poserCurseur('ew-resize');
    let zone = session;
    if (dt && px >= largeur) { zone = dt.session; px -= largeur; }
    if (!relache && !(b & 32) && !(b & 64)) focus = zone === session ? 'page' : 'dt';
    const vers = (method, params) => cdp(method, params, zone);
    const modifiers = (b & 8 ? 1 : 0) | (b & 16 ? 2 : 0) | (b & 4 ? 8 : 0);
    if (b & 64) {
        vers('Input.dispatchMouseEvent', { type: 'mouseWheel', x: px, y: py, deltaX: 0, deltaY: (b & 1) ? 120 : -120, modifiers });
        return;
    }
    const bouton = ['left', 'middle', 'right', 'none'][b & 3];
    const buttons = { left: 1, right: 2, middle: 4, none: 0 }[bouton];
    if (b & 32) {
        vers('Input.dispatchMouseEvent', { type: 'mouseMoved', x: px, y: py, button: bouton, buttons, modifiers });
        if (bouton === 'none') suivreCurseur(zone, px, py);
        return;
    }
    if (!relache) {
        const t = Date.now();
        const proche = t - dernierClic.t < 400 && Math.abs(px - dernierClic.x) < 5 && Math.abs(py - dernierClic.y) < 5;
        dernierClic = { t, x: px, y: py, n: proche ? dernierClic.n + 1 : 1 };
    }
    vers('Input.dispatchMouseEvent', {
        type: relache ? 'mouseReleased' : 'mousePressed', x: px, y: py, button: bouton, buttons, clickCount: dernierClic.n, modifiers,
    });
}

// ---------- 8. clavier
function envoyerTouche(key, keyCode, texteTouche, modifiers = 0) {
    const code = key.length === 1 ? `Key${key.toUpperCase()}` : key;
    actif('Input.dispatchKeyEvent', { type: texteTouche ? 'keyDown' : 'rawKeyDown', key, code, windowsVirtualKeyCode: keyCode, modifiers, ...(texteTouche && { text: texteTouche }) });
    actif('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, modifiers });
}

function touche(seq) {
    if (saisie) {  // saisie dans la barre : adresse, recherche, reponse a un dialogue
        const z = saisie;
        if (seq === '\r') { if (!z.garder) saisie = null; z.valider(z.texte); }
        else if (seq === '\x1b') { saisie = null; z.annuler?.(); }
        else if (z.libre && (seq === '\x7f' || seq === '\b')) z.texte = z.texte.slice(0, -1);
        else if (seq === '\x16') return coller();
        return barre();
    }
    const raccourcis = {
        '\x11': () => quitter(0, true),                  // Ctrl+Q
        '\x0c': saisieAdresse,                           // Ctrl+L
        '\x14': () => nouvelOnglet(''),                  // Ctrl+T
        '\x17': () => cdp('Target.closeTarget', { targetId: cible }),  // Ctrl+W
        '\x1b[6;3~': () => activer((actuel + 1) % onglets.length),     // Alt+Page suivante
        '\x1b[5;3~': () => activer((actuel + onglets.length - 1) % onglets.length),
        '\x03': copier,                                  // Ctrl+C
        '\x16': coller,                                  // Ctrl+V
        '\x1b[15~': () => page('Page.reload'), '\x12': () => page('Page.reload'),  // F5, Ctrl+R
        '\x1b[24~': devtools,                            // F12
        '\x1b[23~': immersion,                           // F11
        '\x1b[1;3D': () => historique(-1),               // Alt+Gauche
        '\x1b[1;3C': () => historique(1),                // Alt+Droite
        '\x1b=': () => zoomer(1), '\x1b+': () => zoomer(1), '\x1b-': () => zoomer(-1), '\x1b0': () => zoomer(0),
        '\x1b[Z': () => envoyerTouche('Tab', 9, null, 8),  // Maj+Tab
    };
    if (seq === '\x06' && focus === 'page') return rechercher();  // Ctrl+F (dans les DevTools : leur recherche)
    if (raccourcis[seq]) return raccourcis[seq]();
    if (TOUCHES[seq]) { const [k, c, t] = TOUCHES[seq]; return envoyerTouche(k, c, t); }
    const c = seq.charCodeAt(0);
    if (seq.length === 1 && c >= 1 && c <= 26) return envoyerTouche(String.fromCharCode(c + 96), c + 64, null, 2);  // Ctrl+lettre
    if (seq.length === 2 && seq[0] === ESC) { envoyerTouche('Escape', 27); texte(seq[1]); }  // Echap puis lettre
}

function texte(t) {
    if (saisie) { if (saisie.libre) { saisie.texte += t.replace(/[\r\n]+/g, ' '); barre(); } return; }
    actif('Input.insertText', { text: t });
}

// ---------- 9. demarrage
ecrire(ENTRER);
process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
let entree = '';
const reponse = (w, h) => { if (reponsePixels) { const r = reponsePixels; reponsePixels = null; r({ w, h }); } };
process.stdin.on('data', (d) => { entree = decouper(entree + d, { pixels: reponse, souris, texte, touche }); });

const { targetInfos = [] } = await cdp('Target.getTargets');
etape('chrome pret');
const premiere = targetInfos.find((t) => t.type === 'page');
if (!premiere) quitter(1);
ua = ((await cdp('Browser.getVersion')).userAgent || '').replace('HeadlessChrome', 'Chrome');
await brancherTelechargements(cdp, ecoutes, montrer);
// diagnostic a la demande : POSTE_CHROME_JOURNAL=1 poste-chrome ... -> journal.log
const journal = process.env.POSTE_CHROME_JOURNAL ? path.join(ETAT, 'journal.log') : null;
const noter = (t) => { if (journal) fs.appendFileSync(journal, `${Date.now() - t0} ms  ${t}\n`); };
if (journal) {
    fs.writeFileSync(journal, '');
    brancherJournal(ecoutes, noter);
}
ecoutes['Page.loadEventFired'] = (p, s) => {
    if (dt && s === dt.session) { noter('DevTools charges'); ouvreDt = false; barre(); }  // retire le message
    else noter('chargement termine (load)');
};
let images = 0;
ecoutes['Page.screencastFrame'] = (p, s) => {
    cdp('Page.screencastFrameAck', { sessionId: p.sessionId }, s);
    const zone = s === session ? 'page' : dt && s === dt.session ? 'dt' : null;
    if (!zone) return;  // onglet en arriere-plan
    if (!imageActive.page) etape('premiere image');
    noter(`image ${zone} n°${++images} (${Math.round(p.data.length / 1024)} Ko)`);
    afficher(p.data, zone, zone === 'dt' ? colonnesPage + 1 : 1, immersif ? 1 : 2);
};
ecoutes['Target.targetInfoChanged'] = ({ targetInfo: t }) => {
    const o = onglets.find((x) => x.cible === t.targetId);
    if (!o) return;
    o.titre = t.title;
    o.adresse = t.url;
    barre();
    memoriser();
};
// lien ou fenetre ouverts par une page : nouvel onglet affiche
ecoutes['Target.targetCreated'] = async ({ targetInfo: t }) => {
    if (t.type !== 'page' || !t.openerId || onglets.some((o) => o.cible === t.targetId)) return;
    await preparer(t.targetId);
    activer(onglets.length - 1);
};
ecoutes['Target.targetDestroyed'] = ({ targetId }) => {
    const i = onglets.findIndex((o) => o.cible === targetId);
    if (i < 0) return;
    const etaitActif = i === actuel;
    onglets.splice(i, 1);
    if (!onglets.length) return quitter(0, true);
    if (i < actuel) actuel--;
    if (etaitActif) { actuel = -1; session = null; activer(Math.min(i, onglets.length - 1)); }
    else { barre(); memoriser(); }
};
// alert / confirm / prompt / quitter la page : sans reponse, la page reste bloquee
ecoutes['Page.javascriptDialogOpening'] = async (p, s) => {
    const i = onglets.findIndex((o) => o.session === s);
    if (i < 0) return;
    if (i !== actuel) await activer(i);
    const libre = p.type === 'prompt';
    const message = p.type === 'beforeunload' ? 'Quitter cette page ?' : p.message.replace(/\s+/g, ' ');
    saisie = {
        invite: libre ? `${message} › ` : `${message}   [Entrée : OK · Échap : annuler]`, texte: libre ? (p.defaultPrompt || '') : '', libre,
        valider: (t) => cdp('Page.handleJavaScriptDialog', { accept: true, promptText: t }, s),
        annuler: () => cdp('Page.handleJavaScriptDialog', { accept: false }, s),
    };
    barre();
};
ecoutes['Page.fileChooserOpened'] = choisirFichiers;
await cdp('Target.setDiscoverTargets', { discover: true });
// Chrome sans fenetre ne signale pas les changements de titre : on les relit
setInterval(async () => {
    const { targetInfos: cibles = [] } = await cdp('Target.getTargets');
    let change = false;
    for (const o of onglets) {
        const t = cibles.find((x) => x.targetId === o.cible);
        if (t && t.title !== o.titre) { o.titre = t.title; change = true; }
    }
    if (change) barre();
}, 2000).unref();
await preparer(premiere.targetId);
await activer(0);
process.stdout.on('resize', async () => { ecrire(`${ESC}[2J`); await dimensionner(); barre(); });
if (demandes.length) {
    naviguer(demandes[0]);
    for (const u of demandes.slice(1)) await nouvelOnglet(u, false);
    if (actifRestaure) activer(actifRestaure);
} else saisieAdresse();
