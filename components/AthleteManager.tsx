'use client';

import React, { useEffect, useState } from 'react';
import { Search, Plus, Menu, MessageSquare, X, ChevronDown, ChevronUp, Users, Calendar, Zap, Target } from 'lucide-react';
import { supabase } from '@/lib/supabase';

// ── Types ────────────────────────────────────────────────────────────────────

type Status = 'Available' | 'Modified' | 'Unavailable';

interface Athlete {
  id: string;
  name: string;
  status: Status;
  notes: string;
  is_public: boolean;
  avatar: string;
  photo_url: string;
  created_at?: string;
  updated_at?: string;
}

interface Drill {
  id: number;
  name: string;
  type: string;
  notes: string;
  intensity: string;
  team1: Record<string, string>;
  team2: Record<string, string>;
}

type NewAthlete = Omit<Athlete, 'id' | 'created_at' | 'updated_at'>;

// ── Helpers ──────────────────────────────────────────────────────────────────

const getInitials = (name: string) =>
  name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);

const statusColour: Record<Status, string> = {
  Available: 'bg-green-500',
  Modified: 'bg-amber-500',
  Unavailable: 'bg-red-500',
};

const emptyForm = (): NewAthlete => ({
  name: '',
  status: 'Available',
  notes: '',
  is_public: false,
  avatar: '',
  photo_url: '',
});

// ── Root Component ────────────────────────────────────────────────────────────

