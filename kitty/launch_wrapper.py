# Appele par kitty avant de lancer le programme de chaque nouvelle fenetre,
# y compris celles restaurees depuis une session.
# Si la fenetre porte l'etiquette claude_resume (posee par autosave.py),
# on transmet l'information au shell via KITTY_CLAUDE_RESUME ; ~/.bashrc
# relance alors cette conversation Claude precise.
import re
from collections.abc import Sequence

from kitty.launch_wrapper import LaunchContext

# profil|uuid|yolo : la valeur vient d'une variable qu'un programme du terminal
# peut ecrire, donc on refuse tout ce qui n'a pas exactement cette forme
TAG_RE = re.compile(r'^[A-Za-z0-9_.-]+\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\|[01]$')


def prefix_for_launch(ctx: LaunchContext) -> Sequence[str] | None:
    tag = ctx.user_vars.get('claude_resume', '')
    # pas de test is_default_shell : une fenetre restauree arrive en '/bin/bash --posix'
    # (amorce de l'integration shell) et n'est plus vue comme le shell par defaut.
    # Sans risque : on ne fait que poser une variable, que seul ~/.bashrc lit.
    if TAG_RE.match(tag):
        return ['env', f'KITTY_CLAUDE_RESUME={tag}']
    return None
