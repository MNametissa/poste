// Pieces sans etat de chrome.mjs.
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const AIDE = 'Ctrl+T/W onglets  Ctrl+L  Ctrl+F  F11  F12  Ctrl+Q';
export const ZOOMS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

// adresse, domaine nu ou recherche Google
export function versAdresse(t) {
    t = t.trim();
    if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return t;
    if (!/\s/.test(t) && /\.[a-z]{2,}(\/|:|$)/i.test(t)) return 'https://' + t;
    return 'https://www.google.com/search?q=' + encodeURIComponent(t);
}

// sequence du terminal -> [key, keyCode, texte] pour Input.dispatchKeyEvent
export const TOUCHES = {
    '\r': ['Enter', 13, '\r'], '\x7f': ['Backspace', 8], '\b': ['Backspace', 8], '\t': ['Tab', 9],
    '\x1b': ['Escape', 27], '\x1b[A': ['ArrowUp', 38], '\x1b[B': ['ArrowDown', 40], '\x1b[C': ['ArrowRight', 39],
    '\x1b[D': ['ArrowLeft', 37], '\x1bOA': ['ArrowUp', 38], '\x1bOB': ['ArrowDown', 40], '\x1bOC': ['ArrowRight', 39],
    '\x1bOD': ['ArrowLeft', 37], '\x1b[3~': ['Delete', 46], '\x1b[H': ['Home', 36], '\x1b[F': ['End', 35],
    '\x1b[1~': ['Home', 36], '\x1b[4~': ['End', 35], '\x1b[5~': ['PageUp', 33], '\x1b[6~': ['PageDown', 34],
};

// texte selectionne : dans un champ de saisie, sinon dans la page
export const SELECTION = `(() => {
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.selectionStart !== a.selectionEnd) return a.value.slice(a.selectionStart, a.selectionEnd);
    return String(getSelection());
})()`;

// forme du pointeur (nom CSS, compris par kitty) pour l'element sous (x, y)
export const FORME = `(x, y) => {
    let e = document.elementFromPoint(x, y);
    while (e && e.shadowRoot) { const f = e.shadowRoot.elementFromPoint(x, y); if (!f || f === e) break; e = f; }
    if (!e) return 'default';
    const c = getComputedStyle(e).cursor;
    if (c && c !== 'auto') return c.split(',').pop().trim();
    if (e.closest('a[href]')) return 'pointer';
    if (e.isContentEditable || /^(INPUT|TEXTAREA)$/.test(e.tagName)) return 'text';
    return 'default';
}`;

const ESC = '\x1b';
const ecrire = (s) => process.stdout.write(s);

// Image PNG de la page, sous la barre, sans clignotement :
// - mise a jour synchronisee (?2026) : kitty n'affiche rien avant la fin de l'envoi ;
// - sous les cases a fond colore (z) : en mode immersif la barre s'affiche par-dessus ;
// - double tampon : la nouvelle image (page 1 ou 2, DevTools 3 ou 4) est posee, puis seulement l'ancienne effacee.
export const imageActive = { page: 0, dt: 0 };
export function afficher(b64, zone, colonne, ligne) {
    const base = zone === 'dt' ? 3 : 1;
    const ancienne = imageActive[zone];
    const nouvelle = ancienne === base ? base + 1 : base;
    let s = `${ESC}[?2026h${ESC}7${ESC}[${ligne};${colonne}H`;
    for (let i = 0; i < b64.length; i += 4096) {
        const plus = i + 4096 < b64.length ? 1 : 0;
        const bout = b64.slice(i, i + 4096);
        s += i === 0 ? `${ESC}_Ga=T,f=100,i=${nouvelle},p=1,q=2,C=1,z=-1073741825,m=${plus};${bout}${ESC}\\` : `${ESC}_Gm=${plus};${bout}${ESC}\\`;
    }
    s += `${ESC}8`;
    if (ancienne) s += `${ESC}_Ga=d,d=I,i=${ancienne},q=2${ESC}\\`;
    imageActive[zone] = nouvelle;
    ecrire(s + `${ESC}[?2026l`);
}

