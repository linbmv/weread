const getServiceWorkerUrl = (): string => {
  return `${import.meta.env.BASE_URL}service-worker.js`;
};

export const registerPWAServiceWorker = (): void => {
  if (!import.meta.env.PROD || !('serviceWorker' in window.navigator)) return;

  window.addEventListener('load', () => {
    void window.navigator.serviceWorker.register(getServiceWorkerUrl(), {
      scope: import.meta.env.BASE_URL,
    });
  });
};
