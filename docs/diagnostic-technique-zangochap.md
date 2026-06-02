# Diagnostic technique approfondi - ZangoChap Gest

Date du diagnostic : 29 mai 2026  
Perimetre : application Next.js, modules metier, roles, automatisations, routes API, base Prisma/PostgreSQL, UX staff/livreur/admin.

## 1. Resume executif

L'application couvre deja beaucoup de flux metier : commande publique, panier, CRM, affectation commerciale, packing, verification, livraison, encaissement livreur, stock, promos, CMS et console developpeur. Le socle est fonctionnel, mais il y a une dette importante autour de la securite API, de la coherence des statuts de livraison, de la fiabilite stock/encaissement et de la maintenabilite des gros composants client.

Les points les plus critiques trouves sont :

1. Des routes API sensibles ne verifient pas la session ni le role, notamment `app/api/promos/route.ts` et `app/api/migrate-passwords/route.ts`.
2. Le client Prisma est reinitialise de force dans `lib/prisma.ts`, ce qui peut recreer des pools PostgreSQL et provoquer des fuites de connexions en developpement ou sous charge.
3. Les sessions JWT restent valides jusqu'a 7 jours sans revalidation DB : un utilisateur supprime ou a qui on retire un role peut garder l'acces jusqu'a expiration du cookie.
4. Les statuts `REPROGRAMMED` et `REPRO_DISPO` ne representent pas clairement le meme concept selon les endroits : creation d'une nouvelle commande, reprogrammation livreur pour demain, retour dans la liste active, historique, stock et encaissement.
5. Le stock est gere avec un booleen global `stockDecremented`, pas au niveau ligne/mouvement. Cela rend les annulations partielles, les retours et les reouvertures difficiles a rendre parfaitement idempotents.
6. Le module encaissement a ete ameliore pour travailler par date de livraison unique, mais l'ancien historique et certaines statistiques continuent d'exister avec des logiques differentes.
7. `npm run lint` echoue avec 892 problemes, dont 809 erreurs, ce qui montre une dette de qualite importante meme si `npx tsc --noEmit` passe.
8. Plusieurs composants client sont tres volumineux, par exemple `modules/orders/components/OrdersClient.tsx` fait environ 182 Ko. Cela ralentit la maintenance, augmente le risque de regressions et charge trop de logique cote navigateur.

## 2. Cartographie rapide

### Stack

- Framework : Next.js 15.2.1 avec App Router.
- UI : React 19, composants client nombreux, icones lucide-react.
- DB : PostgreSQL via Prisma 7.8 et `@prisma/adapter-pg`.
- Auth : cookie `zc_session` signe en JWT avec `jose`, mot de passe `bcryptjs`.
- Metier : commandes, produits, variants, stock, entrepots, livreurs, commerciaux, packing, settlements, promos, CRM, CMS.

### Roles declares

Dans `prisma/schema.prisma` :

- `DEVELOPER`
- `ADMIN`
- `COMMERCIAL`
- `PACKING`
- `COLLECTION`
- `STOCK`
- `CUSTOMER`
- `LIVREUR`

Les roles sont utiles, mais leur application est encore heterogene : parfois `ensureAuth`, parfois `getSession`, parfois des conditions directes, parfois aucune verification dans les routes API.

### Cycle commande observe

1. Commande publique ou staff creee.
2. Attribution commerciale, souvent via round-robin.
3. Confirmation et passage vers preparation.
4. Packing / verification / etiquettes.
5. Affectation livreur.
6. Livreurs valident : livre, partiellement livre, retourne, annule, repro-dispo.
7. Admin encaisse par livreur/date de livraison.
8. Historique et stats.

Le flux est logique dans l'intention, mais plusieurs transitions ne sont pas formalisees dans une machine d'etat unique. Chaque module applique une interpretation locale.

## 3. Securite et controle d'acces

### Critique - routes API sensibles sans protection

`app/api/promos/route.ts` permet de creer, modifier et supprimer des codes promo sans `getSession` ni `ensureAuth`.

Impact :

