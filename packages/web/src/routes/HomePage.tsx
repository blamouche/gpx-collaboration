import { FormEvent, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { nanoid } from 'nanoid';
import toast from 'react-hot-toast';

const randomSuffix = () => nanoid(8);

const slugify = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

const buildRoomSlug = (name: string) => {
  const trimmed = name.trim();
  if (!trimmed) {
    return randomSuffix();
  }

  const slug = slugify(trimmed);
  return slug ? `${slug}-${randomSuffix()}` : randomSuffix();
};

const HomePage = () => {
  const navigate = useNavigate();
  const [sessionName, setSessionName] = useState('');
  const [passcode, setPasscode] = useState('');
  const [joinUrl, setJoinUrl] = useState('');

  const sessionPreview = useMemo(() => buildRoomSlug(sessionName || 'session'), [sessionName]);

  const goToRoom = (path: string) => {
    navigate(path);
  };

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    const slug = buildRoomSlug(sessionName);
    const search = passcode.trim() ? `?k=${encodeURIComponent(passcode.trim())}` : '';
    goToRoom(`/r/${slug}${search}`);
  };

  const handleJoin = (event: FormEvent) => {
    event.preventDefault();
    if (!joinUrl.trim()) {
      toast.error('Collez une URL de session valide.');
      return;
    }

    let target = joinUrl.trim();
    try {
      const parsed = new URL(target);
      target = `${parsed.pathname}${parsed.search}`;
    } catch (error) {
      if (!target.startsWith('/')) {
        if (target.startsWith('r/')) {
          target = `/${target}`;
        } else {
          toast.error("URL de session invalide.");
          return;
        }
      }
    }

    goToRoom(target);
  };

  return (
    <div className="home-container">
      <div className="home-card" role="main">
        <header className="home-header">
          <h1 className="home-title">GPX Collaboration</h1>
          <p className="home-subtitle">
            Sessions éphémères de co-édition GPX. Partagez l’URL pour collaborer, aucune donnée n’est
            stockée sur le serveur.
          </p>
        </header>

        <section className="home-form" aria-labelledby="create-session">
          <h2 id="create-session">Créer une session</h2>
          <form onSubmit={handleCreate} className="home-form">
            <label htmlFor="session-name">Nom de session (optionnel)</label>
            <input
              id="session-name"
              type="text"
              placeholder="Sortie vélo du samedi"
              value={sessionName}
              onChange={(event) => setSessionName(event.target.value)}
              autoComplete="off"
            />
            <label htmlFor="session-passcode">Code secret (optionnel)</label>
            <input
              id="session-passcode"
              type="text"
              placeholder="secret simple"
              value={passcode}
              onChange={(event) => setPasscode(event.target.value)}
              autoComplete="off"
            />
            <div className="form-row">
              <button type="submit">Créer la session</button>
              <div className="session-banner" aria-live="polite">
                URL prévisionnelle&nbsp;: <strong>/r/{sessionPreview}</strong>
              </div>
            </div>
          </form>
        </section>

        <section className="home-form" aria-labelledby="join-session">
          <h2 id="join-session">Rejoindre une session</h2>
          <form onSubmit={handleJoin} className="home-form">
            <label htmlFor="join-url">URL de session partagée</label>
            <input
              id="join-url"
              type="url"
              placeholder="https://example.com/r/ma-session"
              value={joinUrl}
              onChange={(event) => setJoinUrl(event.target.value)}
              autoComplete="off"
            />
            <div className="form-row">
              <button type="submit" className="secondary-button">
                Rejoindre
              </button>
            </div>
          </form>
        </section>

        <footer>
          <p className="home-subtitle">
            Astuce&nbsp;: invitez vos coéquipiers en leur partageant directement l’URL de session. Le
            serveur supprime automatiquement les documents inactifs.
          </p>
        </footer>
      </div>
    </div>
  );
};

export default HomePage;
