'use client';

import React, { useEffect, useState } from 'react';
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

type NewAthlete = Omit<Athlete, 'id' | 'created_at' | 'updated_at'>;

// ── Helpers ──────────────────────────────────────────────────────────────────

const getInitials = (name: string) =>
  name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

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

// ── Main Component ───────────────────────────────────────────────────────────

const AthleteManager = () => {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingAthlete, setEditingAthlete] = useState<Athlete | null>(null);
  const [form, setForm] = useState<NewAthlete>(emptyForm());

  // Search / filter
  const [searchTerm, setSearchTerm] = useState('');
  const [availableOnly, setAvailableOnly] = useState(false);

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchAthletes = async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from('athletes')
      .select('*')
      .order('name');

    if (error) {
      setError('Failed to load athletes: ' + error.message);
    } else {
      setAthletes(data as Athlete[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchAthletes();
  }, []);

  // ── Toast helper ───────────────────────────────────────────────────────────

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 2500);
  };

  // ── CRUD operations ────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!form.name.trim()) {
      setError('Name is required.');
      return;
    }
    setSaving(true);
    setError(null);

    const payload = {
      ...form,
      name: form.name.trim(),
      avatar: form.avatar || getInitials(form.name),
    };

    if (editingAthlete) {
      // UPDATE
      const { error } = await supabase
        .from('athletes')
        .update(payload)
        .eq('id', editingAthlete.id);

      if (error) {
        setError('Failed to update athlete: ' + error.message);
      } else {
        showSuccess('Athlete updated successfully.');
        closeModal();
        await fetchAthletes();
      }
    } else {
      // INSERT
      const { error } = await supabase
        .from('athletes')
        .insert([payload]);

      if (error) {
        setError('Failed to save athlete: ' + error.message);
      } else {
        showSuccess('Athlete added successfully.');
        closeModal();
        await fetchAthletes();
      }
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this athlete?')) return;
    setError(null);

    const { error } = await supabase
      .from('athletes')
      .delete()
      .eq('id', id);

    if (error) {
      setError('Failed to delete athlete: ' + error.message);
    } else {
      showSuccess('Athlete deleted.');
      setAthletes((prev) => prev.filter((a) => a.id !== id));
    }
  };

  const handleStatusChange = async (id: string, newStatus: Status) => {
    // Optimistic update
    setAthletes((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: newStatus } : a))
    );

    const { error } = await supabase
      .from('athletes')
      .update({ status: newStatus })
      .eq('id', id);

    if (error) {
      setError('Failed to update status: ' + error.message);
      await fetchAthletes(); // revert on failure
    }
  };

  // ── Modal helpers ──────────────────────────────────────────────────────────

  const openAddModal = () => {
    setEditingAthlete(null);
    setForm(emptyForm());
    setError(null);
    setShowModal(true);
  };

  const openEditModal = (athlete: Athlete) => {
    setEditingAthlete(athlete);
    setForm({
      name: athlete.name,
      status: athlete.status,
      notes: athlete.notes,
      is_public: athlete.is_public,
      avatar: athlete.avatar,
      photo_url: athlete.photo_url,
    });
    setError(null);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingAthlete(null);
    setForm(emptyForm());
    setError(null);
  };

  // ── Filtered list ──────────────────────────────────────────────────────────

  const filtered = athletes.filter((a) => {
    const matchesSearch = a.name
      .toLowerCase()
      .includes(searchTerm.toLowerCase());
    const matchesFilter =
      !availableOnly || a.status === 'Available' || a.status === 'Modified';
    return matchesSearch && matchesFilter;
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm sticky top-0 z-10 border-b border-gray-200 px-4 py-3">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <h1 className="text-lg font-semibold text-gray-900">Athletes</h1>
          <button
            onClick={openAddModal}
            className="px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium flex items-center gap-1 transition"
          >
            + Add Athlete
          </button>
        </div>
      </div>

      {/* Toast */}
      {successMsg && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-50 text-sm font-medium">
          ✓ {successMsg}
        </div>
      )}

      <div className="max-w-md mx-auto p-4">
        {/* Search / filter */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4 space-y-3">
          <input
            type="text"
            placeholder="Search athletes..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
          />
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={availableOnly}
              onChange={(e) => setAvailableOnly(e.target.checked)}
              className="w-4 h-4 text-indigo-600 rounded border-gray-300"
            />
            <span className="text-sm text-gray-700">Available only</span>
          </label>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Athlete list */}
        {loading ? (
          <div className="text-center py-12 text-gray-500 text-sm">
            Loading athletes…
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-500 text-sm">
            No athletes found.
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((a) => (
              <div
                key={a.id}
                className="bg-white rounded-xl shadow-sm border border-gray-200 p-3"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusColour[a.status]}`}
                  />
                  {a.photo_url ? (
                    <img
                      src={a.photo_url}
                      alt={a.name}
                      className="w-10 h-10 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center text-gray-700 font-semibold text-xs">
                      {a.avatar || getInitials(a.name)}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-gray-900 truncate">
                      {a.name}
                    </h3>
                    {a.notes && a.is_public && (
                      <p className="text-xs text-gray-500 truncate">{a.notes}</p>
                    )}
                  </div>
                  {/* Inline status */}
                  <select
                    value={a.status}
                    onChange={(e) =>
                      handleStatusChange(a.id, e.target.value as Status)
                    }
                    className="px-2 py-1 text-xs font-medium rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500"
                  >
                    <option>Available</option>
                    <option>Modified</option>
                    <option>Unavailable</option>
                  </select>
                  {/* Edit */}
                  <button
                    onClick={() => openEditModal(a)}
                    className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
                    title="Edit"
                  >
                    ✏️
                  </button>
                  {/* Delete */}
                  <button
                    onClick={() => handleDelete(a.id)}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                    title="Delete"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-30">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h3 className="text-base font-semibold text-gray-900">
                {editingAthlete ? 'Edit Athlete' : 'Add Athlete'}
              </h3>
              <button
                onClick={closeModal}
                className="p-1 hover:bg-gray-100 rounded-lg text-gray-500 transition"
              >
                ✕
              </button>
            </div>

            <div className="p-4 space-y-3">
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Full name"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Status
                </label>
                <select
                  value={form.status}
                  onChange={(e) =>
                    setForm({ ...form, status: e.target.value as Status })
                  }
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                >
                  <option>Available</option>
                  <option>Modified</option>
                  <option>Unavailable</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Notes
                </label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Optional notes…"
                  rows={3}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Photo URL
                </label>
                <input
                  type="text"
                  value={form.photo_url}
                  onChange={(e) =>
                    setForm({ ...form, photo_url: e.target.value })
                  }
                  placeholder="https://…"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_public}
                  onChange={(e) =>
                    setForm({ ...form, is_public: e.target.checked })
                  }
                  className="w-4 h-4 text-indigo-600 rounded border-gray-300"
                />
                <span className="text-sm text-gray-700">
                  Make notes public
                </span>
              </label>
            </div>

            <div className="flex gap-2 p-4 border-t border-gray-200">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium text-sm disabled:opacity-50"
              >
                {saving ? 'Saving…' : editingAthlete ? 'Update' : 'Add Athlete'}
              </button>
              <button
                onClick={closeModal}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AthleteManager;
