export type ChangelogHighlight = {
  title: string;
  description: string;
};

export type ChangelogEntry = {
  /** Identifiant unique et stable (jamais réutilisé) — sert à savoir qui l'a déjà vu */
  id: string;
  /** Date de mise en ligne (affichée) */
  date: string;
  title: string;
  subtitle?: string;
  /** Rôles ciblés en minuscules, null = tout le staff */
  roles: string[] | null;
  highlights: ChangelogHighlight[];
  /** Bouton d'action optionnel : event window custom et/ou lien interne */
  action?: { label: string; event?: string; href?: string };
};

/**
 * Ajoute une entrée ICI à chaque déploiement d'une nouveauté :
 * le staff concerné verra automatiquement le popup « Nouveautés » à sa
 * prochaine visite (une seule fois par personne, suivi en localStorage).
 * L'entrée la plus récente en PREMIER.
 */
export const CHANGELOG_ENTRIES: ChangelogEntry[] = [
  {
    id: "2026-07-notes-rappels",
    date: "2026-07-18",
    title: "Notes & Rappels",
    subtitle: "Nouvel outil pour le call center",
    roles: ["admin", "commercial", "developer"],
    highlights: [
      {
        title: "Bloc-notes personnel",
        description: "Note tes suivis clients en 2 secondes depuis n'importe quelle page, via l'icône 📝 dans la barre du haut.",
      },
      {
        title: "Rappels avec alarme",
        description: "Programme un rappel (ex: rappeler un client à 14h) : à l'heure dite, une alerte plein écran s'affiche avec une sonnerie forte.",
      },
      {
        title: "Lié à la page en cours",
        description: "Coche « Lier à cette page » pour retrouver la commande ou la fiche client d'un clic depuis la note.",
      },
      {
        title: "Snooze & priorités",
        description: "Reporte un rappel (+30 min, +1 h, demain 9h), classe par priorité Normal / Important / Urgent, épingle l'essentiel.",
      },
    ],
    action: { label: "Essayer maintenant", event: "zango:open-notes" },
  },
];
