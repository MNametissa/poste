// Chrome sans fenetre pilote par canal prive (--remote-debugging-pipe : descripteurs 3 et 4,
// messages JSON termines par un octet nul) : aucun port reseau ouvert.
import { spawn } from 'node:child_process';

export function lancerChrome(prof) {
    const chrome = spawn(prof.bin, [
        '--headless=new', `--user-data-dir=${prof.dossier}`, `--profile-directory=${prof.profil}`,
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
    // envoi brut d'un message deja forme (relais DevTools)
    const brut = (m) => versChrome.write(JSON.stringify(m) + '\0');
    return { chrome, cdp, ecoutes, relais, brut };
}
