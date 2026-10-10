# Plan d’implémentation — Catalogue Lufa AI

- **Statut :** proposition de séquencement
- **Référence produit :** [PRD](PRD.md)

## Objectif du plan

Construire le MVP par petites tranches démontrables et révisables, plutôt que de développer la CLI, le catalogue et le site web dans un seul changement. Chaque étape doit aboutir à un résultat testable, avec un diff limité et une décision explicite de poursuivre, corriger ou revoir le cadrage.

Le plan ne fixe pas encore de langage, framework ou fournisseur d’hébergement. Ces choix seront faits au début de l’implémentation et consignés dans une courte décision technique (ADR) avant de créer le socle applicatif.

## Règles d’itération

- Une étape correspond à un changement cohérent et révisable ; la découper en plusieurs PR si elle devient trop large.
- Chaque PR décrit son objectif, les tests lancés, le résultat attendu et les limites connues.
- Ne pas commencer l’étape suivante avant d’avoir revu le résultat de la précédente.
- Tester d’abord les décisions risquées ou coûteuses à changer, en particulier la compatibilité de `.agents/skills/`.
- Garder une source de données commune pour le site et la CLI ; éviter deux catalogues maintenus séparément.
- Les données ou artefacts du catalogue ne sont jamais exécutés lors de la consultation ou de l’installation.

## Étapes proposées

### Étape 0 — Spike de compatibilité `.agents/skills/`

**But :** valider l’hypothèse centrale du PRD avant de construire l’installateur.

**Travail :**

- Créer un petit projet de test non produit contenant un skill minimal sous `.agents/skills/<id>/SKILL.md`.
- Vérifier avec les versions courantes de GitHub Copilot et d’OpenCode que le skill est effectivement découvert et utilisable depuis un projet.
- Noter les versions testées, les étapes de configuration éventuelles et les résultats distincts par outil.
- Si l’un des outils ne découvre pas ce chemin, tester/documenter la convention nécessaire avant de décider si le MVP garde une seule destination ou introduit des destinations spécifiques.

**Validation / porte de sortie :** résultat reproductible pour les deux outils, avec une décision prise sur le chemin d’installation. Ne pas présenter une compatibilité comme vérifiée sur la seule base d’une documentation non testée.

### Étape 1 — Décisions techniques et socle du dépôt

**But :** choisir le minimum nécessaire pour livrer le produit et éviter une architecture prématurée.

**Travail :**

- Comparer brièvement les options de stack pour la CLI, le site et les validations automatisées du catalogue.
- Choisir et documenter : structure du dépôt, langage et gestionnaire de dépendances, format du catalogue, génération/publication de l’index, distribution de la CLI et hébergement du site.
- Initialiser les outils de formatage, lint et tests ainsi qu’une CI minimale.
- Documenter les commandes locales de développement et de validation.

**Validation / porte de sortie :** dépôt installable de façon reproductible ; CI verte sur une modification triviale ; décisions consignées dans un ADR court. Aucun comportement produit important n’est implémenté dans cette étape.

### Étape 2 — Contrat et premier catalogue valide

**But :** fixer la structure des artefacts qui sera consommée par les deux interfaces.

**Travail :**

- Définir le schéma d’une entrée de catalogue, d’une version et d’un fichier de skill, en couvrant les métadonnées du PRD.
- Ajouter un skill pilote avec au moins une version et les informations de compatibilité / provenance.
- Ajouter la validation automatique du schéma, des versions, des identifiants uniques et des chemins sûrs.
- Générer un index déterministe à partir des sources maintenues dans le dépôt.
- Ajouter des cas invalides aux tests : champs manquants, version dupliquée, chemin sortant du paquet et métadonnées incorrectes.

**Validation / porte de sortie :** le skill pilote passe la validation ; les fixtures invalides échouent avec des erreurs compréhensibles ; deux générations successives ne produisent pas de différence inexpliquée.

### Étape 3 — CLI de consultation du catalogue

**But :** offrir une première valeur utilisable sans modifier le projet consommateur.

**Travail :**

- Implémenter les commandes de liste, recherche et détail (noms définitifs fixés dans l’ADR ou la documentation CLI).
- Afficher versions, description, cibles, compatibilité, provenance et commande d’installation.
- Ajouter une sortie JSON stable pour ces commandes.
- Consommer l’index généré à l’étape précédente, sans introduire une seconde définition du catalogue.
- Fournir des erreurs utiles pour un identifiant ou une version inconnus.