// decoupe ce que le terminal envoie ; renvoie le reste incomplet
export function decouper(entree, { pixels, souris, texte, touche }) {
    while (entree.length) {
        let m;
        if ((m = entree.match(/^\x1b\[4;(\d+);(\d+)t/))) { pixels(+m[2], +m[1]); }
        else if ((m = entree.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])/))) souris(+m[1], +m[2], +m[3], m[4] === 'm');
        else if (entree.startsWith('\x1b[200~')) {
            const fin = entree.indexOf('\x1b[201~');
            if (fin < 0) return entree;
            texte(entree.slice(6, fin));
            m = [entree.slice(0, fin + 6)];
        }
        else if (/^\x1b(\[[0-9;<]*)?$/.test(entree) && entree.length > 1) return entree;  // sequence incomplete
        else if ((m = entree.match(/^\x1b\[[0-9;]*[A-Za-z~]|^\x1bO[A-Za-z]/))) touche(m[0]);
        else if ((m = entree.match(/^\x1b[^[O\x00-\x1f\x7f]/))) touche(m[0]);  // Alt+caractere
        else if ((m = entree.match(/^[^\x00-\x1f\x7f]+/))) texte(m[0]);
        else { m = [entree[0]]; touche(m[0]); }
        entree = entree.slice(m[0].length);
    }
    return '';
}

// barre du haut : morceaux [texte, fond "r;g;b"] tronques a la largeur, aide grisee a droite
export const FOND = '28;28;28';
export function dessinerBarre(morceaux, aide, cols) {
    let s = '';
    let reste = Math.max(0, cols - aide.length);
    for (const [t, fond] of morceaux) {
        if (reste <= 0) break;
        const u = t.length > reste ? t.slice(0, reste - 1) + '…' : t;
        s += `${ESC}[48;2;${fond}m${ESC}[38;2;230;230;230m${u}`;
        reste -= u.length;
    }
    s += `${ESC}[48;2;${FOND}m${' '.repeat(reste)}`;
    ecrire(`${ESC}7${ESC}[1;1H${s}${ESC}[38;2;120;120;120m${aide.slice(0, cols)}${ESC}[0m${ESC}8`);
}

// forme du pointeur (OSC 22 de kitty) d'apres l'element sous la souris, au plus toutes les 80 ms
export function creerCurseur(cdp) {
    let curseur = '';
    let minuteur = null;
    let pos = null;
    let enCours = false;
    const poserCurseur = (c) => { if (c !== curseur) { curseur = c; ecrire(`${ESC}]22;${c}${ESC}\\`); } };
    const suivreCurseur = (zone, x, y) => {
        pos = { zone, x, y };
        if (minuteur || enCours) return;
        minuteur = setTimeout(async () => {
            minuteur = null;
            enCours = true;
            const r = await cdp('Runtime.evaluate', { expression: `(${FORME})(${pos.x}, ${pos.y})`, returnByValue: true }, pos.zone);
            enCours = false;
            poserCurseur(r.result?.value || 'default');
        }, 80);
    };
    return { poserCurseur, suivreCurseur, oublierCurseur: () => { curseur = ''; } };
}

// zoom : propriete CSS zoom sur la racine (les images du screencast restent en pixels CSS,
// un reglage de densite n'y change rien, mesure) ; reappliquee a chaque nouvelle page
export async function appliquerZoom(cdp, o, zoom) {
    if (o.zoomScript) await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: o.zoomScript }, o.session);
    o.zoomScript = null;
    const poser = `document.documentElement.style.zoom = ${zoom === 1 ? "''" : zoom}`;
    if (zoom !== 1) {
        const source = `new MutationObserver((_, ob) => { if (document.documentElement) { ${poser}; ob.disconnect(); } }).observe(document, { childList: true })`;
        o.zoomScript = (await cdp('Page.addScriptToEvaluateOnNewDocument', { source }, o.session)).identifier;
    }
    cdp('Runtime.evaluate', { expression: `document.documentElement && (${poser})` }, o.session);
}

// diagnostic (POSTE_CHROME_JOURNAL=1) : navigations, requetes en echec, erreurs
export function brancherJournal(ecoutes, noter) {
    const enCours = new Map();  // requetes sans reponse complete : la piste des pages qui ne finissent pas
    ecoutes['Network.requestWillBeSent'] = (p) => enCours.set(p.requestId, `${p.type || '?'} ${p.request.url.slice(0, 100)}`);
    ecoutes['Network.loadingFinished'] = (p) => enCours.delete(p.requestId);
    setInterval(() => { if (enCours.size) noter(`en attente (${enCours.size}) : ${[...enCours.values()].slice(0, 6).join(' | ')}`); }, 5000).unref();
    ecoutes['Page.frameNavigated'] = ({ frame }) => { if (!frame.parentId) noter(`page : ${frame.url.slice(0, 80)}`); };
    ecoutes['Network.loadingFailed'] = (p) => { noter(`requete echouee : ${p.errorText} ${p.blockedReason || ''} ${enCours.get(p.requestId) || p.type || ''}`); enCours.delete(p.requestId); };
    ecoutes['Network.responseReceived'] = (p) => { if (p.response.status >= 400) noter(`HTTP ${p.response.status} ${p.response.url.slice(0, 120)}`); };
    ecoutes['Runtime.exceptionThrown'] = (p) => noter(`erreur JS : ${(p.exceptionDetails.exception?.description || p.exceptionDetails.text).slice(0, 200)}`);
    ecoutes['Log.entryAdded'] = ({ entry: e }) => { if (e.level === 'error') noter(`console : ${e.text.slice(0, 200)}`); };
}

// telechargements dans le dossier Telechargements de l'utilisateur, annonces dans la barre
export async function brancherTelechargements(cdp, ecoutes, montrer) {
    let dossier = path.join(os.homedir(), 'Téléchargements');
    try { dossier = execFileSync('xdg-user-dir', ['DOWNLOAD'], { encoding: 'utf8' }).trim() || dossier; } catch { /* defaut */ }
    await cdp('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dossier, eventsEnabled: true });
    const noms = new Map();
    ecoutes['Browser.downloadWillBegin'] = (p) => { noms.set(p.guid, p.suggestedFilename); montrer(`Téléchargement : ${p.suggestedFilename}…`); };
    ecoutes['Browser.downloadProgress'] = (p) => {
        if (p.state === 'completed') montrer(`Téléchargé : ${noms.get(p.guid)} → ${dossier}`);
        else if (p.state === 'canceled') montrer(`Téléchargement annulé : ${noms.get(p.guid)}`);
    };
}

// <input type=file> : yazi en plein terminal (appele terminal suspendu) -> chemins choisis
export function choisirAvecYazi(yazi, fichierChoix, multiple) {
    spawnSync(yazi, [`--chooser-file=${fichierChoix}`, os.homedir()], { stdio: 'inherit' });
    let fichiers = [];
    try { fichiers = fs.readFileSync(fichierChoix, 'utf8').split('\n').filter(Boolean); fs.rmSync(fichierChoix); } catch { /* rien choisi */ }
    return multiple ? fichiers : fichiers.slice(0, 1);
}
