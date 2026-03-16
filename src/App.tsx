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
  where
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
  Search
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

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
    if (!user || !profile) return;

    const q = query(
      collection(db, 'messages'),
      orderBy('createdAt', 'desc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Message[];
      setMessages(msgs.reverse());
    });

    return () => unsubscribe();
  }, [user, profile]);

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

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!user || !profile || (!inputText.trim() && !selectedFile)) return;

    const text = inputText.trim();
    const file = selectedFile;
    
    setInputText('');
    setSelectedFile(null);

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

      await addDoc(collection(db, 'messages'), {
        senderId: user.uid,
        senderUsername: profile.username,
        text: text || null,
        ...fileData,
        createdAt: serverTimestamp()
      });
    } catch (error) {
      console.error('Failed to send message', error);
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
      <div className="flex items-center justify-center min-h-screen bg-white text-black">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#F8F9FA] p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md p-8 bg-white/70 backdrop-blur-xl rounded-3xl border border-white/20 shadow-2xl text-center"
        >
          <h1 className="text-4xl font-light tracking-tight mb-2 text-black">Lumina</h1>
          <p className="text-gray-500 mb-8 font-light">Minimalist sharing for the modern web.</p>
          <button 
            onClick={handleLogin}
            className="w-full py-4 bg-black text-white rounded-2xl font-medium hover:bg-gray-800 transition-all flex items-center justify-center gap-3 shadow-lg"
          >
            <UserIcon className="w-5 h-5" />
            Continue with Google
          </button>
          
          <button 
            onClick={handleAnonymousLogin}
            className="w-full py-4 bg-white text-black border border-gray-200 rounded-2xl font-medium hover:bg-gray-50 transition-all flex items-center justify-center gap-3 mt-3"
          >
            <UserIcon className="w-5 h-5 opacity-50" />
            Continue Anonymously
          </button>
          {loginError && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-6 p-4 bg-red-50 rounded-2xl border border-red-100"
            >
              <p className="text-red-600 text-sm font-medium">{loginError}</p>
              <p className="text-red-500 text-xs mt-1">
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
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#F8F9FA] p-6">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md p-8 bg-white/70 backdrop-blur-xl rounded-3xl border border-white/20 shadow-2xl"
        >
          <h2 className="text-2xl font-light mb-6 text-black">Choose your username</h2>
          <form onSubmit={handleSetUsername} className="space-y-4">
            <div>
              <input 
                type="text"
                placeholder="username"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                className="w-full p-4 bg-gray-100/50 border-none rounded-2xl focus:ring-2 focus:ring-black outline-none transition-all"
                disabled={checkingUsername}
              />
              {usernameError && <p className="text-red-500 text-sm mt-2 ml-2">{usernameError}</p>}
            </div>
            <button 
              type="submit"
              disabled={checkingUsername}
              className="w-full py-4 bg-black text-white rounded-2xl font-medium hover:bg-gray-800 disabled:bg-gray-400 transition-all flex items-center justify-center gap-2"
            >
              {checkingUsername ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Start Chatting'}
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[#F8F9FA] text-black font-sans">
      {/* Header */}
      <header className="h-16 px-4 sm:px-6 flex items-center justify-between bg-white/50 backdrop-blur-md border-b border-gray-200/50 sticky top-0 z-10">
        <div className="flex items-center gap-3 min-w-[120px]">
          <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center flex-shrink-0">
            <span className="text-white font-bold text-xs">L</span>
          </div>
          <h1 className="text-xl font-light tracking-tight hidden sm:block">Lumina</h1>
        </div>

        {/* Search Bar */}
        <div className="flex-1 max-w-md mx-4 relative">
          <div className="relative flex items-center">
            <Search className="absolute left-3 w-4 h-4 text-gray-400" />
            <input 
              type="text"
              placeholder="Search people or messages..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full py-2 pl-10 pr-4 bg-gray-100/50 border-none rounded-full text-sm focus:ring-1 focus:ring-black/10 outline-none transition-all"
            />
          </div>
        </div>

        <div className="flex items-center gap-4 min-w-[120px] justify-end">
          <span className="text-sm text-gray-500 hidden md:inline">@{profile?.username}</span>
          <button 
            onClick={handleLogout}
            className="p-2 hover:bg-gray-200/50 rounded-full transition-all text-gray-600"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Chat Area */}
      <main 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth"
      >
        <div className="max-w-3xl mx-auto space-y-6 py-4">
          {filteredMessages.map((msg) => (
            <motion.div 
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                "flex flex-col max-w-[85%] sm:max-w-[70%]",
                msg.senderId === user.uid ? "ml-auto items-end" : "mr-auto items-start"
              )}
            >
              <div className="flex items-center gap-2 mb-1 px-1">
                <span className="text-[10px] font-medium text-gray-400 uppercase tracking-widest">
                  {msg.senderUsername}
                </span>
                <span className="text-[10px] text-gray-300">
                  {msg.createdAt?.toDate ? format(msg.createdAt.toDate(), 'HH:mm') : ''}
                </span>
              </div>
              
              <div className={cn(
                "p-4 rounded-3xl shadow-sm",
                msg.senderId === user.uid 
                  ? "bg-black text-white rounded-tr-none" 
                  : "bg-white text-black border border-gray-100 rounded-tl-none"
              )}>
                {msg.text && <p className="text-sm leading-relaxed">{msg.text}</p>}
                
                {msg.fileUrl && (
                  <div className={cn("mt-2", msg.text ? "pt-2 border-t border-white/10" : "")}>
                    {msg.fileType?.startsWith('image/') ? (
                      <img 
                        src={msg.fileUrl} 
                        alt={msg.fileName} 
                        className="max-w-full rounded-xl cursor-pointer hover:opacity-90 transition-opacity"
                        referrerPolicy="no-referrer"
                        onClick={() => window.open(msg.fileUrl, '_blank')}
                      />
                    ) : msg.fileType?.startsWith('video/') ? (
                      <video 
                        src={msg.fileUrl} 
                        controls 
                        className="max-w-full rounded-xl"
                      />
                    ) : (
                      <a 
                        href={msg.fileUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 p-3 bg-white/10 rounded-xl hover:bg-white/20 transition-all"
                      >
                        <FileIcon className="w-5 h-5" />
                        <div className="flex flex-col overflow-hidden">
                          <span className="text-xs font-medium truncate">{msg.fileName}</span>
                          <span className="text-[10px] opacity-60 uppercase">{msg.fileType?.split('/')[1]}</span>
                        </div>
                      </a>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          ))}
          {filteredMessages.length === 0 && searchQuery && (
            <div className="text-center py-20">
              <p className="text-gray-400 font-light">No results found for "{searchQuery}"</p>
            </div>
          )}
        </div>
      </main>

      {/* Input Area */}
      <footer className="p-4 bg-white/50 backdrop-blur-md border-t border-gray-200/50">
        <div className="max-w-3xl mx-auto">
          <AnimatePresence>
            {selectedFile && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="mb-3 p-3 bg-black/5 rounded-2xl flex items-center justify-between overflow-hidden"
              >
                <div className="flex items-center gap-3">
                  {selectedFile.type.startsWith('image/') ? <ImageIcon className="w-5 h-5" /> : <FileIcon className="w-5 h-5" />}
                  <span className="text-sm truncate max-w-[200px]">{selectedFile.name}</span>
                </div>
                <button 
                  onClick={() => setSelectedFile(null)}
                  className="p-1 hover:bg-black/10 rounded-full transition-all"
                >
                  <X className="w-4 h-4" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <form 
            onSubmit={handleSendMessage}
            className="flex items-center gap-2 bg-white rounded-full p-2 shadow-sm border border-gray-100"
          >
            <label className="p-3 hover:bg-gray-100 rounded-full cursor-pointer transition-all text-gray-500">
              <Paperclip className="w-5 h-5" />
              <input 
                type="file" 
                className="hidden" 
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              />
            </label>
            
            <input 
              type="text" 
              placeholder="Type a message..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              className="flex-1 bg-transparent border-none outline-none px-4 text-sm"
              disabled={uploading}
            />
            
            <button 
              type="submit"
              disabled={(!inputText.trim() && !selectedFile) || uploading}
              className="p-3 bg-black text-white rounded-full hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400 transition-all shadow-md"
            >
              {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowUp className="w-5 h-5" />}
            </button>
          </form>
        </div>
      </footer>
    </div>
  );
}
