# Journal de mémoire IA

## 2026-10-09 — Partage par commune, onglets périmés

- Répartition : alternance par commune entre livreurs affectés/habituels, sans équilibrage global ni débordement hors zone ; plafond facultatif. Déploiement : clé `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` stable recommandée (Dokploy) ; bandeau de rechargement ; journal des refus de rôle. Raison : demande du propriétaire + erreurs de prod du 08–09/10.


## 2026-10-06 — Attribution à la validation call center

- `auto-assign-on-confirm.ts` appelé après chaque passage en CONFIRMED (4 chemins), derrière l’interrupteur du planning (off par défaut). Règles partagées via `dispatch-context.ts`. Raison : le propriétaire veut que la commande validée par le call center soit attribuée immédiatement.


## 2026-10-06 — Partage égal par commune

- Communes affectées (planning) = partage à parts égales ; Hors Abidjan exclusif (affecté ou livreur habituel, sinon à l’admin). `bulkAssignOrders` sécurisé (séquentiel, verrou optimiste, bilan). Raison : règle de répartition demandée par le propriétaire.


## 2026-10-05 — Planning des livreurs

- `modules/delivery-planning/` + page `admin/delivery/planning` ; données dans `CmsContent` `delivery-dispatch:planning` (pas de table). Utilisé par `getDeliveryDispatchPlan` pour la présence, les zones fixes et les plafonds. Raison : programmer jours, absences et zones des livreurs pour la répartition automatique.


## 2026-10-05 — Répartition automatique des livraisons

- Moteur `modules/orders/helpers/delivery-dispatch.ts`, actions proposer/appliquer dans `delivery-actions.ts`, fenêtre `DeliveryDispatchModal.tsx`, écran Livraisons allégé. Raison : l’ancienne répartition donnait des colis aux comptes dormants et son aperçu différait du résultat. Test : `node scripts/test-delivery-dispatch.mjs`.


## 2026-10-05 — Base dev copiée depuis la prod

- Dev (port 5434, base `dev`) = copie de la prod au 2026-10-05. `next dev` l’utilise via `.env.development.local` (WhatsApp neutralisé). Prisma CLI lit `.env` = PROD. Raison : tester la répartition des livraisons sur des données réelles sans risque pour la prod.


## 2026-10-04 — Index de navigation du code

- `docs/CODE_INDEX.md` généré par `npm run index:code` (`scripts/gen-code-index.mjs`) : arbre, symboles exportés `nom:ligne`, plan des gros fichiers. Raison : réduire la lecture de fichiers lors des prochaines interventions.


## 2026-09-22 — Consultation par défaut et actions en haut

- `RiderPersonnelForm` ouvre la vue détaillée en premier, y compris en aperçu. Boutons de mode et action principale déplacés sous l’en-tête, avant la synthèse ; enregistrement toujours associé au formulaire. Barre persistante en haut sur grand écran et statique sur mobile.
- TypeScript, lint ciblé et diff-check passent. Lint global : dette historique inchangée. Vérification visuelle non réalisée, aucun déploiement.


## 2026-09-22 — Harmonisation ZangoChap et ergonomie

- Fiche, synthèses et annuaire harmonisés avec orange/crème/navy ZangoChap. Focus clavier et rubrique ciblée visibles ; petites largeurs et saisie mobile ajustées.
- Recherche par rôle effectivement prise en charge. Dates affichées en jour/mois/année. Consultation propose de revenir à la modification ; sauvegarde désactivée sans changement sur une fiche existante et changement de mode bloqué pendant traitement.
- TypeScript, lint ciblé, tests isolés personnel et diff-check passent. Lint global : dette préexistante inchangée. Pas de vérification visuelle navigateur, migration ou déploiement.


## 2026-09-22 — Style inspiré de la référence utilisateur

- Palette bleue et surfaces blanches, avatar circulaire, progression en anneau, trois cartes synthétiques alimentées par les champs réels et navigation horizontale. Cartes de l’annuaire harmonisées. Aucun ajout de paie/évaluation fictive ni changement métier.
- Lint ciblé et diff-check valides ; lint global inchangé (744 erreurs / 83 avertissements). Recette visuelle interactive non confirmée ; aucun déploiement ni migration.


## 2026-09-22 — Annuaire et complétude du personnel

