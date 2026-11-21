#!/usr/bin/env bash
# Defait exactement ce qu'a fait install.sh. Les programmes (kitty, yazi, police)
# restent : outils/desinstaller.sh. La sauvegarde des sessions kitty
# (~/.local/state/kitty-autosave) est conservee.
set -euo pipefail

DEPOT=$(cd "$(dirname "$(readlink -f "$0")")" && pwd)
ETAT=$HOME/.local/state/poste
KCONF=$HOME/.config/kitty
APPS=$HOME/.local/share/applications
AUTO=$HOME/.config/autostart

retire_lien() {  # seulement un lien qui pointe dans ce depot ; remet la copie mise de cote
    local place=$1
    if [ -L "$place" ] && [[ "$(readlink "$place")" == "$DEPOT"/* ]]; then
        rm "$place"
        echo "  lien retire   $place"
        if [ -e "$place.avant-poste" ]; then mv "$place.avant-poste" "$place"; echo "  remis         $place"; fi
    fi
}

retire_bloc() {
    local f=$1
    [ -f "$f" ] && grep -q '^# >>> poste >>>$' "$f" || return 0
    sed -i '/^# >>> poste >>>$/,/^# <<< poste <<<$/d' "$f"
    echo "  bloc retire   $f"
}

retire_fichier() {
    [ -e "$1" ] && rm "$1" && echo "  supprime      $1" || true
}

echo "== kitty et bash"
retire_lien "$KCONF/autosave.py"
retire_lien "$KCONF/launch_wrapper.py"
retire_lien "$KCONF/poste.conf"
retire_lien "$KCONF/tab_bar.py"
retire_lien "$HOME/.w3m/config"
retire_lien "$HOME/.local/bin/poste-chrome"
retire_bloc "$KCONF/kitty.conf"
retire_bloc "$HOME/.bashrc"

echo "== lanceurs"
retire_fichier "$APPS/kitty.desktop"
retire_fichier "$APPS/kitty-open.desktop"
retire_fichier "$AUTO/kitty.desktop"
command -v update-desktop-database >/dev/null && update-desktop-database "$APPS" 2>/dev/null || true

echo "== Ctrl+Alt+T"
SCHEMA=org.cinnamon.desktop.default-applications.terminal
if [ -f "$ETAT/terminal-avant" ] && gsettings list-keys "$SCHEMA" >/dev/null 2>&1; then
    AVANT=$(tr -d "'" < "$ETAT/terminal-avant")
    gsettings set "$SCHEMA" exec "$AVANT"
    rm "$ETAT/terminal-avant"
    echo "  terminal par defaut remis : $AVANT"
fi

echo "== terminal rapide"
retire_lien "$KCONF/quick-access-terminal.conf"
if gsettings list-keys org.cinnamon.desktop.keybindings >/dev/null 2>&1; then
    LISTE=$(gsettings get org.cinnamon.desktop.keybindings custom-list)
    gsettings set org.cinnamon.desktop.keybindings custom-list "$(python3 -c '
import ast, sys
print([x for x in ast.literal_eval(sys.argv[1].replace("@as ", "")) if x != "custom-poste-rapide"])' "$LISTE")"
    dconf reset -f /org/cinnamon/desktop/keybindings/custom-keybindings/custom-poste-rapide/
    echo "  raccourci Super+\` retire"
fi

echo "== termine (sauvegarde des sessions conservee : ~/.local/state/kitty-autosave)"
