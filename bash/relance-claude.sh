# Source par ~/.bashrc (bloc poste ajoute par install.sh).
# Kitty : un onglet restaure qui avait une session Claude relance CETTE conversation.
# KITTY_CLAUDE_RESUME = profil|uuid|yolo, pose par ~/.config/kitty/launch_wrapper.py
# a partir de l'etiquette ecrite par autosave.py. La relance passe par la fonction
# `claude -u <profil>` du gestionnaire de profils, donc avec les reglages du profil.
if [ -n "${KITTY_CLAUDE_RESUME:-}" ]; then
    IFS='|' read -r _kcr_profile _kcr_id _kcr_yolo <<< "$KITTY_CLAUDE_RESUME"
    unset KITTY_CLAUDE_RESUME
    if [[ "$_kcr_profile" =~ ^[A-Za-z0-9_.-]+$ && "$_kcr_id" =~ ^[0-9a-f-]{36}$ ]]; then
        if [ "$_kcr_yolo" = 1 ]; then
            claude -u "$_kcr_profile" --yolo --resume "$_kcr_id"
        else
            claude -u "$_kcr_profile" --resume "$_kcr_id"
        fi
    fi
    unset _kcr_profile _kcr_id _kcr_yolo
fi
