# Suivi d’implémentation — Catalogue Lufa AI

Le [plan d’implémentation](IMPLEMENTATION_PLAN.md) décrit les étapes et leurs critères de sortie. Ce fichier suit leur avancement réel ; il est mis à jour au fil du travail et versionné avec le dépôt.

## États

- **À faire** — le travail n’a pas commencé.
- **En cours** — l’étape est en développement.
- **À valider** — le travail et les vérifications sont terminés ; revue indépendante attendue.
- **Validée** — le coordinateur a accepté le résultat après revue indépendante ; l’étape suivante peut commencer.
- **Bloquée** — une décision ou un problème empêche de poursuivre ; préciser le blocage.

On ne considère pas une étape comme validée uniquement parce que son code est terminé : les critères de sortie du plan doivent être vérifiés et le résultat revu.

## Vue d’ensemble

| Étape | Sujet                                    | État    | Résultat / blocage                                                                                                                    |
| ----- | ---------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Spike de compatibilité `.agents/skills/` | Validée | Revue indépendante positive ; résultats bornés à Copilot CLI 1.0.95 et OpenCode CLI v2.0.26.                                          |
| 1     | Décisions techniques et socle du dépôt   | Validée | Revue indépendante positive ; job CI équivalent passé localement sous Node 24.20.0. CI distante non exécutée.                         |
| 2     | Contrat et premier catalogue valide      | Validée | Revue indépendante positive ; schéma, sécurité des chemins, preuves et index déterministe couverts par 16 tests sous Node 24.20.0.    |
| 3     | CLI de consultation du catalogue         | Validée | Revue indépendante positive ; 22 tests sous Node 24, JSON sans bruit npm et commande d’installation indicative documentés.            |
| 4     | Installation initiale et verrouillage    | Validée | Revue indépendante positive dans le threat model borné ; 34 tests sous Node 24, protections testées sur macOS.                        |
| 5     | Inventaire et mises à jour sûres         | Validée | Revue indépendante positive ; 41 tests sous Node 24, conflits, backups, orphelins et rollback couverts.                               |
| 6     | Catalogue web en lecture seule           | Validée | Revue indépendante positive ; 46 tests, smoke HTTP, vérifications Chromium mobile/bureau et parcours clavier passés.                  |
| 7     | Publication, cache et portabilité        | Validée | CI qualité et runtime verts ; Pages et registre répondent en production ; tarball/offline validés sur la matrice macOS/Linux/Windows. |
| 8     | Pilote et décision de lancement          | Validée | Revue indépendante positive ; tarball, registre, mise à jour, cache hors ligne et Copilot/OpenCode vérifiés dans deux projets isolés. |

**Dernière étape validée :** étape 8 — Pilote et décision de lancement.

## Journal des validations

Créer l’entrée d’une étape dès son démarrage et la tenir à jour pendant qu’elle est **En cours** ; compléter son résultat au passage à **À valider**, puis noter la décision après revue.

### Étape 0 — Spike de compatibilité `.agents/skills/`

- **État :** Validée
- **Résumé / livrable :** Fixture isolé et résultats consignés dans [le spike de compatibilité](compatibility-spike.md).
- **Environnements et versions testés :** macOS 27.0.1 (build 26A434), GitHub Copilot CLI 1.0.95 et OpenCode CLI v2.0.26.
- **Vérifications effectuées :** Depuis la racine fixture, Copilot `skill list` et invocation du skill avec marqueur attendu ; OpenCode appel de l’outil natif `skill`, contenu chargé et marqueur attendu. Depuis la racine Lufa-AI, aucun skill de projet listé par Copilot et chargement du skill en erreur dans OpenCode. Commandes et extraits dans la note.
- **Décision / points à corriger :** Le PRD v0.3, section 13, point 1, retient `.agents/skills/<identifiant>/` comme destination partagée sans copie spécifique par outil. Revue indépendante positive ; résultat borné à Copilot CLI 1.0.95 et OpenCode CLI v2.0.26. Aucun correctif bloquant identifié.
- **Validation finale :** validée par le coordinateur après revue indépendante.

### Étape 1 — Décisions techniques et socle du dépôt

