import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';

// En producción llamamos DIRECTO al backend de Railway (no vía el proxy de Vercel),
// porque Vercel corta las requests largas (~30s) y la generación de video tarda 60-180s.
// En dev seguimos con el proxy relativo. Configurable con VITE_API_URL.
const BASE_URL = import.meta.env.VITE_API_URL
  ?? (import.meta.env.PROD ? 'https://conversiaarg-production.up.railway.app/api/v1' : '/api/v1');

export const api = axios.create({ baseURL: BASE_URL, withCredentials: false });

// Attach JWT to every request
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let isRefreshing = false;
let failQueue: Array<{ resolve: (v: string) => void; reject: (e: unknown) => void }> = [];

const drainQueue = (err: unknown, token: string | null) => {
  failQueue.forEach(p => (token ? p.resolve(token) : p.reject(err)));
  failQueue = [];
};

// Auto-refresh on 401
api.interceptors.response.use(
  res => res,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status !== 401 || original._retry) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise<string>((resolve, reject) => {
        failQueue.push({ resolve, reject });
      }).then(token => {
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      });
    }

    original._retry = true;
    isRefreshing = true;

    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) {
      isRefreshing = false;
      drainQueue(error, null);
      window.dispatchEvent(new Event('auth:logout'));
      return Promise.reject(error);
    }

    try {
      const { data } = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken });
      localStorage.setItem('accessToken', data.data.accessToken);
      localStorage.setItem('refreshToken', data.data.refreshToken);
      api.defaults.headers.common.Authorization = `Bearer ${data.data.accessToken}`;
      drainQueue(null, data.data.accessToken);
      original.headers.Authorization = `Bearer ${data.data.accessToken}`;
      return api(original);
    } catch (refreshError) {
      drainQueue(refreshError, null);
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      window.dispatchEvent(new Event('auth:logout'));
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  },
);

export default api;
