// Localisation (#114): French first. English is the key; a missing translation shows the English. The menus, tool
// names, dock tabs and the most used dialogs go through t(); commands, their descriptions and the copilot stay
// English (they are an API).
export const LANGUAGES = { en: 'English', fr: 'Français' };

const FR = {
  // menus
  File: 'Fichier', Edit: 'Édition', Arrange: 'Disposer', View: 'Affichage', Tools: 'Outils', Animate: 'Animer', Site: 'Site', Drawings: 'Plans', AI: 'IA', Help: 'Aide',
  // dock tabs
  Outliner: 'Structure', Entity: 'Entité', Materials: 'Matières', Scenes: 'Scènes', Library: 'Biblio', Survey: 'Topo', Settings: 'Réglages',
  // tool groups and tools
  Draw: 'Dessiner', Modify: 'Modifier', Construct: 'Construire', Drafting: 'Dessin 2D', Camera: 'Caméra', Shape: 'Forme', Parametric: 'Paramétrique', Recipes: 'Recettes', Annotate: 'Annoter', Lights: 'Lumières', Style: 'Style', Render: 'Rendu', Depth: 'Avancé',
  Select: 'Sélection', Line: 'Ligne', Rectangle: 'Rectangle', Circle: 'Cercle', Polygon: 'Polygone', 'Push/Pull': 'Pousser/Tirer', Move: 'Déplacer', Rotate: 'Faire pivoter', Scale: 'Échelle', 'Tape Measure': 'Mètre', 'Paint Bucket': 'Pot de peinture', Eraser: 'Gomme', 'Section Plane': 'Plan de coupe', Orbit: 'Orbite', Pan: 'Panoramique', 'Zoom window': 'Fenêtre de zoom',
  // common actions
  'New model': 'Nouveau modèle', 'Open…': 'Ouvrir…', Save: 'Enregistrer', 'Save as…': 'Enregistrer sous…', Undo: 'Annuler', Redo: 'Rétablir', Copy: 'Copier', Cut: 'Couper', 'Paste in place': 'Coller sur place', Delete: 'Supprimer', Duplicate: 'Dupliquer', 'Select all': 'Tout sélectionner', 'Select none': 'Ne rien sélectionner',
  'Make group': 'Grouper', 'Explode group': 'Dégrouper', Hide: 'Masquer', 'Unhide all': 'Tout afficher', 'Zoom extents': 'Zoom étendu', 'How do I…': 'Comment faire…', 'Take the 2-minute tour': 'Visite guidée (2 minutes)', 'Check for updates': 'Rechercher des mises à jour',
  'Export drawing sheet (PDF, SVG)…': 'Exporter une planche (PDF, SVG)…', 'Render video (MP4, WebM, GIF, PNG)…': 'Rendre une vidéo (MP4, WebM, GIF, PNG)…', 'Render photoreal still (path traced)…': 'Rendu photoréaliste (lancer de rayons)…',
  'Import (LandXML, IFC, DXF, models)…': 'Importer (LandXML, IFC, DXF, modèles)…', 'Units and precision…': 'Unités et précision…', 'Model info…': 'Infos du modèle…',
  // panels
  Layers: 'Calques', Components: 'Composants', Profiles: 'Profils', 'Selection sets': 'Jeux de sélection', 'Colour by layer': 'Couleur par calque', Measurements: 'Mesures', Tracks: 'Pistes',
  'Ask in plain words. The copilot uses every modelling, animation and file command, sees what you selected, and each of its turns is a single undo step.': 'Demandez simplement. Le copilote utilise toutes les commandes de modélisation, d’animation et de fichiers, voit votre sélection, et chacun de ses tours s’annule en une fois.',
  'Describe what to build or animate…  (Enter sends, Shift+Enter new line)': 'Décrivez ce qu’il faut construire ou animer…  (Entrée envoie, Maj+Entrée nouvelle ligne)',
  Language: 'Langue', Appearance: 'Apparence', 'Dark theme': 'Thème sombre', Close: 'Fermer', Cancel: 'Annuler', Run: 'Exécuter', Apply: 'Appliquer',
  'Hold to talk': 'Maintenir pour parler', Versions: 'Versions', Documents: 'Documents', 'Keyboard shortcuts': 'Raccourcis clavier',
};

let lang = 'en';
export const setLanguage = (l) => (lang = LANGUAGES[l] ? l : 'en');
export const language = () => lang;
/** The text in the current language (English when there is no translation). */
export const t = (s) => (lang === 'fr' && FR[s]) || s;
/** How much of a list of strings has a translation (for the tests and the settings page). */
export const coverage = (list) => list.filter((s) => FR[s]).length / Math.max(1, list.length);
