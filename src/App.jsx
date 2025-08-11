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

/** Language options */
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
// Room numbers 100 - 200 for dropdown registration
const ROOM_NUMBERS = Array.from({ length: 101 }, (_, i) => String(100 + i));

const uuid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `room-${Math.random().toString(36).slice(2)}-${Date.now()}`;

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
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>
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

export default function App() {
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [user, setUser] = useState(null);
  const [userDoc, setUserDoc] = useState(null);
  const [role, setRole] = useState(null);
  const [staffProfile, setStaffProfile] = useState(null); // 'guest' | 'staff'
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  const appId = useMemo(() => (typeof __app_id !== "undefined" ? __app_id : "default-app-id"), []);

  // Firebase init & auth
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
          setReady(true);
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

  // Subscribe to staff profile when signed in (used for staff language & name)
  useEffect(() => {
    if (!db || !user) return;
    const ref = doc(db, `artifacts/${appId}/staff/${user.uid}`);
    const unsub = onSnapshot(ref, (snap) => setStaffProfile(snap.data() || null));
    return () => unsub();
  }, [db, user, appId]);

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

  const handleGuestCheckOut = async (roomId) => {
    if (!db || !user || !roomId) return;
    setLoading(true);
    try {
      const msgsQ = query(collection(db, `artifacts/${appId}/public/data/messages`), where("roomId", "==", roomId));
      const snap = await getDocs(msgsQ);
      const docs = snap.docs;
      const chunk = 400;
      for (let i = 0; i < docs.length; i += chunk) {
        const batch = writeBatch(db);
        for (const d of docs.slice(i, i + chunk)) {
          batch.set(doc(db, `artifacts/${appId}/public/data/archived_messages/${d.id}`), {
            ...d.data(),
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
    } catch (e) {
      console.error(e);
      setError("Checkout failed.");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => setRole(null);

  if (!ready || loading) return <PageShell><Loader/></PageShell>;
  if (error) return <PageShell><ErrorPanel message={error} onHome={reset} /></PageShell>;

  return (
    <PageShell>
      <Header showHome={!!role} onHome={reset} />

      {!role && <RoleSelect onChoose={setRole} />}

      {role === "guest" && (!userDoc?.name ? (
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
      ))}

      {role === "staff" && (
        !staffProfile?.name ? (
          <StaffRegistration onSubmit={async ({ name, languageKey }) => {
            if (!db || !user) return;
            const lang = LANGUAGES[languageKey] || HOTEL_LANGUAGE;
            await setDoc(
              doc(db, `artifacts/${appId}/staff/${user.uid}`),
              {
                name,
                language: { label: lang.label, code: lang.code },
                followedRooms: [],
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              },
              { merge: true }
            );
          }} />
        ) : (
          <StaffDashboard
            db={db}
            appId={appId}
            staff={{ id: user?.uid, name: staffProfile.name, language: staffProfile.language }}
          />
        )
      )}
    </PageShell>
  );
}

const RoleSelect = ({ onChoose }) => (
  <div className="flex-1 p-8 flex flex-col items-center justify-center gap-4">
    <h2 className="text-xl font-semibold text-gray-800">Who are you?</h2>
    <button onClick={() => onChoose("guest")} className="w-full max-w-xs bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700">I am a Guest</button>
    <button onClick={() => onChoose("staff")} className="w-full max-w-xs bg-indigo-600 text-white py-3 rounded-lg font-semibold hover:bg-indigo-700">I am Hotel Staff</button>
  </div>
);

const Registration = ({ onSubmit }) => {
  const [name, setName] = useState("");
  const [lang, setLang] = useState("English");
  const [room, setRoom] = useState("");
  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), languageKey: lang, roomNumber: room });
  };
  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold text-gray-800 mb-4">Guest Registration</h2>
      <form onSubmit={submit} className="space-y-4">
        <input className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-600" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
        <select className="w-full border border-gray-300 rounded-lg px-4 py-2 bg-white focus:ring-2 focus:ring-blue-600" value={lang} onChange={(e) => setLang(e.target.value)}>
          {Object.keys(LANGUAGES).map((k) => (<option key={k} value={k}>{LANGUAGES[k].label}</option>))}
        </select>
        <select className="w-full border border-gray-300 rounded-lg px-4 py-2 bg-white focus:ring-2 focus:ring-blue-600" value={room} onChange={(e) => setRoom(e.target.value)}>
          <option value="">Choose room (optional)</option>
          {ROOM_NUMBERS.map((n) => (<option key={n} value={n}>{n}</option>))}
        </select>
        <p className="text-xs text-gray-500">Tip: Selecting a room checks you in immediately and opens chat (no QR needed).</p>
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

// Staff registration (name + preferred language)
const StaffRegistration = ({ onSubmit }) => {
  const [name, setName] = useState("");
  const [lang, setLang] = useState("English");
  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), languageKey: lang });
  };
  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold text-gray-800 mb-4">Staff Registration</h2>
      <form onSubmit={submit} className="space-y-4">
        <input className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-600" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
        <select className="w-full border border-gray-300 rounded-lg px-4 py-2 bg-white focus:ring-2 focus:ring-blue-600" value={lang} onChange={(e) => setLang(e.target.value)}>
          {Object.keys(LANGUAGES).map((k) => (<option key={k} value={k}>{LANGUAGES[k].label}</option>))}
        </select>
        <button type="submit" className="w-full bg-indigo-600 text-white rounded-lg py-2 hover:bg-indigo-700">Save & Continue</button>
      </form>
    </div>
  );
};

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
      </div>

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
    </div>
  );
}

function Chat({ db, appId, role, roomId, currentUser, guestLanguage, onGuestCheckout, onBack }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);

  const currentLanguage = currentUser.language || HOTEL_LANGUAGE;
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
      // Touch room so staff lists sort by activity
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
        <div />
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