- Cartes et vue liste avec pourcentage enregistré, progression, compte des éléments et statut. Chargement groupé des profils/documents (catégories seulement) ; requête séparée pour garder l’équipe utilisable si tables absentes. Données indisponibles/invalides affichées comme inconnues, jamais comme 0 %. Profil absent = dossier à créer à 0 %.
- Formulaire avec bascule saisie/vue détaillée, navigation et barre d’enregistrement conservées. Aperçu annuaire fictif `/dev/personnel-preview?view=team`, création/modification de comptes désactivées dans cet aperçu.
- Tests isolés incluant résumés passent ; lint ciblé valide, lint global inchangé (744 erreurs / 83 avertissements). Aucun déploiement ni migration. Recette navigateur authentifiée et stockage réel restent à faire sur base autorisée.


## 2026-09-22 — Interface professionnelle de la fiche

- En-tête identité/rôle/statut, navigation par ancres, progression compacte, champs harmonisés, pièces privées structurées et barre d’enregistrement persistante. Indication des modifications non enregistrées ; formulaire associé au bouton externe par identifiant HTML. Adaptation mobile à une colonne avec navigation horizontale.
- TypeScript, lint ciblé, tests isolés personnel et diff-check passent. Lint global : dette préexistante. Serveur aperçu arrêté lors de la vérification ; relance isolée autorisée et réussie après blocage spawn EPERM ; aperçu commercial HTTP 200, navigation et bouton associé au formulaire présents. Recette visuelle interactive non confirmée. Aucune écriture métier ni migration.


## 2026-09-22 — Accès visible aux fiches du personnel

- Vérification : le menu principal admin portait le libellé « Settings » ; l’accès à la fiche était une icône seule dans la carte du membre. Ancien chemin `/admin/team` redirige vers `/admin/settings/team`.
- Ajout du raccourci « Équipe & personnel » au menu admin (hérité par développeur) et d’un lien textuel « Ouvrir la fiche du personnel » sur chaque carte staff. Sous-menu équipe : « Fiches & accès ».
- Lint global : dette inchangée, 744 erreurs / 83 avertissements ; diff-check valide. Pas de déploiement, migration ni recette avec compte admin réel. Le serveur local isolé ne permet pas la connexion aux comptes de production.


## 2026-09-22 — Fiches pour toute l’équipe

- Fiche et progression étendues à tous les rôles staff, hors CUSTOMER. Cinq rubriques communes ; permis, véhicule et justificatifs associés réservés aux livreurs dans l’interface et à l’upload serveur. Valeurs historiques conservées lors d’un changement de rôle. Comptes développeurs réservés aux développeurs, y compris documents.
- Tests isolés `node scripts/test-rider-personnel.mjs`, TypeScript, lint ciblé et diff-check passent. Lint global : 744 erreurs / 83 avertissements préexistants. Aperçu HTTP commercial : 200, 32 champs, progression présente, aucun champ véhicule.
- Noms techniques des tables/actions livreur conservés pour compatibilité ; aucun changement supplémentaire de schéma. Aucune migration ou écriture sur la base distante. Pas de recette interactive authentifiée ni de sauvegarde réelle confirmée.
- Suite : autoriser et préparer une base de test, appliquer la création initiale des tables après sauvegarde et accord explicite, vérifier enregistrement et justificatifs pour commercial/livreur/admin.


Les entrées les plus récentes sont placées en premier.

## 2026-09-22 — Serveur local de test personnel

- Next.js démarré sur 127.0.0.1:3100 avec URL DB locale inactive, sans toucher la base distante. Aperçu développement fictif ajouté, HTTP 200/42 champs/barre 0 % vérifiés ; routes privées 403/307 sans session. Tests isolés passent. Navigation visuelle bloquée par transport outil fermé ; vraie sauvegarde en attente d’une base de test autorisée.

## 2026-09-22 — Progression fiche livreur

- Barre de remplissage en direct, compteur et liste des informations manquantes. Calcul conditionnel des justificatifs et du départ, données invalides non comptées, versions de documents dédupliquées. Pas de nouvelle migration.

## 2026-09-22 — Dossiers livreurs

- Fiche à six rubriques, accès depuis équipe, validation et protections de concurrence. Justificatifs privés avec versions conservées, limites de taille et routes protégées. Schéma Prisma et migration manuelle prêts ; aucune migration exécutée. Tests simulés et TS/lint ciblé passent, dette globale inchangée ; procédure dans `docs/RIDER_PERSONNEL.md`.

## 2026-09-20 — Apparence du rappel

- Rappel commercial rouge et pulsation douce CSS, également en mode réduit ; préférence de réduction des animations respectée.

