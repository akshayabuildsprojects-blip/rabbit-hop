// Loads .env (if present) before any module reads process.env. Import this first.
try {
  process.loadEnvFile?.(".env");
} catch {
  /* no .env file: rely on the shell environment */
}
export {};
