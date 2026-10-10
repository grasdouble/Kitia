# ADR 0001 — Stack et fondations du dépôt

- **État :** accepté après revue indépendante à la fin de l’étape 1
- **Date :** 2026-10-10
- **Contexte :** le MVP combine une CLI multiplateforme, un site de catalogue en
  lecture seule et des validations automatisées ; il n’existe encore aucun code
  applicatif dans le dépôt.

## Options considérées

- **CLI :** TypeScript/Node.js (distribution npm multiplateforme), Go (binaire
  autonome mais deuxième langage pour le site et les validations) ou Python
  (simple à écrire, mais distribution autonome moins directe).
- **Site :** Astro généré statiquement (adapté à la consultation), Next.js
  (serveur et fonctionnalités dynamiques non requis au MVP) ou un générateur
  manuel léger (moins d’outillage, mais davantage de plomberie à maintenir).
- **Validation du catalogue :** JSON Schema avec Ajv (contrat portable et
  réutilisable) ou validation TypeScript/Zod (ergonomique mais davantage liée à
  l’implémentation). Les deux peuvent détecter les erreurs de forme ; les
  contrôles métier et de chemins viendront avec le contrat à l’étape 2.

## Décisions

1. **Langage et gestionnaire :** TypeScript sur Node.js 24+, avec npm et son
   fichier de verrouillage. Un même langage et son écosystème desservent la CLI,
   le générateur d’index et le site, sans exiger une architecture applicative
   avant les étapes concernées.
2. **Structure :** dépôt unique ; sources maintenues sous `catalog/`, contrat
   sous `schemas/`, outils CLI sous `src/` et site sous `web/` lorsqu’ils seront
   introduits. Pas de workspaces ni de séparation en paquets tant qu’un besoin
   concret ne le justifie pas. Les sorties générées ne seront pas la source de
   vérité.
3. **Catalogue et index :** sources en JSON, contrat en JSON Schema, validé avec
   Ajv. Un générateur déterministe produira un index JSON versionné, consommé
   par la CLI et le site ; l’index publié sera un artefact statique, distinct
   des sources maintenues. Ces outils et formats seront implémentés à l’étape 2,
   pas dans cet ADR.
4. **CLI :** paquet Node avec commande `bin`, lancé à la demande depuis le dépôt
   GitHub via `npx --package=github:grasdouble/Lufa-AI#main` ou `pnpm dlx`, avec
   `dist/` JavaScript précompilé et versionné dans Git. Les tags/SHAs immuables
   sont recommandés pour la reproductibilité. Husky est installé automatiquement
   dans le clone mainteneur par `prepare: husky`, qui ne compile pas. Son hook
   pre-commit refuse les sources de build non stagées ou non suivies, exécute le
   build atomique puis stage `dist/` ; la CI compare ce dossier au build courant,
   car les hooks ne sont pas garantis pour tous les commits. La dépendance Git
   exécute le même `prepare` seulement dans son clone temporaire ; aucun utilisateur
   ne compile, et ce hook n’affecte pas le consommateur. pnpm exige
   `--allow-build="lufa-ai@git+…#<référence résolue>"` pour autoriser ce script du
   paquet Git : ce risque est explicitement accepté et ciblé sur le paquet et sa
   référence exacte. Aucun `prepack` ne compile. `npm run build:check` est un
   contrôle optionnel local/CI. Il n’est nécessaire ni de publier le paquet sur
   un registre npm public, ni de l’installer globalement ou comme dépendance du
   consommateur ; Git et Node.js 24+ sont requis. Cette option évite de maintenir
   des binaires par plateforme pour le MVP.
5. **Site et hébergement :** Astro avec génération statique, publié sur GitHub
   Pages depuis le dépôt. Pas de serveur applicatif nécessaire au catalogue en
   lecture seule. Le déploiement sera réalisé à l’étape 7.
6. **Socle immédiat :** Node.js 24+ et CI GitHub Actions avec installation
   verrouillée, Prettier, ESLint, vérification TypeScript et tests Node natifs.
   La CI ne valide encore aucun contenu catalogue, absent à ce stade.

## Conséquences et points à confirmer

Ce choix minimise les langages et l’infrastructure, et permet de partager le
format de données entre les surfaces. GitHub est la source de distribution de la
CLI ; GitHub Pages héberge le catalogue statique. L’installation à la demande
met le paquet en cache sans inscrire Lufa dans les dépendances du consommateur.
Aucune publication npm publique n’est requise ni prévue pour ce parcours. La
distribution native sans Node.js reste différée. La validation de la structure
seule ne prouvera jamais la sûreté ni la qualité des skills ; la revue humaine et
les tests documentés de compatibilité restent nécessaires.