- **État :** Validée
- **Résumé / livrable :** Comparaison des options et décisions consignées dans [ADR 0001](adr/0001-stack-and-repository-foundation.md) ; socle npm/TypeScript, commandes locales et CI GitHub Actions.
- **Vérifications effectuées :** `npm ci` puis `npm run check` sous Node.js 24.20.0 (mêmes commandes que le workflow CI ; format, ESLint, TypeScript et 1 test passés ; aucune vulnérabilité signalée) ; `git diff --check` (passé). La CI GitHub distante n’a pas été exécutée, aucun push n’ayant été fait.
- **Décision / points à corriger :** Revue indépendante positive et socle accepté. Confirmer avant l’étape 7 les cibles proposées de publication (paquet npm et GitHub Pages). Aucun artefact ou déploiement produit n’est créé à cette étape.
- **Validation finale :** validée par le coordinateur après revue indépendante et contrôles locaux sous Node 24.

### Étape 2 — Contrat et premier catalogue valide

- **État :** Validée
- **Résumé / livrable :** Schéma JSON, contenu pilote, validation automatique et index déterministe.
- **Vérifications effectuées :** `npm ci` puis `npm run check` sous Node.js 24.20.0 ; formatage, ESLint, TypeScript, validation du catalogue et de l’index déterministe, 16 tests passés ; 0 vulnérabilité signalée par `npm ci`. Les tests couvrent notamment les dates impossibles, les symlinks de racine et d’artefact, l’ordre ASCII / accentué et le rejet des preuves `verified` blanches.
- **Décision / points à corriger :** Type (`skill`) et environnements (`github-copilot`, `opencode`) sont distincts. Les compatibilités du pilote restent `declared` avec avertissement : le spike existant ne teste pas ce skill pilote. Les dates UTC sont validées comme dates calendaires réelles ; les racines et entrées catalogue symboliques sont rejetées explicitement. Les tris de l’index utilisent SemVer ou l’ordre Unicode par points de code, sans `localeCompare`. Les champs `testedVersion`, `method` et `reference` d’une preuve `verified` doivent contenir au moins un caractère non blanc ; les versions SemVer sont triées décroissantes ; sources et destinations refusent chemins absolus, traversées et séparateurs Windows, et les liens symboliques hors paquet sont rejetés. Aucune preuve de compatibilité propre au pilote n’a été ajoutée.
- **Validation finale :** validée par le coordinateur après revue indépendante.

### Étape 3 — CLI de consultation du catalogue

- **État :** Validée
- **Résumé / livrable :** Commandes locales `list`, `search` et `show`, y compris sortie JSON, consommant l’index généré sans écrire dans le projet courant.
- **Vérifications effectuées :** `ASDF_NODEJS_VERSION=24.20.0 asdf exec npm run check` sous Node.js 24.20.0 (format, lint, types, index valide et 22 tests passés) ; `git diff --check` ; démos de `list`, `search hello-agent`, `show hello-agent` et `show hello-agent --json` via le script npm.
- **Décision / points à corriger :** CLI limitée à la consultation locale ; aucun `bin`, distribution, installation effective, réseau, cache, web ou mutation de projet. `npm run --silent lufa -- list --json` fournit un JSON sans bannière npm ; `show` donne la commande d’installation à titre indicatif seulement, l’installation restant différée à l’étape 4.
- **Validation finale :** validée par le coordinateur après revue indépendante.

### Étape 4 — Installation initiale et verrouillage

- **État :** Validée
- **Résumé / livrable :** Commande install, aperçu/confirmation, installation idempotente et manifeste `lufa.lock.json`.
- **Vérifications effectuées :** `ASDF_NODEJS_VERSION=24.20.0 npm run check` (format, lint, types, catalogue et 34 tests passés) ; `git diff --check` passé. Tests déterministes de concurrence, de remplacement symlink avant écriture, de rollback après déplacement de l’ancre dans le projet et de refus de nettoyage si elle est déplacée hors projet ; aucun fichier dans le symlink externe ni lock mensonger, CWD restauré.
- **Décision / points à corriger :** Revue indépendante positive dans le threat model documenté : installations Lufa sérialisées ; pas de garantie contre un tiers du même UID modifiant malicieusement les mêmes noms simultanément. Si l’identité/emplacement est incertain, échec non-zéro et résidus signalés/préservés. CWD ancré vérifié sous Node 24/macOS uniquement ; Linux et Windows restent à tester à l’étape 7. Catalogue local seulement, pas de réseau/cache ; mises à jour reportées à l’étape 5.
- **Validation finale :** validée par le coordinateur après revue indépendante.

