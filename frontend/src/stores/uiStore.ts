import { create } from 'zustand';

export interface ToastNotification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  durationMs?: number;
}

interface UIState {
  theme: 'dark' | 'light' | 'system';
  sidebarOpen: boolean;
  activeTab: 'transfers' | 'chat' | 'peers' | 'settings';
  notifications: ToastNotification[];
  
  // Actions
  setTheme: (theme: 'dark' | 'light' | 'system') => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setActiveTab: (tab: 'transfers' | 'chat' | 'peers' | 'settings') => void;
  showToast: (notification: Omit<ToastNotification, 'id'>) => void;
  dismissToast: (id: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  theme: 'dark',
  sidebarOpen: true,
  activeTab: 'transfers',
  notifications: [],

  setTheme: (theme) => set({ theme }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setActiveTab: (activeTab) => set({ activeTab }),
  
  showToast: (notif) => {
    const id = window.crypto.randomUUID();
    const duration = notif.durationMs ?? 4000;
    
    set((state) => ({
      notifications: [...state.notifications, { ...notif, id }],
    }));

    if (duration > 0) {
      setTimeout(() => {
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id),
        }));
      }, duration);
    }
  },

  dismissToast: (id) => set((state) => ({
    notifications: state.notifications.filter((n) => n.id !== id),
  })),
}));
