import { create } from "zustand";

// --- NOTIFICATION STORE ---
interface NotificationState {
  notification: { message: string; type: "success" | "error" } | null;
  showNotification: (message: string, type?: "success" | "error") => void;
  hideNotification: () => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  notification: null,
  showNotification: (message, type = "success") => {
    set({ notification: { message, type } });
    setTimeout(() => set({ notification: null }), 3000);
  },
  hideNotification: () => set({ notification: null }),
}));
