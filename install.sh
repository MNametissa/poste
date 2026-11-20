#!/usr/bin/env bash
# Installe ou reinstalle le poste (sans risque de doublon a la relance) :
# - liens de ~/.config/kitty vers ce depot (une mise a jour du depot s'applique tout de suite)
# - une ligne balisee dans kitty.conf (include poste.conf) et dans ~/.bashrc
# - lanceurs generes : menu (kitty -1), demarrage auto de kitty
# - Ctrl+Alt+T ouvre kitty (ancien terminal memorise pour uninstall.sh)
# Les programmes eux-memes (kitty, yazi, police) : outils/installer.sh
set -euo pipefail

DEPOT=$(cd "$(dirname "$(readlink -f "$0")")" && pwd)
ETAT=$HOME/.local/state/poste
KCONF=$HOME/.config/kitty
KAPP=$HOME/.local/kitty.app
APPS=$HOME/.local/share/applications
AUTO=$HOME/.config/autostart
mkdir -p "$ETAT" "$KCONF" "$APPS" "$AUTO" "$HOME/.local/state/kitty-autosave"

lien() {  # lien <fichier du depot> <emplacement> ; un vrai fichier deja present est garde de cote
    local cible=$DEPOT/$1 place=$2
    if [ -e "$place" ] && [ ! -L "$place" ]; then
        mv "$place" "$place.avant-poste"
        echo "  copie de cote : $place.avant-poste"
    fi
    ln -sfn "$cible" "$place"
    echo "  lien   $place"
}

bloc() {  # bloc <fichier> <ligne> : (re)ecrit le bloc balise poste a la fin du fichier
    local f=$1 ligne=$2
    touch "$f"
    sed -i '/^# >>> poste >>>$/,/^# <<< poste <<<$/d' "$f"
    printf '# >>> poste >>>\n%s\n# <<< poste <<<\n' "$ligne" >> "$f"
    echo "  bloc   $f"
}

echo "== kitty : configuration"
lien kitty/autosave.py "$KCONF/autosave.py"
lien kitty/launch_wrapper.py "$KCONF/launch_wrapper.py"
lien kitty/poste.conf "$KCONF/poste.conf"
lien kitty/tab_bar.py "$KCONF/tab_bar.py"
bloc "$KCONF/kitty.conf" "include poste.conf"
[ -f "$HOME/.local/state/kitty-autosave/session.kitty-session" ] ||
    printf 'launch\n' > "$HOME/.local/state/kitty-autosave/session.kitty-session"

echo "== bash : relance des sessions Claude"
bloc "$HOME/.bashrc" "[ -f \"$DEPOT/bash/relance-claude.sh\" ] && . \"$DEPOT/bash/relance-claude.sh\""

echo "== lanceurs"
if [ -x "$KAPP/bin/kitty" ]; then
    ICONE=$KAPP/share/icons/hicolor/256x256/apps/kitty.png
    for f in kitty kitty-open; do
        sed -e "s|^TryExec=kitty$|TryExec=$KAPP/bin/kitty|" \
            -e "s|^Exec=kitty$|Exec=$KAPP/bin/kitty -1|" \
            -e "s|^Exec=kitty +open|Exec=$KAPP/bin/kitty +open|" \
            -e "s|^Icon=kitty$|Icon=$ICONE|" \
            "$KAPP/share/applications/$f.desktop" > "$APPS/$f.desktop"
        echo "  menu   $APPS/$f.desktop"
    done
    cat > "$AUTO/kitty.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=kitty (restauration des terminaux)
Comment=Rouvre les fenetres et onglets kitty de la session precedente
Exec=$KAPP/bin/kitty -1
Icon=$ICONE
X-GNOME-Autostart-enabled=true
X-GNOME-Autostart-Delay=3
EOF
    echo "  auto   $AUTO/kitty.desktop"
    command -v update-desktop-database >/dev/null && update-desktop-database "$APPS" 2>/dev/null || true
else
    echo "  !! kitty absent de $KAPP : lancer d'abord outils/installer.sh, puis relancer install.sh"
fi

echo "== Ctrl+Alt+T"
SCHEMA=org.cinnamon.desktop.default-applications.terminal
if [ -x "$KAPP/bin/kitty" ] && gsettings list-keys "$SCHEMA" >/dev/null 2>&1; then
    [ -f "$ETAT/terminal-avant" ] || gsettings get "$SCHEMA" exec > "$ETAT/terminal-avant"
    gsettings set "$SCHEMA" exec "$KAPP/bin/kitty -1"
    echo "  terminal par defaut : kitty -1 (ancien : $(cat "$ETAT/terminal-avant"))"
else
    echo "  ignore (kitty absent ou bureau autre que Cinnamon)"
fi

echo "== termine."
