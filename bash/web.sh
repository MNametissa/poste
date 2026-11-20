# Source par ~/.bashrc (bloc poste). Navigation web dans le terminal avec w3m.
#   web                    page de recherche DuckDuckGo
#   web wikipedia.org      ouvre l'adresse
#   web prix kitty         recherche DuckDuckGo
# Dans w3m : Tab lien suivant, Entree suivre, B retour, U adresse, H aide, q quitter.
web() {
    local recherche='https://lite.duckduckgo.com/lite/'
    if [ $# -eq 0 ]; then
        w3m "$recherche"
    elif [ $# -eq 1 ] && [[ "$1" =~ ^(https?://)?[^[:space:]/]+\.[^[:space:]]+$ ]]; then
        w3m "$1"
    else
        w3m "${recherche}?q=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote_plus(" ".join(sys.argv[1:])))' "$@")"
    fi
}
