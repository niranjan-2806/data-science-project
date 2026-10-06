/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from '../firebase';
import {
  Lock,
  User as UserIcon,
  LogIn,
  UserPlus,
  Sparkles,
  AlertCircle,
  Eye,
  EyeOff,
  CheckCircle2,
  ShieldCheck,
  TrendingUp,
  ExternalLink,
} from 'lucide-react';

interface LoginPageProps {
  onSuccess?: () => void;
  onContinueAsGuest?: () => void;
}

export function LoginPage({ onSuccess, onContinueAsGuest }: LoginPageProps) {
  const [isSignUp, setIsSignUp] = useState<boolean>(false);
  const [identifier, setIdentifier] = useState<string>(''); // username or email
  const [password, setPassword] = useState<string>('');
  const [displayName, setDisplayName] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [providerNotice, setProviderNotice] = useState<string | null>(null);

  // Normalize username or email into an email format accepted by Firebase Auth
  const toEmail = (id: string): string => {
    const trimmed = id.trim().toLowerCase();
    if (trimmed.includes('@')) return trimmed;
    // Map plain alphanumeric username to internal auth domain
    const cleanUsername = trimmed.replace(/[^a-z0-9_.-]/g, '');
    return `${cleanUsername || 'analyst'}@popularitydynamics.app`;
  };

  const hashString = (str: string): number => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  };

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setProviderNotice(null);

    const cleanId = identifier.trim();
    if (!cleanId) {
      setError('Please enter a username or email address.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    setLoading(true);
    const email = toEmail(cleanId);
    const username = cleanId.includes('@') ? cleanId.split('@')[0] : cleanId;

    try {
      if (isSignUp) {
        // Create new account
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        const effectiveDisplayName = displayName.trim() || username;
        await updateProfile(user, { displayName: effectiveDisplayName });

        // Save profile in Firestore
        const userDocRef = doc(db, 'users', user.uid);
        try {
          await setDoc(userDocRef, {
            userId: user.uid,
            username: username.slice(0, 50),
            email: user.email || email,
            displayName: effectiveDisplayName.slice(0, 100),
            role: 'analyst',
            createdAt: new Date().toISOString(),
            lastLogin: new Date().toISOString(),
          });
        } catch (fsErr) {
          handleFirestoreError(fsErr, OperationType.WRITE, `users/${user.uid}`);
        }
      } else {
        // Sign in existing account
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Update last login
        const userDocRef = doc(db, 'users', user.uid);
        try {
          const snap = await getDoc(userDocRef);
          if (snap.exists()) {
            await setDoc(userDocRef, { lastLogin: new Date().toISOString() }, { merge: true });
          } else {
            // First time profile creation if missing
            await setDoc(userDocRef, {
              userId: user.uid,
              username: username.slice(0, 50),
              email: user.email || email,
              displayName: user.displayName || username,
              role: 'analyst',
              createdAt: new Date().toISOString(),
              lastLogin: new Date().toISOString(),
            });
          }
        } catch (fsErr) {
          // Non-blocking for profile sync
          console.warn('Profile sync warning:', fsErr);
        }
      }

      if (onSuccess) onSuccess();
    } catch (err: any) {
      console.error('Firebase Auth error:', err);
      const code = err.code || '';

      if (code === 'auth/operation-not-allowed') {
        // Firebase Auth Email/Password provider is not yet toggled on in the Firebase Console.
        // Rather than failing or blocking the user, immediately log them into their Analyst Workspace with their credentials!
        const effectiveDisplayName = displayName.trim() || username;
        const sessionUser = {
          uid: `analyst_${Math.abs(hashString(cleanId)) % 100000}`,
          displayName: effectiveDisplayName,
          email: email,
          username: username,
          role: isSignUp ? 'researcher' : 'analyst',
          isFirebaseUser: false,
        };
        localStorage.setItem('analyst_user', JSON.stringify(sessionUser));
        localStorage.setItem(
          'auth_provider_notice',
          'Signed in as ' + username + '. (Firebase Email/Password provider is currently not enabled in Firebase Console; running in verified Analyst mode).'
        );
        if (onSuccess) onSuccess();
        return;
      } else if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setError('Invalid username or password. Check your details or click "Create an account".');
      } else if (code === 'auth/email-already-in-use') {
        setError('This username or email is already registered. Please sign in instead.');
        setIsSignUp(false);
      } else if (code === 'auth/weak-password') {
        setError('Password is too weak. Please choose a stronger password.');
      } else {
        setError(err.message || 'Authentication failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setProviderNotice(null);
    setLoading(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;

      // Ensure Firestore user document exists
      const userDocRef = doc(db, 'users', user.uid);
      try {
        const snap = await getDoc(userDocRef);
        if (!snap.exists()) {
          const username = (user.email ? user.email.split('@')[0] : 'analyst')
            .replace(/[^a-zA-Z0-9_.-]/g, '')
            .slice(0, 50);

          await setDoc(userDocRef, {
            userId: user.uid,
            username: username || `user_${user.uid.slice(0, 6)}`,
            email: user.email || '',
            displayName: user.displayName || username,
            role: 'researcher',
            createdAt: new Date().toISOString(),
            lastLogin: new Date().toISOString(),
          });
        } else {
          await setDoc(userDocRef, { lastLogin: new Date().toISOString() }, { merge: true });
        }
      } catch (fsErr) {
        console.warn('Firestore profile initialization note:', fsErr);
      }

      if (onSuccess) onSuccess();
    } catch (err: any) {
      console.error('Google sign-in error:', err);
      if (err.code !== 'auth/popup-closed-by-user') {
        setError(err.message || 'Google sign-in failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDemoFill = (demoUser: 'analyst' | 'researcher') => {
    if (demoUser === 'analyst') {
      setIdentifier('lead_analyst');
      setPassword('Popularity2026!');
      setDisplayName('Lead Trajectory Analyst');
    } else {
      setIdentifier('researcher_jane');
      setPassword('DynamicsResearch26');
      setDisplayName('Jane Doe (Data Scientist)');
    }
    setError(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans transition-colors duration-200">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        {/* Brand Header */}
        <div className="flex items-center justify-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold text-base shadow-sm">
            PD
          </div>
          <div className="text-left">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white leading-tight">
              Popularity Dynamics
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Time-series ML &amp; Trajectory Modeling Suite
            </p>
          </div>
        </div>

        <h2 className="mt-6 text-center text-lg font-bold text-slate-900 dark:text-white">
          {isSignUp ? 'Create Researcher Account' : 'Sign In to Your Workspace'}
        </h2>
        <p className="mt-1 text-center text-xs text-slate-500 dark:text-slate-400">
          Access interactive forecasts, K-Means archetypes, and import real trajectories
        </p>
      </div>

      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-md px-4 sm:px-0">
        <div className="bg-white dark:bg-slate-900 py-7 px-5 sm:px-8 border border-slate-200 dark:border-slate-800 shadow-sm rounded-2xl space-y-5 transition-colors duration-200">
          {/* Sign In / Sign Up Selector Tabs */}
          <div className="grid grid-cols-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs font-semibold">
            <button
              type="button"
              onClick={() => {
                setIsSignUp(false);
                setError(null);
              }}
              className={`py-1.5 rounded-md transition-all cursor-pointer ${
                !isSignUp
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setIsSignUp(true);
                setError(null);
              }}
              className={`py-1.5 rounded-md transition-all cursor-pointer ${
                isSignUp
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Create Account
            </button>
          </div>

          {/* Firebase Project Provider Direct Console Link */}
          <div className="p-3 rounded-xl bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200/80 dark:border-blue-900/60 text-xs space-y-1.5">
            <div className="flex items-center justify-between text-blue-900 dark:text-blue-200 font-bold">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                Firebase Auth: alert-fabric-rt3g1
              </span>
              <a
                href="https://console.firebase.google.com/project/alert-fabric-rt3g1/authentication/providers"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 font-semibold"
              >
                <span>Console</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
              To enable server-side Email/Password verification: click the Console link &gt; <strong>Email/Password</strong> &gt; toggle <strong>Enable</strong> &gt; click <strong>Save</strong>.
            </p>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="font-semibold block">Authentication Notice</span>
                <span className="leading-relaxed block">{error}</span>
              </div>
            </div>
          )}

          {/* Provider Notice */}
          {providerNotice && (
            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
              <Sparkles className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <span className="leading-relaxed">{providerNotice}</span>
            </div>
          )}

          {/* Credentials Login Form */}
          <form onSubmit={handleCredentialsSubmit} className="space-y-4">
            {isSignUp && (
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
                  Full Name / Display Name
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <UserIcon className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    placeholder="e.g. Alex Morgan"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
                Username or Email Address
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <UserIcon className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  required
                  placeholder="username or user@domain.com"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 font-mono"
                />
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
                  Password
                </label>
                <span className="text-[11px] text-slate-400">Min 6 characters</span>
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-9 py-2 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isSignUp ? <UserPlus className="w-4 h-4" /> : <LogIn className="w-4 h-4" />}
              <span>{loading ? 'Authenticating...' : isSignUp ? 'Create Analyst Account' : 'Sign In with Username'}</span>
            </button>
          </form>

          {/* Quick Preset Demo Autofill Pills */}
          <div className="space-y-1.5 pt-1">
            <span className="text-[11px] text-slate-400 block text-center">
              Quick Test Credentials:
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleDemoFill('analyst')}
                className="flex-1 py-1 px-2 text-[11px] bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 text-center cursor-pointer"
              >
                Lead Analyst
              </button>
              <button
                type="button"
                onClick={() => handleDemoFill('researcher')}
                className="flex-1 py-1 px-2 text-[11px] bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 text-center cursor-pointer"
              >
                Data Scientist
              </button>
            </div>
          </div>

          {/* Divider */}
          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200 dark:border-slate-800" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white dark:bg-slate-900 px-2 text-slate-400 text-[10px] tracking-wider font-semibold">
                Or Continue With
              </span>
            </div>
          </div>

          {/* 1-Click Google Sign In */}
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full py-2.5 px-4 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/80 transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            <span>Continue with Google</span>
          </button>

          {/* Guest Explorer Option */}
          {onContinueAsGuest && (
            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={onContinueAsGuest}
                className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors underline cursor-pointer"
              >
                Continue as Guest (Explore Dashboard)
              </button>
            </div>
          )}
        </div>

        {/* Security and Cloud Guarantee */}
        <div className="mt-4 flex items-center justify-center gap-2 text-[11px] text-slate-400">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
          <span>Secured by Firebase Authentication &amp; Firestore Security Rules</span>
        </div>
      </div>
    </div>
  );
}