## 2026-09-20 — Carte de rappel lisible

- Correction du flex qui comprimait le texte à côté du bouton : grille à positions explicites, action sur une ligne distincte, titre et aide raccourcis. Carte flottante et réduction conservées. Aucun changement de données.

## 2026-09-20 — Rappel commercial flottant

- `ExchangePendingReminder` dans le layout manager commercial : carte réductible en pastille, visible hors défilement tant que des échanges attendent. API `order-exchange-reminder` compte les seules demandes PENDING du compte connecté ; polling visible 20 s et événement après soumission. Sans mutation de données ni déploiement. Test isolé d’autorisation/filtrage passe.

## 2026-09-18 — Classification des erreurs d’approbation

- Échanges : contrôles catalogue transactionnels et messages distincts (original, attribution, compte, variante, paiement, date/adresse). Diagnostic technique traduit par code Prisma sans détails sensibles. Tests simulés étendus passent et TypeScript valide. Incident production non attribué à une cause sans logs ; aucun accès données.


## 2026-09-18 — Correction contrôlée des demandes d’échange

- Lecture JSON sécurisée, signalement des demandes illisibles, chargement récupérable et diagnostic UUID/étape/code sans contenu sensible. Admin : correction de date/adresse à l’approbation, trace avant/après, droits et garde de version conservés. Échecs externes/cache après commit isolés. Tests étendus/TS/lint ciblé passent ; lint global 744 erreurs/83 avertissements historiques. Aucun accès production/base ni migration ; problèmes de déploiement non déclarés résolus.

## 2026-09-18 — Audit des demandes d’échange

- Rapport `docs/EXCHANGES_AUDIT.md` : parcours complet et restrictions vérifiés, risques JSON/montants/concurrence/diagnostic documentés. Deux suites simulées passent. Aucun code applicatif ni donnée modifiés ; production et parcours navigateur non vérifiés. Reprise dans `docs/PROGRESS.md`.

## 2026-09-18 — Action serveur obsolète dans les logs joints

- Échecs répétés de résolution d'une action, pas de détail métier dans l'extrait. Écran échanges raccordé au rechargement protégé existant ; stockage navigateur bloqué géré sans boucle ni rejeu de mutation. Production : contrôler cohérence des builds/onglets/cache, aucun accès ou déploiement effectué.

## 2026-09-18 — Validation admin des échanges : erreurs lisibles

- Façade `reviewOrderExchangeForUi` + écran : erreurs attendues retournées au lieu d'exceptions masquées en production ; cas Zod/date expirée expliqué. Suite isolée couvre échec sans création, demande conservée et refus motivé. Aucun déploiement ou accès base réelle.

## 2026-09-17 — Adresse requise pour le nouvel échange

- `OrdersClient.tsx`, `types/exchange.ts` : adresse obligatoire mieux signalée, contrôle client avec focus du champ vide et explication serveur. Les originales peuvent avoir une adresse nulle ; l’adresse du nouvel échange doit être complétée sans modifier l’original. Suite simulée passe, aucun accès base réelle.

## 2026-09-17 — Retour lisible des erreurs de demande d’échange

- Façade `duplicateOrderForUi`, affichage client et validation qualifiée par champ : erreurs métier retournées en données pour éviter leur masquage Next.js en production. Erreurs inattendues restent génériques. Suite simulée et TypeScript passent ; lint global inchangé. Cause exacte du digest « Invalid input » utilisateur toujours à confirmer après déploiement.

## 2026-09-17 — Explication du bouton échange désactivé

- `OrdersClient.tsx` : motif commercial obligatoire signalé dans le champ et les actions, aide accessible ; bouton désactivé pour motif vide/panier vide/action en cours, indépendamment de l’âge. Restrictions serveur conservées.

## 2026-09-17 — Audit échange d’une ancienne commande

- Pas de limite d’âge dans le parcours ; test isolé `test-order-exchanges.mjs` ajouté pour original 2020 livré/réglé (commercial + admin), passe ; lint ciblé lancé, résultat attendu. Incident réel encore à identifier via erreur/étape ; protections intactes, aucune opération base réelle.

## 2026-09-17 — Interface des demandes d’échange

- Ajustements utilisateur : cartes compactes en grille de deux colonnes, une colonne sous 1000 px ; détails repliables et boutons adaptés aux cartes.

- `ExchangeRequestsClient.tsx`, `exchanges.css`, page exchanges : filtres/compteurs, recherche locale, cartes structurées, contenu proposé repliable et décision mise en évidence ; adaptation mobile et CSS dédié. Règles serveur conservées. Lint ciblé passe ; rendu navigateur réel restant à contrôler.