### Étape 5 — Inventaire et mises à jour sûres

- **État :** Validée
- **Résumé / livrable :** Commandes d’inventaire/outdated/update, aperçu, détection des conflits et sauvegarde forcée.
- **Vérifications effectuées :** `ASDF_NODEJS_VERSION=24.20.0 npm run check` (format, lint, types, index catalogue et 41 tests passés) ; `git diff --check` passé. Tests projet couvrant installed/outdated JSON, aperçu/diff, version à jour, conflits SHA-256, `--force` et backup, orphelin persistant, confirmation, rollback fichier+lock, lock fidèle, déplacement d’un répertoire de skill hors projet puis symlink (aucune suppression externe), provenance/source locale et sérialisation install/update.
- **Décision / points à corriger :** Revue indépendante positive. Threat model borné : verrou `.lufa.install.lock` partagé, chemins/symlinks inspectés et rollback par identité ; les résidus d’identité/emplacement incertains sont préservés et signalés. Pas de garantie face à un tiers du même UID, un arrêt brutal ou une panne disque ; les sauvegardes peuvent contenir des données sensibles, sont conservées même après rollback et doivent être gérées par le projet consommateur. Validation de portabilité limitée à Node 24/macOS pour le parcours CWD ancré de l’étape 4 ; Linux/Windows restent ouverts à l’étape 7.
- **Validation finale :** validée par le coordinateur après revue indépendante.

### Étape 6 — Catalogue web en lecture seule

- **État :** Validée
- **Résumé / livrable :** Site statique Astro sous `web/`, alimenté par `generated/catalog-index.json` et les fichiers catalogue ; recherche/filtres, pages de détail et commandes locales documentés.
- **Vérifications effectuées :** `ASDF_NODEJS_VERSION=24.20.0 npm run check` (format, lint, typecheck, index valide, build Astro, fixture de sécurité et smoke HTTP du build statique ; 46 tests au total) et `git diff --check` passés. Chromium : accueil à 390×844 et 1280×900, détail mobile sans débordement horizontal, clavier Tab vers skip-link/recherche/filtres, recherche sans résultat, Entrée sans rechargement, reset et navigation au détail ; aucune erreur JS. Le serveur Astro documenté répond HTTP 200 à l’accueil et au détail.
- **Décision / points à corriger :** Revue indépendante positive. Aucun déploiement, compte, administration ni édition/publication libre. La configuration `base` GitHub Pages reste ouverte à l’étape 7. Les erreurs de données bloquent la génération statique avec erreur exploitable plutôt que d’afficher une page runtime d’erreur.
- **Validation finale :** validée par le coordinateur après revue indépendante et contrôle navigateur.

### Étape 7 — Publication, cache et portabilité

