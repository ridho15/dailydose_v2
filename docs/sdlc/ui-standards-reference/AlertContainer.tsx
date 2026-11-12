import React, { useEffect, useState } from 'react';
import { alertManager, AlertPayload, AlertType } from './alert-manager';

const iconMap: Record<AlertType, React.ReactNode> = {
  success: (
    <svg className="h-5 w-5 text-emerald-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  ),
  error: (
    <svg className="h-5 w-5 text-rose-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  ),
  warning: (
    <svg className="h-5 w-5 text-amber-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  ),
  info: (
    <svg className="h-5 w-5 text-sky-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
};

const styleMap: Record<AlertType, { border: string; bg: string; title: string }> = {
  success: {
    border: 'border-emerald-300 dark:border-emerald-800',
    bg: 'bg-emerald-50 dark:bg-emerald-950/80',
    title: 'text-emerald-950 dark:text-emerald-200'
  },
  error: {
    border: 'border-rose-300 dark:border-rose-800',
    bg: 'bg-rose-50 dark:bg-rose-950/80',
    title: 'text-rose-950 dark:text-rose-200'
  },
  warning: {
    border: 'border-amber-300 dark:border-amber-800',
    bg: 'bg-amber-50 dark:bg-amber-950/80',
    title: 'text-amber-950 dark:text-amber-200'
  },
  info: {
    border: 'border-sky-300 dark:border-sky-800',
    bg: 'bg-sky-50 dark:bg-sky-950/80',
    title: 'text-sky-950 dark:text-sky-200'
  }
};

export const AlertContainer: React.FC = () => {
  const [alerts, setAlerts] = useState<Required<AlertPayload>[]>([]);

  useEffect(() => {
    const unsubscribe = alertManager.subscribe((activeAlerts) => {
      setAlerts(activeAlerts);
    });
    return unsubscribe;
  }, []);

  if (alerts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed top-4 right-4 z-50 flex w-full max-w-md flex-col gap-2.5 pointer-events-none px-4 sm:px-0"
    >
      {alerts.map((alert) => {
        const styles = styleMap[alert.type];
        return (
          <div
            key={alert.id}
            role="alert"
            className={`pointer-events-auto relative flex w-full gap-3 rounded-xl border p-4 shadow-lg backdrop-blur-sm transition-all duration-200 ${styles.bg} ${styles.border}`}
          >
            {iconMap[alert.type]}
            <div className="flex-1 pr-6">
              <h4 className={`text-sm font-semibold ${styles.title}`}>
                {alert.actionContext}
              </h4>
              {alert.rootCause && (
                <p className="mt-1 text-xs text-slate-700 dark:text-slate-300">
                  {alert.rootCause}
                </p>
              )}
              {alert.remedySuggestion && (
                <p className="mt-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">Solusi: </span>
                  {alert.remedySuggestion}
                </p>
              )}
            </div>

            <button
              type="button"
              aria-label="Tutup alert"
              onClick={() => alertManager.dismiss(alert.id)}
              className="absolute top-3 right-3 rounded-md p-1 text-slate-400 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-400"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
};

