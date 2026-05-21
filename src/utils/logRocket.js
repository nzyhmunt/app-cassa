import LogRocket from 'logrocket';

const LOG_ROCKET_APP_ID = 'raevtz/nanawork';

export function initLogRocket() {
  if (!import.meta.env.PROD) return;
  LogRocket.init(LOG_ROCKET_APP_ID);
}
