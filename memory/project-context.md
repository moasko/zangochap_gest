# Contexte durable — ZangoChap Gest

Dernière vérification statique : 2026-08-17.

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

- Une session staff doit être vérifiée côté serveur avant toute mutation.
- `getSession()` revalide actuellement l'utilisateur JWT en base.
- Le rôle développeur est autorisé implicitement par `ensureAuth()`.
- Les montants monétaires sont principalement stockés comme entiers.
- Le stock existe à trois niveaux : produit, variante et niveau par entrepôt.
- Toute mutation de commande peut avoir un impact sur stock, livraison et settlement.
- Les historiques de plusieurs entités sont conservés dans des champs JSON.

## État technique vérifié

- Environ 362 fichiers hors dépendances lors de l'analyse du 2026-08-17.
- `npx.cmd tsc --noEmit --incremental false` réussit.
- `npm.cmd run lint` échoue avec 851 problèmes : 768 erreurs et 83 avertissements.
- Aucun framework de test structuré n'est déclaré dans `package.json`.
- Beaucoup de composants sont encore très volumineux et orientés client.

## Risques connus

1. Transitions de statuts de commande dispersées, sans machine à états centrale.
2. Idempotence du stock partiellement fondée sur le booléen global `stockDecremented`.
3. Restauration de stock multi-entrepôts potentiellement approximative.
4. Settlement sans snapshot immuable détaillé par commande.
5. Validation Zod inégale ; plusieurs frontières serveur utilisent encore `any`.
6. Autorisations inégales : certaines routes vérifient seulement l'authentification.
7. Authentification client basée sur un cookie d'identifiant non signé.
8. `lib/prisma.ts` supprime actuellement le singleton global avant de le recréer.
9. `scripts/start-prod.sh` utilise `prisma db push --accept-data-loss`.
10. SSE et événements internes en mémoire, donc non partagés entre plusieurs instances.
11. Duplication probable de plusieurs composants de fiche produit.
12. Dette ESLint importante et absence de tests automatisés complets.

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
6. Remplacer `db push --accept-data-loss` par des migrations contrôlées.
7. Découper les composants monolithiques et ajouter des tests de parcours.

