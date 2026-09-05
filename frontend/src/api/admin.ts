import api from './client';

const D = <T>(p: Promise<{ data: any }>): Promise<T> => p.then(r => (r.data?.data ?? r.data) as T);

export const adminApi = {
  dashboard: () => D<any>(api.get('/admin/dashboard')),
  stats: () => D<any>(api.get('/admin/stats')),
  audit: (params?: { action?: string; page?: number; limit?: number }) => D<any[]>(api.get('/admin/audit', { params })),
  users: (params?: { search?: string; role?: string; status?: string; page?: number; limit?: number }) => D<any>(api.get('/admin/users', { params })),
  suspendUser: (id: string, reason?: string) => api.patch(`/admin/users/${id}/suspend`, { reason }),
  activateUser: (id: string) => api.patch(`/admin/users/${id}/activate`),
  blockUser: (id: string, reason?: string) => api.patch(`/admin/users/${id}/block`, { reason }),
  updateUser: (id: string, body: any) => api.patch(`/admin/users/${id}`, body),
};
