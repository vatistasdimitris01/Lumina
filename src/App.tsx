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
import { Message, UserProfile, Chat } from './types';
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
  const [chats, setChats] = useState<(Chat & { otherUser?: UserProfile })[]>([]);
  const [activeChatUser, setActiveChatUser] = useState<UserProfile | null>(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [editUsernameInput, setEditUsernameInput] = useState('');
  const [searchResults, setSearchResults] = useState<{ users: UserProfile[], chats: (Chat & { otherUser?: UserProfile })[] }>({ users: [], chats: [] });
  const [isSearching, setIsSearching] = useState(false);

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
    if (!user) {
      setChats([]);
      return;
    }

    const q = query(
      collection(db, 'chats'),
      where('participants', 'array-contains', user.uid)
    );

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const chatsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Chat));
      
      const chatsWithUsers = await Promise.all(chatsData.map(async (chat) => {
        const otherUserId = chat.participants.find(id => id !== user.uid);
        if (otherUserId) {
          const userDoc = await getDoc(doc(db, 'users', otherUserId));
          if (userDoc.exists()) {
            return { ...chat, otherUser: userDoc.data() as UserProfile };
          }
        }
        return chat;
      }));
      
      // Sort by lastMessageTime descending
      chatsWithUsers.sort((a, b) => {
        const timeA = a.lastMessageTime?.toMillis?.() || 0;
        const timeB = b.lastMessageTime?.toMillis?.() || 0;
        return timeB - timeA;
      });
      
      setChats(chatsWithUsers);
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!activeChatId) {
      setMessages([]);
      return;
    }

    const q = query(
      collection(db, 'chats', activeChatId, 'messages'),
      orderBy('createdAt', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Message[];
      setMessages(msgs);
    });

    return () => unsubscribe();
  }, [activeChatId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (!searchQuery.trim() || !user) {
      setSearchResults({ users: [], chats: [] });
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const search = async () => {
      try {
        const queryText = searchQuery.toLowerCase();
        
        // Search users (prefix match on username)
        const usersRef = collection(db, 'users');
        const q = query(
          usersRef, 
          where('username', '>=', queryText),
          where('username', '<=', queryText + '\uf8ff'),
          limit(5)
        );
        const usersSnapshot = await getDocs(q);
        const foundUsers = usersSnapshot.docs
          .map(doc => doc.data() as UserProfile)
          .filter(u => u.uid !== user.uid);

        // Search chats (filter existing chats state)
        const foundChats = chats.filter(chat => 
          chat.otherUser?.username.toLowerCase().includes(queryText) ||
          chat.otherUser?.displayName.toLowerCase().includes(queryText)
        );

        setSearchResults({ users: foundUsers, chats: foundChats });
      } catch (error) {
        console.error('Search error:', error);
      } finally {
        setIsSearching(false);
      }
    };

    const debounce = setTimeout(search, 300);
    return () => clearTimeout(debounce);
  }, [searchQuery, user, chats]);

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

  const handleChangeUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !profile) return;
    
    const cleanUsername = editUsernameInput.trim().toLowerCase();
    if (cleanUsername === profile.username) {
      setShowProfileModal(false);
      return;
    }

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
        const newUsernameDocRef = doc(db, 'usernames', cleanUsername);
        const newUsernameDoc = await transaction.get(newUsernameDocRef);
        
        if (newUsernameDoc.exists()) {
          throw new Error('Username already taken');
        }

        const oldUsernameDocRef = doc(db, 'usernames', profile.username);

        const userProfileRef = doc(db, 'users', user.uid);
        
        transaction.set(newUsernameDocRef, { uid: user.uid });
        transaction.delete(oldUsernameDocRef);
        transaction.update(userProfileRef, { username: cleanUsername });
        
        setProfile({ ...profile, username: cleanUsername });
      });
      setShowProfileModal(false);
    } catch (error: any) {
      setUsernameError(error.message || 'Failed to change username');
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

  const handleStartChat = async (friend: UserProfile) => {
    if (!user) return;
    
    // Check if chat already exists
    const existingChat = chats.find(c => c.participants.includes(friend.uid));
    
    if (existingChat) {
      setActiveChatId(existingChat.id);
      setActiveChatUser(friend);
      setActiveTab('chats');
      setSearchQuery('');
      return;
    }

    // Create new chat
    const chatRef = await addDoc(collection(db, 'chats'), {
      participants: [user.uid, friend.uid],
      createdAt: serverTimestamp(),
      lastMessageTime: serverTimestamp()
    });

    setActiveChatId(chatRef.id);
    setActiveChatUser(friend);
    setActiveTab('chats');
    setSearchQuery('');
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

      await setDoc(doc(db, 'chats', activeChatId), {
        lastMessage: text || (file ? `Sent a ${file.type.split('/')[0]}` : 'Sent an attachment'),
        lastMessageTime: serverTimestamp()
      }, { merge: true });
      
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
              placeholder="Search people and chats..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full py-2 pl-10 pr-4 bg-zinc-900/50 border border-zinc-800/50 rounded-full text-sm text-white focus:ring-1 focus:ring-white/10 outline-none transition-all"
            />
          </div>

          {/* Search Results Dropdown */}
          <AnimatePresence>
            {searchQuery.trim() && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="absolute top-full left-0 right-0 mt-2 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden z-50 max-h-[400px] overflow-y-auto"
              >
                {isSearching ? (
                  <div className="p-4 flex justify-center">
                    <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
                  </div>
                ) : searchResults.users.length === 0 && searchResults.chats.length === 0 ? (
                  <div className="p-4 text-center text-zinc-500 text-sm">No results found</div>
                ) : (
                  <div className="py-2">
                    {searchResults.chats.length > 0 && (
                      <div className="mb-2">
                        <h3 className="px-4 py-1 text-xs font-medium text-zinc-500 uppercase tracking-wider">Chats</h3>
                        {searchResults.chats.map(chat => (
                          <button
                            key={chat.id}
                            onClick={() => {
                              setActiveChatId(chat.id);
                              setActiveChatUser(chat.otherUser || null);
                              setActiveTab('chats');
                              setSearchQuery('');
                            }}
                            className="w-full px-4 py-2 flex items-center gap-3 hover:bg-zinc-800/50 transition-colors text-left"
                          >
                            <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center overflow-hidden flex-shrink-0">
                              {chat.otherUser?.photoURL ? (
                                <img src={chat.otherUser.photoURL} alt={chat.otherUser.username} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                              ) : (
                                <UserIcon className="w-4 h-4 text-zinc-500" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-white truncate">{chat.otherUser?.displayName}</p>
                              <p className="text-xs text-zinc-500 truncate">@{chat.otherUser?.username}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    
                    {searchResults.users.length > 0 && (
                      <div>
                        <h3 className="px-4 py-1 text-xs font-medium text-zinc-500 uppercase tracking-wider">People</h3>
                        {searchResults.users.map(user => (
                          <button
                            key={user.uid}
                            onClick={() => handleStartChat(user)}
                            className="w-full px-4 py-2 flex items-center gap-3 hover:bg-zinc-800/50 transition-colors text-left"
                          >
                            <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center overflow-hidden flex-shrink-0">
                              {user.photoURL ? (
                                <img src={user.photoURL} alt={user.username} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                              ) : (
                                <UserIcon className="w-4 h-4 text-zinc-500" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-white truncate">{user.displayName}</p>
                              <p className="text-xs text-zinc-500 truncate">@{user.username}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
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
            onClick={() => {
              setEditUsernameInput(profile?.username || '');
              setShowProfileModal(true);
            }}
            className="p-2 hover:bg-zinc-800 rounded-full transition-all text-zinc-400"
          >
            <UserIcon className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Profile Modal */}
      <AnimatePresence>
        {showProfileModal && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowProfileModal(false)} className="fixed inset-0 bg-black/50 z-50" />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="bg-zinc-900 p-6 rounded-2xl border border-zinc-800 w-full max-w-sm">
                <h2 className="text-white text-lg font-medium mb-4">Profile</h2>
                <form onSubmit={handleChangeUsername} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-1">Username</label>
                    <input 
                      type="text" 
                      placeholder="@username" 
                      className="w-full p-3 bg-black rounded-xl text-white" 
                      value={editUsernameInput}
                      onChange={(e) => setEditUsernameInput(e.target.value)}
                      disabled={checkingUsername}
                    />
                    {usernameError && <p className="text-red-400 text-sm mt-1">{usernameError}</p>}
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <button type="button" onClick={() => setShowProfileModal(false)} className="px-4 py-2 text-zinc-400">Cancel</button>
                    <button type="submit" disabled={checkingUsername} className="px-4 py-2 bg-white text-black rounded-lg disabled:opacity-50">
                      {checkingUsername ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
                    </button>
                  </div>
                </form>
                
                <div className="mt-6 pt-6 border-t border-zinc-800">
                  <button 
                    onClick={handleLogout}
                    className="w-full py-3 flex items-center justify-center gap-2 text-red-400 hover:bg-red-500/10 rounded-xl transition-all"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Log Out</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Content Area */}
      <main className="flex-1 overflow-y-auto p-4 pb-24">
        {activeTab === 'chats' && !activeChatId && (
          <div className="max-w-3xl mx-auto space-y-2">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-medium text-white">Chats</h2>
              <button onClick={() => setShowAddFriendModal(true)} className="p-2 bg-zinc-900 rounded-full hover:bg-zinc-800"><Plus className="w-5 h-5 text-white" /></button>
            </div>
            {chats.length === 0 ? (
              <p className="text-zinc-500 text-sm">No chats yet.</p>
            ) : (
              <div className="space-y-2">
                {chats.map(chat => (
                  <div key={chat.id} onClick={() => { setActiveChatId(chat.id); setActiveChatUser(chat.otherUser || null); }} className="flex items-center gap-3 p-3 bg-zinc-900/50 rounded-xl border border-zinc-800/50 cursor-pointer hover:bg-zinc-800/50 transition-all">
                    <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center overflow-hidden flex-shrink-0">
                      {chat.otherUser?.photoURL ? (
                        <img src={chat.otherUser.photoURL} alt={chat.otherUser.username} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <UserIcon className="w-6 h-6 text-zinc-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-medium truncate">{chat.otherUser?.displayName || 'Unknown User'}</p>
                      <p className="text-zinc-500 text-sm truncate">{chat.lastMessage || 'No messages yet'}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'chats' && activeChatId && (
          <div className="max-w-3xl mx-auto flex flex-col h-[calc(100vh-12rem)]">
            <div className="flex items-center gap-3 mb-4 pb-4 border-b border-zinc-800/50">
              <button onClick={() => { setActiveChatId(null); setActiveChatUser(null); }} className="p-2 hover:bg-zinc-800 rounded-full text-zinc-400">
                <ArrowUp className="w-5 h-5 -rotate-90" />
              </button>
              <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center overflow-hidden">
                {activeChatUser?.photoURL ? (
                  <img src={activeChatUser.photoURL} alt={activeChatUser.username} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <UserIcon className="w-5 h-5 text-zinc-500" />
                )}
              </div>
              <div>
                <p className="text-white font-medium">{activeChatUser?.displayName}</p>
                <p className="text-zinc-500 text-xs">@{activeChatUser?.username}</p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2" ref={scrollRef}>
              {messages.map(msg => (
                <div key={msg.id} className={cn("flex flex-col max-w-[80%]", msg.senderId === user.uid ? "ml-auto items-end" : "mr-auto items-start")}>
                  <div className={cn("p-3 rounded-2xl", msg.senderId === user.uid ? "bg-white text-black rounded-br-sm" : "bg-zinc-900 text-white rounded-bl-sm border border-zinc-800")}>
                    {msg.fileUrl && (
                      <div className="mb-2">
                        {msg.fileType?.startsWith('image/') ? (
                          <img src={msg.fileUrl} alt="attachment" className="rounded-lg max-w-full" />
                        ) : msg.fileType?.startsWith('video/') ? (
                          <video src={msg.fileUrl} controls className="rounded-lg max-w-full" />
                        ) : (
                          <a href={msg.fileUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-blue-400 underline">
                            <FileIcon className="w-4 h-4" /> {msg.fileName}
                          </a>
                        )}
                      </div>
                    )}
                    {msg.text && <p>{msg.text}</p>}
                  </div>
                  <span className="text-[10px] text-zinc-600 mt-1">
                    {msg.createdAt?.toDate ? format(msg.createdAt.toDate(), 'h:mm a') : 'Sending...'}
                  </span>
                </div>
              ))}
            </div>

            <form onSubmit={handleSendMessage} className="flex items-end gap-2 bg-zinc-900/50 p-2 rounded-2xl border border-zinc-800/50">
              <input type="file" id="file-upload" className="hidden" onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} />
              <label htmlFor="file-upload" className="p-3 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl cursor-pointer transition-all">
                <Paperclip className="w-5 h-5" />
              </label>
              <div className="flex-1 relative">
                {selectedFile && (
                  <div className="absolute bottom-full left-0 mb-2 p-2 bg-zinc-800 rounded-lg text-xs text-white flex items-center gap-2">
                    <span className="truncate max-w-[150px]">{selectedFile.name}</span>
                    <button type="button" onClick={() => setSelectedFile(null)}><X className="w-3 h-3" /></button>
                  </div>
                )}
                <input 
                  type="text" 
                  placeholder="Message..." 
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  className="w-full bg-transparent text-white p-3 outline-none"
                />
              </div>
              <button type="submit" disabled={(!inputText.trim() && !selectedFile) || uploading} className="p-3 bg-white text-black rounded-xl hover:bg-zinc-200 disabled:opacity-50 transition-all">
                {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowUp className="w-5 h-5" />}
              </button>
            </form>
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
                  <div key={friend.uid} onClick={() => handleStartChat(friend)} className="flex items-center gap-3 p-3 bg-zinc-900/50 rounded-xl border border-zinc-800/50 cursor-pointer hover:bg-zinc-800/50 transition-all">
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