- Toute personne capable d'appeler la route peut creer une promo.
- Toute personne capable d'appeler la route peut modifier une promo existante.
- La suppression efface aussi les usages via `promoUsage.deleteMany`, ce qui detruit une partie de l'historique commercial.

Correction recommandee :

- Ajouter `ensureAuth(["admin"])` ou `ensureAuth(["developer", "admin"])`.
- Ne pas accepter `creatorId` depuis le body : utiliser l'utilisateur connecte.
- Valider le body avec Zod.
- Journaliser creation/modification/suppression.

`app/api/migrate-passwords/route.ts` execute une migration de mots de passe en `GET`, sans auth.

Impact :

- Un endpoint public peut relancer une operation sensible sur tous les utilisateurs.
- C'est dangereux en production, meme si la logique ignore les hashes bcrypt existants.

Correction recommandee :

- Supprimer cette route de production.
- Transformer en script CLI protege si besoin.
- A minima exiger `ensureAuth(["developer"])`, utiliser `POST`, et ajouter un secret operationnel.

### Eleve - session JWT non revalidee en base

Dans `modules/auth/actions.ts`, `getSession()` verifie le JWT mais ne recharge pas l'utilisateur depuis la base.

Impact :

- Si un admin supprime un utilisateur, son cookie peut rester valide jusqu'a 7 jours.
- Si un role change, l'ancien role reste dans le JWT.
- Il n'y a pas de champ `isActive`, `disabledAt` ou `sessionVersion`.

Correction recommandee :

- Ajouter `User.isActive`, `User.sessionVersion` ou `User.tokenVersion`.
- Revalider en base dans les zones staff critiques.
- Incremente `sessionVersion` lors d'un changement de mot de passe, role ou desactivation.
- Reduire la duree des sessions staff si necessaire.

### Eleve - protection staff amelioree mais a surveiller

Un garde de routes staff existe maintenant via `middleware.ts`, `proxy.ts` et `lib/staff-route-guard.ts`.

Point positif :

- Les pages `/zangochap-manager`, `/zangochap-rider` et zones staff peuvent rediriger vers login si le cookie est absent ou invalide.

Risque residuel :

- Les actions serveur et routes API doivent rester auto-protegees. Le middleware ne protege pas les appels internes si une route oublie son controle.
- `app/zangochap-manager/layout.tsx` rend encore les enfants si aucun utilisateur n'est detecte ; il compte sur le middleware. Ce n'est pas suffisant comme seule barriere.

Correction recommandee :

- Standardiser : chaque route API ou server action sensible doit commencer par `ensureAuth`.
- Creer une matrice role -> permissions et l'utiliser partout.

## 4. Base de donnees et Prisma

### Critique - risque de fuite de connexions Prisma

Dans `lib/prisma.ts`, la ligne `delete (globalThis as any).prisma;` detruit le singleton global avant de le reutiliser.

Impact :

- Le pool PostgreSQL peut etre recree a chaque import/hot reload.
- Sous developpement ou environnement serverless mal configure, cela peut multiplier les connexions.
- Les logs `Initializing Prisma Client with Pool...` peuvent apparaitre trop souvent.

Correction recommandee :

- Retirer le `delete`.
- Conserver un singleton stable :

```ts
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient(...);
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
export default prisma;
```

### Moyen - index DB incomplets pour les flux livraison/settlement

Le schema a des index utiles sur certains champs, mais les ecrans recents filtrent beaucoup par :

- `deliveryDate`
- `deliverymanId`
- `settlementId`
- `status + deliveryDate`
- `deletedAt + status`
- `paymentMethod`

Correction recommandee :

- Ajouter des index Prisma adaptes aux requetes reelles.
- Priorite : `Order(deliveryDate)`, `Order(deliverymanId, deliveryDate)`, `Order(settlementId)`, `Order(status, deliveryDate)`, `Order(deletedAt, status)`.

### Moyen - historique JSON difficile a auditer

`Order.history` est un JSON libre.

Impact :

- Difficile de requeter proprement les actions.
- Difficile de garantir un format.
- Difficile de produire un audit fiable par utilisateur/date/action.

