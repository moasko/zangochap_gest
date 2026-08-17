# Journal de mémoire IA

Les entrées les plus récentes sont placées en premier.

## 2026-08-17 — Premier lot de réduction de dette

- Retrait de toute synchronisation Prisma automatique au démarrage de production.
- Alignement du port de démarrage sur le port Docker 3000.
- Rétablissement du singleton Prisma sans suppression de la valeur globale.
- Validation Zod et types Prisma ajoutés à la gestion des comptes staff.
- Longueur minimale des nouveaux mots de passe staff portée à huit caractères.
- Import réservé aux admins/développeurs, borné à 1 000 lignes et validé avant écriture.
- Les erreurs d'import par ligne sont désormais retournées au lieu d'être ignorées silencieusement.

## 2026-08-17 — Protection des données de production

- Ajout dans `AGENT.md` de l'interdiction d'exécuter une migration, un `prisma db push` ou une commande destructive sans information préalable et autorisation explicite du propriétaire.
- Priorité donnée aux audits en lecture seule et à la préservation absolue des données de production.

## 2026-08-17 — Initialisation

- Création de `AGENT.md` et du dossier `memory/`.
- Ajout du contexte architectural et métier issu d'une analyse statique complète.
- Aucun code applicatif ni comportement métier modifié.
