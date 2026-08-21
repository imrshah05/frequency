import { useEffect } from 'react';

type OnboardingBootstrapProps = {
  start: () => void;
};

export function OnboardingBootstrap({ start }: OnboardingBootstrapProps) {
  useEffect(() => {
    start();
  }, [start]);

  return null;
}