Correction recommandee :

- Creer une table `OrderEvent` avec `orderId`, `type`, `fromStatus`, `toStatus`, `actorId`, `note`, `createdAt`.
- Garder `history` seulement comme cache d'affichage si besoin.

## 5. Commandes

### Eleve - creation commande et promo pas totalement atomiques

Dans `modules/orders/actions/order-actions.ts` :

- Les images sont uploadees avant la creation DB.
- Le client est upserte avant la validation complete promo.
- `PromoUsage` est cree apres la commande, hors transaction, et l'erreur est seulement loggee.

Impact :

- Une commande qui echoue peut quand meme modifier les statistiques client.
- Une promo utilisee peut ne pas etre enregistree si l'ecriture `PromoUsage` echoue.
- Une limite d'utilisation promo peut etre contournee en cas de concurrence.

Correction recommandee :

- Mettre validation promo, creation commande, creation items, usage promo et mise a jour client dans une transaction.
- Ajouter contrainte unique adaptee pour les promos "une fois par telephone/client".
- Ne pas avaler l'erreur de `PromoUsage`.

### Eleve - reprogrammation incoherente

Il existe deux concepts proches :

- `reprogramOrder(orderId, deliveryDate)` cree une nouvelle commande en statut `REPROGRAMMED`, puis met l'ancienne en `REPRO_DISPO`.
- `updateOrderStatus(orderId, "REPRO_DISPO")` transforme la commande courante : date de livraison demain, livreur vide, type `Repro-dispo`.

Impact :

- L'historique peut contenir a la fois une ancienne commande `REPRO_DISPO` et une nouvelle commande `REPROGRAMMED`.
- Les listes, stats, packing, labels et settlements peuvent compter differemment selon le statut.
- Le livreur voit "reprogrammees", l'admin voit "repro-dispo", et le stock peut rester decremente.

Correction recommandee :

- Definir une seule politique :
  - soit `REPRO_DISPO` signifie "echec livreur, a replanifier",
  - soit `REPROGRAMMED` signifie "nouvelle tentative planifiee".
- Ajouter un lien explicite `reprogrammedFromOrderId` / `reprogrammedToOrderId`.
- Ne pas utiliser `createdAt` pour simuler une date de livraison.
- Ne jamais melanger date de creation et date de livraison.

### Moyen - filtre commandes par defaut trop restrictif

Dans `modules/orders/actions/queries.ts`, `from` et `to` prennent la date du jour par defaut.

Impact :

- L'ecran commandes peut masquer des commandes anciennes sans que l'utilisateur comprenne pourquoi.
- Les equipes peuvent croire qu'une commande a disparu.

Correction recommandee :

- Afficher explicitement "Aujourd'hui" comme filtre actif.
- Proposer "7 jours", "30 jours", "Toutes non cloturees".
- Garder les commandes problematiques visibles meme si elles ne sont pas du jour.

### Moyen - detection des livreurs incorrecte dans une requete

Dans `modules/orders/actions/queries.ts`, `deliverymen` est calcule avec `staffUsers.filter((user) => user.phone)`.

Impact :

- Un commercial, admin ou autre role avec telephone peut apparaitre comme livreur.
- Cela peut fausser les affectations et les filtres.

Correction recommandee :

- Filtrer par `role === "LIVREUR"`.
- Eventuellement exiger `phone` en plus pour l'affichage.

## 6. Livraison et livreurs

### Point positif recent

Une action admin `reopenDeliveryOrder` existe maintenant pour rouvrir une commande cloturee vers `ON_DELIVERY`, avec blocage si la commande est deja rattachee a un settlement.

C'est une amelioration importante parce que les livreurs validaient sans possibilite de retour arriere.

### Risque residuel - reouverture partielle

La reouverture remet le statut a `ON_DELIVERY`, mais ne reconstruit pas automatiquement les lignes modifiees par une livraison partielle.

Impact :

- Si `markPartialDelivery` a reduit les quantites et cree des lignes retour, l'admin peut rouvrir le statut sans retrouver exactement la commande initiale.
- Le stock peut ne pas revenir a un etat parfaitement coherent.

