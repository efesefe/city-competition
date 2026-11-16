/** Owner-approved Kabile aliases — see docs/team-aliases.md */

export type Team = {
  internalId: string;
  publicAlias: string;
  primary: string;
  secondary: string;
  big4: boolean;
};

export const TEAMS: Team[] = [
  { internalId: "sl_galatasaray", publicAlias: "Aslan Kabilesi", primary: "#A90432", secondary: "#FDB912", big4: true },
  { internalId: "sl_fenerbahce", publicAlias: "Kanarya Kabilesi", primary: "#FFE900", secondary: "#00205B", big4: true },
  { internalId: "sl_besiktas", publicAlias: "Kartal Kabilesi", primary: "#000000", secondary: "#FFFFFF", big4: true },
  { internalId: "sl_trabzonspor", publicAlias: "Fırtına Kabilesi", primary: "#6B1028", secondary: "#74B3E0", big4: true },
  { internalId: "sl_basaksehir", publicAlias: "Baykuş Kabilesi", primary: "#F36C21", secondary: "#00205B", big4: false },
  { internalId: "sl_kasimpasa", publicAlias: "Korsan Kabilesi", primary: "#00205B", secondary: "#FFFFFF", big4: false },
  { internalId: "sl_eyupspor", publicAlias: "Sultan Kabilesi", primary: "#8E44AD", secondary: "#F1C40F", big4: false },
  { internalId: "sl_goztepe", publicAlias: "Gözcü Kabilesi", primary: "#E30613", secondary: "#FFD100", big4: false },
  { internalId: "sl_samsunspor", publicAlias: "Atlılar Kabilesi", primary: "#E30613", secondary: "#FFFFFF", big4: false },
  { internalId: "sl_rizespor", publicAlias: "Atmaca Kabilesi", primary: "#007A3D", secondary: "#0033A0", big4: false },
  { internalId: "sl_konyaspor", publicAlias: "Çift Başlı Kartal Kabilesi", primary: "#007A33", secondary: "#FFFFFF", big4: false },
  { internalId: "sl_kocaelispor", publicAlias: "Körfez Kabilesi", primary: "#006B3F", secondary: "#111111", big4: false },
  { internalId: "sl_alanyaspor", publicAlias: "Güneş Kabilesi", primary: "#F36C00", secondary: "#007A33", big4: false },
  { internalId: "sl_gaziantep", publicAlias: "Şahin Kabilesi", primary: "#E30613", secondary: "#000000", big4: false },
  { internalId: "sl_genclerbirligi", publicAlias: "Rüzgar Kabilesi", primary: "#E30613", secondary: "#111111", big4: false },
  { internalId: "sl_erzurumspor", publicAlias: "Dadaş Kabilesi", primary: "#0033A0", secondary: "#FFFFFF", big4: false },
  { internalId: "sl_amed", publicAlias: "Sur Kabilesi", primary: "#007A33", secondary: "#E30613", big4: false },
  { internalId: "sl_corum", publicAlias: "Hitit Kabilesi", primary: "#E30613", secondary: "#111111", big4: false },
];

export const TEAM_BY_ALIAS = new Map(TEAMS.map((t) => [t.publicAlias, t]));
export const TEAM_BY_ID = new Map(TEAMS.map((t) => [t.internalId, t]));

/** Runtime registry for ticket-accepted / DB-loaded teams beyond the static Süper Lig set. */
const DYNAMIC: Team[] = [];

export function registerTeam(t: Team): void {
  TEAM_BY_ID.set(t.internalId, t);
  TEAM_BY_ALIAS.set(t.publicAlias, t);
  const idx = DYNAMIC.findIndex((x) => x.internalId === t.internalId);
  if (idx >= 0) DYNAMIC[idx] = t;
  else if (!TEAMS.some((x) => x.internalId === t.internalId)) DYNAMIC.push(t);
}

function allTeams(): Team[] {
  return [...TEAMS, ...DYNAMIC.filter((d) => !TEAMS.some((t) => t.internalId === d.internalId))];
}

/** Big 4 (Aslan / Kanarya / Kartal / Fırtına) then remaining Süper Lig aliases (+ dynamic). */
export function teamsForPicker(): Team[] {
  const { big4, rest } = teamsGroupedForPicker();
  return [...big4, ...rest];
}

export function teamsGroupedForPicker(): { big4: Team[]; rest: Team[] } {
  const all = allTeams();
  return {
    big4: all.filter((t) => t.big4),
    rest: all.filter((t) => !t.big4),
  };
}
