# Barre d'onglets du poste (tab_bar_style custom), chargee par kitty depuis
# ~/.config/kitty/tab_bar.py : les onglets powerline de kitty, puis a droite
# l'etat du poste en couleurs (duree d'allumage, charge, debit reseau, date,
# heure, batterie), rafraichi chaque seconde.
# Si ce code leve une erreur, kitty revient seul au style d'onglets par defaut.
# S'il manque de place apres les onglets, l'etat n'est pas affiche.
import glob
import os
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
COEURS = os.cpu_count() or 1
JOURS = ('lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.')
MOIS = ('janv.', 'fevr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'aout', 'sept.', 'oct.', 'nov.', 'dec.')
_reseau = {'t': 0.0, 'rx': 0, 'tx': 0, 'down': 0, 'up': 0}


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


def _largeur(seg: list[tuple[str, int, bool, str]]) -> int:
    return sum(len(s[0]) for s in seg) + len(SEP) * max(0, len(seg) - 1) + 1


# quand la place manque, ces elements disparaissent dans cet ordre ;
# l'heure et la batterie restent toujours
SACRIFIES = ('duree', 'date', 'up', 'down', 'charge')


def _segments() -> list[tuple[str, int, bool, str]]:
    """(texte, couleur, gras, nom) de chaque element, de gauche a droite."""
    allume = int(float((_lire('/proc/uptime').split() or ['0'])[0]))
    charges = _lire('/proc/loadavg').split()[:3] or ['0', '0', '0']
    ratio = float(charges[0]) / COEURS
    now = time.localtime()
    seg = [
        (_duree(allume), GRIS, False, 'duree'),
        (' '.join(charges), VERT if ratio < 0.5 else JAUNE if ratio < 0.9 else ROUGE, False, 'charge'),
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
    for tm in get_boss().all_tab_managers:
        tm.mark_tab_bar_dirty()


_maj_reseau()
add_timer(_tick, 1.0, True)  # kitty charge ce module une seule fois
