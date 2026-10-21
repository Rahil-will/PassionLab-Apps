import { create } from "zustand";

// --- NOTIFICATION STORE ---
export interface NotificationAction {
  label: string;
  onClick: () => void;
}

interface NotificationState {
  notification: { message: string; type: "success" | "error"; action?: NotificationAction } | null;
  showNotification: (message: string, type?: "success" | "error", action?: NotificationAction) => void;
  hideNotification: () => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  notification: null,
  showNotification: (message, type = "success", action) => {
    set({ notification: { message, type, ...(action ? { action } : {}) } });
    setTimeout(() => set({ notification: null }), 5000);
  },
  hideNotification: () => set({ notification: null }),
}));
