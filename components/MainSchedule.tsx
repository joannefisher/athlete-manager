'use client';

import React, { useState, useEffect } from 'react';
import { Calendar, Plus, Trash2, Edit2, Check, X, ChevronLeft, Loader2, ArrowLeft } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Role } from './AthleteManager';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Fixture {
  id: string;
  date: string;
  opposition: string;
  homeAway: 'Home' | 'Away' | 'Neutral';
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtDate = (d: string) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '';

const HA_COLOURS: Record<string, string> = {
  Home: 'bg-green-100 text-green-700',
  Away: 'bg-blue-100 text-blue-700',
  Neutral: 'bg-slate-100 text-slate-600',
};

// ── Fixtures Setup Section ────────────────────────────────────────────────────
const FixturesSetup = ({ clubId, canEdit }: { clubId: string; canEdit: boolean }) => {
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const blank = { date: '', opposition: '', homeAway: 'Home' as const };
  const [form, setForm] = useState(blank);
  const [editForm, setEditForm] = useState(blank);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('fixtures')
      .select('*')
      .eq('club_id', clubId)
      .order('date');
    setFixtures((data || []).map((f: any) => ({
      id: f.id, date: f.date, opposition: f.opposition, homeAway: f.home_away,
    })));
    setLoading(false);
  };

  useEffect(() => { load(); }, [clubId]);

  const addFixture = async () => {
    if (!form.date || !form.opposition.trim()) return;
    setSaving(true);
    const { data } = await supabase.from('fixtures').insert({
      club_id: clubId, date: form.date,
      opposition: form.opposition.trim(), home_away: form.homeAway,
    }).select().single();
    if (data) {
      setFixtures(prev => [...prev, { id: data.id, date: data.date, opposition: data.opposition, homeAway: data.home_away }]
        .sort((a, b) => a.date.localeCompare(b.date)));
    }
    setForm(blank);
    setShowAdd(false);
    setSaving(false);
  };

  const saveEdit = async (id: string) => {
    if (!editForm.date || !editForm.opposition.trim()) return;
    setSaving(true);
    await supabase.from('fixtures').update({
      date: editForm.date, opposition: editForm.opposition.trim(), home_away: editForm.homeAway,
    }).eq('id', id);
    setFixtures(prev => prev.map(f => f.id === id
      ? { ...f, date: editForm.date, opposition: editForm.opposition.trim(), homeAway: editForm.homeAway }
      : f).sort((a, b) => a.date.localeCompare(b.date)));
    setEditingId(null);
    setSaving(false);
  };

  const deleteFixture = async (id: string) => {
    if (!confirm('Delete this fixture?')) return;
    await supabase.from('fixtures').delete().eq('id', id);
    setFixtures(prev => prev.filter(f => f.id !== id));
  };

  const today = new Date().toISOString().split('T')[0];
  const upcoming = fixtures.filter(f => f.date >= today);
  const past = fixtures.filter(f => f.date < today);

  if (loading) return <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>;

  return (
    <div className="space-y-4">
      {/* Add fixture button */}
      {canEdit && !showAdd && (
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 h-9 px-4 bg-slate-900 text-white rounded-lg text-[12px] font-medium hover:bg-slate-700 transition-colors">
          <Plus className="w-3.5 h-3.5" />Add Fixture
        </button>
      )}

      {/* Add form */}
      {showAdd && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <p className="text-[12px] font-semibold text-slate-600 uppercase tracking-wider">New Fixture</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">Date</label>
              <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })}
                className="w-full h-9 px-3 text-[12px] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">Opposition</label>
              <input type="text" placeholder="Team name" value={form.opposition} onChange={e => setForm({ ...form, opposition: e.target.value })}
                className="w-full h-9 px-3 text-[12px] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">Home / Away</label>
              <select value={form.homeAway} onChange={e => setForm({ ...form, homeAway: e.target.value as any })}
                className="w-full h-9 px-3 text-[12px] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white">
                <option>Home</option><option>Away</option><option>Neutral</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={addFixture} disabled={saving || !form.date || !form.opposition.trim()}
              className="h-9 px-4 bg-slate-900 text-white rounded-lg text-[12px] font-medium hover:bg-slate-700 disabled:opacity-40 flex items-center gap-1.5">
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}Save
            </button>
            <button onClick={() => { setShowAdd(false); setForm(blank); }}
              className="h-9 px-4 bg-slate-100 text-slate-600 rounded-lg text-[12px] hover:bg-slate-200">Cancel</button>
          </div>
        </div>
      )}

      {/* Upcoming fixtures */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
          <p className="text-[12px] font-semibold text-slate-700">Upcoming Fixtures</p>
          <p className="text-[11px] text-slate-400">{upcoming.length} fixture{upcoming.length !== 1 ? 's' : ''}</p>
        </div>
        {upcoming.length === 0 ? (
          <div className="py-8 text-center text-[13px] text-slate-400">No upcoming fixtures</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {upcoming.map(f => (
              <FixtureRow key={f.id} fixture={f} canEdit={canEdit}
                isEditing={editingId === f.id}
                editForm={editForm}
                onEditStart={() => { setEditingId(f.id); setEditForm({ date: f.date, opposition: f.opposition, homeAway: f.homeAway }); }}
                onEditChange={setEditForm}
                onEditSave={() => saveEdit(f.id)}
                onEditCancel={() => setEditingId(null)}
                onDelete={() => deleteFixture(f.id)}
                saving={saving}
              />
            ))}
          </div>
        )}
      </div>

      {/* Past fixtures */}
      {past.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
            <p className="text-[12px] font-semibold text-slate-500">Past Fixtures</p>
            <p className="text-[11px] text-slate-400">{past.length} fixture{past.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="divide-y divide-slate-100">
            {[...past].reverse().map(f => (
              <FixtureRow key={f.id} fixture={f} canEdit={canEdit}
                isEditing={editingId === f.id}
                editForm={editForm}
                onEditStart={() => { setEditingId(f.id); setEditForm({ date: f.date, opposition: f.opposition, homeAway: f.homeAway }); }}
                onEditChange={setEditForm}
                onEditSave={() => saveEdit(f.id)}
                onEditCancel={() => setEditingId(null)}
                onDelete={() => deleteFixture(f.id)}
                saving={saving}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Fixture Row ───────────────────────────────────────────────────────────────
const FixtureRow = ({ fixture, canEdit, isEditing, editForm, onEditStart, onEditChange, onEditSave, onEditCancel, onDelete, saving }: any) => {
  if (isEditing) {
    return (
      <div className="p-3 bg-blue-50">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
          <input type="date" value={editForm.date} onChange={e => onEditChange({ ...editForm, date: e.target.value })}
            className="h-8 px-2 text-[12px] border border-slate-200 rounded-lg focus:outline-none bg-white" />
          <input type="text" value={editForm.opposition} onChange={e => onEditChange({ ...editForm, opposition: e.target.value })}
            className="h-8 px-2 text-[12px] border border-slate-200 rounded-lg focus:outline-none bg-white" placeholder="Opposition" />
          <select value={editForm.homeAway} onChange={e => onEditChange({ ...editForm, homeAway: e.target.value })}
            className="h-8 px-2 text-[12px] border border-slate-200 rounded-lg bg-white focus:outline-none">
            <option>Home</option><option>Away</option><option>Neutral</option>
          </select>
        </div>
        <div className="flex gap-2">
          <button onClick={onEditSave} disabled={saving}
            className="h-7 px-3 bg-slate-900 text-white rounded text-[11px] flex items-center gap-1 disabled:opacity-40">
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}Save
          </button>
          <button onClick={onEditCancel} className="h-7 px-3 bg-white border border-slate-200 text-slate-600 rounded text-[11px]">Cancel</button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-semibold text-slate-900">{fixture.opposition}</span>
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${HA_COLOURS[fixture.homeAway]}`}>{fixture.homeAway}</span>
        </div>
        <p className="text-[11px] text-slate-400 mt-0.5">{fmtDate(fixture.date)}</p>
      </div>
      {canEdit && (
        <div className="flex items-center gap-1">
          <button onClick={onEditStart} className="p-1.5 text-slate-300 hover:text-slate-600 transition-colors">
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={onDelete} className="p-1.5 text-slate-300 hover:text-red-500 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};

// ── Main Schedule Shell ───────────────────────────────────────────────────────
export function MainSchedule({ role, clubId, authUser, onBack }: {
  role: Role; clubId: string; authUser: any; onBack: () => void;
}) {
  const canEdit = role === 'Admin' || role === 'Coach';
  const [page, setPage] = useState<'setup'>('setup');

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar */}
      <aside className="hidden md:flex flex-col w-52 shrink-0 bg-slate-900 sticky top-0 h-screen">
        <div className="px-4 py-5 border-b border-white/[0.06]">
          <button onClick={onBack} className="flex items-center gap-1.5 text-white/40 hover:text-white/70 text-[11px] mb-3 transition-colors">
            <ArrowLeft className="w-3 h-3" />All Apps
          </button>
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded bg-violet-600 flex items-center justify-center shrink-0">
              <Calendar className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
            </div>
            <span className="text-[13px] font-semibold text-slate-100 tracking-tight">Main Schedule</span>
          </div>
        </div>
        <nav className="flex-1 p-2 pt-3">
          <p className="text-[9px] font-semibold text-white/25 uppercase tracking-[0.9px] px-2.5 pb-2">Menu</p>
          <button onClick={() => setPage('setup')}
            className={`w-full text-left px-2.5 py-2 rounded flex items-center gap-2.5 text-[13px] transition-colors relative ${page === 'setup' ? 'bg-white/[0.08] text-slate-100 font-medium' : 'text-white/40 hover:bg-white/[0.06] hover:text-white/70'}`}>
            {page === 'setup' && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-violet-400 rounded-r" />}
            <Calendar className="w-3.5 h-3.5 shrink-0" />Setup
          </button>
        </nav>
        <div className="p-3 border-t border-white/[0.06]">
          <p className="text-[10px] text-white/25 uppercase tracking-wider mb-1">Signed in as</p>
          <p className="text-[11px] text-white/50 truncate">{authUser?.email}</p>
          <p className="text-[10px] text-white/30 mt-0.5">{role}</p>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="flex-1 flex flex-col min-h-screen">
        <header className="md:hidden bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
          <button onClick={onBack} className="p-1.5 hover:bg-slate-100 rounded-lg">
            <ChevronLeft className="w-5 h-5 text-slate-600" />
          </button>
          <h1 className="text-[15px] font-semibold text-slate-900 flex-1">Main Schedule</h1>
        </header>

        {/* Desktop page header */}
        <div className="hidden md:flex items-center justify-between bg-white border-b border-slate-200 px-6 py-3.5">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900">Fixtures Setup</h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 p-4 md:p-6 max-w-3xl w-full mx-auto">
          <FixturesSetup clubId={clubId} canEdit={canEdit} />
        </div>
      </div>
    </div>
  );
}
