#!/usr/bin/env bash
# Retire kitty, yazi et la police JetBrains Mono installes par installer.sh.
# A lancer apres ../uninstall.sh, depuis un autre terminal que kitty.
set -euo pipefail
BIN=$HOME/.local/bin

for l in kitty kitten; do
    [ -L "$BIN/$l" ] && rm "$BIN/$l" && echo "  lien retire  $BIN/$l"
done
[ -d "$HOME/.local/kitty.app" ] && rm -rf "$HOME/.local/kitty.app" && echo "  supprime     ~/.local/kitty.app"
for p in yazi ya; do
    [ -f "$BIN/$p" ] && rm "$BIN/$p" && echo "  supprime     $BIN/$p"
done
if [ -d "$HOME/.local/share/fonts/JetBrainsMono" ]; then
    rm -rf "$HOME/.local/share/fonts/JetBrainsMono"
    fc-cache -f >/dev/null
    echo "  supprime     police JetBrains Mono"
fi
echo "== termine"
