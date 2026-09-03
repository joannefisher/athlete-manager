// components/gym/athleteAdmin.ts
// Round 18: Gym's new Setup page reuses TrainingPlanner.tsx's own
// AthleteProfilePage component directly for "Add Player" (per Joanne's
// explicit ask — "take and copy this functionality exactly including the UI
// from the Training Planner") rather than building a Gym-local equivalent.
// That component's prop contract needs athletes shaped with the FULL profile
// fields Training Planner itself uses (status/notes/isPublic/photo/injuries/
// defaultPosition) — not the minimal {id,name,avatar,positionNumbers}
// GymAthlete shape the rest of Gym fetches (see types.ts) — plus
// availabilityRecords/seasonDates for its embedded AvailabilityChart, which
// Gym doesn't otherwise pull at all. This file fetches/saves that fuller
// shape independently, mirroring TrainingPlanner.tsx's own
// fetchAllData/saveAthlete/deleteAthlete exactly — same athletes/
// athlete_positions/athlete_injuries tables, same column mapping.
//
// One deliberate simplification: Training Planner's own availability fetch
// also merges in EOD-report-derived pseudo-records; this port only reads
// real availability_records rows. AthleteProfilePage's AvailabilityChart
// still renders correctly from that alone — it just won't reflect EOD-only
// days. Can be added later if staff want full parity here.

import { supabase } from '@/lib/supabase';

export interface GymFullAthlete {
  id: string;
  name: string;
  status: string;
  notes: string;
  isPublic: boolean;
  avatar: string;
  photo: string;
  positionNumbers: number[];
  defaultPosition: number | null;
  injuries: any[];
}

export interface GymSeasonDate {
  id: string;
  title: string;
  fromDate: string;
  toDate: string;
  isDefault: boolean;
}

export interface GymAvailabilityRecord {
  id: string;
  date: string;
  athleteId: string;
  status: string;
  note: string;
}

/** Full athlete profile shape — mirrors TrainingPlanner.tsx's fetchAllData() athlete mapping. */
export async function fetchFullAthletes(clubId: string): Promise<GymFullAthlete[]> {
  const [{ data: athletesData, error }, { data: allPositions }, { data: allInjuries }] = await Promise.all([
    supabase.from('athletes').select('*').eq('club_id', clubId).order('name'),
    supabase.from('athlete_positions').select('*'),
    supabase.from('athlete_injuries').select('*'),
  ]);
  if (error) throw error;
  return (athletesData || []).map((a: any) => ({
    id: a.id,
    name: a.name,
    status: a.status,
    notes: a.notes,
    isPublic: a.is_public,
    avatar: a.avatar,
    photo: a.photo_url,
    defaultPosition: a.default_position ?? null,
    positionNumbers: (allPositions || []).filter((p: any) => p.athlete_id === a.id).map((p: any) => p.position_number),
    injuries: (allInjuries || []).filter((i: any) => i.athlete_id === a.id).map((i: any) => ({
      id: i.id,
      bodyPart: i.body_part,
      startDate: i.start_date,
      returnDate: i.return_date,
      surgeryDate: i.surgery_date || null,
      notes: i.notes,
      event: i.event,
      surface: i.surface,
      contact: i.contact,
    })),
  }));
}

/** Mirrors TrainingPlanner.tsx's own season_dates fetch — unfiltered (RLS-scoped), same as that file. */
export async function fetchSeasonDatesForGym(): Promise<GymSeasonDate[]> {
  const { data, error } = await supabase.from('season_dates').select('*').order('from_date');
  if (error) throw error;
  return (data || []).map((s: any) => ({
    id: s.id,
    title: s.title,
    fromDate: s.from_date,
    toDate: s.to_date,
    isDefault: s.is_default,
  }));
}

/** Mirrors TrainingPlanner.tsx's own availability_records fetch (real records only — see file header note above EOD merge). */
export async function fetchAvailabilityRecordsForGym(): Promise<GymAvailabilityRecord[]> {
  const { data, error } = await supabase.from('availability_records').select('id, date, athlete_id, status, note');
  if (error) throw error;
  return (data || []).map((r: any) => ({
    id: r.id,
    date: r.date,
    athleteId: r.athlete_id,
    status: r.status,
    note: r.note,
  }));
}

/**
 * Mirrors TrainingPlanner.tsx's saveAthlete exactly — same tables, same
 * insert/update + delete-then-reinsert positions/injuries shape. club_id is
 * now set explicitly on insert (2026-09-03 bug fix) — it used to be left
 * unset, on the assumption the athletes table filled it in automatically,
 * but there was never any actual evidence of that, and it's exactly what
 * caused "Add Player doesn't allow player creation" once migration 0011's
 * stricter RLS started rejecting a null-club_id insert. See TrainingPlanner
 * .tsx's saveAthlete for the same fix, applied there for the same reason.
 */
export async function saveGymAthlete(athlete: GymFullAthlete, clubId: string): Promise<string | undefined> {
  const isNew = !athlete.id;
  const athleteData = {
    name: athlete.name,
    status: athlete.status,
    notes: athlete.notes,
    is_public: athlete.isPublic,
    avatar: athlete.avatar,
    photo_url: athlete.photo,
    default_position: athlete.defaultPosition ?? null,
  };

  let athleteId = athlete.id;

  if (isNew) {
    const { data, error } = await supabase.from('athletes').insert({ ...athleteData, club_id: clubId }).select().single();
    if (error) throw error;
    athleteId = data.id;
  } else {
    const { error } = await supabase.from('athletes').update(athleteData).eq('id', athlete.id);
    if (error) throw error;
  }

  await supabase.from('athlete_positions').delete().eq('athlete_id', athleteId);
  if (athlete.positionNumbers?.length > 0) {
    await supabase
      .from('athlete_positions')
      .insert(athlete.positionNumbers.map((pn: number) => ({ athlete_id: athleteId, position_number: pn })));
  }

  await supabase.from('athlete_injuries').delete().eq('athlete_id', athleteId);
  if (athlete.injuries?.length > 0) {
    await supabase.from('athlete_injuries').insert(
      athlete.injuries.map((i: any) => ({
        athlete_id: athleteId,
        body_part: i.bodyPart,
        start_date: i.startDate,
        return_date: i.returnDate || null,
        surgery_date: i.surgeryDate || null,
        notes: i.notes,
        event: i.event || null,
        surface: i.surface || null,
        contact: i.contact || null,
      }))
    );
  }

  return athleteId;
}

/** Mirrors TrainingPlanner.tsx's deleteAthlete exactly. */
export async function deleteGymAthlete(athleteId: string): Promise<void> {
  const { error } = await supabase.from('athletes').delete().eq('id', athleteId);
  if (error) throw error;
}
