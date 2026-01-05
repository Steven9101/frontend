type Resumer = () => void;

let currentResumer: Resumer | null = null;
let pendingResume = false;

export function registerAudioResumer(resumer: Resumer): () => void {
  currentResumer = resumer;
  if (pendingResume) {
    pendingResume = false;
    try {
      currentResumer?.();
    } catch {
      // ignore
    }
  }
  return () => {
    if (currentResumer === resumer) currentResumer = null;
  };
}

export function triggerAudioResume(): void {
  if (currentResumer) {
    currentResumer();
    return;
  }
  pendingResume = true;
}