Correction recommandee :

- Pour les livraisons partielles, afficher une alerte forte.
- Ajouter une action dediee "annuler livraison partielle" qui restaure items, montants, stock et mouvements.
- Preferer une table d'evenements/mouvements plutot que muter les items originaux.

### Moyen - historique livraison groupe par date technique

Dans l'admin livraison, l'historique est groupe par timestamp technique (`updatedAt` ou `createdAt`) dans certaines zones, alors que le settlement travaille par `deliveryDate`.

Impact :

- L'admin peut chercher une commande a la date de livraison et la voir rangee a une autre date.
- Les chiffres "historique livraison" et "encaissement" peuvent paraitre incoherents.

Correction recommandee :

- Standardiser : les vues operationnelles livraison et settlement doivent utiliser `deliveryDate`.
- Garder `createdAt` pour l'audit, pas pour le planning.

## 7. Encaissement livreurs

### Point positif recent

Le nouveau dashboard settlement travaille avec une date de livraison unique, ce qui correspond mieux au besoin terrain : l'admin choisit la date de livraison et voit les commandes a encaisser, les retours et l'historique associe.

### Moyen - ancienne logique encore presente

`modules/orders/actions/settlement-actions.ts` contient encore `getSettlementHistory()` avec une logique historique differente, limitee et basee sur les settlements.

Impact :

- Deux ecrans ou deux appels peuvent raconter une histoire differente.
- Risque de regression si une ancienne page reutilise l'ancienne action.

Correction recommandee :

- Deprecier explicitement l'ancienne fonction.
- Centraliser les calculs dans un service settlement unique.
- Ajouter des tests sur les totaux par date de livraison.

### Moyen - montant settlement non snapshotte par commande

Un settlement relie des commandes, mais il n'y a pas de snapshot detaille par commande du montant produit, frais livraison, montant recu et methode au moment de l'encaissement.

Impact :

- Si une commande est modifiee apres coup, l'historique recalcule peut diverger du montant reel encaisse.
- Difficile d'auditer les ecarts caisse.

Correction recommandee :

- Ajouter `SettlementLine` : `settlementId`, `orderId`, `grandTotalAtSettlement`, `amountReceivedAtSettlement`, `deliveryFeeAtSettlement`, `paymentMethodAtSettlement`.
- Garder le total settlement comme somme des lignes.

### Faible/Moyen - allocation paiement frais/produits discutable

`getOrderSettlementAmounts` attribue d'abord le montant recu aux frais de livraison, puis au produit.

Impact :

- Sur paiement partiel, les stats "produit vs livraison" peuvent etre comptablement discutables.

Correction recommandee :

- Confirmer la regle metier avec l'equipe.
- Documenter la formule.
- Eventuellement stocker ce detail au moment du settlement.

## 8. Stock et inventaire

### Eleve - idempotence fragile

Le stock repose beaucoup sur `stockDecremented` au niveau commande.

Impact :

- Une commande avec plusieurs variants, plusieurs entrepots ou une livraison partielle ne peut pas etre restauree avec une precision parfaite uniquement via ce booleen.
- Les retours et reouvertures peuvent devenir incoherents.

Correction recommandee :

- Gerer l'idempotence par `StockMovement` referencee a `orderId + orderItemId + variantId`.
- Ajouter une contrainte empechant deux decrements actifs pour la meme ligne commande.
- Restaurer en utilisant les mouvements exacts de sortie, pas seulement le dernier mouvement de vente.

### Moyen - restauration entrepot approximative

`restoreStockForOrder` restaure vers l'entrepot du dernier mouvement `SALE` trouve pour le variant.

Impact :

- Si plusieurs entrepots ont servi une commande, la restauration peut revenir dans le mauvais entrepot.

Correction recommandee :

- Restaurer mouvement par mouvement avec quantite et warehouseId d'origine.

### Moyen - performance stock

Les fonctions stock font plusieurs requetes dans des boucles : recuperation variant, niveaux, mouvements, recalcul produit.

