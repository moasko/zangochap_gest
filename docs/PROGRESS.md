# Journal de reprise

## 2026-09-17 — Reprogrammation commerciale soumise à validation

### État actuel et travaux réalisés

- Une tentative de reprogrammation commerciale crée une demande avec date, motif et contenu proposé ; commande, CRM et stock restent inchangés pendant l'attente. Admin/developer peuvent accepter ou refuser dans `/zangochap-manager/orders/reprogramming`. Refus motivé et réponse privée au commercial.
- Fonctionnement existant conservé : NEW_ORDER crée une nouvelle commande CONFIRMED après approbation ; REPRO_DISPO reporte la livraison existante après approbation. Les parcours directs admin et terrain livreur restent disponibles. Aucun retour utilisateur à la clarification optionnelle sur le choix nouvelle/existante pendant l'implémentation ; conservation des deux parcours présents dans le projet.
- Stockage des demandes dans CmsContent existant, sans modification de schéma. Transactions/verrous préviennent doublons de demande et validation ; détection de commande modifiée depuis la demande. Commercial propriétaire uniquement ; décision réservée admin/developer ; protections contre les transitions/créations directes de reprogrammation commerciale.
- Création partagée extraite de `order-actions.ts` vers `modules/orders/actions/order-creation-service.ts` pour accepter un contexte transactionnel interne et préserver l'attribution au demandeur. Façades publiques inchangées ; notifications externes après commit. Les cadeaux restent soumis aux quotas et au parcours d'approbation cadeau existant.
- Nouveau module `reprogramming-actions.ts`, types/schémas `modules/orders/types/reprogramming.ts`, écran `ReprogrammingRequestsClient.tsx`, route serveur, CSS, badges Sidebar et retours UI adaptés. Images personnalisées envoyées à R2 hors transaction après contrôle d'appartenance, au moment de la demande.
- Cartographie et fichiers memory actualisés ; documentation préexistante de la session précédente préservée.

### Vérifications effectuées

- Installation `npm.cmd ci --ignore-scripts` selon lock ; premier essai bloqué par le cache/réseau du sandbox, second réussi après autorisation. Aucun manifeste/lock changé. Génération `npx.cmd prisma generate` autorisée, avec DATABASE_URL factice locale : aucune connexion ni migration base.
- `npx.cmd tsc --noEmit --incremental false` : passe sur la version finale après corrections de typage.
- `node scripts/test-order-reprogramming.mjs` : passe, vraies actions/service de création avec Prisma simulé. Couvre attente sans mutations CRM/commande, droits et visibilité, dates/quantités invalides, champs sensibles ignorés, acceptation/refus, attribution, décision répétée, demande obsolète, rollback commande/CRM, demandes/approbations concurrentes simulées, collisions de références, images personnalisées sans upload en transaction, repro-dispo et créations staff/public/admin.
- Les cinq tests existants (`test-expedition-day.cjs`, `test-rider-history.mjs`, `test-rider-tracking.mjs`, `test-rider-stream.mjs`, `test-rider-place.mjs`) passent. Base et appels externes simulés, aucune donnée réelle touchée.
- ESLint des nouveaux fichiers TypeScript/TSX et du nouveau test : passe. Lint global : **744 erreurs, 83 avertissements**. Comparaison avec HEAD des sept fichiers modifiés : aucune augmentation finale ; OrdersClient revient à ses 111 erreurs/4 avertissements existants, création transférée et typée sans erreurs lint nouvelles.
- `git diff --check` : passe ; 103 chemins explicites de la cartographie contrôlés, tous présents. TypeScript/lint ne prouvent pas une validation fonctionnelle sur base ou navigateur réel ; aucun build, déploiement ou essai authentifié effectué.

### Limites et état Git à préserver

- Aucun accès DB, migration, seed, envoi WhatsApp réel, upload R2 réel ou déploiement. Validation manuelle du circuit commercial → admin → commercial et des verrous sur PostgreSQL réel encore à effectuer en environnement autorisé.
- Liste des demandes sans pagination/purge ; images envoyées lors d'une demande refusée susceptibles de rester inutilisées. Une demande devenue obsolète ou dont la date est passée doit être refusée et refaite.
- Dette lint globale préexistante ; ne pas la confondre avec les nouveaux fichiers vérifiés.
- Le contrôle final a détecté `.env.example` supprimé dans l'arbre de travail, alors qu'il était présent au début de session. Cette suppression ne provient pas des modifications réalisées pour cette tâche ; origine non déterminée, laissée intacte pour préserver les changements concurrents. Aucun contenu sensible copié.

### Prochaines actions

1. Tester sur une base de développement autorisée avec un commercial propriétaire, un autre commercial et un administrateur : demande, badge/message, acceptation, refus, doublon, commande modifiée, date passée, cadeau et repro-dispo.
2. Vérifier le parcours UI mobile/desktop authentifié et le rafraîchissement de la file ; confirmer le comportement PostgreSQL des validations concurrentes.
3. Déployer selon la procédure habituelle après cette validation ; aucune migration nécessaire pour cette fonctionnalité.
4. Clarifier la suppression concurrente de `.env.example` et traiter séparément les dettes déjà recensées ; ajouter pagination/indexation adaptée si le volume des demandes augmente.

