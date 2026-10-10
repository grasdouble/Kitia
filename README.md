# Lufa-AI

Catalogue d’artefacts pour agents IA, avec une première version centrée sur les skills.

- [PRD](docs/PRD.md)
- [Plan d’implémentation](docs/IMPLEMENTATION_PLAN.md)
- [Suivi d’implémentation](docs/IMPLEMENTATION_STATUS.md)

## Utilisation sans installation globale

Le paquet n’a pas besoin d’être publié sur npm : le parcours recommandé récupère
la CLI directement depuis le dépôt GitHub public. Depuis le projet consommateur,
lancez-la ponctuellement avec `npx` :

```sh
npx --yes --package=github:grasdouble/Lufa-AI#main lufa list
npx --yes --package=github:grasdouble/Lufa-AI#main lufa search <terme>
npx --yes --package=github:grasdouble/Lufa-AI#main lufa show <id>
npx --yes --package=github:grasdouble/Lufa-AI#main lufa install <id>[@version]
npx --yes --package=github:grasdouble/Lufa-AI#main lufa installed
npx --yes --package=github:grasdouble/Lufa-AI#main lufa outdated
npx --yes --package=github:grasdouble/Lufa-AI#main lufa update [id]
```

Avec pnpm, autorisez explicitement le script de cycle de vie du paquet Git,
ciblé sur sa référence résolue (remplacez `<resolved-ref>` par le SHA du commit
visé) :

```sh
pnpm dlx \
  --allow-build="lufa-ai@git+https://github.com/grasdouble/Lufa-AI.git#<resolved-ref>" \
  --yes \
  --package=git+https://github.com/grasdouble/Lufa-AI.git#<resolved-ref> \
  lufa list
pnpm dlx \
  --allow-build="lufa-ai@git+https://github.com/grasdouble/Lufa-AI.git#<resolved-ref>" \
  --yes \
  --package=git+https://github.com/grasdouble/Lufa-AI.git#<resolved-ref> \
  lufa install hello-agent
```

`main` suit le développement et peut changer. Pour une exécution reproductible,
remplacez `main` par un tag ou un SHA immuable, par exemple
`github:grasdouble/Lufa-AI#<tag-ou-SHA>`. Le dépôt versionne le JavaScript
précompilé sous `dist/` : npx et pnpm dlx lancent directement ce binaire. Le hook
`prepare` installe uniquement Husky dans le clone Git temporaire ; il ne compile
pas. Cette préparation n’affecte pas le projet consommateur. Aucun utilisateur
ne compile le projet Lufa au cours de l’installation ou de l’utilisation. Pour
pnpm, `--allow-build` autorise explicitement l’exécution du `prepare` du paquet
Git à la référence résolue ; ce risque est accepté et limité à ce paquet et ce
SHA. Le build TypeScript n’est jamais appelé par `prepare`, `prepack` ou le
parcours consommateur. Les dépendances runtime normales sont téléchargées et
mises en cache par le gestionnaire. Git, Node.js 24+ et le gestionnaire utilisé
(`npm`/`npx` ou `pnpm`) sont requis. Aucun registre npm public ni publication npm
n’est nécessaire.
Le smoke Git utilise un dépôt fixture local contenant `dist/` mais pas `src/` ;
il vérifie les deux gestionnaires sans modifier le manifeste consommateur. Il ne
garantit pas la disponibilité future de GitHub ou du réseau.

Le MVP sait installer des **skills** dans `.agents/skills/`. Les commandes
gardent une interface par identifiant d’artefact, mais les agents, instructions
et autres types d’artefacts ne sont pas encore pris en charge.

Sans version précisée, `install` choisit la dernière version stable et demande
confirmation ; utilisez `--yes` pour l’automatisation. `update` demande également
confirmation ; pour l’automatiser, utilisez `lufa update <id> --yes` ou
`lufa update --yes` (toutes les entrées verrouillées). Après revue, `--force`
permet de remplacer uniquement les fichiers gérés par Lufa qui ont été modifiés
ou supprimés localement. Un fichier existant concerné est sauvegardé sous
`.lufa/backups/` ; un fichier supprimé est recréé sans sauvegarde. Cette option
ne permet jamais d’écraser une destination existante non gérée par Lufa.

