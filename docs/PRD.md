# PRD — Catalogue Lufa AI

- **Statut :** validé — cible Copilot / OpenCode
- **Version :** 0.5
- **Date :** 2026-10-10

## 1. Résumé

Lufa AI fournit un catalogue centralisé d’artefacts utilisables par des agents IA. Le projet commence par les **skills**, avec l’objectif de permettre à un utilisateur de découvrir, installer et mettre à jour ces skills dans un projet consommateur sans copie manuelle de fichiers.

Le produit comprend deux surfaces complémentaires :

1. une **CLI** pour rechercher et consulter le catalogue, installer des artefacts dans un projet et les mettre à jour de façon contrôlée ;
2. une **interface web** pour parcourir le catalogue, comprendre le contenu et les compatibilités des artefacts.

Le modèle doit permettre d’ajouter ultérieurement d’autres types d’artefacts (agents, instructions, commandes, prompts, configurations, etc.) et de cibler plusieurs environnements d’agents (Claude, Copilot et autres) sans refondre le catalogue.

## 2. Contexte et problème

Les skills et autres ressources pour agents IA sont aujourd’hui souvent partagés sous forme de dépôts ou de fichiers à copier. Cette approche rend leur découverte et leur réutilisation difficiles, et les projets consommateurs ne disposent pas d’un mécanisme fiable pour savoir quelle version ils utilisent ni pour la mettre à jour.

Lufa AI vise à fournir une source de référence et un flux d’utilisation simple, reproductible et transparent : trouver un artefact, l’ajouter à un projet, puis le mettre à jour quand une nouvelle version est publiée.

## 3. Vision et objectifs

### Vision

Rendre les artefacts d’agents IA aussi faciles à découvrir, installer et maintenir que les dépendances logicielles, tout en laissant aux équipes le contrôle sur ce qui entre dans leurs projets.

### Objectifs du produit

- Centraliser des artefacts documentés et versionnés dans un catalogue consultable.
- Permettre la découverte et l’installation depuis une CLI, sans copier-coller manuel.
- Permettre d’invoquer la CLI à la demande avec `npx` ou `pnpm dlx`, sans installation globale ou dépendance permanente dans le projet consommateur.
- Permettre de mettre à jour les artefacts installés, de manière explicite et prévisible.
- Rendre visibles le type, la version, l’origine, les prérequis et les environnements compatibles de chaque artefact.
- Offrir une interface web pour explorer le catalogue sans installer d’outil.
- Concevoir le modèle de données et les contrats de commande pour accepter d’autres types d’artefacts à l’avenir.

### Hors objectifs du MVP

- Exécuter les skills ou fournir un runtime d’agent IA.
- Installer ou configurer des modèles, clés API ou outils externes.
- Publier des artefacts par une interface web avec workflow de modération complet.
- Résoudre automatiquement des conflits sémantiques entre artefacts.
- Garantir une compatibilité avec tous les agents ou tous les formats dès le lancement.

## 4. Utilisateurs cibles

### Développeur consommateur

Veut ajouter rapidement un skill à un projet et le garder à jour sans gérer manuellement plusieurs copies.

### Mainteneur d’un projet consommateur

Veut connaître les artefacts installés, leur provenance et leurs versions, et contrôler les changements introduits lors d’une mise à jour.

### Auteur / mainteneur d’artefacts

Veut publier un artefact réutilisable avec une description, des versions et des compatibilités clairement indiquées.

### Visiteur du catalogue

Veut rechercher et évaluer les artefacts disponibles depuis le web, avant de décider de les utiliser.

## 5. Principes produit

- **Pas de copier-coller manuel :** l’installation passe par la CLI.
- **Transparence :** l’utilisateur peut voir ce qui sera installé ou modifié avant l’opération.
- **Réversibilité :** les fichiers installés et leur provenance sont identifiables ; une mise à jour ne supprime pas silencieusement le travail utilisateur.
- **Versionnement explicite :** l’installation est reproductible et les mises à jour sont intentionnelles.
- **Formats natifs :** les artefacts sont écrits dans des formats utilisables par les outils cibles, sans imposer un runtime Lufa.
- **Modèle extensible :** type d’artefact et environnement cible sont des dimensions distinctes.

## 6. Parcours principaux

### Parcourir puis installer un skill

