# Journal de mémoire IA

Les entrées les plus récentes sont placées en premier.

## 2026-08-28 — Fiabilisation de la page Performance Équipe

- Fichiers : `modules/orders/actions/analytics-actions.ts`,
  `modules/orders/actions/status-actions.ts`,
  `app/zangochap-manager/admin/performance/page.tsx` et `PerformanceClient.tsx`.
- Correction de l'attribution des collectes par email, des périodes de livraison,
  des livraisons partielles et du chiffre d'affaires réellement encaissé.
- Les résumés utilisent désormais toute la période même si le détail reste limité
  aux 50 lignes les plus récentes; les filtres URL et les détails sont synchronisés.
- Enregistrement de `deliveredAt` pour les nouvelles livraisons complètes et partielles.
- Vérifications : TypeScript et lint ciblé serveur réussis.

## 2026-08-26 — Revalidation complète de la mémoire projet

- Fichiers : `memory/project-context.md`, `memory/change-log.md`.
- Analyse statique de l'architecture, du schéma Prisma, de l'authentification,
  des commandes, statuts, stocks, livraisons, settlements, API et déploiement.
- Actualisation des métriques et des flux métier critiques.
- Retrait des risques devenus obsolètes : singleton Prisma, revalidation de session,
  protection API promos et migration destructive au démarrage sont déjà corrigés.
- Ajout des risques encore actifs et des garde-fous à ne pas régresser.
- Vérification : `npx.cmd tsc --noEmit --incremental false` réussit.

## 2026-08-22 — Correction de la création des utilisateurs

- Alignement du formulaire équipe avec la règle serveur de huit caractères minimum pour les mots de passe.
- Conversion des champs téléphone et service facultatifs vides en `null`, afin de respecter les contraintes uniques sans bloquer plusieurs comptes sans numéro.
- Ajout de messages explicites lorsque l'email ou le numéro WhatsApp existe déjà.

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
