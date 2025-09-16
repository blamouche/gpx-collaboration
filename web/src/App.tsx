
import * as React from 'react';
import {
  BrowserRouter,
  Route,
  Routes,
  useNavigate,
  useParams
} from 'react-router-dom';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

function Home() {
  const navigate = useNavigate();
  const handleCreate = () => {
    // Génère un slug simple
    const slug = Math.random().toString(36).substring(2, 8);
    navigate(`/r/${slug}`);
  };
  const [joinSlug, setJoinSlug] = React.useState("");
  const handleJoin = () => {
    if (joinSlug) navigate(`/r/${joinSlug}`);
  };
  return (
    <div>
      <h1>Accueil GPX Collaboration</h1>
      <button onClick={handleCreate}>Créer une session</button>
      <div style={{ marginTop: 16 }}>
        <input
          type="text"
          placeholder="Entrer le code de session"
          value={joinSlug}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setJoinSlug(e.target.value)}
        />
        <button onClick={handleJoin}>Rejoindre</button>
      </div>
    </div>
  );
}

function Room() {
  const { roomId } = useParams();
  const [copied, setCopied] = React.useState(false);
  const url = window.location.href;
  const [participants, setParticipants] = React.useState(1);
  const [connected, setConnected] = React.useState(false);

  React.useEffect(() => {
    if (!roomId) return;
    const doc = new Y.Doc();
    const provider = new WebsocketProvider('ws://localhost:1234', roomId, doc);
    const awareness = provider.awareness;
    const updateCount = () => {
      setParticipants(Array.from(awareness.getStates().values()).length);
    };
    const updateStatus = (event: { status: string }) => {
      setConnected(event.status === 'connected');
    };
    provider.on('status', updateStatus);
    awareness.on('change', updateCount);
    updateCount();
    return () => {
      awareness.off('change', updateCount);
      provider.off('status', updateStatus);
      provider.destroy();
    };
  }, [roomId]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div>
      <h1>Session : {roomId}</h1>
      <div style={{ margin: '16px 0' }}>
        <button onClick={handleCopy}>
          Copier l’URL de la session
        </button>
        {copied && <span style={{ marginLeft: 8, color: 'green' }}>Copié !</span>}
      </div>
      <div>
        Connexion Yjs : {connected ? '✅' : '❌'}<br />
        Participants : <strong>{participants}</strong>
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/r/:roomId" element={<Room />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