1. L’utilisateur recherche un terme ou affiche les skills disponibles avec la CLI, ou parcourt le catalogue web.
2. Il consulte la description, les versions, l’environnement cible, les fichiers concernés et les prérequis.
3. Depuis la racine d’un projet, il demande l’installation d’un skill.
4. La CLI présente la source, la version et la destination, puis réalise l’installation après confirmation (sauf mode explicitement non interactif).
5. La CLI enregistre les informations nécessaires au suivi de l’installation.

### Mettre à jour un projet

1. L’utilisateur demande la vérification ou la mise à jour des artefacts du projet.
2. La CLI indique les versions actuellement installées et les versions disponibles.
3. Elle affiche les changements prévus et signale les fichiers modifiés localement ou les conflits.
4. L’utilisateur confirme ; la CLI applique les changements sans écraser silencieusement ses modifications.

### Explorer sur le web

1. Le visiteur parcourt ou recherche les artefacts.
2. Il filtre par type, environnement compatible et éventuellement catégorie.
3. Il ouvre une page de détail contenant les informations utiles et la commande CLI pour l’installation.

## 7. Exigences fonctionnelles

### 7.1 Catalogue

Chaque entrée publiée doit au minimum exposer :

- un identifiant stable, un nom et une description ;
- un type d’artefact (MVP : `skill`) ;
- un ou plusieurs auteurs / mainteneurs et une provenance ;
- une ou plusieurs versions identifiables ;
- les fichiers inclus et leur destination prévue ;
- les environnements ou agents compatibles, avec le niveau de compatibilité connu ;
- des prérequis et des avertissements éventuels ;
- des métadonnées de découverte : catégories et mots-clés.

Le catalogue doit distinguer une **entrée d’artefact** de ses **versions**. Une version publiée est immuable du point de vue du consommateur ; une correction produit une nouvelle version. Les détails de stockage et de publication restent à décider pendant la conception technique.

### 7.2 CLI

La CLI doit fournir, au minimum, les capacités suivantes :

- **Lister** les artefacts disponibles, avec pagination ou sortie adaptée aux grands catalogues.
- **Rechercher** par nom, description ou mots-clés.
- **Afficher** les détails d’un artefact, ses versions et ses compatibilités.
- **Installer** un artefact ou une version dans le projet courant.
- **Lister** les artefacts installés dans le projet courant.
- **Vérifier les mises à jour** disponibles.
- **Mettre à jour** un artefact précis ou les artefacts installés, avec aperçu des changements.
- Fournir une sortie lisible par machine (par exemple JSON) pour les commandes de consultation.
- Expliquer clairement les erreurs courantes : artefact inconnu, version indisponible, conflit local ou environnement non pris en charge.

La CLI doit fonctionner depuis la racine d’un projet, ne pas nécessiter de compte pour consulter et installer les artefacts publics, et proposer un mode non interactif explicite pour l’automatisation.

Le parcours d’utilisation public est **zero-install** : l’utilisateur lance la CLI à la demande depuis le dépôt Git via `npx` ou `pnpm dlx`, puis le binaire JavaScript `lufa` précompilé et versionné sous `dist/` (syntaxes exactes dans le README). `main` est la cible de développement ; un tag ou SHA de commit immuable est recommandé pour la reproductibilité. Git et Node.js 24+ sont requis. Le gestionnaire télécharge et met en cache le paquet et ses dépendances runtime ; aucune commande d’installation globale, compilation TypeScript ni ajout de dépendance au projet consommateur n’est requis. Le `prepare` du paquet Git installe Husky uniquement dans son clone temporaire et ne compile rien ; le hook du clone temporaire n’affecte pas le consommateur. pnpm requiert un `--allow-build` ciblé sur le nom du paquet et sa référence Git résolue afin d’autoriser ce `prepare`. Ce risque d’exécution de script du paquet source est explicitement accepté, circonscrit à la référence résolue et vérifié par smoke ; aucune compilation utilisateur n’a lieu, à aucun moment. Dans le dépôt mainteneur, Husky est installé automatiquement par `prepare` à l’installation des dépendances. Le hook pre-commit refuse les sources de build non stagées/non suivies, lance le build atomique et stage `dist/` ; la CI vérifie que le build versionné est à jour, car les hooks ne sont pas exécutés par tous les chemins de commit. Un `npm run build:check` local est optionnel et compile seulement dans un répertoire temporaire. Un registre npm public et une publication npm ne sont pas requis. La distribution Git doit être validée avec npm/npx et pnpm/dlx et dépend de l’accès au dépôt Git.

### 7.3 Installation et suivi dans le projet consommateur

