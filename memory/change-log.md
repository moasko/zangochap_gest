# Journal de mémoire IA

Les entrées les plus récentes sont placées en premier.

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