- **État :** Validée
- **Résumé / livrable :** Étape découpée en paquets 7.1 (CLI/CI), 7.2 (publication statique) et 7.3 (registre distant/cache), tous revus et commités.
- **Livraison 7.1 :** paquet npm `lufa-ai` (nom provisoire), build TypeScript, commande `lufa`, ressources runtime incluses, smoke `npm pack`/installation isolée et matrice Node 24 macOS/Linux/Windows configurés.
- **Décision de distribution (mise à jour) :** parcours zero-install depuis Git via `npx` ou `pnpm dlx`; le binaire JS précompilé `dist/` est versionné. `prepare: husky` configure automatiquement les hooks dans le clone mainteneur et dans le clone temporaire d’une dépendance Git, sans compiler. Pour pnpm, le consommateur doit explicitement autoriser ce `prepare` avec `--allow-build="lufa-ai@git+…#<référence résolue>"` ; ce risque d’exécution de script source est accepté et limité au paquet/référence ciblé. Le hook temporaire n’affecte pas le consommateur et aucune compilation utilisateur n’a lieu à aucun moment. Aucun `prepack`, registre public ou `npm publish` requis.
- **État livraison 7.1 :** validée par CI run [38028906627](https://github.com/grasdouble/Lufa-AI/actions/runs/38028906627) ; jobs Ubuntu, macOS et Windows verts, et workflow qualité [38028906625](https://github.com/grasdouble/Lufa-AI/actions/runs/38028906625) vert.
- **Vérifications effectuées :** Sous Node.js 24.20.0/macOS, `npm ci`, `npm run check` et `npm run check:platform` (71 tests) passent ; le smoke du tarball dans un consommateur temporaire valide `list --json`, `show` et `install --yes`. `npm run format:check` et `git diff --check` passent également. GitHub Actions run [38028906627](https://github.com/grasdouble/Lufa-AI/actions/runs/38028906627) : matrice Ubuntu/macOS/Windows verte ; workflow qualité [38028906625](https://github.com/grasdouble/Lufa-AI/actions/runs/38028906625) vert.
- **Hook de distribution :** `npm ci` déclenche `prepare: husky` et active automatiquement `.husky/pre-commit` dans le clone mainteneur. Le hook refuse les sources de build non stagées ou non suivies, exécute `npm run build` (sortie atomique), puis fait `git add -f -A -- dist/`; il ne lance pas la suite de tests. Un clone ou un commit via l’interface web n’exécute pas nécessairement ce hook.
- **Contrôle CI :** `npm run build:check` compile dans un répertoire temporaire et compare les noms et contenus complets de `dist/`, signalant aussi les sorties absentes et supplémentaires. `check:platform` lance ce contrôle avant le check catalogue.
- **Smoke Git source :** `npm run smoke:git-source` fabrique un dépôt fixture local incluant le `dist/` versionné mais excluant `src/` et le script de build ; npm/npx et pnpm/dlx doivent exécuter `list`/`show`/`install` avec `prepare: husky`, sans build ni `prepack`, et le manifeste consommateur reste inchangé. Pour pnpm, le smoke passe l’autorisation ciblée du paquet au SHA résolu. Le test manuel n’implique aucun accès au dépôt GitHub public et n’est pas inclus dans `npm run check`.
- **Vérifications de la migration Husky (10 octobre 2026) :** sous Node.js 24.20.0/macOS, npm 11.19.0 et pnpm 12.5.1, `npm ci` exécute `prepare: husky` et configure `core.hooksPath=.husky/_` dans le clone courant. `npm run check` passe (75 tests), ainsi que `npm run smoke:git-source` avec npm/npx et pnpm/dlx, `npm run build:check`, `npm run format:check` et `git diff --check`. Le smoke résout le SHA du dépôt fixture et n’autorise via pnpm que `lufa-ai@git+…#<SHA>` ; `dist/` est présent, `src/` et le script de build sont absents, `prepare` installe Husky sans compilation, et le manifeste consommateur reste inchangé. Quatre tests dédiés valident l’absence de compilation au `prepare`, le staging des ajouts/suppressions `dist/` en préservant les autres changements stagés, et le refus des sources non stagées (y compris après staging) ou non suivies. L’index Git du clone courant n’a pas été modifié ; aucun commit, push ou publication n’a été effectué et aucune compilation utilisateur n’a lieu.
- **Historique du correctif :** les runs [38025440503](https://github.com/grasdouble/Lufa-AI/actions/runs/38025440503) et [38026395719](https://github.com/grasdouble/Lufa-AI/actions/runs/38026395719) ont révélé les fins de ligne Windows puis le lancement `npm.cmd`; les deux correctifs sont maintenant confirmés par le run 38028906627.
- **Décision / points à corriger :** Aucune publication npm n’est requise ; `lufa-ai` reste le nom interne du paquet. Trois tests de course qui renomment le CWD actif sont ignorés sous Windows, car celui-ci interdit de renommer le répertoire de travail actif. Les tests de lien/jonction ne sont ignorés que sur `EPERM`; les autres erreurs restent fatales et les répertoires temporaires sont nettoyés dans `finally`.

#### Livraison 7.2 — Publication statique

- **État :** Validée
- **Résumé / livrable :** Base Astro configurable, export statique du registre depuis l’index et les fichiers catalogue validés, tests des routes/assets locaux et sous `/Lufa-AI/`, workflow Pages déclenchable manuellement seulement.
- **Vérifications effectuées :** builds locaux et `/Lufa-AI/` passent ; HTTP 200 vérifié sur `https://grasdouble.github.io/Lufa-AI/registry/catalog-index.json` (application/json) et `.../registry/catalog/hello-agent/versions/1.2.0/SKILL.md` (text/markdown). Site déployé, confirmé par l’utilisateur.
- **Décision / points à corriger :** Revue indépendante positive ; aucun défaut ouvert pour l’étape 7.
- **Validation livraison 7.2 :** validée par le coordinateur après revue indépendante.
- **Livraison 7.3a :** Validée — lecture/rafraîchissement/cache de l’index distant pour `list`, `search`, `show` et `outdated`. URL par défaut GitHub Pages, HTTP limité au loopback, surcharge HTTPS `LUFA_REGISTRY_URL`, cache utilisateur configurable par `LUFA_CACHE_DIR`, validation stricte, refus des symlinks et taille maximale de 5 Mio, replis cache/instantané avec avertissement `stderr` ; `install`/`update` restent locaux jusqu’à 7.3b. Vérifié sur macOS/Node 24.20.0 par `ASDF_NODEJS_VERSION=24.20.0 npm run check` (format, lint, types, 61 tests avec HTTP local, smoke offline du tarball) et `git diff --check` ; aucun accès GitHub réel, déploiement, commit ou push. Les vérifications de chemins ne prétendent pas résister aux courses d’un processus tiers du même UID. Revue indépendante positive.
- **Validation livraison 7.3a :** validée par le coordinateur après revue indépendante.
- **Livraison 7.3b :** Validée — index schéma 2 avec SHA-256 par fichier ; téléchargements à la demande bornés et sans redirection ; MIME vérifié ; tous les blobs d’un artefact sont hachés avant écriture du moindre nouveau blob cache ; recours hors ligne seulement pour le contenu exact déjà disponible. Vérifié avec fixtures HTTP locaux sous Node 24.20.0/macOS : `npm run check` (68 tests et smoke offline du tarball) et `git diff --check`. Aucun accès GitHub réel, déploiement, commit ou push.
- **Validation livraison 7.3b :** validée par le coordinateur après revue indépendante.
- **Décision / points à corriger :** La matrice multiplateforme et le registre public sont vérifiés. La CLI est distribuée directement depuis Git ; aucune publication npm n’est requise. Étape 7 **Validée**.

### Étape 8 — Pilote et décision de lancement

- **État :** Validée
- **Résumé / livrable :** Parcours pilote terminé dans deux projets consommateurs temporaires isolés ; détails et commandes reproductibles dans [la validation du pilote](pilot-validation.md).
- **Vérifications effectuées :** Paquet local `lufa-ai@0.1.0` construit sous Node 24.20.0/npm 11.19.0 depuis le commit `57ca7a94646c5067144b68be65e653e967ac75b1`, installé depuis son tarball hors des sources du dépôt. Registre de production vérifié en JSON HTTP 200. Projet A : installation `hello-agent@1.1.0`, détection de `1.2.0`, mise à jour stable ; verrou et SHA-256 vérifiés, `legacy-notes.md` orphelin conservé. Projet B : installation latest stable `1.2.0`, avertissement explicite avec registre loopback inaccessible, réinstallation en cache avec version, fichiers et empreintes inchangés. Copilot CLI 1.0.95 liste le skill ; OpenCode CLI v2.0.26 invoque son outil natif `skill` et retourne une phrase vérifiable du contenu. Tests sous macOS ; limites consignées dans le rapport. La clarification documentaire des commandes n'est pas une nouvelle exécution du pilote.
- **Décision / points à corriger :** Revue indépendante positive. L’implémentation MVP est validée ; le paquet npm `lufa-ai` n’a pas été publié et aucune publication n’est requise. Le parcours de distribution recommandé est Git via `npx`/`pnpm dlx`, avec la compilation Git validée sur fixture locale. Le pilote précédent a éprouvé le tarball local ; il ne constitue pas à lui seul une validation du dépôt GitHub public. Le site GitHub Pages est déjà déployé.
- **Validation finale :** validée par le coordinateur après revue indépendante.

## Règle de mise à jour

1. Au démarrage d’une étape, passer son état à **En cours** et créer son entrée de journal.
2. Quand le livrable et ses vérifications sont prêts, renseigner son journal et passer à **À valider**.
3. Après revue, noter la décision et passer à **Validée**, ou laisser **À valider** en précisant les corrections attendues. Si un blocage empêche d’avancer, passer à **Bloquée** et le décrire.
4. Mettre à jour la ligne correspondante dans la vue d’ensemble et l’étape suivante uniquement après validation.

Garder une seule étape **En cours** à la fois. Les vérifications doivent indiquer ce qui a réellement été testé (commandes, plateformes ou versions pertinentes), et non uniquement « tests passés ».
