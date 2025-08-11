import React, { useEffect, useMemo, useRef, useState } from "react";
import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signInAnonymously } from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";

/** Languages */
const LANGUAGES = {
  English: { label: "English", code: "en-US" },
  Spanish: { label: "Spanish", code: "es-ES" },
  French: { label: "French", code: "fr-FR" },
  German: { label: "German", code: "de-DE" },
  Japanese: { label: "Japanese", code: "ja-JP" },
  Hindi: { label: "Hindi", code: "hi-IN" },
  "Mandarin Chinese": { label: "Mandarin Chinese", code: "zh-CN" },
};
const HOTEL_LANGUAGE = { label: "English", code: "en-US" };

const uuid = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `room-${Math.random().toString(36).slice(2)}-${Date.now()}`;

const Toast = ({ message, onClose }) => (
  <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-sm px-4 py-2 rounded-full shadow-lg z-50">
    <div className="flex items-center gap-3">
      <span>{message}</span>
      <button className="opacity-70 hover:opacity-100" onClick={onClose}>✕</button>
    </div>
  </div>
);

export default function App() {
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [user, setUser] = useState(null);
  const [userDoc, setUserDoc] = useState(null);
  const [role, setRole] = useState(null); // 'guest' | 'staff'
  const [isReady, setIsReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const appId = useMemo(() => (typeof __app_id !== "undefined" ? __app_id : "default-app-id"), []);

  // Firebase init + auth
  useEffect(() => {
    try {
      const firebaseConfig = JSON.parse(typeof __firebase_config !== "undefined" ? __firebase_config : "{}");
      if (!firebaseConfig || !firebaseConfig.apiKey) {
        setError("Missing Firebase configuration.");
        setLoading(false);
        return;
      }
      const app = initializeApp(firebaseConfig);
      const _db = getFirestore(app);
      const _auth = getAuth(app);
      setDb(_db);
      setAuth(_auth);

      const unsub = onAuthStateChanged(_auth, async (current) => {
        try {
          if (current) {
            setUser(current);
            const ref = doc(_db, `artifacts/${appId}/users/${current.uid}`);
            const snap = await getDoc(ref);
            if (snap.exists()) setUserDoc(snap.data());
          } else {
            await signInAnonymously(_auth);
          }
        } catch (e) {
          console.error(e);
          setError("Authentication failed.");
        } finally {
          setIsReady(true);
          setLoading(false);
        }
      });
      return () => unsub();
    } catch (e) {
      console.error(e);
      setError("App initialization failed.");
      setLoading(false);
    }
  }, [appId]);

  /** Registration now accepts roomNumber; if provided, guest is checked in immediately */
  const handleRegister = async ({ name, languageKey, roomNumber }) => {
    if (!db || !user) return;
    setLoading(true);
    try {
      const lang = LANGUAGES[languageKey] || HOTEL_LANGUAGE;
      const checkInNow = !!roomNumber && String(roomNumber).trim().length > 0;
      const profile = {
        name,
        language: { label: lang.label, code: lang.code },
        role: "guest",
        roomId: checkInNow ? String(roomNumber).trim() : null,
        isCheckedIn: checkInNow,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      await setDoc(doc(db, `artifacts/${appId}/users/${user.uid}`), profile);

      if (checkInNow) {
        const rid = String(roomNumber).trim();
        await setDoc(
          doc(db, `artifacts/${appId}/public/data/rooms/${rid}`),
          {
            guestName: name,
            guestLanguage: { label: lang.label, code: lang.code },
            status: "occupied",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      setUserDoc(profile);
    } catch (e) {
      console.error(e);
      setError("Registration failed.");
    } finally {
      setLoading(false);
    }
  };

  /** Keep “simulate scan” option for demos (generates a random room) */
  const handleGuestCheckIn = async () => {
    if (!db || !user || !userDoc) return;
    setLoading(true);
    try {
      const roomId = uuid();
      await setDoc(doc(db, `artifacts/${appId}/public/data/rooms/${roomId}`), {
        guestName: userDoc.name,
        guestLanguage: userDoc.language,
        status: "occupied",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await setDoc(doc(db, `artifacts/${appId}/users/${user.uid}`), { roomId, isCheckedIn: true, updatedAt: serverTimestamp() }, { merge: true });
      setUserDoc((p) => ({ ...p, roomId, isCheckedIn: true }));
    } catch (e) {
      console.error(e);
      setError("Check-in failed.");
    } finally {
      setLoading(false);
    }
  };

  /** Archive on checkout (unchanged) */
  const handleGuestCheckOut = async (roomId) => {
    if (!db || !user || !roomId) return;
    setLoading(true);
    try {
      const msgsQ = query(collection(db, `artifacts/${appId}/public/data/messages`), where("roomId", "==", roomId));
      const snap = await getDocs(msgsQ);
      const docs = snap.docs;
      const chunkSize = 400;
      for (let i = 0; i < docs.length; i += chunkSize) {
        const batch = writeBatch(db);
        const slice = docs.slice(i, i + chunkSize);
        for (const d of slice) {
          const data = d.data();
          batch.set(doc(db, `artifacts/${appId}/public/data/archived_messages/${d.id}`), {
            ...data,
            archivedAt: serverTimestamp(),
            originalMessageId: d.id,
          });
          batch.delete(d.ref);
        }
        await batch.commit();
      }
      await setDoc(doc(db, `artifacts/${appId}/public/data/rooms/${roomId}`), { status: "checked_out", updatedAt: serverTimestamp() }, { merge: true });
      await setDoc(doc(db, `artifacts/${appId}/users/${user.uid}`), { roomId: null, isCheckedIn: false, updatedAt: serverTimestamp() }, { merge: true });
      setUserDoc((p) => ({ ...p, roomId: null, isCheckedIn: false }));
      setToast("Checkout complete. Chat history archived.");
    } catch (e) {
      console.error(e);
      setError("Checkout failed.");
    } finally {
      setLoading(false);
    }
  };

  const resetToRoleSelect = () => setRole(null);

  if (!isReady || loading) return <PageShell><Loader /></PageShell>;
  if (error) return <PageShell><ErrorPanel message={error} onHome={resetToRoleSelect} /></PageShell>;

  return (
    <PageShell>
      <Header showHome={!!role} onHome={resetToRoleSelect} />

      {!role && <RoleSelect onChoose={(r) => setRole(r)} />}

      {role === "guest" && (
        !userDoc?.name ? (
          <Registration onSubmit={handleRegister} />
        ) : !userDoc?.isCheckedIn ? (
          <QRCodeScreen userName={userDoc.name} onSimulateScan={handleGuestCheckIn} />
        ) : (
          <Chat
            db={db}
            appId={appId}
            role="guest"
            roomId={userDoc.roomId}
            currentUser={{ id: user.uid, name: userDoc.name, language: userDoc.language }}
            onGuestCheckout={() => handleGuestCheckOut(userDoc.roomId)}
          />
        )
      )}

      {role === "staff" && (
        <StaffDashboard
          db={db}
          appId={appId}
          staff={{ id: user?.uid, name: "Staff", language: HOTEL_LANGUAGE }}
        />
      )}

      {!!toast && <Toast message={toast} onClose={() => setToast("")} />}
    </PageShell>
  );
}

/* Shell UI */
const PageShell = ({ children }) => (
  <div className="bg-gray-100 min-h-screen w-full flex items-center justify-center p-4">
    <div className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden flex flex-col" style={{ height: "90vh" }}>
      {children}
    </div>
  </div>
);

const Header = ({ showHome, onHome }) => (
  <div className="bg-blue-600 text-white p-4 text-center relative">
    {showHome && (
      <button onClick={onHome} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/90 hover:text-white" aria-label="Home">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
      </button>
    )}
    <h1 className="text-2xl font-bold">HotelConnect</h1>
    <p className="text-xs opacity-90">Multilingual Guest Messaging</p>
  </div>
);

const Loader = () => (
  <div className="flex flex-1 items-center justify-center p-12">
    <div className="w-16 h-16 border-4 border-blue-600 border-dashed rounded-full animate-spin" />
  </div>
);

const ErrorPanel = ({ message, onHome }) => (
  <div className="flex-1 p-6 flex flex-col items-center justify-center gap-4 text-center">
    <p className="text-red-600 font-semibold">{message}</p>
    <button onClick={onHome} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Back</button>
  </div>
);

const RoleSelect = ({ onChoose }) => (
  <div className="flex-1 p-8 flex flex-col items-center justify-center gap-4">
    <h2 className="text-xl font-semibold text-gray-800">Who are you?</h2>
    <button onClick={() => onChoose("guest")} className="w-full max-w-xs bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700">I am a Guest</button>
    <button onClick={() => onChoose("staff")} className="w-full max-w-xs bg-indigo-600 text-white py-3 rounded-lg font-semibold hover:bg-indigo-700">I am Hotel Staff</button>
  </div>
);

/** Registration: name + language + ROOM NUMBER (optional to auto check-in) */
const Registration = ({ onSubmit }) => {
  const [name, setName] = useState("");
  const [lang, setLang] = useState("English");
  const [room, setRoom] = useState("");
  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), languageKey: lang, roomNumber: room.trim() });
  };
  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold text-gray-800 mb-4">Register</h2>
      <form onSubmit={submit} className="space-y-4">
        <input className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-600" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
        <select className="w-full border border-gray-300 rounded-lg px-4 py-2 bg-white focus:ring-2 focus:ring-blue-600" value={lang} onChange={(e) => setLang(e.target.value)}>
          {Object.keys(LANGUAGES).map((k) => (<option key={k} value={k}>{LANGUAGES[k].label}</option>))}
        </select>
        <input className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-600" placeholder="Room number (optional)" value={room} onChange={(e) => setRoom(e.target.value)} />
        <p className="text-xs text-gray-500">Tip: Fill the room number to skip the QR step and start chatting immediately.</p>
        <button type="submit" className="w-full bg-blue-600 text-white rounded-lg py-2 hover:bg-blue-700">Continue</button>
      </form>
    </div>
  );
};

const QRCodeScreen = ({ userName, onSimulateScan }) => (
  <div className="flex-1 p-6 flex flex-col items-center justify-center text-center gap-4">
    <h2 className="text-xl font-semibold text-gray-800">Welcome, {userName}!</h2>
    <p className="text-gray-600">Scan the QR code in your room to begin your chat.</p>
    <div className="w-40 h-40 bg-gray-200 rounded-lg grid place-items-center">
      <svg xmlns="http://www.w3.org/2000/svg" className="w-16 h-16 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
    </div>
    <button onClick={onSimulateScan} className="px-6 py-3 rounded-full bg-green-600 text-white hover:bg-green-700">Simulate Scan & Check In</button>
  </div>
);

/* Staff dashboard */
function StaffDashboard({ db, appId, staff }) {
  const [rooms, setRooms] = useState([]);
  const [selected, setSelected] = useState(null);
  const [staffProfile, setStaffProfile] = useState(null);
  const [view, setView] = useState("my"); // 'my' | 'all' | 'feed'

  // Ensure staff profile exists & subscribe
  useEffect(() => {
    if (!db || !staff?.id) return;
    const ref = doc(db, `artifacts/${appId}/staff/${staff.id}`);
    const unsub = onSnapshot(ref, async (snap) => {
      if (!snap.exists()) {
        await setDoc(ref, { followedRooms: [], updatedAt: serverTimestamp() });
        setStaffProfile({ followedRooms: [] });
      } else {
        setStaffProfile(snap.data());
      }
    });
    return () => unsub();
  }, [db, appId, staff?.id]);

  // Rooms list
  useEffect(() => {
    if (!db) return;
    const qRooms = query(collection(db, `artifacts/${appId}/public/data/rooms`), orderBy("updatedAt", "desc"));
    const unsub = onSnapshot(qRooms, (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setRooms(rows);
    });
    return () => unsub();
  }, [db, appId]);

  const followed = new Set(staffProfile?.followedRooms || []);
  const myRooms = rooms.filter((r) => followed.has(r.id));

  const toggleFollow = async (roomId) => {
    if (!db || !staff?.id) return;
    const ref = doc(db, `artifacts/${appId}/staff/${staff.id}`);
    const current = new Set(staffProfile?.followedRooms || []);
    if (current.has(roomId)) current.delete(roomId); else current.add(roomId);
    await setDoc(ref, { followedRooms: Array.from(current), updatedAt: serverTimestamp() }, { merge: true });
  };

  if (selected) {
    return (
      <Chat
        db={db}
        appId={appId}
        role="staff"
        roomId={selected.id}
        currentUser={staff}
        guestLanguage={selected.guestLanguage}
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      <div className="p-3 border-b flex items-center gap-2 bg-white">
        <button className={`px-3 py-1 rounded ${view === 'my' ? 'bg-indigo-600 text-white' : 'bg-gray-100'}`} onClick={() => setView('my')}>My Rooms</button>
        <button className={`px-3 py-1 rounded ${view === 'all' ? 'bg-indigo-600 text-white' : 'bg-gray-100'}`} onClick={() => setView('all')}>All Rooms</button>
        <button className={`px-3 py-1 rounded ${view === 'feed' ? 'bg-indigo-600 text-white' : 'bg-gray-100'}`} onClick={() => setView('feed')}>Master Feed</button>
      </div>

      {view !== 'feed' && (
        <div className="p-4 flex-1 overflow-y-auto">
          <h2 className="text-lg font-semibold mb-3">{view === 'my' ? 'Rooms I Follow' : 'All Rooms'}</h2>
          {(view === 'my' ? myRooms : rooms).length === 0 && (
            <p className="text-gray-500">{view === 'my' ? 'You are not following any rooms yet.' : 'No rooms yet.'}</p>
          )}
          <div className="space-y-2">
            {(view === 'my' ? myRooms : rooms).map((r) => (
              <div key={r.id} className={`w-full p-3 rounded-lg border flex items-center justify-between ${r.status === 'occupied' ? 'border-blue-200' : 'border-gray-200'}`}>
                <div onClick={() => setSelected(r)} className="cursor-pointer">
                  <p className="font-medium text-gray-800">Room: {r.id}</p>
                  <p className="text-xs text-gray-600">Guest: {r.guestName} • Preferred: {r.guestLanguage?.label || r.guestLanguage?.code}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-1 rounded-full ${r.status === 'occupied' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{r.status === 'occupied' ? 'In House' : 'Checked Out'}</span>
                  <button onClick={() => toggleFollow(r.id)} className={`text-xs px-2 py-1 rounded border ${followed.has(r.id) ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'bg-white border-gray-300 text-gray-700'}`}>{followed.has(r.id) ? 'Unfollow' : 'Follow'}</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {view === 'feed' && (
        <MasterFeed db={db} appId={appId} title="Master Feed" roomIds={Array.from(followed)} showAllOption allRooms={rooms} onOpenRoom={(room) => setSelected(room)} />
      )}
    </div>
  );
}

/* Master Feed: avoid Firestore composite index by sorting locally */
function MasterFeed({ db, appId, title, roomIds, showAllOption = false, allRooms = [], onOpenRoom }) {
  const [useAll, setUseAll] = useState(false);
  const [items, setItems] = useState([]);

  useEffect(() => {
    if (!db) return;
    const targetRooms = (useAll ? allRooms.map((r) => r.id) : roomIds) || [];
    const unsubs = [];
    const results = new Map();

    const attach = (rid) => {
      const qMsgs = query(
        collection(db, `artifacts/${appId}/public/data/messages`),
        where('roomId', '==', rid)
      );
      const unsub = onSnapshot(qMsgs, (snap) => {
        const rowsAll = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        rowsAll.sort((a,b) => (b.timestamp?.toMillis?.()||0) - (a.timestamp?.toMillis?.()||0));
        const rows = rowsAll.slice(0, 20);
        results.set(rid, rows);
        const merged = Array.from(results.entries()).flatMap(([roomId, msgs]) =>
          msgs.map((m) => ({ roomId, room: allRooms.find((r) => r.id === roomId), message: m }))
        );
        merged.sort((a, b) => (b.message.timestamp?.toMillis?.() || 0) - (a.message.timestamp?.toMillis?.() || 0));
        setItems(merged.slice(0, 100));
      }, (err) => console.error('Feed subscription error:', err));
      unsubs.push(unsub);
    };

    targetRooms.forEach(attach);
    return () => unsubs.forEach((u) => u());
  }, [db, appId, roomIds ? roomIds.join('|') : '', useAll, allRooms.map(r=>r.id).join('|')]);

  return (
    <div className="flex-1 flex flex-col">
      <div className="p-3 border-b bg-white flex items-center justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        {showAllOption && (
          <label className="text-sm flex items-center gap-2">
            <input type="checkbox" checked={useAll} onChange={(e) => setUseAll(e.target.checked)} />
            Show all rooms
          </label>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-gray-50">
        {items.length === 0 && <p className="text-gray-500">No messages yet.</p>}
        {items.map(({ roomId, room, message }) => (
          <div key={message.id} className="p-3 bg-white rounded-lg border flex items-start justify-between gap-3">
            <div className="text-sm">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">Room {roomId}</span>
                <span className="text-[10px] text-gray-500">{message.timestamp?.toDate ? message.timestamp.toDate().toLocaleString() : '…'}</span>
              </div>
              <div className="text-xs text-gray-600 mb-1">{message.senderName} • {message.senderRole}</div>
              <div className="text-gray-800 whitespace-pre-wrap break-words">{message.text}</div>
            </div>
            <button className="text-xs px-2 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 self-start" onClick={() => onOpenRoom(room || { id: roomId, guestLanguage: { code: 'en-US', label: 'English' } })}>Open</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* Chat */
function Chat({ db, appId, role, roomId, currentUser, guestLanguage, onGuestCheckout, onBack }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);

  const currentLanguage = role === "guest" ? currentUser.language : HOTEL_LANGUAGE;
  const otherLanguage = role === "guest" ? HOTEL_LANGUAGE : (guestLanguage || { code: "en-US", label: "English" });

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  useEffect(() => {
    if (!db || !roomId) return;
    // No orderBy: we sort locally to avoid Firestore composite index requirement
    const qMsgs = query(collection(db, `artifacts/${appId}/public/data/messages`), where("roomId", "==", roomId));
    const unsub = onSnapshot(qMsgs, (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      rows.sort((a,b) => (a.timestamp?.toMillis?.()||0) - (b.timestamp?.toMillis?.()||0));
      const processed = rows.map((m) => {
        const showTranslated = m.language?.code !== currentLanguage.code && m.translations?.[currentLanguage.code];
        return showTranslated ? { ...m, text: m.translations[currentLanguage.code] } : m;
      });
      setMessages(processed);
    }, (err) => console.error('Message subscription error:', err));
    return () => unsub();
  }, [db, appId, roomId, currentLanguage.code]);

  const send = async (e) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setText("");

    const payload = {
      roomId,
      text: body,
      language: currentLanguage,
      senderId: currentUser.id,
      senderName: currentUser.name,
      senderRole: role,
      timestamp: serverTimestamp(),
      translations: {},
      translationMeta: {},
    };

    try {
      if (currentLanguage.code !== otherLanguage.code) {
        const res = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: body, sourceLang: currentLanguage.code, targetLang: otherLanguage.code }),
        });
        if (res.ok) {
          const { translated, provider, confidence, detectedLang } = await res.json();
          payload.translations[otherLanguage.code] = translated;
          payload.translationMeta[otherLanguage.code] = { provider, confidence, detectedLang };
        } else {
          payload.translations[otherLanguage.code] = `(Translation unavailable) ${body}`;
        }
      }
    } catch {
      payload.translations[otherLanguage.code] = `(Translation unavailable) ${body}`;
    }

    try {
      await addDoc(collection(db, `artifacts/${appId}/public/data/messages`), payload);
      // Touch room so staff lists sort by activity and master feed stays fresh
      await setDoc(
        doc(db, `artifacts/${appId}/public/data/rooms/${roomId}`),
        { updatedAt: serverTimestamp(), lastMessageAt: serverTimestamp(), lastMessagePreview: body.slice(0,120) },
        { merge: true }
      );
    } catch (e) {
      console.error(e);
      alert("Failed to send message.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col">
      <div className="p-3 border-b border-gray-200 flex items-center justify-between">
        <div>
          <p className="font-semibold text-gray-800">Room: {roomId}</p>
          {role === "staff" && (
            <p className="text-xs text-gray-500">Guest prefers: {otherLanguage.label} ({otherLanguage.code})</p>
          )}
        </div>
        {role === "guest" ? (
          <button onClick={onGuestCheckout} className="text-sm bg-red-600 text-white px-3 py-1 rounded-lg hover:bg-red-700">Check Out</button>
        ) : (
          <button onClick={onBack} className="text-sm bg-gray-600 text-white px-3 py-1 rounded-lg hover:bg-gray-700">Back</button>
        )}
      </div>

      <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-gray-50">
        {messages.map((m) => (<Bubble key={m.id} mine={m.senderId === currentUser.id} message={m} />))}
        <div ref={endRef} />
      </div>

      <form onSubmit={send} className="p-3 border-t bg-white flex items-center gap-2">
        <input className="flex-1 border border-gray-300 rounded-full px-4 py-2 focus:ring-2 focus:ring-blue-600" placeholder="Type a message…" value={text} onChange={(e) => setText(e.target.value)} disabled={sending} />
        <button type="submit" className="p-3 rounded-full bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300" disabled={sending || !text.trim()} aria-label="Send">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
        </button>
      </form>
    </div>
  );
}

function Bubble({ mine, message }) {
  const timeLabel = message?.timestamp?.toDate ? message.timestamp.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "…";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-xs md:max-w-md p-3 rounded-2xl shadow text-sm ${mine ? "bg-blue-600 text-white rounded-br-none" : "bg-gray-200 text-gray-800 rounded-bl-none"}`}>
        {!mine && (<p className="text-[10px] font-semibold opacity-75 mb-1">{message.senderName || (message.senderRole === "staff" ? "Staff" : "Guest")}</p>)}
        <p className="whitespace-pre-wrap break-words">{message.text}</p>
        <div className="text-[10px] opacity-70 text-right mt-1">{timeLabel}</div>
      </div>
    </div>
  );
}
