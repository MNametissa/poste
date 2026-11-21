# Source par ~/.bashrc (bloc poste). Navigation web dans le terminal.
#   web github.com         Chrome (ton profil, rendu complet) ; web seul : saisie d'adresse
#   web prix kitty         recherche Google dans Chrome
#   web --profil NOM ...   un autre profil Chrome
#   web --actualiser ...  recopie complete du profil Chrome dans celui du terminal
#   Dans Chrome : Ctrl+T/W onglets, Alt+Page prec./suiv., Ctrl+L adresse, Ctrl+F chercher,
#   Alt+=/-/0 zoom, Ctrl+C/V copier/coller, F12 DevTools, F5 recharger, Ctrl+Q quitter.
#   webtexte wikipedia.org w3m, leger (texte et images, sans JavaScript)
#   Dans w3m : Tab lien suivant, Entree suivre, B retour, U adresse, H aide, q quitter.
web() {
    poste-chrome "$@"
}

# Kitty : onglet restaure qui affichait des pages (etiquette poste_web) -> on les rouvre.
# KITTY_POSTE_WEB = "actif url1 url2 ...", deja verifie par launch_wrapper.py.
if [ -n "${KITTY_POSTE_WEB:-}" ]; then
    _kpw="$KITTY_POSTE_WEB"
    unset KITTY_POSTE_WEB
    KITTY_POSTE_WEB="$_kpw" poste-chrome
    unset _kpw
fi

webtexte() {
    local recherche='https://lite.duckduckgo.com/lite/'
    if [ $# -eq 0 ]; then
        w3m "$recherche"
    elif [ $# -eq 1 ] && [[ "$1" =~ ^(https?://)?[^[:space:]/]+\.[^[:space:]]+$ ]]; then
        w3m "$1"
    else
        w3m "${recherche}?q=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote_plus(" ".join(sys.argv[1:])))' "$@")"
    fi
}