## 2026-09-17 — Fixture de demande d’échange préparée

- Script `scripts/create-test-exchange-request.mjs`, aperçu sans DB et insertion explicite/idempotente de données fictives après choix de cible. Aperçu/lint ciblé vérifiés ; pas d’insertion effectuée, confirmation de l’environnement attendue selon AGENT.md. Pas de secret ni identité du compte cible enregistrés dans la mémoire.

## 2026-09-17 — Mise en page du modal d’échange

- `OrdersClient.tsx` : bandeau et champs de paiement intégrés à la colonne destinataire/logistique, champs encadrés ; paiement visible pour Hors Abidjan ou moyen renseigné. Corrige le bloc pleine largeur signalé par capture. Règles serveur inchangées, contrôle visuel navigateur après correction restant à effectuer.

## 2026-09-17 — Validation déplacée des reprogrammations vers les échanges

- Propriétaire : correction de vocabulaire confirmée. Demandes Echange commerciales avec décision admin/developer dans `/zangochap-manager/orders/exchanges`, CmsContent `order-exchange:` ; reprogrammation/REPRO_DISPO redevenus directs. Anciennes demandes préservées, consultables et refusables, nouvelles demandes/approbation legacy désactivées.
- `exchange-actions.ts`, `types/exchange.ts`, `ExchangeRequestsClient.tsx` ; facade, navigation/compteurs et modal adaptés. Paiement d'échange hors Abidjan renseignable ; exemption de l'antidoublon limitée aux échanges staff. Validation paiements et cadeaux conservée.
- `test-order-exchanges.mjs` couvre le workflow et les régressions directes ; six autres suites passent sur services simulés. Aucun accès base réel, migration ni déploiement. Voir le journal de reprise pour les validations finales et limites.

## 2026-09-17 — Secours durable des alertes rider

- `modules/chat/actions.ts` : `getUnreadRiderAlerts`, droits/visibilité/non-lus, pagination date/id et exclusion des alertes de groupe pour commerciaux en pause.
- `components/Sidebar.tsx` : rattrapage toutes les 8 s et au focus/retour réseau ; suppression du secours désactivé. `lib/client-alerts.ts` : stockage navigateur protégé ; route SSE : anti-buffering proxy.
- Test isolé `scripts/test-rider-alerts.mjs` et TypeScript passent ; lint ciblé sans erreur (2 avertissements existants). Lint global conserve 744 erreurs/83 avertissements. Aucun déploiement ni accès base réelle ; réception production à confirmer. Cartographie/journal actualisés.

## 2026-09-17 — Validation administrateur des reprogrammations commerciales

- Demandes commerciales en attente sans modifier la commande ; décision admin/developer, refus motivé, retour au demandeur et compteur dans Sidebar. Route `/zangochap-manager/orders/reprogramming` et écran métier `ReprogrammingRequestsClient`.
- `modules/orders/actions/reprogramming-actions.ts`, `modules/orders/types/reprogramming.ts` : validation, droits, verrous, idempotence et détection de commande modifiée. Stockage CmsContent existant ; aucune migration nécessaire ou exécutée.
- Création partagée dans `modules/orders/actions/order-creation-service.ts` pour intégrer commande/CRM/décision en transaction et déclencher les notifications après commit. Nouvelle commande attribuée au commercial demandeur, ou report de la commande existante pour REPRO_DISPO ; parcours directs admin/livreur conservés.
- Tests isolés de `scripts/test-order-reprogramming.mjs` et cinq tests existants passent sur base/services simulés. TypeScript et lint des nouveaux fichiers vérifiés ; lint global garde une dette historique, détails dans `docs/PROGRESS.md`.
- Dépendances installées selon lock et client Prisma généré avec URL factice sans connexion base. Aucun déploiement ou test UI authentifié réel ; pas de données de production modifiées. Documentation durable actualisée.

## 2026-08-31 — Grand livre regroupé par mois

- L'onglet Sessions du Grand livre regroupe les journées par mois et année, de la plus récente à la plus ancienne.
- Mois repliables avec compteur, le plus récent ouvert initialement; navigation vers les écritures et détails inchangée.
- Même règle de regroupement que les sessions clôturées. Aucun changement de données ni de calcul comptable.

## 2026-08-31 — Sessions comptables clôturées par mois

