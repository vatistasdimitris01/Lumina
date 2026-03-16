import React, { useState, useEffect, useRef } from 'react';
import { 
  GoogleAuthProvider, 
  signInWithPopup, 
  signInAnonymously,
  onAuthStateChanged, 
  signOut,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  collection, 
  query, 
  orderBy, 
  limit, 
  onSnapshot, 
  addDoc, 
  serverTimestamp, 
  doc, 
  getDoc, 
  setDoc, 
  runTransaction,
  getDocs,
  where,
  writeBatch,
  or
} from 'firebase/firestore';
import { 
  ref, 
  uploadBytes, 
  getDownloadURL 
} from 'firebase/storage';
import { auth, db, storage } from './firebase';
import { cn } from './lib/utils';
import { Message, UserProfile } from './types';
import { 
  ArrowUp, 
  Image as ImageIcon, 
  File as FileIcon, 
  Video as VideoIcon, 
  LogOut, 
  User as UserIcon,
  Loader2,
  Paperclip,
  X,
  Search,
  Menu,
  Plus,
  MessageSquare,
  Hash
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeTab, setActiveTab] = useState<'chats' | 'friends'>('chats');
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [showAddFriendModal, setShowAddFriendModal] = useState(false);
  const [friendUsernameInput, setFriendUsernameInput] = useState('');
  const [inputText, setInputText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [friends, setFriends] = useState<UserProfile[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        if (userDoc.exists()) {
          setProfile(userDoc.data() as UserProfile);
          setShowUsernameModal(false);
        } else {
          setShowUsernameModal(true);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setFriends([]);
      return;
    }

    const q = query(
      collection(db, 'friends'),
      or(where('userId1', '==', user.uid), where('userId2', '==', user.uid))
    );

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const friendIds = snapshot.docs.map(doc => {
        const data = doc.data();
        return data.userId1 === user.uid ? data.userId2 : data.userId1;
      });

      if (friendIds.length === 0) {
        setFriends([]);
        return;
      }

      // Fetch user profiles for all friends
      const friendsProfiles: UserProfile[] = [];
      for (const id of friendIds) {
        const userDoc = await getDoc(doc(db, 'users', id));
        if (userDoc.exists()) {
          friendsProfiles.push(userDoc.data() as UserProfile);
        }
      }
      setFriends(friendsProfiles);
    });

    return () => unsubscribe();
  }, [user]);





  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const [loginError, setLoginError] = useState<string | null>(null);

  const handleLogin = async () => {
    setLoginError(null);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error('Login failed', error);
      if (error.code === 'auth/internal-error' || error.message?.includes('initial state')) {
        setLoginError('Iframe restriction detected. Please open the app in a new tab to sign in.');
      } else {
        setLoginError(error.message || 'Login failed. Please try again.');
      }
    }
  };

  const handleAnonymousLogin = async () => {
    setLoginError(null);
    try {
      await signInAnonymously(auth);
    } catch (error: any) {
      console.error('Anonymous login failed', error);
      setLoginError(error.message || 'Anonymous login failed. Please ensure it is enabled in Firebase Console.');
    }
  };

  const handleLogout = () => signOut(auth);

  const handleSetUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    
    const cleanUsername = usernameInput.trim().toLowerCase();
    if (cleanUsername.length < 3) {
      setUsernameError('Username must be at least 3 characters');
      return;
    }
    if (!/^[a-z0-9_]+$/.test(cleanUsername)) {
      setUsernameError('Only letters, numbers, and underscores allowed');
      return;
    }

    setCheckingUsername(true);
    setUsernameError('');

    try {
      await runTransaction(db, async (transaction) => {
        const usernameDocRef = doc(db, 'usernames', cleanUsername);
        const usernameDoc = await transaction.get(usernameDocRef);
        
        if (usernameDoc.exists()) {
          throw new Error('Username already taken');
        }

        const userProfile: UserProfile = {
          uid: user.uid,
          username: cleanUsername,
          displayName: user.displayName || cleanUsername,
          photoURL: user.photoURL || '',
          createdAt: serverTimestamp()
        };

        transaction.set(usernameDocRef, { uid: user.uid });
        transaction.set(doc(db, 'users', user.uid), userProfile);
        setProfile(userProfile);
      });
      setShowUsernameModal(false);
    } catch (error: any) {
      setUsernameError(error.message || 'Failed to set username');
    } finally {
      setCheckingUsername(false);
    }
  };

  const handleAddFriend = async () => {
    if (!user || !friendUsernameInput.trim()) return;
    
    // Find user by username
    const q = query(collection(db, 'users'), where('username', '==', friendUsernameInput.replace('@', '')));
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
      alert('User not found');
      return;
    }
    
    const friendId = snapshot.docs[0].id;
    await addDoc(collection(db, 'friends'), {
      userId1: user.uid,
      userId2: friendId,
      createdAt: serverTimestamp()
    });
    
    setFriendUsernameInput('');
    setShowAddFriendModal(false);
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!user || !profile || !activeChatId || (!inputText.trim() && !selectedFile)) return;

    const text = inputText.trim();
    const file = selectedFile;
    const tempId = Date.now().toString();
    
    setInputText('');
    setSelectedFile(null);

    // Optimistic UI update
    const optimisticMessage: Message = {
      id: tempId,
      senderId: user.uid,
      senderUsername: profile.username,
      text: text || null,
      createdAt: { toDate: () => new Date() } as any,
      isPending: true,
      fileName: file?.name,
      fileType: file?.type
    };
    
    setMessages(prev => [...prev, optimisticMessage]);

    try {
      let fileData = {};
      if (file) {
        setUploading(true);
        const fileRef = ref(storage, `files/${Date.now()}_${file.name}`);
        await uploadBytes(fileRef, file);
        const url = await getDownloadURL(fileRef);
        fileData = {
          fileUrl: url,
          fileType: file.type,
          fileName: file.name
        };
      }

      await addDoc(collection(db, 'chats', activeChatId, 'messages'), {
        senderId: user.uid,
        senderUsername: profile.username,
        text: text || null,
        ...fileData,
        createdAt: serverTimestamp()
      });
      
      // Remove optimistic message once real one arrives via onSnapshot
      // (onSnapshot will handle the update, we just need to make sure we don't show duplicates)
    } catch (error) {
      console.error('Failed to send message', error);
      setMessages(prev => prev.filter(m => m.id !== tempId));
      setLoginError('Failed to send message. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const filteredMessages = messages.filter(msg => 
    msg.text?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    msg.senderUsername.toLowerCase().includes(searchQuery.toLowerCase()) ||
    msg.fileName?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black text-white">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#050505] p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md p-8 bg-zinc-900/50 backdrop-blur-xl rounded-3xl border border-white/5 shadow-2xl text-center"
        >
          <h1 className="text-4xl font-light tracking-tight mb-2 text-white">Lumina</h1>
          <p className="text-zinc-500 mb-8 font-light">Minimalist sharing for the modern web.</p>
          <button 
            onClick={handleLogin}
            className="w-full py-4 bg-white text-black rounded-2xl font-medium hover:bg-zinc-200 transition-all flex items-center justify-center gap-3 shadow-lg"
          >
            <UserIcon className="w-5 h-5" />
            Continue with Google
          </button>
          
          <button 
            onClick={handleAnonymousLogin}
            className="w-full py-4 bg-zinc-800 text-white border border-zinc-700 rounded-2xl font-medium hover:bg-zinc-700 transition-all flex items-center justify-center gap-3 mt-3"
          >
            <UserIcon className="w-5 h-5 opacity-50" />
            Continue Anonymously
          </button>
          {loginError && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-6 p-4 bg-red-500/10 rounded-2xl border border-red-500/20"
            >
              <p className="text-red-400 text-sm font-medium">{loginError}</p>
              <p className="text-red-400/60 text-xs mt-1">
                Click the "Open in new tab" icon in the top right of the preview to fix this.
              </p>
            </motion.div>
          )}
        </motion.div>
      </div>
    );
  }

  if (showUsernameModal) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#050505] p-6">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md p-8 bg-zinc-900/50 backdrop-blur-xl rounded-3xl border border-white/5 shadow-2xl"
        >
          <h2 className="text-2xl font-light mb-6 text-white">Choose your username</h2>
          <form onSubmit={handleSetUsername} className="space-y-4">
            <div>
              <input 
                type="text"
                placeholder="username"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                className="w-full p-4 bg-zinc-800/50 border border-zinc-700 rounded-2xl text-white focus:ring-2 focus:ring-white/20 outline-none transition-all"
                disabled={checkingUsername}
              />
              {usernameError && <p className="text-red-400 text-sm mt-2 ml-2">{usernameError}</p>}
            </div>
            <button 
              type="submit"
              disabled={checkingUsername}
              className="w-full py-4 bg-white text-black rounded-2xl font-medium hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-600 transition-all flex items-center justify-center gap-2"
            >
              {checkingUsername ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Start Chatting'}
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[#050505] text-white font-sans">
      {/* Header */}
      <header className="h-16 px-4 sm:px-6 flex items-center justify-between bg-black/50 backdrop-blur-md border-b border-zinc-800/50 sticky top-0 z-10">
        <h1 className="text-xl font-light tracking-tight text-white hidden md:block">Lumina</h1>

        {/* Search Bar */}
        <div className="flex-1 max-w-md mx-4 relative">
          <div className="relative flex items-center">
            <Search className="absolute left-3 w-4 h-4 text-zinc-500" />
            <input 
              type="text" 
              placeholder={`Search ${activeTab}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full py-2 pl-10 pr-4 bg-zinc-900/50 border border-zinc-800/50 rounded-full text-sm text-white focus:ring-1 focus:ring-white/10 outline-none transition-all"
            />
          </div>
        </div>

        {/* Tabs - Desktop */}
        <div className="hidden md:flex bg-zinc-900 rounded-full p-1">
          <button 
            onClick={() => setActiveTab('chats')}
            className={cn("px-4 py-1.5 rounded-full text-sm transition-all", activeTab === 'chats' ? "bg-white text-black" : "text-zinc-400 hover:text-white")}
          >
            Chats
          </button>
          <button 
            onClick={() => setActiveTab('friends')}
            className={cn("px-4 py-1.5 rounded-full text-sm transition-all", activeTab === 'friends' ? "bg-white text-black" : "text-zinc-400 hover:text-white")}
          >
            Friends
          </button>
        </div>

        <div className="flex items-center gap-4 min-w-[40px] justify-end">
          <button 
            onClick={handleLogout}
            className="p-2 hover:bg-zinc-800 rounded-full transition-all text-zinc-400"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Content Area */}
      <main className="flex-1 overflow-y-auto p-4 pb-24">
        {activeTab === 'chats' && (
          <div className="max-w-3xl mx-auto space-y-2">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-medium text-white">Chats</h2>
              <button onClick={() => setShowAddFriendModal(true)} className="p-2 bg-zinc-900 rounded-full hover:bg-zinc-800"><Plus className="w-5 h-5 text-white" /></button>
            </div>
          </div>
        )}
        {activeTab === 'friends' && (
          <div className="max-w-3xl mx-auto space-y-2">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-medium text-white">Friends</h2>
              <button onClick={() => setShowAddFriendModal(true)} className="p-2 bg-zinc-900 rounded-full hover:bg-zinc-800"><Plus className="w-5 h-5 text-white" /></button>
            </div>
            {friends.length === 0 ? (
              <p className="text-zinc-500 text-sm">No friends yet.</p>
            ) : (
              <div className="space-y-2">
                {friends.map(friend => (
                  <div key={friend.uid} className="flex items-center gap-3 p-3 bg-zinc-900/50 rounded-xl border border-zinc-800/50">
                    <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center overflow-hidden">
                      {friend.photoURL ? (
                        <img src={friend.photoURL} alt={friend.username} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <UserIcon className="w-5 h-5 text-zinc-500" />
                      )}
                    </div>
                    <div>
                      <p className="text-white font-medium">{friend.displayName}</p>
                      <p className="text-zinc-500 text-sm">@{friend.username}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Floating Nav Bar */}
      <nav className="fixed bottom-2 left-16 right-16 bg-zinc-900/80 backdrop-blur-lg border border-zinc-800 rounded-full p-1 flex justify-around items-center z-30 md:hidden">
        <button onClick={() => setActiveTab('chats')} className={cn("p-2 rounded-full transition-all", activeTab === 'chats' ? "bg-white text-black" : "text-zinc-400")}><MessageSquare className="w-5 h-5" /></button>
        <button onClick={() => setActiveTab('friends')} className={cn("p-2 rounded-full transition-all", activeTab === 'friends' ? "bg-white text-black" : "text-zinc-400")}><UserIcon className="w-5 h-5" /></button>
      </nav>

      {/* Add Friend Modal */}
      <AnimatePresence>
        {showAddFriendModal && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowAddFriendModal(false)} className="fixed inset-0 bg-black/50 z-50" />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="bg-zinc-900 p-6 rounded-2xl border border-zinc-800 w-full max-w-sm">
                <h2 className="text-white text-lg font-medium mb-4">Add Friend</h2>
                <input 
                  type="text" 
                  placeholder="@username" 
                  className="w-full p-3 bg-black rounded-xl text-white mb-4" 
                  value={friendUsernameInput}
                  onChange={(e) => setFriendUsernameInput(e.target.value)}
                />
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowAddFriendModal(false)} className="px-4 py-2 text-zinc-400">Cancel</button>
                  <button onClick={handleAddFriend} className="px-4 py-2 bg-white text-black rounded-lg">Add</button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