Impact :

- Sur commandes multi-lignes ou imports, cela peut devenir lent.

Correction recommandee :

- Precharger les variants et stock levels.
- Grouper les mises a jour.
- Eviter de recalculer tout le stock produit apres chaque ligne.

## 9. Promos et marketing

### Critique - API promos non protegee

Voir section securite. C'est le point le plus urgent du module promo.

### Moyen - concurrence sur limites d'utilisation

La validation compte les usages existants avant creation.

Impact :

- Deux commandes simultanees peuvent passer une limite globale ou une limite par telephone si aucune contrainte DB ne verrouille l'usage.

Correction recommandee :

- Transaction + contrainte unique lorsque la regle le permet.
- Pour limite globale, verrouiller la promo ou utiliser une colonne compteur mise a jour atomiquement.

### Moyen - suppression destructive

La route API supprime les usages avant de supprimer le code.

Impact :

- Perte d'historique commercial.

Correction recommandee :

- Desactiver (`isActive=false`) au lieu de supprimer.
- Garder les usages.

## 10. Packing, verification, etiquettes

Les modules existent et semblent couvrir les besoins operationnels. Les risques principaux sont transverses :

- Statuts de commande pas centralises.
- `REPRO_DISPO` exclu dans certains flux d'impression ou de feuille livraison, mais pas forcement partout.
- Polling frequent dans certains composants (`refetchInterval` a 3s ou 10s).
- Gros composants client qui melangent filtres, modales, actions, rendu et export.

Correction recommandee :

- Centraliser les transitions statut.
- Avoir une fonction unique `isPrintableOrder`, `isPackableOrder`, `isDeliverySheetOrder`.
- Ajouter des tests sur chaque statut.

## 11. CRM et dashboard

### Moyen - chargements volumineux

Exemples :

- `app/zangochap-manager/admin/crm/page.tsx` charge jusqu'a 5000 commandes avec items.
- `app/zangochap-manager/dashboard/CommercialDashboard.tsx` charge jusqu'a 1000 commandes.
- `modules/orders/actions/queries.ts` charge beaucoup de produits/variants/images pour la page nouvelle commande.

Impact :

- Requetes lourdes.
- HTML/RSC payload plus gros.
- Latence staff sur base de donnees reelle.

Correction recommandee :

- Pagination serveur.
- Agregations SQL/Prisma au lieu de charger puis reduire.
- Projections strictes avec `select`.
- Caches courts pour stats non critiques.

## 12. Frontend, UX et maintenabilite

### Eleve - composants client trop gros

Plus gros fichiers hors `node_modules` :

- `modules/orders/components/OrdersClient.tsx` : environ 182 Ko.
- `app/zangochap-manager/developer/logs/DeveloperConsoleClient.tsx` : environ 93 Ko.
- `modules/products/components/ProductForm.tsx` : environ 57 Ko.
- `modules/orders/components/NewOrderClient.tsx` : environ 53 Ko.
- `app/zangochap-manager/admin/delivery/AdminDeliveryClient.tsx` : environ 51 Ko.
- `app/zangochap-rider/DeliveryClient.tsx` : environ 42 Ko.

Impact :

- Difficile a relire et corriger.
- Tests unitaires plus difficiles.
- Risque eleve de regressions UX.
- Plus de logique et d'etat cote navigateur.

Correction recommandee :

- Decouper par responsabilite : filtres, tableau, modales, actions, exports, hooks.
- Remonter les calculs lourds cote serveur.
- Utiliser des composants memoises seulement apres simplification.

### Moyen - textes corrompus / encodage

Plusieurs messages contiennent du mojibake, par exemple `terminÃ©e`, `Non authentifiÃ©`, etc.

Impact :

- UX non professionnelle.
- Recherche textuelle et support plus difficiles.

Correction recommandee :

- Normaliser les fichiers en UTF-8.
- Remplacer les chaines corrompues.
- Ajouter une verification simple dans CI sur les sequences `Ã`, `�`.

### Moyen - memoire navigateur avec images base64

Les formulaires produits/commandes manipulent des images en data URL.