Les skills sont installés dans `.agents/skills/` et leur version est enregistrée
dans `lufa.lock.json`, à versionner avec le projet. Leur découverte dans
`.agents/skills/` a été vérifiée avec GitHub Copilot CLI 1.0.95 et OpenCode CLI
v2.0.26 ; elle n’est pas garantie pour les futures versions, les clients IDE ou
les services cloud. Les options `--json` fournissent une sortie JSON pour les
commandes qui affichent des résultats ou un plan. `lufa update` met à jour les
skills du projet, pas la CLI. Avec `npx`/`pnpm dlx`, la version de la CLI est
déterminée par la référence Git choisie ; relancez la commande avec le SHA/tag
souhaité pour sélectionner une autre version.

Les payloads sont récupérés selon le contexte depuis le cache de contenus
SHA-256, le registre configuré (GitHub Pages par défaut, remplaçable via
`LUFA_REGISTRY_URL`) ou, si le mécanisme de repli l’autorise, l’instantané inclus
au paquet. Chaque payload est vérifié par empreinte SHA-256 avant toute écriture.
Hors ligne, l’installation n’est possible que si les octets correspondant
exactement à la version demandée sont déjà présents dans le cache ou l’instantané
inclus au paquet.

## Développement local

Prérequis : Node.js 24 ou ultérieur et npm. À la racine du dépôt :

```sh
npm ci
npm run format
npm run lint
npm run typecheck
npm test
npm run check
```

`npm ci` lance `prepare: husky` et active automatiquement les hooks dans le clone
mainteneur. Cette préparation installe les hooks seulement, sans compiler.
`npm run check` combine les contrôles statiques (formatage, lint et types) et les
vérifications de plateforme (concordance du build versionné, catalogue, tests et
smoke du paquet) utilisés par la CI. `npm run build:check` est une commande
optionnelle de vérification locale/CI : elle compile dans un dossier temporaire
et compare exactement fichiers et contenus avec `dist/`, y compris les fichiers
manquants ou supplémentaires. Le typecheck dédié `tsc --noEmit` est exécuté une
seule fois dans `check:quality` ; `check:platform` vérifie aussi le build compilé
sur chaque système d’exploitation.

Après installation des dépendances du dépôt (par exemple `npm ci`), Husky active
automatiquement le hook mainteneur. Avant un commit, celui-ci refuse les sources
de build modifiées mais non stagées ou non suivies, puis lance `npm run build`
(build atomique) et stage de force les créations, modifications et suppressions
de `dist/`. Il ne lance pas les tests. Ce build est réservé au travail mainteneur
dans le dépôt, jamais à l’utilisateur du paquet. Le hook n’est pas garanti pour
un commit créé depuis l’interface web ou qui contourne les hooks ; la CI vérifie
alors que `dist/` correspond au build via `npm run build:check`.
`npm run format` applique le formatage ; `npm run format:check` le vérifie sans
modifier les fichiers.

## Catalogue web local

Le site public en lecture seule est généré avec Astro dans `web/`. Il consomme le
même index que la CLI (`generated/catalog-index.json`) et les fichiers publiés
sous `catalog/` pour afficher leur contenu en texte consultable ; aucun contenu
n’est exécuté. Depuis la racine du dépôt :

```sh
npm run web:dev   # serveur de développement Astro
npm run web:build # génération statique dans web/dist/
```

La base est configurable avec `ASTRO_BASE` (par défaut `/`) ; pour simuler le
site GitHub Pages du dépôt :

```sh
ASTRO_BASE=/Lufa-AI npm run web:build
```

Le build exporte aussi le registre statique depuis les sources validées et
`generated/catalog-index.json`. L’index est servi à
`/Lufa-AI/registry/catalog-index.json` et les fichiers de skill à
`/Lufa-AI/registry/catalog/<identifiant>/<chemin-versionné>` (en local, retirer
le préfixe `/Lufa-AI`). Cet export est généré sous `web/public/registry/` et
n’est pas une seconde source de données.

Pour activer la publication, ouvrir **Settings → Pages** dans le dépôt et
choisir **GitHub Actions** comme source. Le workflow **GitHub Pages** n’a que
le déclencheur manuel `workflow_dispatch` : depuis l’onglet **Actions**, lancer
manuellement ce workflow pour publier le site à
`https://grasdouble.github.io/Lufa-AI/`. Aucun push ni déploiement n’est effectué
par les commandes locales.

`npm run check` reconstruit le site sans préfixe et sous `/Lufa-AI/`, puis vérifie
les routes, liens, assets et fichiers du registre publiés, les références
d’accessibilité de base ainsi que la recherche et l’état sans résultat.

## Catalogue local

Les sources sont maintenues sous `catalog/<identifiant>/` : `artifact.json`
décrit l’artefact et ses versions, dont les chemins de fichiers sont relatifs à
ce dossier. Le contrat se trouve dans `schemas/artifact.schema.json`. L’index
`generated/catalog-index.json` est généré ; ne pas le modifier manuellement.