- Regroupement des sessions clôturées par mois et année de la journée comptable, puis par date décroissante.
- Groupes repliables avec compteur; le mois le plus récent est ouvert initialement. Accès au journal et au détail préservé.
- Modification d'affichage uniquement, sans changement des écritures ni des clôtures.

## 2026-08-31 — Séparation emballage et vérification

- Emballage utilise exclusivement `packingStatus`; la vérification utilise `isVerified` et `verifiedAt` sans modifier l'emballage.
- Les compteurs, cases et validations d'emballage complet/partiel ne dépendent plus de la vérification.
- Une commande emballée peut être vérifiée ensuite. Les droits et protections cadeaux/dépôts restent inchangés.
- Aucune donnée existante réinitialisée : les anciennes vérifications peuvent provenir du couplage précédent et doivent être revues humainement si nécessaire.

## 2026-08-28 — Visibilité des commandes du site

- Les commandes web `À traiter` ne sont plus exclues de la liste générale des commandes.
- Dans Emballage, le filtre du jour utilise la date de prise en charge lorsqu'elle existe, au lieu de toujours utiliser la date de création web.
- Une commande créée la veille mais prise en charge aujourd'hui apparaît maintenant dans la file d'emballage du jour.
- Une commande `À traiter` doit toujours être prise en charge avant de pouvoir entrer dans l'emballage.

## 2026-08-28 — État « Pas emballé » commutable

- Le bouton `Pas emballé` fonctionne maintenant comme un interrupteur par produit.
- Un premier clic active l'état; un second clic le retire et remet le produit en attente.
- Chaque bascule est enregistrée dans l'historique de la commande.

## 2026-08-28 — Actions du détail emballage mobile

- Les actions par produit sont sorties de la ligne trop étroite et placées dans une grille tactile sur toute la largeur.
- Les boutons `Emballé`, `Pas emballé`, `Modifier stock` et `Alternative` restent maintenant visibles sur petit écran.
- Les actions de bas de fenêtre ont une hauteur tactile minimale et leurs libellés peuvent revenir proprement à la ligne.

## 2026-08-28 — Droits stock élargis depuis l'emballage

- ADMIN, DEVELOPER, PACKING, STOCK et COLLECTION peuvent désormais modifier depuis l'emballage les quantités, les emplacements et les seuils d'alerte.
- Le bouton et l'autorisation serveur utilisent la même liste de rôles.

## 2026-08-28 — Livraison retirée aux commerciaux

- Le bouton `Livré` n'est plus présenté aux commerciaux dans le détail d'une commande.
- Le serveur refuse désormais toute tentative commerciale de passage à `DELIVERED` ou `PARTIALLY_DELIVERED`.
- Le circuit de livraison reste disponible pour les rôles opérationnels et administratifs autorisés.

## 2026-08-28 — Contrôle des dépôts pour les expéditions

- Les commandes staff `Hors Abidjan` exigent désormais le moyen de paiement et le numéro ayant effectué le dépôt; la référence de transaction reste facultative.
- Ajout d'une file administrateur `Alertes expédition` avec les décisions `Reçu`, `Non reçu` et `À corriger`.
- Une décision négative déclenche chez le commercial responsable une alerte sonore persistante, avec appel client et correction directe des informations.
- Une correction replace automatiquement le dépôt en attente de vérification.
- Les nouvelles expéditions contrôlées ne peuvent pas passer à `PACKED`, `ON_DELIVERY` ou livrée avant confirmation du dépôt côté serveur.
- Les anciennes commandes et les commandes du site restent compatibles : seules les commandes portant un état de vérification sont bloquées.
- Schéma Prisma et script SQL manuel préparés dans `prisma/manual-migrations/20260828_add_expedition_deposit_verification.sql`; aucune écriture de base n'a été exécutée.

## 2026-08-28 — Quotas mensuels de cadeaux commerciaux

- Ajout d'un quota mensuel en quantité et d'un plafond facultatif en valeur pour chaque commercial.
- Les cadeaux promotionnels officiels sont exclus du quota; les cadeaux manuels conservent leur valeur réelle pour le suivi.
- Dépassement : motif obligatoire, création d'une demande administrateur, alerte dans le chat admin et cadeau placé en attente.
- Écran `Configuration > Cadeaux` pour régler les quotas et autoriser/refuser les demandes.
- Verrou transactionnel par commercial afin d'empêcher deux commandes simultanées de consommer le même solde.
- Les cadeaux en attente ou refusés sont bloqués au service emballage, côté interface et côté serveur.
- Les commandes annulées ou supprimées ne consomment plus le quota mensuel.
- Schéma Prisma et script SQL manuel préparés dans `prisma/manual-migrations/20260828_add_gift_quotas.sql`.
- Sécurité production : aucune migration et aucune écriture directe sur la base n'ont été exécutées.