Impact :

- Les data URLs sont plus lourdes que les fichiers binaires.
- Gros risque de lenteur ou crash mobile si plusieurs images sont ajoutees.

Correction recommandee :

- Uploader les fichiers en streaming/form-data.
- Compresser/redimensionner avant preview.
- Liberer les previews via object URLs si utilisees.

## 13. Performance et automatisations

### Polling

Plusieurs zones utilisent du polling :

- Sidebar : 60s.
- Commandes a traiter / non packed : 10s.
- Verification logistics : 3s.

Impact :

- Acceptable a petite echelle, mais couteux si beaucoup d'utilisateurs staff restent connectes.

Correction recommandee :

- Allonger les intervalles sur les pages non critiques.
- Rafraichir apres mutation.
- Envisager SSE/WebSocket plus tard pour les flux temps reel.

### Build et lint

Verification effectuee :

- `npx.cmd tsc --noEmit` : passe.
- `npm.cmd run lint` : echoue avec 892 problemes, dont 809 erreurs et 83 warnings.

Les erreurs principales :

- `any` massif.
- imports inutilises.
- textes JSX non echappes.
- `<img>` au lieu de `next/image`.
- fichiers scratch/scripts inclus dans le lint.

Correction recommandee :

- Exclure `scratch/` du lint ou le nettoyer.
- Corriger les routes API critiques en premier.
- Mettre une politique "pas de nouvelle erreur lint" sur les fichiers touches.
- Decouper la correction lint par module.

## 14. Explication concrete : commandes reprogrammees et repro-dispo

### Ce qui se passe aujourd'hui

Il y a deux chemins differents.

Chemin A : reprogrammation depuis l'interface commande.

1. On appelle `reprogramOrder(orderId, deliveryDate)`.
2. Le systeme lit la commande originale.
3. Il cree une nouvelle commande avec la nouvelle date.
4. La nouvelle commande a le statut `REPROGRAMMED`.
5. L'ancienne commande est mise en `REPRO_DISPO`.

Chemin B : livreur/admin met directement `REPRO_DISPO`.

1. On appelle `updateOrderStatus(orderId, "REPRO_DISPO", note)`.
2. Le systeme impose une date de livraison a demain.
3. Le livreur est retire.
4. Le type devient `Repro-dispo`.
5. La commande reste la meme, mais son statut change.

### Probleme metier

Ces deux chemins ne racontent pas la meme histoire :

- Dans le chemin A, on a deux commandes.
- Dans le chemin B, on a une seule commande modifiee.
- Dans certains ecrans, `REPRO_DISPO` est un echec a retraiter.
- Dans d'autres, c'est une reprogrammation.
- `REPROGRAMMED` peut representer la nouvelle commande, mais ce n'est pas toujours clair pour les stats.

### Proposition professionnelle

Adopter cette definition :

- `REPRO_DISPO` : tentative echouee, commande disponible pour reprogrammation.
- `REPROGRAMMED` : nouvelle tentative planifiee.

Regles :

1. Un livreur ne cree jamais une nouvelle commande. Il met seulement `REPRO_DISPO` avec motif.
2. L'admin transforme une commande `REPRO_DISPO` en nouvelle tentative avec une date choisie.
3. Le lien entre ancienne et nouvelle tentative est stocke en base.
4. Le stock n'est pas redecremente si c'est la meme marchandise deja sortie, sauf retour physique confirme.
5. Les settlements excluent `REPRO_DISPO` de l'encaissement mais l'affichent dans retours/echecs par date de livraison.

## 15. Priorisation recommandee

### Urgence 0-48h

1. Proteger `app/api/promos/route.ts`.
2. Supprimer ou proteger `app/api/migrate-passwords/route.ts`.
3. Corriger `lib/prisma.ts` pour arreter de supprimer le singleton.
4. Remplacer `deliverymen: staffUsers.filter((user) => user.phone)` par un filtre role `LIVREUR`.
5. Ajouter des tests minimaux sur login/logout, redirection staff et API promos.

### Court terme 1 semaine