- L’installation doit placer les fichiers aux emplacements attendus par l’environnement ciblé.
- Le projet doit conserver un manifeste local versionné avec le code, recensant au minimum l’identifiant de l’artefact, sa version, sa source et les fichiers gérés. Le nom et le format de ce manifeste seront fixés en conception.
- Une réinstallation de la même version doit être idempotente.
- La CLI doit détecter les changements locaux avant une mise à jour et ne pas les écraser sans avertissement et choix explicite.
- Le comportement en cas de suppression ou de renommage de fichiers lors d’une mise à jour doit être explicite et documenté.

### 7.4 Interface web

Le MVP web doit proposer :

- une page d’accueil présentant le catalogue ;
- la recherche et le filtrage des artefacts ;
- une page de détail par artefact avec description, versions, compatibilités, fichiers / contenu consultable et commande d’installation ;
- des liens permettant de retrouver la source et les informations de maintenance ;
- un affichage utilisable sur ordinateur et mobile.

L’interface web est principalement en lecture seule dans le MVP. La publication et l’administration du catalogue peuvent rester basées sur un processus contrôlé côté mainteneurs.

### 7.5 Extensibilité aux autres artefacts

Le catalogue ne doit pas supposer que chaque artefact est un skill. Chaque type pourra définir ses propres métadonnées, fichiers et règles d’installation. L’environnement cible (par exemple Claude ou Copilot) ne doit pas être confondu avec le type d’artefact : un même type peut être compatible avec plusieurs environnements, éventuellement via des variantes adaptées.

## 8. Exigences non fonctionnelles

- **Sécurité :** traiter les contenus du catalogue comme du code ou des instructions non fiables ; afficher leur origine, éviter l’exécution implicite et valider les chemins d’installation contre les sorties du répertoire cible.
- **Intégrité :** associer chaque version à un contenu déterminé et détecter les téléchargements incomplets ou altérés.
- **Prévisibilité :** une installation verrouillée sur une version produit le même ensemble de fichiers.
- **Performance :** les commandes de recherche et de consultation doivent rester pratiques sur un catalogue croissant ; l’installation ne télécharge que les artefacts requis.
- **Portabilité :** prendre en charge macOS, Linux et Windows pour la CLI ; valider ces plateformes dans l’intégration continue.
- **Accessibilité :** rendre le catalogue web navigable au clavier et fournir une structure sémantique.
- **Confidentialité :** ne pas envoyer le contenu du projet consommateur au service catalogue ; documenter toute télémétrie éventuelle et la désactiver par défaut pour le MVP.

## 9. Périmètre recommandé du MVP

### Inclus

- Un catalogue public initial de skills.
- Des métadonnées et un versionnement par artefact.
- Une CLI installable permettant liste, recherche, détail, installation, liste des installations, vérification des mises à jour et mise à jour.
- Des invocations documentées depuis le dépôt Git/tag via `npx` et `pnpm dlx`, utilisables depuis un projet consommateur sans registre npm public, installation globale de Lufa ni modification de ses dépendances.
- Un manifeste local de suivi dans les projets consommateurs.
- Détection des modifications locales et aperçu avant mise à jour.
- Un catalogue web consultable et des pages de détail.
- Installation des skills pour GitHub Copilot et OpenCode via le répertoire commun `.agents/skills/`.
- Documentation de démarrage et exemples.

### Explicitement différé

- Éditeur web et publication libre par les utilisateurs.
- Comptes, équipes privées et catalogue privé.
- Installation de plusieurs types d’artefacts.
- Résolution automatique de conflits et fusion assistée.
- Dépendances transitives entre artefacts.
- Évaluations, commentaires, statistiques avancées et recommandations.

## 10. Critères d’acceptation du MVP

Le MVP est prêt à être évalué quand :

1. Un nouvel utilisateur peut trouver un skill depuis le web et depuis la CLI.
2. La CLI peut afficher la liste, rechercher un artefact et afficher ses détails sans accès authentifié.
3. Un utilisateur peut installer une version précise dans un projet et retrouver l’entrée correspondante dans le manifeste local.
4. Répéter l’installation de cette version ne crée pas de doublons ni de changements inattendus.
5. La CLI peut lister les artefacts installés et identifier ceux pour lesquels une mise à jour existe.
6. Une mise à jour affiche les fichiers concernés et ne remplace pas silencieusement un fichier modifié par l’utilisateur.
7. Une erreur de réseau, une version invalide ou une destination invalide produit un message actionnable et ne laisse pas une installation partielle présentée comme réussie.
8. La page web d’un artefact expose sa description, sa version, sa compatibilité, sa provenance et la commande d’installation.
9. Les instructions de contribution expliquent comment ajouter ou publier une nouvelle version de skill.

