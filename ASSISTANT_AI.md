# Assistant IA FAMpro

## Architecture

- `admin-workflows.js` contient l’interface de conversation réservée à l’espace administrateur.
- `supabase/functions/fampro-assistant` est l’unique point d’accès au modèle IA.
- Le navigateur transmet seulement la session Supabase et la conversation récente à la fonction.
- La fonction valide la session et l’adresse administrateur, puis lit `clients`, `materiel`, `reservations` et `paiements` avec le jeton de l’utilisateur. Les politiques RLS restent donc actives.
- La clé OpenAI est lue depuis les secrets de la fonction et n’est jamais envoyée au navigateur.
- La fonction ne contient aucune opération d’écriture et ne fournit aucun outil d’écriture au modèle.

## Configuration du serveur

Créer le secret `OPENAI_API_KEY` dans **Supabase > Edge Functions > Secrets**. `OPENAI_MODEL` est facultatif et vaut `gpt-5-mini` par défaut.

Pour un environnement local, copier `supabase/functions/.env.example` vers `supabase/functions/.env`, renseigner la clé et conserver ce fichier hors de Git.

Déployer ensuite uniquement la fonction authentifiée :

```sh
supabase functions deploy fampro-assistant --project-ref paegdthtusbwxuarhacb
```

Ne pas utiliser `--no-verify-jwt` pour cette fonction.

## Vérifications avant usage réel

1. Exécuter `tests/production-readiness.mjs` et `tests/fampro-assistant.test.mjs` avec Node.js.
2. Confirmer qu’un visiteur non connecté reçoit une erreur 401.
3. Confirmer qu’un compte authentifié non administrateur reçoit une erreur 403.
4. Poser une question de lecture avec le compte administrateur et comparer les chiffres à Supabase.
5. Demander une modification ou une suppression et confirmer que l’assistant indique qu’une validation humaine est requise sans modifier la base.
6. Examiner les journaux de la fonction et les dépenses OpenAI après les premiers essais.

## Écritures futures

Une future action sensible devra suivre un flux séparé en deux étapes : proposition structurée en lecture seule, puis écran de confirmation humaine explicite. L’exécution devra utiliser une fonction dédiée, valider à nouveau la session et les paramètres côté serveur, appliquer une clé d’idempotence et produire une trace d’audit. Aucune confirmation ne doit être déduite d’un simple message de conversation.
