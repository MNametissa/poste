# Watcher global Kitty (charge par kitty.conf : watcher autosave.py)
#
# 1. Sauvegarde continue : fenetres, onglets, dossiers -> SESSION_FILE,
#    relu au demarrage par startup_session si la restauration native
#    (restore_session_after_logout) n'a rien enregistre (extinction forcee).
# 2. Suivi Claude Code : l'onglet ou tourne Claude porte la variable
#    claude_resume = "<profil>|<sessionId>|<yolo 0/1>", relue par
#    launch_wrapper.py pour relancer cette conversation precise.
import json
import os
import re
from typing import Any

from kitty.boss import Boss
from kitty.fast_data_types import add_timer
from kitty.window import Window

SESSION_FILE = os.environ.get('KITTY_AUTOSAVE_FILE') or os.path.expanduser(
    '~/.local/state/kitty-autosave/session.kitty-session')
VAR = 'claude_resume'
POLL_SECONDS = 5.0
EVENT_DELAY = 1.0
# delai avant d'enregistrer une fermeture d'onglet : a l'arret de la machine,
# kitty est tue avant ce delai, donc la bonne sauvegarde n'est pas ecrasee
CLOSE_DELAY = 3.0
EMPTY_SESSION = 'launch\n'  # une seule fenetre avec un shell
UUID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
PROFILE_RE = re.compile(r'^[A-Za-z0-9_.-]+$')

_boss: Boss | None = None
_frozen = False      # vrai des que kitty s'arrete sans que l'utilisateur l'ait demande
_scheduled = False


def _read_proc(pid: int) -> tuple[list[bytes], dict[bytes, bytes]] | None:
    try:
        with open(f'/proc/{pid}/cmdline', 'rb') as f:
            argv = f.read().rstrip(b'\0').split(b'\0')
        with open(f'/proc/{pid}/environ', 'rb') as f:
            env = dict(x.split(b'=', 1) for x in f.read().split(b'\0') if b'=' in x)
    except OSError:
        return None
    return argv, env


def claude_tag(pid: int) -> str | None:
    """Etiquette '<profil>|<sessionId>|<yolo>' si pid est une session Claude interactive."""
    proc = _read_proc(pid)
    if not proc or os.path.basename(proc[0][0].decode(errors='replace')) != 'claude':
        return None
    argv, env = proc
    conf = env.get(b'CLAUDE_CONFIG_DIR', b'').decode(errors='replace').rstrip('/')
    name = os.path.basename(conf)
    if not name.startswith('.claude-') or not PROFILE_RE.match(name[len('.claude-'):]):
        return None
    try:
        with open(os.path.join(conf, 'sessions', f'{pid}.json')) as f:
            info = json.load(f)
    except (OSError, ValueError):
        return None
    sid = info.get('sessionId', '')
    if info.get('kind') != 'interactive' or not UUID_RE.match(sid):
        return None
    # --yolo du wrapper : utile seulement si le profil n'est pas deja .trusted
    yolo = b'--dangerously-skip-permissions' in argv and not os.path.exists(os.path.join(conf, '.trusted'))
    return f'{name[len(".claude-"):]}|{sid}|{int(yolo)}'


def _ls(boss: Boss) -> list[dict[str, Any]]:
    out = boss.call_remote_control(None, ('ls',))
    return json.loads(out) if isinstance(out, str) else (out or [])


def _windows(data: list[dict[str, Any]]):
    for osw in data:
        for tab in osw.get('tabs', []):
            yield from tab.get('windows', [])


def sync_claude(boss: Boss, data: list[dict[str, Any]]) -> None:
    for w in _windows(data):
        tag = None
        for p in w.get('foreground_processes', []):
            tag = claude_tag(int(p.get('pid', 0)))
            if tag:
                break
        if tag != w.get('user_vars', {}).get(VAR):
            # sans '=VALEUR', set-user-vars supprime la variable
            boss.call_remote_control(None, ('set-user-vars', f'--match=id:{w["id"]}', f'{VAR}={tag}' if tag else VAR))