**Validation / porte de sortie :** démonstration manuelle de la liste, d’une recherche et du détail du skill pilote ; tests automatisés sur les résultats, la sortie JSON et les erreurs ; les commandes de consultation n’écrivent pas dans le projet courant.

### Étape 4 — Installation initiale et verrouillage

**But :** installer un skill précis dans un projet consommateur de façon traçable et sûre.

**Travail :**

- Installer le skill demandé dans `.agents/skills/<id>/` selon le résultat de l’étape 0.
- Supporter l’installation de la dernière version stable et l’installation d’une version explicite ; inscrire toujours la version exacte dans `lufa.lock.json`.
- Enregistrer la source, la cible, les chemins et l’empreinte du contenu dans le verrou.
- Ajouter aperçu, confirmation, mode non interactif explicite et réinstallation idempotente.
- Valider les chemins d’installation, refuser les sorties du projet ainsi que les traversées et symlinks détectés pendant les vérifications ; écrire de façon atomique.
- Ne pas exécuter les fichiers téléchargés ; signaler clairement leur origine.

**Validation / porte de sortie :** installer le skill pilote dans un projet temporaire ; vérifier le contenu et le verrou ; réinstaller sans changement inattendu ; simuler une erreur ordinaire et vérifier qu’aucun état partiel ne reste. Tester les chemins malveillants et les symlinks connus. Si une mutation concurrente externe est détectée, l’installation doit échouer avec un code non nul, ne pas enregistrer un succès dans `lufa.lock.json` et signaler/préserver tout résidu dont l’identité ou l’emplacement ne permet pas un nettoyage sûr ; aucune promesse de protection contre un processus tiers du même UID modifiant malicieusement les mêmes noms au même instant. Voir la [note de sécurité de l’étape 4](installation-safety.md).

### Étape 5 — Inventaire et mises à jour sûres

**But :** permettre de comprendre et de contrôler l’évolution des skills installés.

**Travail :**

- Lister les skills gérés et leurs versions locales.
- Détecter les versions stables disponibles et afficher les mises à jour possibles.
- Calculer et présenter un aperçu des fichiers qui seraient ajoutés, modifiés ou devenus orphelins.
- Détecter les modifications locales via les empreintes enregistrées ; arrêter la mise à jour par défaut en cas de conflit.
- En cas de remplacement forcé explicite, sauvegarder les fichiers concernés avant d’écrire.
- Ne pas supprimer automatiquement les fichiers retirés du skill distant ; les signaler comme orphelins.
- Mettre à jour le contenu et `lufa.lock.json` de façon cohérente ou restaurer l’état antérieur en cas d’échec.

**Validation / porte de sortie :** scénario automatisé de mise à jour sans conflit ; scénarios avec modification locale, ajout, suppression distante et échec en cours d’opération ; vérification que l’aperçu correspond aux changements réellement appliqués.

### Étape 6 — Catalogue web en lecture seule

**But :** rendre le catalogue découvrable sans installer la CLI.

**Travail :**

- Construire la page de catalogue, la recherche et les filtres prévus au MVP.
- Construire une page de détail affichant les versions, compatibilités et leur niveau de preuve, la provenance, le contenu consultable et la commande CLI.
- Alimenter l’interface avec le même index que la CLI.
- Ajouter les états catalogue vide et résultat absent, une navigation clavier et une mise en page mobile. Comme le site est statique et intègre les données à la génération, une donnée catalogue invalide doit faire échouer le build avec une erreur exploitable plutôt que produire une page runtime d’erreur.

**Validation / porte de sortie :** vérifier que les informations affichées correspondent à l’index et à la CLI ; revue clavier/accessibilité de base ; test des pages de liste et de détail aux tailles d’écran mobile et bureau.

### Étape 7 — Publication, cache et portabilité

**But :** rendre le flux disponible et suffisamment robuste pour un pilote externe.

**Travail :**

- Publier le catalogue et le site depuis le dépôt selon le mécanisme choisi à l’étape 1.
- Ajouter le cache du dernier index et des artefacts déjà téléchargés, en indiquant clairement quand les données sont périmées.
- Valider la CLI sur macOS, Linux et Windows dans la CI ; corriger les différences de chemins et de système de fichiers.
- Finaliser le mécanisme de distribution de la CLI et les instructions d’installation / désinstallation.
- Ajouter les validations de publication dans la CI et documenter le processus de revue mainteneur.

