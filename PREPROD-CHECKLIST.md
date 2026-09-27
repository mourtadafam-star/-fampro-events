# Validation avant mise en production

Ne pas tester ces changements pour la première fois sur les données réelles. Utiliser un projet Supabase de préproduction et une URL de prévisualisation du site.

## P0 — blocants

### 1. Base de données et droits

1. Sauvegarder la base de préproduction.
2. Appliquer toutes les migrations sur une base vide, puis sur une copie de la base existante.
3. Exécuter `supabase test db` et exiger 17 tests réussis dans `supabase/tests/staff_access_test.sql`.
4. Créer quatre comptes : administrateur, employé Réservations, employé Paiements et client.
5. Avec chaque compte, tenter aussi des accès directs via l’API Supabase, sans passer par l’interface.
6. Relancer les conseillers de sécurité Supabase et activer la protection contre les mots de passe compromis dans Auth.

Critères obligatoires :

- seul l’administrateur actif lit le journal `staff_activity` ;
- aucun utilisateur connecté ne peut modifier ou supprimer directement le journal ;
- un employé ne peut ni changer son rôle, ni modifier ses droits, ni activer un compte ;
- un employé désactivé perd immédiatement l’accès aux données lors de la requête suivante ;
- chaque permission refusée par l’interface est aussi refusée par les règles de la base ;
- les six opérations atomiques de réservation, mission et paiement acceptent seulement la permission prévue.

Les avertissements existants sur `pg_net` et `get_material_availability` doivent être examinés séparément : ne pas déplacer l’extension sans vérifier les tâches planifiées, et confirmer que l’exposition publique de la disponibilité agrégée du matériel reste un choix métier accepté.

### 2. Invitation et désactivation d’un employé

1. Déployer la fonction `manage-employee` en préproduction avec la vérification JWT activée.
2. Inviter un nouvel employé depuis un compte administrateur.
3. Répéter l’appel avec un client, un employé et sans session.
4. Désactiver l’employé pendant qu’une session est ouverte, puis tenter une lecture et une écriture.

Critères obligatoires : l’invitation administrateur fonctionne ; les trois appels non autorisés échouent ; aucun compte Auth orphelin ne subsiste après un échec d’enregistrement ; la désactivation est appliquée côté base et pas seulement dans l’écran.

### 3. Journal d’activité

Effectuer avec un employé une création, une modification et une suppression autorisées, puis vérifier l’auteur, l’heure, l’action et l’objet dans le journal.

Critères obligatoires : aucune adresse, téléphone, e-mail client, position, message ou identifiant Auth ne doit apparaître dans `old_values` ou `new_values`. Les opérations réalisées avec un compte employé doivent être attribuées à ce compte.

## P1 — parcours métier

### 4. Facture et devis WhatsApp

Tester sur Android/Chrome et iPhone/Safari avec : `77 287 52 52`, `0772875252`, `+221 77 287 52 52`, `00221 77 287 52 52` et `+221 (0) 77 287 52 52`.

Critères obligatoires :

- tous ces formats ouvrent le destinataire `221772875252` ;
- un numéro étranger, trop court, alphabétique ou avec deux indicatifs est bloqué ;
- si le partage natif de fichiers est disponible, la feuille de partage contient réellement le PDF ;
- si ce partage n’est pas disponible, le PDF est téléchargé avant l’ouverture de WhatsApp et le texte demande explicitement de le joindre manuellement ;
- aucune formulation ne prétend que le PDF est joint lorsqu’il ne l’est pas ;
- deux clients de même nom ne provoquent jamais l’envoi au mauvais numéro : seul `client_id` fait foi.

### 5. Permissions fonctionnelles

Pour chaque profil employé, vérifier les menus puis tenter directement les opérations interdites : clients, réservations, paiements, rapports, matériel et stock.

Critère obligatoire : masquer un menu ne suffit pas ; chaque opération interdite doit retourner une erreur d’autorisation de la base.

## P2 — mise à jour et robustesse

### 6. Service worker

1. Ouvrir la version précédente et la laisser active.
2. Publier la prévisualisation contenant le cache `fampro-events-v137`.
3. Revenir sur l’onglet déjà ouvert, puis contrôler les trois pages : gestion, client et connexion.
4. Refaire un passage hors ligne après un premier chargement complet.

Critères obligatoires : l’ancien cache est supprimé, la page contrôlée se recharge une seule fois lors du changement de service worker, les nouveaux scripts `customer-sharing.js` et `pwa-update.js` sont chargés, et aucun cycle de rechargement n’apparaît.

### 7. Régression générale

Créer puis modifier une réservation, enregistrer un paiement, annuler la réservation, générer facture et devis, consulter le portail client, puis vérifier stock, facture, solde et journal. Tester également une interruption réseau pendant chaque écriture importante.

## Décision de mise en production

Autoriser la mise en production uniquement si tous les contrôles P0 et P1 passent sans exception et si le test de remplacement du service worker P2 réussit sur au moins un téléphone Android et un iPhone. Conserver la sauvegarde et le déploiement précédent jusqu’à la fin du contrôle post-déploiement.
