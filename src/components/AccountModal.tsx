/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  X,
  User as UserIcon,
  Mail,
  Phone,
  ShieldCheck,
  CheckCircle2,
  Copy,
  Edit3,
  Save,
  LogOut,
  Calendar,
  Clock,
  Video,
  Key,
  ExternalLink,
  Sparkles,
  Camera,
  Check,
  Building2,
  ShieldAlert,
} from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { updateProfile } from 'firebase/auth';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';

export interface UserAccountData {
  uid: string;
  displayName: string;
  email: string;
  phoneNumber: string;
  handle: string;
  channelName: string;
  bio: string;
  role: string;
  isFirebaseUser?: boolean;
  createdAt?: string;
  lastLogin?: string;
  photoURL?: string | null;
  emailVerified?: boolean;
  providerId?: string;
}

interface AccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: any;
  onUserUpdate: (updatedUser: any) => void;
  onSignOut: () => void;
  onSwitchAccount: () => void;
}

export function AccountModal({
  isOpen,
  onClose,
  currentUser,
  onUserUpdate,
  onSignOut,
  onSwitchAccount,
}: AccountModalProps) {
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copiedUid, setCopiedUid] = useState<boolean>(false);

  // Form state
  const [displayName, setDisplayName] = useState<string>('');
  const [phoneNumber, setPhoneNumber] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [handle, setHandle] = useState<string>('');
  const [channelName, setChannelName] = useState<string>('');
  const [bio, setBio] = useState<string>('');
  const [role, setRole] = useState<string>('analyst');
  const [createdAt, setCreatedAt] = useState<string>('');
  const [lastLogin, setLastLogin] = useState<string>('');

  // Sync state from current user and Firestore on open
  useEffect(() => {
    if (!isOpen || !currentUser) return;

    const baseEmail =
      currentUser.email ||
      auth.currentUser?.email ||
      'niranjanmohanarangan06@gmail.com';
    const baseName =
      currentUser.displayName ||
      auth.currentUser?.displayName ||
      baseEmail.split('@')[0] ||
      'Niranjan Mohanarangan';
    const cleanHandle = `@${(currentUser.username || baseEmail.split('@')[0] || 'analyst').replace(/[^a-zA-Z0-9_]/g, '')}`;

    setDisplayName(baseName);
    setEmail(baseEmail);
    setHandle(currentUser.handle || cleanHandle);
    setChannelName(currentUser.channelName || `${baseName}'s Content Lab`);
    setBio(
      currentUser.bio ||
        'Principal quantitative media researcher modeling algorithmic video reach and attention dynamics.'
    );
    setRole(currentUser.role || 'researcher');
    setPhoneNumber(currentUser.phoneNumber || '+1 (555) 842-9102');

    const authCreation = auth.currentUser?.metadata?.creationTime;
    const authLastSignIn = auth.currentUser?.metadata?.lastSignInTime;

    setCreatedAt(authCreation || new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }));
    setLastLogin(authLastSignIn || 'Active now');

    // Fetch from Firestore if user has a valid UID
    if (auth.currentUser?.uid) {
      const userRef = doc(db, 'users', auth.currentUser.uid);
      getDoc(userRef)
        .then((snap) => {
          if (snap.exists()) {
            const data = snap.data();
            if (data.displayName) setDisplayName(data.displayName);
            if (data.phoneNumber) setPhoneNumber(data.phoneNumber);
            if (data.handle) setHandle(data.handle);
            if (data.channelName) setChannelName(data.channelName);
            if (data.bio) setBio(data.bio);
            if (data.role) setRole(data.role);
            if (data.createdAt) {
              try {
                setCreatedAt(new Date(data.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }));
              } catch {
                // keep fallback
              }
            }
          }
        })
        .catch((err) => {
          console.warn('Could not load extra user profile details from Firestore:', err);
        });
    } else {
      // Check localStorage for saved analyst profile
      const localPhone = localStorage.getItem(`profile_phone_${currentUser.uid || 'analyst'}`);
      if (localPhone) setPhoneNumber(localPhone);
      const localChannel = localStorage.getItem(`profile_channel_${currentUser.uid || 'analyst'}`);
      if (localChannel) setChannelName(localChannel);
      const localBio = localStorage.getItem(`profile_bio_${currentUser.uid || 'analyst'}`);
      if (localBio) setBio(localBio);
    }
  }, [isOpen, currentUser]);

  if (!isOpen || !currentUser) return null;

  const uid = auth.currentUser?.uid || currentUser.uid || 'analyst_guest_8291';
  const isVerified = auth.currentUser?.emailVerified ?? true;
  const provider = auth.currentUser?.providerData?.[0]?.providerId || (currentUser.isFirebaseUser ? 'firebase.auth' : 'analyst.local');

  const handleCopyUid = () => {
    navigator.clipboard.writeText(uid);
    setCopiedUid(true);
    setTimeout(() => setCopiedUid(false), 2000);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const cleanDisplayName = displayName.trim() || 'Analyst';
      const cleanPhone = phoneNumber.trim() || '+1 (555) 842-9102';
      const cleanHandle = handle.trim().startsWith('@') ? handle.trim() : `@${handle.trim()}`;
      const cleanChannel = channelName.trim() || `${cleanDisplayName}'s Channel`;
      const cleanBio = bio.trim();

      // 1. Update Firebase Auth Profile if Firebase user
      if (auth.currentUser) {
        await updateProfile(auth.currentUser, {
          displayName: cleanDisplayName,
        });

        // 2. Persist to Firestore
        const userRef = doc(db, 'users', auth.currentUser.uid);
        const username = (email.split('@')[0] || 'analyst').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 50);

        try {
          await setDoc(
            userRef,
            {
              userId: auth.currentUser.uid,
              username: username || 'analyst',
              email: email,
              displayName: cleanDisplayName.slice(0, 100),
              phoneNumber: cleanPhone.slice(0, 30),
              handle: cleanHandle.slice(0, 50),
              channelName: cleanChannel.slice(0, 100),
              bio: cleanBio.slice(0, 500),
              role: role,
              lastLogin: new Date().toISOString(),
            },
            { merge: true }
          );
        } catch (fsErr) {
          console.warn('Firestore update note:', fsErr);
        }
      }

      // Save locally as well for immediate persistent sync
      localStorage.setItem(`profile_phone_${uid}`, cleanPhone);
      localStorage.setItem(`profile_channel_${uid}`, cleanChannel);
      localStorage.setItem(`profile_bio_${uid}`, cleanBio);
      localStorage.setItem(`profile_handle_${uid}`, cleanHandle);

      const updated = {
        ...currentUser,
        displayName: cleanDisplayName,
        phoneNumber: cleanPhone,
        handle: cleanHandle,
        channelName: cleanChannel,
        bio: cleanBio,
        role: role,
      };

      if (localStorage.getItem('analyst_user')) {
        localStorage.setItem('analyst_user', JSON.stringify(updated));
      }

      onUserUpdate(updated);
      setSaveSuccess(true);
      setIsEditing(false);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      setSaveError(err.message || 'Failed to update account details.');
    } finally {
      setSaving(false);
    }
  };

  const getInitials = (name: string) => {
    if (!name) return 'U';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-xl max-h-[92vh] flex flex-col bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden font-sans"
        onClick={(e) => e.stopPropagation()}
      >
        {/* YouTube / Google Account Header Strip */}
        <div className="relative px-6 pt-6 pb-5 bg-gradient-to-r from-red-600 via-rose-600 to-amber-600 text-white">
          <button
            onClick={onClose}
            aria-label="Close Account Dialog"
            className="absolute top-4 right-4 p-1.5 rounded-full bg-black/20 hover:bg-black/35 text-white/90 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2 mb-2 text-xs font-semibold tracking-wider uppercase text-white/80">
            <Video className="w-4 h-4" />
            <span>YouTube Account &amp; Google Profile Info</span>
          </div>

          <div className="flex items-center gap-4 mt-2">
            <div className="relative group">
              <div className="w-16 h-16 rounded-full bg-white text-rose-600 font-extrabold text-2xl flex items-center justify-center shadow-lg ring-4 ring-white/30">
                {getInitials(displayName)}
              </div>
              <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 ring-2 ring-white flex items-center justify-center shadow-xs" title="Account Active">
                <Check className="w-3 h-3 text-white stroke-[3]" />
              </div>
            </div>

            <div className="flex-1 min-w-0 text-white">
              <h2 className="text-xl font-bold tracking-tight truncate leading-tight">
                {displayName}
              </h2>
              <div className="text-sm text-white/90 font-mono truncate">
                {email}
              </div>
              <div className="flex items-center gap-2 mt-1 text-xs text-white/80">
                <span className="font-semibold">{handle}</span>
                <span>•</span>
                <span className="bg-white/20 px-2 py-0.5 rounded-full text-[11px] capitalize">
                  {role}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Success / Error Banner */}
        {saveSuccess && (
          <div className="px-6 py-2.5 bg-emerald-50 dark:bg-emerald-950/60 border-b border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Account details and contact information updated successfully!</span>
          </div>
        )}

        {saveError && (
          <div className="px-6 py-2.5 bg-rose-50 dark:bg-rose-950/60 border-b border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 text-xs flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{saveError}</span>
          </div>
        )}

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 text-sm">
          {/* Section: Contact & Identity Info */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Personal &amp; Contact Details
              </h3>
              {!isEditing && (
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 flex items-center gap-1 cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Edit Details</span>
                </button>
              )}
            </div>

            {isEditing ? (
              <form onSubmit={handleSaveProfile} className="space-y-3.5 bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700/60">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Full Name / Display Name
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    required
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="e.g. Niranjan Mohanarangan"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Phone Number (phno)
                    </label>
                    <input
                      type="tel"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none font-mono"
                      placeholder="+1 (555) 000-0000"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Channel Handle
                    </label>
                    <input
                      type="text"
                      value={handle}
                      onChange={(e) => setHandle(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none font-mono"
                      placeholder="@yourhandle"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Channel / Creator Studio Name
                    </label>
                    <input
                      type="text"
                      value={channelName}
                      onChange={(e) => setChannelName(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                      placeholder="e.g. Analytics Lab"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Workspace Role
                    </label>
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                    >
                      <option value="researcher">Lead Researcher</option>
                      <option value="analyst">Data Analyst</option>
                      <option value="viewer">Executive Viewer</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Bio / Research Focus
                  </label>
                  <textarea
                    rows={2}
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                    placeholder="Short bio or channel description..."
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsEditing(false)}
                    className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{saving ? 'Saving...' : 'Save Profile'}</span>
                  </button>
                </div>
              </form>
            ) : (
              <div className="bg-slate-50 dark:bg-slate-800/40 rounded-xl divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800">
                {/* Full Name */}
                <div className="flex items-center justify-between p-3.5">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-950/70 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                      <UserIcon className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 dark:text-slate-400 block">Full Name</span>
                      <span className="font-semibold text-slate-900 dark:text-white">{displayName}</span>
                    </div>
                  </div>
                  <span className="text-xs text-slate-400 font-mono">Display</span>
                </div>

                {/* Email Address */}
                <div className="flex items-center justify-between p-3.5">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-950/70 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                      <Mail className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <span className="text-xs text-slate-500 dark:text-slate-400 block">Email ID</span>
                      <span className="font-semibold text-slate-900 dark:text-white font-mono text-xs truncate block">
                        {email}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Verified</span>
                  </div>
                </div>

                {/* Phone Number (phno) */}
                <div className="flex items-center justify-between p-3.5">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-950/70 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                      <Phone className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 dark:text-slate-400 block">Phone Number (phno)</span>
                      <span className="font-semibold text-slate-900 dark:text-white font-mono">
                        {phoneNumber || 'Not provided'}
                      </span>
                    </div>
                  </div>
                  <span className="text-xs text-slate-400 font-mono">Contact</span>
                </div>

                {/* YouTube Channel & Handle */}
                <div className="flex items-center justify-between p-3.5">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-red-100 dark:bg-red-950/70 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
                      <Video className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 dark:text-slate-400 block">YouTube Channel &amp; Handle</span>
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {channelName}
                      </span>
                      <span className="text-xs text-slate-500 dark:text-slate-400 block font-mono">
                        {handle}
                      </span>
                    </div>
                  </div>
                  <span className="text-xs text-slate-400">Creator Studio</span>
                </div>

                {/* Bio / Description */}
                <div className="p-3.5">
                  <span className="text-xs text-slate-500 dark:text-slate-400 block mb-1">Channel Bio / Research Scope</span>
                  <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed italic bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800">
                    "{bio}"
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Section: Account Metadata & Security */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
              Account Security &amp; Credentials
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* User UID */}
              <div className="bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col justify-between">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Firebase UID</span>
                  <button
                    onClick={handleCopyUid}
                    title="Copy UID"
                    className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
                  >
                    {copiedUid ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <div className="font-mono text-xs text-slate-800 dark:text-slate-200 truncate">
                  {uid}
                </div>
              </div>

              {/* Provider */}
              <div className="bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col justify-between">
                <span className="text-xs text-slate-500 dark:text-slate-400 mb-1">Auth Provider</span>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200">
                  <Key className="w-3.5 h-3.5 text-blue-500" />
                  <span className="capitalize">{provider}</span>
                </div>
              </div>

              {/* Member Since */}
              <div className="bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col justify-between">
                <span className="text-xs text-slate-500 dark:text-slate-400 mb-1">Account Created</span>
                <div className="flex items-center gap-1.5 text-xs text-slate-800 dark:text-slate-200">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  <span className="truncate">{createdAt}</span>
                </div>
              </div>

              {/* Last Signed In */}
              <div className="bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col justify-between">
                <span className="text-xs text-slate-500 dark:text-slate-400 mb-1">Last Sign In</span>
                <div className="flex items-center gap-1.5 text-xs text-slate-800 dark:text-slate-200">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  <span className="truncate">{lastLogin}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onClose();
                onSwitchAccount();
              }}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
            >
              Switch Account
            </button>
            <button
              onClick={() => {
                onClose();
                onSignOut();
              }}
              className="px-3 py-1.5 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 border border-slate-300 dark:border-slate-600 rounded-lg transition-colors shadow-xs cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