def _write(content: str) -> None:
    os.makedirs(os.path.dirname(SESSION_FILE), exist_ok=True)
    tmp = SESSION_FILE + '.tmp'
    with open(tmp, 'w') as f:
        f.write(content)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, SESSION_FILE)


def save(boss: Boss) -> None:
    if _frozen:
        return
    data = _ls(boss)
    sync_claude(boss, data)
    if not any(True for _ in _windows(data)):
        content = EMPTY_SESSION
    else:
        tmp = SESSION_FILE + '.new'
        # les fenetres d'outils internes (erreurs, selecteur de fichiers...) ne sont pas a restaurer
        # kitty re-decoupe la ligne aux espaces : le filtre doit etre entre guillemets
        boss.call_remote_control(None, (
            'action', 'save_as_session', '--save-only', '--os-window-geometry',
            '--match="not env:KITTEN_RUNNING_AS_UI"', tmp))
        try:
            with open(tmp) as f:
                content = f.read()
            os.remove(tmp)
        except OSError:
            # sauvegarde impossible : on s'arrete au lieu de reessayer toutes les 5 s
            # (chaque echec de save_as_session affiche une fenetre d'erreur)
            _stop('save_as_session n a rien ecrit')
            return
    try:
        with open(SESSION_FILE) as f:
            if f.read() == content:
                return
    except OSError:
        pass
    _write(content)


def _stop(reason: str) -> None:
    global _frozen
    _frozen = True
    print('autosave: arret de la sauvegarde continue :', reason, flush=True)


def _tick(timer_id: int | None = None) -> None:
    global _scheduled
    _scheduled = False
    if _boss is not None and not _frozen:
        try:
            save(_boss)
        except Exception as e:
            _stop(repr(e))


def _schedule(delay: float) -> None:
    global _scheduled
    if not _scheduled and not _frozen:
        _scheduled = True
        add_timer(_tick, delay, False)


def _is_main_instance(boss: Boss) -> bool:
    """Seule l'instance principale (kitty -1 : menu, Ctrl+Alt+T, demarrage auto)
    sauvegarde. Un kitty lance a la main, un bandeau (kitten panel) ou tout autre
    kitty n'ecrase pas la sauvegarde. Une instance de test fixe KITTY_AUTOSAVE_FILE."""
    if os.environ.get('KITTY_AUTOSAVE_FILE'):
        return True
    return bool(getattr(getattr(boss, 'args', None), 'single_instance', False))


def on_load(boss: Boss, data: dict[str, Any]) -> None:
    global _boss, _frozen
    if not _is_main_instance(boss):
        _frozen = True
        return
    _boss = boss
    add_timer(_tick, POLL_SECONDS, True)
    _schedule(EVENT_DELAY)


def on_close(boss: Boss, window: Window, data: dict[str, Any]) -> None:
    global _frozen
    if _boss is None:  # instance secondaire : on ne touche jamais a la sauvegarde
        return
    reason, cause = data.get('reason'), data.get('cause')
    if reason == 'quit':
        if cause == 'action':
            _write(EMPTY_SESSION)  # tu as quitte kitty toi-meme : rien a rouvrir
        _frozen = True  # deconnexion, signal systeme, plantage : on garde la sauvegarde
        return
    if cause == 'closed':
        # fermeture a la croix : si c'etait la derniere fenetre, kitty va quitter
        data_ls = _ls(boss)
        if reason == 'os_window':
            remaining = [w for osw in data_ls if osw['id'] != window.os_window_id
                         for t in osw.get('tabs', []) for w in t.get('windows', [])]
        else:
            remaining = [w for w in _windows(data_ls) if w['id'] != window.id]
        if not remaining:
            _write(EMPTY_SESSION)
            return
    _schedule(CLOSE_DELAY)


def on_cwd_change(boss: Boss, window: Window, data: dict[str, Any]) -> None:
    _schedule(EVENT_DELAY)


def on_cmd_startstop(boss: Boss, window: Window, data: dict[str, Any]) -> None:
    _schedule(EVENT_DELAY)


def on_tab_bar_dirty(boss: Boss, window: Window, data: dict[str, Any]) -> None:
    _schedule(EVENT_DELAY)
