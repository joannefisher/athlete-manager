'use client';

import React, { useState, useEffect } from 'react';
import { Calendar, Plus, Trash2, Edit2, Check, X, ChevronLeft, Loader2, ArrowLeft, Upload, Settings } from 'lucide-react';
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

// ── CSV import (2026-09-03) ──────────────────────────────────────────────────
// Main Schedule manages fixtures, not athletes, so this is its own small
// parser rather than a reuse of CsvAthleteImportModal (Training Planner/Gym's
// shared component) — different columns, different destination table. Kept
// deliberately simple per Joanne's answer ("needs CSV import but today not
// needing filters"): no column-matching UI, just a header row and a preview.
interface ParsedFixtureRow {
  date: string;
  opposition: string;
  homeAway: 'Home' | 'Away' | 'Neutral';
}

/** Same minimal quoted-CSV parser as CsvAthleteImportModal — handles quoted fields and CRLF/LF, not a general-purpose CSV library. */
function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      pushField();
    } else if (c === '\n') {
      pushRow();
    } else if (c === '\r') {
      // skip — the following \n (if any) triggers pushRow
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) pushRow();
  return rows.filter(r => r.some(cell => cell.trim() !== ''));
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

/** Accepts ISO (2026-09-03) or UK-style (03/09/2026 or 3/9/26) dates and normalises to ISO for storage — fixtures.date is a plain date column, same format the Add Fixture form's <input type="date"> already writes. */
function normaliseDate(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = (Number(y) < 70 ? '20' : '19') + y;
    const dd = d.padStart(2, '0'), mm = mo.padStart(2, '0');
    const candidate = `${y}-${mm}-${dd}`;
    return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : null;
  }
  return null;
}

function parseFixtureCsv(text: string): { rows: ParsedFixtureRow[]; headerWarning: string | null } {
  const table = parseCsvText(text);
  if (table.length === 0) return { rows: [], headerWarning: null };

  const headerRow = table[0].map(normalizeHeader);
  const dateIdx = headerRow.findIndex(h => h === 'date');
  const oppositionIdx = headerRow.findIndex(h => h === 'opposition' || h === 'opponent');
  if (dateIdx === -1 || oppositionIdx === -1) {
    return { rows: [], headerWarning: 'Needs a "Date" and an "Opposition" column in the header row.' };
  }
  const homeAwayIdx = headerRow.findIndex(h => h === 'homeaway' || h === 'home/away' || h === 'venue');

  const rows: ParsedFixtureRow[] = [];
  for (const cells of table.slice(1)) {
    const opposition = (cells[oppositionIdx] || '').trim();
    const date = normaliseDate(cells[dateIdx] || '');
    if (!opposition || !date) continue;

    const rawHA = homeAwayIdx >= 0 ? (cells[homeAwayIdx] || '').trim().toLowerCase() : '';
    const homeAway: ParsedFixtureRow['homeAway'] =
      rawHA.startsWith('a') ? 'Away' : rawHA.startsWith('n') ? 'Neutral' : 'Home';

    rows.push({ date, opposition, homeAway });
  }

  return { rows, headerWarning: null };
}

