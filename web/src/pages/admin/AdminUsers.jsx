import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import { IconSearch, IconChevronLeft, IconChevronRight } from '../../components/Icons';
import Spinner from '../../components/Spinner';

const PAGE_SIZE = 20;

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: PAGE_SIZE };
      if (search.trim()) params.search = search.trim();
      const { data } = await api.get('/admin/users', { params });
      setUsers(data.users || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  function handleSearch(e) {
    e.preventDefault();
    setPage(1);
    loadUsers();
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  function statusBadge(user) {
    if (user.disabled_at) {
      return <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-coral-light text-coral text-xs font-semibold">Disabled</span>;
    }
    if (user.is_platform_admin) {
      return <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-plum-light text-plum text-xs font-semibold">Platform Admin</span>;
    }
    return <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-sage-light text-sage text-xs font-semibold">Active</span>;
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-charcoal tracking-tight">Users</h1>
      <p className="text-warm-grey text-sm mt-1">{total} total user{total !== 1 ? 's' : ''}</p>

      {/* Search */}
      <form onSubmit={handleSearch} className="mt-4 flex gap-2">
        <div className="relative flex-1 max-w-md">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-warm-grey" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email..."
            className="w-full pl-10 pr-4 py-2.5 bg-cream border border-light-grey rounded-xl text-sm focus:outline-none focus:border-plum focus:ring-2 focus:ring-plum/20 transition-all"
          />
        </div>
        <button type="submit" className="px-4 py-2.5 bg-plum text-white rounded-xl text-sm font-semibold hover:bg-plum-dark transition-colors">
          Search
        </button>
      </form>

      {/* Table */}
      <div className="mt-4 bg-white rounded-2xl shadow-[var(--shadow-sm)] overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-light-grey text-left">
                  <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider">Name</th>
                  <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider hidden sm:table-cell">Email</th>
                  <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider hidden md:table-cell">Role</th>
                  <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider hidden lg:table-cell">Joined</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-light-grey last:border-0 hover:bg-cream/50 transition-colors">
                    <td className="px-4 py-3">
                      <Link to={`/admin/users/${u.id}`} className="font-medium text-charcoal hover:text-plum">
                        {u.name}
                      </Link>
                      <p className="text-xs text-warm-grey sm:hidden">{u.email || '—'}</p>
                    </td>
                    <td className="px-4 py-3 text-warm-grey hidden sm:table-cell">{u.email || '—'}</td>
                    <td className="px-4 py-3">{statusBadge(u)}</td>
                    <td className="px-4 py-3 text-warm-grey capitalize hidden md:table-cell">{u.role}</td>
                    <td className="px-4 py-3 text-warm-grey hidden lg:table-cell">
                      {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr><td colSpan="5" className="px-4 py-8 text-center text-warm-grey">No users found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-warm-grey">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center gap-1 px-3 py-2 rounded-xl border border-light-grey text-sm font-medium text-charcoal hover:bg-cream disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <IconChevronLeft className="h-4 w-4" /> Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="flex items-center gap-1 px-3 py-2 rounded-xl border border-light-grey text-sm font-medium text-charcoal hover:bg-cream disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next <IconChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
