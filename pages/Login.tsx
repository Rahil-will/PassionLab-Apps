import React, { useState } from 'react';
import { useNavigationStore, useNotificationStore } from '../stores';
import { RoutePath } from '../types';
import { supabase } from '../lib/supabase';
import {
  applyAuthenticatedProfile,
  desktopAccessError,
  fetchMyProfile,
} from '../lib/authSession';
import {
  Hexagon,
  ArrowRight,
  ShieldCheck,
  Mail,
  Lock,
  Factory,
  BarChart3,
  Layers,
  ArrowLeft,
} from 'lucide-react';

type LoginView = 'login' | 'forgot-password';

function loginErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'Login failed';
  const msg = error.message.toLowerCase();
  if (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('name not resolved') ||
    msg.includes('load failed')
  ) {
    return 'Cannot reach Supabase. Check your internet connection, confirm VITE_SUPABASE_URL in .env.local, then restart the dev server.';
  }
  return error.message;
}

export const Login: React.FC = () => {
  const { navigate } = useNavigationStore();
  const { showNotification } = useNotificationStore();

  const [view, setView] = useState<LoginView>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      showNotification('Please enter email and password', 'error');
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        showNotification(error.message, 'error');
        return;
      }

      const { profile, error: profileError } = await fetchMyProfile();
      if (profileError || !profile) {
        showNotification(profileError ?? 'Could not load your profile.', 'error');
        await supabase.auth.signOut();
        return;
      }

      const accessError = desktopAccessError(profile);
      if (accessError) {
        showNotification(accessError, 'error');
        await supabase.auth.signOut();
        return;
      }

      applyAuthenticatedProfile(profile, email.trim());
      showNotification(`Welcome back, ${profile.full_name || 'Admin'}!`, 'success');
      navigate(RoutePath.DASHBOARD);
    } catch (error: unknown) {
      showNotification(loginErrorMessage(error), 'error');
      await supabase.auth.signOut();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-slate-50 font-sans overflow-hidden relative p-4 md:p-8">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-blue-100/50 rounded-full blur-[100px] animate-[pulse_8s_infinite]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] bg-sky-100/60 rounded-full blur-[120px] animate-[pulse_10s_infinite]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:40px_40px]" />
      </div>

      <div className="w-full max-w-5xl min-h-[600px] bg-white/80 backdrop-blur-xl rounded-3xl shadow-2xl overflow-hidden flex z-10 border border-white/50 ring-1 ring-slate-200">
        <div className="hidden lg:flex w-5/12 bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-700 relative flex-col justify-between p-10 overflow-hidden border-r border-blue-500/30">
          <div className="absolute top-0 right-0 p-32 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center shadow-lg border border-white/30">
                <Hexagon className="text-white fill-current" size={20} />
              </div>
              <span className="text-xs font-bold text-white tracking-tight">PRODIGI</span>
            </div>
            <h1 className="text-xs font-bold text-white mb-4 leading-tight tracking-tight">
              Smart Factory <br />
              <span className="text-blue-200 text-[10px] font-medium">Operating System</span>
            </h1>
            <p className="text-blue-100 text-xs leading-relaxed mb-8">
              Production execution for apparel factories. Orders, planning, floor capture, and reports in one place.
            </p>
            <div className="space-y-5">
              {[
                { icon: Factory, label: 'Real-time Visibility' },
                { icon: BarChart3, label: 'Actionable Insights' },
                { icon: Layers, label: 'Full Traceability' },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-center gap-3">
                  <div className="w-10 h-10 flex items-center justify-center bg-white/10 rounded-lg border border-white/20">
                    <Icon className="text-white" size={18} />
                  </div>
                  <h3 className="text-white font-bold text-xs">{label}</h3>
                </div>
              ))}
            </div>
          </div>
          <div className="relative z-10 flex items-center gap-2 text-blue-200 text-[10px] font-medium uppercase tracking-wider">
            <ShieldCheck size={12} />
            <span>Secured by RBC Enterprise</span>
          </div>
        </div>

        <div className="w-full lg:w-7/12 flex items-center justify-center p-8 bg-white/60">
          <div className="w-full max-w-sm">
            {view === 'login' && (
              <div>
                <div className="mb-8 text-center lg:text-left">
                  <h2 className="text-base font-bold text-slate-900 mb-2">Sign in</h2>
                  <p className="text-slate-500 text-xs">Use the credentials provided by your administrator.</p>
                </div>

                <form onSubmit={handleLogin} className="space-y-5">
                  <div>
                    <label className="text-[10px] font-bold text-slate-700 uppercase mb-1.5 block">Email</label>
                    <div className="relative">
                      <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                      <input
                        type="email"
                        className="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-xl py-3 pl-10 pr-4 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50 transition-all font-medium text-xs"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="name@company.com"
                        autoComplete="email"
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between mb-1.5">
                      <label className="text-[10px] font-bold text-slate-700 uppercase">Password</label>
                      <button
                        type="button"
                        onClick={() => setView('forgot-password')}
                        className="text-[10px] text-blue-600 hover:text-blue-800 font-bold"
                      >
                        Forgot?
                      </button>
                    </div>
                    <div className="relative">
                      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                      <input
                        type="password"
                        className="w-full bg-slate-50 border border-slate-200 text-slate-900 rounded-xl py-3 pl-10 pr-4 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50 transition-all font-medium text-xs"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Password"
                        autoComplete="current-password"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="group w-full bg-slate-900 text-white font-bold py-3.5 px-6 rounded-xl hover:bg-blue-600 focus:ring-4 focus:ring-slate-200 transition-all flex items-center justify-center gap-3 shadow-xl shadow-slate-200 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span>{isLoading ? 'Signing in...' : 'Sign In'}</span>
                    {!isLoading && <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />}
                  </button>
                </form>

                <div className="mt-8 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[11px] text-slate-600 leading-relaxed">
                    <span className="font-bold text-slate-800">New factory setup?</span>{' '}
                    Contact <span className="font-bold">RBC</span> to provision your workspace.
                    Self-service factory creation is not available in this app.
                  </p>
                </div>
              </div>
            )}

            {view === 'forgot-password' && (
              <div>
                <button
                  onClick={() => setView('login')}
                  className="flex items-center text-slate-400 hover:text-slate-600 text-xs font-bold uppercase mb-6 transition-colors"
                >
                  <ArrowLeft size={12} className="mr-1" /> Back to Sign In
                </button>

                <div className="mb-6">
                  <h2 className="text-base font-bold text-slate-900">Password help</h2>
                  <p className="text-slate-500 text-xs mt-1">Password resets are handled by your administrator.</p>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 mb-6">
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Contact your <span className="font-bold">factory administrator</span> or{' '}
                    <span className="font-bold">RBC support</span> to reset your password.
                  </p>
                </div>

                <button
                  onClick={() => setView('login')}
                  className="w-full bg-slate-900 text-white font-bold py-3.5 px-6 rounded-xl hover:bg-blue-600 transition-all text-xs"
                >
                  Back to Sign In
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