```sh
npm run catalog:validate # valide les sources
npm run catalog:build    # régénère l’index déterministe
npm run catalog:check    # valide les sources et vérifie la fraîcheur de l’index
```

## Consulter le catalogue

Les commandes `list`, `search`, `show` et `outdated` rafraîchissent l’index du
registre configuré (GitHub Pages par défaut, remplaçable via `LUFA_REGISTRY_URL`),
sans modifier le projet et sans envoyer de données du projet.
L’installation récupère les payloads selon le contexte depuis le cache de
contenus SHA-256, le registre configuré (GitHub Pages par défaut, remplaçable via
`LUFA_REGISTRY_URL`) ou, si le mécanisme de repli l’autorise, l’instantané inclus
au paquet. Chaque payload est vérifié par empreinte SHA-256 avant toute écriture.
Hors ligne, seuls les octets exacts présents dans le cache ou l’instantané inclus
au paquet peuvent être installés.

Le nom interne du paquet npm est `lufa-ai` (aucune publication n’a été effectuée
ni n’est nécessaire au parcours documenté). Pour compiler et créer un tarball
local :

```sh
npm pack
```

`dist/` est versionné et inclus tel quel par `npm pack` ; l’empaquetage ne compile
pas le paquet. Pour packer des changements locaux avant leur commit, le
mainteneur exécute `npm run build` explicitement ou laisse le hook le faire au
commit si les sources de build sont stagées. Aucun utilisateur n’a à compiler.

Pour prévisualiser son installation dans un préfixe npm isolé, après `npm pack` :

```sh
npm install --prefix ./lufa-preview ./lufa-ai-0.1.0.tgz
cd ./lufa-preview
npm exec -- lufa list --json
npm exec -- lufa show hello-agent
npm exec -- lufa install hello-agent --yes --project ../lufa-preview-project
```

Le tarball contient le JavaScript compilé, le schéma, l’index et les sources de
catalogue nécessaires ; l’exécutable public est `lufa`. Pour tester le parcours
pack/install de bout en bout dans un répertoire temporaire, sans publier :

```sh
npm run pack:smoke
```

Pour reproduire séparément le parcours Git source avec `npx` et `pnpm dlx`, le
smoke crée un dépôt Git fixture temporaire à partir des sources présentes,
résout son SHA, puis l’installe avec `dist/` versionné et sans `src/` depuis
chacun des deux runners dans un consommateur isolé, puis exécute `list`, `show` et
`install`. Pour pnpm, il fournit `--allow-build` sur le seul paquet Git et le SHA
résolu. Il vérifie que `prepare` est bien `husky`, que `prepack` est absent, que
le `prepare` n’a pas besoin des sources de build et que le manifeste consommateur
reste inchangé. Il nécessite Git, Node.js 24+, npm et pnpm, et n’est volontairement
pas inclus dans `npm run check` (résolution Git et installation des dépendances
prennent plus de temps) :

```sh
npm run smoke:git-source
```

Depuis le dépôt, les commandes restent disponibles via npm :

```sh
npm run lufa -- list
npm run lufa -- search GREETING
npm run lufa -- show hello-agent
```

Pour une sortie JSON exploitable en pipeline, utilisez `--silent` afin que npm
n’ajoute pas ses bannières à `stdout` :

```sh
npm run --silent lufa -- list --json | jq '.[].id'
```

`search` effectue une recherche insensible à la casse dans les identifiants,
noms, descriptions, catégories et mots-clés. Ajoutez `--json` à `list`, `search`
ou `show` pour obtenir des objets JSON (tableau pour la liste et la recherche,
objet complet pour le détail). `show` expose notamment les versions et dates,
fichiers/destinations, niveaux et preuves de compatibilité, provenance,
prérequis et avertissements. `npm run lufa -- --help` affiche l’aide. Régénérez
l’index avec `npm run catalog:build` si celui-ci est absent ou invalide.

L’URL par défaut de l’index est
`https://grasdouble.github.io/Lufa-AI/registry/catalog-index.json`. Pour le
développement et les tests, `LUFA_REGISTRY_URL` peut la remplacer par une URL
HTTPS personnalisée ; HTTP n’est permis que vers `localhost`, `127.0.0.0/8` ou
`::1`. Les redirections sont refusées. La CLI effectue une requête GET avec un
délai maximal de 3 secondes ; elle ne transmet ni chemin de projet, ni lock, ni
autre donnée projet. L’index
validé est mis en cache de façon atomique dans le cache utilisateur :
`$XDG_CACHE_HOME/lufa-ai` sous Linux (ou `~/.cache/lufa-ai`),
`~/Library/Caches/lufa-ai` sous macOS et `%LOCALAPPDATA%/lufa-ai/cache` sous
Windows. `LUFA_CACHE_DIR` permet de choisir un dossier de cache, notamment pour
les tests.