## 11. Indicateurs de réussite

À instrumenter ou mesurer sans collecter le contenu des projets :

- délai entre la découverte d’un skill et son installation réussie ;
- taux de réussite des installations et mises à jour ;
- proportion d’utilisateurs qui parviennent à vérifier une mise à jour ;
- nombre d’artefacts installés et maintenus, et fréquence de mise à jour ;
- taux d’abandon ou erreurs aux étapes recherche, installation et mise à jour ;
- retours qualitatifs des premiers projets consommateurs.

Les seuils cibles seront définis après un premier test auprès d’utilisateurs.

## 12. Risques et réponses envisagées

| Risque                                                              | Réponse produit                                                                                                                |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Un skill peut contenir des instructions malveillantes ou inadaptées | Afficher provenance et contenu, ne jamais exécuter le contenu à l’installation, permettre une revue avant installation.        |
| Une mise à jour écrase des modifications locales                    | Manifeste, détection de changements, aperçu et arrêt par défaut en cas de conflit.                                             |
| Les conventions de fichiers diffèrent selon les agents              | Déclarer les compatibilités et destinations ; commencer avec un environnement cible clairement défini.                         |
| Le catalogue devient difficile à maintenir                          | Métadonnées validées, processus de publication documenté et versions immuables.                                                |
| Le format initial bloque l’ajout d’autres artefacts                 | Séparer le type d’artefact, l’environnement cible et la stratégie d’installation dans le modèle.                               |
| Les consommateurs dépendent d’un catalogue indisponible             | Mettre en cache le dernier index connu et les artefacts téléchargés ; distinguer les données en cache des informations à jour. |

## 13. Décisions de cadrage retenues

Les décisions ci-dessous ferment les questions ouvertes du cadrage MVP. Elles pourront être réévaluées à partir du pilote, mais ne doivent pas bloquer le démarrage de la conception technique.

1. **Environnements cibles du MVP : GitHub Copilot et OpenCode.** Le MVP installe les skills au format `SKILL.md` dans le répertoire commun `.agents/skills/<identifiant>/`. Le catalogue déclare séparément le type d’artefact et les environnements compatibles. La compatibilité effective de Copilot et d’OpenCode avec cet emplacement et ce format doit être validée par des tests ciblés avant de présenter le skill comme vérifié. Le MVP vise une seule copie partagée dans `.agents/skills/` ; il ne crée pas de copies spécifiques par outil. Si les tests révèlent une différence de prise en charge, celle-ci devra être documentée et arbitrée avant de promettre une installation commune. Claude Code et les autres environnements pourront être ajoutés ensuite avec leurs conventions respectives.

2. **Source de vérité : ce dépôt.** Les définitions, métadonnées et contenus publiés du catalogue sont maintenus dans le dépôt Lufa-AI au lancement. La CLI et le site web consomment un index/catalogue publié et versionné, plutôt que de dépendre de la structure interne du dépôt. L’index pourra être servi comme contenu statique ; le choix du mécanisme de déploiement (par exemple releases ou hébergement statique) relève de la conception technique. Cette décision pourra être revue si le volume ou les besoins de contribution justifient de séparer le catalogue du code produit.

3. **Versionnement : SemVer pour les versions publiées.** Chaque version publiée est immuable. Sans version explicite, `install` sélectionne la dernière version stable, puis enregistre cette version précise dans le verrou du projet. Les préversions ne sont jamais sélectionnées implicitement. Une mise à jour demande une action distincte et indique la version cible avant application.

4. **Suivi projet : `lufa.lock.json` à la racine.** Ce fichier, destiné à être versionné avec le projet consommateur, est généré et maintenu par la CLI. Il contient les identifiants et versions exactes, les environnements cibles, les chemins gérés, la source et une empreinte cryptographique du contenu installé. Il constitue la référence pour les mises à jour reproductibles. Le MVP n’ajoute pas de fichier de configuration déclaratif distinct ; la nécessité d’une déclaration séparée sera réévaluée si les besoins de dépendances ou de partage d’équipe le justifient.

