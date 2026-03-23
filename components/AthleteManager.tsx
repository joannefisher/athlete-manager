'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Search, Plus, User, Menu, MessageSquare, X, ChevronDown, ChevronUp, Users, Calendar, Zap, Target, ArrowLeft, Camera, Settings, Trash2, Edit2, Check, BarChart3, AlertCircle, Loader2, SlidersHorizontal, Lock } from 'lucide-react';
import { supabase } from '@/lib/supabase';

const BODY_PARTS = ['Head', 'Neck', 'Shoulder', 'Arm', 'Elbow', 'Wrist', 'Hand', 'Chest', 'Back', 'Hip', 'Groin', 'Thigh', 'Hamstring', 'Knee', 'Calf', 'Ankle', 'Foot', 'Other'];

type Role = 'Admin' | 'S&C' | 'Physio' | 'Coach';

const ROLE_ACCESS: Record<Role, string[]> = {
  'Admin':  ['home', 'availability', 'athlete-profile', 'session-plan', 'add-drill', 'reporting', 'setup'],
  'S&C':    ['availability', 'athlete-profile', 'reporting'],
  'Physio': ['availability', 'athlete-profile', 'reporting'],
  'Coach':  ['home', 'session-plan', 'add-drill', 'reporting'],
};

// Type definitions
interface TeamPosition {
  id: string;
  number: number;
  name: string;
  group: string;
}

interface Injury {
  id: string;
  bodyPart: string;
  startDate: string;
  returnDate: string | null;
  notes: string;
  event?: string;
  surface?: string;
  contact?: string;
}

interface Athlete {
  id: string;
  name: string;
  status: string;
  notes: string;
  isPublic: boolean;
  avatar: string;
  photo: string;
  positionNumbers: number[];
  injuries: Injury[];
}

interface DrillType {
  id: string;
  name: string;
  positions: number[];
  defaultDuration: number;
}

interface SeasonDate {
  id: string;
  title: string;
  fromDate: string;
  toDate: string;
  isDefault: boolean;
}

interface AvailabilityRecord {
  id: string;
  date: string;
  athleteId: string;
  status: string;
  note: string;
}

interface Drill {
  id: string;
  name: string;
  type: string;
  intensity: string;
  notes: string;
  duration: number;   // minutes
  isBreak?: boolean;  // if true, only name+duration shown
  team1: Record<number, string>;
  team2: Record<number, string>;
  subs1: Record<number, string>;
  subs2: Record<number, string>;
}

interface SessionPlanRecord {
  date: string;
  drills: Drill[];
}

interface DefaultTeam {
  team1: Record<number, string>;
  team2: Record<number, string>;
  subs1: Record<number, string>;
  subs2: Record<number, string>;
}

// ── Shared status helpers used across the app ───────────────────────────────
const STATUS_STYLES: Record<string, { dot: string; badge: string; select: string; optBg: string }> = {
  Available:   { dot: 'bg-green-500',  badge: 'bg-green-50 text-green-700 border-green-200',  select: 'bg-green-500 text-white border-green-600',  optBg: '#16a34a' },
  Modified:    { dot: 'bg-amber-500',  badge: 'bg-amber-50 text-amber-700 border-amber-200',  select: 'bg-amber-500 text-white border-amber-600',  optBg: '#d97706' },
  Unavailable: { dot: 'bg-red-500',    badge: 'bg-red-50   text-red-700   border-red-200',    select: 'bg-red-500   text-white border-red-600',    optBg: '#dc2626' },
};