## 2026-08-28 — Fiabilisation du service Emballage

- Fichiers : page/API d'emballage, checklist logistique, changement de statut et édition de stock.
- Accès à la file d'emballage et aux vérifications limité aux rôles logistiques autorisés.
- Une commande ne peut plus être déclarée emballée tant que tous ses articles ne sont pas vérifiés, y compris lors d'un traitement groupé.
- L'emballage partiel exige désormais une vraie sélection partielle et un motif indiquant les articles ou quantités manquants.
- Les modifications concurrentes de statut sont détectées avant la sortie de stock.
- Les commandes `ALTERNATIVE` sont visibles, la limite silencieuse de 300 commandes est retirée et les stocks/produits sont rafraîchis avec la file.
- La modification du stock depuis le modal d'emballage est réservée aux administrateurs, développeurs et gestionnaires de stock.
- Interface : actions impossibles désactivées, erreurs serveur explicites, sélection groupée fiabilisée et affichage initial limité aux commandes du jour; les anciennes restent accessibles avec le filtre `Tout`.
- Vérifications : TypeScript réussi; lint ciblé sans erreur (avertissements historiques sur les balises image uniquement).

### Amélioration de l'interface emballage

- Refonte mobile de l'en-tête, de la recherche, des filtres de statut et de période.
- Ajout du filtre entrepôt sur mobile, d'une sélection tactile et d'une barre d'action groupée flottante.
- Cartes commandes plus lisibles : image compacte, statut, progression renforcée et actions distinctes.
- Modal mobile complété avec les actions `Indisponible`, `Partiel` et `Emballé`, progression visuelle et checklist modernisée.
- Amélioration légère de la version ordinateur et du modal d'édition des stocks.
- Ajout de styles adaptés aux très petits écrans et à la préférence de réduction des animations.
- Barre supérieure mobile compactée après retour terrain : titre sur une ligne, icône et compteur réduits, recherche et filtres moins hauts.
- Correction de l'erreur d'hydratation mobile : le serveur et le navigateur utilisent désormais le même premier rendu avant la détection de la largeur d'écran.
- Correction de conception après précision métier : `Pas emballé` est un état porté par chaque produit de commande, et non par la commande entière.
- Ajout de `OrderItem.packingStatus` (`PENDING`, `PACKED`, `NOT_PACKED`), de boutons par article et d'un filtre listant les commandes qui contiennent au moins un produit non emballé.
- Schéma Prisma et script PostgreSQL manuel préparés; aucune modification de la base de production n'a été exécutée automatiquement.

## 2026-08-28 — Fiabilisation de la page Performance Équipe

- Fichiers : `modules/orders/actions/analytics-actions.ts`,
  `modules/orders/actions/status-actions.ts`,
  `app/zangochap-manager/admin/performance/page.tsx` et `PerformanceClient.tsx`.
- Correction de l'attribution des collectes par email, des périodes de livraison,
  des livraisons partielles et du chiffre d'affaires réellement encaissé.
- Les résumés utilisent désormais toute la période même si le détail reste limité
  aux 50 lignes les plus récentes; les filtres URL et les détails sont synchronisés.
- Refonte légère de l'interface Performance : période active visible, raccourcis
  complets, chargement, recherche effaçable, accessibilité et responsive mobile.
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

## 2026-09-10 — Prise en main du portail livreur
- Historique dédié avec recherche serveur, période personnalisée / date précise, raccourcis, statut et pagination de 30 résultats. Contrôle du rôle et de l’attribution, dates d’événement en UTC (Abidjan), repli anciennes commandes.
- Missions : filtres jour / retard / commune, cartes adaptatives, actualisation manuelle. Compte : guide de tournée, navigation tactile et zoom accessibles.
- Encaissements non réglés chargés indépendamment des 300 commandes récentes ; résolution des anciens identifiants d’emballeur par email.
- Tests sans base : scripts/test-rider-history.mjs (bornes, ancienneté, droits, pagination, trois fuseaux). TypeScript et lint ciblé vérifiés ; lint global avec dette historique. Pas de validation visuelle sur session mobile authentifiée.

