// Relais WebSocket minimal entre l'interface DevTools (page devtools://) et Chrome
// pilote par canal prive : 127.0.0.1 seulement, port au hasard, chemin secret,
// origine devtools://devtools exigee, un seul client a la fois.
import http from 'node:http';
import crypto from 'node:crypto';

// brancher(envoyer) -> Promise<{ recevoir(texte), fermer() }>
export async function ouvrirPont(brancher) {
    const jeton = crypto.randomBytes(16).toString('hex');
    const serveur = http.createServer((_, res) => { res.writeHead(404); res.end(); });
    let actif = null;

    serveur.on('upgrade', async (req, sock) => {
        const cle = req.headers['sec-websocket-key'];
        if (req.url !== `/${jeton}` || req.headers.origin !== 'devtools://devtools' || !cle || actif) return sock.destroy();
        const accepte = crypto.createHash('sha1').update(cle + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
        sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accepte}\r\n\r\n`);
        sock.setNoDelay(true);
        const trame = (op, charge) => {
            const n = charge.length;
            let tete;
            if (n < 126) tete = Buffer.from([0x80 | op, n]);
            else if (n < 65536) tete = Buffer.from([0x80 | op, 126, n >> 8, n & 255]);
            else { tete = Buffer.alloc(10); tete[0] = 0x80 | op; tete[1] = 127; tete.writeBigUInt64BE(BigInt(n), 2); }
            if (!sock.destroyed) sock.write(Buffer.concat([tete, charge]));
        };
        actif = { sock };
        const lien = await brancher((texte) => trame(1, Buffer.from(texte)));
        let tampon = Buffer.alloc(0);
        let morceaux = [];
        sock.on('data', (b) => {
            tampon = Buffer.concat([tampon, b]);
            for (;;) {
                if (tampon.length < 2) return;
                const fin = tampon[0] & 0x80, op = tampon[0] & 15;
                let n = tampon[1] & 127, pos = 2;
                if (n === 126) { if (tampon.length < 4) return; n = tampon.readUInt16BE(2); pos = 4; }
                else if (n === 127) { if (tampon.length < 10) return; n = Number(tampon.readBigUInt64BE(2)); pos = 10; }
                const masque = tampon[1] & 0x80 ? 4 : 0;
                if (tampon.length < pos + masque + n) return;
                const charge = Buffer.from(tampon.subarray(pos + masque, pos + masque + n));
                if (masque) for (let i = 0; i < n; i++) charge[i] ^= tampon[pos + (i & 3)];
                tampon = tampon.subarray(pos + masque + n);
                if (op === 8) { trame(8, Buffer.alloc(0)); sock.end(); return; }
                if (op === 9) { trame(10, charge); continue; }
                if (op === 1 || op === 0) {
                    morceaux.push(charge);
                    if (fin) { lien.recevoir(Buffer.concat(morceaux).toString('utf8')); morceaux = []; }
                }
            }
        });
        sock.on('close', () => { if (actif?.sock === sock) { actif = null; lien.fermer(); } });
        sock.on('error', () => sock.destroy());
    });

    await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
    return {
        adresse: `127.0.0.1:${serveur.address().port}/${jeton}`,
        deconnecter: () => actif?.sock.destroy(),
    };
}