/** Coloured pill badge — use anywhere you show a read-only status */
const StatusBadge = ({ status, size = 'sm' }: { status: string; size?: 'xs' | 'sm' }) => {
  const s = STATUS_STYLES[status] || STATUS_STYLES['Available'];
  return (
    <span className={`inline-flex items-center gap-1 font-medium border rounded-full ${size === 'xs' ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5'} ${s.badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
      {status}
    </span>
  );
};

/** Coloured select — compact pill-style, matches StatusBadge proportions */
const StatusSelect = ({ value, onChange, className = '' }: { value: string; onChange: (v: string) => void; className?: string }) => {
  const s = STATUS_STYLES[value] || STATUS_STYLES['Available'];
  return (
    <div className={`relative inline-flex items-center ${className}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none z-10 ${s.dot}`} />
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`h-6 pl-5 pr-5 text-[11px] rounded-full border font-semibold appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-offset-1 focus:ring-blue-400 ${s.badge}`}
        style={{ WebkitAppearance: 'none' }}
      >
        {Object.keys(STATUS_STYLES).map(opt => (
          <option key={opt} value={opt} style={{ backgroundColor: STATUS_STYLES[opt].optBg, color: '#fff', fontWeight: 600 }}>{opt}</option>
        ))}
      </select>
      <div className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2">
        <svg className={`w-2 h-2 opacity-50`} fill="none" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </div>
    </div>
  );
};

const AthleteManager = () => {
  const [currentPage, setCurrentPage] = useState('home');
  const [showMenu, setShowMenu] = useState(false);
  const [selectedAthleteId, setSelectedAthleteId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Data states with types
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [drills, setDrills] = useState<Drill[]>([]);
  const [weekDrills, setWeekDrills] = useState<Record<string, Drill[]>>({});
  const [drillTypes, setDrillTypes] = useState<DrillType[]>([]);
  const [seasonDates, setSeasonDates] = useState<SeasonDate[]>([]);
  const [availabilityRecords, setAvailabilityRecords] = useState<AvailabilityRecord[]>([]);
  const [sessionPlanRecords, setSessionPlanRecords] = useState<SessionPlanRecord[]>([]);
  const [teamStructure, setTeamStructure] = useState<TeamPosition[]>([]);
  const [defaultTeam, setDefaultTeam] = useState<DefaultTeam>({ team1: {}, team2: {}, subs1: {}, subs2: {} });

  // ============================================
  // SUPABASE DATA FETCHING
  // ============================================

  const fetchAllData = useCallback(async () => {
    setLoading(true);
    try {
      const todayStr = new Date().toISOString().split('T')[0];

      // Fire all independent queries in parallel
      const [
        { data: teamData },
        { data: athletesData },
        { data: allPositions },
        { data: allInjuries },
        { data: todayRecords },
        { data: drillTypesData },
        { data: allDrillTypePositions },
        { data: seasonData },
        { data: availData },
        { data: eodData },
        { data: defaultTeamData },
      ] = await Promise.all([
        supabase.from('team_structure').select('*').order('number'),
        supabase.from('athletes').select('*').order('name'),
        supabase.from('athlete_positions').select('*'),
        supabase.from('athlete_injuries').select('*'),
        supabase.from('availability_records').select('athlete_id, status, note').eq('date', todayStr),
        supabase.from('drill_types').select('*').order('name'),
        supabase.from('drill_type_positions').select('*'),
        supabase.from('season_dates').select('*').order('from_date'),
        supabase.from('availability_records').select('id, date, athlete_id, status, note'),
        supabase.from('eod_reports').select('id, date, athlete_id, status, note, is_public, selection_status'),
        supabase.from('default_team').select('*'),
      ]);

      // Team structure
      if (teamData) setTeamStructure(teamData.map((t: any) => ({
        id: t.id, number: t.number, name: t.name, group: t.position_group
      })));

      // Athletes — overlay today's availability_records on top
      const todayMap: Record<string, { status: string; note: string }> = {};
      (todayRecords || []).forEach((r: any) => { todayMap[r.athlete_id] = { status: r.status, note: r.note }; });
      if (athletesData) setAthletes(athletesData.map((a: any) => {
        const todayRec = todayMap[a.id];
        return {
          id: a.id, name: a.name,
          status: todayRec ? todayRec.status : a.status,
          notes: todayRec ? todayRec.note : a.notes,
          isPublic: a.is_public, avatar: a.avatar, photo: a.photo_url,
          positionNumbers: (allPositions || []).filter((p: any) => p.athlete_id === a.id).map((p: any) => p.position_number),
          injuries: (allInjuries || []).filter((i: any) => i.athlete_id === a.id).map((i: any) => ({
            id: i.id, bodyPart: i.body_part, startDate: i.start_date,
            returnDate: i.return_date, notes: i.notes,
            event: i.event, surface: i.surface, contact: i.contact,
          }))
        };
      }));

      // Drill types
      if (drillTypesData) setDrillTypes(drillTypesData.map((dt: any) => ({
        id: dt.id, name: dt.name,
        defaultDuration: dt.default_duration || 0,
        positions: (allDrillTypePositions || []).filter((p: any) => p.drill_type_id === dt.id).map((p: any) => p.position_number)
      })));

      // Season dates
      if (seasonData) setSeasonDates(seasonData.map((s: any) => ({
        id: s.id, title: s.title, fromDate: s.from_date, toDate: s.to_date, isDefault: s.is_default
      })));

      // Availability records + EOD reports merged
      const eodAsRecords = (eodData || []).map((r: any) => ({
        id: 'eod_' + r.id, date: r.date + '__EOD__',
        athleteId: r.athlete_id, status: r.status, note: r.note,
        isPublic: r.is_public, selectionStatus: r.selection_status,
      }));
      if (availData) setAvailabilityRecords([
        ...availData.map((r: any) => ({ id: r.id, date: r.date, athleteId: r.athlete_id, status: r.status, note: r.note })),
        ...eodAsRecords,
      ]);

      // Default team
      if (defaultTeamData) {
        const team1: Record<number, string> = {}, team2: Record<number, string> = {},
              subs1: Record<number, string> = {}, subs2: Record<number, string> = {};
        defaultTeamData.forEach((dt: any) => {
          if (dt.team_number === 1) { if (dt.is_substitute) subs1[dt.position_number] = dt.athlete_id; else team1[dt.position_number] = dt.athlete_id; }
          else { if (dt.is_substitute) subs2[dt.position_number] = dt.athlete_id; else team2[dt.position_number] = dt.athlete_id; }
        });
        setDefaultTeam({ team1, team2, subs1, subs2 });
      }

      // Session plan (depends on nothing else, run after state is set)
      await loadSessionPlan(todayStr);
      // Pre-load the full current week
      const weekDates = (() => {
        const d = new Date(todayStr + 'T00:00:00');
        const day = d.getDay();
        const mon = new Date(d);
        mon.setDate(d.getDate() - ((day + 6) % 7));
        return Array.from({ length: 7 }, (_, i) => {
          const dd = new Date(mon); dd.setDate(mon.getDate() + i);
          return dd.toISOString().split('T')[0];
        });
      })();
      await loadWeekDrills(weekDates);

    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSessionPlan = async (date: string) => {
    // Step 1: get session plan for this date
    const { data: sessionPlan } = await supabase
      .from('session_plans')
      .select('*')
      .eq('date', date)
      .maybeSingle();

    if (!sessionPlan) { setDrills([]); return; }

    // Step 2: get drills for this session plan
    const { data: drillsData } = await supabase
      .from('drills')
      .select('*')
      .eq('session_plan_id', sessionPlan.id)
      .order('sort_order');

    if (!drillsData || drillsData.length === 0) { setDrills([]); return; }

    // Step 3: get all team assignments for these drills
    const drillIds = drillsData.map((d: any) => d.id);
    const { data: assignments } = await supabase
      .from('drill_team_assignments')
      .select('*')
      .in('drill_id', drillIds);

    setDrills(drillsData.map((d: any) => {
      const team1: Record<number, string> = {}, team2: Record<number, string> = {}, subs1: Record<number, string> = {}, subs2: Record<number, string> = {};
      (assignments || []).filter((a: any) => a.drill_id === d.id).forEach((a: any) => {
        if (a.team_number === 1) {
          if (a.is_substitute) subs1[a.position_number] = a.athlete_id;
          else team1[a.position_number] = a.athlete_id;
        } else {
          if (a.is_substitute) subs2[a.position_number] = a.athlete_id;
          else team2[a.position_number] = a.athlete_id;
        }
      });
      return { id: d.id, name: d.name, type: d.drill_type, intensity: d.intensity, notes: d.notes, duration: d.duration || 0, isBreak: d.is_break || false, team1, team2, subs1, subs2 };
    }));
  };

  // Load an entire week of session plans in parallel
  const loadWeekDrills = async (weekDates: string[]) => {
    const results = await Promise.all(weekDates.map(async (date) => {
      const { data: sp } = await supabase.from('session_plans').select('id').eq('date', date).maybeSingle();
      if (!sp) return { date, drills: [] };
      const { data: drillsData } = await supabase.from('drills').select('*').eq('session_plan_id', sp.id).order('sort_order');
      if (!drillsData || drillsData.length === 0) return { date, drills: [] };
      const drillIds = drillsData.map((d: any) => d.id);
      const { data: assignments } = await supabase.from('drill_team_assignments').select('*').in('drill_id', drillIds);
      const loaded = drillsData.map((d: any) => {
        const team1: Record<number, string> = {}, team2: Record<number, string> = {}, subs1: Record<number, string> = {}, subs2: Record<number, string> = {};
        (assignments || []).filter((a: any) => a.drill_id === d.id).forEach((a: any) => {
          if (a.team_number === 1) { if (a.is_substitute) subs1[a.position_number] = a.athlete_id; else team1[a.position_number] = a.athlete_id; }
          else { if (a.is_substitute) subs2[a.position_number] = a.athlete_id; else team2[a.position_number] = a.athlete_id; }
        });
        return { id: d.id, name: d.name, type: d.drill_type, intensity: d.intensity, notes: d.notes, duration: d.duration || 0, isBreak: d.is_break || false, team1, team2, subs1, subs2 };
      });
      return { date, drills: loaded };
    }));
    const map: Record<string, Drill[]> = {};
    results.forEach(r => { map[r.date] = r.drills; });
    setWeekDrills(map);
    return map;
  };

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  // ============================================
  // SUPABASE SAVE FUNCTIONS
  // ============================================

  const saveAthlete = async (athlete: Athlete) => {
    setSaving(true);
    try {
      const isNew = typeof athlete.id === 'number' || !athlete.id || /^\d{13}$/.test(String(athlete.id));

      const athleteData = {
        name: athlete.name,
        status: athlete.status,
        notes: athlete.notes,
        is_public: athlete.isPublic,
        avatar: athlete.avatar,
        photo_url: athlete.photo
      };

      let athleteId = athlete.id;

      if (isNew) {
        const { data, error } = await supabase
          .from('athletes')
          .insert(athleteData)
          .select()
          .single();
        if (error) throw error;
        athleteId = data.id;
      } else {
        const { error } = await supabase
          .from('athletes')
          .update(athleteData)
          .eq('id', athlete.id);
        if (error) throw error;
      }

      // Update positions
      await supabase.from('athlete_positions').delete().eq('athlete_id', athleteId);
      if (athlete.positionNumbers?.length > 0) {
        await supabase.from('athlete_positions').insert(
          athlete.positionNumbers.map((pn: number) => ({ athlete_id: athleteId, position_number: pn }))
        );
      }

      // Update injuries
      await supabase.from('athlete_injuries').delete().eq('athlete_id', athleteId);
      if (athlete.injuries?.length > 0) {
        await supabase.from('athlete_injuries').insert(
          athlete.injuries.map((i: Injury) => ({
            athlete_id: athleteId,
            body_part: i.bodyPart,
            start_date: i.startDate,
            return_date: i.returnDate || null,
            notes: i.notes
          }))
        );
      }

      await fetchAllData();
      return athleteId;
    } catch (error) {
      console.error('Error saving athlete:', error);
    } finally {
      setSaving(false);
    }
  };

  const deleteAthlete = async (athleteId: string) => {
    try {
      await supabase.from('athletes').delete().eq('id', athleteId);
      await fetchAllData();
    } catch (error) {
      console.error('Error deleting athlete:', error);
    }
  };


  const saveEndOfDayReport = async (date: string, eodAthletes: Athlete[]) => {
    setSaving(true);
    try {
      // Step 1: Delete existing EOD snapshot for this date, then insert fresh rows.
      // Avoids relying on named constraint for upsert (which requires the constraint
      // to be explicitly named in Postgres — not always available via Supabase JS client).
      const { error: delEodErr } = await supabase
        .from('eod_reports')
        .delete()
        .eq('date', date);
      if (delEodErr) throw new Error('Clear EOD snapshot: ' + delEodErr.message);

      const eodRows = eodAthletes.map((a: Athlete) => ({
        date,
        athlete_id: a.id,
        status: a.status,
        note: a.notes || '',
        is_public: a.isPublic,
        selection_status: (a as any).selectionStatus || 'Available for Selection',
      }));
      const { error: insEodErr } = await supabase
        .from('eod_reports')
        .insert(eodRows);
      if (insEodErr) throw new Error('Save EOD snapshot: ' + insEodErr.message);

      // Step 2: Update injuries only — these are date-independent and
      // must apply immediately (e.g. a new injury added today is still
      // active tomorrow). We deliberately do NOT update athletes.status
      // or athletes.notes here — that would change today's Availability
      // screen, which must stay as-is until the user edits it directly.
      for (const a of eodAthletes) {
        const { error: injDelErr } = await supabase.from('athlete_injuries').delete().eq('athlete_id', a.id);
        if (injDelErr) throw new Error('Delete injuries: ' + injDelErr.message);

        if (a.injuries && a.injuries.length > 0) {
          const { error: injInsErr } = await supabase.from('athlete_injuries').insert(
            a.injuries.map((i: any) => ({
              athlete_id: a.id,
              body_part: i.bodyPart,
              start_date: i.startDate,
              return_date: i.returnDate || null,
              notes: i.notes,
              event: i.event || null,
              surface: i.surface || null,
              contact: i.contact || null,
            }))
          );
          if (injInsErr) throw new Error('Insert injuries: ' + injInsErr.message);
        }
      }

      // Step 3: Write availability_records for tomorrow so that when the
      // app is opened the next day, fetchAllData picks up EOD statuses as
      // the starting point for the new day's Availability screen.
      const tomorrow = new Date(date);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split('T')[0];

      await supabase.from('availability_records').delete().eq('date', tomorrowStr);
      const tomorrowRecords = eodAthletes.map((a: Athlete) => ({
        date: tomorrowStr,
        athlete_id: a.id,
        status: a.status,
        note: a.notes || '',
      }));
      const { error: insTomErr } = await supabase.from('availability_records').insert(tomorrowRecords);
      if (insTomErr) throw new Error('Insert tomorrow records: ' + insTomErr.message);

      // Only re-fetch the records that changed — avoids full reload
      const [{ data: newAvail }, { data: newEod }] = await Promise.all([
        supabase.from('availability_records').select('id, date, athlete_id, status, note'),
        supabase.from('eod_reports').select('id, date, athlete_id, status, note, is_public, selection_status'),
      ]);
      const eodAsRecs = (newEod || []).map((r: any) => ({
        id: 'eod_' + r.id, date: r.date + '__EOD__',
        athleteId: r.athlete_id, status: r.status, note: r.note,
        isPublic: r.is_public, selectionStatus: r.selection_status,
      }));
      setAvailabilityRecords([
        ...(newAvail || []).map((r: any) => ({ id: r.id, date: r.date, athleteId: r.athlete_id, status: r.status, note: r.note })),
        ...eodAsRecs,
      ]);
      // Refresh injuries (changed in EOD save)
      const { data: freshInjuries } = await supabase.from('athlete_injuries').select('*');
      setAthletes(prev => prev.map(a => ({
        ...a,
        injuries: (freshInjuries || []).filter((i: any) => i.athlete_id === a.id).map((i: any) => ({
          id: i.id, bodyPart: i.body_part, startDate: i.start_date,
          returnDate: i.return_date, notes: i.notes,
          event: i.event, surface: i.surface, contact: i.contact,
        }))
      })));
    } catch (error) {
      console.error('Error saving EOD report:', error);
      setSaving(false);
      throw error;
    }
    setSaving(false);
  };

  const saveAvailability = async (date: string, athletesOverride?: Athlete[]) => {
    setSaving(true);
    try {
      const source = athletesOverride || athletes;
      await supabase.from('availability_records').delete().eq('date', date);
      const records = source.map((a: Athlete) => ({
        date,
        athlete_id: a.id,
        status: a.status,
        note: a.notes || ''
      }));
      await supabase.from('availability_records').insert(records);
      // Only re-fetch availability records — not the entire dataset
      const { data: newAvail } = await supabase.from('availability_records').select('id, date, athlete_id, status, note');
      const { data: eodData } = await supabase.from('eod_reports').select('id, date, athlete_id, status, note, is_public, selection_status');
      const eodAsRecords = (eodData || []).map((r: any) => ({
        id: 'eod_' + r.id, date: r.date + '__EOD__',
        athleteId: r.athlete_id, status: r.status, note: r.note,
        isPublic: r.is_public, selectionStatus: r.selection_status,
      }));
      setAvailabilityRecords([
        ...(newAvail || []).map((r: any) => ({ id: r.id, date: r.date, athleteId: r.athlete_id, status: r.status, note: r.note })),
        ...eodAsRecords,
      ]);
    } catch (error) {
      console.error('Error saving availability:', error);
    } finally {
      setSaving(false);
    }
  };

  const saveSessionPlan = async (date: string, drillsToSave: Drill[]) => {
    setSaving(true);
    try {
      // Get or create session plan
      let { data: sessionPlan } = await supabase
        .from('session_plans')
        .select('id')
        .eq('date', date)
        .maybeSingle();

      if (!sessionPlan) {
        const { data } = await supabase
          .from('session_plans')
          .insert({ date })
          .select()
          .single();
        sessionPlan = data;
      }

      if (!sessionPlan) {
        throw new Error('Failed to create session plan');
      }

      // Delete existing drills for this session
      await supabase.from('drills').delete().eq('session_plan_id', sessionPlan.id);

      if (drillsToSave.length > 0) {
        // Insert all drills in one batch
        const { data: newDrills } = await supabase
          .from('drills')
          .insert(drillsToSave.map((drill, i) => ({
            session_plan_id: sessionPlan.id,
            name: drill.name,
            drill_type: drill.type,
            intensity: drill.intensity,
            notes: drill.notes,
            duration: drill.duration || 0,
            is_break: drill.isBreak || false,
            sort_order: i,
          })))
          .select();

        // Build all team assignments and insert in one batch
        const allAssignments: any[] = [];
        (newDrills || []).forEach((newDrill: any, i: number) => {
          const drill = drillsToSave[i];
          const push = (pos: string, athleteId: any, teamNum: number, isSub: boolean) => {
            if (athleteId) allAssignments.push({ drill_id: newDrill.id, position_number: parseInt(pos), team_number: teamNum, is_substitute: isSub, athlete_id: athleteId });
          };
          Object.entries(drill.team1 || {}).forEach(([p, id]) => push(p, id, 1, false));
          Object.entries(drill.team2 || {}).forEach(([p, id]) => push(p, id, 2, false));
          Object.entries(drill.subs1 || {}).forEach(([p, id]) => push(p, id, 1, true));
          Object.entries(drill.subs2 || {}).forEach(([p, id]) => push(p, id, 2, true));
        });
        if (allAssignments.length > 0) {
          await supabase.from('drill_team_assignments').insert(allAssignments);
        }
      }
    } catch (error) {
      console.error('Error saving session plan:', error);
    } finally {
      setSaving(false);
    }
  };

  const saveDefaultTeam = async (team: DefaultTeam) => {
    setSaving(true);
    try {
      await supabase.from('default_team').delete();

      const assignments: any[] = [];
      Object.entries(team.team1 || {}).forEach(([pos, athleteId]) => {
        if (athleteId) assignments.push({ position_number: parseInt(pos), team_number: 1, is_substitute: false, athlete_id: athleteId });
      });
      Object.entries(team.team2 || {}).forEach(([pos, athleteId]) => {
        if (athleteId) assignments.push({ position_number: parseInt(pos), team_number: 2, is_substitute: false, athlete_id: athleteId });
      });
      Object.entries(team.subs1 || {}).forEach(([pos, athleteId]) => {
        if (athleteId) assignments.push({ position_number: parseInt(pos), team_number: 1, is_substitute: true, athlete_id: athleteId });
      });
      Object.entries(team.subs2 || {}).forEach(([pos, athleteId]) => {
        if (athleteId) assignments.push({ position_number: parseInt(pos), team_number: 2, is_substitute: true, athlete_id: athleteId });
      });

      if (assignments.length > 0) {
        await supabase.from('default_team').insert(assignments);
      }

      setDefaultTeam(team);
    } catch (error) {
      console.error('Error saving default team:', error);
    } finally {
      setSaving(false);
    }
  };

  const saveDrillType = async (drillType: DrillType) => {
    setSaving(true);
    try {
      const isNew = typeof drillType.id === 'number' || !drillType.id || /^\d{13}$/.test(String(drillType.id));
      let drillTypeId = drillType.id;

      if (isNew) {
        const { data } = await supabase
          .from('drill_types')
          .insert({ name: drillType.name, default_duration: drillType.defaultDuration || 0 })
          .select()
          .single();
        drillTypeId = data.id;
      } else {
        await supabase.from('drill_types').update({ name: drillType.name, default_duration: drillType.defaultDuration || 0 }).eq('id', drillType.id);
      }

      await supabase.from('drill_type_positions').delete().eq('drill_type_id', drillTypeId);
      if (drillType.positions?.length > 0) {
        await supabase.from('drill_type_positions').insert(
          drillType.positions.map((pn: number) => ({ drill_type_id: drillTypeId, position_number: pn }))
        );
      }

      await fetchAllData();
    } catch (error) {
      console.error('Error saving drill type:', error);
    } finally {
      setSaving(false);
    }
  };

  const deleteDrillType = async (drillTypeId: string) => {
    try {
      await supabase.from('drill_types').delete().eq('id', drillTypeId);
      await fetchAllData();
    } catch (error) {
      console.error('Error deleting drill type:', error);
    }
  };

  const saveSeasonDate = async (seasonDate: SeasonDate) => {
    setSaving(true);
    try {
      const isNew = typeof seasonDate.id === 'number' || !seasonDate.id || /^\d{13}$/.test(String(seasonDate.id));

      if (seasonDate.isDefault) {
        await supabase.from('season_dates').update({ is_default: false }).neq('id', seasonDate.id);
      }

      const data = {
        title: seasonDate.title,
        from_date: seasonDate.fromDate,
        to_date: seasonDate.toDate,
        is_default: seasonDate.isDefault
      };

      if (isNew) {
        await supabase.from('season_dates').insert(data);
      } else {
        await supabase.from('season_dates').update(data).eq('id', seasonDate.id);
      }

      await fetchAllData();
    } catch (error) {
      console.error('Error saving season date:', error);
    } finally {
      setSaving(false);
    }
  };

  const deleteSeasonDate = async (seasonDateId: string) => {
    try {
      await supabase.from('season_dates').delete().eq('id', seasonDateId);
      await fetchAllData();
    } catch (error) {
      console.error('Error deleting season date:', error);
    }
  };

  const saveTeamStructure = async (position: TeamPosition) => {
    setSaving(true);
    try {
      const isNew = typeof position.id === 'number' || !position.id || /^\d{13}$/.test(String(position.id));

      const data = {
        number: position.number,
        name: position.name,
        position_group: position.group
      };

      if (isNew) {
        await supabase.from('team_structure').insert(data);
      } else {
        await supabase.from('team_structure').update(data).eq('id', position.id);
      }

      await fetchAllData();
    } catch (error) {
      console.error('Error saving team structure:', error);
    } finally {
      setSaving(false);
    }
  };

  const deleteTeamStructurePosition = async (positionId: string) => {
    try {
      await supabase.from('team_structure').delete().eq('id', positionId);
      await fetchAllData();
    } catch (error) {
      console.error('Error deleting position:', error);
    }
  };

  // Handle date change for session plan
  const getWeekDates = (date: string): string[] => {
    const d = new Date(date + 'T00:00:00');
    const day = d.getDay(); // 0=Sun
    // Week starts Monday
    const mon = new Date(d);
    mon.setDate(d.getDate() - ((day + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => {
      const dd = new Date(mon);
      dd.setDate(mon.getDate() + i);
      return dd.toISOString().split('T')[0];
    });
  };

  const handleDateChange = async (newDate: string) => {
    setSelectedDate(newDate);
    // Load all 7 days of the containing week
    await loadWeekDrills(getWeekDates(newDate));
  };

  const [role, setRole] = useState<Role>('Admin');
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false);

  useEffect(() => {
    if (!roleDropdownOpen) return;
    const close = () => setRoleDropdownOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [roleDropdownOpen]);

  const navigateTo = (page: string) => { setCurrentPage(page); setShowMenu(false); };
  const getPageTitle = () => ({ home: 'Home', availability: 'Availability', 'session-plan': 'Session Plan', 'add-drill': 'Create Drill', 'athlete-profile': 'Athlete Profile', setup: 'Setup', reporting: 'Reporting' }[currentPage] || 'Team');

  // loading is now an overlay so the app shell stays visible

  const allNavItems = [
    { page: 'home', Icon: Target, label: 'Home' },
    { page: 'availability', Icon: Calendar, label: 'Availability' },
    { page: 'session-plan', Icon: Zap, label: 'Session Plan' },
    { page: 'reporting', Icon: BarChart3, label: 'Reporting' },

    { page: 'setup', Icon: Settings, label: 'Setup' },
  ];
  const navItems = allNavItems.filter(item => ROLE_ACCESS[role].includes(item.page));

  // If current page not accessible for role, redirect to first allowed page
  const allowedPages = ROLE_ACCESS[role];
  const effectivePage = allowedPages.includes(currentPage) ? currentPage : allowedPages[0];

  const RoleDropdown = ({ dark = false }: { dark?: boolean }) => {
    if (!dark) {
      return (
        <select value={role} onChange={e => { const r = e.target.value as Role; setRole(r); setCurrentPage(ROLE_ACCESS[r][0]); }}
          className="text-xs border border-slate-200 rounded px-2 py-1.5 bg-white text-slate-700 font-medium focus:ring-2 focus:ring-blue-500">
          {(['Admin', 'S&C', 'Physio', 'Coach'] as Role[]).map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      );
    }
    return (
      <div className="relative">
        <button onClick={() => setRoleDropdownOpen(o => !o)}
          className="w-full flex items-center justify-between px-2.5 py-1.5 bg-white/[0.07] border border-white/10 rounded text-[12px] text-white/65 cursor-pointer">
          {role}
          <ChevronDown className={`w-3 h-3 text-white/30 transition-transform ${roleDropdownOpen ? 'rotate-180' : ''}`} />
        </button>
        {roleDropdownOpen && (
          <div className="absolute bottom-full left-0 right-0 mb-1 bg-slate-800 border border-white/10 rounded shadow-xl overflow-hidden z-50">
            {(['Admin', 'S&C', 'Physio', 'Coach'] as Role[]).map(r => (
              <button key={r} onClick={() => { setRole(r); setCurrentPage(ROLE_ACCESS[r][0]); setRoleDropdownOpen(false); }}
                className={`w-full text-left px-3 py-2 text-[12px] transition-colors ${role === r ? 'bg-white/10 text-white' : 'text-white/55 hover:bg-white/[0.06] hover:text-white/80'}`}>
                {r}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Inline loading overlay — sits above page content, doesn't replace it */}
      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-[1px]">
          <div className="flex flex-col items-center gap-3 bg-white rounded-xl shadow-xl px-8 py-6">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            <p className="text-[13px] font-medium text-slate-600">Loading…</p>
          </div>
        </div>
      )}

      {/* Desktop sidebar — visible md+ */}
      <aside className="hidden md:flex flex-col w-52 shrink-0 bg-slate-900 sticky top-0 h-screen z-10">
        {/* Brand */}
        <div className="px-4 py-5 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded bg-blue-600 flex items-center justify-center shrink-0">
              <Target className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
            </div>
            <span className="text-[13px] font-semibold text-slate-100 tracking-tight">Athlete Manager</span>
          </div>
        </div>
        {/* Nav */}
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto pt-3">
          <p className="text-[9px] font-semibold text-white/25 uppercase tracking-[0.9px] px-2.5 pb-2">Menu</p>
          {navItems.map(({ page, Icon, label }) => (
            <button key={page} onClick={() => navigateTo(page)}
              className={`w-full text-left px-2.5 py-2 rounded flex items-center gap-2.5 text-[13px] transition-colors relative ${effectivePage === page ? 'bg-white/[0.08] text-slate-100 font-medium' : 'text-white/40 hover:bg-white/[0.06] hover:text-white/70'}`}>
              {effectivePage === page && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-blue-500 rounded-r" />}
              <Icon className="w-3.5 h-3.5 shrink-0" strokeWidth={effectivePage === page ? 2 : 1.8} />{label}
            </button>
          ))}
        </nav>
        {/* Role */}
        <div className="p-3 border-t border-white/[0.06]">
          <p className="text-[9px] font-semibold text-white/25 uppercase tracking-[0.9px] mb-2">Viewing as</p>
          <RoleDropdown dark={true} />
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">

        {/* Mobile top bar — hidden md+ */}
        <header className="md:hidden bg-white sticky top-0 z-10 border-b border-slate-200 px-4 py-3">
          <div className="flex items-center justify-between max-w-md mx-auto">
            <button onClick={() => setShowMenu(!showMenu)} className="p-1.5 hover:bg-slate-100 rounded-lg"><Menu className="w-5 h-5 text-slate-600" /></button>
            <h1 className="text-[15px] font-semibold text-slate-900">{getPageTitle()}</h1>
            <RoleDropdown dark={false} />
          </div>
        </header>

        {/* Desktop page header — visible md+ */}
        <div className="hidden md:flex items-center justify-between bg-white border-b border-slate-200 px-6 py-3.5">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900 leading-none">{getPageTitle()}</h2>
            <p className="text-[11px] text-slate-400 mt-1 font-light">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
          </div>
        </div>

        {/* Mobile slide-out menu */}
        {showMenu && (
          <div className="fixed inset-0 bg-black/20 z-20 md:hidden" onClick={() => setShowMenu(false)}>
            <div className="bg-slate-900 w-60 h-full shadow-xl flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="px-4 py-5 border-b border-white/[0.06]">
                <div className="flex items-center gap-2.5">
                  <div className="w-6 h-6 rounded bg-blue-600 flex items-center justify-center shrink-0">
                    <Target className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
                  </div>
                  <span className="text-[13px] font-semibold text-slate-100">Athlete Manager</span>
                </div>
              </div>
              <div className="p-2 flex-1">
                {navItems.map(({ page, Icon, label }) => (
                  <button key={page} onClick={() => navigateTo(page)}
                    className={`w-full text-left px-2.5 py-2.5 rounded flex items-center gap-2.5 text-[13px] ${effectivePage === page ? 'bg-white/[0.08] text-slate-100 font-medium' : 'text-white/40 hover:bg-white/[0.06]'}`}>
                    <Icon className="w-3.5 h-3.5 shrink-0" />{label}
                  </button>
                ))}
              </div>
              <div className="p-3 border-t border-white/[0.06]">
                <p className="text-[9px] font-semibold text-white/25 uppercase tracking-[0.9px] mb-2">Viewing as</p>
                <RoleDropdown dark={true} />
              </div>
            </div>
          </div>
        )}

        {/* Page content */}
        <div className="flex-1">
          {effectivePage === 'home' && <HomePage athletes={athletes} navigateTo={navigateTo} setSelectedAthleteId={setSelectedAthleteId} teamStructure={teamStructure} />}
          {effectivePage === 'availability' && <AvailabilityPage athletes={athletes} setAthletes={setAthletes} navigateTo={navigateTo} setSelectedAthleteId={setSelectedAthleteId} selectedDate={selectedDate} setSelectedDate={setSelectedDate} availabilityRecords={availabilityRecords} teamStructure={teamStructure} onSave={saveAvailability} onSaveEOD={saveEndOfDayReport} saving={saving} fetchAllData={fetchAllData} />}
          {effectivePage === 'session-plan' && <SessionPlanPage drills={drills} setDrills={setDrills} weekDrills={weekDrills} setWeekDrills={setWeekDrills} navigateTo={navigateTo} athletes={athletes} drillTypes={drillTypes} teamStructure={teamStructure} defaultTeam={defaultTeam} onSaveDefaultTeam={saveDefaultTeam} selectedDate={selectedDate} onDateChange={handleDateChange} onSaveSessionPlan={saveSessionPlan} saving={saving} getWeekDates={getWeekDates} />}
          {effectivePage === 'add-drill' && <AddDrillPage drills={drills} setDrills={setDrills} weekDrills={weekDrills} setWeekDrills={setWeekDrills} selectedDate={selectedDate} navigateTo={navigateTo} drillTypes={drillTypes} defaultTeam={defaultTeam} athletes={athletes} teamStructure={teamStructure} />}
          {effectivePage === 'athlete-profile' && <AthleteProfilePage athletes={athletes} athleteId={selectedAthleteId} navigateTo={navigateTo} availabilityRecords={availabilityRecords} seasonDates={seasonDates} teamStructure={teamStructure} onSave={saveAthlete} onDelete={deleteAthlete} saving={saving} />}
          {effectivePage === 'reporting' && <ReportingPage athletes={athletes} availabilityRecords={availabilityRecords} seasonDates={seasonDates} teamStructure={teamStructure} />}

          {effectivePage === 'setup' && <SetupPage drillTypes={drillTypes} seasonDates={seasonDates} teamStructure={teamStructure} onSaveDrillType={saveDrillType} onDeleteDrillType={deleteDrillType} onSaveSeasonDate={saveSeasonDate} onDeleteSeasonDate={deleteSeasonDate} onSaveTeamStructure={saveTeamStructure} onDeleteTeamStructure={deleteTeamStructurePosition} saving={saving} />}
        </div>
      </div>
    </div>
  );
};

const getPositionDisplay = (positionNumbers: number[], teamStructure: TeamPosition[]): string => {
  if (!positionNumbers || positionNumbers.length === 0) return '-';
  return [...new Set(positionNumbers.map(num => teamStructure.find(p => p.number === num)?.name).filter(Boolean))].join(', ');
};

const getPositionGroup = (positionNumbers: number[], teamStructure: TeamPosition[]): string => {
  if (!positionNumbers || positionNumbers.length === 0) return '';
  const groups = [...new Set(positionNumbers.map(num => teamStructure.find(p => p.number === num)?.group).filter(Boolean))];
  return groups.length === 1 ? groups[0] as string : groups.length > 1 ? 'Forward/Back' : '';
};

const getActiveInjuries = (athlete: Athlete): Injury[] => {
  if (!athlete?.injuries) return [];
  const today = new Date().toISOString().split('T')[0];
  return athlete.injuries.filter(inj => !inj.returnDate || inj.returnDate >= today);
};

const InjuryDisplay = ({ athlete }: { athlete: Athlete }) => {
  const activeInjuries = getActiveInjuries(athlete);
  if (activeInjuries.length === 0) return null;
  return (
    <div className="mt-2 p-2 bg-red-50 rounded border border-red-100">
      <div className="flex items-start gap-1.5">
        <AlertCircle className="w-3 h-3 text-red-500 mt-0.5 flex-shrink-0" />
        <div className="text-xs text-red-700 space-y-0.5">
          {activeInjuries.map(inj => (
            <div key={inj.id}>{inj.bodyPart}{inj.notes ? ` — ${inj.notes}` : ''}{inj.returnDate ? <span className="text-slate-400 ml-1">ETR {new Date(inj.returnDate).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })}</span> : <span className="text-red-600 font-medium ml-1">Season</span>}</div>
          ))}
        </div>
      </div>
    </div>
  );
};

const HomePage = ({ athletes, navigateTo, setSelectedAthleteId, teamStructure }: { athletes: Athlete[], navigateTo: (page: string) => void, setSelectedAthleteId: (id: string | null) => void, teamStructure: TeamPosition[] }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [availableOnly, setAvailableOnly] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState<string[]>(['Forward', 'Back']);
  const [selectedPositionNames, setSelectedPositionNames] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  const uniquePositionNames = useMemo(() => {
    const names = new Map();
    athletes.forEach((a: Athlete) => {
      (a.positionNumbers || []).forEach((posNum: number) => {
        const pos = teamStructure.find((p: TeamPosition) => p.number === posNum);
        if (pos && !names.has(pos.name)) names.set(pos.name, { name: pos.name, numbers: [], group: pos.group });
        if (pos) names.get(pos.name).numbers.push(posNum);
      });
    });
    return Array.from(names.values());
  }, [athletes, teamStructure]);

  const toggleGroup = (group: string) => {
    const groupPositionNames = uniquePositionNames.filter(p => p.group === group).map(p => p.name);
    if (selectedGroups.includes(group)) {
      setSelectedGroups(prev => prev.filter(g => g !== group));
      setSelectedPositionNames(prev => prev.filter(n => !groupPositionNames.includes(n)));
    } else {
      setSelectedGroups(prev => [...prev, group]);
    }
  };

  const togglePositionName = (posName: string) => {
    setSelectedPositionNames(prev => prev.includes(posName) ? prev.filter(n => n !== posName) : [...prev, posName]);
  };

  const getSurname = (n: string) => { const p = n.trim().split(' '); return p.length > 1 ? p[p.length - 1].toLowerCase() : n.toLowerCase(); };
  const filtered = athletes.filter(a => {
    if (!a.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    if (availableOnly && a.status === 'Unavailable') return false;
    if (selectedGroups.length < 2 || selectedPositionNames.length > 0) {
      const posNames = (a.positionNumbers || []).map((n: number) => teamStructure.find(p => p.number === n)?.name).filter(Boolean);
      const groups = (a.positionNumbers || []).map((n: number) => teamStructure.find(p => p.number === n)?.group).filter(Boolean);
      if (selectedPositionNames.length > 0 && !posNames.some(n => selectedPositionNames.includes(n as string))) return false;
      if (selectedGroups.length < 2 && !groups.some(g => selectedGroups.includes(g as string))) return false;
    }
    return true;
  }).sort((a, b) => getSurname(a.name).localeCompare(getSurname(b.name)));

  const getStatusDotColor = (s: string) => s === 'Available' ? 'bg-green-500' : s === 'Modified' ? 'bg-amber-500' : 'bg-red-500';

  const totals = {
    available: athletes.filter(a => a.status === 'Available').length,
    modified: athletes.filter(a => a.status === 'Modified').length,
    unavailable: athletes.filter(a => a.status === 'Unavailable').length,
  };

  return (
    <div className="max-w-md md:max-w-3xl mx-auto p-4 md:p-6">

      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        {[
          { label: 'Available', value: totals.available, bar: 'bg-green-500' },
          { label: 'Modified', value: totals.modified, bar: 'bg-amber-500' },
          { label: 'Unavailable', value: totals.unavailable, bar: 'bg-red-500' },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-lg border border-slate-200 px-4 py-3 flex items-center justify-between">
            <div>
              <div className="text-2xl font-semibold text-slate-900 leading-none tracking-tight">{k.value}</div>
              <div className="text-[11px] text-slate-400 mt-1.5">{k.label}</div>
            </div>
            <div className={`w-1 h-7 rounded-sm ${k.bar}`} />
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="bg-white rounded-lg border border-slate-200 mb-4 overflow-hidden">
        <div className="flex gap-2 p-2.5">
          <div className="flex-1 relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 w-3.5 h-3.5" />
            <input type="text" placeholder="Search athletes…" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 h-8 text-[13px] border border-slate-200 rounded bg-slate-50 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
          <button onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-1.5 h-8 px-3 border border-slate-200 rounded text-[12px] text-slate-600 bg-white hover:bg-slate-50 transition-colors">
            <SlidersHorizontal className="w-3 h-3" />Filter
            {showFilters ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>
        {showFilters && (
          <div className="px-3 pb-3 border-t border-slate-100 pt-2.5 flex flex-wrap gap-4 items-center">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-slate-500">Group</span>
              <div className="flex gap-1">
                {['Forward', 'Back'].map(group => (
                  <button key={group} onClick={() => toggleGroup(group)}
                    className={`h-6 px-2.5 rounded text-[11px] font-medium border transition-colors ${selectedGroups.includes(group) ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`}>
                    {group}s
                  </button>
                ))}
              </div>
            </div>
            {uniquePositionNames.length > 0 && (
              <div className="flex items-start gap-2">
                <span className="text-[11px] font-medium text-slate-500 mt-0.5">Position</span>
                <div className="flex flex-wrap gap-1">
                  {uniquePositionNames.map(pos => (
                    <button key={pos.name} onClick={() => togglePositionName(pos.name)}
                      className={`h-6 px-2 rounded text-[11px] border transition-colors ${selectedPositionNames.includes(pos.name) ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`}>
                      {pos.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={availableOnly} onChange={e => setAvailableOnly(e.target.checked)} className="w-3.5 h-3.5 accent-blue-600" />
              <span className="text-[11px] font-medium text-slate-500">Available only</span>
            </label>
          </div>
        )}
      </div>

      {/* Count */}
      <p className="text-[11px] text-slate-400 mb-3">{filtered.length} of {athletes.length} athletes</p>

      {/* Athlete cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {filtered.map(a => (
          <div key={a.id} className="bg-white rounded-lg border border-slate-200 p-3.5 cursor-pointer hover:border-slate-300 hover:shadow-sm transition-all"
            onClick={() => { setSelectedAthleteId(a.id); navigateTo('athlete-profile'); }}>
            <div className="flex items-center gap-3">
              {a.photo
                ? <img src={a.photo} alt="" className="w-8 h-8 rounded-md object-cover flex-shrink-0" />
                : <div className="w-8 h-8 bg-slate-100 rounded-md flex items-center justify-center text-[10px] font-semibold text-slate-500 flex-shrink-0">{a.avatar}</div>}
              <div className="flex-1 min-w-0">
                <h3 className="text-[13px] font-medium text-slate-900 leading-none">{a.name}</h3>
                <p className="text-[11px] text-slate-400 mt-1">{getPositionDisplay(a.positionNumbers, teamStructure)}</p>
              </div>
              <div className="flex-shrink-0">
                <StatusBadge status={a.status} size="xs" />
              </div>
            </div>
            {/* Group tag */}
            {getPositionGroup(a.positionNumbers, teamStructure) && (
              <div className="mt-2.5">
                <span className="text-[10px] font-medium text-slate-400 bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5">{getPositionGroup(a.positionNumbers, teamStructure)}</span>
              </div>
            )}
            {a.notes && a.isPublic && (
              <div className="mt-2 p-2 bg-blue-50 border border-blue-100 rounded flex items-start gap-1.5">
                <MessageSquare className="w-3 h-3 mt-0.5 flex-shrink-0 text-blue-400" />
                <span className="text-[11px] text-blue-700">{a.notes}</span>
              </div>
            )}
            <InjuryDisplay athlete={a} />
          </div>
        ))}
      </div>
    </div>
  );
};


const EndOfDayReport = ({ athletes, setAthletes, teamStructure, date, onSaveEOD, onBack, saving, savedEodData }: any) => {
  const typedTeamStructure: TeamPosition[] = teamStructure;
  const today = new Date().toISOString().split('T')[0];

  // Local working copy — hydrate from saved EOD report if one exists,
  // otherwise start from today's current athlete data.
  const [eodAthletes, setEodAthletes] = useState<Athlete[]>(() => {
    if (savedEodData && savedEodData.length > 0) {
      // Merge saved EOD fields (status, notes, selectionStatus) over athlete base data
      return athletes.map((a: Athlete) => {
        const saved = savedEodData.find((r: any) => r.athlete_id === a.id);
        if (!saved) return { ...a, injuries: a.injuries ? [...a.injuries] : [] };
        return {
          ...a,
          status: saved.status,
          notes: saved.note || '',
          isPublic: saved.is_public ?? a.isPublic,
          selectionStatus: saved.selection_status || 'Available for Selection',
          injuries: a.injuries ? [...a.injuries] : [],
        };
      });
    }
    return athletes.map((a: Athlete) => ({ ...a, injuries: a.injuries ? [...a.injuries] : [] }));
  });
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [showInjuryModal, setShowInjuryModal] = useState(false);
  const [activeAthleteId, setActiveAthleteId] = useState<string | null>(null);
  const [tempNote, setTempNote] = useState('');
  const [tempIsPublic, setTempIsPublic] = useState(false);
  const [injuryData, setInjuryData] = useState<any>({ bodyPart: 'Head', startDate: today, returnDate: '', notes: '', event: 'Training', surface: '4G', contact: 'Contact' });
  const [editingInjuryId, setEditingInjuryId] = useState<string | null>(null);

  const updateAthlete = (id: string, patch: Partial<Athlete>) =>
    setEodAthletes(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a));

  const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';

  const [saveError, setSaveError] = useState<string | null>(null);
  const handleSave = async () => {
    setSaveError(null);
    try {
      await onSaveEOD(date, eodAthletes);
      // Do NOT call setAthletes here — today's availability screen must stay unchanged.
      // EOD changes are written to tomorrow's availability_records and take effect next day.
      setShowSaveSuccess(true);
      setTimeout(() => { setShowSaveSuccess(false); onBack(); }, 1500);
    } catch (err: any) {
      setSaveError(err?.message || 'Save failed — please try again');
    }
  };

  const openNoteModal = (a: Athlete) => {
    setActiveAthleteId(a.id);
    setTempNote(a.notes || '');
    setTempIsPublic(a.isPublic || false);
    setShowNoteModal(true);
  };

  const saveNote = () => {
    if (!activeAthleteId) return;
    updateAthlete(activeAthleteId, { notes: tempNote, isPublic: tempIsPublic });
    setShowNoteModal(false);
  };

  const openAddInjury = (athleteId: string) => {
    setActiveAthleteId(athleteId);
    setEditingInjuryId(null);
    setInjuryData({ bodyPart: 'Head', startDate: today, returnDate: '', notes: '', event: 'Training', surface: '4G', contact: 'Contact' });
    setShowInjuryModal(true);
  };

  const openEditInjury = (athleteId: string, inj: Injury) => {
    setActiveAthleteId(athleteId);
    setEditingInjuryId(inj.id);
    setInjuryData({ bodyPart: inj.bodyPart, startDate: inj.startDate, returnDate: inj.returnDate || '', notes: inj.notes || '', event: (inj as any).event || 'Training', surface: (inj as any).surface || '4G', contact: (inj as any).contact || 'Contact' });
    setShowInjuryModal(true);
  };

  const saveInjury = () => {
    if (!activeAthleteId || !injuryData.bodyPart || !injuryData.startDate) return;
    const athlete = eodAthletes.find(a => a.id === activeAthleteId);
    if (!athlete) return;
    const newInj: any = { ...injuryData, id: editingInjuryId || String(Date.now()) };
    const updatedInjuries = editingInjuryId
      ? (athlete.injuries || []).map((i: any) => i.id === editingInjuryId ? newInj : i)
      : [...(athlete.injuries || []), newInj];
    updateAthlete(activeAthleteId, { injuries: updatedInjuries });
    setShowInjuryModal(false);
  };

  const removeInjury = (athleteId: string, injuryId: string) => {
    const athlete = eodAthletes.find(a => a.id === athleteId);
    if (!athlete) return;
    updateAthlete(athleteId, { injuries: (athlete.injuries || []).filter((i: any) => i.id !== injuryId) });
  };

  // Sort order AND group membership are fixed at mount — status changes never re-order or re-group
  const [rowMeta] = useState<{ id: string; initialStatus: string }[]>(() => {
    const statusOrder: Record<string, number> = { 'Available': 0, 'Modified': 1, 'Unavailable': 2 };
    return [...athletes]
      .sort((a: any, b: any) => {
        const so = (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3);
        return so !== 0 ? so : a.name.localeCompare(b.name);
      })
      .map((a: any) => ({ id: a.id, initialStatus: a.status }));
  });
  // Render in fixed order, live data from eodAthletes
  const sorted = rowMeta
    .map(m => {
      const a = eodAthletes.find(x => x.id === m.id);
      return a ? { athlete: a, initialStatus: m.initialStatus } : null;
    })
    .filter(Boolean) as { athlete: Athlete; initialStatus: string }[];

  const activeInjuries = (a: Athlete) => {
    if (!a.injuries) return [];
    return a.injuries.filter((i: any) => !i.returnDate || i.returnDate >= today);
  };

  const displayDate = new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="max-w-md md:max-w-5xl mx-auto p-4 md:p-6">
      {showSaveSuccess && <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-green-700 text-white px-4 py-2 rounded-lg shadow-lg z-50 text-[13px] font-medium">✓ End of Day Report saved — changes applied to future days</div>}
      {saveError && <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg z-50 text-[13px] font-medium">⚠ {saveError}</div>}

      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
          <ArrowLeft className="w-4 h-4 text-slate-600" />
        </button>
        <div>
          <h2 className="text-[15px] font-semibold text-slate-900">End of Day Report</h2>
          <p className="text-[11px] text-slate-400 mt-0.5">{displayDate}</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-700 font-medium">
          <AlertCircle className="w-3 h-3" />Changes apply to future days only
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden mb-24">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Athlete</th>
                <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Position</th>
                <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider hidden md:table-cell">Selection</th>
                <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Notes / Injury</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {sorted.map(({ athlete: a, initialStatus }, idx) => {
                // showGroup uses INITIAL status so headers never move when status changes
                const prevInitial = idx > 0 ? sorted[idx - 1].initialStatus : null;
                const showGroup = !prevInitial || prevInitial !== initialStatus;
                const groupCount = sorted.filter(x => x.initialStatus === initialStatus).length;
                const injuries = activeInjuries(a);
                const isModifiedOrUnavailable = a.status === 'Modified' || a.status === 'Unavailable';
                // Status colour helpers — reflect LIVE status on the row/dot
                const statusDot = a.status === 'Available' ? 'bg-green-500' : a.status === 'Modified' ? 'bg-amber-500' : 'bg-red-500';
                const groupHeaderCls = initialStatus === 'Available' ? 'bg-green-50 text-green-700' : initialStatus === 'Modified' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700';
                return (
                  <React.Fragment key={a.id}>
                    {showGroup && (
                      <tr>
                        <td colSpan={5} className={`px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider ${groupHeaderCls}`}>
                          {initialStatus} ({groupCount})
                        </td>
                      </tr>
                    )}
                    <tr className="hover:bg-slate-50 transition-colors">
                      {/* Name + live status dot */}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDot}`} />
                          <span className="text-[13px] font-medium text-slate-800 whitespace-nowrap">{a.name}</span>
                        </div>
                      </td>
                      {/* Position */}
                      <td className="px-3 py-2.5 text-[12px] text-slate-500 whitespace-nowrap">
                        {getPositionDisplay(a.positionNumbers, typedTeamStructure)}
                      </td>
                      {/* Status — custom coloured dropdown */}
                      <td className="px-3 py-2.5">
                        <StatusSelect value={a.status} onChange={val => updateAthlete(a.id, { status: val })} />
                      </td>
                      {/* Selection — only for Modified (not Unavailable) */}
                      <td className="px-3 py-2.5 hidden md:table-cell">
                        {a.status === 'Modified' && (
                          <select value={(a as any).selectionStatus || 'Available for Selection'}
                            onChange={e => updateAthlete(a.id, { selectionStatus: e.target.value } as any)}
                            className="h-7 px-2 text-[11px] rounded border border-slate-200 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white">
                            <option>Available for Selection</option>
                            <option>Unavailable for Selection</option>
                          </select>
                        )}
                      </td>
                      {/* Notes & Injuries */}
                      <td className="px-3 py-2.5">
                        <div className="space-y-1.5">
                          {injuries.map((inj: any) => (
                            <div key={inj.id} className="flex items-start gap-1.5 p-1.5 bg-red-50 border border-red-100 rounded text-[11px] text-red-700">
                              <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0 text-red-400" />
                              <span className="flex-1">{inj.bodyPart}{inj.notes ? ` — ${inj.notes}` : ''}{inj.returnDate ? <span className="text-slate-400 ml-1">ETR {fmtDate(inj.returnDate)}</span> : <span className="text-red-500 font-medium ml-1">Season</span>}</span>
                              <button onClick={() => openEditInjury(a.id, inj)} className="p-0.5 hover:bg-red-100 rounded flex-shrink-0"><Edit2 className="w-2.5 h-2.5 text-red-500" /></button>
                              <button onClick={() => removeInjury(a.id, inj.id)} className="p-0.5 hover:bg-red-100 rounded flex-shrink-0"><X className="w-2.5 h-2.5 text-red-400" /></button>
                            </div>
                          ))}
                          {a.notes && a.isPublic && (
                            <div className="flex items-start gap-1.5 p-1.5 bg-blue-50 border border-blue-100 rounded text-[11px] text-blue-700">
                              <MessageSquare className="w-3 h-3 mt-0.5 flex-shrink-0 text-blue-400" />
                              <span className="flex-1">{a.notes}</span>
                            </div>
                          )}
                          {a.notes && !a.isPublic && (
                            <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-50 border border-slate-200 rounded text-[10px] text-slate-400 italic">
                              <Lock className="w-2.5 h-2.5 flex-shrink-0" />Private note
                            </div>
                          )}
                          <div className="flex gap-1 flex-wrap">
                            <button onClick={() => openAddInjury(a.id)}
                              className="flex items-center gap-1 px-2 h-6 bg-red-50 text-red-600 border border-red-100 rounded text-[10px] font-medium hover:bg-red-100 transition-colors">
                              <Plus className="w-2.5 h-2.5" />Injury
                            </button>
                            <button onClick={() => openNoteModal(a)}
                              className={`flex items-center gap-1 px-2 h-6 rounded text-[10px] font-medium transition-colors border ${a.notes ? 'bg-blue-50 text-blue-600 border-blue-100 hover:bg-blue-100' : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'}`}>
                              <MessageSquare className="w-2.5 h-2.5" />
                              {a.notes ? (a.isPublic ? 'Edit Note' : 'Edit Private Note') : 'Add Note'}
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="fixed bottom-0 left-0 md:left-52 right-0 bg-white border-t border-slate-200 p-4">
        <div className="max-w-md md:max-w-lg mx-auto flex gap-2">
          <button onClick={handleSave} disabled={saving}
            className="flex-1 h-10 bg-amber-600 text-white rounded-lg text-[13px] font-medium hover:bg-amber-700 transition-colors disabled:opacity-50">
            {saving ? 'Saving…' : 'Save End of Day Report'}
          </button>
          <button onClick={onBack} className="h-10 px-5 bg-slate-100 text-slate-600 rounded-lg text-[13px] hover:bg-slate-200 transition-colors">Cancel</button>
        </div>
      </div>

      {/* Note modal */}
      {showNoteModal && activeAthleteId && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-30">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <h3 className="text-[14px] font-semibold text-slate-900">{eodAthletes.find(a => a.id === activeAthleteId)?.name} — Note</h3>
              <button onClick={() => setShowNoteModal(false)} className="p-1 hover:bg-slate-100 rounded"><X className="w-4 h-4 text-slate-500" /></button>
            </div>
            <div className="p-4 space-y-3">
              <textarea value={tempNote} onChange={e => setTempNote(e.target.value)} placeholder="Add a note…"
                className="w-full px-3 py-2 text-[13px] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none" rows={4} />
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={tempIsPublic} onChange={e => setTempIsPublic(e.target.checked)} className="w-3.5 h-3.5 accent-blue-600" />
                <span className="text-[12px] text-slate-600">Public note</span>
              </label>
            </div>
            <div className="flex gap-2 px-4 pb-4">
              <button onClick={saveNote} className="flex-1 h-9 bg-slate-900 text-white rounded-lg text-[13px] font-medium hover:bg-slate-700">Save</button>
              <button onClick={() => setShowNoteModal(false)} className="flex-1 h-9 bg-slate-100 text-slate-700 rounded-lg text-[13px] hover:bg-slate-200">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Injury modal */}
      {showInjuryModal && activeAthleteId && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-30">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <h3 className="text-[14px] font-semibold text-slate-900">{eodAthletes.find(a => a.id === activeAthleteId)?.name} — {editingInjuryId ? 'Edit Injury' : 'Add Injury'}</h3>
              <button onClick={() => setShowInjuryModal(false)} className="p-1 hover:bg-slate-100 rounded"><X className="w-4 h-4 text-slate-500" /></button>
            </div>
            <div className="p-4 space-y-3">
              <div><label className="block text-[11px] text-slate-500 mb-1">Body Part</label>
                <select value={injuryData.bodyPart} onChange={e => setInjuryData({...injuryData, bodyPart: e.target.value})} className="w-full px-3 py-2 text-sm border rounded-lg">
                  {BODY_PARTS.map(bp => <option key={bp}>{bp}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div><label className="block text-[11px] text-slate-500 mb-1">Event</label>
                  <select value={injuryData.event} onChange={e => setInjuryData({...injuryData, event: e.target.value})} className="w-full px-2 py-2 text-sm border rounded-lg">
                    <option>Training</option><option>Match</option><option>Other</option>
                  </select>
                </div>
                <div><label className="block text-[11px] text-slate-500 mb-1">Surface</label>
                  <select value={injuryData.surface} onChange={e => setInjuryData({...injuryData, surface: e.target.value})} className="w-full px-2 py-2 text-sm border rounded-lg">
                    <option value="4G">4G</option><option>Grass</option><option>Other</option>
                  </select>
                </div>
                <div><label className="block text-[11px] text-slate-500 mb-1">Contact</label>
                  <select value={injuryData.contact} onChange={e => setInjuryData({...injuryData, contact: e.target.value})} className="w-full px-2 py-2 text-sm border rounded-lg">
                    <option>Contact</option><option>Non-Contact</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="block text-[11px] text-slate-500 mb-1">Start Date</label>
                  <input type="date" value={injuryData.startDate} onChange={e => setInjuryData({...injuryData, startDate: e.target.value})} className="w-full px-3 py-2 text-sm border rounded-lg" />
                </div>
                <div><label className="block text-[11px] text-slate-500 mb-1">Est. Return</label>
                  <input type="date" value={injuryData.returnDate} onChange={e => setInjuryData({...injuryData, returnDate: e.target.value})} className="w-full px-3 py-2 text-sm border rounded-lg" />
                </div>
              </div>
              {injuryData.startDate && injuryData.returnDate && (() => {
                const days = Math.round((new Date(injuryData.returnDate).getTime() - new Date(injuryData.startDate).getTime()) / 86400000);
                return days >= 0 ? <div className="px-3 py-2 bg-blue-50 border border-blue-100 rounded text-[11px] text-blue-700 font-medium">⏱ Time Loss: {days} day{days !== 1 ? 's' : ''}</div> : null;
              })()}
              <div><label className="block text-[11px] text-slate-500 mb-1">Notes</label>
                <textarea value={injuryData.notes} onChange={e => setInjuryData({...injuryData, notes: e.target.value})} className="w-full px-3 py-2 text-sm border rounded-lg" rows={2} />
              </div>
            </div>
            <div className="flex gap-2 px-4 pb-4">
              <button onClick={saveInjury} className="flex-1 h-9 bg-slate-800 text-white rounded-lg text-[13px] font-medium hover:bg-slate-700">{editingInjuryId ? 'Update' : 'Add'}</button>
              <button onClick={() => setShowInjuryModal(false)} className="flex-1 h-9 bg-slate-100 text-slate-700 rounded-lg text-[13px] hover:bg-slate-200">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const AvailabilityPage = ({ athletes, setAthletes, navigateTo, setSelectedAthleteId, selectedDate, setSelectedDate, availabilityRecords, teamStructure, onSave, onSaveEOD, saving, fetchAllData }: any) => {
  const typedAthletes: Athlete[] = athletes;
  const typedTeamStructure: TeamPosition[] = teamStructure;
  const [searchTerm, setSearchTerm] = useState('');
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [selectedAthlete, setSelectedAthlete] = useState<Athlete | null>(null);
  const [tempNotes, setTempNotes] = useState('');
  const [tempIsPublic, setTempIsPublic] = useState(false);
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);
  const [showEOD, setShowEOD] = useState(false);
  const [savedEodData, setSavedEodData] = useState<any[] | null>(null);
  const [eodLoading, setEodLoading] = useState(false);

  // When the selected date changes, load availability_records for that date
  // and overlay them onto the athlete list. This surfaces EOD-written records
  // for future dates (e.g. tomorrow after yesterday's EOD report was saved).
  const todayStr = new Date().toISOString().split('T')[0];
  const [dateRecordsMap, setDateRecordsMap] = useState<Record<string, { status: string; note: string }>>({});

  useEffect(() => {
    if (selectedDate === todayStr) {
      // Today's data is already baked into the athletes state by fetchAllData
      setDateRecordsMap({});
      return;
    }
    let cancelled = false;

    const loadRecordsForDate = async (targetDate: string) => {
      // 1. Try the exact date first
      const { data: exact } = await supabase
        .from('availability_records')
        .select('athlete_id, status, note')
        .eq('date', targetDate);
      if (!cancelled && exact && exact.length > 0) {
        const map: Record<string, { status: string; note: string }> = {};
        exact.forEach((r: any) => { map[r.athlete_id] = { status: r.status, note: r.note }; });
        setDateRecordsMap(map);
        return;
      }

      // 2. No records for that date — find the most recent EOD report before targetDate.
      // EOD reports are stored in eod_reports, sorted descending, take the latest before targetDate.
      const { data: recentEod } = await supabase
        .from('eod_reports')
        .select('athlete_id, status, note')
        .lt('date', targetDate)
        .order('date', { ascending: false })
        .limit(athletes.length || 50);

      if (!cancelled) {
        if (recentEod && recentEod.length > 0) {
          // Use the most recent EOD date's records (all rows from the latest date batch)
          const map: Record<string, { status: string; note: string }> = {};
          // Group by athlete_id, only keep the first (most recent date) entry per athlete
          recentEod.forEach((r: any) => {
            if (!map[r.athlete_id]) map[r.athlete_id] = { status: r.status, note: r.note };
          });
          setDateRecordsMap(map);
        } else {
          // No EOD reports at all — clear overlay, show base athlete data
          setDateRecordsMap({});
        }
      }
    };

    loadRecordsForDate(selectedDate);
    return () => { cancelled = true; };
  }, [selectedDate]);

  // Athletes displayed on screen — overlaid with date-specific records when viewing another day
  const displayAthletes: Athlete[] = useMemo(() =>
    typedAthletes.map(a => {
      const rec = dateRecordsMap[a.id];
      if (!rec) return a;
      return { ...a, status: rec.status, notes: rec.note };
    }),
    [typedAthletes, dateRecordsMap]
  );

  const handleSave = async () => {
    await onSave(selectedDate, displayAthletes);
    setShowSaveSuccess(true);
    setTimeout(() => setShowSaveSuccess(false), 2000);
  };

  const getSurnameAv = (n: string) => { const p = n.trim().split(' '); return p.length > 1 ? p[p.length - 1].toLowerCase() : n.toLowerCase(); };
  const filteredAthletes = displayAthletes.filter(a => a.name.toLowerCase().includes(searchTerm.toLowerCase())).sort((a, b) => getSurnameAv(a.name).localeCompare(getSurnameAv(b.name)));

  if (showEOD) {
    return (
      <EndOfDayReport
        athletes={displayAthletes}
        setAthletes={setAthletes}
        teamStructure={typedTeamStructure}
        date={selectedDate}
        onSaveEOD={onSaveEOD}
        onBack={() => setShowEOD(false)}
        saving={saving}
        savedEodData={savedEodData}
      />
    );
  }

  return (
    <div className="max-w-md md:max-w-3xl mx-auto p-4 md:p-6">
      {/* Toolbar — matches Home page structure */}
      <div className="bg-white rounded-lg border border-slate-200 mb-4 overflow-hidden">
        <div className="flex gap-2 p-2.5">
          <div className="flex-1 relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 w-3.5 h-3.5" />
            <input type="text" placeholder="Search athletes…" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 h-8 text-[13px] border border-slate-200 rounded bg-slate-50 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
          <button onClick={async () => { const { data, error } = await supabase.from('athletes').insert({ name: 'New Athlete', status: 'Available', notes: '', is_public: false, avatar: 'NA', photo_url: '' }).select().single(); if (!error && data) { await fetchAllData(); setSelectedAthleteId(data.id); navigateTo('athlete-profile'); } }}
            className="h-8 px-3 bg-slate-900 text-white rounded text-[12px] font-medium flex items-center gap-1.5 hover:bg-slate-700 transition-colors">
            <Plus className="w-3.5 h-3.5" />Add
          </button>
        </div>
        <div className="flex gap-2 px-2.5 pb-2.5">
          <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
            className="flex-1 h-8 px-3 text-[13px] border border-slate-200 rounded bg-slate-50 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500" />
          <button onClick={async () => {
              setEodLoading(true);
              try {
                const { data } = await supabase.from('eod_reports').select('*').eq('date', selectedDate);
                setSavedEodData(data && data.length > 0 ? data : null);
              } catch { setSavedEodData(null); }
              setEodLoading(false);
              setShowEOD(true);
            }}
            disabled={eodLoading}
            className="h-8 px-3 bg-white border border-amber-300 text-amber-700 rounded text-[12px] font-medium flex items-center gap-1.5 hover:bg-amber-50 transition-colors whitespace-nowrap disabled:opacity-60">
            {eodLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            End of Day
          </button>
        </div>
      </div>

      {showSaveSuccess && <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-4 py-2 rounded-lg shadow-lg z-50 text-[13px] font-medium">✓ Saved</div>}

      <div className="pb-24">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {filteredAthletes.map(athlete => (
            <div key={athlete.id} className="bg-white rounded-lg border border-slate-200 p-3.5">
              {/* Header row */}
              <div className="flex items-center gap-3">
                <div className="cursor-pointer flex-shrink-0" onClick={() => { setSelectedAthleteId(athlete.id); navigateTo('athlete-profile'); }}>
                  {athlete.photo
                    ? <img src={athlete.photo} alt="" className="w-8 h-8 rounded-md object-cover" />
                    : <div className="w-8 h-8 bg-slate-100 rounded-md flex items-center justify-center text-[10px] font-semibold text-slate-500">{athlete.avatar}</div>}
                </div>
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => { setSelectedAthleteId(athlete.id); navigateTo('athlete-profile'); }}>
                  <h3 className="text-[13px] font-medium text-slate-900 truncate leading-none">{athlete.name}</h3>
                  <p className="text-[11px] text-slate-400 mt-1 truncate">{getPositionDisplay(athlete.positionNumbers, typedTeamStructure)}</p>
                </div>
                <StatusSelect value={athlete.status} onChange={async val => {
                    if (selectedDate === todayStr) {
                      // Today: update athletes state and DB directly
                      setAthletes(typedAthletes.map(a => a.id === athlete.id ? { ...a, status: val } : a));
                      await supabase.from('athletes').update({ status: val }).eq('id', athlete.id);
                    } else {
                      // Another date: update the overlay map only (save writes availability_records)
                      setDateRecordsMap(prev => ({
                        ...prev,
                        [athlete.id]: { status: val, note: prev[athlete.id]?.note ?? athlete.notes ?? '' }
                      }));
                    }
                  }} />
              </div>
              {/* Group tag — matches Home page */}
              {getPositionGroup(athlete.positionNumbers, typedTeamStructure) && (
                <div className="mt-2">
                  <span className="text-[10px] font-medium text-slate-400 bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5">{getPositionGroup(athlete.positionNumbers, typedTeamStructure)}</span>
                </div>
              )}
              <InjuryDisplay athlete={athlete} />
              {/* Note — inline if present, subtle add button if not */}
              {athlete.notes ? (
                <button onClick={() => { setSelectedAthlete(athlete); setTempNotes(athlete.notes); setTempIsPublic(athlete.isPublic); setShowNotesModal(true); }}
                  className="mt-2 w-full text-left p-2 bg-blue-50 border border-blue-100 rounded flex items-start gap-1.5 hover:bg-blue-100 transition-colors">
                  <MessageSquare className="w-3 h-3 mt-0.5 flex-shrink-0 text-blue-400" />
                  <span className="text-[11px] text-blue-700 leading-snug">{athlete.notes}</span>
                </button>
              ) : (
                <button onClick={() => { setSelectedAthlete(athlete); setTempNotes(''); setTempIsPublic(false); setShowNotesModal(true); }}
                  className="mt-2 flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 transition-colors">
                  <MessageSquare className="w-3 h-3" />Add note
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Bottom bar */}
      <div className="fixed bottom-0 left-0 md:left-52 right-0 bg-white border-t border-slate-200 p-4">
        <div className="max-w-md md:max-w-lg mx-auto">
          <button onClick={handleSave} className="w-full h-10 bg-slate-900 text-white rounded-lg text-[13px] font-semibold hover:bg-slate-700 transition-colors">Save</button>
        </div>
      </div>

      {/* Notes modal */}
      {showNotesModal && selectedAthlete && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-30">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <h3 className="text-[14px] font-semibold text-slate-900">{selectedAthlete.name}</h3>
              <button onClick={() => setShowNotesModal(false)} className="p-1 hover:bg-slate-100 rounded"><X className="w-4 h-4 text-slate-500" /></button>
            </div>
            <div className="p-4 space-y-3">
              <textarea value={tempNotes} onChange={e => setTempNotes(e.target.value)} placeholder="Add a note…"
                className="w-full px-3 py-2 text-[13px] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none text-slate-900" rows={4} />
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={tempIsPublic} onChange={e => setTempIsPublic(e.target.checked)} className="w-3.5 h-3.5 accent-blue-600" />
                <span className="text-[12px] text-slate-600">Public note</span>
              </label>
            </div>
            <div className="flex gap-2 px-4 pb-4">
              <button onClick={() => { setAthletes(typedAthletes.map(a => a.id === selectedAthlete.id ? { ...a, notes: tempNotes, isPublic: tempIsPublic } : a)); setShowNotesModal(false); }}
                className="flex-1 h-9 bg-slate-900 text-white rounded-lg text-[13px] font-medium hover:bg-slate-700 transition-colors">Save</button>
              <button onClick={() => setShowNotesModal(false)}
                className="flex-1 h-9 bg-slate-100 text-slate-700 rounded-lg text-[13px] hover:bg-slate-200 transition-colors">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const SessionPlanPage = ({ drills, setDrills, weekDrills, setWeekDrills, navigateTo, athletes, drillTypes, teamStructure, defaultTeam, onSaveDefaultTeam, selectedDate, onDateChange, onSaveSessionPlan, saving, getWeekDates }: any) => {
  const typedAthletes: Athlete[] = athletes;
  const typedDrillTypes: DrillType[] = drillTypes;
  const typedTeamStructure: TeamPosition[] = teamStructure;

  const [expandedDrill, setExpandedDrill] = useState<string | null>(null);
  const [editingTeam, setEditingTeam] = useState<Drill | null>(null);
  const [editingDefaultTeam, setEditingDefaultTeam] = useState(false);
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);
  const [savingDay, setSavingDay] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [editingDrillId, setEditingDrillId] = useState<string | null>(null);
  const [editDrillData, setEditDrillData] = useState<any>({});
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [tempDefaultTeam, setTempDefaultTeam] = useState(defaultTeam);

  // Week state
  const today = new Date().toISOString().split('T')[0];
  const weekDates = useMemo(() => getWeekDates(selectedDate), [selectedDate]);
  const [activeDay, setActiveDay] = useState(selectedDate);

  // Sync activeDay when week changes
  useEffect(() => {
    if (!weekDates.includes(activeDay)) setActiveDay(weekDates[0]);
  }, [weekDates.join(',')]);

  // Per-day drills from weekDrills map — fall back to empty array
  const dayDrills: Drill[] = weekDrills[activeDay] || [];
  const setDayDrills = (newDrills: Drill[]) => {
    setWeekDrills((prev: any) => ({ ...prev, [activeDay]: newDrills }));
  };

  const getPositionsForDrill = (drill: Drill) => typedDrillTypes.find(dt => dt.name === drill.type)?.positions || typedTeamStructure.map(p => p.number);

  const handleSaveDay = async () => {
    setSavingDay(activeDay);
    try {
      await onSaveSessionPlan(activeDay, dayDrills);
      setShowSaveSuccess(true);
      setTimeout(() => setShowSaveSuccess(false), 2000);
    } finally {
      setSavingDay(null);
    }
  };

  const handleSaveDefaultTeam = async () => {
    await onSaveDefaultTeam(tempDefaultTeam);
    setEditingDefaultTeam(false);
  };

  const totalMinutes = (dlist: Drill[]) => dlist.filter(d => !d.isBreak).reduce((s, d) => s + (d.duration || 0), 0);
  const fmtTime = (mins: number) => mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60 > 0 ? (mins % 60) + 'm' : ''}`.trim() : `${mins}m`;

  const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const fmtDayNum = (d: string) => new Date(d + 'T00:00:00').getDate();
  const fmtWC = (d: string) => {
    const mon = new Date(d + 'T00:00:00');
    return 'w/c ' + mon.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  };

  if (showSummary) {
    return <SessionPlayerSummary dayDrills={dayDrills} athletes={typedAthletes} onClose={() => setShowSummary(false)} />;
  }

  if (editingDefaultTeam) {
    return <TeamSelectionModal athletes={typedAthletes} team1={tempDefaultTeam.team1} setTeam1={(t: any) => setTempDefaultTeam((prev: any) => ({...prev, team1: t}))} team2={tempDefaultTeam.team2} setTeam2={(t: any) => setTempDefaultTeam((prev: any) => ({...prev, team2: t}))} subs1={tempDefaultTeam.subs1} setSubs1={(t: any) => setTempDefaultTeam((prev: any) => ({...prev, subs1: t}))} subs2={tempDefaultTeam.subs2} setSubs2={(t: any) => setTempDefaultTeam((prev: any) => ({...prev, subs2: t}))} onClearAll={() => setTempDefaultTeam({ team1: {}, team2: {}, subs1: {}, subs2: {} })} onBack={handleSaveDefaultTeam} positions={typedTeamStructure.map(p => p.number)} teamStructure={typedTeamStructure} title="Edit Default Team" />;
  }

  if (editingTeam) {
    const drillPositions = getPositionsForDrill(editingTeam);
    const stripToPos = (obj: any): Record<number, string> => Object.fromEntries(Object.entries(obj || {}).filter(([pos]) => drillPositions.includes(Number(pos)))) as Record<number, string>;
    return <TeamSelectionModal athletes={typedAthletes}
      team1={editingTeam.team1 || {}} setTeam1={(t: any) => { setDayDrills(dayDrills.map(d => d.id === editingTeam.id ? {...d, team1: t} : d)); setEditingTeam((prev: any) => ({...prev, team1: t})); }}
      team2={editingTeam.team2 || {}} setTeam2={(t: any) => { setDayDrills(dayDrills.map(d => d.id === editingTeam.id ? {...d, team2: t} : d)); setEditingTeam((prev: any) => ({...prev, team2: t})); }}
      subs1={editingTeam.subs1 || {}} setSubs1={(t: any) => { setDayDrills(dayDrills.map(d => d.id === editingTeam.id ? {...d, subs1: t} : d)); setEditingTeam((prev: any) => ({...prev, subs1: t})); }}
      subs2={editingTeam.subs2 || {}} setSubs2={(t: any) => { setDayDrills(dayDrills.map(d => d.id === editingTeam.id ? {...d, subs2: t} : d)); setEditingTeam((prev: any) => ({...prev, subs2: t})); }}
      onClearAll={() => { const empty = {team1:{},team2:{},subs1:{},subs2:{}}; setDayDrills(dayDrills.map(d => d.id === editingTeam.id ? {...d, ...empty} : d)); setEditingTeam((prev: any) => ({...prev, ...empty})); }}
      onBack={() => { setDayDrills(dayDrills.map(d => d.id === editingTeam.id ? {...d, team1: stripToPos(d.team1), team2: stripToPos(d.team2), subs1: stripToPos(d.subs1), subs2: stripToPos(d.subs2)} : d)); setEditingTeam(null); }}
      positions={drillPositions} teamStructure={typedTeamStructure} title="Edit Team" />;
  }

  const totMins = totalMinutes(dayDrills);

  // Drag handlers
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  };
  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  };
  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === dropIndex) { setDragIndex(null); setDragOverIndex(null); return; }
    const next = [...dayDrills];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(dropIndex, 0, moved);
    setDayDrills(next);
    setDragIndex(null);
    setDragOverIndex(null);
  };
  const handleDragEnd = () => { setDragIndex(null); setDragOverIndex(null); };

  return (
    <div className="max-w-md md:max-w-3xl mx-auto p-4 md:p-6">
      {showSaveSuccess && <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-4 py-2 rounded-lg shadow-lg z-50 text-[13px] font-medium">✓ Session plan saved</div>}

      {/* Week selector */}
      <div className="bg-white rounded-lg border border-slate-200 p-3 mb-3 flex items-center gap-3">
        <input type="date" value={activeDay}
          onChange={e => {
            const picked = e.target.value;
            onDateChange(picked);
            setActiveDay(picked);
          }}
          className="flex-1 h-8 px-3 text-[13px] border border-slate-200 rounded bg-slate-50 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        <span className="text-[12px] text-slate-400 whitespace-nowrap">{fmtWC(weekDates[0])}</span>
      </div>

      {/* Day tabs */}
      <div className="bg-white rounded-lg border border-slate-200 mb-3 overflow-hidden">
        <div className="grid grid-cols-7 divide-x divide-slate-100">
          {weekDates.map((date, i) => {
            const dayTotal = totalMinutes(weekDrills[date] || []);
            const isActive = date === activeDay;
            const isToday = date === today;
            return (
              <button key={date} onClick={() => setActiveDay(date)}
                className={`flex flex-col items-center py-2.5 px-1 transition-colors ${isActive ? 'bg-slate-900 text-white' : 'hover:bg-slate-50 text-slate-600'}`}>
                <span className={`text-[10px] font-semibold ${isActive ? 'text-white/60' : 'text-slate-400'}`}>{DAY_LABELS[i]}</span>
                <span className={`text-[15px] font-bold leading-tight ${isToday && !isActive ? 'text-blue-600' : ''}`}>{fmtDayNum(date)}</span>
                {dayTotal > 0 && (
                  <span className={`text-[9px] mt-0.5 font-medium ${isActive ? 'text-white/70' : 'text-slate-400'}`}>{fmtTime(dayTotal)}</span>
                )}
                {(weekDrills[date] || []).length > 0 && dayTotal === 0 && (
                  <span className={`w-1 h-1 rounded-full mt-1 ${isActive ? 'bg-white/60' : 'bg-slate-300'}`} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Toolbar: action buttons inline above drill list */}
      <div className="flex gap-2 mb-3">
        <button onClick={() => navigateTo('add-drill')}
          className="flex-1 h-9 bg-white border border-slate-200 text-slate-700 rounded-lg text-[12px] font-medium flex items-center justify-center gap-1.5 hover:bg-slate-50 hover:border-slate-300 transition-colors">
          <Plus className="w-3.5 h-3.5" />Add Drill
        </button>
        <button onClick={() => {
            const breakDrill: Drill = { id: String(Date.now()), name: 'Break', type: 'Break', intensity: '', notes: '', duration: 0, isBreak: true, team1: {}, team2: {}, subs1: {}, subs2: {} };
            setDayDrills([...dayDrills, breakDrill]);
          }}
          className="h-9 px-3 bg-white border border-slate-200 text-slate-600 rounded-lg text-[12px] font-medium flex items-center gap-1.5 hover:bg-slate-50 hover:border-slate-300 transition-colors">
          <Plus className="w-3.5 h-3.5" />Break
        </button>
        <button onClick={() => setShowSummary(true)}
          className="h-9 px-3 bg-white border border-slate-200 text-slate-600 rounded-lg text-[12px] font-medium flex items-center gap-1.5 hover:bg-slate-50 hover:border-slate-300 transition-colors whitespace-nowrap">
          <Users className="w-3.5 h-3.5" />Summary
        </button>
        <button onClick={() => { setTempDefaultTeam(defaultTeam); setEditingDefaultTeam(true); }}
          className="h-9 px-3 bg-white border border-dashed border-slate-300 text-slate-500 rounded-lg text-[12px] font-medium flex items-center gap-1.5 hover:border-slate-400 hover:text-slate-700 transition-colors whitespace-nowrap">
          <Users className="w-3.5 h-3.5" />Default Team
        </button>
      </div>

      {/* Drill list */}
      <div className="space-y-1.5 mb-24">
        {dayDrills.length === 0 ? (
          <div className="bg-white rounded-lg border border-slate-200 p-10 text-center">
            <p className="text-slate-400 text-[13px]">No drills for this day</p>
            <p className="text-slate-300 text-[11px] mt-1">Add a drill or break to get started</p>
          </div>
        ) : (
          dayDrills.map((drill, index) => (
            <div key={drill.id}
              draggable
              onDragStart={e => handleDragStart(e, index)}
              onDragOver={e => handleDragOver(e, index)}
              onDrop={e => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
              className={`bg-white rounded-lg border overflow-hidden transition-all ${
                dragOverIndex === index && dragIndex !== index
                  ? 'border-blue-400 shadow-md scale-[1.01]'
                  : dragIndex === index
                  ? 'border-slate-300 opacity-50'
                  : 'border-slate-200'
              }`}>
              {/* Unified row: [drag handle] [label] | [dur input] [min] [chevron] [trash] */}
              <div className="h-12 flex items-center gap-2 pr-3">
                {/* Drag handle */}
                <div className="w-7 h-full flex items-center justify-center cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 transition-colors shrink-0 border-r border-slate-100">
                  <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
                    <circle cx="2" cy="3" r="1.5"/><circle cx="8" cy="3" r="1.5"/>
                    <circle cx="2" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/>
                    <circle cx="2" cy="13" r="1.5"/><circle cx="8" cy="13" r="1.5"/>
                  </svg>
                </div>
                {/* Left: label */}
                {drill.isBreak ? (
                  <div className="flex items-center gap-2 flex-1 min-w-0 pl-1">
                    <span className="text-[9px] font-bold text-slate-400 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5 uppercase tracking-widest shrink-0">Break</span>
                    <span className="text-[13px] font-medium text-slate-500 truncate">{drill.name}</span>
                  </div>
                ) : (
                  <button onClick={() => setExpandedDrill(expandedDrill === drill.id ? null : drill.id)}
                    className="flex-1 text-left min-w-0 py-1 pl-1">
                    <p className="text-[13px] font-medium text-slate-900 truncate leading-none">{drill.name}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5 truncate">{drill.type}{drill.intensity ? ` · ${drill.intensity}` : ''}</p>
                  </button>
                )}
                {/* Right: fixed-width columns */}
                {!drill.isBreak && <>
                  <input type="number" min="0" max="300" step="5"
                    value={drill.duration || ''}
                    onChange={e => setDayDrills(dayDrills.map(d => d.id === drill.id ? {...d, duration: Math.max(0, parseInt(e.target.value) || 0)} : d))}
                    placeholder="0"
                    className="w-14 h-8 px-0 text-[13px] text-center border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 shrink-0" />
                  <span className="text-[11px] text-slate-400 w-5 shrink-0">min</span>
                  <button onClick={() => setExpandedDrill(expandedDrill === drill.id ? null : drill.id)}
                    className="w-6 flex items-center justify-center text-slate-300 hover:text-slate-600 transition-colors shrink-0">
                    {expandedDrill === drill.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </>}
                <button onClick={() => setDayDrills(dayDrills.filter(d => d.id !== drill.id))}
                  className="w-6 flex items-center justify-center text-slate-300 hover:text-red-400 transition-colors shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              {!drill.isBreak && expandedDrill === drill.id && (
                <div className="border-t border-slate-100 bg-slate-50">
                  {editingDrillId === drill.id ? (
                    /* ── Inline edit form ── */
                    <div className="px-4 pt-3 pb-4 space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="col-span-2">
                          <label className="block text-[10px] font-medium text-slate-500 mb-1">Name</label>
                          <input type="text" value={editDrillData.name ?? drill.name}
                            onChange={e => setEditDrillData({...editDrillData, name: e.target.value})}
                            className="w-full h-8 px-3 text-[13px] border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-500" />
                        </div>
                        <div>
                          <label className="block text-[10px] font-medium text-slate-500 mb-1">Type</label>
                          <select value={editDrillData.type ?? drill.type}
                            onChange={e => setEditDrillData({...editDrillData, type: e.target.value})}
                            className="w-full h-8 px-2 text-[12px] border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-500">
                            {typedDrillTypes.map(dt => <option key={dt.id}>{dt.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-medium text-slate-500 mb-1">Intensity</label>
                          <select value={editDrillData.intensity ?? drill.intensity}
                            onChange={e => setEditDrillData({...editDrillData, intensity: e.target.value})}
                            className="w-full h-8 px-2 text-[12px] border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-500">
                            <option>Low</option><option>Medium</option><option>High</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-slate-500 mb-1">Notes</label>
                        <textarea value={editDrillData.notes ?? drill.notes}
                          onChange={e => setEditDrillData({...editDrillData, notes: e.target.value})}
                          rows={2}
                          className="w-full px-3 py-1.5 text-[12px] border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none" />
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => {
                            setDayDrills(dayDrills.map(d => d.id === drill.id ? {
                              ...d,
                              name: editDrillData.name ?? d.name,
                              type: editDrillData.type ?? d.type,
                              intensity: editDrillData.intensity ?? d.intensity,
                              notes: editDrillData.notes ?? d.notes,
                            } : d));
                            setEditingDrillId(null);
                            setEditDrillData({});
                          }}
                          className="flex-1 h-8 bg-slate-900 text-white rounded-lg text-[12px] font-semibold hover:bg-slate-700 transition-colors">
                          Save
                        </button>
                        <button onClick={() => { setEditingDrillId(null); setEditDrillData({}); }}
                          className="h-8 px-4 bg-white border border-slate-200 text-slate-600 rounded-lg text-[12px] hover:bg-slate-50 transition-colors">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* ── Read-only detail view ── */
                    <div className="px-4 pt-3 pb-4 space-y-2 text-[13px]">
                      <p><span className="text-slate-400 text-[11px]">Intensity</span> <span className="text-slate-700 ml-1">{drill.intensity}</span></p>
                      {drill.notes && <p><span className="text-slate-400 text-[11px]">Notes</span> <span className="text-slate-700 ml-1">{drill.notes}</span></p>}
                      {/* Read-only team grid */}
                      {(() => {
                        const getName = (id: any) => typedAthletes.find(a => a.id === id)?.name || '';
                        const assignedPositions = typedTeamStructure.map(p => p.number).filter(pos => drill.team1?.[pos] || drill.team2?.[pos] || drill.subs1?.[pos] || drill.subs2?.[pos]).sort((a, b) => a - b);
                        if (assignedPositions.length === 0) return null;
                        return (
                          <div className="mt-2 overflow-x-auto">
                            <div className="grid grid-cols-5 gap-1 min-w-[340px] text-[10px]">
                              <div className="text-center text-slate-400 pb-1">Team 1</div>
                              <div className="text-center text-slate-400 pb-1">Sub</div>
                              <div className="text-center text-slate-400 pb-1"></div>
                              <div className="text-center text-slate-400 pb-1">Sub</div>
                              <div className="text-center text-slate-400 pb-1">Team 2</div>
                              {assignedPositions.map(pos => {
                                const t1 = getName(drill.team1?.[pos]); const t2 = getName(drill.team2?.[pos]);
                                const s1 = getName(drill.subs1?.[pos]); const s2 = getName(drill.subs2?.[pos]);
                                return (
                                  <React.Fragment key={pos}>
                                    <div className={`p-1 rounded truncate ${t1 ? 'bg-slate-100 text-slate-700' : 'bg-transparent text-slate-300'}`}>{t1 || '–'}</div>
                                    <div className={`p-1 rounded truncate ${s1 ? 'bg-slate-100 text-slate-500' : 'text-slate-200'}`}>{s1 || '–'}</div>
                                    <div className="flex items-center justify-center text-slate-300">{pos}</div>
                                    <div className={`p-1 rounded truncate ${s2 ? 'bg-slate-100 text-slate-500' : 'text-slate-200'}`}>{s2 || '–'}</div>
                                    <div className={`p-1 rounded truncate ${t2 ? 'bg-slate-100 text-slate-700' : 'bg-transparent text-slate-300'}`}>{t2 || '–'}</div>
                                  </React.Fragment>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}
                      <div className="flex gap-2 pt-1">
                        <button onClick={() => { setEditingDrillId(drill.id); setEditDrillData({ name: drill.name, type: drill.type, intensity: drill.intensity, notes: drill.notes }); }}
                          className="flex-1 h-8 bg-white border border-slate-200 text-slate-700 rounded-lg text-[12px] font-medium flex items-center justify-center gap-1.5 hover:bg-slate-50 transition-colors">
                          <Edit2 className="w-3.5 h-3.5" />Edit Drill
                        </button>
                        <button onClick={() => setEditingTeam(drill)}
                          className="flex-1 h-8 bg-slate-900 text-white rounded-lg text-[12px] font-medium flex items-center justify-center gap-1.5 hover:bg-slate-700 transition-colors">
                          <Users className="w-3.5 h-3.5" />Edit Team
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
        {/* Total session time */}
        {totMins > 0 && (
          <div className="flex items-center justify-between px-4 py-2 bg-slate-50 rounded-lg border border-slate-200">
            <span className="text-[12px] text-slate-500 font-medium">Total session time</span>
            <span className="text-[14px] font-bold text-slate-800">{fmtTime(totMins)}</span>
          </div>
        )}
      </div>

      {/* Bottom bar — Save only */}
      <div className="fixed bottom-0 left-0 md:left-52 right-0 bg-white border-t border-slate-200 p-3">
        <div className="max-w-md md:max-w-lg mx-auto">
          <button onClick={handleSaveDay} disabled={savingDay === activeDay}
            className={`w-full h-10 rounded-lg text-[13px] font-semibold transition-colors ${savingDay === activeDay ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-slate-900 text-white hover:bg-slate-700'}`}>
            {savingDay === activeDay ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};


// ── Session Player Summary grid ─────────────────────────────────────────────
const SessionPlayerSummary = ({ dayDrills, athletes, onClose }: any) => {
  const [sortKey, setSortKey] = useState<string | null>(null); // null = surname, drillId = drill sort

  // Only non-break drills
  const drills: Drill[] = dayDrills.filter((d: Drill) => !d.isBreak);

  // Collect all athlete IDs that appear in at least one drill
  const getAthleteIdsForDrill = (drill: Drill): Set<string> => {
    const ids = new Set<string>();
    [drill.team1, drill.team2, drill.subs1, drill.subs2].forEach(slot =>
      Object.values(slot || {}).forEach(id => { if (id) ids.add(id as string); })
    );
    return ids;
  };

  const allIds = useMemo(() => {
    const s = new Set<string>();
    drills.forEach(d => getAthleteIdsForDrill(d).forEach(id => s.add(id)));
    return s;
  }, [dayDrills]);

  const involvedAthletes = useMemo(() =>
    athletes.filter((a: any) => allIds.has(a.id)),
    [athletes, allIds]
  );

  const getSurname = (name: string) => {
    const parts = name.trim().split(' ');
    return parts.length > 1 ? parts[parts.length - 1] : name;
  };

  const sortedAthletes = useMemo(() => {
    const list = [...involvedAthletes];
    if (sortKey === null) {
      // Alphabetical by surname
      return list.sort((a: any, b: any) => getSurname(a.name).localeCompare(getSurname(b.name)));
    }
    // Sort by drill: in-drill first, then not
    const drill = drills.find(d => d.id === sortKey);
    if (!drill) return list;
    const inDrill = getAthleteIdsForDrill(drill);
    return list.sort((a: any, b: any) => {
      const aIn = inDrill.has(a.id) ? 0 : 1;
      const bIn = inDrill.has(b.id) ? 0 : 1;
      if (aIn !== bIn) return aIn - bIn;
      return getSurname(a.name).localeCompare(getSurname(b.name));
    });
  }, [involvedAthletes, sortKey, dayDrills]);

  if (drills.length === 0) {
    return (
      <div className="max-w-md md:max-w-5xl mx-auto p-4 md:p-6">
        <div className="bg-white rounded-lg border border-slate-200 p-8 text-center">
          <p className="text-slate-400 text-[13px]">No drills with players assigned for this day</p>
          <button onClick={onClose} className="mt-4 h-9 px-5 bg-slate-900 text-white rounded-lg text-[13px] font-medium hover:bg-slate-700 transition-colors">Back</button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md md:max-w-5xl mx-auto p-4 md:p-6 pb-24">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[15px] font-semibold text-slate-900">Session Player Summary</h2>
        <button onClick={onClose} className="h-8 px-4 bg-white border border-slate-200 text-slate-600 rounded-lg text-[12px] font-medium hover:bg-slate-50 transition-colors">← Back</button>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {/* Player column header */}
                <th className="sticky left-0 z-10 bg-slate-50 border-r border-slate-200 px-3 py-2.5 text-left min-w-[140px]">
                  <button
                    onClick={() => setSortKey(null)}
                    className={`flex items-center gap-1 font-semibold transition-colors ${sortKey === null ? 'text-blue-600' : 'text-slate-600 hover:text-slate-900'}`}>
                    Player
                    <span className="text-[10px] opacity-60">↕</span>
                  </button>
                </th>
                {/* Drill column headers */}
                {drills.map(drill => (
                  <th key={drill.id} className="px-2 py-2.5 text-center min-w-[90px] border-r border-slate-100 last:border-r-0">
                    <button
                      onClick={() => setSortKey(sortKey === drill.id ? null : drill.id)}
                      className={`w-full font-semibold leading-tight transition-colors ${sortKey === drill.id ? 'text-blue-600' : 'text-slate-600 hover:text-slate-900'}`}>
                      <span className="block truncate max-w-[80px] mx-auto" title={drill.name}>{drill.name}</span>
                      <span className={`text-[10px] font-normal opacity-60 ${sortKey === drill.id ? 'text-blue-500' : 'text-slate-400'}`}>{drill.type}</span>
                      {sortKey === drill.id && <span className="block text-[9px] text-blue-500 mt-0.5">sorted ↕</span>}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedAthletes.map((athlete: any, rowIdx: number) => (
                <tr key={athlete.id} className={rowIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                  {/* Player name */}
                  <td className="sticky left-0 z-10 bg-inherit border-r border-slate-200 px-3 py-2 font-medium text-slate-800 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      {athlete.photo
                        ? <img src={athlete.photo} alt="" className="w-5 h-5 rounded object-cover shrink-0" />
                        : <div className="w-5 h-5 bg-slate-200 rounded flex items-center justify-center text-[8px] font-bold text-slate-500 shrink-0">{athlete.avatar}</div>
                      }
                      {athlete.name}
                    </div>
                  </td>
                  {/* Drill cells */}
                  {drills.map(drill => {
                    const inDrill = getAthleteIdsForDrill(drill).has(athlete.id);
                    return (
                      <td key={drill.id} className="px-2 py-2 text-center border-r border-slate-100 last:border-r-0">
                        <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-[11px] font-semibold ${inDrill ? 'bg-green-100 text-green-700' : 'bg-red-50 text-red-400'}`}>
                          {inDrill ? '✓' : '✗'}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Legend */}
        <div className="flex items-center gap-4 px-4 py-2.5 border-t border-slate-100 bg-slate-50">
          <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <span className="w-4 h-4 rounded-full bg-green-100 flex items-center justify-center text-[9px] text-green-700 font-bold">✓</span>In drill
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <span className="w-4 h-4 rounded-full bg-red-50 flex items-center justify-center text-[9px] text-red-400 font-bold">✗</span>Not in drill
          </span>
          <span className="ml-auto text-[11px] text-slate-400">{sortedAthletes.length} players · {drills.length} drills</span>
        </div>
      </div>
    </div>
  );
};


const AddDrillPage = ({ drills, setDrills, weekDrills, setWeekDrills, selectedDate, navigateTo, drillTypes, defaultTeam, athletes, teamStructure }: any) => {
  const typedDrills: Drill[] = drills;
  const typedDrillTypes: DrillType[] = drillTypes;
  const typedAthletes: Athlete[] = athletes;
  const typedTeamStructure: TeamPosition[] = teamStructure;
  const [name, setName] = useState('');
  const [type, setType] = useState(typedDrillTypes[0]?.name || '');
  const [notes, setNotes] = useState('');
  const [intensity, setIntensity] = useState('Low');
  const [duration, setDuration] = useState<number>(() => {
    const dt = drillTypes.find((d: any) => d.name === (typedDrillTypes[0]?.name || ''));
    return dt?.defaultDuration || 0;
  });
  const [team1, setTeam1] = useState({...defaultTeam.team1});
  const [team2, setTeam2] = useState({...defaultTeam.team2});
  const [subs1, setSubs1] = useState({...defaultTeam.subs1});
  const [subs2, setSubs2] = useState({...defaultTeam.subs2});
  const [showTeamSelection, setShowTeamSelection] = useState(false);
  const [nameError, setNameError] = useState(false);

  // Sync whenever the saved default team changes (e.g. after Supabase load completes
  // or after the user saves a new default team in the same session)
  useEffect(() => {
    setTeam1({...defaultTeam.team1});
    setTeam2({...defaultTeam.team2});
    setSubs1({...defaultTeam.subs1});
    setSubs2({...defaultTeam.subs2});
  }, [defaultTeam]);

  const handleSave = () => {
    if (!name.trim()) { setNameError(true); return; }
    const resolvedType = type || typedDrillTypes[0]?.name || 'General';
    const drillPositions = getPositionsForDrillType();
    const stripToPositions = (obj: Record<string, any>) =>
      Object.fromEntries(Object.entries(obj).filter(([pos]) => drillPositions.includes(Number(pos))));
    const newDrill: Drill = {
      id: String(Date.now()),
      name: name.trim(),
      type: resolvedType,
      notes,
      intensity,
      duration,
      isBreak: false,
      team1: stripToPositions(team1),
      team2: stripToPositions(team2),
      subs1: stripToPositions(subs1),
      subs2: stripToPositions(subs2),
    };
    // Add to weekDrills for the selected day
    if (setWeekDrills && selectedDate) {
      setWeekDrills((prev: any) => ({ ...prev, [selectedDate]: [...(prev[selectedDate] || []), newDrill] }));
    } else {
      setDrills([...drills, newDrill]);
    }
    navigateTo('session-plan');
  };

  const getPositionsForDrillType = () => {
    const drillType = drillTypes.find(dt => dt.name === type);
    return drillType ? drillType.positions : teamStructure.map(p => p.number);
  };

  const countSelectedPlayers = () => {
    const relevantPositions = getPositionsForDrillType();
    const count = (obj: Record<string, any>) =>
      relevantPositions.filter(pos => obj[pos]).length;
    return count(team1) + count(team2) + count(subs1) + count(subs2);
  };

  if (showTeamSelection) {
    // Only expose the positions relevant to this drill type.
    // Filter the team objects so the modal only shows/saves relevant slots.
    const drillPositions = getPositionsForDrillType();
    const filterToPositions = (obj: Record<string, any>) =>
      Object.fromEntries(Object.entries(obj).filter(([pos]) => drillPositions.includes(Number(pos))));

    return (
      <TeamSelectionModal
        athletes={athletes}
        team1={filterToPositions(team1)}
        setTeam1={(t: any) => setTeam1({ ...team1, ...t })}
        team2={filterToPositions(team2)}
        setTeam2={(t: any) => setTeam2({ ...team2, ...t })}
        subs1={filterToPositions(subs1)}
        setSubs1={(t: any) => setSubs1({ ...subs1, ...t })}
        subs2={filterToPositions(subs2)}
        setSubs2={(t: any) => setSubs2({ ...subs2, ...t })}
        onClearAll={() => {
          // Only clear the positions relevant to this drill — leave others intact
          const clearPositions = (obj: Record<string, any>) =>
            Object.fromEntries(Object.entries(obj).filter(([pos]) => !drillPositions.includes(Number(pos))));
          setTeam1(clearPositions(team1));
          setTeam2(clearPositions(team2));
          setSubs1(clearPositions(subs1));
          setSubs2(clearPositions(subs2));
        }}
        onBack={() => setShowTeamSelection(false)}
        positions={drillPositions}
        teamStructure={teamStructure}
        title="Select Team"
      />
    );
  }

  return (
    <div className="max-w-md md:max-w-3xl mx-auto p-4 md:p-6">
      <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-4 mb-24">
        <div>
          <label className="block text-[11px] font-medium text-slate-500 mb-1.5">Name</label>
          <input type="text" value={name} onChange={e => { setName(e.target.value); setNameError(false); }} placeholder="Drill name"
            className={`w-full h-9 px-3 text-[13px] border rounded bg-slate-50 text-slate-900 focus:outline-none focus:ring-1 ${nameError ? 'border-red-400 focus:ring-red-400' : 'border-slate-200 focus:ring-blue-500'}`} />
          {nameError && <p className="text-[11px] text-red-500 mt-1">Please enter a drill name</p>}
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-500 mb-1.5">Type</label>
          <select value={type} onChange={e => {
              setType(e.target.value);
              const dt = drillTypes.find((d: any) => d.name === e.target.value);
              if (dt?.defaultDuration) setDuration(dt.defaultDuration);
            }}
            className="w-full h-9 px-3 text-[13px] border border-slate-200 rounded bg-slate-50 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500">
            {drillTypes.map(dt => <option key={dt.id}>{dt.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-500 mb-1.5">Intensity</label>
          <select value={intensity} onChange={e => setIntensity(e.target.value)}
            className="w-full h-9 px-3 text-[13px] border border-slate-200 rounded bg-slate-50 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500">
            <option>Low</option><option>Medium</option><option>High</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-500 mb-1.5">Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes…"
            className="w-full px-3 py-2 text-[13px] border border-slate-200 rounded bg-slate-50 text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none" rows={3} />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-500 mb-1.5">Duration (minutes)</label>
          <div className="flex items-center gap-2">
            <input type="number" min="0" max="300" step="5" value={duration || ''}
              onChange={e => setDuration(Math.max(0, parseInt(e.target.value) || 0))}
              placeholder="0"
              className="w-28 h-9 px-3 text-[13px] border border-slate-200 rounded bg-slate-50 text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500" />
            <div className="flex gap-1">
              {[10, 15, 20, 30, 45, 60].map(m => (
                <button key={m} type="button" onClick={() => setDuration(m)}
                  className={`h-7 px-2 rounded text-[11px] font-medium transition-colors ${duration === m ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  {m}m
                </button>
              ))}
            </div>
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-500 mb-1.5">Team</label>
          <button onClick={() => setShowTeamSelection(true)}
            className="w-full h-9 bg-slate-100 text-slate-600 rounded border border-slate-200 hover:bg-slate-200 transition-colors text-[13px] font-medium flex items-center justify-center gap-2">
            <Users className="w-3.5 h-3.5" />
            {countSelectedPlayers() > 0 ? `${countSelectedPlayers()} players selected` : 'Select Team'}
          </button>
        </div>
      </div>
      <div className="fixed bottom-0 left-0 md:left-52 right-0 bg-white border-t border-slate-200 p-3">
        <div className="max-w-md md:max-w-lg mx-auto flex gap-2">
          <button onClick={handleSave}
            className="flex-1 h-10 bg-slate-900 text-white rounded-lg text-[13px] font-semibold hover:bg-slate-700 transition-colors">Save Drill</button>
          <button onClick={() => navigateTo('session-plan')}
            className="h-10 px-5 bg-white border border-slate-200 text-slate-600 rounded-lg text-[13px] font-medium hover:bg-slate-50 hover:border-slate-300 transition-colors">Cancel</button>
        </div>
      </div>
    </div>
  );
};

const TeamSelectionModal = ({ athletes, team1, setTeam1, team2, setTeam2, subs1, setSubs1, subs2, setSubs2, onBack, onClearAll, positions, teamStructure, title = "Team Selection" }: any) => {
  const [selectedCell, setSelectedCell] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  const getPosName = n => teamStructure.find(p => p.number === n)?.name || 'Pos ' + n;
  const getAthName = id => athletes.find(a => a.id === id)?.name || 'Select';
  const getStatus = id => athletes.find(a => a.id === id)?.status;

  const getStatusStyle = (id, isSub) => {
    const s = getStatus(id);
    if (!s) return isSub ? 'bg-slate-50 text-slate-400 border-slate-100' : 'bg-slate-100 border-slate-200';
    if (s === 'Available') return isSub ? 'bg-green-50 text-green-700 border-green-100' : 'bg-green-100 text-green-800 border-green-200';
    if (s === 'Modified') return isSub ? 'bg-amber-50 text-amber-700 border-amber-100' : 'bg-amber-100 text-amber-800 border-amber-200';
    return isSub ? 'bg-red-50 text-red-700 border-red-100' : 'bg-red-100 text-red-800 border-red-200';
  };

  const selectAthlete = (id) => {
    if (!selectedCell) return;
    const { row, team, isSub } = selectedCell;
    if (team === 1) { if (isSub) setSubs1({...subs1, [row]: id}); else setTeam1({...team1, [row]: id}); }
    else { if (isSub) setSubs2({...subs2, [row]: id}); else setTeam2({...team2, [row]: id}); }
    setSelectedCell(null);
  };

  const sorted = [...positions].sort((a,b) => a - b);

  // Get sorted and filtered athletes based on position match
  const getSortedAthletes = () => {
    if (!selectedCell) return [];
    const posNum = selectedCell.row;
    const posGroup = teamStructure.find(p => p.number === posNum)?.group;

    const filtered = athletes.filter(a => a.name.toLowerCase().includes(searchTerm.toLowerCase()));

    // Sort function: position match > same group > other group, then by status, then alphabetical
    const statusOrder = { 'Available': 0, 'Modified': 1, 'Unavailable': 2 };

    return filtered.sort((a, b) => {
      const aMatchesPos = a.positionNumbers?.includes(posNum) ? 0 : 1;
      const bMatchesPos = b.positionNumbers?.includes(posNum) ? 0 : 1;
      if (aMatchesPos !== bMatchesPos) return aMatchesPos - bMatchesPos;

      const aGroup = a.positionNumbers?.some(pn => teamStructure.find(p => p.number === pn)?.group === posGroup) ? 0 : 1;
      const bGroup = b.positionNumbers?.some(pn => teamStructure.find(p => p.number === pn)?.group === posGroup) ? 0 : 1;
      if (aGroup !== bGroup) return aGroup - bGroup;

      const aStatus = statusOrder[a.status] ?? 3;
      const bStatus = statusOrder[b.status] ?? 3;
      if (aStatus !== bStatus) return aStatus - bStatus;

      return a.name.localeCompare(b.name);
    });
  };

  if (selectedCell) {
    const sortedAthletes = getSortedAthletes();
    const posNum = selectedCell.row;
    const posGroup = teamStructure.find(p => p.number === posNum)?.group;
    const posName = getPosName(posNum);

    // Split athletes into groups
    const matchingPosition = sortedAthletes.filter(a => a.positionNumbers?.includes(posNum));
    const sameGroupOther = sortedAthletes.filter(a => !a.positionNumbers?.includes(posNum) && a.positionNumbers?.some(pn => teamStructure.find(p => p.number === pn)?.group === posGroup));
    const otherGroup = sortedAthletes.filter(a => !a.positionNumbers?.includes(posNum) && !a.positionNumbers?.some(pn => teamStructure.find(p => p.number === pn)?.group === posGroup));

    const renderAthlete = (a) => (
      <button key={a.id} onClick={() => selectAthlete(a.id)} className={`w-full p-2 text-left rounded-lg text-sm flex items-center gap-2 ${a.status === 'Available' ? 'bg-green-50 text-green-700' : a.status === 'Modified' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>
        <span className={`w-2 h-2 rounded-full ${a.status === 'Available' ? 'bg-green-500' : a.status === 'Modified' ? 'bg-amber-500' : 'bg-red-500'}`}></span>
        <span className="flex-1">{a.name}</span>
        <span className="text-xs opacity-70">{getPositionDisplay(a.positionNumbers, teamStructure)}</span>
      </button>
    );

    return (
      <div className="max-w-md md:max-w-3xl mx-auto p-4 md:p-6">
        <div className="bg-white rounded-lg border border-slate-200">
          <div className="p-4 border-b flex items-center gap-3">
            <button onClick={() => setSelectedCell(null)} className="p-1 hover:bg-slate-100 rounded-lg"><ArrowLeft className="w-5 h-5" /></button>
            <h3 className="font-semibold text-sm">{selectedCell.isSub ? 'Sub for ' : ''}{posName}</h3>
          </div>
          <div className="p-4">
            <input type="text" placeholder="Search..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full px-3 py-2 text-sm border rounded-lg mb-3" />
            <div className="max-h-72 overflow-y-auto">
              <button onClick={() => selectAthlete(null)} className="w-full p-2 text-left bg-slate-50 hover:bg-slate-100 rounded-lg text-sm text-slate-500 mb-2">Clear selection</button>

              {matchingPosition.length > 0 && (
                <div className="mb-3">
                  <div className="text-xs font-semibold text-blue-600 px-2 py-1 bg-blue-50 rounded mb-1">★ {posName}</div>
                  <div className="space-y-1">{matchingPosition.map(renderAthlete)}</div>
                </div>
              )}

              {sameGroupOther.length > 0 && (
                <div className="mb-3">
                  <div className="text-xs font-semibold text-slate-600 px-2 py-1 bg-slate-100 rounded mb-1">Other {posGroup}s</div>
                  <div className="space-y-1">{sameGroupOther.map(renderAthlete)}</div>
                </div>
              )}

              {otherGroup.length > 0 && (
                <div className="mb-3">
                  <div className="text-xs font-semibold text-slate-400 px-2 py-1 bg-slate-50 rounded mb-1">{posGroup === 'Forward' ? 'Backs' : 'Forwards'}</div>
                  <div className="space-y-1">{otherGroup.map(renderAthlete)}</div>
                </div>
              )}

              {sortedAthletes.length === 0 && <p className="text-sm text-slate-400 text-center py-4">No athletes found</p>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md md:max-w-3xl mx-auto p-4 md:p-6">
      <div className="bg-white rounded-lg border border-slate-200">
        <div className="p-4 border-b flex items-center gap-3">
          <button onClick={onBack} className="p-1 hover:bg-slate-100 rounded-lg"><ArrowLeft className="w-5 h-5" /></button>
          <h3 className="font-semibold text-sm">{title}</h3>
        </div>
        <div className="p-4 overflow-x-auto">
          <div className="grid grid-cols-5 gap-1 min-w-[400px]">
            <div className="text-xs text-slate-500 text-center pb-2">Team 1</div>
            <div className="text-xs text-slate-500 text-center pb-2">Sub</div>
            <div className="text-xs text-slate-500 text-center pb-2"></div>
            <div className="text-xs text-slate-500 text-center pb-2">Sub</div>
            <div className="text-xs text-slate-500 text-center pb-2">Team 2</div>
            {sorted.map(pos => (
              <React.Fragment key={pos}>
                <button onClick={() => setSelectedCell({ row: pos, team: 1, isSub: false })} className={`p-1.5 text-left rounded text-xs truncate border ${getStatusStyle(team1[pos], false)}`}>{team1[pos] ? getAthName(team1[pos]) : getPosName(pos)}</button>
                <button onClick={() => setSelectedCell({ row: pos, team: 1, isSub: true })} className={`p-1.5 text-left rounded text-xs truncate border ${getStatusStyle(subs1[pos], true)}`}>{subs1[pos] ? getAthName(subs1[pos]) : '-'}</button>
                <div className="flex items-center justify-center text-xs text-slate-400">{pos}</div>
                <button onClick={() => setSelectedCell({ row: pos, team: 2, isSub: true })} className={`p-1.5 text-left rounded text-xs truncate border ${getStatusStyle(subs2[pos], true)}`}>{subs2[pos] ? getAthName(subs2[pos]) : '-'}</button>
                <button onClick={() => setSelectedCell({ row: pos, team: 2, isSub: false })} className={`p-1.5 text-left rounded text-xs truncate border ${getStatusStyle(team2[pos], false)}`}>{team2[pos] ? getAthName(team2[pos]) : getPosName(pos)}</button>
              </React.Fragment>
            ))}
          </div>
        </div>
        <div className="p-4 border-t">
          <div className="flex gap-4 justify-center mb-3 text-xs">
            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-green-500"></div>Available</div>
            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-amber-500"></div>Modified</div>
            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-red-500"></div>Unavailable</div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { setTeam1({}); setTeam2({}); setSubs1({}); setSubs2({}); onClearAll && onClearAll(); }} className="flex-1 px-4 py-2 bg-red-50 text-red-600 border border-red-100 rounded-lg text-sm font-medium hover:bg-red-100 transition-colors">Clear All</button>
            <button onClick={onBack} className="flex-1 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium">Done</button>
          </div>
        </div>
      </div>
    </div>
  );
};

const AvailabilityChart = ({ athleteId, availabilityRecords, seasonDates }: any) => {
  const defaultPeriod = seasonDates.find(sd => sd.isDefault);
  const [selectedPeriod, setSelectedPeriod] = useState(defaultPeriod ? defaultPeriod.id.toString() : 'all');

  const stats = useMemo(() => {
    let records = availabilityRecords.filter(r => r.athleteId === athleteId);
    if (selectedPeriod !== 'all') {
      const period = seasonDates.find(sd => sd.id.toString() === selectedPeriod);
      if (period) records = records.filter(r => r.date >= period.fromDate && r.date <= period.toDate);
    }
    const total = records.length;
    if (total === 0) return { available: 0, modified: 0, unavailable: 0, total: 0 };
    return { available: Math.round((records.filter(r => r.status === 'Available').length / total) * 100), modified: Math.round((records.filter(r => r.status === 'Modified').length / total) * 100), unavailable: Math.round((records.filter(r => r.status === 'Unavailable').length / total) * 100), total };
  }, [athleteId, availabilityRecords, selectedPeriod, seasonDates]);

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <h3 className="font-semibold text-sm mb-3">Availability Report</h3>
      <div className="flex flex-wrap gap-2 mb-4">
        <button onClick={() => setSelectedPeriod('all')} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${selectedPeriod === 'all' ? 'bg-slate-800 text-white' : 'bg-slate-100'}`}>All Time</button>
        {seasonDates.map(p => <button key={p.id} onClick={() => setSelectedPeriod(p.id.toString())} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${selectedPeriod === p.id.toString() ? 'bg-slate-800 text-white' : 'bg-slate-100'}`}>{p.title}</button>)}
      </div>
      {stats.total === 0 ? <p className="text-center py-6 text-slate-500 text-sm">No data.</p> : (
        <>
          <div className="h-8 rounded-lg overflow-hidden flex mb-3">
            {stats.available > 0 && <div className="bg-green-500 flex items-center justify-center text-white text-xs" style={{width: stats.available+'%'}}>{stats.available > 10 && stats.available+'%'}</div>}
            {stats.modified > 0 && <div className="bg-amber-500 flex items-center justify-center text-white text-xs" style={{width: stats.modified+'%'}}>{stats.modified > 10 && stats.modified+'%'}</div>}
            {stats.unavailable > 0 && <div className="bg-red-500 flex items-center justify-center text-white text-xs" style={{width: stats.unavailable+'%'}}>{stats.unavailable > 10 && stats.unavailable+'%'}</div>}
          </div>
          <div className="flex gap-4 text-xs flex-wrap">
            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-green-500"></div>Available ({stats.available}%)</div>
            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-amber-500"></div>Modified ({stats.modified}%)</div>
            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded bg-red-500"></div>Unavailable ({stats.unavailable}%)</div>
          </div>
          <p className="text-xs text-slate-400 mt-2">{stats.total} days</p>
        </>
      )}
    </div>
  );
};

const ReportingPage = ({ athletes, availabilityRecords, seasonDates, teamStructure }: any) => {
  const [activeTab, setActiveTab] = useState<'availability' | 'eod' | 'injury'>('availability');

  return (
    <div className="max-w-md md:max-w-3xl mx-auto p-4 md:p-6 space-y-4">
      {/* Tab bar */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-lg w-fit">
        {([['availability','Availability'],['eod','End of Day'],['injury','Injury Report']] as const).map(([tab, label]) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 rounded text-[12px] font-medium transition-colors whitespace-nowrap ${activeTab === tab ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'availability' && (
        <AvailabilityReportTab athletes={athletes} availabilityRecords={availabilityRecords} seasonDates={seasonDates} teamStructure={teamStructure} />
      )}
      {activeTab === 'eod' && (
        <EODReportTab athletes={athletes} availabilityRecords={availabilityRecords} teamStructure={teamStructure} />
      )}
      {activeTab === 'injury' && (
        <InjuryReportTab athletes={athletes} teamStructure={teamStructure} seasonDates={seasonDates} availabilityRecords={availabilityRecords} />
      )}
    </div>
  );
};

// ── Availability trend report ────────────────────────────────────────────────
const AvailabilityReportTab = ({ athletes, availabilityRecords, seasonDates, teamStructure }: any) => {
  const assignedPositions: number[] = useMemo(() => Array.from(new Set(athletes.flatMap((a: any) => a.positionNumbers || []) as number[])).sort((a, b) => a - b), [athletes]);
  const defaultPeriod = seasonDates.find((sd: any) => sd.isDefault);
  const [dateMode, setDateMode] = useState(defaultPeriod ? 'period' : 'all');
  const [selectedPeriodId, setSelectedPeriodId] = useState(defaultPeriod?.id.toString() || '');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [selectedAthleteIds, setSelectedAthleteIds] = useState(athletes.map((a: any) => a.id));
  const [selectedPositions, setSelectedPositions] = useState<number[]>(assignedPositions);
  const [selectedGroups, setSelectedGroups] = useState(['Forward', 'Back']);
  const [showFilters, setShowFilters] = useState(false);
  const [showAvailable, setShowAvailable] = useState(true);
  const [showModified, setShowModified] = useState(true);
  const [showUnavailable, setShowUnavailable] = useState(false);

  const uniquePositionNames = useMemo(() => {
    const names = new Map();
    assignedPositions.forEach((posNum: number) => {
      const pos = teamStructure.find((p: any) => p.number === posNum);
      if (pos && !names.has(pos.name)) names.set(pos.name, { name: pos.name, numbers: [], group: pos.group });
      if (pos) names.get(pos.name).numbers.push(posNum);
    });
    return Array.from(names.values());
  }, [assignedPositions, teamStructure]);

  const togglePositionName = (posName: any) => {
    const posData = uniquePositionNames.find((p: any) => p.name === posName);
    if (!posData) return;
    const allSelected = (posData as any).numbers.every((n: any) => selectedPositions.includes(n));
    if (allSelected) setSelectedPositions(prev => prev.filter((p: any) => !(posData as any).numbers.includes(p)));
    else setSelectedPositions(prev => [...new Set([...prev, ...(posData as any).numbers])]);
  };

  const toggleGroup = (group: string) => {
    const groupPositions = (teamStructure as any[]).filter((p: any) => p.group === group).map((p: any) => p.number);
    const assignedGroupPositions = groupPositions.filter((p: any) => assignedPositions.includes(p));
    if (selectedGroups.includes(group)) {
      setSelectedGroups(prev => prev.filter(g => g !== group));
      setSelectedPositions(prev => prev.filter((p: any) => !assignedGroupPositions.includes(p)));
    } else {
      setSelectedGroups(prev => [...prev, group]);
      setSelectedPositions(prev => [...new Set([...prev, ...assignedGroupPositions])]);
    }
  };

  const dateRange = useMemo(() => {
    if (dateMode === 'custom' && customFrom && customTo) return { from: customFrom, to: customTo };
    if (dateMode === 'period' && selectedPeriodId) { const p = seasonDates.find((sd: any) => sd.id.toString() === selectedPeriodId); if (p) return { from: p.fromDate, to: p.toDate }; }
    if (availabilityRecords.length > 0) { const dates = availabilityRecords.map((r: any) => r.date).sort(); return { from: dates[0], to: dates[dates.length - 1] }; }
    return null;
  }, [dateMode, selectedPeriodId, customFrom, customTo, seasonDates, availabilityRecords]);

  const filteredAthleteIds = useMemo(() => selectedAthleteIds.filter((id: any) => { const a = athletes.find((x: any) => x.id === id); return a?.positionNumbers && (selectedPositions.length === 0 || a.positionNumbers.some((p: any) => selectedPositions.includes(p))); }), [selectedAthleteIds, selectedPositions, athletes]);

  const chartData = useMemo(() => {
    if (!dateRange || filteredAthleteIds.length === 0) return [];
    const dates: string[] = [];
    for (let d = new Date(dateRange.from); d <= new Date(dateRange.to); d.setDate(d.getDate() + 1)) dates.push(new Date(d).toISOString().split('T')[0]);
    return dates.map(date => {
      const recs = availabilityRecords.filter((r: any) => r.date === date && filteredAthleteIds.includes(r.athleteId));
      if (recs.length === 0) return null;
      const t = filteredAthleteIds.length;
      return { date, available: Math.round((recs.filter((r: any) => r.status === 'Available').length / t) * 100), modified: Math.round((recs.filter((r: any) => r.status === 'Modified').length / t) * 100), unavailable: Math.round((recs.filter((r: any) => r.status === 'Unavailable').length / t) * 100) };
    }).filter(Boolean);
  }, [dateRange, filteredAthleteIds, availabilityRecords]);

  // Average availability across the period
  const periodAverages = useMemo(() => {
    if (chartData.length === 0) return null;
    const avg = (key: string) => Math.round((chartData as any[]).reduce((sum, d: any) => sum + d[key], 0) / chartData.length);
    return { available: avg('available'), modified: avg('modified'), unavailable: avg('unavailable') };
  }, [chartData]);

  // Full-width responsive SVG — use a wide viewBox so labels don't crowd
  const VW = 800, VH = 200, pad = { top: 24, right: 16, bottom: 32, left: 40 };
  const iW = VW - pad.left - pad.right, iH = VH - pad.top - pad.bottom;
  const path = (data: any[], key: string) => data.length < 2 ? '' : data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${pad.left + (i / (data.length - 1)) * iW} ${pad.top + iH - (d[key] / 100) * iH}`).join(' ');

  return (
    <>
      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <h3 className="font-semibold text-sm mb-3">Time Period</h3>
        <div className="flex flex-wrap gap-2 mb-3">
          <button onClick={() => setDateMode('all')} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${dateMode === 'all' ? 'bg-slate-800 text-white' : 'bg-slate-100'}`}>All Time</button>
          {seasonDates.map((p: any) => <button key={p.id} onClick={() => { setDateMode('period'); setSelectedPeriodId(p.id.toString()); }} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${dateMode === 'period' && selectedPeriodId === p.id.toString() ? 'bg-slate-800 text-white' : 'bg-slate-100'}`}>{p.title}</button>)}
          <button onClick={() => setDateMode('custom')} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${dateMode === 'custom' ? 'bg-slate-800 text-white' : 'bg-slate-100'}`}>Custom</button>
        </div>
        {dateMode === 'custom' && <div className="grid grid-cols-2 gap-2"><input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="px-3 py-2 text-sm border rounded-lg" /><input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="px-3 py-2 text-sm border rounded-lg" /></div>}
      </div>
      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <button onClick={() => setShowFilters(!showFilters)} className="w-full flex justify-between items-center"><h3 className="font-semibold text-sm">Filters</h3>{showFilters ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</button>
        {showFilters && (
          <div className="mt-3 space-y-3">
            <div><p className="text-xs text-slate-500 mb-2">Position Group</p><div className="flex gap-2">
              <button onClick={() => toggleGroup('Forward')} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${selectedGroups.includes('Forward') ? 'bg-slate-800 text-white' : 'bg-slate-100'}`}>Forwards</button>
              <button onClick={() => toggleGroup('Back')} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${selectedGroups.includes('Back') ? 'bg-slate-800 text-white' : 'bg-slate-100'}`}>Backs</button>
            </div></div>
            <div><p className="text-xs text-slate-500 mb-2">Positions</p><div className="flex flex-wrap gap-1">
              {(uniquePositionNames as any[]).map((pos: any) => {
                const allSelected = pos.numbers.every((n: any) => selectedPositions.includes(n));
                return <button key={pos.name} onClick={() => togglePositionName(pos.name)} className={`px-2 py-1 rounded text-xs ${allSelected ? 'bg-slate-800 text-white' : 'bg-slate-100'}`}>{pos.name}</button>;
              })}
            </div></div>
            <div><p className="text-xs text-slate-500 mb-2">Athletes ({selectedAthleteIds.length}/{athletes.length})</p><div className="space-y-1 max-h-32 overflow-y-auto">{athletes.map((a: any) => <label key={a.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selectedAthleteIds.includes(a.id)} onChange={() => setSelectedAthleteIds((p: any) => p.includes(a.id) ? p.filter((x: any) => x !== a.id) : [...p, a.id])} className="w-4 h-4" />{a.name}</label>)}</div></div>
          </div>
        )}
      </div>
      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-sm">Availability Over Time</h3>
          <div className="flex gap-2">
            <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" checked={showAvailable} onChange={e => setShowAvailable(e.target.checked)} className="w-3 h-3" /><div className="w-2 h-2 rounded-full bg-green-500"></div>Available</label>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" checked={showModified} onChange={e => setShowModified(e.target.checked)} className="w-3 h-3" /><div className="w-2 h-2 rounded-full bg-amber-500"></div>Modified</label>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" checked={showUnavailable} onChange={e => setShowUnavailable(e.target.checked)} className="w-3 h-3" /><div className="w-2 h-2 rounded-full bg-red-500"></div>Unavailable</label>
          </div>
        </div>

        {/* Period average: available % headline only */}
        {periodAverages && (
          <div className="flex items-center gap-4 mb-4 p-3 bg-green-50 border border-green-100 rounded-lg">
            <div>
              <div className="text-3xl font-bold text-green-700 leading-none">{periodAverages.available}%</div>
              <div className="text-[11px] text-green-600 mt-1 font-medium">Avg Available</div>
            </div>
            <div className="flex-1 h-2 bg-green-100 rounded-full overflow-hidden">
              <div className="h-full bg-green-500 rounded-full" style={{ width: periodAverages.available + '%' }} />
            </div>
            <div className="text-right text-[11px] text-slate-400">
              <div>{chartData.length} days</div>
              <div>{filteredAthleteIds.length} athletes</div>
            </div>
          </div>
        )}

        {chartData.length === 0 ? <p className="text-center py-8 text-slate-500 text-sm">No data.</p> : (
          <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full h-auto" preserveAspectRatio="none">
            {/* Grid lines + y-axis labels */}
            {[0, 25, 50, 75, 100].map(v => (
              <g key={v}>
                <line x1={pad.left} y1={pad.top + iH - (v / 100) * iH} x2={VW - pad.right} y2={pad.top + iH - (v / 100) * iH} stroke={v === 0 ? '#cbd5e1' : '#f1f5f9'} strokeWidth={v === 0 ? '1' : '1'} />
                <text x={pad.left - 6} y={pad.top + iH - (v / 100) * iH + 4} textAnchor="end" fontSize="18" fill="#94a3b8">{v}%</text>
              </g>
            ))}
            {/* Average dashed reference lines */}
            {periodAverages && showAvailable && (
              <line x1={pad.left} y1={pad.top + iH - (periodAverages.available / 100) * iH} x2={VW - pad.right} y2={pad.top + iH - (periodAverages.available / 100) * iH} stroke="#22c55e" strokeWidth="1" strokeDasharray="6,4" opacity="0.4" />
            )}
            {periodAverages && showModified && (
              <line x1={pad.left} y1={pad.top + iH - (periodAverages.modified / 100) * iH} x2={VW - pad.right} y2={pad.top + iH - (periodAverages.modified / 100) * iH} stroke="#f59e0b" strokeWidth="1" strokeDasharray="6,4" opacity="0.4" />
            )}
            {/* Lines */}
            {showAvailable && <path d={path(chartData as any[], 'available')} fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
            {showModified && <path d={path(chartData as any[], 'modified')} fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
            {showUnavailable && <path d={path(chartData as any[], 'unavailable')} fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
            {/* Dots — only render if not too many data points */}
            {chartData.length <= 60 && showAvailable && (chartData as any[]).map((d: any, i) => <circle key={'a'+i} cx={pad.left + (i / Math.max(chartData.length - 1, 1)) * iW} cy={pad.top + iH - (d.available / 100) * iH} r="4" fill="#22c55e" />)}
            {chartData.length <= 60 && showModified && (chartData as any[]).map((d: any, i) => <circle key={'m'+i} cx={pad.left + (i / Math.max(chartData.length - 1, 1)) * iW} cy={pad.top + iH - (d.modified / 100) * iH} r="4" fill="#f59e0b" />)}
            {chartData.length <= 60 && showUnavailable && (chartData as any[]).map((d: any, i) => <circle key={'u'+i} cx={pad.left + (i / Math.max(chartData.length - 1, 1)) * iW} cy={pad.top + iH - (d.unavailable / 100) * iH} r="4" fill="#ef4444" />)}
          </svg>
        )}

      </div>
    </>
  );
};

// ── EOD Report Tab ───────────────────────────────────────────────────────────
const EODReportTab = ({ athletes, availabilityRecords, teamStructure }: any) => {
  const eodDates = useMemo(() => {
    const dates = [...new Set(
      availabilityRecords
        .filter((r: any) => typeof r.date === 'string' && r.date.endsWith('__EOD__'))
        .map((r: any) => r.date.replace('__EOD__', ''))
    )].sort().reverse() as string[];
    return dates;
  }, [availabilityRecords]);

  const defaultDate = eodDates[0] || '';
  const [selectedDate, setSelectedDate] = useState(defaultDate);

  useEffect(() => {
    if (!selectedDate && eodDates.length > 0) setSelectedDate(eodDates[0]);
  }, [eodDates]);

  const fmtDate = (d: string) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const fmtShort = (d: string) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';

  const snapshot = useMemo(() => {
    if (!selectedDate) return [];
    const eodDate = selectedDate + '__EOD__';
    const eodRecs = availabilityRecords.filter((r: any) => r.date === eodDate);
    return athletes.map((a: Athlete) => {
      const rec = eodRecs.find((r: any) => r.athleteId === a.id);
      if (!rec) return null;
      return {
        athlete: a,
        status: rec.status,
        note: rec.note || '',
        isPublic: rec.isPublic ?? a.isPublic,
        selectionStatus: (a as any).selectionStatus || 'Available for Selection',
        injuries: (a.injuries || []).filter((i: any) => i.startDate <= selectedDate && (!i.returnDate || i.returnDate >= selectedDate)),
      };
    }).filter(Boolean);
  }, [selectedDate, availabilityRecords, athletes]);

  // Available first, Modified second (sorted: available-for-selection first, then not), Unavailable last (sorted by ETR)
  const byStatus = useMemo(() => {
    const available = snapshot.filter((r: any) => r.status === 'Available')
      .sort((a: any, b: any) => a.athlete.name.localeCompare(b.athlete.name));

    const modified = snapshot.filter((r: any) => r.status === 'Modified')
      .sort((a: any, b: any) => {
        // Available for Selection first, then Unavailable for Selection
        const aAvail = (a.selectionStatus !== 'Unavailable for Selection') ? 0 : 1;
        const bAvail = (b.selectionStatus !== 'Unavailable for Selection') ? 0 : 1;
        if (aAvail !== bAvail) return aAvail - bAvail;
        return a.athlete.name.localeCompare(b.athlete.name);
      });

    const unavailable = snapshot.filter((r: any) => r.status === 'Unavailable')
      .sort((a: any, b: any) => {
        // Sort by soonest ETR first; no ETR (season-long) goes to end
        const aEtr = a.injuries[0]?.returnDate || '9999-12-31';
        const bEtr = b.injuries[0]?.returnDate || '9999-12-31';
        if (aEtr !== bEtr) return aEtr < bEtr ? -1 : 1;
        return a.athlete.name.localeCompare(b.athlete.name);
      });

    return { available, modified, unavailable };
  }, [snapshot]);

  // Available: group by position group then position name (no position numbers shown)
  const availableByGroup = useMemo(() => {
    const groups: Record<string, { posName: string; posNumber: number; athletes: any[] }[]> = {};
    byStatus.available.forEach((row: any) => {
      const posNums = row.athlete.positionNumbers || [];
      if (posNums.length === 0) {
        if (!groups['Unassigned']) groups['Unassigned'] = [];
        let pos = groups['Unassigned'].find((p: any) => p.posName === 'Unassigned');
        if (!pos) { pos = { posName: 'Unassigned', posNumber: 999, athletes: [] }; groups['Unassigned'].push(pos); }
        pos.athletes.push(row); return;
      }
      const primaryNum = Math.min(...posNums);
      const posInfo = teamStructure.find((p: any) => p.number === primaryNum);
      const group = posInfo?.group || 'Other';
      const posName = posInfo?.name || `Position ${primaryNum}`;
      if (!groups[group]) groups[group] = [];
      let posEntry = groups[group].find((p: any) => p.posName === posName);
      if (!posEntry) { posEntry = { posName, posNumber: primaryNum, athletes: [] }; groups[group].push(posEntry); }
      posEntry.athletes.push(row);
    });
    Object.values(groups).forEach(g => g.sort((a: any, b: any) => a.posNumber - b.posNumber));
    const ordered: { group: string; positions: { posName: string; posNumber: number; athletes: any[] }[] }[] = [];
    ['Forward', 'Back', 'Other', 'Unassigned'].forEach(g => { if (groups[g]) ordered.push({ group: g, positions: groups[g] }); });
    return ordered;
  }, [byStatus.available, teamStructure]);

  if (eodDates.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-slate-200 p-10 text-center">
        <p className="text-slate-400 text-[13px]">No End of Day reports saved yet</p>
        <p className="text-slate-300 text-[11px] mt-1">Save an End of Day Report from the Availability page</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Date picker */}
      <div className="bg-white rounded-lg border border-slate-200 p-4 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">Report Date</label>
          <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
            className="flex-1 h-8 px-3 text-[13px] border border-slate-200 rounded bg-slate-50 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>
        <div className="flex gap-1 flex-wrap">
          {eodDates.slice(0, 5).map((d: string) => (
            <button key={d} onClick={() => setSelectedDate(d)}
              className={`h-7 px-2.5 rounded text-[11px] font-medium border transition-colors ${selectedDate === d ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`}>
              {fmtShort(d)}
            </button>
          ))}
        </div>
        {selectedDate && <p className="text-[11px] text-slate-400 w-full">{fmtDate(selectedDate)} · {snapshot.length} athletes</p>}
      </div>

      {snapshot.length === 0 && selectedDate && (
        <div className="bg-white rounded-lg border border-slate-200 p-8 text-center">
          <p className="text-slate-400 text-[13px]">No End of Day report found for {fmtDate(selectedDate)}</p>
        </div>
      )}

      {/* ── AVAILABLE — multi-column grid, grouped by position name ── */}
      {byStatus.available.length > 0 && (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 bg-green-50 border-b border-green-100">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <h3 className="text-[13px] font-semibold text-green-700">Available</h3>
            <span className="ml-auto text-[11px] text-green-400 font-medium">{byStatus.available.length} player{byStatus.available.length !== 1 ? 's' : ''}</span>
          </div>
          {availableByGroup.map(({ group, positions }: any) => (
            <div key={group}>
              {/* Position group header */}
              <div className="px-4 py-1.5 bg-slate-50 border-b border-slate-100">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{group}s</span>
              </div>
              {positions.map(({ posName, athletes: posAthletes }: any) => (
                <div key={posName} className="border-b border-slate-50 last:border-b-0">
                  {/* Position name header */}
                  <div className="px-4 py-1 flex items-center gap-2 bg-white">
                    <span className="text-[11px] font-semibold text-slate-600">{posName}</span>
                    <span className="text-[10px] text-slate-300 font-medium">{posAthletes.length}</span>
                  </div>
                  {/* Multi-column grid of athletes */}
                  <div className="px-3 pb-2 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-1.5">
                    {posAthletes.map((row: any) => (
                      <EODAvailableCell key={row.athlete.id} row={row} fmtShort={fmtShort} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* ── MODIFIED — 2-col grid, selection-available first ── */}
      {byStatus.modified.length > 0 && (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 border-b border-amber-100">
            <div className="w-2 h-2 rounded-full bg-amber-500" />
            <h3 className="text-[13px] font-semibold text-amber-700">Modified</h3>
            <span className="ml-auto text-[11px] text-amber-400 font-medium">{byStatus.modified.length} player{byStatus.modified.length !== 1 ? 's' : ''}</span>
          </div>
          {(() => {
            const forSel = byStatus.modified.filter((r: any) => r.selectionStatus !== 'Unavailable for Selection');
            const notSel = byStatus.modified.filter((r: any) => r.selectionStatus === 'Unavailable for Selection');
            const showSubHeaders = forSel.length > 0 && notSel.length > 0;
            return (
              <div className="p-3 space-y-3">
                {showSubHeaders && forSel.length > 0 && (
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-1">Available for Selection</p>
                )}
                {forSel.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {forSel.map((row: any) => <EODModifiedCard key={row.athlete.id} row={row} fmtShort={fmtShort} />)}
                  </div>
                )}
                {showSubHeaders && notSel.length > 0 && (
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-1 pt-1">Not Available for Selection</p>
                )}
                {notSel.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {notSel.map((row: any) => <EODModifiedCard key={row.athlete.id} row={row} fmtShort={fmtShort} />)}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* ── UNAVAILABLE — 2-col grid, ordered by soonest ETR ── */}
      {byStatus.unavailable.length > 0 && (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border-b border-red-100">
            <div className="w-2 h-2 rounded-full bg-red-500" />
            <h3 className="text-[13px] font-semibold text-red-700">Unavailable</h3>
            <span className="ml-auto text-[11px] text-red-400 font-medium">{byStatus.unavailable.length} player{byStatus.unavailable.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="p-3 space-y-2">
            {byStatus.unavailable.map((row: any) => <EODUnavailableRow key={row.athlete.id} row={row} fmtShort={fmtShort} />)}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Available: compact card for multi-column grid ────────────────────────────
const EODAvailableCell = ({ row, fmtShort }: { row: any; fmtShort: (d: string) => string }) => {
  const { athlete, note, injuries } = row;
  const hasDetail = (note && note.trim()) || injuries.length > 0;
  return (
    <div className={`rounded-md px-2.5 py-2 border ${hasDetail ? 'bg-green-50 border-green-100' : 'bg-slate-50 border-slate-100'}`}>
      <div className="flex items-center gap-1.5">
        {athlete.photo
          ? <img src={athlete.photo} alt="" className="w-5 h-5 rounded flex-shrink-0 object-cover" />
          : <div className="w-5 h-5 bg-slate-200 rounded flex items-center justify-center text-[8px] font-semibold text-slate-400 flex-shrink-0">{athlete.avatar}</div>}
        <span className="text-[12px] font-medium text-slate-800 truncate">{athlete.name}</span>
      </div>
      {hasDetail && (
        <div className="mt-1 space-y-0.5">
          {injuries.map((inj: any) => (
            <div key={inj.id} className="text-[10px] text-red-600 flex items-center gap-1">
              <AlertCircle className="w-2.5 h-2.5 flex-shrink-0" />
              <span className="truncate">{inj.bodyPart}{inj.returnDate ? ` · ETR ${fmtShort(inj.returnDate)}` : ' · Season'}</span>
            </div>
          ))}
          {note && note.trim() && (
            <div className="text-[10px] text-blue-600 flex items-center gap-1">
              <MessageSquare className="w-2.5 h-2.5 flex-shrink-0" />
              <span className="truncate">{note.trim()}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Modified: card with selection pill, no position numbers ─────────────────
const EODModifiedCard = ({ row, fmtShort }: { row: any; fmtShort: (d: string) => string }) => {
  const { athlete, note, injuries, selectionStatus } = row;
  const forSelection = selectionStatus !== 'Unavailable for Selection';
  const hasDetail = (note && note.trim()) || injuries.length > 0;
  return (
    <div className={`rounded-lg border p-2.5 ${forSelection ? 'bg-amber-50 border-amber-100' : 'bg-slate-50 border-slate-200'}`}>
      <div className="flex items-center gap-2">
        {athlete.photo
          ? <img src={athlete.photo} alt="" className="w-6 h-6 rounded flex-shrink-0 object-cover" />
          : <div className="w-6 h-6 bg-slate-200 rounded flex items-center justify-center text-[8px] font-semibold text-slate-400 flex-shrink-0">{athlete.avatar}</div>}
        <span className="text-[12px] font-semibold text-slate-800 flex-1 truncate">{athlete.name}</span>
        <span className={`flex-shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded border whitespace-nowrap ${forSelection ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-600 border-red-100'}`}>
          {forSelection ? 'Available for Selection' : 'Not Available'}
        </span>
      </div>
      {hasDetail && (
        <div className="mt-1.5 space-y-1 ml-8">
          {injuries.map((inj: any) => (
            <div key={inj.id} className="text-[10px] text-red-700 flex items-start gap-1">
              <AlertCircle className="w-2.5 h-2.5 mt-0.5 flex-shrink-0 text-red-400" />
              <span>{inj.bodyPart}{inj.returnDate ? ` · ETR ${fmtShort(inj.returnDate)}` : ' · Season'}</span>
            </div>
          ))}
          {note && note.trim() && (
            <div className="text-[10px] text-blue-600 flex items-center gap-1">
              <MessageSquare className="w-2.5 h-2.5 flex-shrink-0" /><span className="truncate">{note.trim()}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Unavailable: row with note, injury body parts, prominent ETR ─────────────
const EODUnavailableRow = ({ row, fmtShort }: { row: any; fmtShort: (d: string) => string }) => {
  const { athlete, note, injuries } = row;
  const etrs = injuries.map((i: any) => i.returnDate).filter(Boolean).sort();
  const nextEtr = etrs[0] || null;
  const isSeason = injuries.length > 0 && !nextEtr;
  const hasNote = note && note.trim();
  return (
    <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2.5 flex items-start gap-2.5">
      <div className="flex-shrink-0">
        {athlete.photo
          ? <img src={athlete.photo} alt="" className="w-7 h-7 rounded object-cover" />
          : <div className="w-7 h-7 bg-slate-100 rounded flex items-center justify-center text-[9px] font-semibold text-slate-400">{athlete.avatar}</div>}
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <span className="text-[13px] font-semibold text-slate-800">{athlete.name}</span>
        {/* Active injuries — body part chips */}
        {injuries.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {injuries.map((inj: any) => (
              <div key={inj.id} className="flex flex-col gap-0.5">
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-red-700 bg-red-50 border border-red-100 rounded px-1.5 py-0.5 w-fit">
                  <AlertCircle className="w-2.5 h-2.5 flex-shrink-0" />
                  {inj.bodyPart}{inj.event ? ` · ${inj.event}` : ''}
                </span>
                {inj.notes && (
                  <span className="text-[10px] text-red-500 pl-1 italic">{inj.notes}</span>
                )}
              </div>
            ))}
          </div>
        )}
        {/* Note */}
        {hasNote && (
          <div className="text-[11px] text-blue-600 flex items-center gap-1">
            <MessageSquare className="w-2.5 h-2.5 flex-shrink-0" />{note.trim()}
          </div>
        )}
      </div>
      {/* ETR — right-aligned */}
      <div className="flex-shrink-0 text-right min-w-[44px]">
        {isSeason ? (
          <span className="text-[10px] font-bold text-red-600 bg-red-50 border border-red-100 rounded px-1.5 py-1 block text-center">Season</span>
        ) : nextEtr ? (
          <>
            <div className="text-[9px] text-slate-400 uppercase tracking-wider">ETR</div>
            <div className="text-[13px] font-bold text-slate-700">{fmtShort(nextEtr)}</div>
          </>
        ) : null}
      </div>
    </div>
  );
};


// ── Injury Report Tab ─────────────────────────────────────────────────────────
const InjuryReportTab = ({ athletes, teamStructure, seasonDates, availabilityRecords }: any) => {
  const today = new Date().toISOString().split('T')[0];
  const EVENT_OPTS = ['Training', 'Match', 'Other'];
  const SURFACE_OPTS = ['4G', 'Grass', 'Other'];
  const CONTACT_OPTS = ['Contact', 'Non-Contact'];
  // Status: Active = injury ongoing, Historical = resolved
  const STATUS_OPTS = ['Active', 'Historical'];

  // Date period state (shared pattern)
  const defaultPeriod = seasonDates.find((sd: any) => sd.isDefault);
  const [dateMode, setDateMode] = useState(defaultPeriod ? 'period' : 'all');
  const [selectedPeriodId, setSelectedPeriodId] = useState(defaultPeriod?.id.toString() || '');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  // Position/group state (shared pattern)
  const assignedPositions: number[] = useMemo(() => Array.from(new Set(athletes.flatMap((a: any) => a.positionNumbers || []) as number[])).sort((a: any, b: any) => a - b), [athletes]);
  const uniquePositionNames = useMemo(() => {
    const names = new Map();
    assignedPositions.forEach((posNum: number) => {
      const pos = teamStructure.find((p: any) => p.number === posNum);
      if (pos && !names.has(pos.name)) names.set(pos.name, { name: pos.name, numbers: [], group: pos.group });
      if (pos) names.get(pos.name).numbers.push(posNum);
    });
    return Array.from(names.values()) as any[];
  }, [assignedPositions, teamStructure]);

  const [selectedGroups, setSelectedGroups] = useState<string[]>(['Forward', 'Back']);
  const [selectedPositionNames, setSelectedPositionNames] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [filterEvent, setFilterEvent] = useState<string[]>([]);
  const [filterSurface, setFilterSurface] = useState<string[]>([]);
  const [filterContact, setFilterContact] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<string[]>([]);

  const dateRange = useMemo(() => {
    if (dateMode === 'custom' && customFrom && customTo) return { from: customFrom, to: customTo };
    if (dateMode === 'period' && selectedPeriodId) { const p = seasonDates.find((sd: any) => sd.id.toString() === selectedPeriodId); if (p) return { from: p.fromDate, to: p.toDate }; }
    return null;
  }, [dateMode, selectedPeriodId, customFrom, customTo, seasonDates]);

  const toggleGroup = (group: string) => {
    setSelectedGroups(prev => prev.includes(group) ? prev.filter(g => g !== group) : [...prev, group]);
  };
  const togglePositionName = (posName: string) => {
    setSelectedPositionNames(prev => prev.includes(posName) ? prev.filter(n => n !== posName) : [...prev, posName]);
  };
  const toggleFilter = (arr: string[], val: string, set: (v: string[]) => void) => {
    set(arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val]);
  };
  const hasAnyFilter = filterEvent.length + filterSurface.length + filterContact.length + filterStatus.length > 0 || selectedPositionNames.length > 0 || selectedGroups.length < 2;
  const clearAllFilters = () => { setFilterEvent([]); setFilterSurface([]); setFilterContact([]); setFilterStatus([]); setSelectedPositionNames([]); setSelectedGroups(['Forward', 'Back']); };

  const allInjuries = useMemo(() => {
    const rows: any[] = [];
    athletes.forEach((a: any) => {
      if (!a.injuries) return;
      a.injuries.forEach((inj: any) => {
        const isActive = !inj.returnDate || inj.returnDate >= today;
        const status = isActive ? 'Active' : 'Historical';
        const timeLoss = inj.startDate && inj.returnDate
          ? Math.round((new Date(inj.returnDate).getTime() - new Date(inj.startDate).getTime()) / 86400000)
          : null;
        const position = getPositionDisplay(a.positionNumbers || [], teamStructure);
        rows.push({ athlete: a, injury: inj, position, status, timeLoss });
      });
    });
    return rows;
  }, [athletes, teamStructure, today]);

  const filtered = useMemo(() => allInjuries.filter(row => {
    // Date range filter — injury must overlap with selected period
    if (dateRange) {
      const start = row.injury.startDate || '';
      const end = row.injury.returnDate || '9999-12-31';
      if (end < dateRange.from || start > dateRange.to) return false;
    }
    // Position group filter
    if (selectedGroups.length < 2 || selectedPositionNames.length > 0) {
      const posNames = (row.athlete.positionNumbers || []).map((n: number) => teamStructure.find((p: any) => p.number === n)?.name).filter(Boolean);
      const groups = (row.athlete.positionNumbers || []).map((n: number) => teamStructure.find((p: any) => p.number === n)?.group).filter(Boolean);
      if (selectedPositionNames.length > 0 && !posNames.some((n: any) => selectedPositionNames.includes(n))) return false;
      if (selectedGroups.length < 2 && !groups.some((g: any) => selectedGroups.includes(g))) return false;
    }
    if (filterEvent.length > 0 && !filterEvent.includes(row.injury.event || 'Training')) return false;
    if (filterSurface.length > 0 && !filterSurface.includes(row.injury.surface || '4G')) return false;
    if (filterContact.length > 0 && !filterContact.includes(row.injury.contact || 'Contact')) return false;
    if (filterStatus.length > 0 && !filterStatus.includes(row.status)) return false;
    return true;
  }), [allInjuries, dateRange, selectedGroups, selectedPositionNames, filterEvent, filterSurface, filterContact, filterStatus]);

  const fmtDate = (d: string) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : '—';
  const nameParts = (name: string) => { const parts = (name || '').trim().split(' '); return { first: parts[0] || '', last: parts.slice(1).join(' ') || '' }; };

  // Chip toggle button — consistent with Availability tab style
  const Chip = ({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) => (
    <button onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${active ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
      {label}
    </button>
  );

  return (
    <>
      {/* Time Period — identical layout to Availability tab */}
      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <h3 className="font-semibold text-sm mb-3">Time Period</h3>
        <div className="flex flex-wrap gap-2 mb-3">
          <Chip label="All Time" active={dateMode === 'all'} onClick={() => setDateMode('all')} />
          {seasonDates.map((p: any) => (
            <Chip key={p.id} label={p.title} active={dateMode === 'period' && selectedPeriodId === p.id.toString()} onClick={() => { setDateMode('period'); setSelectedPeriodId(p.id.toString()); }} />
          ))}
          <Chip label="Custom" active={dateMode === 'custom'} onClick={() => setDateMode('custom')} />
        </div>
        {dateMode === 'custom' && (
          <div className="grid grid-cols-2 gap-2">
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="px-3 py-2 text-sm border rounded-lg" />
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="px-3 py-2 text-sm border rounded-lg" />
          </div>
        )}
      </div>

      {/* Filters — accordion like Availability tab */}
      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <button onClick={() => setShowFilters(!showFilters)} className="w-full flex justify-between items-center">
          <h3 className="font-semibold text-sm">Filters</h3>
          {showFilters ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        {showFilters && (
          <div className="mt-3 space-y-3">
            <div>
              <p className="text-xs text-slate-500 mb-2">Position Group</p>
              <div className="flex gap-2">
                <Chip label="Forwards" active={selectedGroups.includes('Forward')} onClick={() => toggleGroup('Forward')} />
                <Chip label="Backs" active={selectedGroups.includes('Back')} onClick={() => toggleGroup('Back')} />
              </div>
            </div>
            {uniquePositionNames.length > 0 && (
              <div>
                <p className="text-xs text-slate-500 mb-2">Positions</p>
                <div className="flex flex-wrap gap-1">
                  {uniquePositionNames.map((pos: any) => (
                    <button key={pos.name} onClick={() => togglePositionName(pos.name)}
                      className={`px-2 py-1 rounded text-xs ${selectedPositionNames.includes(pos.name) ? 'bg-slate-800 text-white' : 'bg-slate-100'}`}>
                      {pos.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <p className="text-xs text-slate-500 mb-2">Status</p>
              <div className="flex gap-2">
                {STATUS_OPTS.map(o => (
                  <button key={o} onClick={() => toggleFilter(filterStatus, o, setFilterStatus)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${filterStatus.includes(o) ? (o === 'Active' ? 'bg-red-600 text-white border-red-600' : 'bg-green-600 text-white border-green-600') : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}>
                    {o}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-2">Event</p>
              <div className="flex gap-2 flex-wrap">
                {EVENT_OPTS.map(o => <Chip key={o} label={o} active={filterEvent.includes(o)} onClick={() => toggleFilter(filterEvent, o, setFilterEvent)} />)}
              </div>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-2">Surface</p>
              <div className="flex gap-2 flex-wrap">
                {SURFACE_OPTS.map(o => <Chip key={o} label={o} active={filterSurface.includes(o)} onClick={() => toggleFilter(filterSurface, o, setFilterSurface)} />)}
              </div>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-2">Contact</p>
              <div className="flex gap-2 flex-wrap">
                {CONTACT_OPTS.map(o => <Chip key={o} label={o} active={filterContact.includes(o)} onClick={() => toggleFilter(filterContact, o, setFilterContact)} />)}
              </div>
            </div>
            {hasAnyFilter && (
              <button onClick={clearAllFilters} className="text-[11px] text-slate-400 hover:text-slate-600 mt-1">Clear all filters</button>
            )}
          </div>
        )}
      </div>

      {/* Injury cards — single column, Active first sorted by ETR asc, Historical sorted by ETR desc */}
      {(() => {
        const active = filtered
          .filter((r: any) => r.status === 'Active')
          .sort((a: any, b: any) => {
            // No ETR (season) goes to end; otherwise soonest ETR first
            const aEtr = a.injury.returnDate || '9999-12-31';
            const bEtr = b.injury.returnDate || '9999-12-31';
            return aEtr < bEtr ? -1 : aEtr > bEtr ? 1 : a.athlete.name.localeCompare(b.athlete.name);
          });
        const historical = filtered
          .filter((r: any) => r.status === 'Historical')
          .sort((a: any, b: any) => {
            // Most recent ETR first
            const aEtr = a.injury.returnDate || '0000-01-01';
            const bEtr = b.injury.returnDate || '0000-01-01';
            return aEtr > bEtr ? -1 : aEtr < bEtr ? 1 : a.athlete.name.localeCompare(b.athlete.name);
          });

        const InjuryCard = ({ row }: { row: any }) => {
          const isActive = row.status === 'Active';
          const etrLabel = row.injury.returnDate ? fmtDate(row.injury.returnDate) : isActive ? 'Season' : '—';
          return (
            <div className={`bg-white rounded-lg border px-3 py-2 flex items-center gap-2.5 ${isActive ? 'border-red-200' : 'border-slate-200'}`}>
              {/* Avatar */}
              {row.athlete.photo
                ? <img src={row.athlete.photo} alt="" className="w-7 h-7 rounded-md object-cover flex-shrink-0" />
                : <div className={`w-7 h-7 rounded-md flex items-center justify-center text-[9px] font-semibold flex-shrink-0 ${isActive ? 'bg-red-100 text-red-500' : 'bg-slate-100 text-slate-500'}`}>{row.athlete.avatar}</div>}

              {/* Name + injury detail */}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-1.5 flex-wrap">
                  <span className="text-[13px] font-semibold text-slate-900 leading-tight">{row.athlete.name}</span>
                  <span className="text-[11px] font-semibold text-slate-700">{row.injury.bodyPart}</span>
                  {row.injury.event && <span className="px-1 py-0 bg-slate-100 text-slate-500 rounded text-[10px]">{row.injury.event}</span>}
                  {row.injury.surface && <span className="px-1 py-0 bg-slate-100 text-slate-500 rounded text-[10px]">{row.injury.surface}</span>}
                  {row.injury.contact && <span className="px-1 py-0 bg-slate-100 text-slate-500 rounded text-[10px]">{row.injury.contact}</span>}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-slate-400">{row.position}</span>
                  {row.injury.notes && <span className="text-[10px] text-slate-400 italic truncate">· {row.injury.notes}</span>}
                </div>
              </div>

              {/* Right — days + ETR */}
              <div className="flex-shrink-0 text-right">
                {row.timeLoss !== null && (
                  <p className="text-[15px] font-bold text-slate-700 leading-none">{row.timeLoss}<span className="text-[9px] font-normal text-slate-400 ml-0.5">d</span></p>
                )}
                <p className={`text-[11px] font-semibold mt-0.5 ${isActive ? 'text-red-500' : 'text-slate-500'}`}>{etrLabel}</p>
              </div>
            </div>
          );
        };

        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-semibold text-slate-700">Injury Log</h3>
              <span className="text-[11px] text-slate-400">{filtered.length} record{filtered.length !== 1 ? 's' : ''}</span>
            </div>

            {filtered.length === 0 && (
              <div className="bg-white rounded-lg border border-slate-200 p-10 text-center">
                <p className="text-slate-400 text-[13px]">No injuries match the selected filters</p>
              </div>
            )}

            {/* Active injuries */}
            {active.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-semibold text-red-500 uppercase tracking-wider px-0.5">Active · {active.length}</p>
                {active.map((row: any, i: number) => <InjuryCard key={i} row={row} />)}
              </div>
            )}

            {/* Historical injuries */}
            {historical.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-0.5">Historical · {historical.length}</p>
                {historical.map((row: any, i: number) => <InjuryCard key={i} row={row} />)}
              </div>
            )}
          </div>
        );
      })()}
    </>
  );
};



const SetupPage = ({ drillTypes, seasonDates, teamStructure, onSaveDrillType, onDeleteDrillType, onSaveSeasonDate, onDeleteSeasonDate, onSaveTeamStructure, onDeleteTeamStructure, saving }: any) => {
  const [expanded, setExpanded] = useState<string | null>('teamStructure');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<any>({});
  const [showAdd, setShowAdd] = useState<string | null>(null);
  const [newData, setNewData] = useState<any>({});
  const [localTeamStructure, setLocalTeamStructure] = useState(teamStructure);
  const [localDrillTypes, setLocalDrillTypes] = useState(drillTypes);
  const [localSeasonDates, setLocalSeasonDates] = useState(seasonDates);
  const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

  // Sync local state with props
  React.useEffect(() => { setLocalTeamStructure(teamStructure); }, [teamStructure]);
  React.useEffect(() => { setLocalDrillTypes(drillTypes); }, [drillTypes]);
  React.useEffect(() => { setLocalSeasonDates(seasonDates); }, [seasonDates]);

  return (
    <div className="max-w-md md:max-w-3xl mx-auto p-4 md:p-6 space-y-3">
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <button onClick={() => setExpanded(expanded === 'teamStructure' ? null : 'teamStructure')} className="w-full p-4 flex justify-between items-center hover:bg-slate-50">
          <div><h3 className="font-semibold text-sm text-left">Team Structure</h3><p className="text-xs text-slate-500">{teamStructure.length} positions</p></div>
          {expanded === 'teamStructure' ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </button>
        {expanded === 'teamStructure' && (
          <div className="border-t">
            {['Forward', 'Back'].map(group => (
              <div key={group}>
                <div className="px-4 py-2 bg-slate-50 text-xs font-semibold text-slate-600">{group}s</div>
                {teamStructure.filter(p => p.group === group).map(pos => (
                  <div key={pos.id} className="p-3 border-b last:border-b-0">
                    {editingId === pos.id ? (
                      <div className="space-y-2">
                        <div className="flex gap-2"><input type="number" value={editData.number || ''} onChange={e => setEditData({...editData, number: e.target.value})} className="w-16 px-2 py-1 text-sm border rounded" placeholder="#" /><input type="text" value={editData.name || ''} onChange={e => setEditData({...editData, name: e.target.value})} className="flex-1 px-2 py-1 text-sm border rounded" placeholder="Name" /></div>
                        <select value={editData.group || 'Forward'} onChange={e => setEditData({...editData, group: e.target.value})} className="w-full px-2 py-1 text-sm border rounded"><option>Forward</option><option>Back</option></select>
                        <div className="flex gap-2"><button onClick={() => { const updated = {...pos, number: parseInt(editData.number), name: editData.name, group: editData.group}; onSaveTeamStructure(updated); setLocalTeamStructure(teamStructure.map(p => p.id === pos.id ? updated : p).sort((a,b) => a.number - b.number)); setEditingId(null); }} className="flex-1 px-2 py-1 bg-green-100 text-green-700 rounded text-xs">Save</button><button onClick={() => setEditingId(null)} className="flex-1 px-2 py-1 bg-slate-100 rounded text-xs">Cancel</button></div>
                      </div>
                    ) : (
                      <div className="flex justify-between items-center">
                        <span className="text-sm">{pos.number}. {pos.name}</span>
                        <div className="flex gap-1"><button onClick={() => { setEditingId(pos.id); setEditData({number: pos.number, name: pos.name, group: pos.group}); }} className="p-1 hover:bg-slate-100 rounded"><Edit2 className="w-4 h-4 text-slate-500" /></button><button onClick={() => { onDeleteTeamStructure(pos.id); setLocalTeamStructure(teamStructure.filter(p => p.id !== pos.id)); }} className="p-1 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4 text-red-500" /></button></div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
            {showAdd === 'position' ? (
              <div className="p-3 border-t space-y-2">
                <div className="flex gap-2"><input type="number" value={newData.number || ''} onChange={e => setNewData({...newData, number: e.target.value})} className="w-16 px-2 py-1 text-sm border rounded" placeholder="#" /><input type="text" value={newData.name || ''} onChange={e => setNewData({...newData, name: e.target.value})} className="flex-1 px-2 py-1 text-sm border rounded" placeholder="Name" /></div>
                <select value={newData.group || 'Forward'} onChange={e => setNewData({...newData, group: e.target.value})} className="w-full px-2 py-1 text-sm border rounded"><option>Forward</option><option>Back</option></select>
                <div className="flex gap-2"><button onClick={() => { if (newData.name && newData.number) { const newPos = {id: String(Date.now()), number: parseInt(newData.number), name: newData.name, group: newData.group || 'Forward'}; onSaveTeamStructure(newPos); setLocalTeamStructure([...teamStructure, newPos].sort((a,b) => a.number - b.number)); setNewData({}); setShowAdd(null); }}} className="flex-1 px-2 py-1 bg-green-100 text-green-700 rounded text-xs">Add</button><button onClick={() => { setShowAdd(null); setNewData({}); }} className="flex-1 px-2 py-1 bg-slate-100 rounded text-xs">Cancel</button></div>
              </div>
            ) : <div className="p-3 border-t"><button onClick={() => setShowAdd('position')} className="w-full px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-medium"><Plus className="w-4 h-4 inline mr-1" />Add Position</button></div>}
          </div>
        )}
      </div>
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <button onClick={() => setExpanded(expanded === 'drillTypes' ? null : 'drillTypes')} className="w-full p-4 flex justify-between items-center hover:bg-slate-50">
          <div><h3 className="font-semibold text-sm text-left">Drill Types</h3><p className="text-xs text-slate-500">{drillTypes.length} types</p></div>
          {expanded === 'drillTypes' ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </button>
        {expanded === 'drillTypes' && (
          <div className="border-t divide-y">
            {drillTypes.map(dt => (
              <div key={dt.id} className="p-3">
                {editingId === 'dt-' + dt.id ? (
                  <div className="space-y-3">
                    <div className="flex gap-2 items-center">
                      <input type="text" value={editData.name || ''} onChange={e => setEditData({...editData, name: e.target.value})} className="flex-1 px-2 py-1 text-sm border rounded" />
                      <input type="number" min="0" max="300" step="5" value={editData.defaultDuration || ''} onChange={e => setEditData({...editData, defaultDuration: parseInt(e.target.value) || 0})} className="w-14 px-2 py-1 text-sm border rounded text-center" placeholder="min" />
                      <span className="text-xs text-slate-400">min</span>
                      <button onClick={() => { const updated = {...dt, name: editData.name, defaultDuration: editData.defaultDuration || 0, positions: editData.positions || dt.positions}; onSaveDrillType(updated); setLocalDrillTypes(localDrillTypes.map(d => d.id === dt.id ? updated : d)); setEditingId(null); }} className="p-1 bg-green-100 text-green-700 rounded"><Check className="w-4 h-4" /></button>
                      <button onClick={() => setEditingId(null)} className="p-1 bg-slate-100 rounded"><X className="w-4 h-4" /></button>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 mb-2">Position Group:</p>
                      <div className="flex gap-2 mb-3">
                        {['Forward', 'Back'].map(group => {
                          const groupPositions = teamStructure.filter(p => p.group === group).map(p => p.number);
                          const currentPositions = editData.positions || dt.positions || [];
                          const allSelected = groupPositions.every(p => currentPositions.includes(p));
                          return (
                            <button key={group} onClick={() => {
                              if (allSelected) {
                                setEditData({...editData, positions: currentPositions.filter(p => !groupPositions.includes(p))});
                              } else {
                                setEditData({...editData, positions: [...new Set([...currentPositions, ...groupPositions])].sort((a,b) => a - b)});
                              }
                            }} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${allSelected ? 'bg-slate-800 text-white' : 'bg-slate-100'}`}>
                              {group}s
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-xs text-slate-500 mb-2">Positions:</p>
                      <div className="flex flex-wrap gap-1">
                        {['Forward', 'Back'].map(group => (
                          <React.Fragment key={group}>
                            {teamStructure.filter(p => p.group === group).map(pos => (
                              <button key={pos.id} onClick={() => {
                                const currentPositions = editData.positions || dt.positions || [];
                                const newPositions = currentPositions.includes(pos.number) 
                                  ? currentPositions.filter(p => p !== pos.number)
                                  : [...currentPositions, pos.number].sort((a,b) => a - b);
                                setEditData({...editData, positions: newPositions});
                              }} className={`px-2 py-1 rounded text-xs ${(editData.positions || dt.positions || []).includes(pos.number) ? 'bg-slate-800 text-white' : 'bg-slate-100'}`}>
                                {pos.number}. {pos.name}
                              </button>
                            ))}
                          </React.Fragment>
                        ))}
                      </div>
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => setEditData({...editData, positions: teamStructure.map(p => p.number)})} className="text-xs text-blue-600">Select All</button>
                        <button onClick={() => setEditData({...editData, positions: []})} className="text-xs text-slate-500">Clear All</button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm font-medium flex items-center gap-1.5">
                        {dt.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {dt.positions.length} positions{dt.defaultDuration ? ` · ${dt.defaultDuration}min` : ''}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => { setEditingId('dt-' + dt.id); setEditData({name: dt.name, defaultDuration: dt.defaultDuration || 0, positions: dt.positions}); }} className="p-1 hover:bg-slate-100 rounded"><Edit2 className="w-4 h-4 text-slate-500" /></button>
                      <button onClick={() => { onDeleteDrillType(dt.id); setLocalDrillTypes(localDrillTypes.filter(d => d.id !== dt.id)); }} className="p-1 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4 text-red-500" /></button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {showAdd === 'drillType' ? (
              <div className="p-3 space-y-3">
                <div className="flex gap-2 items-center">
                  <input type="text" value={newData.name || ''} onChange={e => setNewData({...newData, name: e.target.value})} placeholder="Type name" className="flex-1 px-2 py-1 text-sm border rounded" />
                  <input type="number" min="0" max="300" step="5" value={newData.defaultDuration || ''} onChange={e => setNewData({...newData, defaultDuration: parseInt(e.target.value) || 0})} className="w-14 px-2 py-1 text-sm border rounded text-center" placeholder="min" />
                  <span className="text-xs text-slate-400 whitespace-nowrap">def. min</span>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-2">Position Group:</p>
                  <div className="flex gap-2 mb-3">
                    {['Forward', 'Back'].map(group => {
                      const groupPositions = teamStructure.filter(p => p.group === group).map(p => p.number);
                      const currentPositions = newData.positions || teamStructure.map(p => p.number);
                      const allSelected = groupPositions.every(p => currentPositions.includes(p));
                      return (
                        <button key={group} onClick={() => {
                          if (allSelected) {
                            setNewData({...newData, positions: currentPositions.filter(p => !groupPositions.includes(p))});
                          } else {
                            setNewData({...newData, positions: [...new Set([...currentPositions, ...groupPositions])].sort((a,b) => a - b)});
                          }
                        }} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${allSelected ? 'bg-slate-800 text-white' : 'bg-slate-100'}`}>
                          {group}s
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-slate-500 mb-2">Positions:</p>
                  <div className="flex flex-wrap gap-1">
                    {['Forward', 'Back'].map(group => (
                      <React.Fragment key={group}>
                        {teamStructure.filter(p => p.group === group).map(pos => (
                          <button key={pos.id} onClick={() => {
                            const currentPositions = newData.positions || teamStructure.map(p => p.number);
                            const newPositions = currentPositions.includes(pos.number) 
                              ? currentPositions.filter(p => p !== pos.number)
                              : [...currentPositions, pos.number].sort((a,b) => a - b);
                            setNewData({...newData, positions: newPositions});
                          }} className={`px-2 py-1 rounded text-xs ${(newData.positions || teamStructure.map(p => p.number)).includes(pos.number) ? 'bg-slate-800 text-white' : 'bg-slate-100'}`}>
                            {pos.number}. {pos.name}
                          </button>
                        ))}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { if (newData.name) { const newDt = {id: String(Date.now()), name: newData.name, defaultDuration: newData.defaultDuration || 0, positions: newData.positions || teamStructure.map(p => p.number)}; onSaveDrillType(newDt); setLocalDrillTypes([...drillTypes, newDt]); setNewData({}); setShowAdd(null); }}} className="flex-1 px-2 py-1 bg-green-100 text-green-700 rounded text-xs">Add</button>
                  <button onClick={() => { setShowAdd(null); setNewData({}); }} className="flex-1 px-2 py-1 bg-slate-100 rounded text-xs">Cancel</button>
                </div>
              </div>
            ) : <div className="p-3"><button onClick={() => setShowAdd('drillType')} className="w-full px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-medium"><Plus className="w-4 h-4 inline mr-1" />Add Drill Type</button></div>}
          </div>
        )}
      </div>
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <button onClick={() => setExpanded(expanded === 'seasonDates' ? null : 'seasonDates')} className="w-full p-4 flex justify-between items-center hover:bg-slate-50">
          <div><h3 className="font-semibold text-sm text-left">Season Dates</h3><p className="text-xs text-slate-500">{seasonDates.length} periods</p></div>
          {expanded === 'seasonDates' ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </button>
        {expanded === 'seasonDates' && (
          <div className="border-t divide-y">
            {seasonDates.map(sd => (
              <div key={sd.id} className="p-3">
                {editingId === 'sd-' + sd.id ? (
                  <div className="space-y-2">
                    <input type="text" value={editData.title || ''} onChange={e => setEditData({...editData, title: e.target.value})} className="w-full px-2 py-1 text-sm border rounded" placeholder="Title" />
                    <div className="grid grid-cols-2 gap-2"><input type="date" value={editData.fromDate || ''} onChange={e => setEditData({...editData, fromDate: e.target.value})} className="px-2 py-1 text-sm border rounded" /><input type="date" value={editData.toDate || ''} onChange={e => setEditData({...editData, toDate: e.target.value})} className="px-2 py-1 text-sm border rounded" /></div>
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editData.isDefault || false} onChange={e => setEditData({...editData, isDefault: e.target.checked})} />Default</label>
                    <div className="flex gap-2"><button onClick={() => { let upd = seasonDates; if (editData.isDefault) upd = seasonDates.map(s => ({...s, isDefault: false})); const updated = {...sd, ...editData}; onSaveSeasonDate(updated); setLocalSeasonDates(upd.map(s => s.id === sd.id ? updated : s)); setEditingId(null); }} className="flex-1 px-2 py-1 bg-green-100 text-green-700 rounded text-xs">Save</button><button onClick={() => setEditingId(null)} className="flex-1 px-2 py-1 bg-slate-100 rounded text-xs">Cancel</button></div>
                  </div>
                ) : (
                  <div className="flex justify-between items-center">
                    <div><div className="flex items-center gap-2"><p className="text-sm font-medium">{sd.title}</p>{sd.isDefault && <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">Default</span>}</div><p className="text-xs text-slate-500">{fmtDate(sd.fromDate)} - {fmtDate(sd.toDate)}</p></div>
                    <div className="flex gap-1"><button onClick={() => setLocalSeasonDates(seasonDates.map(s => ({...s, isDefault: s.id === sd.id ? !s.isDefault : false})))} className={`p-1 rounded ${sd.isDefault ? 'bg-blue-50 text-blue-600' : 'hover:bg-slate-100 text-slate-500'}`}><Target className="w-4 h-4" /></button><button onClick={() => { setEditingId('sd-' + sd.id); setEditData({title: sd.title, fromDate: sd.fromDate, toDate: sd.toDate, isDefault: sd.isDefault}); }} className="p-1 hover:bg-slate-100 rounded"><Edit2 className="w-4 h-4 text-slate-500" /></button><button onClick={() => setLocalSeasonDates(seasonDates.filter(s => s.id !== sd.id))} className="p-1 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4 text-red-500" /></button></div>
                  </div>
                )}
              </div>
            ))}
            {showAdd === 'seasonDate' ? (
              <div className="p-3 space-y-2">
                <input type="text" value={newData.title || ''} onChange={e => setNewData({...newData, title: e.target.value})} className="w-full px-2 py-1 text-sm border rounded" placeholder="Title" />
                <div className="grid grid-cols-2 gap-2"><input type="date" value={newData.fromDate || ''} onChange={e => setNewData({...newData, fromDate: e.target.value})} className="px-2 py-1 text-sm border rounded" /><input type="date" value={newData.toDate || ''} onChange={e => setNewData({...newData, toDate: e.target.value})} className="px-2 py-1 text-sm border rounded" /></div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={newData.isDefault || false} onChange={e => setNewData({...newData, isDefault: e.target.checked})} />Default</label>
                <div className="flex gap-2"><button onClick={() => { if (newData.title && newData.fromDate && newData.toDate) { let upd = seasonDates; if (newData.isDefault) upd = seasonDates.map(s => ({...s, isDefault: false})); const newSd = {id: String(Date.now()), ...newData}; onSaveSeasonDate(newSd); setLocalSeasonDates([...upd, newSd]); setNewData({}); setShowAdd(null); }}} className="flex-1 px-2 py-1 bg-green-100 text-green-700 rounded text-xs">Add</button><button onClick={() => { setShowAdd(null); setNewData({}); }} className="flex-1 px-2 py-1 bg-slate-100 rounded text-xs">Cancel</button></div>
              </div>
            ) : <div className="p-3"><button onClick={() => setShowAdd('seasonDate')} className="w-full px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-medium"><Plus className="w-4 h-4 inline mr-1" />Add Time Period</button></div>}
          </div>
        )}
      </div>
    </div>
  );
};

const AthleteProfilePage = ({ athletes, athleteId, navigateTo, availabilityRecords, seasonDates, teamStructure, onSave, onDelete, saving }: any) => {
  const athlete = athletes.find(a => a.id === athleteId);
  const [name, setName] = useState(athlete?.name || '');
  const [positionNumbers, setPositionNumbers] = useState(athlete?.positionNumbers || []);
  const [photo, setPhoto] = useState(athlete?.photo || '');
  const [injuries, setInjuries] = useState(athlete?.injuries || []);
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);
  const [showPositionPicker, setShowPositionPicker] = useState(false);
  const [editingInjuryId, setEditingInjuryId] = useState(null);
  const [showAddInjury, setShowAddInjury] = useState(false);
  const [injuryData, setInjuryData] = useState({ bodyPart: 'Head', startDate: '', returnDate: '', notes: '', event: 'Training', surface: '4G', contact: 'Contact' });

  if (!athlete) return <div className="max-w-md md:max-w-3xl mx-auto p-4 md:p-6"><div className="bg-white rounded-lg border border-slate-200 p-6 text-center"><p>Athlete not found</p><button onClick={() => navigateTo('availability')} className="mt-4 px-4 py-2 bg-slate-800 text-white rounded-lg text-sm">Back</button></div></div>;

  const genAvatar = (n: string) => { if (!n) return ''; const p = n.trim().split(' '); return p.length >= 2 ? p[0][0].toUpperCase() + p[p.length-1][0].toUpperCase() : n.substring(0,2).toUpperCase(); };
  const isNew = athlete?.name === 'New Athlete' && !athlete?.positionNumbers?.length;
  const handleSave = async () => { 
    await onSave({...athlete, name, positionNumbers, photo, avatar: genAvatar(name), injuries}); 
    setShowSaveSuccess(true); 
    setTimeout(() => { setShowSaveSuccess(false); navigateTo('availability'); }, 1000);
  };

  const uniqueNames: string[] = Array.from(new Set(teamStructure.map((p: any) => p.name)));
  const selectedNames: string[] = Array.from(new Set(positionNumbers.map((n: number) => teamStructure.find((p: any) => p.number === n)?.name).filter(Boolean))) as string[];
  const today = new Date().toISOString().split('T')[0];
  const activeInjuries = injuries.filter((i: any) => !i.returnDate || i.returnDate >= today);
  const pastInjuries = injuries.filter((i: any) => i.returnDate && i.returnDate < today);

  const saveInjury = () => {
    if (injuryData.bodyPart && injuryData.startDate) {
      if (editingInjuryId) setInjuries(injuries.map((i: any) => i.id === editingInjuryId ? {...i, ...injuryData} : i));
      else setInjuries([...injuries, {id: Date.now(), ...injuryData}]);
      setInjuryData({ bodyPart: 'Head', startDate: '', returnDate: '', notes: '', event: 'Training', surface: '4G', contact: 'Contact' });
      setEditingInjuryId(null);
      setShowAddInjury(false);
    }
  };

  return (
    <div className="max-w-md md:max-w-3xl mx-auto p-4 md:p-6">
      {showSaveSuccess && <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-50 text-sm">✓ Saved!</div>}
      <div className="space-y-4 mb-20">
        <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-4">
          <div className="flex justify-center">
            <div className="relative">
              {photo ? <img src={photo} alt="" className="w-24 h-24 rounded-full object-cover border-4 border-slate-200" /> : <div className="w-24 h-24 bg-slate-200 rounded-full flex items-center justify-center font-bold text-2xl border-4 border-slate-200">{genAvatar(name) || <User className="w-10 h-10 text-slate-400" />}</div>}
              <label className="absolute bottom-0 right-0 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center cursor-pointer hover:bg-blue-700">
                <Camera className="w-4 h-4 text-white" />
                <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) { const r = new FileReader(); r.onloadend = () => setPhoto(r.result); r.readAsDataURL(f); }}} />
              </label>
            </div>
          </div>
          <div><label className="block text-xs font-medium mb-1">Name</label><input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Name" className="w-full px-3 py-2 text-sm border rounded-lg" /></div>
          <div>
            <label className="block text-xs font-medium mb-1">Positions</label>
            <button onClick={() => setShowPositionPicker(!showPositionPicker)} className="w-full px-3 py-2 text-sm border rounded-lg text-left flex justify-between items-center">
              <span className={selectedNames.length > 0 ? '' : 'text-slate-400'}>{selectedNames.length > 0 ? selectedNames.join(', ') : 'Select positions...'}</span>
              {showPositionPicker ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {showPositionPicker && (
              <div className="mt-2 p-3 bg-slate-50 rounded-lg border">
                {['Forward', 'Back'].map(group => (
                  <div key={group} className="mb-3 last:mb-0">
                    <p className="text-xs font-semibold text-slate-500 mb-2">{group}s</p>
                    <div className="flex flex-wrap gap-2">
                      {uniqueNames.filter((pn: string) => teamStructure.find((p: any) => p.name === pn && p.group === group)).map((pn: string) => {
                        const nums = teamStructure.filter((p: any) => p.name === pn).map((p: any) => p.number);
                        const sel = nums.some((n: number) => positionNumbers.includes(n));
                        return <button key={pn} onClick={() => { if (sel) setPositionNumbers(positionNumbers.filter((n: number) => !nums.includes(n))); else setPositionNumbers(Array.from(new Set([...positionNumbers, ...nums])).sort((a: number, b: number) => a - b)); }} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${sel ? 'bg-slate-800 text-white' : 'bg-white border hover:bg-slate-100'}`}>{pn}</button>;
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {positionNumbers.length > 0 && <p className="text-xs text-slate-500">Group: {getPositionGroup(positionNumbers, teamStructure)}</p>}
        </div>

        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-semibold text-sm">Injuries</h3>
            {!showAddInjury && <button onClick={() => { setShowAddInjury(true); setEditingInjuryId(null); setInjuryData({ bodyPart: 'Head', startDate: today, returnDate: '', notes: '', event: 'Training', surface: '4G', contact: 'Contact' }); }} className="text-xs text-blue-600 font-medium">+ Add</button>}
          </div>
          {showAddInjury && (
            <div className="mb-4 p-3 bg-slate-50 rounded-lg space-y-3">
              <div><label className="block text-xs text-slate-500 mb-1">Body Part</label><select value={injuryData.bodyPart} onChange={e => setInjuryData({...injuryData, bodyPart: e.target.value})} className="w-full px-3 py-2 text-sm border rounded-lg">{BODY_PARTS.map(bp => <option key={bp}>{bp}</option>)}</select></div>
              <div className="grid grid-cols-3 gap-2">
                <div><label className="block text-xs text-slate-500 mb-1">Event</label><select value={injuryData.event || 'Training'} onChange={e => setInjuryData({...injuryData, event: e.target.value})} className="w-full px-2 py-2 text-sm border rounded-lg"><option>Training</option><option>Match</option><option>Other</option></select></div>
                <div><label className="block text-xs text-slate-500 mb-1">Surface</label><select value={injuryData.surface || '4G'} onChange={e => setInjuryData({...injuryData, surface: e.target.value})} className="w-full px-2 py-2 text-sm border rounded-lg"><option value="4G">4G</option><option>Grass</option><option>Other</option></select></div>
                <div><label className="block text-xs text-slate-500 mb-1">Contact</label><select value={injuryData.contact || 'Contact'} onChange={e => setInjuryData({...injuryData, contact: e.target.value})} className="w-full px-2 py-2 text-sm border rounded-lg"><option>Contact</option><option>Non-Contact</option></select></div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="block text-xs text-slate-500 mb-1">Start Date</label><input type="date" value={injuryData.startDate} onChange={e => setInjuryData({...injuryData, startDate: e.target.value})} className="w-full px-3 py-2 text-sm border rounded-lg" /></div>
                <div><label className="block text-xs text-slate-500 mb-1">Est. Return (ETR)</label><input type="date" value={injuryData.returnDate} onChange={e => setInjuryData({...injuryData, returnDate: e.target.value})} className="w-full px-3 py-2 text-sm border rounded-lg" /></div>
              </div>
              {injuryData.startDate && injuryData.returnDate && (() => {
                const days = Math.round((new Date(injuryData.returnDate).getTime() - new Date(injuryData.startDate).getTime()) / 86400000);
                return days >= 0 ? <div className="px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-700 font-medium">⏱ Time Loss: {days} day{days !== 1 ? 's' : ''}</div> : null;
              })()}
              <div><label className="block text-xs text-slate-500 mb-1">Notes</label><textarea value={injuryData.notes} onChange={e => setInjuryData({...injuryData, notes: e.target.value})} className="w-full px-3 py-2 text-sm border rounded-lg" rows={2} /></div>
              <div className="flex gap-2"><button onClick={saveInjury} className="flex-1 px-3 py-2 bg-slate-800 text-white rounded-lg text-sm font-medium">{editingInjuryId ? 'Update' : 'Add'}</button><button onClick={() => { setShowAddInjury(false); setEditingInjuryId(null); }} className="flex-1 px-3 py-2 bg-slate-100 rounded-lg text-sm">Cancel</button></div>
            </div>
          )}
          {activeInjuries.length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-slate-500 mb-2">Active</p>
              {activeInjuries.map(inj => (
                <div key={inj.id} className="flex items-start justify-between p-2 bg-red-50 rounded-lg mb-2 border border-red-100">
                  <div>
                    <p className="text-sm font-medium text-red-800">{inj.bodyPart}</p>
                    <p className="text-xs text-red-600">Since {new Date(inj.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{inj.returnDate ? ` • ETR: ${new Date(inj.returnDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}</p>
                    {inj.notes && <p className="text-xs text-red-700 mt-1">{inj.notes}</p>}
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => { setInjuryData({ bodyPart: inj.bodyPart, startDate: inj.startDate, returnDate: inj.returnDate || '', notes: inj.notes || '', event: inj.event || 'Training', surface: inj.surface || '4G', contact: inj.contact || 'Contact' }); setEditingInjuryId(inj.id); setShowAddInjury(true); }} className="p-1 hover:bg-red-100 rounded"><Edit2 className="w-3 h-3 text-red-600" /></button>
                    <button onClick={() => setInjuries(injuries.filter(i => i.id !== inj.id))} className="p-1 hover:bg-red-100 rounded"><Trash2 className="w-3 h-3 text-red-600" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {pastInjuries.length > 0 && (
            <div>
              <p className="text-xs text-slate-500 mb-2">History</p>
              {pastInjuries.map(inj => (
                <div key={inj.id} className="flex items-start justify-between p-2 bg-slate-50 rounded-lg mb-2">
                  <div>
                    <p className="text-sm font-medium text-slate-700">{inj.bodyPart}</p>
                    <p className="text-xs text-slate-500">{new Date(inj.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {new Date(inj.returnDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                    {inj.notes && <p className="text-xs text-slate-600 mt-1">{inj.notes}</p>}
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => { setInjuryData({ bodyPart: inj.bodyPart, startDate: inj.startDate, returnDate: inj.returnDate || '', notes: inj.notes || '', event: inj.event || 'Training', surface: inj.surface || '4G', contact: inj.contact || 'Contact' }); setEditingInjuryId(inj.id); setShowAddInjury(true); }} className="p-1 hover:bg-slate-100 rounded"><Edit2 className="w-3 h-3 text-slate-500" /></button>
                    <button onClick={() => setInjuries(injuries.filter(i => i.id !== inj.id))} className="p-1 hover:bg-slate-100 rounded"><Trash2 className="w-3 h-3 text-slate-500" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {injuries.length === 0 && !showAddInjury && <p className="text-sm text-slate-400 text-center py-4">No injuries recorded</p>}
        </div>
        <AvailabilityChart athleteId={athleteId} availabilityRecords={availabilityRecords} seasonDates={seasonDates} />
      </div>
      <div className="fixed bottom-0 left-0 md:left-52 right-0 bg-white border-t border-slate-200 p-4">
        <div className="max-w-md md:max-w-lg mx-auto space-y-2">
          <div className="flex gap-2">
            <button onClick={handleSave} className="flex-1 h-10 bg-slate-900 text-white rounded-lg text-[13px] font-medium hover:bg-slate-700 transition-colors">Save</button>
            <button onClick={() => navigateTo('availability')} className="h-10 px-5 bg-slate-100 text-slate-600 rounded-lg text-[13px] hover:bg-slate-200 transition-colors">Cancel</button>
          </div>
          {!isNew && (
            <button onClick={async () => { if (window.confirm('Delete this athlete?')) { await onDelete(athleteId); navigateTo('availability'); }}}
              className="w-full h-9 bg-red-50 text-red-600 border border-red-200 rounded-lg text-[13px] font-medium hover:bg-red-100 transition-colors">Delete Athlete</button>
          )}
        </div>
      </div>
    </div>
  );
};



export default AthleteManager;