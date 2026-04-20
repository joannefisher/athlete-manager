'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Plus, X, ChevronDown, ChevronUp, ArrowLeft, Loader2, Settings, Check, Trash2, Edit2, ChevronLeft, ChevronRight, Copy, AlertCircle, Target } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Role } from './AthleteManager';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Injury {
  id: string;
  bodyPart: string;
  startDate: string;
  returnDate: string | null;
  surgeryDate?: string | null;
  notes: string;
  event?: string;
}

interface Athlete {
  id: string;
  name: string;
  status: string;
  avatar: string;
  injuries: Injury[];
}

interface RehabComponent {
  id: string;
  name: string;
  options: string[];
  sortOrder: number;
}

interface RTPPhase { id: string; name: string; sortOrder: number; }
interface StaffLead { id: string; name: string; sortOrder: number; }
interface Fixture { id: string; date: string; opposition: string; homeAway: string; }

interface StatusDefinition {
  id: string;
  ltiWeeksMin: number;  // >= this = Long Term Injured
  stiWeeksMin: number;  // >= this = Short Term Injured
  rttWeeksMin: number;  // >= this = Returning to Training
}

interface PlanRow {
  id: string;
  planId: string;
  athleteId: string;
  section: 'LTI' | 'STI' | 'RTT' | 'Other';
  rtpPhaseId: string | null;
  staffLeadId: string | null;
  targetFixtureId: string | null;
  weekOverview: string;
  sortOrder: number;
  // component entries: componentId → dayDate → value
  entries: Record<string, Record<string, string>>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const getWeekDates = (date: string): string[] => {
  const d = new Date(date + 'T00:00:00');
  const day = d.getDay();
  const mon = new Date(d);
  mon.setDate(d.getDate() - ((day + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const dd = new Date(mon);
    dd.setDate(mon.getDate() + i);
    return dd.toISOString().split('T')[0];
  });
};

const getMondayOf = (date: string): string => getWeekDates(date)[0];

const fmtWC = (d: string) => {
  if (!d) return '';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

const fmtShort = (d: string) => {
  if (!d) return '';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const weeksApart = (from: string, to: string): number => {
  const ms = new Date(to + 'T00:00:00').getTime() - new Date(from + 'T00:00:00').getTime();
  return Math.round(ms / (7 * 24 * 60 * 60 * 1000));
};

// Calculate injury section based on active injuries and thresholds
const getInjurySection = (
  athlete: Athlete,
  weekCommencing: string,
  statusDef: StatusDefinition | null
): 'LTI' | 'STI' | 'RTT' | 'Other' => {
  const today = weekCommencing;
  const active = athlete.injuries.filter(
    i => !i.returnDate || i.returnDate >= today
  );
  if (!active.length || !statusDef) return 'Other';

  // Find max weeks (injury start → ETR)
  let maxWeeks = 0;
  for (const inj of active) {
    if (inj.startDate && inj.returnDate) {
      const w = weeksApart(inj.startDate, inj.returnDate);
      if (w > maxWeeks) maxWeeks = w;
    } else if (inj.startDate && !inj.returnDate) {
      maxWeeks = 999; // Season-ending → always LTI
    }
  }

  if (maxWeeks >= statusDef.ltiWeeksMin) return 'LTI';
  if (maxWeeks >= statusDef.stiWeeksMin) return 'STI';
  if (maxWeeks >= statusDef.rttWeeksMin) return 'RTT';
  return 'Other';
};

const SECTION_LABELS: Record<string, string> = {
  LTI: 'Long Term Injured',
  STI: 'Short Term Injured',
  RTT: 'Returning to Training',
  Other: 'Other',
};
const SECTION_ORDER = ['LTI', 'STI', 'RTT', 'Other'] as const;
const SECTION_COLOURS: Record<string, string> = {
  LTI: 'bg-red-700',
  STI: 'bg-orange-600',
  RTT: 'bg-amber-500',
  Other: 'bg-slate-500',
};
const SECTION_LIGHT: Record<string, string> = {
  LTI: 'bg-red-50 border-red-200',
  STI: 'bg-orange-50 border-orange-200',
  RTT: 'bg-amber-50 border-amber-200',
  Other: 'bg-slate-50 border-slate-200',
};

const canEditRole = (role: Role) => role === 'Admin' || role === 'S&C' || role === 'Physio';

// ── Setup sub-components (defined at module level to prevent remount on re-render) ──

const SetupSection = ({ id, expanded, setExpanded, title, count, children }: any) => (
  <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
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

const SimplePicklist = ({ items, onAdd, onEdit, onDelete, newVal, setNewVal, editingId, setEditingId, editVal, setEditVal, canEdit }: any) => (
  <div className="p-4 space-y-2">
    {items.map((item: any) => (
      <div key={item.id} className="flex items-center gap-2">
        {editingId === item.id ? (
          <>
            <input value={editVal} onChange={e => setEditVal(e.target.value)}
              className="flex-1 h-8 px-3 text-[12px] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
            <button onClick={() => onEdit(item.id)} className="h-8 px-3 bg-slate-900 text-white rounded-lg text-[11px]">Save</button>
            <button onClick={() => setEditingId(null)} className="h-8 px-3 bg-slate-100 text-slate-600 rounded-lg text-[11px]">Cancel</button>
          </>
        ) : (
          <>
            <span className="flex-1 text-[13px] text-slate-700 px-3 py-1.5 bg-slate-50 rounded-lg border border-slate-200">{item.name}</span>
            {canEdit && <>
              <button onClick={() => { setEditingId(item.id); setEditVal(item.name); }} className="p-1.5 text-slate-300 hover:text-slate-600"><Edit2 className="w-3.5 h-3.5" /></button>
              <button onClick={() => onDelete(item.id)} className="p-1.5 text-slate-300 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
            </>}
          </>
        )}
      </div>
    ))}
    {canEdit && (
      <div className="flex gap-2 pt-1">
        <input value={newVal} onChange={e => setNewVal(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onAdd()}
          placeholder="Add option…"
          className="flex-1 h-8 px-3 text-[12px] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
        <button onClick={onAdd} disabled={!newVal.trim()}
          className="h-8 px-3 bg-slate-900 text-white rounded-lg text-[11px] disabled:opacity-40 flex items-center gap-1">
          <Plus className="w-3 h-3" />Add
        </button>
      </div>
    )}
  </div>
);

// ── Setup Page ────────────────────────────────────────────────────────────────
const RehabSetupPage = ({ clubId, role }: { clubId: string; role: Role }) => {
  const canEdit = canEditRole(role);
  const [expanded, setExpanded] = useState<string>('components');

  // Rehab Components
  const [components, setComponents] = useState<RehabComponent[]>([]);
  const [editingComp, setEditingComp] = useState<string | null>(null);
  const [compForm, setCompForm] = useState({ name: '', options: '' });
  const [showAddComp, setShowAddComp] = useState(false);

  // Status Thresholds
  const [statusDef, setStatusDef] = useState<StatusDefinition | null>(null);
  const [statusForm, setStatusForm] = useState({ lti: '12', sti: '4', rtt: '1' });
  const [savingStatus, setSavingStatus] = useState(false);

  // RTP Phases
  const [rtpPhases, setRtpPhases] = useState<RTPPhase[]>([]);
  const [newRtp, setNewRtp] = useState('');
  const [editingRtp, setEditingRtp] = useState<string | null>(null);
  const [editRtpVal, setEditRtpVal] = useState('');

  // Staff Leads
  const [staffLeads, setStaffLeads] = useState<StaffLead[]>([]);
  const [newStaff, setNewStaff] = useState('');
  const [editingStaff, setEditingStaff] = useState<string | null>(null);
  const [editStaffVal, setEditStaffVal] = useState('');

  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [
      { data: compData },
      { data: statusData },
      { data: rtpData },
      { data: staffData },
    ] = await Promise.all([
      supabase.from('rehab_components').select('*').eq('club_id', clubId).order('sort_order'),
      supabase.from('rehab_status_definitions').select('*').eq('club_id', clubId).maybeSingle(),
      supabase.from('rtp_phases').select('*').eq('club_id', clubId).order('sort_order'),
      supabase.from('staff_leads').select('*').eq('club_id', clubId).order('sort_order'),
    ]);
    setComponents((compData || []).map((c: any) => ({
      id: c.id, name: c.name,
      options: Array.isArray(c.options) ? c.options : JSON.parse(c.options || '[]'),
      sortOrder: c.sort_order,
    })));
    if (statusData) {
      setStatusDef({ id: statusData.id, ltiWeeksMin: statusData.lti_weeks_min, stiWeeksMin: statusData.sti_weeks_min, rttWeeksMin: statusData.rtt_weeks_min });
      setStatusForm({ lti: String(statusData.lti_weeks_min), sti: String(statusData.sti_weeks_min), rtt: String(statusData.rtt_weeks_min) });
    }
    setRtpPhases((rtpData || []).map((r: any) => ({ id: r.id, name: r.name, sortOrder: r.sort_order })));
    setStaffLeads((staffData || []).map((s: any) => ({ id: s.id, name: s.name, sortOrder: s.sort_order })));
  }, [clubId]);

  useEffect(() => { load(); }, [load]);

  // ── Component CRUD ───────────────────────────────────────────────────────
  const saveComponent = async () => {
    if (!compForm.name.trim()) return;
    setSaving(true);
    const opts = compForm.options.split('\n').map(s => s.trim()).filter(Boolean);
    if (editingComp) {
      await supabase.from('rehab_components').update({ name: compForm.name.trim(), options: opts }).eq('id', editingComp);
    } else {
      await supabase.from('rehab_components').insert({ club_id: clubId, name: compForm.name.trim(), options: opts, sort_order: components.length });
    }
    setCompForm({ name: '', options: '' }); setEditingComp(null); setShowAddComp(false);
    await load(); setSaving(false);
  };

  const deleteComponent = async (id: string) => {
    if (!confirm('Delete this component?')) return;
    await supabase.from('rehab_components').delete().eq('id', id);
    await load();
  };

  // ── Status Def ───────────────────────────────────────────────────────────
  const saveStatusDef = async () => {
    setSavingStatus(true);
    const payload = { club_id: clubId, lti_weeks_min: parseInt(statusForm.lti) || 12, sti_weeks_min: parseInt(statusForm.sti) || 4, rtt_weeks_min: parseInt(statusForm.rtt) || 1 };
    if (statusDef) {
      await supabase.from('rehab_status_definitions').update(payload).eq('id', statusDef.id);
    } else {
      await supabase.from('rehab_status_definitions').insert(payload);
    }
    await load(); setSavingStatus(false);
  };

  // ── RTP Phases CRUD ──────────────────────────────────────────────────────
  const addRtp = async () => {
    if (!newRtp.trim()) return;
    await supabase.from('rtp_phases').insert({ club_id: clubId, name: newRtp.trim(), sort_order: rtpPhases.length });
    setNewRtp(''); await load();
  };
  const updateRtp = async (id: string) => {
    await supabase.from('rtp_phases').update({ name: editRtpVal.trim() }).eq('id', id);
    setEditingRtp(null); await load();
  };
  const deleteRtp = async (id: string) => {
    await supabase.from('rtp_phases').delete().eq('id', id); await load();
  };

  // ── Staff Leads CRUD ─────────────────────────────────────────────────────
  const addStaff = async () => {
    if (!newStaff.trim()) return;
    await supabase.from('staff_leads').insert({ club_id: clubId, name: newStaff.trim(), sort_order: staffLeads.length });
    setNewStaff(''); await load();
  };
  const updateStaff = async (id: string) => {
    await supabase.from('staff_leads').update({ name: editStaffVal.trim() }).eq('id', id);
    setEditingStaff(null); await load();
  };
  const deleteStaff = async (id: string) => {
    await supabase.from('staff_leads').delete().eq('id', id); await load();
  };


  return (
    <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-3">

      {/* Rehab Components */}
      <SetupSection id="components" expanded={expanded} setExpanded={setExpanded} title="Rehab Components" count={components.length}>
        <div className="divide-y divide-slate-100">
          {components.map(comp => (
            <div key={comp.id} className="p-4">
              {editingComp === comp.id ? (
                <div className="space-y-2">
                  <input value={compForm.name} onChange={e => setCompForm({ ...compForm, name: e.target.value })}
                    placeholder="Component name"
                    className="w-full h-9 px-3 text-[12px] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
                  <textarea value={compForm.options} onChange={e => setCompForm({ ...compForm, options: e.target.value })}
                    placeholder="One option per line" rows={4}
                    className="w-full px-3 py-2 text-[12px] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none" />
                  <div className="flex gap-2">
                    <button onClick={saveComponent} disabled={saving} className="h-8 px-4 bg-slate-900 text-white rounded-lg text-[11px] flex items-center gap-1 disabled:opacity-40">
                      {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}Save
                    </button>
                    <button onClick={() => { setEditingComp(null); setCompForm({ name: '', options: '' }); }}
                      className="h-8 px-4 bg-slate-100 text-slate-600 rounded-lg text-[11px]">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[13px] font-semibold text-slate-800">{comp.name}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">{comp.options.length > 0 ? comp.options.join(', ') : 'No options — free text only'}</p>
                  </div>
                  {canEdit && (
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => { setEditingComp(comp.id); setCompForm({ name: comp.name, options: comp.options.join('\n') }); }}
                        className="p-1.5 text-slate-300 hover:text-slate-600"><Edit2 className="w-3.5 h-3.5" /></button>
                      <button onClick={() => deleteComponent(comp.id)} className="p-1.5 text-slate-300 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        {canEdit && (
          <div className="p-4 border-t border-slate-100">
            {showAddComp ? (
              <div className="space-y-2">
                <input value={compForm.name} onChange={e => setCompForm({ ...compForm, name: e.target.value })}
                  placeholder="Component name (e.g. Gym Work, Pool, Pitch)"
                  className="w-full h-9 px-3 text-[12px] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
                <textarea value={compForm.options} onChange={e => setCompForm({ ...compForm, options: e.target.value })}
                  placeholder="Picklist options — one per line (leave blank for free text only)" rows={4}
                  className="w-full px-3 py-2 text-[12px] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none" />
                <div className="flex gap-2">
                  <button onClick={saveComponent} disabled={saving || !compForm.name.trim()}
                    className="h-8 px-4 bg-slate-900 text-white rounded-lg text-[11px] flex items-center gap-1 disabled:opacity-40">
                    {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}Add Component
                  </button>
                  <button onClick={() => { setShowAddComp(false); setCompForm({ name: '', options: '' }); }}
                    className="h-8 px-4 bg-slate-100 text-slate-600 rounded-lg text-[11px]">Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setShowAddComp(true)}
                className="flex items-center gap-1.5 h-8 px-3 text-[12px] text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">
                <Plus className="w-3.5 h-3.5" />Add Component
              </button>
            )}
          </div>
        )}
      </SetupSection>

      {/* Status Thresholds */}
      <SetupSection id="thresholds" expanded={expanded} setExpanded={setExpanded} title="Status Thresholds (weeks)" count={undefined}>
        <div className="p-4 space-y-4">
          <p className="text-[12px] text-slate-500 leading-relaxed">Define the minimum number of weeks between injury start date and estimated return date to qualify for each status. The highest week count across all active injuries determines the player's section.</p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { key: 'lti', label: 'Long Term Injured', colour: 'border-red-300 focus:ring-red-400' },
              { key: 'sti', label: 'Short Term Injured', colour: 'border-orange-300 focus:ring-orange-400' },
              { key: 'rtt', label: 'Returning to Training', colour: 'border-amber-300 focus:ring-amber-400' },
            ].map(({ key, label, colour }) => (
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
          {canEdit && (
            <button onClick={saveStatusDef} disabled={savingStatus}
              className="h-9 px-4 bg-slate-900 text-white rounded-lg text-[12px] font-medium hover:bg-slate-700 disabled:opacity-50 flex items-center gap-1.5">
              {savingStatus ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3.5 h-3.5" />}Save Thresholds
            </button>
          )}
        </div>
      </SetupSection>

      {/* RTP Phases */}
      <SetupSection id="rtp" expanded={expanded} setExpanded={setExpanded} title="RTP Phases" count={rtpPhases.length}>
        <SimplePicklist items={rtpPhases} newVal={newRtp} setNewVal={setNewRtp}
          onAdd={addRtp} onEdit={updateRtp} onDelete={deleteRtp}
          editingId={editingRtp} setEditingId={setEditingRtp}
          editVal={editRtpVal} setEditVal={setEditRtpVal} canEdit={canEdit} />
      </SetupSection>

      {/* Staff Leads */}
      <SetupSection id="staff" expanded={expanded} setExpanded={setExpanded} title="Staff Leads" count={staffLeads.length}>
        <SimplePicklist items={staffLeads} newVal={newStaff} setNewVal={setNewStaff}
          onAdd={addStaff} onEdit={updateStaff} onDelete={deleteStaff}
          editingId={editingStaff} setEditingId={setEditingStaff}
          editVal={editStaffVal} setEditVal={setEditStaffVal} canEdit={canEdit} />
      </SetupSection>
    </div>
  );
};

// ── Injury Detail Cell (staff only) ──────────────────────────────────────────
const InjuryDetailCell = ({ athlete, weekCommencing }: { athlete: Athlete; weekCommencing: string }) => {
  const today = weekCommencing;
  const active = athlete.injuries.filter(i => !i.returnDate || i.returnDate >= today);
  if (!active.length) return <span className="text-[11px] text-slate-300 italic">None</span>;
  return (
    <div className="space-y-1.5">
      {active.map(inj => {
        const weeksIn = inj.startDate ? weeksApart(inj.startDate, weekCommencing) : null;
        const weeksPostSurg = inj.surgeryDate ? weeksApart(inj.surgeryDate, weekCommencing) : null;
        const weeksToRtn = inj.returnDate ? weeksApart(weekCommencing, inj.returnDate) : null;
        return (
          <div key={inj.id} className="text-[10px] leading-snug space-y-0.5">
            <p className="font-semibold text-slate-700">{inj.bodyPart}{inj.notes ? ` — ${inj.notes}` : ''}</p>
            <p className="text-slate-400">
              Start: {fmtShort(inj.startDate)}
              {weeksIn !== null && <span className="ml-1 text-slate-500">({weeksIn}w ago)</span>}
            </p>
            {inj.surgeryDate && (
              <p className="text-slate-400">
                Surgery: {fmtShort(inj.surgeryDate)}
                {weeksPostSurg !== null && <span className="ml-1 text-slate-500">({weeksPostSurg}w post-op)</span>}
              </p>
            )}
            <p className="text-slate-400">
              ETR: {inj.returnDate ? <>{fmtShort(inj.returnDate)}{weeksToRtn !== null && <span className="ml-1 text-slate-500">({weeksToRtn > 0 ? `${weeksToRtn}w away` : 'this week'})</span>}</> : <span className="text-red-500 font-medium">Season</span>}
            </p>
          </div>
        );
      })}
    </div>
  );
};

// ── Component Entry Cell ──────────────────────────────────────────────────────
const ComponentCell = ({ value, options, canEdit, onChange }: {
  value: string; options: string[]; canEdit: boolean; onChange: (v: string) => void;
}) => {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value);

  useEffect(() => { setLocal(value); }, [value]);

  if (!canEdit) {
    return <span className="text-[11px] text-slate-600">{value || <span className="text-slate-300">—</span>}</span>;
  }

  if (editing || (!options.length && !value)) {
    return (
      <div className="flex flex-col gap-1 min-w-[100px]">
        {options.length > 0 && (
          <select value={local} onChange={e => setLocal(e.target.value)}
            className="h-7 px-2 text-[11px] border border-slate-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 w-full">
            <option value="">—</option>
            {options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        )}
        <input value={local} onChange={e => setLocal(e.target.value)}
          placeholder="or type…"
          className="h-7 px-2 text-[11px] border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 w-full" />
        <div className="flex gap-1">
          <button onClick={() => { onChange(local); setEditing(false); }}
            className="flex-1 h-6 bg-slate-800 text-white rounded text-[10px]">✓</button>
          <button onClick={() => { setLocal(value); setEditing(false); }}
            className="flex-1 h-6 bg-slate-100 text-slate-600 rounded text-[10px]">✕</button>
        </div>
      </div>
    );
  }

  return (
    <button onClick={() => setEditing(true)}
      className="text-left w-full min-w-[80px] min-h-[28px] px-2 py-1 rounded hover:bg-slate-100 transition-colors text-[11px] text-slate-700 border border-transparent hover:border-slate-200">
      {value || <span className="text-slate-300 italic">—</span>}
    </button>
  );
};

// ── Athlete Row ───────────────────────────────────────────────────────────────
const AthleteRow = ({
  row, athlete, components, weekDates, rtpPhases, staffLeads, fixtures,
  canEdit, isPlayer, weekCommencing,
  onUpdateEntry, onUpdateField, onRemove, onCopyPrev, hasPrevWeek,
}: any) => {
  const [collapsed, setCollapsed] = useState(false);

  const staffLead = staffLeads.find((s: any) => s.id === row.staffLeadId);
  const rtpPhase = rtpPhases.find((r: any) => r.id === row.rtpPhaseId);
  const fixture = fixtures.find((f: any) => f.id === row.targetFixtureId);
  const today = new Date().toISOString().split('T')[0];
  const futureFixtures = fixtures.filter((f: any) => f.date >= today);

  return (
    <div className="border-b border-slate-100 last:border-0">
      {/* Athlete header row */}
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors">
        <button onClick={() => setCollapsed(!collapsed)} className="flex items-center gap-1.5 flex-1 min-w-0">
          <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-600 shrink-0">
            {athlete?.avatar || athlete?.name?.[0] || '?'}
          </div>
          <span className="text-[13px] font-semibold text-slate-800 truncate">{athlete?.name}</span>
          {collapsed ? <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" /> : <ChevronUp className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
        </button>
        <div className="flex items-center gap-1.5 shrink-0">
          {hasPrevWeek && canEdit && (
            <button onClick={onCopyPrev}
              className="flex items-center gap-1 h-6 px-2 text-[10px] font-medium text-blue-600 border border-blue-200 rounded hover:bg-blue-50 transition-colors">
              <Copy className="w-3 h-3" />Copy prev week
            </button>
          )}
          {canEdit && (
            <button onClick={onRemove} className="p-1 text-slate-300 hover:text-red-500 transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse" style={{ minWidth: '700px' }}>
            <thead>
              <tr className="bg-white border-b border-slate-100">
                <th className="px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider w-32 sticky left-0 bg-white z-10">Component</th>
                {weekDates.map((d: string, i: number) => (
                  <th key={d} className="px-2 py-1.5 text-[10px] font-semibold text-slate-400 text-center w-24">
                    {DAY_LABELS[i]}<br />
                    <span className="font-normal normal-case">{fmtShort(d)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Staff-only rows */}
              {!isPlayer && (
                <>
                  {/* Injury Detail */}
                  <tr className="border-b border-slate-50">
                    <td className="px-3 py-2 text-[11px] font-medium text-slate-500 sticky left-0 bg-white z-10">Injury Detail</td>
                    <td colSpan={7} className="px-3 py-2">
                      <InjuryDetailCell athlete={athlete} weekCommencing={weekCommencing} />
                    </td>
                  </tr>
                  {/* RTP Phase */}
                  <tr className="border-b border-slate-50">
                    <td className="px-3 py-2 text-[11px] font-medium text-slate-500 sticky left-0 bg-white z-10">RTP Phase</td>
                    <td colSpan={7} className="px-3 py-2">
                      {canEdit ? (
                        <select value={row.rtpPhaseId || ''} onChange={e => onUpdateField('rtpPhaseId', e.target.value || null)}
                          className="h-7 px-2 text-[11px] border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-[140px]">
                          <option value="">— Select —</option>
                          {rtpPhases.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                      ) : <span className="text-[11px] text-slate-600">{rtpPhase?.name || '—'}</span>}
                    </td>
                  </tr>
                  {/* Staff Lead */}
                  <tr className="border-b border-slate-50">
                    <td className="px-3 py-2 text-[11px] font-medium text-slate-500 sticky left-0 bg-white z-10">Staff Lead</td>
                    <td colSpan={7} className="px-3 py-2">
                      {canEdit ? (
                        <select value={row.staffLeadId || ''} onChange={e => onUpdateField('staffLeadId', e.target.value || null)}
                          className="h-7 px-2 text-[11px] border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-[140px]">
                          <option value="">— Select —</option>
                          {staffLeads.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      ) : <span className="text-[11px] text-slate-600">{staffLead?.name || '—'}</span>}
                    </td>
                  </tr>
                  {/* Target Fixture */}
                  <tr className="border-b border-slate-50">
                    <td className="px-3 py-2 text-[11px] font-medium text-slate-500 sticky left-0 bg-white z-10">Target Fixture</td>
                    <td colSpan={7} className="px-3 py-2">
                      {canEdit ? (
                        <select value={row.targetFixtureId || ''} onChange={e => onUpdateField('targetFixtureId', e.target.value || null)}
                          className="h-7 px-2 text-[11px] border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-[200px]">
                          <option value="">— Select —</option>
                          {futureFixtures.map((f: any) => <option key={f.id} value={f.id}>{fmtShort(f.date)} — {f.opposition} ({f.homeAway})</option>)}
                        </select>
                      ) : <span className="text-[11px] text-slate-600">{fixture ? `${fmtShort(fixture.date)} — ${fixture.opposition} (${fixture.homeAway})` : '—'}</span>}
                    </td>
                  </tr>
                  {/* Week Overview */}
                  <tr className="border-b border-slate-50">
                    <td className="px-3 py-2 text-[11px] font-medium text-slate-500 sticky left-0 bg-white z-10 align-top pt-2.5">Week Overview</td>
                    <td colSpan={7} className="px-3 py-2">
                      {canEdit ? (
                        <textarea value={row.weekOverview} onChange={e => onUpdateField('weekOverview', e.target.value)}
                          rows={2} placeholder="Free text overview for the week…"
                          className="w-full px-2 py-1.5 text-[11px] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none" />
                      ) : <span className="text-[11px] text-slate-600 whitespace-pre-wrap">{row.weekOverview || '—'}</span>}
                    </td>
                  </tr>
                </>
              )}

              {/* Rehab Component rows */}
              {components.map((comp: RehabComponent) => (
                <tr key={comp.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-3 py-2 text-[11px] font-medium text-slate-600 sticky left-0 bg-white z-10 max-w-[120px]">
                    <span className="block truncate" title={comp.name}>{comp.name}</span>
                  </td>
                  {weekDates.map((date: string) => (
                    <td key={date} className="px-1 py-1 text-center align-middle">
                      <ComponentCell
                        value={row.entries[comp.id]?.[date] || ''}
                        options={comp.options}
                        canEdit={canEdit}
                        onChange={v => onUpdateEntry(comp.id, date, v)}
                      />
                    </td>
                  ))}
                </tr>
              ))}

              {components.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-3 text-[11px] text-slate-300 italic text-center">
                    No rehab components configured — add them in Setup
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ── Add Athlete Modal ─────────────────────────────────────────────────────────
const AddAthleteModal = ({ athletes, existingIds, onAdd, onClose }: any) => {
  const [search, setSearch] = useState('');
  const available = athletes.filter((a: Athlete) =>
    !existingIds.includes(a.id) &&
    a.name.toLowerCase().includes(search.toLowerCase())
  );
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h3 className="text-[14px] font-semibold text-slate-900">Add Athlete to Planner</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-slate-400 hover:text-slate-600" /></button>
        </div>
        <div className="p-3">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search athletes…"
            className="w-full h-9 px-3 text-[12px] border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 mb-2" />
          <div className="max-h-64 overflow-y-auto space-y-1">
            {available.length === 0
              ? <p className="text-[12px] text-slate-400 text-center py-4">No athletes found</p>
              : available.map((a: Athlete) => (
                <button key={a.id} onClick={() => onAdd(a)}
                  className="w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-slate-50 transition-colors">
                  <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-600 shrink-0">{a.avatar || a.name[0]}</div>
                  <div>
                    <p className="text-[13px] font-medium text-slate-800">{a.name}</p>
                    <p className="text-[10px] text-slate-400">{a.status}</p>
                  </div>
                </button>
              ))
            }
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

  // Setup data
  const [components, setComponents] = useState<RehabComponent[]>([]);
  const [statusDef, setStatusDef] = useState<StatusDefinition | null>(null);
  const [rtpPhases, setRtpPhases] = useState<RTPPhase[]>([]);
  const [staffLeads, setStaffLeads] = useState<StaffLead[]>([]);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);

  // Athletes data
  const [allAthletes, setAllAthletes] = useState<Athlete[]>([]);

  // Planner data
  const [planId, setPlanId] = useState<string | null>(null);
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);

  // UI state
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [showAddAthlete, setShowAddAthlete] = useState(false);

  // Load static data once
  const loadSetup = useCallback(async () => {
    const [
      { data: compData },
      { data: statusData },
      { data: rtpData },
      { data: staffData },
      { data: fixtureData },
      { data: athleteData },
      { data: posData },
      { data: injData },
    ] = await Promise.all([
      supabase.from('rehab_components').select('*').eq('club_id', clubId).order('sort_order'),
      supabase.from('rehab_status_definitions').select('*').eq('club_id', clubId).maybeSingle(),
      supabase.from('rtp_phases').select('*').eq('club_id', clubId).order('sort_order'),
      supabase.from('staff_leads').select('*').eq('club_id', clubId).order('sort_order'),
      supabase.from('fixtures').select('*').eq('club_id', clubId).order('date'),
      supabase.from('athletes').select('*').order('name'),
      supabase.from('athlete_injuries').select('*'),
      supabase.from('athlete_injuries').select('*'),
    ]);

    setComponents((compData || []).map((c: any) => ({
      id: c.id, name: c.name,
      options: Array.isArray(c.options) ? c.options : JSON.parse(c.options || '[]'),
      sortOrder: c.sort_order,
    })));
    if (statusData) setStatusDef({ id: statusData.id, ltiWeeksMin: statusData.lti_weeks_min, stiWeeksMin: statusData.sti_weeks_min, rttWeeksMin: statusData.rtt_weeks_min });
    setRtpPhases((rtpData || []).map((r: any) => ({ id: r.id, name: r.name, sortOrder: r.sort_order })));
    setStaffLeads((staffData || []).map((s: any) => ({ id: s.id, name: s.name, sortOrder: s.sort_order })));
    setFixtures((fixtureData || []).map((f: any) => ({ id: f.id, date: f.date, opposition: f.opposition, homeAway: f.home_away })));

    const injuries = injData || [];
    setAllAthletes((athleteData || []).map((a: any) => ({
      id: a.id, name: a.name, status: a.status, avatar: a.avatar,
      injuries: injuries.filter((i: any) => i.athlete_id === a.id).map((i: any) => ({
        id: i.id, bodyPart: i.body_part, startDate: i.start_date,
        returnDate: i.return_date, surgeryDate: i.surgery_date || null,
        notes: i.notes || '', event: i.event,
      })),
    })));
  }, [clubId]);

  // Load plan for a specific week
  const loadWeekPlan = useCallback(async (wc: string) => {
    setLoading(true);
    const { data: plan } = await supabase
      .from('rehab_plans')
      .select('id')
      .eq('club_id', clubId)
      .eq('week_commencing', wc)
      .maybeSingle();

    if (!plan) {
      setPlanId(null);
      setRows([]);
      setLoading(false);
      return;
    }

    setPlanId(plan.id);

    const { data: rowData } = await supabase
      .from('rehab_plan_rows')
      .select('*')
      .eq('plan_id', plan.id)
      .order('sort_order');

    if (!rowData?.length) { setRows([]); setLoading(false); return; }

    const rowIds = rowData.map((r: any) => r.id);
    const { data: entryData } = await supabase
      .from('rehab_component_entries')
      .select('*')
      .in('plan_row_id', rowIds);

    const entries: Record<string, Record<string, Record<string, string>>> = {};
    for (const e of (entryData || [])) {
      if (!entries[e.plan_row_id]) entries[e.plan_row_id] = {};
      if (!entries[e.plan_row_id][e.component_id]) entries[e.plan_row_id][e.component_id] = {};
      entries[e.plan_row_id][e.component_id][e.day_date] = e.value;
    }

    setRows(rowData.map((r: any) => ({
      id: r.id, planId: r.plan_id, athleteId: r.athlete_id,
      section: r.section, rtpPhaseId: r.rtp_phase_id,
      staffLeadId: r.staff_lead_id, targetFixtureId: r.target_fixture_id,
      weekOverview: r.week_overview || '', sortOrder: r.sort_order,
      entries: entries[r.id] || {},
    })));
    setLoading(false);
  }, [clubId]);

  useEffect(() => {
    loadSetup().then(() => loadWeekPlan(weekCommencing));
  }, []);

  useEffect(() => {
    loadWeekPlan(weekCommencing);
  }, [weekCommencing]);

  // Create a new plan for this week
  const createPlan = async () => {
    setCreating(true);
    const { data: newPlan } = await supabase
      .from('rehab_plans')
      .insert({ club_id: clubId, week_commencing: weekCommencing })
      .select()
      .single();
    if (!newPlan) { setCreating(false); return; }
    setPlanId(newPlan.id);

    // Auto-populate with unavailable athletes
    const unavailable = allAthletes.filter(a => a.status === 'Unavailable');
    const newRows: PlanRow[] = [];
    for (let i = 0; i < unavailable.length; i++) {
      const a = unavailable[i];
      const section = getInjurySection(a, weekCommencing, statusDef);
      const { data: rowData } = await supabase
        .from('rehab_plan_rows')
        .insert({ plan_id: newPlan.id, athlete_id: a.id, section, sort_order: i, week_overview: '' })
        .select()
        .single();
      if (rowData) newRows.push({
        id: rowData.id, planId: newPlan.id, athleteId: a.id,
        section, rtpPhaseId: null, staffLeadId: null, targetFixtureId: null,
        weekOverview: '', sortOrder: i, entries: {},
      });
    }
    setRows(newRows);
    setCreating(false);
  };

  // Auto-save a row field to DB
  const saveRowField = async (rowId: string, field: string, value: any) => {
    const dbField: Record<string, string> = {
      rtpPhaseId: 'rtp_phase_id', staffLeadId: 'staff_lead_id',
      targetFixtureId: 'target_fixture_id', weekOverview: 'week_overview',
    };
    await supabase.from('rehab_plan_rows').update({ [dbField[field]]: value }).eq('id', rowId);
  };

  const updateRowField = (rowId: string, field: string, value: any) => {
    setRows(prev => prev.map(r => r.id === rowId ? { ...r, [field]: value } : r));
    saveRowField(rowId, field, value);
  };

  // Save a component entry
  const saveEntry = async (rowId: string, componentId: string, date: string, value: string) => {
    if (value) {
      await supabase.from('rehab_component_entries').upsert(
        { plan_row_id: rowId, component_id: componentId, day_date: date, value },
        { onConflict: 'plan_row_id,component_id,day_date' }
      );
    } else {
      await supabase.from('rehab_component_entries')
        .delete()
        .eq('plan_row_id', rowId)
        .eq('component_id', componentId)
        .eq('day_date', date);
    }
  };

  const updateEntry = (rowId: string, componentId: string, date: string, value: string) => {
    setRows(prev => prev.map(r => {
      if (r.id !== rowId) return r;
      const newEntries = { ...r.entries };
      if (!newEntries[componentId]) newEntries[componentId] = {};
      newEntries[componentId] = { ...newEntries[componentId], [date]: value };
      return { ...r, entries: newEntries };
    }));
    saveEntry(rowId, componentId, date, value);
  };

  // Add athlete manually
  const addAthlete = async (athlete: Athlete) => {
    if (!planId) return;
    const section = getInjurySection(athlete, weekCommencing, statusDef);
    const { data: rowData } = await supabase
      .from('rehab_plan_rows')
      .insert({ plan_id: planId, athlete_id: athlete.id, section, sort_order: rows.length, week_overview: '' })
      .select()
      .single();
    if (rowData) {
      setRows(prev => [...prev, {
        id: rowData.id, planId, athleteId: athlete.id,
        section, rtpPhaseId: null, staffLeadId: null, targetFixtureId: null,
        weekOverview: '', sortOrder: rows.length, entries: {},
      }]);
    }
    setShowAddAthlete(false);
  };

  // Remove a row
  const removeRow = async (rowId: string) => {
    await supabase.from('rehab_plan_rows').delete().eq('id', rowId);
    setRows(prev => prev.filter(r => r.id !== rowId));
  };

  // Copy from previous week
  const copyFromPrevWeek = async (row: PlanRow) => {
    const prevMonday = (() => {
      const d = new Date(weekCommencing + 'T00:00:00');
      d.setDate(d.getDate() - 7);
      return d.toISOString().split('T')[0];
    })();
    const prevDates = getWeekDates(prevMonday);

    // Load prev plan
    const { data: prevPlan } = await supabase
      .from('rehab_plans').select('id').eq('club_id', clubId).eq('week_commencing', prevMonday).maybeSingle();
    if (!prevPlan) return;

    const { data: prevRow } = await supabase
      .from('rehab_plan_rows').select('*').eq('plan_id', prevPlan.id).eq('athlete_id', row.athleteId).maybeSingle();
    if (!prevRow) return;

    const { data: prevEntries } = await supabase
      .from('rehab_component_entries').select('*').eq('plan_row_id', prevRow.id);

    // Copy staff fields
    await supabase.from('rehab_plan_rows').update({
      rtp_phase_id: prevRow.rtp_phase_id,
      staff_lead_id: prevRow.staff_lead_id,
      target_fixture_id: prevRow.target_fixture_id,
      week_overview: prevRow.week_overview,
    }).eq('id', row.id);

    // Copy entries — shifting dates by 7 days
    const newEntries: Record<string, Record<string, string>> = {};
    for (const e of (prevEntries || [])) {
      const prevDate = e.day_date;
      const prevIdx = prevDates.indexOf(prevDate);
      if (prevIdx === -1) continue;
      const newDate = weekDates[prevIdx];
      if (!newEntries[e.component_id]) newEntries[e.component_id] = {};
      newEntries[e.component_id][newDate] = e.value;
      await supabase.from('rehab_component_entries').upsert(
        { plan_row_id: row.id, component_id: e.component_id, day_date: newDate, value: e.value },
        { onConflict: 'plan_row_id,component_id,day_date' }
      );
    }

    setRows(prev => prev.map(r => r.id === row.id ? {
      ...r,
      rtpPhaseId: prevRow.rtp_phase_id,
      staffLeadId: prevRow.staff_lead_id,
      targetFixtureId: prevRow.target_fixture_id,
      weekOverview: prevRow.week_overview || '',
      entries: newEntries,
    } : r));
  };

  // Check if previous week has data for an athlete
  const [prevWeekAthleteIds, setPrevWeekAthleteIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    const check = async () => {
      const prevMonday = (() => {
        const d = new Date(weekCommencing + 'T00:00:00');
        d.setDate(d.getDate() - 7);
        return d.toISOString().split('T')[0];
      })();
      const { data: prevPlan } = await supabase
        .from('rehab_plans').select('id').eq('club_id', clubId).eq('week_commencing', prevMonday).maybeSingle();
      if (!prevPlan) { setPrevWeekAthleteIds(new Set()); return; }
      const { data: prevRows } = await supabase
        .from('rehab_plan_rows').select('athlete_id').eq('plan_id', prevPlan.id);
      setPrevWeekAthleteIds(new Set((prevRows || []).map((r: any) => r.athlete_id)));
    };
    check();
  }, [weekCommencing, clubId]);

  // Group rows by section
  const rowsBySection = useMemo(() => {
    const grouped: Record<string, PlanRow[]> = { LTI: [], STI: [], RTT: [], Other: [] };
    for (const row of rows) grouped[row.section]?.push(row);
    return grouped;
  }, [rows]);

  // Week navigation
  const prevWeek = () => {
    const d = new Date(weekCommencing + 'T00:00:00');
    d.setDate(d.getDate() - 7);
    setWeekCommencing(d.toISOString().split('T')[0]);
  };
  const nextWeek = () => {
    const d = new Date(weekCommencing + 'T00:00:00');
    d.setDate(d.getDate() + 7);
    setWeekCommencing(d.toISOString().split('T')[0]);
  };

  const toggleSection = (s: string) => setCollapsedSections(prev => {
    const n = new Set(prev);
    n.has(s) ? n.delete(s) : n.add(s);
    return n;
  });

  if (loading) return (
    <div className="flex-1 flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
    </div>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Week navigation bar */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-20">
        <button onClick={prevWeek} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
          <ChevronLeft className="w-4 h-4 text-slate-600" />
        </button>
        <div className="flex-1 text-center">
          <p className="text-[14px] font-semibold text-slate-900">w/c {fmtWC(weekCommencing)}</p>
          {weekCommencing === currentMonday && <span className="text-[10px] text-blue-500 font-medium">Current week</span>}
        </div>
        <button onClick={nextWeek} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
          <ChevronRight className="w-4 h-4 text-slate-600" />
        </button>
        {planId && canEdit && (
          <button onClick={() => setShowAddAthlete(true)}
            className="flex items-center gap-1.5 h-8 px-3 bg-slate-900 text-white rounded-lg text-[12px] font-medium hover:bg-slate-700 transition-colors ml-2">
            <Plus className="w-3.5 h-3.5" />Add Athlete
          </button>
        )}
      </div>

      {/* No plan state */}
      {!planId ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
          <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center">
            <Target className="w-6 h-6 text-emerald-600" />
          </div>
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
      ) : (
        <div className="flex-1 overflow-y-auto">
          {rows.length === 0 && (
            <div className="p-8 text-center text-[13px] text-slate-400">
              No athletes on this plan.{canEdit && ' Use "Add Athlete" to add players.'}
            </div>
          )}
          {SECTION_ORDER.map(section => {
            const sectionRows = rowsBySection[section];
            if (!sectionRows.length) return null;
            const collapsed = collapsedSections.has(section);
            return (
              <div key={section} className="mb-2">
                {/* Section header */}
                <button
                  onClick={() => toggleSection(section)}
                  className={`w-full flex items-center justify-between px-4 py-2.5 ${SECTION_COLOURS[section]} text-white`}>
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-bold">{SECTION_LABELS[section]}</span>
                    <span className="text-[11px] text-white/70 font-normal">{sectionRows.length} athlete{sectionRows.length !== 1 ? 's' : ''}</span>
                  </div>
                  {collapsed ? <ChevronDown className="w-4 h-4 text-white/70" /> : <ChevronUp className="w-4 h-4 text-white/70" />}
                </button>

                {!collapsed && (
                  <div className={`border-l-4 ${SECTION_LIGHT[section]}`} style={{ borderLeftColor: '' }}>
                    {sectionRows.map(row => {
                      const athlete = allAthletes.find(a => a.id === row.athleteId);
                      if (!athlete) return null;
                      return (
                        <AthleteRow
                          key={row.id}
                          row={row}
                          athlete={athlete}
                          components={components}
                          weekDates={weekDates}
                          rtpPhases={rtpPhases}
                          staffLeads={staffLeads}
                          fixtures={fixtures}
                          canEdit={canEdit}
                          isPlayer={isPlayer}
                          weekCommencing={weekCommencing}
                          hasPrevWeek={prevWeekAthleteIds.has(row.athleteId)}
                          onUpdateEntry={(compId: string, date: string, val: string) => updateEntry(row.id, compId, date, val)}
                          onUpdateField={(field: string, val: any) => updateRowField(row.id, field, val)}
                          onRemove={() => removeRow(row.id)}
                          onCopyPrev={() => copyFromPrevWeek(row)}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showAddAthlete && (
        <AddAthleteModal
          athletes={allAthletes}
          existingIds={rows.map(r => r.athleteId)}
          onAdd={addAthlete}
          onClose={() => setShowAddAthlete(false)}
        />
      )}
    </div>
  );
};

// ── App Shell ─────────────────────────────────────────────────────────────────
export function RehabPlanner({ role, clubId, authUser, onBack }: {
  role: Role; clubId: string; authUser: any; onBack: () => void;
}) {
  const [page, setPage] = useState<'planner' | 'setup'>('planner');
  const showSetup = canEditRole(role);

  const navItems = [
    { id: 'planner', label: 'Rehab Planner', Icon: Target },
    ...(showSetup ? [{ id: 'setup', label: 'Setup', Icon: Settings }] : []),
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-52 shrink-0 bg-slate-900 sticky top-0 h-screen">
        <div className="px-4 py-5 border-b border-white/[0.06]">
          <button onClick={onBack} className="flex items-center gap-1.5 text-white/40 hover:text-white/70 text-[11px] mb-3 transition-colors">
            <ArrowLeft className="w-3 h-3" />All Apps
          </button>
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded bg-emerald-600 flex items-center justify-center shrink-0">
              <Target className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
            </div>
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
          <p className="text-[9px] font-semibold text-white/25 uppercase tracking-[0.9px] mb-1">Signed in</p>
          <p className="text-[11px] text-white/50 truncate">{authUser?.email}</p>
          <p className="text-[10px] text-white/30 mt-0.5">{role}</p>
          <button onClick={() => supabase.auth.signOut()}
            className="mt-2 w-full flex items-center gap-2 px-2.5 py-1.5 text-[12px] text-white/40 hover:text-white/70 hover:bg-white/[0.06] rounded transition-colors">
            <X className="w-3 h-3" />Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-h-screen min-w-0">
        {/* Mobile header */}
        <header className="md:hidden bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
          <button onClick={onBack} className="p-1.5 hover:bg-slate-100 rounded-lg">
            <ChevronLeft className="w-5 h-5 text-slate-600" />
          </button>
          <h1 className="text-[15px] font-semibold text-slate-900 flex-1">Rehab Planner</h1>
          {showSetup && (
            <button onClick={() => setPage(page === 'setup' ? 'planner' : 'setup')}
              className={`p-1.5 rounded-lg transition-colors ${page === 'setup' ? 'bg-slate-100 text-slate-900' : 'text-slate-400 hover:bg-slate-100'}`}>
              <Settings className="w-4.5 h-4.5" />
            </button>
          )}
        </header>

        {/* Desktop page header */}
        <div className="hidden md:flex items-center justify-between bg-white border-b border-slate-200 px-6 py-3.5">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900 leading-none">
              {page === 'setup' ? 'Rehab Setup' : 'Rehab Planner'}
            </h2>
            <p className="text-[11px] text-slate-400 mt-1 font-light">
              {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
        </div>

        {/* Page content */}
        {page === 'setup'
          ? <RehabSetupPage clubId={clubId} role={role} />
          : <RehabPlannerPage clubId={clubId} role={role} />
        }
      </div>
    </div>
  );
}
