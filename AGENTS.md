# Consignes de contribution — ZangoChap Gest

Lire et respecter `AGENT.md`, qui conserve les consignes existantes de sécurité de production, de vérification et de mise à jour de la mémoire. Lire également `README.md` et les conventions locales dans `app/README.md` et `modules/README.md` pour les domaines concernés.

- Vérifier `git status --short` et préserver les modifications existantes.
- Ne jamais enregistrer de secrets ou données personnelles dans la documentation.
- Ne pas exécuter de migration, seed, réparation ou opération destructive sur les données sans l'autorisation explicite prévue dans `AGENT.md`.
- Après une modification de code, vérifier TypeScript et lint ; documenter les échecs et limites de validation. Les commandes et leur portée sont décrites dans la cartographie.

## Repères durables pour les prochaines sessions

- Lire `docs/PROJECT_MAP.md` et `docs/PROGRESS.md` avant d'intervenir.
- Vérifier les fichiers et symboles concernés avant de se fier à la documentation : le code et le schéma Prisma font autorité.
- Actualiser la cartographie après un changement d'architecture.
- Actualiser le journal après chaque tâche significative, en distinguant état vérifié, résultats, blocages et prochaines actions.
- Préserver les instructions existantes et maintenir les fichiers de `memory/` concernés conformément à `AGENT.md`, sans recopier toute la cartographie ici.
