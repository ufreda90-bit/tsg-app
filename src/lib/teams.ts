import { Technician } from '../types';

export type Team = {
  id: number; // representative technician id
  name: string;
  representative: Technician;
  members: Technician[];
  color: string;
};

const DEFAULT_PALETTE = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

const TEAM_DEFS: Array<{ name: string; members: string[] }> = [
  { name: 'Squadra 1', members: ['Mariano'] },
  { name: 'Squadra 2', members: ['Francesco', 'Alessandro'] },
  { name: 'Squadra 3', members: ['Giuliano', 'Beni'] },
  { name: 'Squadra 4', members: ['Cosimo', 'Antonio'] },
  { name: 'Squadra 5', members: ['Giuseppe'] },
  { name: 'Squadra 6', members: ['Jo', 'Momo'] }
];

const normalizeName = (value: string) => value.trim().toLowerCase();

export function buildTeams(technicians: Technician[]): Team[] {
  if (!Array.isArray(technicians)) {
    return [];
  }
  const sorted = [...technicians].sort((a, b) => a.id - b.id);
  const techByName = new Map<string, Technician>();
  for (const tech of sorted) {
    const key = normalizeName(tech.name);
    if (!techByName.has(key)) {
      techByName.set(key, tech);
    }
  }

  const teams: Team[] = [];
  const usedIds = new Set<number>();
  let paletteIdx = 0;

  for (const def of TEAM_DEFS) {
    const members = def.members
      .map((name) => techByName.get(normalizeName(name)))
      .filter((t): t is Technician => !!t);
    if (members.length === 0) continue;
    const representative = members[0];
    members.forEach((m) => usedIds.add(m.id));
    let color = representative.color;
    if (!color || !color.startsWith('#')) {
      color = DEFAULT_PALETTE[paletteIdx % DEFAULT_PALETTE.length];
      paletteIdx++;
    }
    teams.push({
      id: representative.id,
      name: def.name,
      representative,
      members,
      color
    });
  }

  const leftovers = sorted.filter((t) => !usedIds.has(t.id));
  for (let i = 0; i < leftovers.length; i += 2) {
    const members = leftovers.slice(i, i + 2);
    if (members.length === 0) continue;
    const representative = members[0];
    let color = representative.color;
    if (!color || !color.startsWith('#')) {
      color = DEFAULT_PALETTE[paletteIdx % DEFAULT_PALETTE.length];
      paletteIdx++;
    }
    teams.push({
      id: representative.id,
      name: `Squadra ${teams.length + 1}`,
      representative,
      members,
      color
    });
  }

  return teams;
}

export function buildTeamMaps(technicians: Technician[]) {
  const teams = buildTeams(technicians);
  const techIdToTeamId = new Map<number, number>();
  const techIdToTeamName = new Map<number, string>();

  for (const team of teams) {
    for (const member of team.members) {
      techIdToTeamId.set(member.id, team.id);
      techIdToTeamName.set(member.id, team.name);
    }
  }

  return { teams, techIdToTeamId, techIdToTeamName };
}
