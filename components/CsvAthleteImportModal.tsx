'use client';

// components/CsvAthleteImportModal.tsx
// Round 18: shared bulk-add-a-squad-via-CSV component, used by BOTH Add
// Player entry points Joanne asked for — Training Planner's existing
// Athletes/Availability toolbar, and Gym's new Setup page. Lives at the
// top level (a sibling of TrainingPlanner.tsx/Gym.tsx) rather than inside
// components/gym/, specifically so it isn't "owned" by either app — each
// imports it the same way.
//
// Scope, deliberately kept simple for a first cut: creates NEW athlete rows
// only (no matching-by-name update-in-place — safer than guessing whether a
// CSV row means "new player" or "edit this existing one"). Covers Name
// (required), Status, Notes, Public, and Positions (semicolon-separated
// position names, matched case-insensitively against this club's team
// structure) — i.e. "Name + position + the fuller set of fields the
// Athlete Profile page lets you edit" per Joanne's answer, MINUS injuries
// and Default Position: injury history isn't a sensible bulk-CSV field, and
// Default Position needs a specific squad number picked from a name that
// can map to several — both are two clicks away afterwards on each
// player's own profile. Unmatched position names don't block the row; they
// are just reported after import so staff can fix them up individually.

import React, { useState } from 'react';
import { Loader2, Upload, X } from 'lucide-react';

export interface ParsedAthleteRow {
  name: string;
  status: string;
  notes: string;
  isPublic: boolean;
  avatar: string;
  positionNumbers: number[];
  unmatchedPositionNames: string[];
}

interface TeamPositionLike {
  number: number;
  name: string;
}

const VALID_STATUSES = ['Available', 'Modified', 'Unavailable'];

const genAvatarInitials = (name: string): string => {
  if (!name) return '';
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : name.substring(0, 2).toUpperCase();
};

/** Minimal CSV parser — handles quoted fields (with embedded commas/quotes) and CRLF/LF. Not a general-purpose CSV library; enough for a simple squad-list export. */
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

function parseAthleteCsv(text: string, teamStructure: TeamPositionLike[]): { rows: ParsedAthleteRow[]; headerWarning: string | null } {
  const table = parseCsvText(text);
  if (table.length === 0) return { rows: [], headerWarning: null };

  const headerRow = table[0].map(normalizeHeader);
  const nameIdx = headerRow.findIndex(h => h === 'name');
  if (nameIdx === -1) {
    return { rows: [], headerWarning: 'No "Name" column found — the first row must be a header row with at least a Name column.' };
  }
  const statusIdx = headerRow.findIndex(h => h === 'status');
  const notesIdx = headerRow.findIndex(h => h === 'notes');
  const positionsIdx = headerRow.findIndex(h => h === 'positions' || h === 'position');
  const publicIdx = headerRow.findIndex(h => h === 'public' || h === 'ispublic');

  const rows: ParsedAthleteRow[] = [];
  for (const cells of table.slice(1)) {
    const name = (cells[nameIdx] || '').trim();
    if (!name) continue;

    const rawStatus = statusIdx >= 0 ? (cells[statusIdx] || '').trim() : '';
    const status = VALID_STATUSES.find(s => s.toLowerCase() === rawStatus.toLowerCase()) || 'Available';

    const notes = notesIdx >= 0 ? (cells[notesIdx] || '').trim() : '';
    const isPublic = publicIdx >= 0 ? /^(y|yes|true|1)$/i.test((cells[publicIdx] || '').trim()) : false;

    const positionNumbers: number[] = [];
    const unmatchedPositionNames: string[] = [];
    if (positionsIdx >= 0 && cells[positionsIdx]) {
      const names = cells[positionsIdx].split(';').map(s => s.trim()).filter(Boolean);
      for (const posName of names) {
        const matches = teamStructure.filter(p => p.name.toLowerCase() === posName.toLowerCase());
        if (matches.length === 0) unmatchedPositionNames.push(posName);
        else for (const m of matches) if (!positionNumbers.includes(m.number)) positionNumbers.push(m.number);
      }
    }

    rows.push({ name, status, notes, isPublic, avatar: genAvatarInitials(name), positionNumbers, unmatchedPositionNames });
  }

  return { rows, headerWarning: null };
}

