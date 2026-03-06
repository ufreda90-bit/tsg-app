import { Link } from 'react-router-dom';

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="glass-card rounded-3xl border border-white/70 shadow-xl p-8 max-w-sm w-full text-center space-y-4">
        <h1 className="text-xl font-bold text-slate-800">Non autorizzato</h1>
        <p className="text-sm text-slate-500">Non hai i permessi per accedere a questa pagina.</p>
        <Link to="/" className="btn-primary inline-flex items-center justify-center px-4 py-2 rounded-xl">Torna alla home</Link>
      </div>
    </div>
  );
}