Chaque consultation indique sur `stderr` si l’index vient d’être rafraîchi. Si
le registre est indisponible ou invalide, la CLI utilise le dernier index en
cache, sinon l’instantané inclus au paquet ; un avertissement précise alors la
date du cache ou que l’instantané peut être périmé. Le cache symbolique ou de
plus de 5 Mio est ignoré. Ces messages ne polluent pas le JSON écrit sur
`stdout`.

Le détail indique également `lufa install <identifiant>` comme commande
d’installation. L’index publié est versionné (schéma 2) et fournit une empreinte
SHA-256 hexadécimale minuscule pour chaque fichier.

Démo du skill pilote :

```text
$ npm run lufa -- search WRITING
hello-agent  Hello Agent  Un skill pilote minimal qui aide à produire une réponse d’accueil claire et structurée.

$ npm run lufa -- show hello-agent
Hello Agent (hello-agent)
Type : skill
Description : Un skill pilote minimal qui aide à produire une réponse d’accueil claire et structurée.
...
Version 1.0.0 (publiée le 2026-10-10T00:00:00Z)
...
  github-copilot : declared
  opencode : declared
Prérequis : aucun
Avertissements : Compatibilité déclarée, non vérifiée pour ce skill pilote ; aucun résultat de test spécifique à cette version n'est disponible.
Installation : lufa install hello-agent
```

Le niveau `declared` décrit une compatibilité annoncée ; `verified` exige une
preuve documentée et n’est pas déduit de la seule validation structurelle.

## Installer un skill

Comme la CLI n’est pas encore distribuée, lancer ces commandes depuis le dépôt
Lufa-AI et indiquer le projet consommateur avec `--project` :

```sh
npm run lufa -- install hello-agent --project ../mon-projet
npm run lufa -- install hello-agent@1.0.0 --project ../mon-projet
```

Sans version, la CLI choisit la version stable la plus récente (jamais une
préversion implicite). Une version donnée, préversion comprise, peut être
sélectionnée explicitement. L’installateur affiche la provenance déclarée par
l’auteur (dépôt) et la source résolue de l’index (registre configuré — GitHub
Pages par défaut, remplaçable via `LUFA_REGISTRY_URL` —, cache ou instantané
embarqué), mais ne rapporte pas l’origine effective de chaque
payload. En développement local, l’index provient du catalogue local. Il affiche
aussi la version, la destination et les fichiers, puis demande confirmation. En
automatisation, confirmer explicitement avec `--yes` ou `--non-interactive` :

```sh
npm run lufa -- install hello-agent --project ../mon-projet --yes
npm run lufa -- install hello-agent@1.0.0 --project /chemin/vers/projet --yes
```

Sans `--project`, la destination est le `process.cwd()` de la CLI.

Les fichiers sont installés sous `.agents/skills/<identifiant>/` et suivis avec
leurs empreintes dans `lufa.lock.json`. `install` résout les métadonnées depuis
le registre configuré (GitHub Pages par défaut, remplaçable via
`LUFA_REGISTRY_URL`) ou, en cas d’indisponibilité, depuis son cache / l’instantané
du paquet. Il obtient uniquement les fichiers de la version sélectionnée et les met en cache
avant d’entrer dans la transaction projet. Chaque payload peut provenir du cache
de contenus SHA-256, du registre configuré (GitHub Pages par défaut, remplaçable
via `LUFA_REGISTRY_URL`) ou, si le mécanisme de repli l’autorise, de l’instantané
inclus au paquet ; son empreinte publiée est vérifiée avant écriture. Il n’accepte
que les réponses `text/markdown`, `text/plain` ou
`application/octet-stream` ; une réponse `text/html` est rejetée même si ses
octets ont le hash annoncé. Tous les fichiers d’une version sont reçus et
vérifiés avant l’écriture de nouveaux blobs cache. Une nouvelle installation présente un aperçu et demande confirmation ;
une réinstallation intacte est idempotente et revient sans aperçu ni
confirmation. Les automatisations doivent confirmer les nouvelles installations
avec `--yes`. Les contenus du cache sont rangés par SHA-256 sous
`contents/sha256/<préfixe>/<empreinte>` dans le cache utilisateur. Seuls des
fichiers ordinaires isolés sont acceptés ; symlinks, hardlinks, contenus
corrompus et chemins de cache suspects sont refusés. Les installations Lufa d’un même projet
sont sérialisées, mais cette coordination ne protège pas contre un processus
tiers du même UID qui modifie simultanément les mêmes chemins. Voir la [note de
sécurité et de threat model](docs/installation-safety.md) pour le rollback et les
limites de plateforme.