## 2026-09-10 — Démonstration Rider temporaire autorisée
- 12 commandes fictives TEST-RIDER insérées en transaction dans zangochapdb après confirmation explicite de la cible distante. Articles personnalisés sans lien au catalogue ou au stock ; aucun compte modifié.
- scripts/rider-demo.mjs propose audit et insert, refuse les doublons ; fixtures dans scripts/fixtures/rider-demo.json.
- L’utilisateur demande leur suppression après les essais. Le manifeste local ignoré par Git scratch/rider-demo-manifest.json contient les IDs exacts. Le conserver ; vérifier les liens comptables, articles et éventuels effets des essais avant suppression ciblée. Ne jamais supprimer par préfixe seul.
- Vérification après insertion : 12 références présentes, attribuées au livreur cible. Ne pas recopier les identifiants de compte ou mots de passe dans la mémoire.

## 2026-09-10 — Présentation mobile Rider
- En-tête compact, résumé de tournée dans la zone défilante, navigation inférieure ancrée dans le conteneur plein écran, zones de sécurité iOS/Android.
- Thème blanc / ardoise / orange dans app/zangochap-rider/rider.css, cartes et fiches arrondies, contrôles tactiles, focus visible et mouvement réduit.
- Refactoring de présentation uniquement ; filtres et actions conservés. TypeScript et lint ciblé contrôlés ; validation visuelle sur appareil non effectuée.

## 2026-09-10 — Densité visuelle Rider
- Arrondis réduits à 6–10 px, fiches à 12 px ; espacements, cartes, en-tête et navigation resserrés.
- Historique : raccourcis et recherche visibles, période personnalisée et statut dans un panneau repliable avec résumé des filtres actifs. Cibles tactiles conservées.

## 2026-09-10 — Cartes de livraison compactes
- Référence et statut en tête, adresse prioritaire, client séparé, note compacte, pied avec date / quantité / montant contextualisé.
- Angles à 7 px, repère latéral par état, libellés encaissé / à encaisser, dates Abidjan. Aucun changement de mutation ou de données.

## 2026-09-10 — Caisse Rider
- Total non régularisé toutes dates avec ventilation articles / frais inclus ; point du jour distinct.
- Filtres aujourd’hui par défaut / toutes dates, recherche et état du règlement ; liste progressive par 15, ouverture du détail.
- Limite de l’historique réglé explicitée. Aucune écriture comptable ou changement des règles de règlement.

## 2026-09-10 — Profil Rider compact
- Identité, rôle et email lisibles ; compteurs liés aux missions et livraisons du jour.
- Accès rapides fonctionnels aux missions, caisse, historique et messagerie ; guide et aide repliables, confirmation locale de déconnexion.
- Présentation compacte, angles discrets ; aucune modification de compte ou de données.

## 2026-09-10 — Carte administrateur et suivi GPS volontaire
- Ajout /zangochap-manager/admin/rider-map, entrée Sidebar, carte Leaflet/OSM avec précision et état récent/ancien, filtres livreur/jour/heures UTC, historique plafonné à 10 000 points et lecture du parcours.
- RiderTracking : activation volontaire, cadence ~10 s en mouvement / 60 s stationnaire, arrêt immédiat et retry des notifications d'arrêt, aucun démarrage automatique. Arrière-plan web non garanti.
- Routes GPS avec rôle/origine/identité serveur, validation, session d'appareil, sérialisation transactionnelle des points et arrêts, limitation d'envoi et déduplication.
- Deux modèles Prisma et migration manuelle 20260910_add_rider_tracking.sql préparés ; client généré localement, aucune migration appliquée. Accord explicite requis pour zangochapdb. Historique sans purge automatique.
- Tests GPS sur base simulée et tests historique OK, TypeScript OK, lint ciblé OK ; lint global : 755 erreurs / 83 avertissements préexistants. Validation sur téléphone restant à faire après activation.

## 2026-09-10 — Points livreurs nominatifs
- Carte directe : nom visible sur chaque repère, clic ou clavier pour ouvrir la fiche (statut, dernier point, précision, téléphone cliquable si renseigné). Fiche maintenue ouverte aux actualisations. Téléphone ajouté à la sélection API admin uniquement ; aucune migration supplémentaire.

## 2026-09-10 — GPS automatique et discret
- À la demande du propriétaire, démarrage GPS à l’ouverture du portail avec permission navigateur ; tentative à la reconnexion si nécessaire, pas de boucle après refus GPS. Contrôle compact avec état visible, arrêt et détails repliables. Arrêt manuel conservé dans cet onglet jusqu’à réactivation, sans stockage de coordonnées. Aucune modification de base.

