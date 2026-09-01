const viteEnvironment = import.meta.env as Record<string, string | undefined>;
const nextEnvironment = typeof process !== 'undefined' ? process.env : {};

export const appsScriptUrl = viteEnvironment.VITE_APPS_SCRIPT_URL || nextEnvironment.NEXT_PUBLIC_APPS_SCRIPT_URL || '';
export const googleClientId = viteEnvironment.VITE_GOOGLE_CLIENT_ID || nextEnvironment.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';