1. Formaliser les transitions de statuts dans un module unique.
2. Clarifier `REPRO_DISPO` vs `REPROGRAMMED`.
3. Ajouter une table ou structure de snapshot settlement.
4. Ajouter indexes DB livraison/settlement.
5. Corriger les textes corrompus les plus visibles.
6. Decouper `AdminDeliveryClient` et `SettlementClient` en sous-composants.

### Moyen terme 1 mois

1. Refaire l'idempotence stock par mouvement et par ligne commande.
2. Ajouter `OrderEvent` pour audit.
3. Revoir CRM/dashboard avec pagination et agregations.
4. Decouper `OrdersClient.tsx`.
5. Mettre une CI qui bloque les nouvelles erreurs lint.
6. Ajouter tests Playwright sur flux complet : commande -> packing -> livraison -> settlement -> reouverture admin.

## 16. Matrice de tests a ajouter

### Auth et roles

- Commercial deconnecte : redirection login sur pages staff.
- Commercial connecte : acces seulement aux pages autorisees.
- Admin : acces livraison, settlement, promos.
- Livreur : acces rider, pas admin.
- Utilisateur supprime/desactive : session rejetee.

### Commandes

- Creation avec promo valide.
- Creation avec promo depassee.
- Deux commandes concurrentes avec promo limitee.
- Reprogrammation par admin.
- Passage en `REPRO_DISPO` par livreur.

### Livraison

- Livreur livre une commande.
- Admin rouvre une commande livree non settlement.
- Admin ne peut pas rouvrir une commande deja settlement.
- Livraison partielle puis tentative de reouverture.

### Settlement

- Date de livraison unique.
- Encaissement d'un livreur.
- Historique par date de livraison.
- Retours/contact commercial.
- Methode paiement cash/mobile money.

### Stock

- Decrement a la confirmation/packing selon regle.
- Annulation restaure stock.
- Retour restaure stock.
- Reouverture ne double-decremente pas.
- Plusieurs entrepots sur une meme commande.

## 17. Conclusion

Oui, le systeme a des problemes structurels, mais ils sont corrigeables sans tout jeter. Le coeur metier est la ; le besoin principal est de rendre les regles explicites et centralisees.

Les trois chantiers qui donneront le plus de valeur sont :

1. Securiser les API et sessions staff.
2. Stabiliser le triptyque livraison -> repro-dispo/reprogrammation -> settlement.
3. Rendre stock et settlement auditables avec des lignes/snapshots/evenements plutot que des recalculs et booleens globaux.

Une fois ces points traites, l'application sera beaucoup plus fiable pour les equipes terrain et beaucoup plus simple a faire evoluer.

## 18. Annexes - preuves et fichiers observes

Fichiers critiques :

- `lib/prisma.ts` : singleton Prisma casse par suppression globale.
- `modules/auth/actions.ts` : JWT session sans revalidation DB.
- `lib/auth.ts` : helper `ensureAuth`.
- `middleware.ts` et `proxy.ts` : garde staff.
- `app/api/promos/route.ts` : API promo non protegee.
- `app/api/migrate-passwords/route.ts` : migration mots de passe non protegee.
- `modules/orders/actions/queries.ts` : filtre date par defaut, livreurs detectes par telephone.
- `modules/orders/actions/order-actions.ts` : creation commande, promo, reprogrammation.
- `modules/orders/actions/status-actions.ts` : transitions statut, repro-dispo, reouverture admin.
- `modules/orders/actions/settlement-actions.ts` : calculs encaissement/historique.
- `modules/orders/actions/stock.ts` : decrement/restauration stock.
- `app/zangochap-manager/admin/delivery/AdminDeliveryClient.tsx` : admin livraison.
- `app/zangochap-manager/admin/delivery/settlement/SettlementClient.tsx` : encaissement admin.
- `app/zangochap-rider/DeliveryClient.tsx` : interface livreur.

Commandes lancees :

```powershell
npx.cmd tsc --noEmit
npm.cmd run lint
```

Resultats :

- TypeScript : OK.
- ESLint : KO, 892 problemes.
