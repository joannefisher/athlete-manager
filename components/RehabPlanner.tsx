'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Plus, X, ChevronDown, ChevronUp, ArrowLeft, Loader2, Settings, Check, Trash2, Edit2, ChevronLeft, ChevronRight, Copy, Target, LayoutGrid, List } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Role } from './AthleteManager';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Injury {
  id: string; bodyPart: string; startDate: string;
  returnDate: string | null; surgeryDate?: string | null;
  notes: string; event?: string;
}
interface Athlete {
  id: string; name: string; status: string; avatar: string; injuries: Injury[];
}
interface RehabComponent { id: string; name: string; options: string[]; sortOrder: number; }
interface RTPPhase { id: string; name: string; sortOrder: number; }
interface StaffLead { id: string; name: string; role: string; sortOrder: number; }
interface Fixture { id: string; date: string; opposition: string; homeAway: string; }
interface StatusDefinition {
  id: string; ltiWeeksMin: number; stiWeeksMin: number; rttWeeksMin: number;
}
interface PlanRow {
  id: string; planId: string; athleteId: string;
  section: 'LTI' | 'STI' | 'RTT' | 'Other';
  rtpPhaseId: string | null;
  staffLeadIds: string[];           // multi-select
  targetFixtureId: string | null;
  weekOverview: string; sortOrder: number;
  entries: Record<string, Record<string, string>>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const getWeekDates = (date: string): string[] => {
  const d = new Date(date + 'T00:00:00');
  const day = d.getDay();
  const mon = new Date(d);
  mon.setDate(d.getDate() - ((day + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const dd = new Date(mon); dd.setDate(mon.getDate() + i);
    return dd.toISOString().split('T')[0];
  });
};
const getMondayOf = (d: string) => getWeekDates(d)[0];
const fmtWC = (d: string) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const fmtShort = (d: string) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
const fmtDayNum = (d: string) => new Date(d + 'T00:00:00').getDate();
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const weeksApart = (from: string, to: string) =>
  Math.round((new Date(to + 'T00:00:00').getTime() - new Date(from + 'T00:00:00').getTime()) / (7 * 86400000));

const getInjurySection = (athlete: Athlete, wc: string, sd: StatusDefinition | null): 'LTI' | 'STI' | 'RTT' | 'Other' => {
  const active = athlete.injuries.filter(i => !i.returnDate || i.returnDate >= wc);
  if (!active.length || !sd) return 'Other';
  let max = 0;
  for (const inj of active) {
    if (inj.startDate && inj.returnDate) { const w = weeksApart(inj.startDate, inj.returnDate); if (w > max) max = w; }
    else if (inj.startDate && !inj.returnDate) { max = 999; }
  }
  if (max >= sd.ltiWeeksMin) return 'LTI';
  if (max >= sd.stiWeeksMin) return 'STI';
  if (max >= sd.rttWeeksMin) return 'RTT';
  return 'Other';
};

const SECTION_LABELS: Record<string, string> = { LTI: 'Long Term Injured', STI: 'Short Term Injured', RTT: 'Returning to Training', Other: 'Other' };
const SECTION_ORDER = ['LTI', 'STI', 'RTT', 'Other'] as const;
const SECTION_BG: Record<string, string> = { LTI: 'bg-red-700', STI: 'bg-orange-600', RTT: 'bg-amber-500', Other: 'bg-slate-500' };
const SECTION_BORDER: Record<string, string> = { LTI: 'border-red-200', STI: 'border-orange-200', RTT: 'border-amber-200', Other: 'border-slate-200' };
const canEditRole = (r: Role) => r === 'Admin' || r === 'S&C' || r === 'Physio';

// Non-RAG staff colour palette — cycles by index
const STAFF_COLOURS = [
  { bg: 'bg-blue-100',    text: 'text-blue-700',    border: 'border-blue-200',    dot: 'bg-blue-500'    },
  { bg: 'bg-violet-100',  text: 'text-violet-700',  border: 'border-violet-200',  dot: 'bg-violet-500'  },
  { bg: 'bg-sky-100',     text: 'text-sky-700',     border: 'border-sky-200',     dot: 'bg-sky-500'     },
  { bg: 'bg-indigo-100',  text: 'text-indigo-700',  border: 'border-indigo-200',  dot: 'bg-indigo-500'  },
  { bg: 'bg-fuchsia-100', text: 'text-fuchsia-700', border: 'border-fuchsia-200', dot: 'bg-fuchsia-500' },
  { bg: 'bg-cyan-100',    text: 'text-cyan-700',    border: 'border-cyan-200',    dot: 'bg-cyan-500'    },
  { bg: 'bg-teal-100',    text: 'text-teal-700',    border: 'border-teal-200',    dot: 'bg-teal-500'    },
  { bg: 'bg-rose-100',    text: 'text-rose-700',    border: 'border-rose-200',    dot: 'bg-rose-500'    },
];
const staffColour = (idx: number) => STAFF_COLOURS[idx % STAFF_COLOURS.length];

// ── ComboCell — unified multi-select picklist + free text ────────────────────
// Values stored as comma-separated string; options render as checkboxes
const ComboCell = ({ value, options, canEdit, onChange }: {
  value: string; options: string[]; canEdit: boolean; onChange: (v: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [freeText, setFreeText] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // Parse stored value: comma-separated
  const selected = value ? value.split(',').map(s => s.trim()).filter(Boolean) : [];
  const hasOptions = options.length > 0;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggleOption = (o: string) => {
    const next = selected.includes(o) ? selected.filter(x => x !== o) : [...selected, o];
    onChange(next.join(', '));
  };

  const commitFreeText = () => {
    const t = freeText.trim();
    if (!t) return;
    const next = selected.includes(t) ? selected : [...selected, t];
    onChange(next.join(', '));
    setFreeText('');
  };

  const removeVal = (v: string) => onChange(selected.filter(x => x !== v).join(', '));

  if (!canEdit) {
    if (!value) return <span className="text-slate-300 text-[10px]">—</span>;
    return (
      <div className="flex flex-wrap gap-0.5 px-1 py-0.5">
        {selected.map(v => <span key={v} className="bg-slate-100 text-slate-600 rounded px-1.5 py-0.5 text-[10px]">{v}</span>)}
      </div>
    );
  }

  if (!open) return (
    <button onClick={() => setOpen(true)}
      className="w-full min-h-[26px] text-left px-1.5 py-0.5 rounded text-[10px] hover:bg-slate-100 transition-colors border border-transparent hover:border-slate-200">
      {selected.length === 0
        ? <span className="text-slate-300 italic">—</span>
        : <div className="flex flex-wrap gap-0.5">{selected.map(v => <span key={v} className="bg-slate-100 text-slate-700 rounded px-1 py-0.5 text-[10px]">{v}</span>)}</div>
      }
    </button>
  );

  return (
    <div ref={ref} className="relative z-30 min-w-[140px]">
      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-0.5 mb-1 px-1">
          {selected.map(v => (
            <span key={v} className="inline-flex items-center gap-0.5 bg-slate-200 text-slate-700 rounded px-1 py-0.5 text-[10px]">
              {v}
              <button onMouseDown={e => { e.preventDefault(); removeVal(v); }} className="hover:text-red-500 ml-0.5">×</button>
            </span>
          ))}
        </div>
      )}
      {/* Free text input */}
      <input
        autoFocus={!hasOptions}
        value={freeText}
        onChange={e => setFreeText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { commitFreeText(); } if (e.key === 'Escape') setOpen(false); }}
        placeholder={hasOptions ? "or type…" : "Type value…"}
        className="w-full h-6 px-2 text-[10px] border border-blue-400 rounded focus:outline-none bg-white"
      />
      {/* Options as checkboxes */}
      {hasOptions && (
        <div className="absolute top-full left-0 mt-0.5 bg-white border border-slate-200 rounded-lg shadow-lg min-w-full z-40 max-h-44 overflow-y-auto py-1">
          {options.map(o => (
            <button key={o} onMouseDown={e => { e.preventDefault(); toggleOption(o); }}
              className="w-full flex items-center gap-2 px-2 py-1 hover:bg-slate-50 transition-colors">
              <div className={`w-3 h-3 rounded border flex items-center justify-center shrink-0 ${selected.includes(o) ? 'bg-slate-800 border-slate-800' : 'border-slate-300'}`}>
                {selected.includes(o) && <span className="text-white text-[8px] font-bold">✓</span>}
              </div>
              <span className={`text-[11px] ${selected.includes(o) ? 'text-slate-900 font-medium' : 'text-slate-600'}`}>{o}</span>
            </button>
          ))}
          {freeText.trim() && !options.includes(freeText.trim()) && (
            <button onMouseDown={e => { e.preventDefault(); commitFreeText(); }}
              className="w-full text-left px-2 py-1 text-[10px] text-slate-400 hover:bg-slate-50 border-t border-slate-100 mt-1">
              Add "{freeText.trim()}"
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// ── Multi Staff Lead picker ───────────────────────────────────────────────────
const StaffLeadPicker = ({ selectedIds, staffLeads, canEdit, onChange }: {
  selectedIds: string[]; staffLeads: StaffLead[]; canEdit: boolean; onChange: (ids: string[]) => void;
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = staffLeads.filter(s => selectedIds.includes(s.id));

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggle = (id: string) => {
    const next = selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id];
    onChange(next);
  };

  if (!canEdit) {
    if (!selected.length) return <span className="text-slate-300 text-[10px]">—</span>;
    return (
      <div className="flex flex-wrap gap-1">
        {selected.map((s, idx) => { const c = staffColour(staffLeads.indexOf(s)); return (
          <span key={s.id} className={`inline-flex items-center gap-0.5 ${c.bg} ${c.text} border ${c.border} rounded px-1.5 py-0.5 text-[9px] font-medium`}>
            {s.name}{s.role && <span className="opacity-60 ml-0.5">· {s.role}</span>}
          </span>
        );})}
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)}
        className="w-full min-h-[28px] text-left px-2 py-1 rounded text-[10px] hover:bg-slate-100 border border-transparent hover:border-slate-200 transition-colors">
        {selected.length === 0
          ? <span className="text-slate-300 italic">— Select —</span>
          : <div className="flex flex-wrap gap-0.5">
              {selected.map(s => (
                <span key={s.id} className="bg-emerald-100 text-emerald-700 rounded px-1 py-0.5 text-[9px] font-medium">
                  {s.name}{s.role && <span className="opacity-60"> · {s.role}</span>}
                </span>
              ))}
            </div>
        }
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-0.5 bg-white border border-slate-200 rounded-lg shadow-xl z-40 min-w-[180px] py-1">
          <p className="px-3 py-1 text-[9px] font-bold text-slate-400 uppercase tracking-wider">Select staff</p>
          {staffLeads.map(s => (
            <button key={s.id} onMouseDown={e => { e.preventDefault(); toggle(s.id); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 transition-colors">
              {(() => { const c = staffColour(staffLeads.indexOf(s)); return (
                <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${selectedIds.includes(s.id) ? `${c.dot} border-transparent` : 'border-slate-300'}`}>
                  {selectedIds.includes(s.id) && <Check className="w-2.5 h-2.5 text-white" />}
                </div>
              );})()}
              <div className="text-left min-w-0">
                <span className="text-[11px] font-medium text-slate-700">{s.name}</span>
                {s.role && <span className="text-[10px] text-slate-400 ml-1">· {s.role}</span>}
              </div>
            </button>
          ))}
          {staffLeads.length === 0 && <p className="px-3 py-2 text-[11px] text-slate-400 italic">No staff defined in Setup</p>}
        </div>
      )}
    </div>
  );
};

// ── Setup sub-components ──────────────────────────────────────────────────────
const SetupSection = ({ id, expanded, setExpanded, title, count, children }: any) => (
  <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
    <button onClick={() => setExpanded(expanded === id ? '' : id)}
      className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors">
      <div>
        <h3 className="text-[13px] font-semibold text-slate-900 text-left">{title}</h3>
        {count !== undefined && <p className="text-[11px] text-slate-400 mt-0.5">{count} item{count !== 1 ? 's' : ''}</p>}
      </div>
      {expanded === id ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
    </button>
    {expanded === id && <div className="border-t border-slate-100">{children}</div>}
  </div>
);

// ── Setup Page ────────────────────────────────────────────────────────────────
const RehabSetupPage = ({ clubId, role }: { clubId: string; role: Role }) => {
  const canEdit = canEditRole(role);
  const [expanded, setExpanded] = useState<string>('components');

  const [components, setComponents] = useState<RehabComponent[]>([]);
  const [editingComp, setEditingComp] = useState<string | null>(null);
  const [compForm, setCompForm] = useState({ name: '', options: '' });
  const [showAddComp, setShowAddComp] = useState(false);

  const [statusDef, setStatusDef] = useState<StatusDefinition | null>(null);
  const [statusForm, setStatusForm] = useState({ lti: '12', sti: '4', rtt: '1' });
  const [savingStatus, setSavingStatus] = useState(false);

  const [rtpPhases, setRtpPhases] = useState<RTPPhase[]>([]);
  const [newRtp, setNewRtp] = useState('');
  const [editingRtp, setEditingRtp] = useState<string | null>(null);
  const [editRtpVal, setEditRtpVal] = useState('');

  const [staffLeads, setStaffLeads] = useState<StaffLead[]>([]);
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffRole, setNewStaffRole] = useState('');
  const [editingStaff, setEditingStaff] = useState<string | null>(null);
  const [editStaffName, setEditStaffName] = useState('');
  const [editStaffRole, setEditStaffRole] = useState('');

  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [{ data: compData }, { data: statusData }, { data: rtpData }, { data: staffData }] = await Promise.all([
      supabase.from('rehab_components').select('*').eq('club_id', clubId).order('sort_order'),
      supabase.from('rehab_status_definitions').select('*').eq('club_id', clubId).maybeSingle(),
      supabase.from('rtp_phases').select('*').eq('club_id', clubId).order('sort_order'),
      supabase.from('staff_leads').select('*').eq('club_id', clubId).order('sort_order'),
    ]);
    setComponents((compData || []).map((c: any) => ({ id: c.id, name: c.name, options: Array.isArray(c.options) ? c.options : JSON.parse(c.options || '[]'), sortOrder: c.sort_order })));
    if (statusData) { setStatusDef({ id: statusData.id, ltiWeeksMin: statusData.lti_weeks_min, stiWeeksMin: statusData.sti_weeks_min, rttWeeksMin: statusData.rtt_weeks_min }); setStatusForm({ lti: String(statusData.lti_weeks_min), sti: String(statusData.sti_weeks_min), rtt: String(statusData.rtt_weeks_min) }); }
    setRtpPhases((rtpData || []).map((r: any) => ({ id: r.id, name: r.name, sortOrder: r.sort_order })));
    setStaffLeads((staffData || []).map((s: any) => ({ id: s.id, name: s.name, role: s.role || '', sortOrder: s.sort_order })));
  }, [clubId]);

  useEffect(() => { load(); }, [load]);

  const saveComponent = async () => {
    if (!compForm.name.trim()) return;
    setSaving(true);
    const opts = compForm.options.split('\n').map(s => s.trim()).filter(Boolean);
    if (editingComp) await supabase.from('rehab_components').update({ name: compForm.name.trim(), options: opts }).eq('id', editingComp);
    else await supabase.from('rehab_components').insert({ club_id: clubId, name: compForm.name.trim(), options: opts, sort_order: components.length });
    setCompForm({ name: '', options: '' }); setEditingComp(null); setShowAddComp(false);
    await load(); setSaving(false);
  };
  const deleteComponent = async (id: string) => { if (!confirm('Delete?')) return; await supabase.from('rehab_components').delete().eq('id', id); await load(); };

  const saveStatusDef = async () => {
    setSavingStatus(true);
    const payload = { club_id: clubId, lti_weeks_min: parseInt(statusForm.lti) || 12, sti_weeks_min: parseInt(statusForm.sti) || 4, rtt_weeks_min: parseInt(statusForm.rtt) || 1 };
    if (statusDef) await supabase.from('rehab_status_definitions').update(payload).eq('id', statusDef.id);
    else await supabase.from('rehab_status_definitions').insert(payload);
    await load(); setSavingStatus(false);
  };

  const addRtp = async () => { if (!newRtp.trim()) return; await supabase.from('rtp_phases').insert({ club_id: clubId, name: newRtp.trim(), sort_order: rtpPhases.length }); setNewRtp(''); await load(); };
  const updateRtp = async (id: string) => { await supabase.from('rtp_phases').update({ name: editRtpVal.trim() }).eq('id', id); setEditingRtp(null); await load(); };
  const deleteRtp = async (id: string) => { if (!confirm('Delete this RTP phase?')) return; await supabase.from('rtp_phases').delete().eq('id', id); await load(); };

  const addStaff = async () => {
    if (!newStaffName.trim()) return;
    await supabase.from('staff_leads').insert({ club_id: clubId, name: newStaffName.trim(), role: newStaffRole.trim(), sort_order: staffLeads.length });
    setNewStaffName(''); setNewStaffRole(''); await load();
  };
  const updateStaff = async (id: string) => {
    await supabase.from('staff_leads').update({ name: editStaffName.trim(), role: editStaffRole.trim() }).eq('id', id);
    setEditingStaff(null); await load();
  };
  const deleteStaff = async (id: string) => { if (!confirm('Delete this staff lead?')) return; await supabase.from('staff_leads').delete().eq('id', id); await load(); };

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-3">

      {/* Rehab Components */}
      <SetupSection id="components" expanded={expanded} setExpanded={setExpanded} title="Rehab Components" count={components.length}>
        <div className="divide-y divide-slate-100">
          {components.map(comp => (
            <div key={comp.id} className="p-4">
              {editingComp === comp.id ? (
                <div className="space-y-2">
                  <input value={compForm.name} onChange={e => setCompForm({ ...compForm, name: e.target.value })} placeholder="Component name" className="w-full h-9 px-3 text-[12px] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
                  <textarea value={compForm.options} onChange={e => setCompForm({ ...compForm, options: e.target.value })} placeholder="One option per line" rows={4} className="w-full px-3 py-2 text-[12px] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none" />
                  <div className="flex gap-2">
                    <button onClick={saveComponent} disabled={saving} className="h-8 px-4 bg-slate-900 text-white rounded-lg text-[11px] flex items-center gap-1 disabled:opacity-40">{saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}Save</button>
                    <button onClick={() => { setEditingComp(null); setCompForm({ name: '', options: '' }); }} className="h-8 px-4 bg-slate-100 text-slate-600 rounded-lg text-[11px]">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div><p className="text-[13px] font-semibold text-slate-800">{comp.name}</p><p className="text-[11px] text-slate-400 mt-0.5">{comp.options.length > 0 ? comp.options.join(', ') : 'Free text only'}</p></div>
                  {canEdit && <div className="flex gap-1 shrink-0"><button onClick={() => { setEditingComp(comp.id); setCompForm({ name: comp.name, options: comp.options.join('\n') }); }} className="p-1.5 text-slate-300 hover:text-slate-600"><Edit2 className="w-3.5 h-3.5" /></button><button onClick={() => deleteComponent(comp.id)} className="p-1.5 text-slate-300 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button></div>}
                </div>
              )}
            </div>
          ))}
        </div>
        {canEdit && (
          <div className="p-4 border-t border-slate-100">
            {showAddComp ? (
              <div className="space-y-2">
                <input value={compForm.name} onChange={e => setCompForm({ ...compForm, name: e.target.value })} placeholder="Component name" className="w-full h-9 px-3 text-[12px] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
                <textarea value={compForm.options} onChange={e => setCompForm({ ...compForm, options: e.target.value })} placeholder="Picklist options — one per line (leave blank for free text)" rows={4} className="w-full px-3 py-2 text-[12px] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none" />
                <div className="flex gap-2">
                  <button onClick={saveComponent} disabled={saving || !compForm.name.trim()} className="h-8 px-4 bg-slate-900 text-white rounded-lg text-[11px] flex items-center gap-1 disabled:opacity-40">{saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}Add</button>
                  <button onClick={() => { setShowAddComp(false); setCompForm({ name: '', options: '' }); }} className="h-8 px-4 bg-slate-100 text-slate-600 rounded-lg text-[11px]">Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setShowAddComp(true)} className="flex items-center gap-1.5 h-8 px-3 text-[12px] text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"><Plus className="w-3.5 h-3.5" />Add Component</button>
            )}
          </div>
        )}
      </SetupSection>

      {/* Status Thresholds */}
      <SetupSection id="thresholds" expanded={expanded} setExpanded={setExpanded} title="Status Thresholds (weeks)" count={undefined}>
        <div className="p-4 space-y-4">
          <p className="text-[12px] text-slate-500 leading-relaxed">Minimum weeks between injury start and ETR to qualify for each section. Highest active injury count determines the player's section.</p>
          <div className="grid grid-cols-3 gap-3">
            {[{ key: 'lti', label: 'Long Term Injured', colour: 'border-red-300 focus:ring-red-400' }, { key: 'sti', label: 'Short Term Injured', colour: 'border-orange-300 focus:ring-orange-400' }, { key: 'rtt', label: 'Returning to Training', colour: 'border-amber-300 focus:ring-amber-400' }].map(({ key, label, colour }) => (
              <div key={key}>
                <label className="block text-[11px] text-slate-500 mb-1">{label}</label>
                <div className="flex items-center gap-1">
                  <input type="text" inputMode="numeric" pattern="[0-9]*" value={(statusForm as any)[key]}
                    onChange={e => { const v = e.target.value.replace(/[^0-9]/g, ''); setStatusForm({ ...statusForm, [key]: v }); }}
                    disabled={!canEdit}
                    className={`w-full h-9 px-3 text-[13px] font-semibold border rounded-lg focus:outline-none focus:ring-1 ${colour} disabled:opacity-40`} />
                  <span className="text-[11px] text-slate-400 whitespace-nowrap">wks+</span>
                </div>
              </div>
            ))}
          </div>
          {canEdit && <button onClick={saveStatusDef} disabled={savingStatus} className="h-9 px-4 bg-slate-900 text-white rounded-lg text-[12px] font-medium hover:bg-slate-700 disabled:opacity-50 flex items-center gap-1.5">{savingStatus ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3.5 h-3.5" />}Save</button>}
        </div>
      </SetupSection>

      {/* RTP Phases */}
      <SetupSection id="rtp" expanded={expanded} setExpanded={setExpanded} title="RTP Phases" count={rtpPhases.length}>
        <div className="p-4 space-y-2">
          {rtpPhases.map(item => (
            <div key={item.id} className="flex items-center gap-2">
              {editingRtp === item.id ? (
                <><input value={editRtpVal} onChange={e => setEditRtpVal(e.target.value)} className="flex-1 h-8 px-3 text-[12px] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" /><button onClick={() => updateRtp(item.id)} className="h-8 px-3 bg-slate-900 text-white rounded-lg text-[11px]">Save</button><button onClick={() => setEditingRtp(null)} className="h-8 px-3 bg-slate-100 text-slate-600 rounded-lg text-[11px]">Cancel</button></>
              ) : (
                <><span className="flex-1 text-[13px] text-slate-700 px-3 py-1.5 bg-slate-50 rounded-lg border border-slate-200">{item.name}</span>{canEdit && <><button onClick={() => { setEditingRtp(item.id); setEditRtpVal(item.name); }} className="p-1.5 text-slate-300 hover:text-slate-600"><Edit2 className="w-3.5 h-3.5" /></button><button onClick={() => deleteRtp(item.id)} className="p-1.5 text-slate-300 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button></>}</>
              )}
            </div>
          ))}
          {canEdit && (
            <div className="flex gap-2 pt-1">
              <input value={newRtp} onChange={e => setNewRtp(e.target.value)} onKeyDown={e => e.key === 'Enter' && addRtp()} placeholder="Add phase…" className="flex-1 h-8 px-3 text-[12px] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
              <button onClick={addRtp} disabled={!newRtp.trim()} className="h-8 px-3 bg-slate-900 text-white rounded-lg text-[11px] disabled:opacity-40 flex items-center gap-1"><Plus className="w-3 h-3" />Add</button>
            </div>
          )}
        </div>
      </SetupSection>

      {/* Staff Leads — name + role, multi-selectable */}
      <SetupSection id="staff" expanded={expanded} setExpanded={setExpanded} title="Staff Leads" count={staffLeads.length}>
        <div className="p-4 space-y-2">
          {staffLeads.map(item => (
            <div key={item.id} className="flex items-center gap-2">
              {editingStaff === item.id ? (
                <>
                  <input value={editStaffName} onChange={e => setEditStaffName(e.target.value)} placeholder="Name" className="flex-1 h-8 px-3 text-[12px] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
                  <input value={editStaffRole} onChange={e => setEditStaffRole(e.target.value)} placeholder="Role (e.g. Physio)" className="w-28 h-8 px-3 text-[12px] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
                  <button onClick={() => updateStaff(item.id)} className="h-8 px-3 bg-slate-900 text-white rounded-lg text-[11px]">Save</button>
                  <button onClick={() => setEditingStaff(null)} className="h-8 px-3 bg-slate-100 text-slate-600 rounded-lg text-[11px]">Cancel</button>
                </>
              ) : (
                <>
                  <div className="flex-1 flex items-center gap-2 px-3 py-1.5 bg-slate-50 rounded-lg border border-slate-200">
                    <span className="text-[13px] text-slate-700 font-medium">{item.name}</span>
                    {item.role && <span className="text-[10px] text-slate-400 bg-white border border-slate-200 rounded px-1.5 py-0.5">{item.role}</span>}
                  </div>
                  {canEdit && <>
                    <button onClick={() => { setEditingStaff(item.id); setEditStaffName(item.name); setEditStaffRole(item.role); }} className="p-1.5 text-slate-300 hover:text-slate-600"><Edit2 className="w-3.5 h-3.5" /></button>
                    <button onClick={() => deleteStaff(item.id)} className="p-1.5 text-slate-300 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                  </>}
                </>
              )}
            </div>
          ))}
          {canEdit && (
            <div className="flex gap-2 pt-1">
              <input value={newStaffName} onChange={e => setNewStaffName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addStaff()} placeholder="Name" className="flex-1 h-8 px-3 text-[12px] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
              <input value={newStaffRole} onChange={e => setNewStaffRole(e.target.value)} onKeyDown={e => e.key === 'Enter' && addStaff()} placeholder="Role" className="w-28 h-8 px-3 text-[12px] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
              <button onClick={addStaff} disabled={!newStaffName.trim()} className="h-8 px-3 bg-slate-900 text-white rounded-lg text-[11px] disabled:opacity-40 flex items-center gap-1"><Plus className="w-3 h-3" />Add</button>
            </div>
          )}
        </div>
      </SetupSection>
    </div>
  );
};

// ── Athlete info panel (left column) ─────────────────────────────────────────
const InfoPanel = ({ row, athlete, weekCommencing, rtpPhases, staffLeads, fixtures, canEdit, onUpdateField }: any) => {
  const [injExpanded, setInjExpanded] = useState(false);
  const today = new Date().toISOString().split('T')[0];
  const futureFixtures = fixtures.filter((f: any) => f.date >= today);
  const activeInjuries = (athlete?.injuries || []).filter((i: any) => !i.returnDate || i.returnDate >= weekCommencing);
  const fixture = fixtures.find((f: any) => f.id === row.targetFixtureId);
  const rtpPhase = rtpPhases.find((r: any) => r.id === row.rtpPhaseId);

  return (
    <div className="p-2 space-y-2">
      {/* Injuries */}
      {activeInjuries.length > 0 ? (
        <div>
          {activeInjuries.map((inj: any) => {
            const weeksIn  = inj.startDate  ? weeksApart(inj.startDate, weekCommencing)  : null;
            const weeksRtn = inj.returnDate ? weeksApart(weekCommencing, inj.returnDate) : null;
            const urgent   = weeksRtn !== null && weeksRtn <= 2 && weeksRtn >= 0;
            return (
              <div key={inj.id} className={`rounded-lg px-2 py-1.5 text-[10px] leading-snug mb-1 ${urgent ? 'bg-amber-50 border border-amber-200' : 'bg-red-50 border border-red-100'}`}>
                <div className="flex items-center justify-between gap-1">
                  <span className={`font-bold ${urgent ? 'text-amber-700' : 'text-red-700'}`}>{inj.bodyPart}</span>
                  {inj.returnDate
                    ? <span className={`font-semibold shrink-0 text-[9px] ${urgent ? 'text-amber-600' : 'text-red-500'}`}>
                        ETR {fmtShort(inj.returnDate)}{weeksRtn !== null && <span className="ml-0.5 font-normal opacity-70">({weeksRtn > 0 ? `${weeksRtn}w` : 'due'})</span>}
                      </span>
                    : <span className="text-red-600 font-bold shrink-0 text-[9px]">Season</span>}
                </div>
                {weeksIn !== null && <div className="text-slate-400 mt-0.5">{weeksIn}w since injury</div>}
                {injExpanded && (
                  <div className="mt-1.5 pt-1.5 border-t border-slate-200 text-slate-500 space-y-0.5">
                    <div>Start: {fmtShort(inj.startDate)}</div>
                    {inj.surgeryDate && <div>Surgery: {fmtShort(inj.surgeryDate)} ({weeksApart(inj.surgeryDate, weekCommencing)}w post-op)</div>}
                    {inj.notes && <div className="italic opacity-70">{inj.notes}</div>}
                  </div>
                )}
              </div>
            );
          })}
          <button onClick={() => setInjExpanded(!injExpanded)} className="text-[9px] text-blue-400 hover:text-blue-600 font-medium">
            {injExpanded ? '▲ Less' : '▼ Full detail'}
          </button>
        </div>
      ) : (
        <div className="text-[10px] text-slate-300 italic px-1">No active injuries</div>
      )}

      <div className="border-t border-slate-100" />

      {/* RTP + Staff 2-col */}
      <div className="grid grid-cols-2 gap-1.5">
        <div>
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">RTP Phase</p>
          {canEdit ? (
            <select value={row.rtpPhaseId || ''} onChange={e => onUpdateField('rtpPhaseId', e.target.value || null)}
              className="w-full h-6 px-1 text-[10px] border border-slate-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-emerald-400">
              <option value="">—</option>
              {rtpPhases.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          ) : <span className="text-[11px] text-slate-700 font-medium">{rtpPhase?.name || <span className="text-slate-300">—</span>}</span>}
        </div>
        <div>
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Staff Lead</p>
          <StaffLeadPicker selectedIds={row.staffLeadIds || []} staffLeads={staffLeads} canEdit={canEdit}
            onChange={ids => onUpdateField('staffLeadIds', ids)} />
        </div>
      </div>

      {/* Target Fixture */}
      <div>
        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Target Fixture</p>
        {canEdit ? (
          <select value={row.targetFixtureId || ''} onChange={e => onUpdateField('targetFixtureId', e.target.value || null)}
            className="w-full h-6 px-1 text-[10px] border border-slate-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-emerald-400">
            <option value="">—</option>
            {futureFixtures.map((f: any) => <option key={f.id} value={f.id}>{fmtShort(f.date)} · {f.opposition} ({f.homeAway})</option>)}
          </select>
        ) : fixture ? (
          <div className="text-[10px] leading-snug">
            <span className="font-semibold text-slate-700">{fixture.opposition}</span><span className="text-slate-400 ml-1">({fixture.homeAway})</span>
            <div className="text-slate-400">{fmtShort(fixture.date)}</div>
          </div>
        ) : <span className="text-slate-300 text-[10px]">—</span>}
      </div>

      {/* Week Overview */}
      <div>
        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Overview</p>
        {canEdit ? (
          <textarea value={row.weekOverview} onChange={e => onUpdateField('weekOverview', e.target.value)}
            rows={2} placeholder="Week overview…"
            className="w-full px-1.5 py-1 text-[10px] border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-emerald-400 resize-none leading-snug bg-slate-50" />
        ) : row.weekOverview ? (
          <p className="text-[10px] text-slate-600 whitespace-pre-wrap leading-snug">{row.weekOverview}</p>
        ) : <span className="text-slate-300 text-[10px]">—</span>}
      </div>
    </div>
  );
};

// ── Athlete Row (weekly view) ─────────────────────────────────────────────────
const AthleteRow = ({ row, athlete, components, weekDates, rtpPhases, staffLeads, fixtures, canEdit, isPlayer, weekCommencing, onUpdateEntry, onUpdateField, onRemove, onCopyPrev, hasPrevWeek }: any) => {
  const [collapsed, setCollapsed] = useState(false);
  const nComp = Math.max(components.length, 1);

  return (
    <div className="border-b-2 border-slate-200 last:border-0">
      {/* Name bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 text-white">
        <button onClick={() => setCollapsed(!collapsed)} className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-bold shrink-0">{athlete?.avatar || athlete?.name?.[0] || '?'}</div>
          <span className="text-[13px] font-semibold truncate">{athlete?.name}</span>
          {collapsed ? <ChevronDown className="w-3.5 h-3.5 text-white/50 shrink-0" /> : <ChevronUp className="w-3.5 h-3.5 text-white/50 shrink-0" />}
        </button>
        <div className="flex items-center gap-1.5 shrink-0">
          {hasPrevWeek && canEdit && (
            <button onClick={onCopyPrev} className="flex items-center gap-1 h-6 px-2 text-[10px] font-medium text-white/60 border border-white/20 rounded hover:bg-white/10 transition-colors">
              <Copy className="w-3 h-3" />Copy prev
            </button>
          )}
          {canEdit && <button onClick={onRemove} className="p-1 text-white/30 hover:text-red-400"><X className="w-3.5 h-3.5" /></button>}
        </div>
      </div>

      {!collapsed && (
        <div className="overflow-x-auto bg-white">
          <table className="w-full border-collapse text-left" style={{ minWidth: isPlayer ? '560px' : '820px' }}>
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {!isPlayer && <th className="px-3 py-1.5 text-[9px] font-bold text-slate-400 uppercase tracking-wider border-r border-slate-200 w-52">Player Info</th>}
                <th className="px-2 py-1 text-[9px] font-bold text-slate-400 uppercase tracking-wider w-28 border-r border-slate-200">Component</th>
                {weekDates.map((d: string, i: number) => (
                  <th key={d} className="py-1 text-center w-20 border-r border-slate-100 last:border-0">
                    <span className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider">{DAY_LABELS[i]}</span>
                    <span className="block text-[13px] font-bold text-slate-700 leading-tight">{fmtDayNum(d)}</span>
                    <span className="block text-[9px] text-slate-400">{fmtShort(d).split(' ')[1]}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {components.map((comp: RehabComponent, ci: number) => (
                <tr key={comp.id} className={`border-b border-slate-50 last:border-0 ${ci % 2 === 0 ? '' : 'bg-slate-50/40'}`}>
                  {!isPlayer && ci === 0 && (
                    <td rowSpan={nComp} className="align-top border-r border-slate-200 p-0 w-52">
                      <InfoPanel row={row} athlete={athlete} weekCommencing={weekCommencing} rtpPhases={rtpPhases} staffLeads={staffLeads} fixtures={fixtures} canEdit={canEdit} onUpdateField={onUpdateField} />
                    </td>
                  )}
                  <td className="px-2 py-0.5 text-[11px] font-medium text-slate-600 border-r border-slate-100 max-w-[112px] align-middle">
                    <span className="block truncate" title={comp.name}>{comp.name}</span>
                  </td>
                  {weekDates.map((date: string) => (
                    <td key={date} className="px-0.5 py-0.5 text-center align-middle border-r border-slate-50 last:border-0">
                      <ComboCell value={row.entries[comp.id]?.[date] || ''} options={comp.options} canEdit={canEdit} onChange={v => onUpdateEntry(comp.id, date, v)} />
                    </td>
                  ))}
                </tr>
              ))}
              {components.length === 0 && (
                <tr>
                  {!isPlayer && <td className="align-top border-r border-slate-200 p-0 w-52"><InfoPanel row={row} athlete={athlete} weekCommencing={weekCommencing} rtpPhases={rtpPhases} staffLeads={staffLeads} fixtures={fixtures} canEdit={canEdit} onUpdateField={onUpdateField} /></td>}
                  <td colSpan={8} className="px-3 py-4 text-[11px] text-slate-300 italic text-center">Add rehab components in Setup</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ── Day View ──────────────────────────────────────────────────────────────────
const DayView = ({ rows, allAthletes, components, weekDates, staffLeads, canEdit, isPlayer, weekCommencing, onUpdateEntry }: any) => {
  const today = new Date().toISOString().split('T')[0];
  const defaultDay = weekDates.find((d: string) => d === today) || weekDates[0];
  const [activeDay, setActiveDay] = useState(defaultDay);

  const activeRows = rows.filter((r: PlanRow) => {
    const athlete = allAthletes.find((a: Athlete) => a.id === r.athleteId);
    return !!athlete;
  });

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Day tabs — Training Planner style */}
      <div className="bg-white border-b border-slate-200 px-4 py-2">
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="grid grid-cols-7 divide-x divide-slate-100">
            {weekDates.map((date: string, i: number) => {
              const isActive = date === activeDay;
              const isToday  = date === today;
              const hasData  = rows.some((r: PlanRow) => components.some((c: RehabComponent) => r.entries[c.id]?.[date]));
              return (
                <button key={date} onClick={() => setActiveDay(date)}
                  className={`flex flex-col items-center py-2.5 px-1 transition-colors ${isActive ? 'bg-slate-900 text-white' : 'hover:bg-slate-50 text-slate-600'}`}>
                  <span className={`text-[10px] font-semibold ${isActive ? 'text-white/60' : 'text-slate-400'}`}>{DAY_LABELS[i]}</span>
                  <span className={`text-[18px] font-bold leading-tight ${isToday && !isActive ? 'text-blue-600' : ''}`}>{fmtDayNum(date)}</span>
                  <span className={`text-[9px] ${isActive ? 'text-white/50' : 'text-slate-400'}`}>{fmtShort(date).split(' ')[1]}</span>
                  {hasData && <span className={`w-1 h-1 rounded-full mt-0.5 ${isActive ? 'bg-white/60' : 'bg-emerald-400'}`} />}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Day content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <p className="text-[13px]">No athletes on this plan</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            {/* Header */}
            <div className="grid border-b border-slate-200 bg-slate-50" style={{ gridTemplateColumns: `200px repeat(${components.length}, minmax(120px, 1fr))` }}>
              <div className="px-3 py-2.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-r border-slate-200">Athlete</div>
              {components.map((c: RehabComponent) => (
                <div key={c.id} className="px-2 py-2.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-r border-slate-200 last:border-0 truncate">{c.name}</div>
              ))}
              {components.length === 0 && <div className="px-3 py-2.5 text-[10px] text-slate-300 italic">No components</div>}
            </div>
            {/* Rows */}
            {activeRows.map((row: PlanRow, ri: number) => {
              const athlete = allAthletes.find((a: Athlete) => a.id === row.athleteId);
              if (!athlete) return null;
              const sectionBg = { LTI: 'bg-red-600', STI: 'bg-orange-500', RTT: 'bg-amber-400', Other: 'bg-slate-400' }[row.section] || 'bg-slate-400';
              return (
                <div key={row.id} className={`grid border-b border-slate-100 last:border-0 ${ri % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}
                  style={{ gridTemplateColumns: `200px repeat(${components.length || 1}, minmax(120px, 1fr))` }}>
                  {/* Athlete name + section dot */}
                  <div className="px-3 py-2 flex items-center gap-2 border-r border-slate-100">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${sectionBg}`} />
                    <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-600 shrink-0">{athlete.avatar || athlete.name[0]}</div>
                    <span className="text-[12px] font-semibold text-slate-800 truncate">{athlete.name}</span>
                  </div>
                  {components.length === 0
                    ? <div className="px-3 py-2 text-[11px] text-slate-300 italic">—</div>
                    : components.map((comp: RehabComponent) => (
                      <div key={comp.id} className="px-1 py-1 border-r border-slate-100 last:border-0 flex items-center">
                        <ComboCell value={row.entries[comp.id]?.[activeDay] || ''} options={comp.options} canEdit={canEdit} onChange={v => onUpdateEntry(row.id, comp.id, activeDay, v)} />
                      </div>
                    ))
                  }
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Add Athlete Modal ─────────────────────────────────────────────────────────
const AddAthleteModal = ({ athletes, existingIds, onAdd, onClose }: any) => {
  const [search, setSearch] = useState('');
  const available = athletes.filter((a: Athlete) => !existingIds.includes(a.id) && a.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h3 className="text-[14px] font-semibold text-slate-900">Add Athlete</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-slate-400 hover:text-slate-600" /></button>
        </div>
        <div className="p-3">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search athletes…"
            className="w-full h-9 px-3 text-[12px] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 mb-2" />
          <div className="max-h-64 overflow-y-auto space-y-1">
            {available.length === 0
              ? <p className="text-[12px] text-slate-400 text-center py-4">No athletes found</p>
              : available.map((a: Athlete) => (
                <button key={a.id} onClick={() => onAdd(a)} className="w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-slate-50 transition-colors">
                  <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-600 shrink-0">{a.avatar || a.name[0]}</div>
                  <div><p className="text-[13px] font-medium text-slate-800">{a.name}</p><p className="text-[10px] text-slate-400">{a.status}</p></div>
                </button>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Main Planner Page ─────────────────────────────────────────────────────────
const RehabPlannerPage = ({ clubId, role }: { clubId: string; role: Role }) => {
  const canEdit = canEditRole(role);
  const isPlayer = role === 'Player';
  const today = new Date().toISOString().split('T')[0];
  const currentMonday = getMondayOf(today);

  const [weekCommencing, setWeekCommencing] = useState(currentMonday);
  const weekDates = useMemo(() => getWeekDates(weekCommencing), [weekCommencing]);
  const [viewMode, setViewMode] = useState<'week' | 'day'>('week');

  const [components, setComponents] = useState<RehabComponent[]>([]);
  const [statusDef, setStatusDef] = useState<StatusDefinition | null>(null);
  const [rtpPhases, setRtpPhases] = useState<RTPPhase[]>([]);
  const [staffLeads, setStaffLeads] = useState<StaffLead[]>([]);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [allAthletes, setAllAthletes] = useState<Athlete[]>([]);
  const [planId, setPlanId] = useState<string | null>(null);
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [showAddAthlete, setShowAddAthlete] = useState(false);
  const [prevWeekAthleteIds, setPrevWeekAthleteIds] = useState<Set<string>>(new Set());

  const loadSetup = useCallback(async () => {
    const [{ data: compData }, { data: statusData }, { data: rtpData }, { data: staffData }, { data: fixtureData }, { data: athleteData }, { data: injData }] = await Promise.all([
      supabase.from('rehab_components').select('*').eq('club_id', clubId).order('sort_order'),
      supabase.from('rehab_status_definitions').select('*').eq('club_id', clubId).maybeSingle(),
      supabase.from('rtp_phases').select('*').eq('club_id', clubId).order('sort_order'),
      supabase.from('staff_leads').select('*').eq('club_id', clubId).order('sort_order'),
      supabase.from('fixtures').select('*').eq('club_id', clubId).order('date'),
      supabase.from('athletes').select('*').order('name'),
      supabase.from('athlete_injuries').select('*'),
    ]);
    setComponents((compData || []).map((c: any) => ({ id: c.id, name: c.name, options: Array.isArray(c.options) ? c.options : JSON.parse(c.options || '[]'), sortOrder: c.sort_order })));
    if (statusData) setStatusDef({ id: statusData.id, ltiWeeksMin: statusData.lti_weeks_min, stiWeeksMin: statusData.sti_weeks_min, rttWeeksMin: statusData.rtt_weeks_min });
    setRtpPhases((rtpData || []).map((r: any) => ({ id: r.id, name: r.name, sortOrder: r.sort_order })));
    setStaffLeads((staffData || []).map((s: any) => ({ id: s.id, name: s.name, role: s.role || '', sortOrder: s.sort_order })));
    setFixtures((fixtureData || []).map((f: any) => ({ id: f.id, date: f.date, opposition: f.opposition, homeAway: f.home_away })));
    const injuries = injData || [];
    setAllAthletes((athleteData || []).map((a: any) => ({ id: a.id, name: a.name, status: a.status, avatar: a.avatar, injuries: injuries.filter((i: any) => i.athlete_id === a.id).map((i: any) => ({ id: i.id, bodyPart: i.body_part, startDate: i.start_date, returnDate: i.return_date, surgeryDate: i.surgery_date || null, notes: i.notes || '', event: i.event })) })));
  }, [clubId]);

  const loadWeekPlan = useCallback(async (wc: string) => {
    setLoading(true);
    const { data: plan } = await supabase.from('rehab_plans').select('id').eq('club_id', clubId).eq('week_commencing', wc).maybeSingle();
    if (!plan) { setPlanId(null); setRows([]); setLoading(false); return; }
    setPlanId(plan.id);
    const { data: rowData } = await supabase.from('rehab_plan_rows').select('*').eq('plan_id', plan.id).order('sort_order');
    if (!rowData?.length) { setRows([]); setLoading(false); return; }
    const rowIds = rowData.map((r: any) => r.id);
    const { data: entryData } = await supabase.from('rehab_component_entries').select('*').in('plan_row_id', rowIds);
    const entries: Record<string, Record<string, Record<string, string>>> = {};
    for (const e of (entryData || [])) {
      if (!entries[e.plan_row_id]) entries[e.plan_row_id] = {};
      if (!entries[e.plan_row_id][e.component_id]) entries[e.plan_row_id][e.component_id] = {};
      entries[e.plan_row_id][e.component_id][e.day_date] = e.value;
    }
    setRows(rowData.map((r: any) => ({
      id: r.id, planId: r.plan_id, athleteId: r.athlete_id, section: r.section,
      rtpPhaseId: r.rtp_phase_id,
      staffLeadIds: Array.isArray(r.staff_lead_ids) ? r.staff_lead_ids : (r.staff_lead_id ? [r.staff_lead_id] : []),
      targetFixtureId: r.target_fixture_id, weekOverview: r.week_overview || '',
      sortOrder: r.sort_order, entries: entries[r.id] || {},
    })));
    setLoading(false);
  }, [clubId]);

  useEffect(() => { loadSetup().then(() => loadWeekPlan(weekCommencing)); }, []);
  useEffect(() => { loadWeekPlan(weekCommencing); }, [weekCommencing]);

  useEffect(() => {
    const check = async () => {
      const d = new Date(weekCommencing + 'T00:00:00'); d.setDate(d.getDate() - 7);
      const prevMonday = d.toISOString().split('T')[0];
      const { data: prevPlan } = await supabase.from('rehab_plans').select('id').eq('club_id', clubId).eq('week_commencing', prevMonday).maybeSingle();
      if (!prevPlan) { setPrevWeekAthleteIds(new Set()); return; }
      const { data: prevRows } = await supabase.from('rehab_plan_rows').select('athlete_id').eq('plan_id', prevPlan.id);
      setPrevWeekAthleteIds(new Set((prevRows || []).map((r: any) => r.athlete_id)));
    };
    check();
  }, [weekCommencing, clubId]);

  const createPlan = async () => {
    setCreating(true);
    const { data: newPlan } = await supabase.from('rehab_plans').insert({ club_id: clubId, week_commencing: weekCommencing }).select().single();
    if (!newPlan) { setCreating(false); return; }
    setPlanId(newPlan.id);
    const unavailable = allAthletes.filter(a => a.status === 'Unavailable');
    const newRows: PlanRow[] = [];
    for (let i = 0; i < unavailable.length; i++) {
      const a = unavailable[i];
      const section = getInjurySection(a, weekCommencing, statusDef);
      const { data: rowData } = await supabase.from('rehab_plan_rows').insert({ plan_id: newPlan.id, athlete_id: a.id, section, sort_order: i, week_overview: '', staff_lead_ids: [] }).select().single();
      if (rowData) newRows.push({ id: rowData.id, planId: newPlan.id, athleteId: a.id, section, rtpPhaseId: null, staffLeadIds: [], targetFixtureId: null, weekOverview: '', sortOrder: i, entries: {} });
    }
    setRows(newRows); setCreating(false);
  };

  const saveRowField = async (rowId: string, field: string, value: any) => {
    const map: Record<string, string> = { rtpPhaseId: 'rtp_phase_id', staffLeadIds: 'staff_lead_ids', targetFixtureId: 'target_fixture_id', weekOverview: 'week_overview' };
    await supabase.from('rehab_plan_rows').update({ [map[field]]: value }).eq('id', rowId);
  };
  const updateRowField = (rowId: string, field: string, value: any) => {
    setRows(prev => prev.map(r => r.id === rowId ? { ...r, [field]: value } : r));
    saveRowField(rowId, field, value);
  };

  const saveEntry = async (rowId: string, componentId: string, date: string, value: string) => {
    if (value) await supabase.from('rehab_component_entries').upsert({ plan_row_id: rowId, component_id: componentId, day_date: date, value }, { onConflict: 'plan_row_id,component_id,day_date' });
    else await supabase.from('rehab_component_entries').delete().eq('plan_row_id', rowId).eq('component_id', componentId).eq('day_date', date);
  };
  const updateEntry = (rowId: string, componentId: string, date: string, value: string) => {
    setRows(prev => prev.map(r => {
      if (r.id !== rowId) return r;
      const e = { ...r.entries };
      if (!e[componentId]) e[componentId] = {};
      e[componentId] = { ...e[componentId], [date]: value };
      return { ...r, entries: e };
    }));
    saveEntry(rowId, componentId, date, value);
  };

  const addAthlete = async (athlete: Athlete) => {
    if (!planId) return;
    const section = getInjurySection(athlete, weekCommencing, statusDef);
    const { data: rowData } = await supabase.from('rehab_plan_rows').insert({ plan_id: planId, athlete_id: athlete.id, section, sort_order: rows.length, week_overview: '', staff_lead_ids: [] }).select().single();
    if (rowData) setRows(prev => [...prev, { id: rowData.id, planId, athleteId: athlete.id, section, rtpPhaseId: null, staffLeadIds: [], targetFixtureId: null, weekOverview: '', sortOrder: rows.length, entries: {} }]);
    setShowAddAthlete(false);
  };

  const removeRow = async (rowId: string) => { await supabase.from('rehab_plan_rows').delete().eq('id', rowId); setRows(prev => prev.filter(r => r.id !== rowId)); };

  const copyFromPrevWeek = async (row: PlanRow) => {
    const d = new Date(weekCommencing + 'T00:00:00'); d.setDate(d.getDate() - 7);
    const prevMonday = d.toISOString().split('T')[0];
    const prevDates = getWeekDates(prevMonday);
    const { data: prevPlan } = await supabase.from('rehab_plans').select('id').eq('club_id', clubId).eq('week_commencing', prevMonday).maybeSingle();
    if (!prevPlan) return;
    const { data: prevRow } = await supabase.from('rehab_plan_rows').select('*').eq('plan_id', prevPlan.id).eq('athlete_id', row.athleteId).maybeSingle();
    if (!prevRow) return;
    const { data: prevEntries } = await supabase.from('rehab_component_entries').select('*').eq('plan_row_id', prevRow.id);
    await supabase.from('rehab_plan_rows').update({ rtp_phase_id: prevRow.rtp_phase_id, staff_lead_ids: prevRow.staff_lead_ids || [], target_fixture_id: prevRow.target_fixture_id, week_overview: prevRow.week_overview }).eq('id', row.id);
    const newEntries: Record<string, Record<string, string>> = {};
    for (const e of (prevEntries || [])) {
      const prevIdx = prevDates.indexOf(e.day_date);
      if (prevIdx === -1) continue;
      const newDate = weekDates[prevIdx];
      if (!newEntries[e.component_id]) newEntries[e.component_id] = {};
      newEntries[e.component_id][newDate] = e.value;
      await supabase.from('rehab_component_entries').upsert({ plan_row_id: row.id, component_id: e.component_id, day_date: newDate, value: e.value }, { onConflict: 'plan_row_id,component_id,day_date' });
    }
    setRows(prev => prev.map(r => r.id === row.id ? { ...r, rtpPhaseId: prevRow.rtp_phase_id, staffLeadIds: prevRow.staff_lead_ids || [], targetFixtureId: prevRow.target_fixture_id, weekOverview: prevRow.week_overview || '', entries: newEntries } : r));
  };

  const rowsBySection = useMemo(() => {
    const grouped: Record<string, PlanRow[]> = { LTI: [], STI: [], RTT: [], Other: [] };
    for (const row of rows) {
      const athlete = allAthletes.find(a => a.id === row.athleteId);
      const section = athlete && statusDef ? getInjurySection(athlete, weekCommencing, statusDef) : row.section;
      grouped[section]?.push(row);
    }
    return grouped;
  }, [rows, allAthletes, statusDef, weekCommencing]);

  const prevWeek = () => { const d = new Date(weekCommencing + 'T00:00:00'); d.setDate(d.getDate() - 7); setWeekCommencing(d.toISOString().split('T')[0]); };
  const nextWeek = () => { const d = new Date(weekCommencing + 'T00:00:00'); d.setDate(d.getDate() + 7); setWeekCommencing(d.toISOString().split('T')[0]); };
  const toggleSection = (s: string) => setCollapsedSections(prev => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });

  if (loading) return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Week nav + view toggle */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-20">
        <button onClick={prevWeek} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"><ChevronLeft className="w-4 h-4 text-slate-600" /></button>
        <div className="flex-1 text-center">
          <p className="text-[14px] font-semibold text-slate-900">w/c {fmtWC(weekCommencing)}</p>
          {weekCommencing === currentMonday && <span className="text-[10px] text-blue-500 font-medium">Current week</span>}
        </div>
        <button onClick={nextWeek} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"><ChevronRight className="w-4 h-4 text-slate-600" /></button>

        {/* View toggle */}
        <div className="flex items-center bg-slate-100 rounded-lg p-0.5 ml-1">
          <button onClick={() => setViewMode('week')}
            className={`flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-medium transition-colors ${viewMode === 'week' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            <List className="w-3.5 h-3.5" />Week
          </button>
          <button onClick={() => setViewMode('day')}
            className={`flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-medium transition-colors ${viewMode === 'day' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            <LayoutGrid className="w-3.5 h-3.5" />Day
          </button>
        </div>

        {planId && canEdit && (
          <button onClick={() => setShowAddAthlete(true)} className="flex items-center gap-1.5 h-8 px-3 bg-slate-900 text-white rounded-lg text-[12px] font-medium hover:bg-slate-700 transition-colors">
            <Plus className="w-3.5 h-3.5" />Add Athlete
          </button>
        )}
      </div>

      {/* No plan */}
      {!planId ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
          <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center"><Target className="w-6 h-6 text-emerald-600" /></div>
          <div className="text-center">
            <p className="text-[15px] font-semibold text-slate-800 mb-1">No plan for this week</p>
            <p className="text-[13px] text-slate-400">w/c {fmtWC(weekCommencing)}</p>
          </div>
          {canEdit && (
            <button onClick={createPlan} disabled={creating}
              className="flex items-center gap-2 h-10 px-5 bg-emerald-600 text-white rounded-lg text-[13px] font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors">
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {creating ? 'Creating…' : 'Create Planner'}
            </button>
          )}
        </div>
      ) : viewMode === 'day' ? (
        <DayView rows={rows} allAthletes={allAthletes} components={components} weekDates={weekDates} staffLeads={staffLeads} canEdit={canEdit} isPlayer={isPlayer} weekCommencing={weekCommencing}
          onUpdateEntry={(rowId: string, compId: string, date: string, v: string) => updateEntry(rowId, compId, date, v)} />
      ) : (
        <div className="flex-1 overflow-y-auto">
          {rows.length === 0 && <div className="p-8 text-center text-[13px] text-slate-400">No athletes on this plan.{canEdit && ' Use "Add Athlete" to add players.'}</div>}
          {SECTION_ORDER.map(section => {
            const sectionRows = rowsBySection[section];
            if (!sectionRows.length) return null;
            const collapsed = collapsedSections.has(section);
            return (
              <div key={section} className="mb-2">
                <button onClick={() => toggleSection(section)} className={`w-full flex items-center justify-between px-4 py-2.5 ${SECTION_BG[section]} text-white`}>
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-bold">{SECTION_LABELS[section]}</span>
                    <span className="text-[11px] text-white/70">{sectionRows.length} athlete{sectionRows.length !== 1 ? 's' : ''}</span>
                  </div>
                  {collapsed ? <ChevronDown className="w-4 h-4 text-white/70" /> : <ChevronUp className="w-4 h-4 text-white/70" />}
                </button>
                {!collapsed && (
                  <div className={`border-l-4 ${SECTION_BORDER[section]}`}>
                    {sectionRows.map(row => {
                      const athlete = allAthletes.find(a => a.id === row.athleteId);
                      if (!athlete) return null;
                      return (
                        <AthleteRow key={row.id} row={row} athlete={athlete} components={components} weekDates={weekDates} rtpPhases={rtpPhases} staffLeads={staffLeads} fixtures={fixtures} canEdit={canEdit} isPlayer={isPlayer} weekCommencing={weekCommencing}
                          hasPrevWeek={prevWeekAthleteIds.has(row.athleteId)}
                          onUpdateEntry={(compId: string, date: string, v: string) => updateEntry(row.id, compId, date, v)}
                          onUpdateField={(field: string, v: any) => updateRowField(row.id, field, v)}
                          onRemove={() => removeRow(row.id)}
                          onCopyPrev={() => copyFromPrevWeek(row)} />
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showAddAthlete && <AddAthleteModal athletes={allAthletes} existingIds={rows.map(r => r.athleteId)} onAdd={addAthlete} onClose={() => setShowAddAthlete(false)} />}
    </div>
  );
};

// ── App Shell ─────────────────────────────────────────────────────────────────
export function RehabPlanner({ role, clubId, authUser, onBack }: { role: Role; clubId: string; authUser: any; onBack: () => void }) {
  const [page, setPage] = useState<'planner' | 'setup'>('planner');

  // Admin can preview other roles
  const [viewingAs, setViewingAs] = React.useState<Role>(role);
  React.useEffect(() => { setViewingAs(role); }, [role]);
  const effectiveRole: Role = role === 'Admin' ? viewingAs : role;

  const showSetup = canEditRole(effectiveRole);
  const navItems = [
    { id: 'planner', label: 'Rehab Planner', Icon: Target },
    ...(showSetup ? [{ id: 'setup', label: 'Setup', Icon: Settings }] : []),
  ];
  return (
    <div className="min-h-screen bg-slate-50 flex">
      <aside className="hidden md:flex flex-col w-52 shrink-0 bg-slate-900 sticky top-0 h-screen">
        <div className="px-4 py-5 border-b border-white/[0.06]">
          <button onClick={onBack} className="flex items-center gap-1.5 text-white/40 hover:text-white/70 text-[11px] mb-3 transition-colors"><ArrowLeft className="w-3 h-3" />All Apps</button>
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded bg-emerald-600 flex items-center justify-center shrink-0"><Target className="w-3.5 h-3.5 text-white" strokeWidth={2.5} /></div>
            <span className="text-[13px] font-semibold text-slate-100 tracking-tight">Rehab Planner</span>
          </div>
        </div>
        <nav className="flex-1 p-2 pt-3 space-y-0.5">
          <p className="text-[9px] font-semibold text-white/25 uppercase tracking-[0.9px] px-2.5 pb-2">Menu</p>
          {navItems.map(({ id, label, Icon }) => (
            <button key={id} onClick={() => setPage(id as any)}
              className={`w-full text-left px-2.5 py-2 rounded flex items-center gap-2.5 text-[13px] transition-colors relative ${page === id ? 'bg-white/[0.08] text-slate-100 font-medium' : 'text-white/40 hover:bg-white/[0.06] hover:text-white/70'}`}>
              {page === id && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-emerald-400 rounded-r" />}
              <Icon className="w-3.5 h-3.5 shrink-0" />{label}
            </button>
          ))}
        </nav>
        <div className="p-3 border-t border-white/[0.06]">
          {role === 'Admin' && (
            <div className="mb-2.5">
              <p className="text-[9px] font-semibold text-white/25 uppercase tracking-[0.9px] mb-1">View as</p>
              <select value={viewingAs} onChange={e => setViewingAs(e.target.value as Role)}
                className="w-full h-7 px-2 text-[11px] rounded bg-white/[0.06] text-white/70 border border-white/10 focus:outline-none">
                {(['Admin','S&C','Physio','Player'] as Role[]).map(r => <option key={r} value={r} className="bg-slate-900">{r}</option>)}
              </select>
            </div>
          )}
          <p className="text-[9px] font-semibold text-white/25 uppercase tracking-[0.9px] mb-1">Signed in</p>
          <p className="text-[11px] text-white/50 truncate">{authUser?.email}</p>
          <p className="text-[10px] text-white/30 mt-0.5">{effectiveRole}</p>
          <button onClick={() => supabase.auth.signOut()} className="mt-2 w-full flex items-center gap-2 px-2.5 py-1.5 text-[12px] text-white/40 hover:text-white/70 hover:bg-white/[0.06] rounded transition-colors"><X className="w-3 h-3" />Sign out</button>
        </div>
      </aside>
      <div className="flex-1 flex flex-col min-h-screen min-w-0">
        <header className="md:hidden bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
          <button onClick={onBack} className="p-1.5 hover:bg-slate-100 rounded-lg"><ChevronLeft className="w-5 h-5 text-slate-600" /></button>
          <h1 className="text-[15px] font-semibold text-slate-900 flex-1">Rehab Planner</h1>
          {showSetup && <button onClick={() => setPage(page === 'setup' ? 'planner' : 'setup')} className={`p-1.5 rounded-lg ${page === 'setup' ? 'bg-slate-100 text-slate-900' : 'text-slate-400 hover:bg-slate-100'}`}><Settings className="w-4 h-4" /></button>}
        </header>
        <div className="hidden md:flex items-center justify-between bg-white border-b border-slate-200 px-6 py-3.5">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900 leading-none">{page === 'setup' ? 'Rehab Setup' : 'Rehab Planner'}</h2>
            <p className="text-[11px] text-slate-400 mt-1 font-light">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
          </div>
        </div>
        {page === 'setup' ? <RehabSetupPage clubId={clubId} role={effectiveRole} /> : <RehabPlannerPage clubId={clubId} role={effectiveRole} />}
      </div>
    </div>
  );
}