**Validation / porte de sortie :** smoke d’installation du tarball CLI et tests d’exécution verts sur macOS/Linux/Windows ; smoke reproductible d’une dépendance Git source dans un consommateur vide via npm/npx et pnpm/dlx ; consultation et réinstallation hors ligne des versions en cache ; registre et site effectivement servis sous l’URL GitHub Pages ; CI bloquant les données invalides. La CLI est distribuée depuis le dépôt Git/tag sans registre npm public ; aucune publication npm n’est requise ni déclenchée.

Cette étape est volontairement découpée en trois livraisons révisables afin d’éviter un diff transversal trop large :

1. **7.1 — Paquet CLI et matrice CI :** versionner le JavaScript TypeScript compilé sous `dist/`, empaqueter la CLI sans la publier, installer le tarball dans un projet temporaire, tester son exécutable et vérifier une dépendance Git fixture sans `src/` via npm/npx et pnpm/dlx. `prepare: husky` installe les hooks mainteneurs automatiquement sans compiler ; le `prepare` exécuté dans le clone Git temporaire du consommateur n’affecte pas son projet et ne compile jamais. Le smoke pnpm autorise `--allow-build` uniquement pour le paquet Git à sa référence résolue ; le risque d’exécuter ce `prepare` est explicitement accepté. Aucun `prepack` ne compile. Le hook mainteneur pre-commit refuse les sources de build non stagées/non suivies, génère atomiquement puis stage `dist/` ; `build:check` optionnel en local et en CI détecte les sorties manquantes, supplémentaires ou périmées. Aucune compilation utilisateur n’a lieu. Le dépôt Git est le parcours de distribution ; un registre npm public n’est pas requis.
2. **7.2 — Publication statique :** rendre le site et les données du catalogue compatibles avec le préfixe GitHub Pages, ajouter le workflow de déploiement et vérifier localement les routes/assets sous ce préfixe. Le workflow n’est pas déclenché par l’implémentation.
3. **7.3 — Registre distant et cache**, en deux petites tranches :
   - **7.3a — Index distant :** rafraîchir l’index pour liste/recherche/détail/updates, le mettre en cache avec indication explicite lorsqu’il est périmé, et retomber sur cache/instantané du paquet hors ligne. Tester avec un serveur HTTP de fixture.
   - **7.3b — Fichiers distants :** télécharger à la demande les fichiers de la version choisie, vérifier leur empreinte publiée, les mettre en cache et permettre une réinstallation hors ligne uniquement si le contenu exact est déjà présent. Tester checksum, cache, panne réseau et absence d’écriture dans le projet avant vérification.

Chaque livraison a son propre petit diff, sa revue indépendante et son commit. L’étape 7 est **Validée** quand ces portes de sortie sont démontrées. Aucune action de publication npm n’est nécessaire ou prévue pour distribuer la CLI depuis Git ; toute évolution de cette décision nécessiterait un choix explicite distinct.

### Étape 8 — Pilote et décision de lancement

**But :** éprouver le parcours complet sur de vrais projets consommateurs avant d’élargir le périmètre.

**Travail :**

- Faire utiliser le parcours découverte → installation → vérification → mise à jour par quelques projets pilotes.
- Confirmer la découverte des skills installés par Copilot et OpenCode dans les versions testées.
- Recueillir les erreurs, ambiguïtés de commande et difficultés de mise à jour ; corriger d’abord les problèmes de sécurité et de perte de données.
- Mettre à jour le guide de démarrage et les exemples à partir des retours.
- Décider explicitement si le MVP est prêt et quelles cibles / types d’artefacts seront les prochains.

**Validation / porte de sortie :** les critères d’acceptation du PRD sont démontrés, les limites connues sont documentées et aucun défaut bloquant de sécurité ou de perte de données ne reste ouvert.

## Ordre de livraison recommandé

Les étapes 0 à 5 forment le cœur CLI/catalogue. L’étape 6 peut commencer après stabilisation du contrat de catalogue (étape 2), mais devrait rester une PR distincte et consommer le même index. Les étapes 7 et 8 finalisent le pilote ; elles ne doivent pas servir à masquer des lacunes dans les parcours d’installation ou de mise à jour.

À la fin de chaque étape, faire une revue produit/technique courte :

1. Le résultat répond-il au critère de sortie ?
2. Les hypothèses restent-elles valides ?
3. Quel est le plus petit prochain changement utile ?
4. Faut-il mettre à jour le PRD, ce plan ou les décisions techniques ?

## Hors de ce plan MVP

Les autres types d’artefacts, les comptes et catalogues privés, la publication web par les utilisateurs, les dépendances transitives, les fusions automatiques et les intégrations spécifiques à d’autres agents ne sont pas inclus. Ils feront l’objet d’une planification séparée après le pilote.
