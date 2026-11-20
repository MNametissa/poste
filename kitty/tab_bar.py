# Barre d'onglets du poste (tab_bar_style custom), chargee par kitty depuis
# ~/.config/kitty/tab_bar.py : les onglets powerline de kitty, puis a droite
# l'etat du poste en couleurs (duree d'allumage, charge, debit reseau, date,
# heure, batterie), rafraichi chaque seconde.
# Si ce code leve une erreur, kitty revient seul au style d'onglets par defaut.
# S'il manque de place apres les onglets, l'etat n'est pas affiche.
import glob
import time

from kitty.fast_data_types import add_timer, get_boss
from kitty.tab_bar import as_rgb, draw_tab_with_powerline

GRIS = 0x8a8a8a
SOMBRE = 0x444444
VERT = 0x9ece6a
JAUNE = 0xe0af68
ROUGE = 0xf7768e
CYAN = 0x7dcfff
VIOLET = 0xbb9af7
BLEU = 0x7aa2f7
BLANC = 0xffffff
SEP = ' │ '
JOURS = ('lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.')
MOIS = ('janv.', 'fevr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'aout', 'sept.', 'oct.', 'nov.', 'dec.')
_reseau = {'t': 0.0, 'rx': 0, 'tx': 0, 'down': 0, 'up': 0}
_cpu = {'total': 0, 'repos': 0, 'pct': 0}


def _lire(chemin: str) -> str:
    try:
        with open(chemin) as f:
            return f.read().strip()
    except OSError:
        return ''


def _duree(s: int) -> str:
    j, h, m = s // 86400, s % 86400 // 3600, s % 3600 // 60
    return f'{j}j {h}h' if j else f'{h}h {m:02d}m' if h else f'{m}m'


def _debit(o: int) -> str:
    if o >= 1048576:
        return f'{o / 1048576:.1f}M'
    return f'{o // 1024}K' if o >= 1024 else f'{o}B'


def _interface() -> str:  # interface de la route par defaut
    for ligne in _lire('/proc/net/route').splitlines()[1:]:
        champs = ligne.split()
        if len(champs) > 1 and champs[1] == '00000000':
            return champs[0]
    return 'lo'


def _maj_reseau() -> None:
    i = _interface()
    rx = int(_lire(f'/sys/class/net/{i}/statistics/rx_bytes') or 0)
    tx = int(_lire(f'/sys/class/net/{i}/statistics/tx_bytes') or 0)
    t = time.monotonic()
    dt = t - _reseau['t']
    if _reseau['t'] and dt > 0:
        _reseau['down'] = max(0, int((rx - _reseau['rx']) / dt))
        _reseau['up'] = max(0, int((tx - _reseau['tx']) / dt))
    _reseau.update(t=t, rx=rx, tx=tx)


def _maj_cpu() -> None:
    """% d'utilisation du processeur depuis la mesure precedente (/proc/stat)."""
    champs = (_lire('/proc/stat').splitlines() or ['cpu'])[0].split()[1:9]
    if len(champs) < 5:
        return
    valeurs = [int(v) for v in champs]
    total = sum(valeurs)
    repos = valeurs[3] + valeurs[4]  # idle + iowait
    dt, dr = total - _cpu['total'], repos - _cpu['repos']
    if _cpu['total'] and dt > 0:
        _cpu['pct'] = max(0, min(100, round(100 * (dt - dr) / dt)))
    _cpu.update(total=total, repos=repos)


def _ram() -> int:
    """% de memoire occupee (ce que le systeme peut recuperer compte comme libre)."""
    infos = dict(l.split(':', 1) for l in _lire('/proc/meminfo').splitlines() if ':' in l)
    try:
        total = int(infos['MemTotal'].split()[0])
        dispo = int(infos['MemAvailable'].split()[0])
    except (KeyError, ValueError, IndexError):
        return 0
    return round(100 * (total - dispo) / total) if total else 0


def _couleur(pct: int, jaune: int, rouge: int) -> int:
    return VERT if pct < jaune else JAUNE if pct < rouge else ROUGE


def _largeur(seg: list[tuple[str, int, bool, str]]) -> int:
    return sum(len(s[0]) for s in seg) + len(SEP) * max(0, len(seg) - 1) + 1


# quand la place manque, ces elements disparaissent dans cet ordre ;
# l'heure et la batterie restent toujours
SACRIFIES = ('duree', 'date', 'up', 'down', 'ram', 'cpu')


def _segments() -> list[tuple[str, int, bool, str]]:
    """(texte, couleur, gras, nom) de chaque element, de gauche a droite."""
    allume = int(float((_lire('/proc/uptime').split() or ['0'])[0]))
    ram = _ram()
    now = time.localtime()
    seg = [
        (_duree(allume), GRIS, False, 'duree'),
        (f'CPU {_cpu["pct"]}%', _couleur(_cpu['pct'], 50, 90), False, 'cpu'),
        (f'RAM {ram}%', _couleur(ram, 70, 90), False, 'ram'),
        (f'↓{_debit(_reseau["down"])}', CYAN, False, 'down'),
        (f'↑{_debit(_reseau["up"])}', VIOLET, False, 'up'),
        (f'{JOURS[now.tm_wday]} {now.tm_mday:02d} {MOIS[now.tm_mon - 1]}', BLEU, False, 'date'),
        (time.strftime('%H:%M', now), BLANC, True, 'heure'),
    ]
    for b in sorted(glob.glob('/sys/class/power_supply/BAT*')):
        c = _lire(f'{b}/capacity')
        if c.isdigit():
            n = int(c)
            charge = '+' if _lire(f'{b}/status') == 'Charging' else ''
            seg.append((f'{n}%{charge}', VERT if n > 50 else JAUNE if n >= 20 else ROUGE, False, 'batterie'))
            break
    return seg


def draw_tab(draw_data, screen, tab, before, max_tab_length, index, is_last, extra_data):
    fin = draw_tab_with_powerline(draw_data, screen, tab, before, max_tab_length, index, is_last, extra_data)
    if not is_last:
        return fin
    seg = _segments()
    place = screen.columns - screen.cursor.x - 2  # colonnes libres apres le dernier onglet
    for nom in SACRIFIES:
        if _largeur(seg) <= place:
            break
        seg = [s for s in seg if s[3] != nom]
    if _largeur(seg) > place:  # meme l'heure et la batterie ne tiennent pas
        return fin
    fg, bg, gras, italique = screen.cursor.fg, screen.cursor.bg, screen.cursor.bold, screen.cursor.italic
    screen.cursor.bg = as_rgb(int(draw_data.default_bg))
    screen.cursor.italic = False  # sinon l'etat herite de l'italique de l'onglet actif
    screen.cursor.x = screen.columns - _largeur(seg)
    for n, (texte, couleur, est_gras, _) in enumerate(seg):
        if n:
            screen.cursor.fg, screen.cursor.bold = as_rgb(SOMBRE), False
            screen.draw(SEP)
        screen.cursor.fg, screen.cursor.bold = as_rgb(couleur), est_gras
        screen.draw(texte)
    screen.cursor.fg, screen.cursor.bold = as_rgb(SOMBRE), False
    screen.draw(' ')
    screen.cursor.fg, screen.cursor.bg, screen.cursor.bold, screen.cursor.italic = fg, bg, gras, italique
    return fin


def _tick(timer_id) -> None:
    _maj_reseau()
    _maj_cpu()
    for tm in get_boss().all_tab_managers:
        tm.mark_tab_bar_dirty()


_maj_reseau()
_maj_cpu()
add_timer(_tick, 1.0, True)  # kitty charge ce module une seule fois
