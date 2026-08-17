# Guide de prise en main IA — ZangoChap Gest

Ce fichier sert de point d'entrée rapide pour toute IA travaillant sur le projet.
Il complète, sans le remplacer, le fichier `AGENTS.md` qui contient les règles de
revue et de contribution obligatoires.

## Avant toute intervention

1. Lire `AGENTS.md` en entier.
2. Lire `memory/README.md`.
3. Lire les fichiers de `memory/` utiles à la tâche.
4. Vérifier `git status --short` et préserver les modifications existantes.
5. Ne jamais enregistrer de secret, mot de passe, jeton ou donnée client dans la mémoire.

## Sécurité absolue de la production et des données

Le projet est utilisé en production. Les règles suivantes sont obligatoires :

- Ne jamais exécuter de migration Prisma sans en informer préalablement le propriétaire et obtenir son autorisation explicite.
- Ne jamais exécuter `npx prisma db push`, `prisma db push`, `prisma migrate deploy`, `prisma migrate dev` ou une commande équivalente sans autorisation explicite préalable.
- Ne jamais utiliser `--accept-data-loss` sans une demande explicite et spécifique du propriétaire.
- Ne jamais lancer une commande pouvant supprimer, écraser, tronquer, réinitialiser ou corrompre des données de production.
- Ne jamais exécuter `prisma migrate reset`, `prisma db seed`, `DROP`, `TRUNCATE`, `DELETE` massif, ni une opération destructive équivalente sur la base de production.
- Ne jamais supprimer des fichiers, sauvegardes, médias, commandes, clients, produits ou données métier sans une demande explicite précisant la cible.
- Avant toute opération de base de données, expliquer la commande envisagée, son objectif, sa cible, ses risques et les possibilités de retour arrière.
- Préférer les inspections en lecture seule. Pour une correction de données, commencer par un audit sans écriture et présenter les résultats avant toute modification.
- En cas de doute sur l'environnement, la base visée ou l'impact d'une commande, ne rien exécuter et demander confirmation.
- La protection et l'intégrité des données de production priment toujours sur la rapidité d'intervention.

## Architecture de référence

- `app/` : routes Next.js, pages, layouts et handlers HTTP.
- `modules/` : logique métier par domaine.
- `components/` : composants d'interface transverses.
- `lib/` : infrastructure et utilitaires partagés.
- `prisma/` : modèle PostgreSQL, seed et migrations manuelles.
- `scripts/` : import, audit et réparation.
- `memory/` : contexte durable destiné aux assistants IA.

## Vérifications minimales

Après une modification de code :

```powershell
npx.cmd tsc --noEmit --incremental false
npm.cmd run lint
```

TypeScript doit rester valide. Le lint possède une dette historique importante :
ne pas introduire de nouvelle erreur et signaler clairement les erreurs préexistantes.

## Principes métier critiques

- Toute mutation staff doit vérifier la session et les rôles côté serveur.
- Les totaux, remises, statuts et stocks ne doivent jamais être approuvés sur la seule foi du client.
- Les changements de commande doivent tenir compte du stock, de la livraison et du settlement.
- Préférer les transactions Prisma pour les opérations multi-étapes.
- Préserver les historiques et audits ; éviter les suppressions physiques lorsqu'une désactivation suffit.
- Traiter `REPRO_DISPO`, `REPROGRAMMED`, les retours et les livraisons partielles avec prudence.

## Mise à jour de la mémoire

Après une modification importante, mettre à jour `memory/project-context.md` si
l'architecture, les flux, les risques ou les conventions ont changé. Ajouter une
entrée concise dans `memory/change-log.md` avec la date, les fichiers concernés et
la raison. Ne pas recopier de grands fichiers sources dans la mémoire.

