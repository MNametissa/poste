// Navigateur et profil pour chrome.mjs.
// Chrome >= 136 refuse d'etre pilote sur son dossier de profils d'origine : on travaille sur
// une copie. Copie PERMANENTE (profil-<nom>) pour garder les connexions faites dans le terminal ;
// a chaque ouverture, les cookies du vrai Chrome y sont fusionnes (le plus recent gagne) et
// mots de passe, formulaires, favoris sont repris. Si la copie permanente est deja utilisee
// par un autre navigateur du terminal, copie TEMPORAIRE (session-<pid>), effacee a la fermeture.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
export const ETAT = path.join(HOME, '.local/state/poste/chrome');

const NAVIGATEURS = [
    ['google-chrome-stable', '.config/google-chrome'],
    ['google-chrome', '.config/google-chrome'],
    ['brave-browser', '.config/BraveSoftware/Brave-Browser'],
    ['chromium', '.config/chromium'],
    ['chromium-browser', '.config/chromium'],
];

export function trouver(bin) {
    for (const d of (process.env.PATH || '/usr/bin').split(':')) {
        const p = path.join(d, bin);
        try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* suivant */ }
    }
    return null;
}

const vivant = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// Chrome pose SingletonLock -> "machine-pid" dans le dossier qu'il utilise
function verrouille(dossier) {
    try { return vivant(Number(fs.readlinkSync(path.join(dossier, 'SingletonLock')).split('-').pop())); } catch { return false; }
}

// copie coherente d'une base SQLite ouverte par Chrome (immutable : base verrouillee)
function sauvegarder(source, cible) {
    fs.mkdirSync(path.dirname(cible), { recursive: true });
    for (const mode of ['mode=ro', 'mode=ro&immutable=1']) {
        try { execFileSync('sqlite3', [`file:${source}?${mode}`, `.backup '${cible}'`], { stdio: 'ignore', timeout: 15000 }); return true; } catch { /* essai suivant */ }
    }
    return false;
}

// cookies du vrai Chrome -> copie du terminal, sauf si la copie a une version plus recente
export function fusionnerCookies(source, cible) {
    const importe = cible + '.import';
    if (!sauvegarder(source, importe)) return;
    const cle = ['host_key', 'top_frame_site_key', 'has_cross_site_ancestor', 'name', 'path', 'source_scheme', 'source_port'];
    const egal = cle.map((c) => `m.${c} = v.${c}`).join(' AND ');
    try {
        execFileSync('sqlite3', [cible, `ATTACH '${importe}' AS i; INSERT OR REPLACE INTO main.cookies SELECT * FROM i.cookies AS v
            WHERE NOT EXISTS (SELECT 1 FROM main.cookies AS m WHERE ${egal} AND m.last_update_utc >= v.last_update_utc);`],
        { stdio: 'ignore', timeout: 15000 });
    } catch { /* schema different : on garde les cookies du terminal */ }
    fs.rmSync(importe, { force: true });
}

function copier(src, dst, complet) {
    fs.mkdirSync(dst, { recursive: true, mode: 0o700 });
    const fichiers = complet ? ['Preferences', 'Secure Preferences', 'Bookmarks'] : ['Bookmarks'];
    for (const f of fichiers) if (fs.existsSync(path.join(src, f))) fs.copyFileSync(path.join(src, f), path.join(dst, f));
    for (const db of ['Cookies', 'Network/Cookies', 'Login Data', 'Web Data']) {
        const s = path.join(src, db);
        if (!fs.existsSync(s)) continue;
        if (complet || !db.endsWith('Cookies') || !fs.existsSync(path.join(dst, db))) sauvegarder(s, path.join(dst, db));
        else fusionnerCookies(s, path.join(dst, db));
    }
    if (complet && fs.existsSync(path.join(src, 'Local Storage'))) {
        fs.cpSync(path.join(src, 'Local Storage'), path.join(dst, 'Local Storage'), { recursive: true });
    }
}

// -> { bin, dossier, profil, temporaire }
export function preparerProfil(nomProfil = 'Default', actualiser = false) {
    let nav = null;
    for (const [bin, conf] of NAVIGATEURS) {
        const p = trouver(bin);
        if (p && fs.existsSync(path.join(HOME, conf, 'Local State'))) { nav = { bin: p, source: path.join(HOME, conf) }; break; }
    }
    if (!nav) throw new Error('Aucun Google Chrome, Brave ou Chromium avec un profil trouve.');
    const infos = JSON.parse(fs.readFileSync(path.join(nav.source, 'Local State'), 'utf8')).profile?.info_cache || {};
    const profil = infos[nomProfil] ? nomProfil
        : (Object.entries(infos).find(([, v]) => v.name === nomProfil) || ['Default'])[0];

    fs.mkdirSync(ETAT, { recursive: true, mode: 0o700 });
    fs.chmodSync(ETAT, 0o700);
    for (const d of fs.readdirSync(ETAT)) {  // copies temporaires laissees par un plantage
        if (d.startsWith('session-') && !vivant(Number(d.slice(8)))) fs.rmSync(path.join(ETAT, d), { recursive: true, force: true });
    }
    const permanent = path.join(ETAT, `profil-${profil}`);
    const temporaire = verrouille(permanent);
    const dossier = temporaire ? path.join(ETAT, `session-${process.pid}`) : permanent;
    const source = path.join(nav.source, profil);
    if (temporaire && fs.existsSync(path.join(permanent, profil, 'Preferences'))) {
        // second navigateur : copie du profil du terminal (ses connexions), puis cookies du vrai Chrome
        fs.mkdirSync(dossier, { recursive: true, mode: 0o700 });
        fs.copyFileSync(path.join(permanent, 'Local State'), path.join(dossier, 'Local State'));
        copier(path.join(permanent, profil), path.join(dossier, profil), true);
        copier(source, path.join(dossier, profil), false);
        return { bin: nav.bin, dossier, profil, temporaire };
    }
    const complet = temporaire || actualiser || !fs.existsSync(path.join(dossier, profil, 'Preferences'));
    if (complet) {
        fs.rmSync(dossier, { recursive: true, force: true });
        fs.mkdirSync(dossier, { recursive: true, mode: 0o700 });
        fs.copyFileSync(path.join(nav.source, 'Local State'), path.join(dossier, 'Local State'));
    }
    copier(source, path.join(dossier, profil), complet);
    return { bin: nav.bin, dossier, profil, temporaire };
}
