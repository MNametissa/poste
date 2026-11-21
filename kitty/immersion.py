# Watcher kitty : mode immersif du navigateur du terminal (F11 dans navigateur/chrome.mjs).
# La page pose la variable de fenetre poste_immersif=1 : pour CETTE fenetre kitty seulement,
# barre d'onglets masquee, plein ecran, et seule la fenetre du navigateur affichee (disposition
# stack), sans marge. Variable retiree ou fenetre fermee : tout est remis comme avant.
# Kitty decide de la barre par fenetre OS (tab_bar_should_be_visible -> has_too_few_tabs, verifie
# dans les sources 0.51.0) : on enveloppe cette propriete.
from typing import Any

from kitty.boss import Boss
from kitty.fast_data_types import WINDOW_FULLSCREEN, get_os_window_geometry
from kitty.tabs import TabManager
from kitty.window import Window

VAR = 'poste_immersif'
_avant: dict[int, dict[str, Any]] = {}  # os_window_id -> etat a remettre

_visible = TabManager.tab_bar_should_be_visible
TabManager.tab_bar_should_be_visible = property(lambda self: self.os_window_id not in _avant and _visible.fget(self))


def _plein_ecran(boss: Boss, osw: int, voulu: bool) -> None:
    try:
        actuel = get_os_window_geometry(osw)['state'] == WINDOW_FULLSCREEN
    except Exception:
        actuel = not voulu
    if actuel != voulu:
        boss.toggle_fullscreen(osw)


def _marge(window: Window, valeur: float | None) -> None:  # 0 : page bord a bord ; None : reglage normal
    for bord in ('left', 'top', 'right', 'bottom'):
        window.patch_edge_width('padding', bord, valeur)


def _appliquer(boss: Boss, window: Window, actif: bool) -> None:
    osw = window.os_window_id
    tm = boss.os_window_map.get(osw)
    tab = window.tabref()
    if tm is None or tab is None or actif == (osw in _avant):
        return
    if actif:
        _avant[osw] = {'disposition': tab._current_layout_name, 'tab': tab, 'fenetre': window.id}
        tab.set_active_window(window)
        _marge(window, 0)
        # navigateur en panneau (window-dock) : la disposition stack ne masque pas la fenetre
        # principale, on etend le panneau a 100 % (taille d'avant remise a la sortie)
        groupe = tab.windows.dock_for_window_id(window.id)
        if groupe is not None and groupe.dock is not None and groupe.dock.size_is_percent:
            _avant[osw]['panneau'] = (groupe, groupe.dock)
            groupe.dock = groupe.dock._replace(size=100)
        if tab._current_layout_name != 'stack':
            tab.goto_layout('stack')
        _plein_ecran(boss, osw, True)
    else:
        etat = _avant.pop(osw)
        _marge(window, None)
        if 'panneau' in etat:
            groupe, dock = etat['panneau']
            groupe.dock = dock
        if etat['disposition'] and etat['disposition'] != 'stack':
            etat['tab'].goto_layout(etat['disposition'])
        _plein_ecran(boss, osw, False)
    tm.layout_tab_bar()
    tm.resize()
    tab.relayout()


def on_set_user_var(boss: Boss, window: Window, data: dict[str, Any]) -> None:
    if data.get('key') == VAR:
        _appliquer(boss, window, data.get('value') == '1')


def on_close(boss: Boss, window: Window, data: dict[str, Any]) -> None:
    if _avant.get(window.os_window_id, {}).get('fenetre') == window.id:
        try:
            _appliquer(boss, window, False)
        except Exception:
            _avant.pop(window.os_window_id, None)
