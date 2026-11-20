# Source par ~/.bashrc (bloc poste). Prompt en blocs colores facon powerline :
#   a gauche : nom du prompt (promptname / promptreset) puis dossier courant
#   a droite : branche git, taches en arriere-plan, resultat de la derniere commande
# Le prompt d'origine du .bashrc revient si ce fichier n'est plus charge (uninstall.sh).
[[ $- == *i* ]] || return 0

__poste_c() {  # sequence de couleur, invisible pour le calcul de largeur de bash
    printf '\001\033[%sm\002' "$1"
}

__poste_prompt() {  # $1 = code de la derniere commande, $2 = nombre de taches (\j)
    local code=$1 taches=$2
    local fleche=$'' chevron=$'' icone=$''
    local bleu='122;162;247' gris='48;48;48' clair='230;230;230' noir='0;0;0'
    local nom=${PROMPT_NAME:-$USER} dossier=${PWD/#$HOME/\~}

    # --- gauche
    local gauche_texte=" $nom $fleche $dossier $fleche "
    local gauche
    gauche="$(__poste_c "48;2;$bleu;38;2;$noir;1") $nom $(__poste_c "0;38;2;$bleu;48;2;$gris")$fleche"
    gauche+="$(__poste_c "38;2;$clair;48;2;$gris") $dossier $(__poste_c "0;38;2;$gris")$fleche$(__poste_c 0) "

    # --- droite (texte brut pour la largeur, texte colore pour l'affichage)
    local brut='' couleur='' branche
    branche=$(git symbolic-ref --short HEAD 2>/dev/null || git rev-parse --short HEAD 2>/dev/null)
    if [ -n "$branche" ]; then
        brut+="$icone $branche $chevron "
        couleur+="$(__poste_c '38;2;187;154;247')$icone $branche $(__poste_c '38;2;90;90;90')$chevron "
    fi
    if [ "${taches:-0}" -gt 0 ]; then
        local mot='tâche'
        [ "$taches" -gt 1 ] && mot='tâches'
        brut+="$taches $mot $chevron "
        couleur+="$(__poste_c '38;2;224;175;104')$taches $mot $(__poste_c '38;2;90;90;90')$chevron "
    fi
    if [ "$code" -eq 0 ]; then
        brut+=" ✓ "
        couleur+="$(__poste_c "48;2;158;206;106;38;2;$noir;1") ✓ "
    else
        brut+=" ✗ $code "
        couleur+="$(__poste_c "48;2;247;118;142;38;2;$noir;1") ✗ $code "
    fi
    couleur+=$(__poste_c 0)

    # a droite seulement s'il reste la place ; le curseur revient ensuite a gauche
    local colonnes=${COLUMNS:-80}
    if (( ${#gauche_texte} + ${#brut} + 2 < colonnes )); then
        printf '\001\0337\033[%dG\002%s\001\0338\002' $((colonnes - ${#brut} + 1)) "$couleur"
    fi
    printf '%s' "$gauche"
}

shopt -s checkwinsize
PS1='$(__poste_prompt $? \j)'