export const CsvAthleteImportModal = ({
  teamStructure,
  onImport,
  onClose,
}: {
  teamStructure: TeamPositionLike[];
  onImport: (rows: ParsedAthleteRow[]) => Promise<void>;
  onClose: () => void;
}) => {
  const [rows, setRows] = useState<ParsedAthleteRow[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(false);

  const handleFile = async (file: File) => {
    setParseError(null);
    setFileName(file.name);
    const text = await file.text();
    const { rows: parsed, headerWarning } = parseAthleteCsv(text, teamStructure);
    if (headerWarning) {
      setParseError(headerWarning);
      setRows(null);
      return;
    }
    if (parsed.length === 0) {
      setParseError('No rows with a Name found in this file.');
      setRows(null);
      return;
    }
    setRows(parsed);
  };

  const unmatchedTotal = (rows || []).reduce((n, r) => n + r.unmatchedPositionNames.length, 0);

  const handleImport = async () => {
    if (!rows || rows.length === 0) return;
    setImporting(true);
    try {
      await onImport(rows);
      setDone(true);
    } catch (err: any) {
      console.error('[CsvAthleteImportModal] import failed', err);
      setParseError(err?.message || 'Import failed partway through — some players may already have been added.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 sticky top-0 bg-white z-10">
          <h3 className="text-[14px] font-bold text-slate-900">Import players from CSV</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 text-slate-400"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-4 space-y-3">
          {done ? (
            <div className="text-center py-6">
              <p className="text-[14px] font-semibold text-emerald-700 mb-1">Imported {rows?.length} player{rows?.length !== 1 ? 's' : ''}</p>
              <p className="text-[12px] text-slate-400 mb-4">You can set each one's photo, injuries, and Default Position from their own profile.</p>
              <button onClick={onClose} className="h-9 px-4 rounded-lg bg-slate-900 text-white text-[13px] font-medium">Done</button>
            </div>
          ) : (
            <>
              <p className="text-[12px] text-slate-500">
                Upload a CSV with a header row. Recognised columns: <span className="font-medium text-slate-700">Name</span> (required),
                Status, Notes, Public, and Positions (separate multiple positions with a semicolon, e.g. "Prop; Hooker"). New players only —
                this doesn't update existing profiles.
              </p>

              <label className="flex items-center justify-center gap-2 h-11 border-2 border-dashed border-slate-200 rounded-lg text-[13px] text-slate-500 hover:border-slate-300 hover:bg-slate-50 cursor-pointer">
                <Upload className="w-4 h-4" />
                {fileName || 'Choose a CSV file…'}
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              </label>

              {parseError && <p className="text-[12px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{parseError}</p>}

              {rows && rows.length > 0 && (
                <div>
                  <p className="text-[12px] font-medium text-slate-700 mb-1.5">{rows.length} player{rows.length !== 1 ? 's' : ''} ready to import</p>
                  <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-56 overflow-y-auto">
                    {rows.map((r, i) => (
                      <div key={i} className="px-3 py-1.5 text-[12px] flex items-center justify-between gap-2">
                        <span className="font-medium text-slate-800 truncate">{r.name}</span>
                        <span className="text-slate-400 truncate">{r.status}{r.positionNumbers.length > 0 ? ` · ${r.positionNumbers.length} position${r.positionNumbers.length !== 1 ? 's' : ''}` : ''}</span>
                      </div>
                    ))}
                  </div>
                  {unmatchedTotal > 0 && (
                    <p className="text-[11px] text-amber-600 mt-1.5">
                      {unmatchedTotal} position name{unmatchedTotal !== 1 ? 's' : ''} didn't match your team structure and will be skipped — you can add them manually afterwards.
                    </p>
                  )}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleImport}
                  disabled={!rows || rows.length === 0 || importing}
                  className="flex-1 h-9 flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 text-white text-[13px] font-medium disabled:opacity-40"
                >
                  {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  {importing ? 'Importing…' : `Import ${rows?.length || ''} player${(rows?.length || 0) !== 1 ? 's' : ''}`}
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