## 2026-09-16 — Cartographie documentaire

### État actuel vérifié

- Dépôt initial sans modification signalée par `git status --short`.
- Monolithe Next.js 15.2.1 / React 19 / TypeScript strict, PostgreSQL et Prisma 7, boutique publique + manager multi-rôles + rider + relais.
- Code présent pour commandes, catalogue, préparation/contrôle/collecte, stock, livraisons, règlement, comptabilité, communication et GPS. **Disponibilité en production et validation fonctionnelle non établies par cette session.**
- `AGENT.md` et `memory/` préexistants ; aucun `AGENTS.md` trouvé dans le dépôt ou par la recherche sous `G:/projet reel`.
- Node local v24.21.0 et npm 11.19.0 ; Docker cible Node 20. `node_modules` absent.

### Travaux réalisés

- Lecture des consignes `AGENT.md`, README racine/app/modules, mémoire existante ; analyse du manifeste npm, configuration Next/TS/ESLint/Prisma/PostCSS/UI, Docker/Compose/démarrage et schéma Prisma complet.
- Exploration des entrées publiques/staff/rider et principaux modules ; suivi statique checkout → création/CRM, préparation → stock → livraison → règlement/comptabilité, GPS → transaction → SSE → carte.
- Création de `docs/PROJECT_MAP.md` : modules, API, données, Mermaid, navigation par besoin, commandes, conventions, écarts et limites.
- Création de `AGENTS.md` concis, conservant `AGENT.md` et ses règles par référence ; repère vers les deux documents de reprise.
- Aucun code applicatif, configuration, dépendance ou fichier de données modifié. Aucun accès base, migration, seed, envoi WhatsApp, appel Geoapify réel ou déploiement.

### Vérifications et résultats

- Chemins et symboles documentés contrôlés par lectures/recherches source ; scripts npm contrôlés dans `package.json`. Contrôle automatique de 95 chemins explicites avant correction d'un chemin abrégé de composant rider ; chemin remplacé par son chemin complet existant. Handlers API recoupés avec l'inventaire et leurs exports. Symboles principaux des flux confirmés par recherche source.
- Contrôle final du périmètre Git : seulement trois nouveaux fichiers documentaires (`AGENTS.md`, `docs/PROJECT_MAP.md`, `docs/PROGRESS.md`) ; `git diff --check` sans erreur. Aucun fichier préexistant modifié.
- Les cinq commandes `node scripts/test-expedition-day.cjs`, `node scripts/test-rider-history.mjs`, `node scripts/test-rider-tracking.mjs`, `node scripts/test-rider-stream.mjs`, `node scripts/test-rider-place.mjs` ont été tentées. **Toutes échouent au chargement : module/package typescript introuvable. Aucune assertion exécutée ; cela ne démontre pas un défaut fonctionnel des tests.**
- Lint, TypeScript et build non lancés faute de dépendances locales ; installation non entreprise pour conserver une intervention uniquement documentaire.
- Les succès TS/tests et échecs lint de `memory/change-log.md` sont des résultats historiques, non des vérifications de cette session.

### Blocages et questions ouvertes

- Dépendances absentes : impossible de confirmer compilation/lint/tests actuels.
- Tables GPS/migrations manuelles : présence dans la base réelle inconnue ; ne pas appliquer de SQL automatiquement.
- Droits des actions entrepôts, confiance dans les montants de création commande et cookie client non signé : écarts confirmés à traiter dans des tâches de code distinctes.
- Injection WhatsApp en production, comportement multi-instance des automatisations et flux SSE, durée de conservation GPS, relation compte client/CRM : à clarifier.
- Documentation memory ancienne et doublons d'écrans : carte actuelle prioritaire pour orientation, sources à relire avant intervention.
- Pas de revue exhaustive de toutes les fonctions secondaires, ni audit complet des permissions ou validation UI/mobile/production.

### Prochaines actions, dans l'ordre

1. Lire `AGENTS.md`, `AGENT.md`, la cartographie et ce journal ; vérifier git et les sources liées à la tâche choisie.
2. Pour une prochaine tâche de code, installer les dépendances selon le lock dans un environnement de développement, générer Prisma puis lancer TS, lint et les cinq tests isolés. Consigner les résultats réellement obtenus.
3. Prioriser une revue des frontières serveur : actions entrepôts, contrat de création commande et authentification client ; préparer des corrections avec tests appropriés sans toucher la production.
4. Confirmer avec l'exploitant les migrations appliquées et l'injection des variables, puis valider GPS/SSE sur téléphone et proxy dans un environnement autorisé ; définir la conservation des positions.
5. Clarifier transitions/retours/reprogrammation, snapshots de règlement et concurrence des automatisations avant refonte de ces domaines.
6. Actualiser la carte après changement d'architecture et ajouter une entrée de journal après chaque tâche significative ; maintenir aussi les fichiers memory concernés selon `AGENT.md`.
