#!/usr/bin/env bash
# Met a jour le poste : depot (git pull), programmes, puis configuration.
set -euo pipefail
DEPOT=$(cd "$(dirname "$(readlink -f "$0")")" && pwd)
git -C "$DEPOT" pull --ff-only
"$DEPOT/outils/installer.sh"
"$DEPOT/install.sh"
