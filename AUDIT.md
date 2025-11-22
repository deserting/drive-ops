# Audit des outils "drive-ops"

## Synthèse rapide
- Front static en HTML/JS/CSS sans backend ; toutes les données sont chargées depuis des CSV/JSON locaux.
- Pas d'AGENTS.md ni de guidelines spécifiques trouvés.
- Plusieurs risques d'injection HTML/XSS car les entrées utilisateur ou les données de fichiers sont réinsérées via `innerHTML` sans échappement.
- Quelques bugs visibles (icônes SVG tronqués, validations partielles, UX perfectible) et opportunités de robustesse (parallélisme des chargements, caches locaux, résilience aux datasets manquants).

## Sécurité
- **Injection de contenu via l'éditeur Plan Designer** : les codes de meubles saisis dans les prompts sont directement interpolés dans le markup (cellules du tableau) sans échappement (`html += \`<td ...>${text}</td>\``). Une valeur contenant des balises serait réexécutée au rechargement (XSS stockée dans le navigateur) et copiée dans les exports JSON. Prévoir un échappement systématique ou l'utilisation de `textContent` + DOM API pour insérer les valeurs.【F:plan_designer.html†L758-L780】
- **Rendu HTML non échappé dans les heatmaps** : les id de meuble et les compteurs venant des CSV sont injectés via des templates (cellule + tooltip) avec `innerHTML`, sans contrôle de format. Un dataset malveillant pourrait injecter du script (XSS) lorsqu'on survole une cellule ou affiche le plan. Utiliser `textContent`/`createElement` et valider le format attendu (ex : `^[A-Z]{2}\d{2}$`).【F:heatmaps/js/heatmaps.js†L295-L333】
- **Stats livraisons rendues avec `innerHTML`** : les libellés de datasets (tirés des JSON) sont insérés dans le HTML des cartes de stats, ouvrant la porte à l'injection en cas de fichier compromis. Passer par des nœuds DOM et `textContent` ou normaliser les libellés avant affichage.【F:deliveries/js/deliveries.js†L321-L328】【F:deliveries/js/deliveries.js†L520-L521】
- **Chargement de fichiers sans validation stricte** : les fetchs des plans/datasets se contentent d'un `response.ok`. Aucune limite sur la taille, pas de timeout ni de validation de schéma JSON/CSV ; un fichier corrompu peut faire planter le rendu ou bloquer l'UI (boucles longues, `NaN`, etc.). Ajouter des garde-fous (taille max, validations de structure et de types) et encapsuler les erreurs pour poursuivre avec des données partielles.【F:heatmaps/js/heatmaps.js†L65-L105】【F:deliveries/js/deliveries.js†L57-L95】

## Bugs fonctionnels / UX
- **Icônes SVG cassés** : plusieurs balises `<circle>` sont tronquées (`ircle cx=...`) dans les écrans heatmap et livraisons, ce qui casse l'affichage et peut produire des erreurs de parsing dans certains navigateurs. Corriger les chemins SVG concernés.【F:deliveries/index.html†L86-L136】【F:heatmaps/index.html†L60-L138】
- **Grille du Plan Designer peu performante et sujette aux collisions silencieuses** : à chaque cellule rendue, `findMeubleAt` parcourt l'ensemble du layout (O(n²)) ; avec beaucoup de cases, l'UI devient lente. De plus, aucun verrou n'empêche de placer deux codes identiques : le dernier écrase silencieusement l'ancien, ce qui peut générer des plans incohérents. Représenter les positions dans une map indexée par coords et vérifier l'unicité des codes avant insertion.【F:plan_designer.html†L758-L820】
- **Mode rayon guidé sans borne ni validation d'ordre** : l'incrémentation continue à l'infini, même après sortie de grille, et aucune vérification n'empêche de sauter ou dupliquer un numéro de meuble. Ajouter des bornes (max row/col), une visualisation de la prochaine case attendue et un contrôle des collisions avant écrasement automatique.【F:plan_designer.html†L829-L887】
- **Retour utilisateur minimal sur les datasets livraisons/heatmaps manquants** : un dataset absent affiche juste un warning console/status, mais ne signale pas clairement quels jours ou types sont indisponibles ; l'utilisateur peut croire que les données sont vides. Prévoir un bandeau d’alerte listant les fichiers manquants ou un fallback explicite dans l’UI.【F:deliveries/js/deliveries.js†L57-L100】【F:heatmaps/js/heatmaps.js†L65-L105】
- **Accessibilité limitée** : nombreux boutons/inputs sans aria-label ni focus visible spécifique, et les barres/statistiques reposent sur des divs non navigables. Ajouter des labels explicites, gérer le focus clavier et proposer des alternatives textuelles pour les valeurs de heatmap et de bar chart.

## Performance / architecture
- **Chargements séquentiels** : les plans et datasets sont fetchés en série, ce qui dégrade le temps de démarrage quand plusieurs fichiers sont présents. Passer en `Promise.all` avec batch par zone/type accélérerait la mise en service et permettrait de reporter finement les erreurs par ressource.【F:heatmaps/js/heatmaps.js†L65-L105】【F:deliveries/js/deliveries.js†L57-L100】
- **Manipulation DOM inefficace** : le Plan Designer reconstruit toute la table à chaque changement et cherche les meubles par itération complète ; pour de grandes grilles cela devient coûteux. Utiliser un modèle de données indexé (maps `coord -> id` et `id -> coord`) et ne rerendre que les cellules affectées réduirait le coût CPU.【F:plan_designer.html†L758-L820】
- **Aucune persistance locale** : la configuration (dates sélectionnées, types de picking, plan en cours d'édition) n'est pas mémorisée. Un simple rafraîchissement fait perdre l’état. Stocker dans `localStorage` ou fournir une sauvegarde auto éviterait des re-sélections répétitives.

## Qualité de code / maintenabilité
- **Utils manquants et duplication** : parsing de dates, génération d’options et mises à jour de statut sont duplicés entre modules. Mutualiser dans un utilitaire partagé éviterait les divergences et faciliterait les tests.
- **APIs dépréciées** : le Plan Designer utilise `document.execCommand('copy')` pour le presse-papier ; l’API est obsolète. Basculer sur `navigator.clipboard.writeText` avec fallback améliore la compatibilité future.【F:plan_designer.html†L964-L969】
- **Absence de tests automatiques** : aucun test de validation des CSV/JSON ni de rendu. Introduire des tests unitaires (par ex. sur l’agrégation des créneaux et la détection de médiane) limiterait les régressions.

## Recommandations rapides
1. Sécuriser les rendus en bannissant `innerHTML` pour les données externes ou saisies, en normalisant/échappant les codes de meubles et libellés.
2. Corriger les icônes SVG corrompues et ajouter des messages utilisateurs explicites quand un dataset est manquant ou invalide.
3. Optimiser le Plan Designer avec une structure de données indexée, des validations d’unicité et une persistance locale des plans en cours.
4. Charger les plans/datasets en parallèle avec gestion fine des erreurs, et ajouter des validations de schéma/taille sur les fichiers importés.
5. Améliorer l’accessibilité (labels, focus, navigation clavier) et remplacer les APIs dépréciées (clipboard) pour préparer les évolutions.
