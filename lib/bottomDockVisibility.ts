import { useEffect, useState } from 'react';

let suppressed = false;
const listeners = new Set<(value: boolean) => void>();

export function setBottomDockSuppressed(value: boolean) {
  if (suppressed === value) return;

  suppressed = value;
  listeners.forEach((listener) => listener(suppressed));
}

export function useBottomDockSuppressed() {
  const [value, setValue] = useState(suppressed);

  useEffect(() => {
    listeners.add(setValue);
    setValue(suppressed);

    return () => {
      listeners.delete(setValue);
    };
  }, []);

  return value;
}
