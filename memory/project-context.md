# Contexte durable — ZangoChap Gest

Dernière vérification statique : 2026-08-26.

## Finalité

ZangoChap Gest est une application de commerce et d'exploitation couvrant la
boutique publique, le back-office multi-rôles et l'espace livreur. Elle gère le
cycle complet : catalogue, commande, préparation, stock, collecte, livraison,
encaissement, comptabilité, CRM, marketing et audit.

## Stack

- Next.js 15, App Router, React 19 et TypeScript strict.
- PostgreSQL avec Prisma 7 et l'adaptateur `pg`.
- Authentification staff par JWT HTTP-only (`jose`) et mots de passe `bcryptjs`.
- TanStack Query, Framer Motion, Tailwind CSS 4 et CSS modules/classique.
- Cloudflare R2 via API S3 pour les médias.
- WhatsApp Business Cloud API.
- Déploiement Docker en sortie Next.js standalone.

## Surfaces principales

- Public : `/`, `/shop`, `/search`, `/product/[id]`, `/cart`, `/compte`.
- Staff : `/zangochap-manager/**`.
- Livreur : `/zangochap-rider`.
- API : `app/api/**/route.ts`.

## Domaines métier

- `modules/orders` : commandes, statuts, livraison, settlement, analytics et stock lié.
- `modules/products` : produits, variantes, catégories, images et ruptures.
- `modules/logistics` : entrepôts, packing, vérification, collecte et étiquettes.
- `modules/accounting` : sessions, opérations, catégories, groupes, rapports et audits.
- `modules/auth` : sessions staff, comptes équipe et comptes clients.
- `modules/crm`, `marketing`, `whatsapp`, `cms`, `media`, `chat`, `notes`.
- `modules/automations` : règles, état, planification et file d'envoi stockés en JSON.
- `modules/developer` : diagnostics, audits, sauvegardes et outils privilégiés.

## Modèle et rôles

Rôles Prisma : `DEVELOPER`, `ADMIN`, `COMPTABLE`, `COMMERCIAL`, `PACKING`,
`COLLECTION`, `STOCK`, `POINT_RELAIS`, `CUSTOMER`, `LIVREUR`.

Entités centrales : `User`, `Product`, `ProductVariant`, `Warehouse`,
`StockLevel`, `StockMovement`, `Order`, `OrderItem`, `Settlement`, `Customer`,
`PromoCode`, `CollectionRecord`, entités comptables, chat et CMS.

## Invariants importants

- Emballage et vérification sont indépendants : `OrderItem.packingStatus` pour la préparation, `isVerified`/`verifiedAt` pour le contrôle. Ne jamais les synchroniser automatiquement.

- Une session staff doit être vérifiée côté serveur avant toute mutation.
- `getSession()` revalide actuellement l'utilisateur JWT en base.
- Le rôle développeur est autorisé implicitement par `ensureAuth()`.
- Les montants monétaires sont principalement stockés comme entiers.
- Le stock existe à trois niveaux : produit, variante et niveau par entrepôt.
- Toute mutation de commande peut avoir un impact sur stock, livraison et settlement.
- Les historiques de plusieurs entités sont conservés dans des champs JSON.
- Le décrément de stock intervient au passage à `PACKED`, dans la même transaction
  Prisma que le changement de statut.
- `TO_PROCESS` est réservé à l'entrée des commandes publiques et ne peut pas être
  choisi via l'action générique de changement de statut.
- Les statuts de clôture livraison (`RETURNED`, `CANCELLED`, `REPRO_DISPO`)
  exigent un motif ; `REPRO_DISPO` exige aussi une nouvelle date.
- Les nouvelles commandes staff `Hors Abidjan` portent un contrôle de dépôt. Tant
  que `depositVerificationStatus` n'est pas `RECEIVED`, elles ne peuvent pas être
  emballées ni passer en livraison. Les anciennes commandes sans état restent compatibles.
- Une commande clôturée ne peut être rouverte après rattachement à un settlement.
- La livraison partielle mutile actuellement les lignes livrées et crée des lignes
  de retour : toute correction ultérieure doit tenir compte de cette transformation.

## Flux métier observés

### Commande publique et staff

- La boutique publique couvre catalogue, recherche, fiche produit, panier et compte.
- Les commandes staff et publiques convergent dans `modules/orders/actions`.
- Les commandes publiques entrent dans la file `TO_PROCESS`; prise en charge,
  confirmation, packing, livraison et règlement sont ensuite opérés côté staff.
- Les façades `modules/orders/actions/index.ts` et `modules/products/actions/index.ts`
  sont les points d'import à privilégier depuis l'extérieur des modules.

### Stock

- `StockLevel` est la source détaillée par variante et entrepôt.
- `ProductVariant.stock` est un agrégat des niveaux d'entrepôt et `Product.stock`
  est un agrégat des variantes.
- Les sorties créent des `StockMovement` et consomment plusieurs niveaux si besoin.
- L'idempotence reste pilotée principalement par `Order.stockDecremented`.
- Les retours cherchent les mouvements de vente précédents pour choisir l'entrepôt,
  mais le modèle ne relie pas un mouvement à une ligne de commande précise.

### Livraison et règlement

- L'assignation livreur, les statuts terrain, les tentatives et les corrections admin
  sont répartis entre `delivery-actions.ts` et `status-actions.ts`.
- `amountReceived` est distinct du total théorique et alimente le settlement.
- Un `Settlement` agrège plusieurs commandes et sépare produits/frais au niveau global,
  sans lignes de snapshot immuables par commande.
