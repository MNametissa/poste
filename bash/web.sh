# Source par ~/.bashrc (bloc poste). Navigation web dans le terminal.
#   web github.com         Chrome (ton profil, rendu complet) ; web seul : saisie d'adresse
#   web prix kitty         recherche Google dans Chrome
#   web --profil NOM ...   un autre profil Chrome
#   Dans Chrome : Ctrl+L adresse, Alt+Gauche/Droite, F5 recharger, Ctrl+Q quitter.
#   webtexte wikipedia.org w3m, leger (texte et images, sans JavaScript)
#   Dans w3m : Tab lien suivant, Entree suivre, B retour, U adresse, H aide, q quitter.
web() {
    poste-chrome "$@"
}

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
