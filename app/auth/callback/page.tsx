'use client';

// app/auth/callback/page.tsx
// Handles Supabase auth redirects — password resets, magic links, OAuth
// Supabase sends the user here after clicking an email link.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Loader2 } from 'lucide-react';

export default function AuthCallbackPage() {
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'set_password' | 'error'>('loading');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Supabase automatically picks up the token from the URL hash
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setStatus('set_password');
      } else {
        setStatus('error');
      }
    });
  }, []);

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { setError('Passwords do not match'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) { setError(error.message); setSaving(false); return; }
    router.push('/');
  };

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-white/30 animate-spin" />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl p-6 max-w-sm w-full text-center">
          <p className="text-slate-700 font-medium mb-2">Link expired or invalid</p>
          <p className="text-slate-400 text-sm mb-4">Please request a new password reset link.</p>
          <a href="/" className="text-blue-600 text-sm hover:underline">Back to sign in</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full">
        <h1 className="text-lg font-bold text-slate-900 mb-1">Set new password</h1>
        <p className="text-slate-400 text-sm mb-5">Choose a strong password for your account.</p>
        <form onSubmit={handleSetPassword} className="space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-slate-600 mb-1.5">New password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              required minLength={8} placeholder="Min. 8 characters"
              className="w-full h-10 px-3 text-[13px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Confirm password</label>
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
              required placeholder="Repeat password"
              className="w-full h-10 px-3 text-[13px] border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          {error && <p className="text-[12px] text-red-600">{error}</p>}
          <button type="submit" disabled={saving}
            className="w-full h-10 bg-blue-600 text-white rounded-lg text-[13px] font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {saving ? 'Saving…' : 'Set password'}
          </button>
        </form>
      </div>
    </div>
  );
}