const AthleteManager = () => {
  const [currentPage, setCurrentPage] = useState('home');
  const [showMenu, setShowMenu] = useState(false);
  const [selectedAthleteId, setSelectedAthleteId] = useState<string | null>(null);

  // Athletes — loaded from Supabase
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [athletesLoading, setAthletesLoading] = useState(true);

  // Drills — local state (extend to Supabase later if needed)
  const [drills, setDrills] = useState<Drill[]>([
    { id: 1, name: 'Passing Drill', type: 'Technical', notes: 'Focus on short passes', intensity: 'Medium', team1: {}, team2: {} }
  ]);

  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 2500);
  };

  // ── Fetch athletes from Supabase ──────────────────────────────────────────

  const fetchAthletes = async () => {
    setAthletesLoading(true);
    const { data, error } = await supabase.from('athletes').select('*').order('name');
    if (error) {
      setError('Failed to load athletes: ' + error.message);
    } else {
      setAthletes(data as Athlete[]);
    }
    setAthletesLoading(false);
  };

  useEffect(() => { fetchAthletes(); }, []);

  const navigateTo = (page: string) => {
    setCurrentPage(page);
    setShowMenu(false);
  };

  const pageTitle: Record<string, string> = {
    home: 'Home',
    availability: 'Availability',
    'session-plan': 'Session Plan',
    'add-drill': 'Create Drill',
    'athlete-profile': 'Athlete Profile',
  };

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── Header ── */}
      <div className="bg-white shadow-sm sticky top-0 z-10 border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between max-w-md mx-auto">
          <button onClick={() => setShowMenu(!showMenu)} className="p-2 hover:bg-gray-100 rounded-lg transition">
            <Menu className="w-5 h-5 text-gray-700" />
          </button>
          <h1 className="text-lg font-semibold text-gray-900">{pageTitle[currentPage] ?? 'Team'}</h1>
          <div className="w-9" />
        </div>
      </div>

      {/* ── Slide-out menu ── */}
      {showMenu && (
        <div className="fixed inset-0 bg-black/20 z-20" onClick={() => setShowMenu(false)}>
          <div className="bg-white w-64 h-full shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Menu</h2>
            </div>
            <div className="p-2">
              {[
                { page: 'home', label: 'Home', Icon: Target },
                { page: 'availability', label: 'Availability', Icon: Calendar },
                { page: 'session-plan', label: 'Session Plan', Icon: Zap },
              ].map(({ page, label, Icon }) => (
                <button key={page} onClick={() => navigateTo(page)}
                  className={`w-full text-left px-4 py-3 rounded-lg transition flex items-center gap-3 ${currentPage === page ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-gray-700 hover:bg-gray-100'}`}>
                  <Icon className="w-5 h-5" />{label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Global toast ── */}
      {successMsg && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-50 text-sm font-medium">
          ✓ {successMsg}
        </div>
      )}
      {error && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg z-50 text-sm font-medium cursor-pointer" onClick={() => setError(null)}>
          ✕ {error}
        </div>
      )}

      {/* ── Pages ── */}
      {currentPage === 'home' && (
        <HomePage athletes={athletes} loading={athletesLoading} navigateTo={navigateTo} setSelectedAthleteId={setSelectedAthleteId} />
      )}
      {currentPage === 'availability' && (
        <AvailabilityPage
          athletes={athletes}
          setAthletes={setAthletes}
          navigateTo={navigateTo}
          setSelectedAthleteId={setSelectedAthleteId}
          fetchAthletes={fetchAthletes}
          showSuccess={showSuccess}
          setError={setError}
        />
      )}
      {currentPage === 'session-plan' && (
        <SessionPlanPage drills={drills} setDrills={setDrills} navigateTo={navigateTo} athletes={athletes} />
      )}
      {currentPage === 'add-drill' && (
        <AddDrillPage drills={drills} setDrills={setDrills} athletes={athletes} navigateTo={navigateTo} />
      )}
      {currentPage === 'athlete-profile' && (
        <AthleteProfilePage
          athletes={athletes}
          setAthletes={setAthletes}
          athleteId={selectedAthleteId}
          navigateTo={navigateTo}
          fetchAthletes={fetchAthletes}
          showSuccess={showSuccess}
          setError={setError}
        />
      )}
    </div>
  );
};

// ── Home Page ─────────────────────────────────────────────────────────────────

const HomePage = ({ athletes, loading, navigateTo, setSelectedAthleteId }: {
  athletes: Athlete[];
  loading: boolean;
  navigateTo: (p: string) => void;
  setSelectedAthleteId: (id: string) => void;
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [availableOnly, setAvailableOnly] = useState(false);
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' });

  const filtered = athletes.filter(a =>
    a.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
    (!availableOnly || a.status === 'Available' || a.status === 'Modified')
  );

  return (
    <div className="max-w-md mx-auto p-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4">
        <p className="text-sm text-gray-600 mb-3">{today}</p>
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
          <input type="text" placeholder="Search athletes..." value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" />
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={availableOnly} onChange={(e) => setAvailableOnly(e.target.checked)}
            className="w-4 h-4 text-indigo-600 rounded border-gray-300" />
          <span className="text-sm text-gray-700">Available Only</span>
        </label>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500 text-sm">Loading athletes…</div>
      ) : (
        <div className="space-y-2 mb-4">
          {filtered.map(a => (
            <div key={a.id}
              className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 hover:shadow-md transition cursor-pointer"
              onClick={() => { setSelectedAthleteId(a.id); navigateTo('athlete-profile'); }}>
              <div className="flex items-center gap-3">
                <div className={`w-2.5 h-2.5 rounded-full ${statusColour[a.status]}`} />
                {a.photo_url ? (
                  <img src={a.photo_url} alt={a.name} className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center text-gray-700 font-semibold text-xs">
                    {a.avatar || getInitials(a.name)}
                  </div>
                )}
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-gray-900">{a.name}</h3>
                </div>
              </div>
              {a.notes && a.is_public && (
                <div className="mt-2 text-xs text-gray-700 bg-gray-50 rounded-lg p-2">{a.notes}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Availability Page ─────────────────────────────────────────────────────────

const AvailabilityPage = ({ athletes, setAthletes, navigateTo, setSelectedAthleteId, fetchAthletes, showSuccess, setError }: {
  athletes: Athlete[];
  setAthletes: React.Dispatch<React.SetStateAction<Athlete[]>>;
  navigateTo: (p: string) => void;
  setSelectedAthleteId: (id: string) => void;
  fetchAthletes: () => Promise<void>;
  showSuccess: (msg: string) => void;
  setError: (msg: string | null) => void;
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [selectedAthlete, setSelectedAthlete] = useState<Athlete | null>(null);
  const [tempNotes, setTempNotes] = useState('');
  const [tempIsPublic, setTempIsPublic] = useState(false);
  const [saving, setSaving] = useState(false);

  // ── Inline status change — writes to Supabase immediately ──
  const handleStatusChange = async (id: string, newStatus: Status) => {
    // Optimistic
    setAthletes(prev => prev.map(a => a.id === id ? { ...a, status: newStatus } : a));
    const { error } = await supabase.from('athletes').update({ status: newStatus }).eq('id', id);
    if (error) {
      setError('Failed to update status: ' + error.message);
      await fetchAthletes();
    }
  };

  // ── Notes modal ──
  const openNotesModal = (athlete: Athlete) => {
    setSelectedAthlete(athlete);
    setTempNotes(athlete.notes);
    setTempIsPublic(athlete.is_public);
    setShowNotesModal(true);
  };

  const saveNotes = async () => {
    if (!selectedAthlete) return;
    setSaving(true);
    const { error } = await supabase
      .from('athletes')
      .update({ notes: tempNotes, is_public: tempIsPublic })
      .eq('id', selectedAthlete.id);
    if (error) {
      setError('Failed to save notes: ' + error.message);
    } else {
      setAthletes(prev => prev.map(a =>
        a.id === selectedAthlete.id ? { ...a, notes: tempNotes, is_public: tempIsPublic } : a
      ));
      showSuccess('Notes saved.');
      setShowNotesModal(false);
    }
    setSaving(false);
  };

  // ── Create new athlete — navigate to profile page ──
  const createNewAthlete = async () => {
    const { data, error } = await supabase
      .from('athletes')
      .insert([{ name: 'New Athlete', status: 'Available', notes: '', is_public: false, avatar: 'NA', photo_url: '' }])
      .select()
      .single();
    if (error) {
      setError('Failed to create athlete: ' + error.message);
    } else {
      await fetchAthletes();
      setSelectedAthleteId(data.id);
      navigateTo('athlete-profile');
    }
  };

  const filtered = athletes.filter(a =>
    a.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="max-w-md mx-auto">
      <div className="bg-white shadow-sm border-b border-gray-200 px-4 py-3 mb-4">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input type="text" placeholder="Search athletes..." value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" />
          </div>
          <button onClick={createNewAthlete}
            className="px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-1 transition text-sm font-medium">
            <Plus className="w-4 h-4" />Add
          </button>
        </div>
      </div>

      <div className="px-4 space-y-2 pb-8">
        {filtered.map(athlete => (
          <div key={athlete.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-3">
            <div className="flex items-center gap-3 mb-2">
              <div className="cursor-pointer" onClick={() => { setSelectedAthleteId(athlete.id); navigateTo('athlete-profile'); }}>
                {athlete.photo_url ? (
                  <img src={athlete.photo_url} alt={athlete.name} className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center text-gray-700 font-semibold text-xs">
                    {athlete.avatar || getInitials(athlete.name)}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => { setSelectedAthleteId(athlete.id); navigateTo('athlete-profile'); }}>
                <h3 className="text-sm font-semibold text-gray-900 truncate">{athlete.name}</h3>
              </div>
              <select value={athlete.status} onChange={(e) => handleStatusChange(athlete.id, e.target.value as Status)}
                className="px-2 py-1 text-xs font-medium rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500">
                <option>Available</option>
                <option>Modified</option>
                <option>Unavailable</option>
              </select>
            </div>
            {athlete.notes && athlete.is_public && (
              <div className="mb-2 p-2 bg-gray-50 rounded-lg text-xs text-gray-700 flex items-start gap-1">
                <MessageSquare className="w-3 h-3 text-gray-500 mt-0.5 flex-shrink-0" />
                <span className="line-clamp-2">{athlete.notes}</span>
              </div>
            )}
            <button onClick={() => openNotesModal(athlete)}
              className="w-full flex items-center justify-center gap-1 px-2 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition text-xs font-medium">
              <MessageSquare className="w-3 h-3" />
              {athlete.notes ? 'Edit Note' : 'Add Note'}
              {athlete.notes && (
                <span className={`ml-1 w-1.5 h-1.5 rounded-full ${athlete.is_public ? 'bg-indigo-500' : 'bg-gray-400'}`} />
              )}
            </button>
          </div>
        ))}
      </div>

      {/* Notes Modal */}
      {showNotesModal && selectedAthlete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-30">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h3 className="text-base font-semibold text-gray-900">{selectedAthlete.name}</h3>
              <button onClick={() => setShowNotesModal(false)} className="p-1 hover:bg-gray-100 rounded-lg transition">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <textarea value={tempNotes} onChange={(e) => setTempNotes(e.target.value)}
                placeholder="Add notes..." rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm" />
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={tempIsPublic} onChange={(e) => setTempIsPublic(e.target.checked)}
                  className="w-4 h-4 text-indigo-600 rounded border-gray-300" />
                <span className="text-sm text-gray-700">Public Note</span>
              </label>
            </div>
            <div className="flex gap-2 p-4 border-t border-gray-200">
              <button onClick={saveNotes} disabled={saving}
                className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium text-sm disabled:opacity-50">
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setShowNotesModal(false)}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition text-sm">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Athlete Profile Page ──────────────────────────────────────────────────────

const AthleteProfilePage = ({ athletes, setAthletes, athleteId, navigateTo, fetchAthletes, showSuccess, setError }: {
  athletes: Athlete[];
  setAthletes: React.Dispatch<React.SetStateAction<Athlete[]>>;
  athleteId: string | null;
  navigateTo: (p: string) => void;
  fetchAthletes: () => Promise<void>;
  showSuccess: (msg: string) => void;
  setError: (msg: string | null) => void;
}) => {
  const athlete = athletes.find(a => a.id === athleteId);
  const [form, setForm] = useState<NewAthlete>(
    athlete ? {
      name: athlete.name,
      status: athlete.status,
      notes: athlete.notes,
      is_public: athlete.is_public,
      avatar: athlete.avatar,
      photo_url: athlete.photo_url,
    } : emptyForm()
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Name is required.'); return; }
    setSaving(true);
    // Strip any stale local id — Supabase generates the UUID automatically on insert
    const { id: _id, ...formWithoutId } = form as any;
    const payload = { ...formWithoutId, name: form.name.trim(), avatar: form.avatar || getInitials(form.name) };

    if (athleteId) {
      const { error } = await supabase.from('athletes').update(payload).eq('id', athleteId);
      if (error) {
        setError('Failed to update: ' + error.message);
      } else {
        showSuccess('Athlete updated.');
        await fetchAthletes();
        navigateTo('availability');
      }
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!athleteId || !confirm('Delete this athlete?')) return;
    const { error } = await supabase.from('athletes').delete().eq('id', athleteId);
    if (error) {
      setError('Failed to delete: ' + error.message);
    } else {
      showSuccess('Athlete deleted.');
      setAthletes(prev => prev.filter(a => a.id !== athleteId));
      navigateTo('availability');
    }
  };

  if (!athlete) return (
    <div className="max-w-md mx-auto p-4 text-center py-12 text-gray-500 text-sm">
      Athlete not found.
      <button onClick={() => navigateTo('availability')} className="block mx-auto mt-4 text-indigo-600 text-sm">← Back</button>
    </div>
  );

  return (
    <div className="max-w-md mx-auto p-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 space-y-4 mb-20">
        {/* Avatar preview */}
        <div className="flex justify-center mb-2">
          {form.photo_url ? (
            <img src={form.photo_url} alt={form.name} className="w-20 h-20 rounded-full object-cover" />
          ) : (
            <div className="w-20 h-20 bg-gray-200 rounded-full flex items-center justify-center text-gray-700 font-bold text-xl">
              {form.avatar || getInitials(form.name || '?')}
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Name <span className="text-red-500">*</span></label>
          <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Status })}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500">
            <option>Available</option>
            <option>Modified</option>
            <option>Unavailable</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Optional notes…" rows={3}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Photo URL</label>
          <input type="text" value={form.photo_url} onChange={(e) => setForm({ ...form, photo_url: e.target.value })}
            placeholder="https://…"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" />
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.is_public} onChange={(e) => setForm({ ...form, is_public: e.target.checked })}
            className="w-4 h-4 text-indigo-600 rounded border-gray-300" />
          <span className="text-sm text-gray-700">Make notes public</span>
        </label>

        <button onClick={handleDelete}
          className="w-full px-4 py-2 bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 transition text-sm font-medium">
          Delete Athlete
        </button>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 shadow-lg">
        <div className="max-w-md mx-auto flex gap-2">
          <button onClick={handleSave} disabled={saving}
            className="flex-1 px-4 py-3 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition font-medium text-sm disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={() => navigateTo('availability')}
            className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition text-sm font-medium">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Session Plan Page ─────────────────────────────────────────────────────────

const SessionPlanPage = ({ drills, setDrills, navigateTo, athletes }: {
  drills: Drill[];
  setDrills: React.Dispatch<React.SetStateAction<Drill[]>>;
  navigateTo: (p: string) => void;
  athletes: Athlete[];
}) => {
  const [expandedDrill, setExpandedDrill] = useState<number | null>(null);
  const [draggedDrill, setDraggedDrill] = useState<number | null>(null);
  const [editingTeam, setEditingTeam] = useState<Drill | null>(null);

  const handleDragStart = (_e: React.DragEvent, index: number) => setDraggedDrill(index);
  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedDrill === null || draggedDrill === index) return;
    const newDrills = [...drills];
    const [item] = newDrills.splice(draggedDrill, 1);
    newDrills.splice(index, 0, item);
    setDraggedDrill(index);
    setDrills(newDrills);
  };
  const handleDragEnd = () => setDraggedDrill(null);

  if (editingTeam) {
    return (
      <TeamSelectionModal
        athletes={athletes}
        team1={editingTeam.team1 || {}}
        setTeam1={(team1) => {
          setDrills(drills.map(d => d.id === editingTeam.id ? { ...d, team1 } : d));
          setEditingTeam({ ...editingTeam, team1 });
        }}
        team2={editingTeam.team2 || {}}
        setTeam2={(team2) => {
          setDrills(drills.map(d => d.id === editingTeam.id ? { ...d, team2 } : d));
          setEditingTeam({ ...editingTeam, team2 });
        }}
        onBack={() => setEditingTeam(null)}
      />
    );
  }

  return (
    <div className="max-w-md mx-auto p-4">
      <div className="space-y-2 mb-20">
        {drills.map((drill, index) => (
          <div key={drill.id} draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragEnd={handleDragEnd}
            className={`bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden cursor-move ${draggedDrill === index ? 'opacity-50' : ''}`}>
            <button onClick={() => setExpandedDrill(expandedDrill === drill.id ? null : drill.id)}
              className="w-full p-4 flex items-center justify-between hover:bg-gray-50 transition">
              <div className="text-left flex items-center gap-2">
                <div className="text-gray-400">⋮⋮</div>
                <div>
                  <h3 className="font-semibold text-gray-900 text-sm">{drill.name}</h3>
                  <p className="text-xs text-gray-600">{drill.type}</p>
                </div>
              </div>
              {expandedDrill === drill.id ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
            </button>
            {expandedDrill === drill.id && (
              <div className="p-4 border-t border-gray-200 bg-gray-50 space-y-2 text-sm">
                <div><p className="text-xs font-medium text-gray-600">Type</p><p className="text-gray-900">{drill.type}</p></div>
                <div><p className="text-xs font-medium text-gray-600">Intensity</p><p className="text-gray-900">{drill.intensity}</p></div>
                <div><p className="text-xs font-medium text-gray-600">Notes</p><p className="text-gray-900">{drill.notes}</p></div>
                <button onClick={() => setEditingTeam(drill)}
                  className="w-full mt-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-xs font-medium flex items-center justify-center gap-2">
                  <Users className="w-4 h-4" />
                  {(Object.keys(drill.team1).length > 0) || (Object.keys(drill.team2).length > 0) ? 'Edit Team' : 'Add Team'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 shadow-lg">
        <div className="max-w-md mx-auto">
          <button onClick={() => navigateTo('add-drill')}
            className="w-full px-4 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium text-sm flex items-center justify-center gap-2">
            <Plus className="w-4 h-4" />Add Drill
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Add Drill Page ────────────────────────────────────────────────────────────

const AddDrillPage = ({ drills, setDrills, athletes, navigateTo }: {
  drills: Drill[];
  setDrills: React.Dispatch<React.SetStateAction<Drill[]>>;
  athletes: Athlete[];
  navigateTo: (p: string) => void;
}) => {
  const [drillName, setDrillName] = useState('');
  const [drillType, setDrillType] = useState('Technical');
  const [drillNotes, setDrillNotes] = useState('');
  const [drillIntensity, setDrillIntensity] = useState('Low');
  const [showTeamSelection, setShowTeamSelection] = useState(false);
  const [team1, setTeam1] = useState<Record<string, string>>({});
  const [team2, setTeam2] = useState<Record<string, string>>({});

  const handleSaveDrill = () => {
    if (!drillName.trim()) return;
    setDrills([...drills, { id: Date.now(), name: drillName, type: drillType, notes: drillNotes, intensity: drillIntensity, team1, team2 }]);
    navigateTo('session-plan');
  };

  if (showTeamSelection) return (
    <TeamSelectionModal athletes={athletes} team1={team1} setTeam1={setTeam1} team2={team2} setTeam2={setTeam2} onBack={() => setShowTeamSelection(false)} />
  );

  return (
    <div className="max-w-md mx-auto p-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 space-y-4 mb-20">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Drill Name</label>
          <input type="text" value={drillName} onChange={(e) => setDrillName(e.target.value)} placeholder="Enter drill name"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Drill Type</label>
          <select value={drillType} onChange={(e) => setDrillType(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500">
            <option>Technical</option><option>Tactical</option><option>Physical</option><option>Warm-up</option><option>Cool-down</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Intensity</label>
          <select value={drillIntensity} onChange={(e) => setDrillIntensity(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500">
            <option>Low</option><option>Medium</option><option>High</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
          <textarea value={drillNotes} onChange={(e) => setDrillNotes(e.target.value)} placeholder="Add drill notes..." rows={3}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" />
        </div>
        <button onClick={() => setShowTeamSelection(true)}
          className="w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition text-sm font-medium flex items-center justify-center gap-2">
          <Users className="w-4 h-4" />Team
        </button>
      </div>
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 shadow-lg">
        <div className="max-w-md mx-auto flex gap-2">
          <button onClick={handleSaveDrill}
            className="flex-1 px-4 py-3 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition font-medium text-sm">Save</button>
          <button onClick={() => navigateTo('session-plan')}
            className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition text-sm font-medium">Cancel</button>
        </div>
      </div>
    </div>
  );
};

// ── Team Selection Modal ──────────────────────────────────────────────────────

const TeamSelectionModal = ({ athletes, team1, setTeam1, team2, setTeam2, onBack }: {
  athletes: Athlete[];
  team1: Record<string, string>;
  setTeam1: (t: Record<string, string>) => void;
  team2: Record<string, string>;
  setTeam2: (t: Record<string, string>) => void;
  onBack: () => void;
}) => {
  const [selectedCell, setSelectedCell] = useState<{ row: number; team: number } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const rows = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

  const selectAthlete = (athleteId: string) => {
    if (!selectedCell) return;
    const { row, team } = selectedCell;
    if (team === 1) setTeam1({ ...team1, [row]: athleteId });
    else setTeam2({ ...team2, [row]: athleteId });
    setSelectedCell(null);
    setSearchTerm('');
  };

  const getAthleteName = (athleteId: string) => {
    const a = athletes.find(a => a.id === athleteId);
    return a ? a.name : 'Select Player';
  };

  const availableAthletes = athletes
    .filter(a => a.status !== 'Unavailable')
    .filter(a => !searchTerm || a.name.toLowerCase().includes(searchTerm.toLowerCase()));

  if (selectedCell) {
    return (
      <div className="max-w-md mx-auto p-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900 text-sm">
              Select Player — Position {selectedCell.row} (Team {selectedCell.team})
            </h3>
            <button onClick={() => setSelectedCell(null)} className="p-1 hover:bg-gray-100 rounded-lg">
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </div>
          <div className="p-4">
            <input type="text" placeholder="Search..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 mb-3" />
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {availableAthletes.map(a => (
                <button key={a.id} onClick={() => selectAthlete(a.id)}
                  className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-indigo-50 hover:text-indigo-700 transition flex items-center gap-2">
                  <div className="w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center text-xs font-medium">
                    {a.avatar || getInitials(a.name)}
                  </div>
                  {a.name}
                  <span className={`ml-auto w-2 h-2 rounded-full ${statusColour[a.status]}`} />
                </button>
              ))}
              {availableAthletes.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-4">No athletes found.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-gray-900">Team Selection</h2>
        <button onClick={onBack} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition text-sm">
          ← Back
        </button>
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="grid grid-cols-3 bg-gray-50 border-b border-gray-200">
          <div className="p-3 text-xs font-semibold text-gray-600 text-center">Team 1</div>
          <div className="p-3 text-xs font-semibold text-gray-600 text-center border-x border-gray-200">#</div>
          <div className="p-3 text-xs font-semibold text-gray-600 text-center">Team 2</div>
        </div>
        {rows.map(row => (
          <div key={row} className="grid grid-cols-3 border-b border-gray-100 last:border-b-0">
            <button onClick={() => setSelectedCell({ row, team: 1 })}
              className="p-2 text-xs text-left hover:bg-indigo-50 transition truncate border-r border-gray-100">
              {team1[row] ? getAthleteName(team1[row]) : <span className="text-gray-400">+ Add</span>}
            </button>
            <div className="p-2 text-xs text-gray-500 text-center flex items-center justify-center font-medium">{row}</div>
            <button onClick={() => setSelectedCell({ row, team: 2 })}
              className="p-2 text-xs text-left hover:bg-indigo-50 transition truncate border-l border-gray-100">
              {team2[row] ? getAthleteName(team2[row]) : <span className="text-gray-400">+ Add</span>}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AthleteManager;