## 2026-09-10 — Couleurs des parcours
- Couleur stable dérivée de l’ID livreur sur repère, fiche, légende et tracé historique ; états anciens/arrêtés signalés en texte et pointillés. Accès « Voir le tracé du jour » après sélection d’un livreur en direct. Aucun chargement global des historiques ni changement DB.

## 2026-09-10 — Réglage GPS dans le profil
- Activation/désactivation déplacée dans Profil > Paramètres · Localisation. Écran principal limité à l’état GPS et un accès Paramètres. Contrôleur GPS toujours monté : changer d’onglet ne redémarre ni ne coupe le suivi. Démarrage par défaut et arrêt manuel mémorisé conservés.

## 2026-09-10 — Suppression autorisée du lot de démonstration Rider
- À la demande explicite du propriétaire, audit des 12 IDs du manifeste : 13 articles personnalisés, aucun lien stock, règlement, client, promotion, collecte ou cadeau.
- Sauvegarde locale ignorée Git dans scratch, puis suppression transactionnelle ciblée via scripts/cleanup-rider-demo.mjs. Vérification : 0 commande et 0 article restants pour ces IDs. Aucun compte supprimé.
- Manifeste conservé et marqué deleted avec chemin de sauvegarde. Le lot temporaire est nettoyé ; ne pas répéter sa suppression ni le recréer sans demande.

## 2026-09-10 — Nom du lieu sur la carte
- Recherche inverse au clic sur un point actuel ou historique, API admin avec validation et cache borné, délai réseau et limitation par processus. Affiche « Lieu proche », message explicite en cas de manque de couverture/service.
- Geoapify préparé : GEOAPIFY_API_KEY serveur nécessaire, non configurée pendant cette intervention. Aucun appel réel de coordonnées ni modification DB. Pas de requête périodique de géocodage.

## 2026-09-10 — Activation locale du géocodage
- Clé fournie par le propriétaire enregistrée uniquement dans .env ignoré par Git. Aucun secret dans le code ou la mémoire.
- Test Geoapify sur une position publique d’Abidjan : HTTP 200 et adresse reçue ; aucune position de livreur transmise.
- Configuration locale validée. Variable GEOAPIFY_API_KEY à renseigner également dans l’environnement de production avant redéploiement ; production non modifiée ici.

## 2026-09-10 — Flux direct et maintien d’écran
- SSE administrateur via LISTEN/NOTIFY PostgreSQL : signal après commit start/stop/point, snapshot authentifié rechargé, reconnexion et polling de secours. Aucun trigger/migration ; connexion directe optionnelle RIDER_STREAM_DATABASE_URL passée par Docker.
- RiderTracking utilise watchPosition avec rythme d’envoi conservé et heartbeat stationnaire. Paramètre optionnel « Garder l’écran allumé » via Wake Lock, libéré à l’arrêt ou arrière-plan, indépendant du montage des réglages.
- TypeScript, lint ciblé et tests GPS/SSE simulés passent. Tests physiques et déploiement non effectués ; aucune modification DB exécutée.

## 2026-09-10 — Comparaison de parcours et filtres GPS
- Comparaison jusqu’à 5 livreurs sélectionnés, couleurs stables et tracés masquables. API bornée à 2 000 points/personne en multi (10 000 en mono), totaux et avertissements explicites.
- Tracés regroupés par livreur avant découpe des sessions/interruptions ; lecture avec identification du livreur courant.
- Centrage automatique optionnel en direct, interrompu par navigation manuelle ; filtres par état GPS et âge des positions en secondes/minutes/heures.
- TypeScript et lint ciblé OK ; tests simulés API multi et segments OK. Aucun accès DB ni déploiement effectué.

## 2026-09-10 — Position administrateur et liaison locale
- Bouton Afficher ma position avec autorisation navigateur, précision/horodatage, masquage et liaison à vol d’oiseau au livreur ou au point historique sélectionné. Centrage explicite sur les deux points. Position conservée uniquement en mémoire de page, sans écriture DB.
- L’approbation automatique a rejeté le routage Geoapify et les liens Google Maps faute d’accord explicite pour transmettre les coordonnées administrateur/livreur à ces destinations. Aucune de ces fonctions n’a été ajoutée ou exécutée ; demander cet accord après livraison de la partie locale.
- TypeScript et lint ciblé vérifiés. Validation physique GPS non effectuée.