- `REPRO_DISPO` représente une tentative clôturée/replanifiée sur la même commande,
  tandis qu'un autre flux de reprogrammation peut dupliquer la commande : cette
  dualité doit être clarifiée avant tout changement de comportement.

### Comptabilité et intégrations

- La comptabilité est structurée en sessions journalières, opérations, catégories,
  groupes, rapports et journaux d'audit.
- Une contrainte unique évite deux opérations comptables `DELIVERY` pour le même
  identifiant de commande.
- WhatsApp utilise la Cloud API et conserve réglages/journaux opérationnels via CMS.
- Les médias peuvent être envoyés vers Cloudflare R2; `public/uploads` reste monté
  en volume dans Docker.
- Chat et alertes rider utilisent notamment SSE et une file d'événements en mémoire.

## État technique vérifié

- 361 fichiers hors dépendances, build et uploads lors du comptage du 2026-08-26,
  dont 291 fichiers TypeScript/TSX.
- `npx.cmd tsc --noEmit --incremental false` réussit.
- Le dernier audit lint documenté reste en échec massif; il n'a pas été relancé le
  2026-08-26 afin de ne pas confondre dette historique et analyse de connaissance.
- Aucun framework de test structuré n'est déclaré dans `package.json`.
- Beaucoup de composants sont encore très volumineux et orientés client.
- Environ 811 occurrences textuelles de `any` ont été relevées dans `app`, `modules`,
  `lib` et `components`; seulement 7 fichiers importent actuellement Zod.

## Risques connus

1. Transitions de statuts de commande dispersées, sans machine à états centrale.
2. Idempotence du stock partiellement fondée sur le booléen global `stockDecremented`.
3. Restauration de stock multi-entrepôts potentiellement approximative.
4. Settlement sans snapshot immuable détaillé par commande.
5. Validation Zod inégale ; plusieurs frontières serveur utilisent encore `any`.
6. Autorisations et validation inégales : certaines frontières vérifient seulement
   l'authentification et beaucoup de payloads utilisent encore `any`.
7. Authentification client basée sur un cookie d'identifiant non signé.
8. Inscription client sans schéma serveur robuste; le modèle `User.email` obligatoire
   rend aussi le contrat du formulaire client particulièrement sensible.
9. API promos désormais protégée, mais validation de payload incomplète et suppression
   physique des usages lors de la suppression d'un code.
10. SSE et événements internes en mémoire, donc non partagés entre plusieurs instances.
11. `middleware.ts` et `proxy.ts` coexistent avec la même garde; surveiller la convention
   attendue lors des montées de version Next.js.
12. Duplication probable de plusieurs composants de fiche produit.
13. Dette ESLint importante et absence de tests automatisés complets.
14. Très gros composants clients (jusqu'à ~186 Ko pour `OrdersClient.tsx`) qui
   concentrent état, calculs, modales et rendu.

## Correctifs de sécurité déjà présents (ne pas les régresser)

- `getSession()` vérifie le JWT puis recharge l'utilisateur courant en base.
- En production, un `JWT_SECRET` absent ou égal à l'ancien secret compromis échoue fermé.
- `lib/prisma.ts` réutilise correctement le singleton global en développement.
- `app/api/promos/route.ts` exige désormais un rôle admin/développeur et dérive
  `creatorId` de la session.
- `scripts/start-prod.sh` n'exécute plus aucune migration ni `db push` automatique.
- Le démarrage Docker exige explicitement `DATABASE_URL` et `JWT_SECRET`.

## Fichiers à consulter selon la tâche

- Authentification : `modules/auth/actions.ts`, `lib/auth.ts`, `lib/staff-route-guard.ts`.
- Base de données : `prisma/schema.prisma`, `lib/prisma.ts`.
- Commandes : `modules/orders/actions/` et `modules/orders/components/`.
- Stock : `modules/orders/actions/stock.ts`, `modules/logistics/warehouseActions.ts`.
- Livraison : `modules/orders/actions/delivery-actions.ts` et pages admin/livreur.
- Settlement : `modules/orders/actions/settlement-actions.ts`.
- Comptabilité : `modules/accounting/actions.ts` et `app/zangochap-manager/accounting/`.
- Déploiement : `Dockerfile`, `docker-compose.yml`, `scripts/start-prod.sh`.

## Priorités recommandées

1. Centraliser et tester les transitions de commande.
2. Rendre les mouvements de stock idempotents par ligne et entrepôt.
3. Ajouter des snapshots de settlement.
4. Uniformiser validation et autorisation aux frontières serveur.
5. Sécuriser l'authentification client.
6. Remplacer le cookie client non signé par une session vérifiable et valider
   strictement inscription/connexion client.
7. Découper les composants monolithiques et ajouter des tests de parcours.

## Discipline d'intervention

- Ne jamais lancer de migration, seed, réparation ou écriture de données sans accord
  explicite du propriétaire; commencer par un audit en lecture seule.
- Considérer `prisma/schema.prisma`, le code et `AGENT.md` comme sources d'autorité.
- `AGENT.md` mentionne un `AGENTS.md` obligatoire, mais aucun fichier de ce nom
  n'existait dans le dépôt au 2026-08-26 : ne pas inventer ses règles.
- Préserver les modifications locales et vérifier `git status --short` avant édition.
- Après code : exécuter TypeScript, puis lint en distinguant les erreurs préexistantes.
