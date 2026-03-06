import { Team, TeamMember, Technician } from '../types';
import { apiFetch } from './apiFetch';
import { buildTeams } from './teams';

type FetchTeamsResult =
  | { ok: true; teams: Team[] }
  | { ok: false; error: string };

const DEFAULT_TEAM_COLOR = '#3b82f6';

const toErrorMessage = async (res: Response, fallback: string) => {
  try {
    const payload = await res.clone().json();
    if (payload && typeof payload === 'object') {
      const message =
        (typeof (payload as { message?: unknown }).message === 'string'
          ? (payload as { message: string }).message
          : '') ||
        (typeof (payload as { error?: unknown }).error === 'string'
          ? (payload as { error: string }).error
          : '');
      if (message.trim()) return message.trim();
    }
  } catch {
    // ignore
  }
  try {
    const text = await res.clone().text();
    if (text.trim()) return text.trim();
  } catch {
    // ignore
  }
  return fallback;
};

export async function fetchTeams(signal?: AbortSignal): Promise<FetchTeamsResult> {
  try {
    const res = await apiFetch('/api/teams', { signal });
    if (!res.ok) {
      return {
        ok: false,
        error: await toErrorMessage(res, `Errore caricamento squadre (HTTP ${res.status})`)
      };
    }
    const payload = await res.json().catch(() => null);
    if (!Array.isArray(payload)) {
      return { ok: false, error: 'Risposta squadre non valida' };
    }
    return { ok: true, teams: payload as Team[] };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, error: 'Richiesta squadre annullata' };
    }
    return { ok: false, error: 'Errore di rete caricamento squadre' };
  }
}

export function buildTeamMapsFromTeams(teams: Team[]) {
  const techIdToTeamId = new Map<number, number>();
  const techIdToTeamName = new Map<number, string>();

  for (const team of teams) {
    for (const memberId of team.memberIds) {
      techIdToTeamId.set(memberId, team.id);
      techIdToTeamName.set(memberId, team.name);
    }
  }

  return { teams, techIdToTeamId, techIdToTeamName };
}

export function buildDemoTeamsFromTechnicians(technicians: Technician[]): Team[] {
  if (!Array.isArray(technicians) || technicians.length === 0) return [];
  const now = new Date().toISOString();
  const demoTeams = buildTeams(technicians);

  return demoTeams.map((demoTeam) => {
    const members: TeamMember[] = demoTeam.members.map((member) => ({
      id: member.id,
      name: member.name,
      color: member.color || DEFAULT_TEAM_COLOR,
      isActive: true
    }));
    const memberIds = members.map((member) => member.id);
    return {
      id: demoTeam.id,
      name: demoTeam.name,
      color: demoTeam.color || DEFAULT_TEAM_COLOR,
      memberIds,
      members,
      memberCount: members.length,
      isActive: true,
      capacityPerDay: null,
      notes: null,
      createdAt: now,
      updatedAt: now
    };
  });
}
