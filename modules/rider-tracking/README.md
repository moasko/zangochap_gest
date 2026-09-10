# Suivi GPS des livreurs

## Fonctionnement
- `/zangochap-manager/admin/rider-map` : carte Leaflet/OpenStreetMap, accès ADMIN/DEVELOPER seulement. Positions actuelles interrogées toutes les 10 secondes, historique par livreur et jour/plage horaire Abidjan (UTC). Lecture point par point. Au maximum 10 000 points par recherche, dépassement visible, invitation à réduire les heures.
- Le suivi démarre automatiquement à l’ouverture du portail, sous réserve de l’autorisation GPS du téléphone. HTTPS et permission GPS nécessaires. Mesure environ toutes les 10 secondes, envoi si déplacement >= 20 m ou dernière transmission >= 60 secondes. Le GPS n'est pas exact : la précision annoncée par le téléphone est affichée.
- Démarrage automatique ; arrêt manuel mémorisé dans sessionStorage pour cet onglet, jusqu’à réactivation. Aucun stockage local de coordonnées. Arrêt local immédiat ; les tokens d'arrêt non confirmés sont conservés en sessionStorage et réessayés à la reconnexion. Fermeture/pagehide tente l'arrêt avec keepalive. Un arrêt réseau n'est pas garanti à la fermeture brutale : la carte signale les positions anciennes.
- Le navigateur peut suspendre GPS et timers en arrière-plan/écran verrouillé. Ce portail web ne garantit pas un suivi permanent en arrière-plan. Pas de reconstitution des trajets hors réseau.
- Les tracés sont interrompus entre sessions ou après plus de 5 minutes sans point. Les traits ne sont pas des itinéraires routiers calculés.

## Backend
- POST `/api/rider-tracking` : start / point / stop ; origine et rôle vérifiés, riderId issu exclusivement de la session serveur. Un nouveau token remplace l'ancien appareil. L'arrêt d'un ancien token n'arrête pas le nouveau.
- Coordonnées et dates validées ; points de plus de 2 minutes ou de plus de 30 secondes dans le futur rejetés. Transaction avec mise à jour conditionnelle de la ligne d'état avant insertion ; rythme maximal 1 point / 8 secondes côté serveur, horodatages croissants et ID unique.
- GET `/api/admin/rider-tracking` : live ou history, session admin requise, filtre par livreur et dates côté serveur, lecture historique RepeatableRead. Réponses no-store.
- Table d'état séparée de l'historique ; indexes riderId/capturedAt et receivedAt. Aucun changement de commandes, de stock, de paiement ou de comptes existants.

## Activation et retour arrière
Le fichier `prisma/manual-migrations/20260910_add_rider_tracking.sql` est préparé mais NON exécuté au 2026-09-10. Conformément à AGENT.md, demander l'accord explicite du propriétaire avant de l'appliquer à `zangochapdb` (DATABASE_URL configurée), puis générer le client et déployer le code.
La transaction crée uniquement deux tables et deux indexes, avec références à User. Risque : verrou de schéma bref pendant la création des références et échec si tables déjà existantes. La transaction annule ses créations en cas d'échec. Après succès, retour applicatif possible en retirant les points d'entrée GPS, en conservant les tables et données ; aucune suppression automatique de table autorisée.
Aucune politique de purge automatique n'est activée. L'historique est conservé jusqu'à une suppression explicitement autorisée. Prévoir une durée de conservation métier avant de généraliser le suivi. Les tuiles OSM utilisent l'attribution obligatoire et les requêtes normales du navigateur, sans préchargement hors ligne ; choisir un fournisseur adapté si le trafic augmente.

## Vérification
`node scripts/test-rider-tracking.mjs` : routes avec Prisma simulé, aucun accès DB, rôles/origine/proxy, usurpation d'identité, coordonnées, sessions, throttling, doublons, filtres UTC et péremption.
`npx.cmd tsc --noEmit --incremental false` ; lint ciblé des fichiers GPS ; lint global avec dette historique du dépôt.
Validation GPS sur téléphone et parcours authentifié réel restant à effectuer après activation des tables. Ne pas démarrer le partage à la place d'un livreur.

## Noms de lieux
La fiche de position recherche le lieu au clic via /api/admin/rider-tracking/place (admin/developer uniquement). Ajouter GEOAPIFY_API_KEY dans l’environnement serveur puis redémarrer/redéployer. Aucune clé n’est exposée au navigateur. Coordonnées seules envoyées à Geoapify, sans nom ni identifiant du livreur. Résultat indicatif « Lieu proche », non preuve d’une adresse exacte. Cache mémoire serveur 24 h / 1 000 entrées, client 1 h / 500 entrées ; résultats absents 5 min ; limitation 1 requête externe / 1,1 s par processus. Adapter quotas et cache partagé si plusieurs instances. Pas de recherche lors des actualisations GPS ou de la lecture automatique du parcours. Attribution Geoapify et OSM visible. Aucune migration. Service non activé tant que la clé est absente ; pas d’appel au Nominatim public, inadapté au suivi de véhicules selon sa politique.

## Flux direct et écran allumé — 2026-09-10
- GPS reçu via watchPosition, garde-fou d’envoi 10 s et heartbeat frais stationnaire (getCurrentPosition si le watch reste silencieux). Fréquence d’historique inchangée : ~10 s en mouvement / 60 s stationnaire, sous réserve du navigateur/réseau.
- Chaque démarrage/arrêt/point accepté émet un pg_notify dans sa transaction. PostgreSQL transmet la notification après commit ; aucun changement de schéma ou trigger nécessaire. Les notifications contiennent uniquement un signal, aucune coordonnée ni identité.
- /api/admin/rider-tracking/stream : SSE protégé admin/developer, LISTEN PostgreSQL, battement 15 s, durée maximale 55 s puis reconnexion/authentification. Une connexion PostgreSQL dédiée par onglet admin visible ; prévoir ce budget de connexions si de nombreux administrateurs. RIDER_STREAM_DATABASE_URL permet une connexion directe/session à la même base si DATABASE_URL utilise un pooler transactionnel (LISTEN incompatible). Par défaut DATABASE_URL.
- Le client ferme le flux en historique/onglet masqué, recharge un snapshot protégé à chaque notification, reprend après reconnexion et garde une synchronisation de secours 60 s quand connecté / 10 s sinon. Proxy : autoriser le streaming SSE sans buffering (X-Accel-Buffering: no envoyé) ; aucun déploiement ou test réseau en production réalisé ici.
- Profil > Paramètres · Localisation : option Garder l’écran allumé. Préférence locale par livreur, désactivée par défaut. Wake Lock demandé uniquement pendant le suivi et page visible, libéré à l’arrêt/unmount, redemandé au retour au premier plan. Ne garantit ni GPS en arrière-plan ni résistance à l’économie d’énergie ; consomme de la batterie. Le hook demeure monté en changeant d’onglet interne au portail.
- Vérifications : test-rider-tracking.mjs et test-rider-stream.mjs avec base simulée, TypeScript et lint ciblé. Test de bout en bout sur téléphone et proxy de production à effectuer au déploiement. Aucune migration ni écriture DB exécutée pendant cette modification.
