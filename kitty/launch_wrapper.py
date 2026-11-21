# Appele par kitty avant de lancer le programme de chaque nouvelle fenetre,
# y compris celles restaurees depuis une session.
# Si la fenetre porte l'etiquette claude_resume (posee par autosave.py),
# on transmet l'information au shell via KITTY_CLAUDE_RESUME ; ~/.bashrc
# relance alors cette conversation Claude precise.
# Etiquette poste_web (posee par navigateur/chrome.mjs : "actif url1 url2 ...") :
# KITTY_POSTE_WEB, lu par bash/web.sh ou directement par poste-chrome (panneau).
import re
from collections.abc import Sequence

from kitty.launch_wrapper import LaunchContext

# profil|uuid|yolo : la valeur vient d'une variable qu'un programme du terminal
# peut ecrire, donc on refuse tout ce qui n'a pas exactement cette forme
TAG_RE = re.compile(r'^[A-Za-z0-9_.-]+\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\|[01]$')
WEB_RE = re.compile(r'^\d{1,2}( https?://[^\s\'"\\`$]{1,2000}){1,20}$')


def prefix_for_launch(ctx: LaunchContext) -> Sequence[str] | None:
    tag = ctx.user_vars.get('claude_resume', '')
    # pas de test is_default_shell : une fenetre restauree arrive en '/bin/bash --posix'
    # (amorce de l'integration shell) et n'est plus vue comme le shell par defaut.
    # Sans risque : on ne fait que poser une variable, que seul ~/.bashrc lit.
    env = []
    if TAG_RE.match(tag):
        env.append(f'KITTY_CLAUDE_RESUME={tag}')
    web = ctx.user_vars.get('poste_web', '')
    if WEB_RE.match(web):
        env.append(f'KITTY_POSTE_WEB={web}')
    return ['env', *env] if env else None