const FixtureCsvImportModal = ({ clubId, onImported, onClose }: { clubId: string; onImported: () => void; onClose: () => void }) => {
  const [rows, setRows] = useState<ParsedFixtureRow[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(false);

  const handleFile = async (file: File) => {
    setParseError(null);
    setFileName(file.name);
    const text = await file.text();
    const { rows: parsed, headerWarning } = parseFixtureCsv(text);
    if (headerWarning) { setParseError(headerWarning); setRows(null); return; }
    if (parsed.length === 0) { setParseError('No rows with both a Date and an Opposition found in this file.'); setRows(null); return; }
    setRows(parsed);
  };

  const handleImport = async () => {
    if (!rows || rows.length === 0) return;
    setImporting(true);
    try {
      const { error } = await supabase.from('fixtures').insert(
        rows.map(r => ({ club_id: clubId, date: r.date, opposition: r.opposition, home_away: r.homeAway }))
      );
      if (error) throw error;
      setDone(true);
      onImported();
    } catch (err: any) {
      console.error('[FixtureCsvImportModal] import failed', err);
      setParseError(err?.message || 'Import failed partway through — some fixtures may already have been added.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 sticky top-0 bg-white z-10">
          <h3 className="text-[14px] font-bold text-slate-900">Import fixtures from CSV</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 text-slate-400"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          {done ? (
            <div className="text-center py-6">
              <p className="text-[14px] font-semibold text-emerald-700 mb-1">Imported {rows?.length} fixture{rows?.length !== 1 ? 's' : ''}</p>
              <button onClick={onClose} className="h-9 px-4 rounded-lg bg-slate-900 text-white text-[13px] font-medium">Done</button>
            </div>
          ) : (
            <>
              <p className="text-[12px] text-slate-500">
                Upload a CSV with a header row. Recognised columns: <span className="font-medium text-slate-700">Date</span> (required, e.g. 2026-09-03
                or 03/09/2026), <span className="font-medium text-slate-700">Opposition</span> (required), and Home/Away (Home, Away, or Neutral — defaults
                to Home). Every row is added as a new fixture.
              </p>

              <label className="flex items-center justify-center gap-2 h-11 border-2 border-dashed border-slate-200 rounded-lg text-[13px] text-slate-500 hover:border-slate-300 hover:bg-slate-50 cursor-pointer">
                <Upload className="w-4 h-4" />
                {fileName || 'Choose a CSV file…'}
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              </label>

              {parseError && <p className="text-[12px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{parseError}</p>}

              {rows && rows.length > 0 && (
                <div>
                  <p className="text-[12px] font-medium text-slate-700 mb-1.5">{rows.length} fixture{rows.length !== 1 ? 's' : ''} ready to import</p>
                  <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-56 overflow-y-auto">
                    {rows.map((r, i) => (
                      <div key={i} className="px-3 py-1.5 text-[12px] flex items-center justify-between gap-2">
                        <span className="font-medium text-slate-800 truncate">{r.opposition}</span>
                        <span className="text-slate-400 truncate">{fmtDate(r.date)} · {r.homeAway}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button onClick={handleImport} disabled={!rows || rows.length === 0 || importing}
                  className="flex-1 h-9 flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 text-white text-[13px] font-medium disabled:opacity-40">
                  {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  {importing ? 'Importing…' : `Import ${rows?.length || ''} fixture${(rows?.length || 0) !== 1 ? 's' : ''}`}
                </button>
                <button onClick={onClose} disabled={importing} className="h-9 px-4 rounded-lg bg-slate-100 text-slate-600 text-[13px] disabled:opacity-40">Cancel</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Fixtures Setup Section ────────────────────────────────────────────────────
const FixturesSetup = ({ clubId, canEdit }: { clubId: string; canEdit: boolean }) => {
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const blank: { date: string; opposition: string; homeAway: 'Home' | 'Away' | 'Neutral' } = { date: '', opposition: '', homeAway: 'Home' };
  const [form, setForm] = useState<{ date: string; opposition: string; homeAway: 'Home' | 'Away' | 'Neutral' }>(blank);
  const [editForm, setEditForm] = useState<{ date: string; opposition: string; homeAway: 'Home' | 'Away' | 'Neutral' }>(blank);

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
      {/* Add fixture / import buttons */}
      {canEdit && !showAdd && (
        <div className="flex gap-2">
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 h-9 px-4 bg-slate-900 text-white rounded-lg text-[12px] font-medium hover:bg-slate-700 transition-colors">
            <Plus className="w-3.5 h-3.5" />Add Fixture
          </button>
          <button onClick={() => setShowImport(true)}
            className="flex items-center gap-1.5 h-9 px-4 bg-white border border-slate-200 text-slate-600 rounded-lg text-[12px] font-medium hover:bg-slate-50 transition-colors">
            <Upload className="w-3.5 h-3.5" />Import CSV
          </button>
        </div>
      )}

      {showImport && (
        <FixtureCsvImportModal clubId={clubId} onImported={load} onClose={() => setShowImport(false)} />
      )}

      {/* Add form */}
      {showAdd && (
        <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-3">
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
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
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
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
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
          {/* Unified with the Add-form's Cancel style below (2026-09-03 audit fix) — was a separate white-bordered treatment for the same action. */}
          <button onClick={onEditCancel} className="h-7 px-3 bg-slate-100 text-slate-600 rounded text-[11px] hover:bg-slate-200 transition-colors">Cancel</button>
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
  // Admin can impersonate other roles to preview their view — same pattern
  // as TrainingPlanner/RehabPlanner/Gym's "View as" (2026-09-03).
  const [viewingAs, setViewingAs] = useState<Role>(role);
  useEffect(() => { setViewingAs(role); }, [role]);
  const effectiveRole: Role = role === 'Admin' ? viewingAs : role;

  const canEdit = effectiveRole === 'Admin' || effectiveRole === 'Coach';
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
            <Settings className="w-3.5 h-3.5 shrink-0" />Setup
          </button>
        </nav>
        <div className="p-3 border-t border-white/[0.06]">
          {role === 'Admin' && (
            <div className="mb-3">
              <p className="text-[9px] font-semibold text-white/25 uppercase tracking-[0.9px] mb-1">View as</p>
              <select value={viewingAs} onChange={e => setViewingAs(e.target.value as Role)}
                className="w-full h-7 px-2 text-[11px] rounded bg-white/[0.06] text-white/70 border border-white/10 focus:outline-none">
                {(['Admin', 'S&C', 'Physio', 'Coach', 'Player'] as Role[]).map(r => <option key={r} value={r} className="bg-slate-900">{r}</option>)}
              </select>
            </div>
          )}
          {/* Wording/classes aligned to match Gym's sidebar footer exactly (2026-09-03 fix — was "Signed in as" with different type-scale classes). */}
          <p className="text-[9px] font-semibold text-white/25 uppercase tracking-[0.9px] mb-1">Signed in</p>
          <p className="text-[11px] text-white/50 truncate">{authUser?.email}</p>
          <p className="text-[10px] text-white/30 mt-0.5">{effectiveRole}</p>
          {/* Was missing entirely (2026-09-03 audit fix) — the only one of the
              four apps where a desktop user had no way to sign out without
              first going back to the app selector. */}
          <button onClick={() => supabase.auth.signOut()} className="mt-2 w-full flex items-center gap-2 px-2.5 py-1.5 text-[12px] text-white/40 hover:text-white/70 hover:bg-white/[0.06] rounded transition-colors">
            <X className="w-3 h-3" />Sign out
          </button>
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
