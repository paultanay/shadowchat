import { create } from 'zustand';

export interface ToastNotification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  durationMs?: number;
}

const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

interface UIState {
  theme: 'dark' | 'light' | 'system';
  sidebarOpen: boolean;
  notifications: ToastNotification[];
  pageLeaving: boolean;
  
  // Actions
  setTheme: (theme: 'dark' | 'light' | 'system') => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  showToast: (notification: Omit<ToastNotification, 'id'>) => void;
  dismissToast: (id: string) => void;
  setPageLeaving: (leaving: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  theme: 'dark',
  sidebarOpen: true,
  notifications: [],
  pageLeaving: false,

  setTheme: (theme) => set({ theme }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  
  showToast: (notif) => {
    const id = window.crypto.randomUUID();
    const duration = notif.durationMs ?? 4000;
    
    set((state) => ({
      notifications: [...state.notifications, { ...notif, id }],
    }));

    if (duration > 0) {
      const timer = setTimeout(() => {
        toastTimeouts.delete(id);
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id),
        }));
      }, duration);
      toastTimeouts.set(id, timer);
    }
  },

  dismissToast: (id) => {
    const timer = toastTimeouts.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimeouts.delete(id);
    }
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    }));
  },
  setPageLeaving: (leaving) => set({ pageLeaving: leaving }),
}));