## Inventaire et mises à jour

Depuis le dépôt Lufa-AI, utilisez `--project` pour cibler le projet consommateur
(sans cette option, le répertoire courant est utilisé) :

```sh
npm run lufa -- installed --project ../mon-projet
npm run lufa -- installed --project ../mon-projet --json
npm run lufa -- outdated --project ../mon-projet
npm run lufa -- outdated --project ../mon-projet --json
npm run lufa -- update --project ../mon-projet
npm run lufa -- update hello-agent --project ../mon-projet
npm run lufa -- update hello-agent --project ../mon-projet --yes
```

`installed` liste uniquement les entrées de `lufa.lock.json` (identifiant,
version exacte, cible et fichiers enregistrés). `outdated` compare chaque entrée
à la dernière version stable de l’index du registre configuré (GitHub Pages par
défaut, remplaçable via `LUFA_REGISTRY_URL`, ou du cache/instantané de repli) et
distingue `outdated`, `up-to-date` et `unavailable`. Les options
`--json` de ces commandes produisent des tableaux JSON sur `stdout`.

`update [identifiant]` (sans identifiant : toutes les entrées verrouillées)
affiche la provenance déclarée par l’auteur (dépôt) et la source résolue de
l’index (registre configuré — GitHub Pages par défaut, remplaçable via
`LUFA_REGISTRY_URL` —, cache ou instantané de repli), sans rapporter l’origine
effective de chaque payload, ainsi que les versions verrouillées/cibles, les
ajouts, modifications et diffs, et les fichiers retirés de la nouvelle version.
`update` résout l’index du registre configuré,
évite tout téléchargement si aucune version stable plus récente n’est disponible
et pré-vérifie les conflits locaux connus avant de demander les seuls fichiers
des versions à mettre à jour. Chaque payload peut provenir du cache de contenus
SHA-256, du registre configuré (GitHub Pages par défaut, remplaçable via
`LUFA_REGISTRY_URL`) ou, si le mécanisme de repli l’autorise, de l’instantané
inclus au paquet ; son empreinte publiée est vérifiée avant l’aperçu et
l’application transactionnelle. Les conflits, sauvegardes et le
lock conservent leur comportement existant. Une mise à jour exige une
confirmation ; les scripts non interactifs doivent fournir `--yes` ou
`--non-interactive`. `update --json` fournit le plan JSON ; avec confirmation,
la sortie JSON inclut aussi `applied` et les notes de résultat. Les versions
cibles sont toujours stables ; il n’y a pas de sélection de préversion pour
`update`. Hors ligne, une installation n’est permise que si l’index versionné et
les octets correspondants, validés par SHA-256, sont disponibles dans le cache ou
dans l’instantané du paquet. Les messages de fraîcheur et de cache sont écrits
sur `stderr`, jamais dans le JSON `stdout`.

Avant toute écriture, les empreintes SHA-256 du lock sont comparées aux fichiers
locaux. Un fichier modifié ou supprimé bloque par défaut l’opération. Après
revue du diff, `--force` autorise le remplacement et sauvegarde chaque fichier
local existant concerné sous `.lufa/backups/<transaction>/<chemin-du-projet>`
(par exemple `.lufa/backups/<transaction>/.agents/skills/hello-agent/SKILL.md`).
Ces sauvegardes ne sont pas supprimées automatiquement. Un fichier devenu
orphelin reste à sa place, est signalé et cesse d’être géré dans le nouveau lock ;
aucune mise à jour ne le supprime automatiquement. Le contenu du catalogue n’est
jamais exécuté.

Les commandes `install` et `update` partagent `.lufa.install.lock` par projet.
Les écritures multi-fichiers sont compensées en cas d’erreur ordinaire avant le
commit du lock, mais ne forment pas une transaction atomique vis-à-vis des autres
processus et ne sont pas garanties contre un arrêt brutal, une panne disque ou
un processus tiers du même UID intervenant au même instant. Lorsqu’une identité
ou un emplacement devient incertain, Lufa échoue et préserve les résidus au lieu
de les supprimer à l’aveugle. Voir [les limites de sécurité](docs/installation-safety.md).
