'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Search, Plus, User, Menu, MessageSquare, X, ChevronDown, ChevronUp, Users, Calendar, Zap, Target, ArrowLeft, Camera, Settings, Trash2, Edit2, Check, BarChart3, AlertCircle, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

const BODY_PARTS = ['Head', 'Neck', 'Shoulder', 'Arm', 'Elbow', 'Wrist', 'Hand', 'Chest', 'Back', 'Hip', 'Groin', 'Thigh', 'Hamstring', 'Knee', 'Calf', 'Ankle', 'Foot', 'Other'];

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
      // Fetch team structure
      const { data: teamData } = await supabase
        .from('team_structure')
        .select('*')
        .order('number');
      if (teamData) setTeamStructure(teamData.map((t: any) => ({ 
        id: t.id, 
        number: t.number, 
        name: t.name, 
        group: t.position_group 
      })));

      // Fetch athletes with positions and injuries
      const { data: athletesData } = await supabase
        .from('athletes')
        .select(`
          *,
          athlete_positions(position_number),
          athlete_injuries(*)
        `)
        .order('name');
      if (athletesData) setAthletes(athletesData.map((a: any) => ({
        id: a.id,
        name: a.name,
        status: a.status,
        notes: a.notes,
        isPublic: a.is_public,
        avatar: a.avatar,
        photo: a.photo_url,
        positionNumbers: a.athlete_positions?.map((p: any) => p.position_number) || [],
        injuries: a.athlete_injuries?.map((i: any) => ({
          id: i.id,
          bodyPart: i.body_part,
          startDate: i.start_date,
          returnDate: i.return_date,
          notes: i.notes
        })) || []
      })));

      // Fetch drill types with positions
      const { data: drillTypesData } = await supabase
        .from('drill_types')
        .select(`
          *,
          drill_type_positions(position_number)
        `)
        .order('name');
      if (drillTypesData) setDrillTypes(drillTypesData.map((dt: any) => ({
        id: dt.id,
        name: dt.name,
        positions: dt.drill_type_positions?.map((p: any) => p.position_number) || []
      })));

      // Fetch season dates
      const { data: seasonData } = await supabase
        .from('season_dates')
        .select('*')
        .order('from_date');
      if (seasonData) setSeasonDates(seasonData.map((s: any) => ({
        id: s.id,
        title: s.title,
        fromDate: s.from_date,
        toDate: s.to_date,
        isDefault: s.is_default
      })));

      // Fetch availability records
      const { data: availData } = await supabase
        .from('availability_records')
        .select('*');
      if (availData) setAvailabilityRecords(availData.map((r: any) => ({
        id: r.id,
        date: r.date,
        athleteId: r.athlete_id,
        status: r.status,
        note: r.note
      })));

      // Fetch default team
      const { data: defaultTeamData } = await supabase
        .from('default_team')
        .select('*');
      if (defaultTeamData) {
        const team1: Record<number, string> = {}, team2: Record<number, string> = {}, subs1: Record<number, string> = {}, subs2: Record<number, string> = {};
        defaultTeamData.forEach((dt: any) => {
          if (dt.team_number === 1) {
            if (dt.is_substitute) subs1[dt.position_number] = dt.athlete_id;
            else team1[dt.position_number] = dt.athlete_id;
          } else {
            if (dt.is_substitute) subs2[dt.position_number] = dt.athlete_id;
            else team2[dt.position_number] = dt.athlete_id;
          }
        });
        setDefaultTeam({ team1, team2, subs1, subs2 });
      }

      // Fetch today's session plan
      await loadSessionPlan(new Date().toISOString().split('T')[0]);

    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSessionPlan = async (date: string) => {
    const { data: sessionPlan } = await supabase
      .from('session_plans')
      .select(`
        *,
        drills(
          *,
          drill_team_assignments(*)
        )
      `)
      .eq('date', date)
      .single();
    
    if (sessionPlan?.drills) {
      setDrills(sessionPlan.drills.map((d: any) => {
        const team1: Record<number, string> = {}, team2: Record<number, string> = {}, subs1: Record<number, string> = {}, subs2: Record<number, string> = {};
        d.drill_team_assignments?.forEach((a: any) => {
          if (a.team_number === 1) {
            if (a.is_substitute) subs1[a.position_number] = a.athlete_id;
            else team1[a.position_number] = a.athlete_id;
          } else {
            if (a.is_substitute) subs2[a.position_number] = a.athlete_id;
            else team2[a.position_number] = a.athlete_id;
          }
        });
        return {
          id: d.id,
          name: d.name,
          type: d.drill_type,
          intensity: d.intensity,
          notes: d.notes,
          team1, team2, subs1, subs2
        };
      }));
    } else {
      setDrills([]);
    }
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
      const isNew = typeof athlete.id === 'number' || !athlete.id;
      
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

  const saveAvailability = async (date: string) => {
    setSaving(true);
    try {
      // Delete existing records for this date
      await supabase.from('availability_records').delete().eq('date', date);
      
      // Insert new records
      const records = athletes.map((a: Athlete) => ({
        date,
        athlete_id: a.id,
        status: a.status,
        note: a.notes
      }));
      
      await supabase.from('availability_records').insert(records);
      await fetchAllData();
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
        .single();
      
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

      // Insert new drills
      for (let i = 0; i < drillsToSave.length; i++) {
        const drill = drillsToSave[i];
        const { data: newDrill } = await supabase
          .from('drills')
          .insert({
            session_plan_id: sessionPlan.id,
            name: drill.name,
            drill_type: drill.type,
            intensity: drill.intensity,
            notes: drill.notes,
            sort_order: i
          })
          .select()
          .single();

        if (!newDrill) continue;

        // Insert team assignments
        const assignments: any[] = [];
        Object.entries(drill.team1 || {}).forEach(([pos, athleteId]) => {
          if (athleteId) assignments.push({ drill_id: newDrill.id, position_number: parseInt(pos), team_number: 1, is_substitute: false, athlete_id: athleteId });
        });
        Object.entries(drill.team2 || {}).forEach(([pos, athleteId]) => {
          if (athleteId) assignments.push({ drill_id: newDrill.id, position_number: parseInt(pos), team_number: 2, is_substitute: false, athlete_id: athleteId });
        });
        Object.entries(drill.subs1 || {}).forEach(([pos, athleteId]) => {
          if (athleteId) assignments.push({ drill_id: newDrill.id, position_number: parseInt(pos), team_number: 1, is_substitute: true, athlete_id: athleteId });
        });
        Object.entries(drill.subs2 || {}).forEach(([pos, athleteId]) => {
          if (athleteId) assignments.push({ drill_id: newDrill.id, position_number: parseInt(pos), team_number: 2, is_substitute: true, athlete_id: athleteId });
        });

        if (assignments.length > 0) {
          await supabase.from('drill_team_assignments').insert(assignments);
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
      const isNew = typeof drillType.id === 'number' || !drillType.id;
      let drillTypeId = drillType.id;

      if (isNew) {
        const { data } = await supabase
          .from('drill_types')
          .insert({ name: drillType.name })
          .select()
          .single();
        drillTypeId = data.id;
      } else {
        await supabase.from('drill_types').update({ name: drillType.name }).eq('id', drillType.id);
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
      const isNew = typeof seasonDate.id === 'number' || !seasonDate.id;
      
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
      const isNew = typeof position.id === 'number' || !position.id;
      
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
  const handleDateChange = async (newDate: string) => {
    setSelectedDate(newDate);
    await loadSessionPlan(newDate);
  };

  const navigateTo = (page: string) => { setCurrentPage(page); setShowMenu(false); };
  const getPageTitle = () => ({ home: 'Home', availability: 'Availability', 'session-plan': 'Session Plan', 'add-drill': 'Create Drill', 'athlete-profile': 'Athlete Profile', setup: 'Setup', reporting: 'Reporting' }[currentPage] || 'Team');

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-600 mx-auto mb-2" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow-sm sticky top-0 z-10 border-b px-4 py-3">
        <div className="flex items-center justify-between max-w-md mx-auto">
          <button onClick={() => setShowMenu(!showMenu)} className="p-2 hover:bg-gray-100 rounded-lg"><Menu className="w-5 h-5" /></button>
          <h1 className="text-lg font-semibold">{getPageTitle()}</h1>
          <div className="w-9"></div>
        </div>
      </div>
      {showMenu && (
        <div className="fixed inset-0 bg-black/20 z-20" onClick={() => setShowMenu(false)}>
          <div className="bg-white w-64 h-full shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b"><h2 className="text-lg font-semibold">Menu</h2></div>
            <div className="p-2">
              {[
                { page: 'home', Icon: Target, label: 'Home' },
                { page: 'availability', Icon: Calendar, label: 'Availability' },
                { page: 'session-plan', Icon: Zap, label: 'Session Plan' },
                { page: 'reporting', Icon: BarChart3, label: 'Reporting' },
                { page: 'setup', Icon: Settings, label: 'Setup' }
              ].map(({ page, Icon, label }) => (
                <button key={page} onClick={() => navigateTo(page)} className={`w-full text-left px-4 py-3 rounded-lg flex items-center gap-3 ${currentPage === page ? 'bg-indigo-50 text-indigo-700 font-medium' : 'hover:bg-gray-100'}`}>
                  <Icon className="w-5 h-5" />{label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {currentPage === 'home' && <HomePage athletes={athletes} navigateTo={navigateTo} setSelectedAthleteId={setSelectedAthleteId} teamStructure={teamStructure} />}
      {currentPage === 'availability' && <AvailabilityPage athletes={athletes} setAthletes={setAthletes} navigateTo={navigateTo} setSelectedAthleteId={setSelectedAthleteId} selectedDate={selectedDate} setSelectedDate={setSelectedDate} availabilityRecords={availabilityRecords} teamStructure={teamStructure} onSave={saveAvailability} saving={saving} />}
      {currentPage === 'session-plan' && <SessionPlanPage drills={drills} setDrills={setDrills} navigateTo={navigateTo} athletes={athletes} drillTypes={drillTypes} teamStructure={teamStructure} defaultTeam={defaultTeam} onSaveDefaultTeam={saveDefaultTeam} selectedDate={selectedDate} onDateChange={handleDateChange} onSaveSessionPlan={saveSessionPlan} saving={saving} />}
      {currentPage === 'add-drill' && <AddDrillPage drills={drills} setDrills={setDrills} navigateTo={navigateTo} drillTypes={drillTypes} defaultTeam={defaultTeam} athletes={athletes} teamStructure={teamStructure} />}
      {currentPage === 'athlete-profile' && <AthleteProfilePage athletes={athletes} athleteId={selectedAthleteId} navigateTo={navigateTo} availabilityRecords={availabilityRecords} seasonDates={seasonDates} teamStructure={teamStructure} onSave={saveAthlete} onDelete={deleteAthlete} saving={saving} />}
      {currentPage === 'reporting' && <ReportingPage athletes={athletes} availabilityRecords={availabilityRecords} seasonDates={seasonDates} teamStructure={teamStructure} />}
      {currentPage === 'setup' && <SetupPage drillTypes={drillTypes} seasonDates={seasonDates} teamStructure={teamStructure} onSaveDrillType={saveDrillType} onDeleteDrillType={deleteDrillType} onSaveSeasonDate={saveSeasonDate} onDeleteSeasonDate={deleteSeasonDate} onSaveTeamStructure={saveTeamStructure} onDeleteTeamStructure={deleteTeamStructurePosition} saving={saving} />}
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
    <div className="mt-2 p-2 bg-red-50 rounded-lg border border-red-100">
      <div className="flex items-start gap-1.5">
        <AlertCircle className="w-3 h-3 text-red-500 mt-0.5 flex-shrink-0" />
        <div className="text-xs text-red-700">
          {activeInjuries.map(inj => (
            <div key={inj.id}>{inj.bodyPart}{inj.notes ? `: ${inj.notes}` : ''}{inj.returnDate ? ` (ETR: ${new Date(inj.returnDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})` : ''}</div>
          ))}
        </div>
      </div>
    </div>
  );
};

const HomePage = ({ athletes, navigateTo, setSelectedAthleteId, teamStructure }: { athletes: Athlete[], navigateTo: (page: string) => void, setSelectedAthleteId: (id: string | null) => void, teamStructure: TeamPosition[] }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [availableOnly, setAvailableOnly] = useState(false);
  const getStatusColor = (s: string) => s === 'Available' ? 'bg-green-500' : s === 'Modified' ? 'bg-amber-500' : 'bg-red-500';
  const filtered = athletes.filter(a => a.name.toLowerCase().includes(searchTerm.toLowerCase()) && (!availableOnly || a.status !== 'Unavailable'));

  return (
    <div className="max-w-md mx-auto p-4">
      <div className="bg-white rounded-xl shadow-sm border p-4 mb-4">
        <p className="text-sm text-gray-600 mb-3">{new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
          <input type="text" placeholder="Search athletes..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg" />
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={availableOnly} onChange={e => setAvailableOnly(e.target.checked)} className="w-4 h-4 rounded" />
          <span className="text-sm">Available Only</span>
        </label>
      </div>
      <div className="space-y-2">
        {filtered.map(a => (
          <div key={a.id} className="bg-white rounded-xl shadow-sm border p-3 cursor-pointer hover:shadow-md" onClick={() => { setSelectedAthleteId(a.id); navigateTo('athlete-profile'); }}>
            <div className="flex items-center gap-3">
              <div className={`w-2.5 h-2.5 rounded-full ${getStatusColor(a.status)}`}></div>
              {a.photo ? <img src={a.photo} alt="" className="w-10 h-10 rounded-full object-cover" /> : <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center text-xs font-semibold">{a.avatar}</div>}
              <div className="flex-1"><h3 className="text-sm font-semibold">{a.name}</h3><p className="text-xs text-gray-600">{getPositionDisplay(a.positionNumbers, teamStructure)}</p></div>
              <span className="text-xs text-gray-400">{getPositionGroup(a.positionNumbers, teamStructure)}</span>
            </div>
            {a.notes && a.isPublic && <div className="mt-2 text-xs bg-gray-50 rounded-lg p-2">{a.notes}</div>}
            {a.status === 'Unavailable' && <InjuryDisplay athlete={a} />}
          </div>
        ))}
      </div>
    </div>
  );
};

const AvailabilityPage = ({ athletes, setAthletes, navigateTo, setSelectedAthleteId, selectedDate, setSelectedDate, availabilityRecords, teamStructure, onSave, saving }: any) => {
  const typedAthletes: Athlete[] = athletes;
  const typedTeamStructure: TeamPosition[] = teamStructure;
  const [searchTerm, setSearchTerm] = useState('');
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [selectedAthlete, setSelectedAthlete] = useState<Athlete | null>(null);
  const [tempNotes, setTempNotes] = useState('');
  const [tempIsPublic, setTempIsPublic] = useState(false);
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);

  const handleSave = async () => {
    await onSave(selectedDate);
    setShowSaveSuccess(true);
    setTimeout(() => setShowSaveSuccess(false), 2000);
  };

  const filteredAthletes = typedAthletes.filter(a => a.name.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div className="max-w-md mx-auto">
      <div className="bg-white shadow-sm border-b px-4 py-3 mb-4">
        <div className="flex gap-2 mb-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input type="text" placeholder="Search..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg" />
          </div>
          <button onClick={() => { const id = String(Date.now()); setAthletes([...typedAthletes, { id, name: '', status: 'Available', notes: '', isPublic: false, photo: '', positionNumbers: [], avatar: '', injuries: [] }]); setSelectedAthleteId(id); navigateTo('athlete-profile'); }} className="px-3 py-2 bg-indigo-600 text-white rounded-lg"><Plus className="w-4 h-4" /></button>
        </div>
        <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="w-full px-3 py-2 text-sm border rounded-lg" />
      </div>
      {showSaveSuccess && <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-50 text-sm">✓ Saved!</div>}
      <div className="px-4 space-y-2 pb-20">
        {filteredAthletes.map(athlete => (
          <div key={athlete.id} className="bg-white rounded-xl shadow-sm border p-3">
            <div className="flex items-center gap-3 mb-2">
              <div className="cursor-pointer" onClick={() => { setSelectedAthleteId(athlete.id); navigateTo('athlete-profile'); }}>
                {athlete.photo ? <img src={athlete.photo} alt="" className="w-10 h-10 rounded-full object-cover" /> : <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center text-xs font-semibold">{athlete.avatar}</div>}
              </div>
              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => { setSelectedAthleteId(athlete.id); navigateTo('athlete-profile'); }}>
                <h3 className="text-sm font-semibold truncate">{athlete.name}</h3>
                <p className="text-xs text-gray-600 truncate">{getPositionDisplay(athlete.positionNumbers, typedTeamStructure)}</p>
              </div>
              <select value={athlete.status} onChange={e => setAthletes(typedAthletes.map(a => a.id === athlete.id ? { ...a, status: e.target.value } : a))} className="px-2 py-1 text-xs rounded-lg border">
                <option>Available</option><option>Modified</option><option>Unavailable</option>
              </select>
            </div>
            {athlete.notes && athlete.isPublic && <div className="mb-2 p-2 bg-gray-50 rounded-lg text-xs">{athlete.notes}</div>}
            {athlete.status === 'Unavailable' && <InjuryDisplay athlete={athlete} />}
            <button onClick={() => { setSelectedAthlete(athlete); setTempNotes(athlete.notes); setTempIsPublic(athlete.isPublic); setShowNotesModal(true); }} className="w-full flex items-center justify-center gap-1 px-2 py-1.5 bg-gray-100 rounded-lg text-xs mt-2">
              <MessageSquare className="w-3 h-3" />{athlete.notes ? 'Edit Note' : 'Add Note'}
            </button>
          </div>
        ))}
      </div>
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-4">
        <button onClick={handleSave} className="w-full px-4 py-3 bg-gray-900 text-white rounded-lg font-medium text-sm">Save</button>
      </div>
      {showNotesModal && selectedAthlete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-30">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-4">
            <div className="flex justify-between mb-4"><h3 className="font-semibold">{selectedAthlete.name}</h3><button onClick={() => setShowNotesModal(false)}><X className="w-5 h-5" /></button></div>
            <textarea value={tempNotes} onChange={e => setTempNotes(e.target.value)} placeholder="Notes..." className="w-full px-3 py-2 border rounded-lg mb-3" rows={3} />
            <label className="flex items-center gap-2 mb-4"><input type="checkbox" checked={tempIsPublic} onChange={e => setTempIsPublic(e.target.checked)} className="w-4 h-4" /><span className="text-sm">Public Note</span></label>
            <div className="flex gap-2">
              <button onClick={() => { setAthletes(typedAthletes.map(a => a.id === selectedAthlete.id ? { ...a, notes: tempNotes, isPublic: tempIsPublic } : a)); setShowNotesModal(false); }} className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg">Save</button>
              <button onClick={() => setShowNotesModal(false)} className="flex-1 px-4 py-2 bg-gray-100 rounded-lg">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const SessionPlanPage = ({ drills, setDrills, navigateTo, athletes, drillTypes, teamStructure, defaultTeam, onSaveDefaultTeam, selectedDate, onDateChange, onSaveSessionPlan, saving }: any) => {
  const typedAthletes: Athlete[] = athletes;
  const typedDrills: Drill[] = drills;
  const typedDrillTypes: DrillType[] = drillTypes;
  const typedTeamStructure: TeamPosition[] = teamStructure;
  const [expandedDrill, setExpandedDrill] = useState<string | null>(null);
  const [editingTeam, setEditingTeam] = useState<Drill | null>(null);
  const [editingDefaultTeam, setEditingDefaultTeam] = useState(false);
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);
  const [tempDefaultTeam, setTempDefaultTeam] = useState(defaultTeam);

  const getPositionsForDrill = (drill: Drill) => typedDrillTypes.find(dt => dt.name === drill.type)?.positions || typedTeamStructure.map(p => p.number);

  const handleSave = async () => {
    if (typedDrills.length > 0) {
      await onSaveSessionPlan(selectedDate, typedDrills);
      setShowSaveSuccess(true);
      setTimeout(() => setShowSaveSuccess(false), 2000);
    }
  };

  const handleSaveDefaultTeam = async () => {
    await onSaveDefaultTeam(tempDefaultTeam);
    setEditingDefaultTeam(false);
  };

  const today = new Date().toISOString().split('T')[0];
  const isToday = selectedDate === today;

  if (editingDefaultTeam) {
    return <TeamSelectionModal athletes={typedAthletes} team1={tempDefaultTeam.team1} setTeam1={(t: any) => setTempDefaultTeam({...tempDefaultTeam, team1: t})} team2={tempDefaultTeam.team2} setTeam2={(t: any) => setTempDefaultTeam({...tempDefaultTeam, team2: t})} subs1={tempDefaultTeam.subs1} setSubs1={(t: any) => setTempDefaultTeam({...tempDefaultTeam, subs1: t})} subs2={tempDefaultTeam.subs2} setSubs2={(t: any) => setTempDefaultTeam({...tempDefaultTeam, subs2: t})} onBack={handleSaveDefaultTeam} positions={typedTeamStructure.map(p => p.number)} teamStructure={typedTeamStructure} title="Edit Default Team" />;
  }

  if (editingTeam) {
    return <TeamSelectionModal athletes={typedAthletes} team1={editingTeam.team1 || {}} setTeam1={(t: any) => { setDrills(typedDrills.map(d => d.id === editingTeam.id ? {...d, team1: t} : d)); setEditingTeam({...editingTeam, team1: t}); }} team2={editingTeam.team2 || {}} setTeam2={(t: any) => { setDrills(typedDrills.map(d => d.id === editingTeam.id ? {...d, team2: t} : d)); setEditingTeam({...editingTeam, team2: t}); }} subs1={editingTeam.subs1 || {}} setSubs1={(t: any) => { setDrills(typedDrills.map(d => d.id === editingTeam.id ? {...d, subs1: t} : d)); setEditingTeam({...editingTeam, subs1: t}); }} subs2={editingTeam.subs2 || {}} setSubs2={(t: any) => { setDrills(typedDrills.map(d => d.id === editingTeam.id ? {...d, subs2: t} : d)); setEditingTeam({...editingTeam, subs2: t}); }} onBack={() => setEditingTeam(null)} positions={getPositionsForDrill(editingTeam)} teamStructure={typedTeamStructure} title="Edit Team" />;
  }

  return (
    <div className="max-w-md mx-auto p-4">
      {showSaveSuccess && <div className="fixed top-20 left-1/2 transform -translate-x-1/2 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-50 text-sm">✓ Session Plan Saved!</div>}
      
      <div className="bg-white rounded-xl shadow-sm border p-3 mb-4">
        <div className="flex items-center gap-3">
          <input type="date" value={selectedDate} onChange={e => onDateChange(e.target.value)} className="flex-1 px-3 py-2 text-sm border rounded-lg" />
          {isToday && <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full font-medium">Today</span>}
        </div>
      </div>

      <button onClick={() => { setTempDefaultTeam(defaultTeam); setEditingDefaultTeam(true); }} className="w-full mb-4 px-4 py-3 bg-white border-2 border-dashed border-gray-300 text-gray-700 rounded-xl hover:border-indigo-400 hover:text-indigo-600 font-medium text-sm flex items-center justify-center gap-2">
        <Users className="w-4 h-4" />Edit Default Team
      </button>
      
      <div className="space-y-2 mb-24">
        {typedDrills.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border p-8 text-center">
            <p className="text-gray-500 text-sm">No drills for this day</p>
            <p className="text-gray-400 text-xs mt-1">Add a drill to get started</p>
          </div>
        ) : (
          typedDrills.map(drill => (
            <div key={drill.id} className="bg-white rounded-xl shadow-sm border overflow-hidden">
              <button onClick={() => setExpandedDrill(expandedDrill === drill.id ? null : drill.id)} className="w-full p-4 flex items-center justify-between hover:bg-gray-50">
                <div className="text-left"><h3 className="font-semibold text-sm">{drill.name}</h3><p className="text-xs text-gray-600">{drill.type}</p></div>
                {expandedDrill === drill.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {expandedDrill === drill.id && (
                <div className="p-4 border-t bg-gray-50 space-y-2 text-sm">
                  <p><span className="text-gray-500">Intensity:</span> {drill.intensity}</p>
                  <p><span className="text-gray-500">Notes:</span> {drill.notes}</p>
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => setEditingTeam(drill)} className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-medium"><Users className="w-4 h-4 inline mr-1" />Edit Team</button>
                    <button onClick={() => setDrills(typedDrills.filter(d => d.id !== drill.id))} className="px-4 py-2 bg-red-50 text-red-600 rounded-lg text-xs font-medium"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
      
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-4">
        <div className="max-w-md mx-auto flex gap-2">
          <button onClick={() => navigateTo('add-drill')} className="flex-1 px-4 py-3 bg-indigo-600 text-white rounded-lg font-medium text-sm"><Plus className="w-4 h-4 inline mr-1" />Add Drill</button>
          <button onClick={handleSave} disabled={typedDrills.length === 0} className={`flex-1 px-4 py-3 rounded-lg font-medium text-sm ${typedDrills.length > 0 ? 'bg-gray-900 text-white' : 'bg-gray-200 text-gray-400'}`}>Save</button>
        </div>
      </div>
    </div>
  );
};

const AddDrillPage = ({ drills, setDrills, navigateTo, drillTypes, defaultTeam, athletes, teamStructure }: any) => {
  const typedDrills: Drill[] = drills;
  const typedDrillTypes: DrillType[] = drillTypes;
  const typedAthletes: Athlete[] = athletes;
  const typedTeamStructure: TeamPosition[] = teamStructure;
  const [name, setName] = useState('');
  const [type, setType] = useState(typedDrillTypes[0]?.name || '');
  const [notes, setNotes] = useState('');
  const [intensity, setIntensity] = useState('Low');
  const [team1, setTeam1] = useState({...defaultTeam.team1});
  const [team2, setTeam2] = useState({...defaultTeam.team2});
  const [subs1, setSubs1] = useState({...defaultTeam.subs1});
  const [subs2, setSubs2] = useState({...defaultTeam.subs2});
  const [showTeamSelection, setShowTeamSelection] = useState(false);

  const getPositionsForDrillType = () => {
    const drillType = drillTypes.find(dt => dt.name === type);
    return drillType ? drillType.positions : teamStructure.map(p => p.number);
  };

  const countSelectedPlayers = () => {
    const t1 = Object.values(team1).filter(Boolean).length;
    const t2 = Object.values(team2).filter(Boolean).length;
    const s1 = Object.values(subs1).filter(Boolean).length;
    const s2 = Object.values(subs2).filter(Boolean).length;
    return t1 + t2 + s1 + s2;
  };

  if (showTeamSelection) {
    return (
      <TeamSelectionModal
        athletes={athletes}
        team1={team1}
        setTeam1={setTeam1}
        team2={team2}
        setTeam2={setTeam2}
        subs1={subs1}
        setSubs1={setSubs1}
        subs2={subs2}
        setSubs2={setSubs2}
        onBack={() => setShowTeamSelection(false)}
        positions={getPositionsForDrillType()}
        teamStructure={teamStructure}
        title="Select Team"
      />
    );
  }

  return (
    <div className="max-w-md mx-auto p-4">
      <div className="bg-white rounded-xl shadow-sm border p-4 space-y-4 mb-20">
        <div><label className="block text-xs font-medium mb-1">Name</label><input type="text" value={name} onChange={e => setName(e.target.value)} className="w-full px-3 py-2 text-sm border rounded-lg" /></div>
        <div><label className="block text-xs font-medium mb-1">Type</label><select value={type} onChange={e => setType(e.target.value)} className="w-full px-3 py-2 text-sm border rounded-lg">{drillTypes.map(dt => <option key={dt.id}>{dt.name}</option>)}</select></div>
        <div><label className="block text-xs font-medium mb-1">Intensity</label><select value={intensity} onChange={e => setIntensity(e.target.value)} className="w-full px-3 py-2 text-sm border rounded-lg"><option>Low</option><option>Medium</option><option>High</option></select></div>
        <div><label className="block text-xs font-medium mb-1">Notes</label><textarea value={notes} onChange={e => setNotes(e.target.value)} className="w-full px-3 py-2 text-sm border rounded-lg" rows={3} /></div>
        <div>
          <label className="block text-xs font-medium mb-1">Team</label>
          <button onClick={() => setShowTeamSelection(true)} className="w-full px-4 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition text-sm font-medium flex items-center justify-center gap-2">
            <Users className="w-4 h-4" />
            {countSelectedPlayers() > 0 ? `${countSelectedPlayers()} players selected` : 'Select Team'}
          </button>
        </div>
      </div>
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-4">
        <div className="flex gap-2">
          <button onClick={() => { if (name) { setDrills([...drills, { id: Date.now(), name, type, notes, intensity, team1, team2, subs1, subs2 }]); navigateTo('session-plan'); }}} className="flex-1 px-4 py-3 bg-gray-900 text-white rounded-lg font-medium text-sm">Save</button>
          <button onClick={() => navigateTo('session-plan')} className="flex-1 px-4 py-3 bg-gray-100 rounded-lg text-sm">Cancel</button>
        </div>
      </div>
    </div>
  );
};

const TeamSelectionModal = ({ athletes, team1, setTeam1, team2, setTeam2, subs1, setSubs1, subs2, setSubs2, onBack, positions, teamStructure, title = "Team Selection" }: any) => {
  const [selectedCell, setSelectedCell] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  const getPosName = n => teamStructure.find(p => p.number === n)?.name || 'Pos ' + n;
  const getAthName = id => athletes.find(a => a.id === id)?.name || 'Select';
  const getStatus = id => athletes.find(a => a.id === id)?.status;

  const getStatusStyle = (id, isSub) => {
    const s = getStatus(id);
    if (!s) return isSub ? 'bg-gray-50 text-gray-400 border-gray-100' : 'bg-gray-100 border-gray-200';
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
      <div className="max-w-md mx-auto p-4">
        <div className="bg-white rounded-xl shadow-sm border">
          <div className="p-4 border-b flex items-center gap-3">
            <button onClick={() => setSelectedCell(null)} className="p-1 hover:bg-gray-100 rounded-lg"><ArrowLeft className="w-5 h-5" /></button>
            <h3 className="font-semibold text-sm">{selectedCell.isSub ? 'Sub for ' : ''}{posName}</h3>
          </div>
          <div className="p-4">
            <input type="text" placeholder="Search..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full px-3 py-2 text-sm border rounded-lg mb-3" />
            <div className="max-h-72 overflow-y-auto">
              <button onClick={() => selectAthlete(null)} className="w-full p-2 text-left bg-gray-50 hover:bg-gray-100 rounded-lg text-sm text-gray-500 mb-2">Clear selection</button>
              
              {matchingPosition.length > 0 && (
                <div className="mb-3">
                  <div className="text-xs font-semibold text-indigo-600 px-2 py-1 bg-indigo-50 rounded mb-1">★ {posName}</div>
                  <div className="space-y-1">{matchingPosition.map(renderAthlete)}</div>
                </div>
              )}
              
              {sameGroupOther.length > 0 && (
                <div className="mb-3">
                  <div className="text-xs font-semibold text-gray-600 px-2 py-1 bg-gray-100 rounded mb-1">Other {posGroup}s</div>
                  <div className="space-y-1">{sameGroupOther.map(renderAthlete)}</div>
                </div>
              )}
              
              {otherGroup.length > 0 && (
                <div className="mb-3">
                  <div className="text-xs font-semibold text-gray-400 px-2 py-1 bg-gray-50 rounded mb-1">{posGroup === 'Forward' ? 'Backs' : 'Forwards'}</div>
                  <div className="space-y-1">{otherGroup.map(renderAthlete)}</div>
                </div>
              )}
              
              {sortedAthletes.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No athletes found</p>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto p-4">
      <div className="bg-white rounded-xl shadow-sm border">
        <div className="p-4 border-b flex items-center gap-3">
          <button onClick={onBack} className="p-1 hover:bg-gray-100 rounded-lg"><ArrowLeft className="w-5 h-5" /></button>
          <h3 className="font-semibold text-sm">{title}</h3>
        </div>
        <div className="p-4 overflow-x-auto">
          <div className="grid grid-cols-5 gap-1 min-w-[400px]">
            <div className="text-xs text-gray-500 text-center pb-2">Team 1</div>
            <div className="text-xs text-gray-500 text-center pb-2">Sub</div>
            <div className="text-xs text-gray-500 text-center pb-2"></div>
            <div className="text-xs text-gray-500 text-center pb-2">Sub</div>
            <div className="text-xs text-gray-500 text-center pb-2">Team 2</div>
            {sorted.map(pos => (
              <React.Fragment key={pos}>
                <button onClick={() => setSelectedCell({ row: pos, team: 1, isSub: false })} className={`p-1.5 text-left rounded text-xs truncate border ${getStatusStyle(team1[pos], false)}`}>{team1[pos] ? getAthName(team1[pos]) : getPosName(pos)}</button>
                <button onClick={() => setSelectedCell({ row: pos, team: 1, isSub: true })} className={`p-1.5 text-left rounded text-xs truncate border ${getStatusStyle(subs1[pos], true)}`}>{subs1[pos] ? getAthName(subs1[pos]) : '-'}</button>
                <div className="flex items-center justify-center text-xs text-gray-400">{pos}</div>
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
          <button onClick={onBack} className="w-full px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium">Done</button>
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
    <div className="bg-white rounded-xl shadow-sm border p-4">
      <h3 className="font-semibold text-sm mb-3">Availability Report</h3>
      <div className="flex flex-wrap gap-2 mb-4">
        <button onClick={() => setSelectedPeriod('all')} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${selectedPeriod === 'all' ? 'bg-indigo-600 text-white' : 'bg-gray-100'}`}>All Time</button>
        {seasonDates.map(p => <button key={p.id} onClick={() => setSelectedPeriod(p.id.toString())} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${selectedPeriod === p.id.toString() ? 'bg-indigo-600 text-white' : 'bg-gray-100'}`}>{p.title}</button>)}
      </div>
      {stats.total === 0 ? <p className="text-center py-6 text-gray-500 text-sm">No data.</p> : (
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
          <p className="text-xs text-gray-400 mt-2">{stats.total} days</p>
        </>
      )}
    </div>
  );
};

const ReportingPage = ({ athletes, availabilityRecords, seasonDates, teamStructure }: any) => {
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

  // Get unique position names from assigned positions
  const uniquePositionNames = useMemo(() => {
    const names = new Map();
    assignedPositions.forEach((posNum: number) => {
      const pos = teamStructure.find((p: any) => p.number === posNum);
      if (pos && !names.has(pos.name)) {
        names.set(pos.name, { name: pos.name, numbers: [], group: pos.group });
      }
      if (pos) {
        names.get(pos.name).numbers.push(posNum);
      }
    });
    return Array.from(names.values());
  }, [assignedPositions, teamStructure]);

  // Toggle all positions with a given name
  const togglePositionName = (posName) => {
    const posData = uniquePositionNames.find(p => p.name === posName);
    if (!posData) return;
    const allSelected = posData.numbers.every(n => selectedPositions.includes(n));
    if (allSelected) {
      setSelectedPositions(prev => prev.filter(p => !posData.numbers.includes(p)));
    } else {
      setSelectedPositions(prev => [...new Set([...prev, ...posData.numbers])]);
    }
  };

  // Toggle all positions in a group
  const toggleGroup = (group) => {
    const groupPositions = teamStructure.filter(p => p.group === group).map(p => p.number);
    const assignedGroupPositions = groupPositions.filter(p => assignedPositions.includes(p));
    
    if (selectedGroups.includes(group)) {
      setSelectedGroups(prev => prev.filter(g => g !== group));
      setSelectedPositions(prev => prev.filter(p => !assignedGroupPositions.includes(p)));
    } else {
      setSelectedGroups(prev => [...prev, group]);
      setSelectedPositions(prev => [...new Set([...prev, ...assignedGroupPositions])]);
    }
  };

  const dateRange = useMemo(() => {
    if (dateMode === 'custom' && customFrom && customTo) return { from: customFrom, to: customTo };
    if (dateMode === 'period' && selectedPeriodId) { const p = seasonDates.find(sd => sd.id.toString() === selectedPeriodId); if (p) return { from: p.fromDate, to: p.toDate }; }
    if (availabilityRecords.length > 0) { const dates = availabilityRecords.map(r => r.date).sort(); return { from: dates[0], to: dates[dates.length - 1] }; }
    return null;
  }, [dateMode, selectedPeriodId, customFrom, customTo, seasonDates, availabilityRecords]);

  const filteredAthleteIds = useMemo(() => selectedAthleteIds.filter(id => { const a = athletes.find(x => x.id === id); return a?.positionNumbers && (selectedPositions.length === 0 || a.positionNumbers.some(p => selectedPositions.includes(p))); }), [selectedAthleteIds, selectedPositions, athletes]);

  const chartData = useMemo(() => {
    if (!dateRange || filteredAthleteIds.length === 0) return [];
    const dates = [];
    for (let d = new Date(dateRange.from); d <= new Date(dateRange.to); d.setDate(d.getDate() + 1)) dates.push(new Date(d).toISOString().split('T')[0]);
    return dates.map(date => {
      const recs = availabilityRecords.filter(r => r.date === date && filteredAthleteIds.includes(r.athleteId));
      if (recs.length === 0) return null;
      const t = filteredAthleteIds.length;
      return { date, available: Math.round((recs.filter(r => r.status === 'Available').length / t) * 100), modified: Math.round((recs.filter(r => r.status === 'Modified').length / t) * 100), unavailable: Math.round((recs.filter(r => r.status === 'Unavailable').length / t) * 100) };
    }).filter(Boolean);
  }, [dateRange, filteredAthleteIds, availabilityRecords]);

  const W = 300, H = 160, pad = { top: 20, right: 20, bottom: 30, left: 35 };
  const iW = W - pad.left - pad.right, iH = H - pad.top - pad.bottom;
  const path = (data, key) => data.length < 2 ? '' : data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${pad.left + (i / (data.length - 1)) * iW} ${pad.top + iH - (d[key] / 100) * iH}`).join(' ');

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <div className="bg-white rounded-xl shadow-sm border p-4">
        <h3 className="font-semibold text-sm mb-3">Time Period</h3>
        <div className="flex flex-wrap gap-2 mb-3">
          <button onClick={() => setDateMode('all')} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${dateMode === 'all' ? 'bg-indigo-600 text-white' : 'bg-gray-100'}`}>All Time</button>
          {seasonDates.map(p => <button key={p.id} onClick={() => { setDateMode('period'); setSelectedPeriodId(p.id.toString()); }} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${dateMode === 'period' && selectedPeriodId === p.id.toString() ? 'bg-indigo-600 text-white' : 'bg-gray-100'}`}>{p.title}</button>)}
          <button onClick={() => setDateMode('custom')} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${dateMode === 'custom' ? 'bg-indigo-600 text-white' : 'bg-gray-100'}`}>Custom</button>
        </div>
        {dateMode === 'custom' && <div className="grid grid-cols-2 gap-2"><input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="px-3 py-2 text-sm border rounded-lg" /><input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="px-3 py-2 text-sm border rounded-lg" /></div>}
      </div>
      <div className="bg-white rounded-xl shadow-sm border p-4">
        <button onClick={() => setShowFilters(!showFilters)} className="w-full flex justify-between items-center"><h3 className="font-semibold text-sm">Filters</h3>{showFilters ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</button>
        {showFilters && (
          <div className="mt-3 space-y-3">
            <div>
              <p className="text-xs text-gray-500 mb-2">Position Group</p>
              <div className="flex gap-2">
                <button onClick={() => toggleGroup('Forward')} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${selectedGroups.includes('Forward') ? 'bg-indigo-600 text-white' : 'bg-gray-100'}`}>Forwards</button>
                <button onClick={() => toggleGroup('Back')} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${selectedGroups.includes('Back') ? 'bg-indigo-600 text-white' : 'bg-gray-100'}`}>Backs</button>
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-2">Positions</p>
              <div className="flex flex-wrap gap-1">
                {uniquePositionNames.map(pos => {
                  const allSelected = pos.numbers.every(n => selectedPositions.includes(n));
                  return (
                    <button key={pos.name} onClick={() => togglePositionName(pos.name)} className={`px-2 py-1 rounded text-xs ${allSelected ? 'bg-indigo-600 text-white' : 'bg-gray-100'}`}>
                      {pos.name}
                    </button>
                  );
                })}
              </div>
            </div>
            <div><p className="text-xs text-gray-500 mb-2">Athletes ({selectedAthleteIds.length}/{athletes.length})</p><div className="space-y-1 max-h-32 overflow-y-auto">{athletes.map(a => <label key={a.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selectedAthleteIds.includes(a.id)} onChange={() => setSelectedAthleteIds(p => p.includes(a.id) ? p.filter(x => x !== a.id) : [...p, a.id])} className="w-4 h-4" />{a.name}</label>)}</div></div>
          </div>
        )}
      </div>
      <div className="bg-white rounded-xl shadow-sm border p-4">
        <h3 className="font-semibold text-sm mb-3">Availability Over Time</h3>
        <div className="flex flex-wrap gap-2 mb-3">
          <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" checked={showAvailable} onChange={e => setShowAvailable(e.target.checked)} className="w-3 h-3" /><div className="w-2.5 h-2.5 rounded bg-green-500"></div>Available</label>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" checked={showModified} onChange={e => setShowModified(e.target.checked)} className="w-3 h-3" /><div className="w-2.5 h-2.5 rounded bg-amber-500"></div>Modified</label>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" checked={showUnavailable} onChange={e => setShowUnavailable(e.target.checked)} className="w-3 h-3" /><div className="w-2.5 h-2.5 rounded bg-red-500"></div>Unavailable</label>
        </div>
        {chartData.length === 0 ? <p className="text-center py-8 text-gray-500 text-sm">No data.</p> : (
          <svg width={W} height={H} className="w-full h-auto">
            {[0, 50, 100].map(v => <g key={v}><line x1={pad.left} y1={pad.top + iH - (v / 100) * iH} x2={W - pad.right} y2={pad.top + iH - (v / 100) * iH} stroke="#e5e7eb" strokeDasharray="4,4" /><text x={pad.left - 5} y={pad.top + iH - (v / 100) * iH + 4} textAnchor="end" className="text-xs fill-gray-400">{v}%</text></g>)}
            {showAvailable && <path d={path(chartData, 'available')} fill="none" stroke="#22c55e" strokeWidth="2" />}
            {showModified && <path d={path(chartData, 'modified')} fill="none" stroke="#f59e0b" strokeWidth="2" />}
            {showUnavailable && <path d={path(chartData, 'unavailable')} fill="none" stroke="#ef4444" strokeWidth="2" />}
            {showAvailable && chartData.map((d, i) => <circle key={'a'+i} cx={pad.left + (i / Math.max(chartData.length - 1, 1)) * iW} cy={pad.top + iH - (d.available / 100) * iH} r="3" fill="#22c55e" />)}
            {showModified && chartData.map((d, i) => <circle key={'m'+i} cx={pad.left + (i / Math.max(chartData.length - 1, 1)) * iW} cy={pad.top + iH - (d.modified / 100) * iH} r="3" fill="#f59e0b" />)}
            {showUnavailable && chartData.map((d, i) => <circle key={'u'+i} cx={pad.left + (i / Math.max(chartData.length - 1, 1)) * iW} cy={pad.top + iH - (d.unavailable / 100) * iH} r="3" fill="#ef4444" />)}
          </svg>
        )}
        <p className="text-xs text-gray-400 text-center mt-2">{chartData.length} days • {filteredAthleteIds.length} athletes</p>
      </div>
    </div>
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
    <div className="max-w-md mx-auto p-4 space-y-3">
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <button onClick={() => setExpanded(expanded === 'teamStructure' ? null : 'teamStructure')} className="w-full p-4 flex justify-between items-center hover:bg-gray-50">
          <div><h3 className="font-semibold text-sm text-left">Team Structure</h3><p className="text-xs text-gray-500">{teamStructure.length} positions</p></div>
          {expanded === 'teamStructure' ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </button>
        {expanded === 'teamStructure' && (
          <div className="border-t">
            {['Forward', 'Back'].map(group => (
              <div key={group}>
                <div className="px-4 py-2 bg-gray-50 text-xs font-semibold text-gray-600">{group}s</div>
                {teamStructure.filter(p => p.group === group).map(pos => (
                  <div key={pos.id} className="p-3 border-b last:border-b-0">
                    {editingId === pos.id ? (
                      <div className="space-y-2">
                        <div className="flex gap-2"><input type="number" value={editData.number || ''} onChange={e => setEditData({...editData, number: e.target.value})} className="w-16 px-2 py-1 text-sm border rounded" placeholder="#" /><input type="text" value={editData.name || ''} onChange={e => setEditData({...editData, name: e.target.value})} className="flex-1 px-2 py-1 text-sm border rounded" placeholder="Name" /></div>
                        <select value={editData.group || 'Forward'} onChange={e => setEditData({...editData, group: e.target.value})} className="w-full px-2 py-1 text-sm border rounded"><option>Forward</option><option>Back</option></select>
                        <div className="flex gap-2"><button onClick={() => { setLocalTeamStructure(teamStructure.map(p => p.id === pos.id ? {...p, number: parseInt(editData.number), name: editData.name, group: editData.group} : p).sort((a,b) => a.number - b.number)); setEditingId(null); }} className="flex-1 px-2 py-1 bg-green-100 text-green-700 rounded text-xs">Save</button><button onClick={() => setEditingId(null)} className="flex-1 px-2 py-1 bg-gray-100 rounded text-xs">Cancel</button></div>
                      </div>
                    ) : (
                      <div className="flex justify-between items-center">
                        <span className="text-sm">{pos.number}. {pos.name}</span>
                        <div className="flex gap-1"><button onClick={() => { setEditingId(pos.id); setEditData({number: pos.number, name: pos.name, group: pos.group}); }} className="p-1 hover:bg-gray-100 rounded"><Edit2 className="w-4 h-4 text-gray-500" /></button><button onClick={() => setLocalTeamStructure(teamStructure.filter(p => p.id !== pos.id))} className="p-1 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4 text-red-500" /></button></div>
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
                <div className="flex gap-2"><button onClick={() => { if (newData.name && newData.number) { setLocalTeamStructure([...teamStructure, {id: Date.now(), number: parseInt(newData.number), name: newData.name, group: newData.group || 'Forward'}].sort((a,b) => a.number - b.number)); setNewData({}); setShowAdd(null); }}} className="flex-1 px-2 py-1 bg-green-100 text-green-700 rounded text-xs">Add</button><button onClick={() => { setShowAdd(null); setNewData({}); }} className="flex-1 px-2 py-1 bg-gray-100 rounded text-xs">Cancel</button></div>
              </div>
            ) : <div className="p-3 border-t"><button onClick={() => setShowAdd('position')} className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium"><Plus className="w-4 h-4 inline mr-1" />Add Position</button></div>}
          </div>
        )}
      </div>
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <button onClick={() => setExpanded(expanded === 'drillTypes' ? null : 'drillTypes')} className="w-full p-4 flex justify-between items-center hover:bg-gray-50">
          <div><h3 className="font-semibold text-sm text-left">Drill Types</h3><p className="text-xs text-gray-500">{drillTypes.length} types</p></div>
          {expanded === 'drillTypes' ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </button>
        {expanded === 'drillTypes' && (
          <div className="border-t divide-y">
            {drillTypes.map(dt => (
              <div key={dt.id} className="p-3">
                {editingId === 'dt-' + dt.id ? (
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <input type="text" value={editData.name || ''} onChange={e => setEditData({...editData, name: e.target.value})} className="flex-1 px-2 py-1 text-sm border rounded" />
                      <button onClick={() => { setLocalDrillTypes(drillTypes.map(d => d.id === dt.id ? {...d, name: editData.name, positions: editData.positions || d.positions} : d)); setEditingId(null); }} className="p-1 bg-green-100 text-green-700 rounded"><Check className="w-4 h-4" /></button>
                      <button onClick={() => setEditingId(null)} className="p-1 bg-gray-100 rounded"><X className="w-4 h-4" /></button>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-2">Position Group:</p>
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
                            }} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${allSelected ? 'bg-indigo-600 text-white' : 'bg-gray-100'}`}>
                              {group}s
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-xs text-gray-500 mb-2">Positions:</p>
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
                              }} className={`px-2 py-1 rounded text-xs ${(editData.positions || dt.positions || []).includes(pos.number) ? 'bg-indigo-600 text-white' : 'bg-gray-100'}`}>
                                {pos.number}. {pos.name}
                              </button>
                            ))}
                          </React.Fragment>
                        ))}
                      </div>
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => setEditData({...editData, positions: teamStructure.map(p => p.number)})} className="text-xs text-indigo-600">Select All</button>
                        <button onClick={() => setEditData({...editData, positions: []})} className="text-xs text-gray-500">Clear All</button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm font-medium">{dt.name}</p>
                      <p className="text-xs text-gray-500">{dt.positions.length} positions</p>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => { setEditingId('dt-' + dt.id); setEditData({name: dt.name, positions: dt.positions}); }} className="p-1 hover:bg-gray-100 rounded"><Edit2 className="w-4 h-4 text-gray-500" /></button>
                      <button onClick={() => setLocalDrillTypes(drillTypes.filter(d => d.id !== dt.id))} className="p-1 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4 text-red-500" /></button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {showAdd === 'drillType' ? (
              <div className="p-3 space-y-3">
                <div className="flex gap-2">
                  <input type="text" value={newData.name || ''} onChange={e => setNewData({...newData, name: e.target.value})} placeholder="Type name" className="flex-1 px-2 py-1 text-sm border rounded" />
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-2">Position Group:</p>
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
                        }} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${allSelected ? 'bg-indigo-600 text-white' : 'bg-gray-100'}`}>
                          {group}s
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-gray-500 mb-2">Positions:</p>
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
                          }} className={`px-2 py-1 rounded text-xs ${(newData.positions || teamStructure.map(p => p.number)).includes(pos.number) ? 'bg-indigo-600 text-white' : 'bg-gray-100'}`}>
                            {pos.number}. {pos.name}
                          </button>
                        ))}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { if (newData.name) { setLocalDrillTypes([...drillTypes, {id: Date.now(), name: newData.name, positions: newData.positions || teamStructure.map(p => p.number)}]); setNewData({}); setShowAdd(null); }}} className="flex-1 px-2 py-1 bg-green-100 text-green-700 rounded text-xs">Add</button>
                  <button onClick={() => { setShowAdd(null); setNewData({}); }} className="flex-1 px-2 py-1 bg-gray-100 rounded text-xs">Cancel</button>
                </div>
              </div>
            ) : <div className="p-3"><button onClick={() => setShowAdd('drillType')} className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium"><Plus className="w-4 h-4 inline mr-1" />Add Drill Type</button></div>}
          </div>
        )}
      </div>
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <button onClick={() => setExpanded(expanded === 'seasonDates' ? null : 'seasonDates')} className="w-full p-4 flex justify-between items-center hover:bg-gray-50">
          <div><h3 className="font-semibold text-sm text-left">Season Dates</h3><p className="text-xs text-gray-500">{seasonDates.length} periods</p></div>
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
                    <div className="flex gap-2"><button onClick={() => { let upd = seasonDates; if (editData.isDefault) upd = seasonDates.map(s => ({...s, isDefault: false})); setLocalSeasonDates(upd.map(s => s.id === sd.id ? {...s, ...editData} : s)); setEditingId(null); }} className="flex-1 px-2 py-1 bg-green-100 text-green-700 rounded text-xs">Save</button><button onClick={() => setEditingId(null)} className="flex-1 px-2 py-1 bg-gray-100 rounded text-xs">Cancel</button></div>
                  </div>
                ) : (
                  <div className="flex justify-between items-center">
                    <div><div className="flex items-center gap-2"><p className="text-sm font-medium">{sd.title}</p>{sd.isDefault && <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs rounded-full">Default</span>}</div><p className="text-xs text-gray-500">{fmtDate(sd.fromDate)} - {fmtDate(sd.toDate)}</p></div>
                    <div className="flex gap-1"><button onClick={() => setLocalSeasonDates(seasonDates.map(s => ({...s, isDefault: s.id === sd.id ? !s.isDefault : false})))} className={`p-1 rounded ${sd.isDefault ? 'bg-indigo-50 text-indigo-600' : 'hover:bg-gray-100 text-gray-500'}`}><Target className="w-4 h-4" /></button><button onClick={() => { setEditingId('sd-' + sd.id); setEditData({title: sd.title, fromDate: sd.fromDate, toDate: sd.toDate, isDefault: sd.isDefault}); }} className="p-1 hover:bg-gray-100 rounded"><Edit2 className="w-4 h-4 text-gray-500" /></button><button onClick={() => setLocalSeasonDates(seasonDates.filter(s => s.id !== sd.id))} className="p-1 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4 text-red-500" /></button></div>
                  </div>
                )}
              </div>
            ))}
            {showAdd === 'seasonDate' ? (
              <div className="p-3 space-y-2">
                <input type="text" value={newData.title || ''} onChange={e => setNewData({...newData, title: e.target.value})} className="w-full px-2 py-1 text-sm border rounded" placeholder="Title" />
                <div className="grid grid-cols-2 gap-2"><input type="date" value={newData.fromDate || ''} onChange={e => setNewData({...newData, fromDate: e.target.value})} className="px-2 py-1 text-sm border rounded" /><input type="date" value={newData.toDate || ''} onChange={e => setNewData({...newData, toDate: e.target.value})} className="px-2 py-1 text-sm border rounded" /></div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={newData.isDefault || false} onChange={e => setNewData({...newData, isDefault: e.target.checked})} />Default</label>
                <div className="flex gap-2"><button onClick={() => { if (newData.title && newData.fromDate && newData.toDate) { let upd = seasonDates; if (newData.isDefault) upd = seasonDates.map(s => ({...s, isDefault: false})); setLocalSeasonDates([...upd, {id: Date.now(), ...newData}]); setNewData({}); setShowAdd(null); }}} className="flex-1 px-2 py-1 bg-green-100 text-green-700 rounded text-xs">Add</button><button onClick={() => { setShowAdd(null); setNewData({}); }} className="flex-1 px-2 py-1 bg-gray-100 rounded text-xs">Cancel</button></div>
              </div>
            ) : <div className="p-3"><button onClick={() => setShowAdd('seasonDate')} className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium"><Plus className="w-4 h-4 inline mr-1" />Add Time Period</button></div>}
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
  const [injuryData, setInjuryData] = useState({ bodyPart: 'Head', startDate: '', returnDate: '', notes: '' });

  if (!athlete) return <div className="max-w-md mx-auto p-4"><div className="bg-white rounded-xl shadow-sm border p-6 text-center"><p>Athlete not found</p><button onClick={() => navigateTo('availability')} className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm">Back</button></div></div>;

  const genAvatar = (n: string) => { if (!n) return ''; const p = n.trim().split(' '); return p.length >= 2 ? p[0][0].toUpperCase() + p[p.length-1][0].toUpperCase() : n.substring(0,2).toUpperCase(); };
  const handleSave = async () => { 
    await onSave({...athlete, name, positionNumbers, photo, avatar: genAvatar(name), injuries}); 
    setShowSaveSuccess(true); 
    setTimeout(() => setShowSaveSuccess(false), 2000); 
  };

  const uniqueNames = [...new Set(teamStructure.map(p => p.name))];
  const selectedNames = [...new Set(positionNumbers.map(n => teamStructure.find(p => p.number === n)?.name).filter(Boolean))];
  const today = new Date().toISOString().split('T')[0];
  const activeInjuries = injuries.filter(i => !i.returnDate || i.returnDate >= today);
  const pastInjuries = injuries.filter(i => i.returnDate && i.returnDate < today);

  const saveInjury = () => {
    if (injuryData.bodyPart && injuryData.startDate) {
      if (editingInjuryId) setInjuries(injuries.map(i => i.id === editingInjuryId ? {...i, ...injuryData} : i));
      else setInjuries([...injuries, {id: Date.now(), ...injuryData}]);
      setInjuryData({ bodyPart: 'Head', startDate: '', returnDate: '', notes: '' });
      setEditingInjuryId(null);
      setShowAddInjury(false);
    }
  };

  return (
    <div className="max-w-md mx-auto p-4">
      {showSaveSuccess && <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-50 text-sm">✓ Saved!</div>}
      <div className="space-y-4 mb-20">
        <div className="bg-white rounded-xl shadow-sm border p-4 space-y-4">
          <div className="flex justify-center">
            <div className="relative">
              {photo ? <img src={photo} alt="" className="w-24 h-24 rounded-full object-cover border-4 border-gray-200" /> : <div className="w-24 h-24 bg-gray-200 rounded-full flex items-center justify-center font-bold text-2xl border-4 border-gray-200">{genAvatar(name) || <User className="w-10 h-10 text-gray-400" />}</div>}
              <label className="absolute bottom-0 right-0 w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center cursor-pointer hover:bg-indigo-700">
                <Camera className="w-4 h-4 text-white" />
                <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) { const r = new FileReader(); r.onloadend = () => setPhoto(r.result); r.readAsDataURL(f); }}} />
              </label>
            </div>
          </div>
          <div><label className="block text-xs font-medium mb-1">Name</label><input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Name" className="w-full px-3 py-2 text-sm border rounded-lg" /></div>
          <div>
            <label className="block text-xs font-medium mb-1">Positions</label>
            <button onClick={() => setShowPositionPicker(!showPositionPicker)} className="w-full px-3 py-2 text-sm border rounded-lg text-left flex justify-between items-center">
              <span className={selectedNames.length > 0 ? '' : 'text-gray-400'}>{selectedNames.length > 0 ? selectedNames.join(', ') : 'Select positions...'}</span>
              {showPositionPicker ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {showPositionPicker && (
              <div className="mt-2 p-3 bg-gray-50 rounded-lg border">
                {['Forward', 'Back'].map(group => (
                  <div key={group} className="mb-3 last:mb-0">
                    <p className="text-xs font-semibold text-gray-500 mb-2">{group}s</p>
                    <div className="flex flex-wrap gap-2">
                      {uniqueNames.filter(pn => teamStructure.find(p => p.name === pn && p.group === group)).map(pn => {
                        const nums = teamStructure.filter(p => p.name === pn).map(p => p.number);
                        const sel = nums.some(n => positionNumbers.includes(n));
                        return <button key={pn} onClick={() => { if (sel) setPositionNumbers(positionNumbers.filter(n => !nums.includes(n))); else setPositionNumbers([...new Set([...positionNumbers, ...nums])].sort((a,b) => a - b)); }} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${sel ? 'bg-indigo-600 text-white' : 'bg-white border hover:bg-gray-100'}`}>{pn}</button>;
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {positionNumbers.length > 0 && <p className="text-xs text-gray-500">Group: {getPositionGroup(positionNumbers, teamStructure)}</p>}
          <button onClick={() => { if (window.confirm('Delete?')) { setAthletes(athletes.filter(a => a.id !== athleteId)); navigateTo('availability'); }}} className="w-full px-4 py-2 bg-red-50 text-red-600 rounded-lg text-sm font-medium">Delete Athlete</button>
        </div>

        <div className="bg-white rounded-xl shadow-sm border p-4">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-semibold text-sm">Injuries</h3>
            {!showAddInjury && <button onClick={() => { setShowAddInjury(true); setEditingInjuryId(null); setInjuryData({ bodyPart: 'Head', startDate: today, returnDate: '', notes: '' }); }} className="text-xs text-indigo-600 font-medium">+ Add</button>}
          </div>
          {showAddInjury && (
            <div className="mb-4 p-3 bg-gray-50 rounded-lg space-y-3">
              <div><label className="block text-xs text-gray-500 mb-1">Body Part</label><select value={injuryData.bodyPart} onChange={e => setInjuryData({...injuryData, bodyPart: e.target.value})} className="w-full px-3 py-2 text-sm border rounded-lg">{BODY_PARTS.map(bp => <option key={bp}>{bp}</option>)}</select></div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="block text-xs text-gray-500 mb-1">Start Date</label><input type="date" value={injuryData.startDate} onChange={e => setInjuryData({...injuryData, startDate: e.target.value})} className="w-full px-3 py-2 text-sm border rounded-lg" /></div>
                <div><label className="block text-xs text-gray-500 mb-1">Est. Return</label><input type="date" value={injuryData.returnDate} onChange={e => setInjuryData({...injuryData, returnDate: e.target.value})} className="w-full px-3 py-2 text-sm border rounded-lg" /></div>
              </div>
              <div><label className="block text-xs text-gray-500 mb-1">Notes</label><textarea value={injuryData.notes} onChange={e => setInjuryData({...injuryData, notes: e.target.value})} className="w-full px-3 py-2 text-sm border rounded-lg" rows="2" /></div>
              <div className="flex gap-2"><button onClick={saveInjury} className="flex-1 px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium">{editingInjuryId ? 'Update' : 'Add'}</button><button onClick={() => { setShowAddInjury(false); setEditingInjuryId(null); }} className="flex-1 px-3 py-2 bg-gray-100 rounded-lg text-sm">Cancel</button></div>
            </div>
          )}
          {activeInjuries.length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-gray-500 mb-2">Active</p>
              {activeInjuries.map(inj => (
                <div key={inj.id} className="flex items-start justify-between p-2 bg-red-50 rounded-lg mb-2 border border-red-100">
                  <div>
                    <p className="text-sm font-medium text-red-800">{inj.bodyPart}</p>
                    <p className="text-xs text-red-600">Since {new Date(inj.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{inj.returnDate ? ` • ETR: ${new Date(inj.returnDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}</p>
                    {inj.notes && <p className="text-xs text-red-700 mt-1">{inj.notes}</p>}
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => { setInjuryData({ bodyPart: inj.bodyPart, startDate: inj.startDate, returnDate: inj.returnDate || '', notes: inj.notes || '' }); setEditingInjuryId(inj.id); setShowAddInjury(true); }} className="p-1 hover:bg-red-100 rounded"><Edit2 className="w-3 h-3 text-red-600" /></button>
                    <button onClick={() => setInjuries(injuries.filter(i => i.id !== inj.id))} className="p-1 hover:bg-red-100 rounded"><Trash2 className="w-3 h-3 text-red-600" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {pastInjuries.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 mb-2">History</p>
              {pastInjuries.map(inj => (
                <div key={inj.id} className="flex items-start justify-between p-2 bg-gray-50 rounded-lg mb-2">
                  <div>
                    <p className="text-sm font-medium text-gray-700">{inj.bodyPart}</p>
                    <p className="text-xs text-gray-500">{new Date(inj.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {new Date(inj.returnDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                    {inj.notes && <p className="text-xs text-gray-600 mt-1">{inj.notes}</p>}
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => { setInjuryData({ bodyPart: inj.bodyPart, startDate: inj.startDate, returnDate: inj.returnDate || '', notes: inj.notes || '' }); setEditingInjuryId(inj.id); setShowAddInjury(true); }} className="p-1 hover:bg-gray-100 rounded"><Edit2 className="w-3 h-3 text-gray-500" /></button>
                    <button onClick={() => setInjuries(injuries.filter(i => i.id !== inj.id))} className="p-1 hover:bg-gray-100 rounded"><Trash2 className="w-3 h-3 text-gray-500" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {injuries.length === 0 && !showAddInjury && <p className="text-sm text-gray-400 text-center py-4">No injuries recorded</p>}
        </div>
        <AvailabilityChart athleteId={athleteId} availabilityRecords={availabilityRecords} seasonDates={seasonDates} />
      </div>
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-4">
        <div className="max-w-md mx-auto flex gap-2">
          <button onClick={handleSave} className="flex-1 px-4 py-3 bg-gray-900 text-white rounded-lg font-medium text-sm">Save</button>
          <button onClick={() => navigateTo('availability')} className="flex-1 px-4 py-3 bg-gray-100 rounded-lg text-sm">Cancel</button>
        </div>
      </div>
    </div>
  );
};

export default AthleteManager;
