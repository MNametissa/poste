#!/usr/bin/env bash
# Installe ou met a jour les programmes du poste dans ~/.local, sans sudo :
# kitty, yazi, btop, police JetBrains Mono. Versions figees ci-dessous ; pour mettre
# a jour : changer version et empreinte, puis lancer ../update.sh.
# Un programme deja a la bonne version n'est pas retelecharge.
set -euo pipefail

KITTY_VERSION=0.51.0
KITTY_SHA256=c285daaf1b699997614939c8d1cd92dd8b99302ff12f18efcc3f69382aa72b1d
YAZI_VERSION=26.9.1
YAZI_SHA256=a02fe91d3304294048c681f010f1100856872a4e98ecf6927328e888d40a6ad2
BTOP_VERSION=1.4.8
BTOP_SHA256=af589cf82cc9ea9c29ce050b9239a13bef2d1492256d476156e1054a42ce89ad
POLICE_VERSION=2.304
# JetBrains ne publie pas d'empreinte pour cette version : calculee le 2026-11-20
POLICE_SHA256=6f6376c6ed2960ea8a963cd7387ec9d76e3f629125bc33d1fdcd7eb7012f7bbf

CACHE=$HOME/.cache/poste
BIN=$HOME/.local/bin
KAPP=$HOME/.local/kitty.app
POLICES=$HOME/.local/share/fonts/JetBrainsMono
mkdir -p "$CACHE" "$BIN"

telecharge() {  # telecharge <url> <nom> <sha256> : reprend un telechargement coupe, verifie l'empreinte
    local url=$1 f=$CACHE/$2 sha=$3
    curl -fL -C - --retry 5 --retry-delay 3 -s -o "$f" "$url" || true
    if [ "$(sha256sum "$f" 2>/dev/null | cut -d' ' -f1)" != "$sha" ]; then
        rm -f "$f"
        curl -fL --retry 5 --retry-delay 3 -s -o "$f" "$url"
        if [ "$(sha256sum "$f" | cut -d' ' -f1)" != "$sha" ]; then
            rm -f "$f"
            echo "  !! empreinte invalide pour $2 : rien installe"
            return 1
        fi
    fi
    echo "  empreinte OK : $2"
}

echo "== kitty $KITTY_VERSION"
if [ "$("$KAPP/bin/kitty" --version 2>/dev/null | awk '{print $2}')" = "$KITTY_VERSION" ]; then
    echo "  deja a jour"
else
    telecharge "https://github.com/kovidgoyal/kitty/releases/download/v$KITTY_VERSION/kitty-$KITTY_VERSION-x86_64.txz" \
        "kitty-$KITTY_VERSION.txz" "$KITTY_SHA256"
    rm -rf "$KAPP.nouveau"
    mkdir -p "$KAPP.nouveau"
    tar -xJf "$CACHE/kitty-$KITTY_VERSION.txz" -C "$KAPP.nouveau"
    rm -rf "$KAPP"
    mv "$KAPP.nouveau" "$KAPP"
    echo "  installe dans $KAPP"
fi
ln -sfn "$KAPP/bin/kitty" "$BIN/kitty"
ln -sfn "$KAPP/bin/kitten" "$BIN/kitten"

echo "== yazi $YAZI_VERSION"
if [ "$("$BIN/yazi" --version 2>/dev/null | awk '/Version:/{print $2}')" = "$YAZI_VERSION" ]; then
    echo "  deja a jour"
else
    telecharge "https://github.com/sxyazi/yazi/releases/download/v$YAZI_VERSION/yazi-x86_64-unknown-linux-gnu.zip" \
        "yazi-$YAZI_VERSION.zip" "$YAZI_SHA256"
    unzip -qjo "$CACHE/yazi-$YAZI_VERSION.zip" 'yazi-x86_64-unknown-linux-gnu/yazi' 'yazi-x86_64-unknown-linux-gnu/ya' -d "$CACHE/yazi"
    install -m 755 "$CACHE/yazi/yazi" "$CACHE/yazi/ya" "$BIN/"
    echo "  installe dans $BIN"
fi

echo "== btop $BTOP_VERSION"
if [ "$("$BIN/btop" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)" = "$BTOP_VERSION" ]; then
    echo "  deja a jour"
else
    telecharge "https://github.com/aristocratos/btop/releases/download/v$BTOP_VERSION/btop-x86_64-unknown-linux-musl.tar.gz" \
        "btop-$BTOP_VERSION.tar.gz" "$BTOP_SHA256"
    rm -rf "$CACHE/btop"
    mkdir -p "$CACHE/btop"
    tar -xzf "$CACHE/btop-$BTOP_VERSION.tar.gz" -C "$CACHE/btop"
    install -m 755 "$(find "$CACHE/btop" -type f -name btop -path '*/bin/*' | head -1)" "$BIN/btop"
    echo "  installe dans $BIN"
fi

echo "== JetBrains Mono $POLICE_VERSION"
if [ "$(cat "$POLICES/.version" 2>/dev/null)" = "$POLICE_VERSION" ]; then
    echo "  deja a jour"
else
    telecharge "https://github.com/JetBrains/JetBrainsMono/releases/download/v$POLICE_VERSION/JetBrainsMono-$POLICE_VERSION.zip" \
        "JetBrainsMono-$POLICE_VERSION.zip" "$POLICE_SHA256"
    rm -rf "$POLICES"
    mkdir -p "$POLICES"
    unzip -qjo "$CACHE/JetBrainsMono-$POLICE_VERSION.zip" 'fonts/ttf/JetBrainsMono-*.ttf' -d "$POLICES"
    echo "$POLICE_VERSION" > "$POLICES/.version"
    fc-cache -f "$POLICES" >/dev/null
    echo "  installee dans $POLICES"
fi