5. **Conflits : arrêt sûr par défaut.** Si un fichier géré a été modifié localement, la mise à jour s’arrête pour cet artefact et affiche les différences ; elle ne remplace rien silencieusement. L’utilisateur peut conserver sa version, ou demander explicitement le remplacement avec une option de force ; dans ce dernier cas, la CLI sauvegarde le fichier local avant remplacement. Si un fichier disparaît de la nouvelle version, la CLI ne le supprime pas automatiquement : elle signale le fichier devenu orphelin et laisse sa suppression à l’utilisateur. Aucune fusion automatique n’est incluse au MVP.

6. **Plateformes et invocation : macOS, Linux et Windows via Node.js 24+.** Le paquet est lancé à la demande depuis le dépôt Git via `npx` ou `pnpm dlx`, avec `lufa` comme binaire JavaScript précompilé. Les références de tag/SHA sont recommandées pour la reproductibilité ; Git est requis. Le gestionnaire met le paquet et ses dépendances runtime en cache ; l’utilisateur ne compile jamais, à aucun moment, et n’ajoute pas de dépendance au projet. `prepare: husky` configure le hook uniquement dans le clone Git temporaire et ne lance aucun build. pnpm exige l’autorisation explicite et ciblée `--allow-build="lufa-ai@git+…#<resolved ref>"` pour ce script du paquet Git ; l’exécution de ce script à la référence résolue est un risque explicitement accepté. Dans le clone mainteneur, `prepare` active Husky automatiquement ; `npm run build:check` est une vérification locale/CI optionnelle. Un registre npm public / une publication npm ne sont pas requis. La distribution native sans Node.js reste différée. Une installation globale facultative ne constitue pas le parcours recommandé ni un prérequis.

7. **Accès : catalogue public uniquement au lancement.** La consultation et l’installation d’artefacts publics ne nécessitent pas de compte. Les catalogues privés, l’authentification et les permissions d’équipe sont différés.

8. **Publication : revue mainteneur avant visibilité.** Une contribution n’est publiée qu’après revue humaine par un mainteneur et validation automatisée. Les contrôles automatisés couvrent au minimum la structure et les champs requis, les chemins de fichiers, les doublons d’identifiants et la cohérence des versions. La revue vérifie également la provenance, la licence et le contenu des instructions ; aucun contenu n’est considéré sûr du seul fait qu’il passe la validation technique. Le MVP utilise le processus de contribution du dépôt plutôt qu’un portail de publication.

9. **Compatibilité : déclaration explicite, avec niveaux de preuve.** Les métadonnées distinguent une compatibilité déclarée par l’auteur d’une compatibilité vérifiée par le projet. La validation automatique peut vérifier les métadonnées, la structure attendue (`SKILL.md`) et les chemins de destination ; elle ne peut pas garantir la qualité du comportement du skill dans un agent. Les compatibilités vérifiées reposent sur des tests documentés avec l’environnement concerné. Le site affiche clairement ce niveau de preuve.

10. **Mode hors ligne : cache informatif, mises à jour en ligne.** La CLI conserve localement le dernier index connu et les versions d’artefacts déjà téléchargées. Hors ligne, elle peut afficher les données en cache et réinstaller une version déjà présente localement ; elle indique que le catalogue peut être périmé. La découverte de nouvelles versions et le téléchargement d’une version absente du cache nécessitent une connexion réseau.

## 14. Proposition de jalons

1. **Fondations du catalogue :** définir et valider le schéma d’un skill et d’une version ; constituer quelques artefacts pilotes et formaliser la revue de publication.
2. **CLI de consultation et installation :** commandes de découverte et d’installation des skills dans `.agents/skills/` pour Copilot et OpenCode, manifeste verrouillé et validation des chemins.
3. **Mises à jour sûres :** comparaison des versions, aperçu, détection des modifications locales, sauvegarde en cas de remplacement forcé et erreurs récupérables.
4. **Catalogue web :** recherche, filtres et pages de détail alimentés par le catalogue publié.
5. **Portabilité :** valider la CLI sur macOS, Linux et Windows et arrêter son mode de distribution.
6. **Pilote :** valider la découverte effective des skills dans GitHub Copilot et OpenCode, puis faire utiliser le flux complet par quelques projets consommateurs ; corriger les problèmes avant de décider de l’extension aux autres environnements et types d’artefacts.

---

Ce document décrit l’intention produit et le périmètre recommandé ; il ne préjuge pas encore de la stack technique ni du mécanisme précis d’hébergement du catalogue.
